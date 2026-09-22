# -*- coding: utf-8 -*-
"""offline style spec review engine."""
import hashlib
import json
import re

SNIPPET_WIDTH = 30


def fingerprint(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def rule_fingerprint(rule):
    return fingerprint(json.dumps(rule, sort_keys=True, ensure_ascii=False))


def split_chapters(text):
    """Split a long document on level-1 headings (# )."""
    chapters = []
    title = None
    buf = []

    def flush():
        if title is None and not "".join(buf).strip():
            return
        idx = len(chapters) + 1
        chapters.append({
            "id": "ch%d" % idx,
            "title": title or "Preamble",
            "text": "\n".join(buf).strip("\n"),
        })

    for line in text.splitlines():
        if line.startswith("# "):
            flush()
            title = line[2:].strip()
            buf = []
        else:
            buf.append(line)
    flush()
    return chapters


def snippet(text, start, end, width=SNIPPET_WIDTH):
    a = max(0, start - width)
    b = min(len(text), end + width)
    frag = text[a:b].replace("\n", " ").strip()
    return ("..." if a > 0 else "") + frag + ("..." if b < len(text) else "")


def _occurrences(text, needle):
    return [(m.start(), m.end()) for m in re.finditer(re.escape(needle), text)]


def _violation(chapter, start, end, matched, detail):
    return {
        "chapter_id": chapter["id"],
        "chapter_title": chapter["title"],
        "start": start,
        "end": end,
        "matched": matched,
        "detail": detail,
        "snippet": snippet(chapter["text"], start, end),
    }


def _untrusted(rule, chapter_id, reason):
    return {
        "rule_id": rule.get("id", "?"),
        "chapter_id": chapter_id,
        "status": "untrusted",
        "reason": reason,
        "violations": [],
    }


def evaluate_pair(rule, chapter, chapters):
    """Evaluate one rule against one chapter.

    Each (rule, chapter) pair yields an independent conclusion, so when one
    location triggers several rules every piece of evidence is preserved.
    """
    rtype = rule.get("type")
    base = {"rule_id": rule.get("id", "?"), "chapter_id": chapter["id"], "reason": ""}
    text = chapter["text"]

    if rtype == "terminology":
        preferred = (rule.get("preferred") or "").strip()
        forbidden = [t for t in (rule.get("forbidden") or []) if t.strip()]
        if not preferred or not forbidden:
            return _untrusted(rule, chapter["id"],
                              "规范条目缺少目标术语（preferred 或 forbidden 为空），结论不可信")
        violations = []
        for term in forbidden:
            for (s, e) in _occurrences(text, term):
                violations.append(_violation(chapter, s, e, term,
                                             "应使用规范术语「%s」" % preferred))
        violations.sort(key=lambda v: v["start"])
        return dict(base, status="violation" if violations else "pass", violations=violations)

    if rtype == "tone":
        pattern = rule.get("pattern") or ""
        if not pattern:
            return _untrusted(rule, chapter["id"],
                              "语气规范缺少匹配模式（pattern 为空），结论不可信")
        try:
            rx = re.compile(pattern)
        except re.error as exc:
            return _untrusted(rule, chapter["id"], "语气规范的正则表达式无效：%s" % exc)
        desc = rule.get("description") or "不符合语气要求"
        violations = [_violation(chapter, m.start(), m.end(), m.group(0), desc)
                      for m in rx.finditer(text)]
        return dict(base, status="violation" if violations else "pass", violations=violations)

    if rtype == "consistency":
        canonical = (rule.get("canonical") or "").strip()
        variants = [t for t in (rule.get("variants") or []) if t.strip()]
        if not canonical:
            return _untrusted(rule, chapter["id"],
                              "一致性规范缺少基准词（canonical 为空），结论不可信")
        whole = "\n".join(c["text"] for c in chapters)
        if canonical not in whole:
            return _untrusted(rule, chapter["id"],
                              "规范指向的目标「%s」在文档中未出现，无法建立一致性基准，结论不可信" % canonical)
        violations = []
        for term in variants:
            for (s, e) in _occurrences(text, term):
                violations.append(_violation(chapter, s, e, term,
                                             "全文应统一为「%s」" % canonical))
        violations.sort(key=lambda v: v["start"])
        return dict(base, status="violation" if violations else "pass", violations=violations)

    if rtype == "section_presence":
        pattern = rule.get("pattern") or ""
        if not pattern:
            return _untrusted(rule, chapter["id"],
                              "章节要素规范缺少匹配模式（pattern 为空），结论不可信")
        if re.search(pattern, text):
            return dict(base, status="pass", violations=[])
        v = _violation(chapter, 0, 0, "", "本章缺少规范要求的要素：/%s/" % pattern)
        return dict(base, status="violation", violations=[v])

    return _untrusted(rule, chapter["id"], "未知的规范类型「%s」，结论不可信" % rtype)


class Engine:
    """Incremental engine: caches conclusions per (rule, chapter); a pair is
    recomputed only when the rule text or the chapter text actually changed."""

    GLOBAL_TYPES = ("consistency",)  # also depend on the whole document

    def __init__(self):
        self.cache = {}

    def evaluate(self, rules, chapters):
        doc_fp = fingerprint("\x00".join(c["text"] for c in chapters))
        ch_map = {c["id"]: c for c in chapters}
        results = []
        recomputed = 0
        reused = 0
        valid_keys = set()
        for i, rule in enumerate(rules):
            if "id" not in rule:
                rule["id"] = "rule%d" % (i + 1)
            rfp = rule_fingerprint(rule)
            scope = rule.get("chapters") or [c["id"] for c in chapters]
            for cid in scope:
                ch = ch_map.get(cid)
                if ch is None:
                    results.append(_untrusted(
                        rule, cid,
                        "规范指向的章节「%s」在文档中不存在，结论不可信" % cid))
                    continue
                key = (rule["id"], cid)
                valid_keys.add(key)
                fp = rfp + "|" + fingerprint(ch["text"])
                if rule.get("type") in self.GLOBAL_TYPES:
                    fp += "|" + doc_fp
                cached = self.cache.get(key)
                if cached and cached[0] == fp:
                    results.append(cached[1])
                    reused += 1
                else:
                    res = evaluate_pair(rule, ch, chapters)
                    self.cache[key] = (fp, res)
                    results.append(res)
                    recomputed += 1
        for key in list(self.cache):
            if key not in valid_keys:
                del self.cache[key]
        return results, {"recomputed": recomputed, "reused": reused}


def full_recheck(rules, chapters):
    """Full re-derivation with a cold cache, used to verify that incremental
    results are identical to a whole-document re-run."""
    fresh = Engine()
    results, _ = fresh.evaluate(rules, chapters)
    return results


def normalize(results):
    return json.dumps(results, sort_keys=True, ensure_ascii=False)
