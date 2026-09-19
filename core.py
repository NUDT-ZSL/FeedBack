# -*- coding: utf-8 -*-
"""版本血缘核心逻辑:存储、校验、分叉点/差异计算、对比结论缓存的精准失效。"""
import json
import os
import threading
import time


class VersionStore:
    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self.versions = {}      # id -> record
        self.problems = {}      # id -> [problem, ...]
        self.cache = {}         # "a|b" -> {"result":..., "deps":[...]}
        self.cache_log = []     # 最近的失效事件,供界面展示"哪些结论变了"
        self.load()

    # ---------- 持久化 ----------
    def load(self):
        self.versions = {}
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            for rec in data.get("versions", []):
                rec.setdefault("revoked", False)
                rec.setdefault("pending", False)
                rec.setdefault("pending_reason", "")
                self.versions[rec["id"]] = rec
        self.cache = {}
        self.cache_log = []
        self.revalidate()

    def save(self):
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"versions": list(self.versions.values())},
                      f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    # ---------- 校验:缺失父版本 / 血缘闭环 ----------
    def _flag(self, vid, kind, msg, members):
        self.problems.setdefault(vid, []).append(
            {"kind": kind, "message": msg, "members": members})

    def revalidate(self):
        self.problems = {}
        for vid, rec in self.versions.items():
            p = rec.get("parent")
            if p and p not in self.versions:
                self._flag(vid, "missing_parent",
                           "父版本 %s 不存在" % p, [vid])
        for vid in self.versions:
            seen, cur = {}, vid
            while cur and cur in self.versions and cur not in seen:
                seen[cur] = True
                cur = self.versions[cur].get("parent")
            if cur and cur in seen:  # 回到已访问节点 => 闭环
                cyc, n = [cur], self.versions[cur].get("parent")
                while n and n != cur and n in self.versions:
                    cyc.append(n)
                    n = self.versions[n].get("parent")
                chain = " -> ".join(cyc + [cur])
                for m in cyc:
                    if not any(p["kind"] == "cycle" for p in self.problems.get(m, [])):
                        self._flag(m, "cycle", "血缘闭环: " + chain, cyc)

    # ---------- 血缘遍历 ----------
    def ancestors(self, vid):
        """从 vid 向根遍历(含自身),遇缺失/闭环安全停止。"""
        out, seen, cur = [], set(), vid
        while cur and cur in self.versions and cur not in seen:
            seen.add(cur)
            out.append(cur)
            cur = self.versions[cur].get("parent")
        return out

    def descendants(self, vid):
        base = {vid}
        changed = True
        while changed:
            changed = False
            for i, r in self.versions.items():
                if i not in base and r.get("parent") in base:
                    base.add(i)
                    changed = True
        return base - {vid}

    def fork_point(self, a, b):
        anc_b = set(self.ancestors(b))
        for v in self.ancestors(a):
            if v in anc_b:
                return v
        return None

    # ---------- 对比:分叉点 + 差异摘要 + 依据版本 ----------
    def compare(self, a, b):
        if a not in self.versions or b not in self.versions:
            return {"error": "版本不存在"}
        key = a + "|" + b
        if key in self.cache:
            r = dict(self.cache[key]["result"])
            r["from_cache"] = True
            return r
        fork = self.fork_point(a, b)
        anc_a, anc_b = self.ancestors(a), self.ancestors(b)
        # a 侧:fork 之后到 a 的链(新->旧);b 侧:fork 到 b(旧->新)
        a_side = anc_a[:anc_a.index(fork)] if fork in anc_a else anc_a
        b_side = anc_b[:anc_b.index(fork)] if fork in anc_b else anc_b
        b_side = list(reversed(b_side))
        lines = []
        if fork is None:
            lines.append("两个版本没有共同祖先,无法给出分叉点。")
        else:
            lines.append("分叉点: %s(%s)" % (fork, self.versions[fork]["summary"]))
        if not a_side and b_side:
            lines.append("%s 是 %s 的祖先,差异为后者新增:" % (a, b))
        elif not b_side and a_side:
            lines.append("%s 是 %s 的祖先,差异为前者新增:" % (b, a))
        elif not a_side and not b_side:
            lines.append("两个版本相同,无差异。")
        for v in a_side:
            r = self.versions[v]
            lines.append("[仅 %s 侧] %s: %s(%s)" % (a, v, r["summary"], r["author"]))
        for v in b_side:
            r = self.versions[v]
            lines.append("[仅 %s 侧] %s: %s(%s)" % (b, v, r["summary"], r["author"]))
        basis = ([fork] if fork else []) + a_side + b_side
        result = {
            "a": a, "b": b, "fork": fork,
            "a_side": a_side, "b_side": b_side,
            "diff": lines, "basis": basis,
            "basis_summaries": {v: self.versions[v]["summary"] for v in basis},
            "computed_at": time.strftime("%H:%M:%S"),
            "from_cache": False,
        }
        self.cache[key] = {"result": result, "deps": sorted(set(basis))}
        return result

    # ---------- 精准失效:只丢弃依赖被改动版本的结论 ----------
    def _invalidate(self, changed_ids):
        affected = set()
        for c in changed_ids:
            affected.add(c)
            affected |= self.descendants(c)
        dropped, kept = [], []
        for k, e in list(self.cache.items()):
            if affected & set(e["deps"]):
                dropped.append(k)
                del self.cache[k]
            else:
                kept.append(k)
        self.cache_log.insert(0, {
            "time": time.strftime("%H:%M:%S"),
            "changed": sorted(affected),
            "invalidated": dropped, "kept": kept,
        })
        del self.cache_log[20:]
        return {"invalidated": dropped, "kept": kept, "affected": sorted(affected)}

    # ---------- 变更操作 ----------
    def add_version(self, rec):
        vid = rec.get("id", "").strip()
        if not vid:
            return {"error": "缺少版本标识"}
        if vid in self.versions:
            return {"error": "版本标识已存在: " + vid}
        self.versions[vid] = {
            "id": vid,
            "parent": (rec.get("parent") or "").strip() or None,
            "author": rec.get("author", "").strip() or "佚名",
            "time": rec.get("time", "").strip() or time.strftime("%Y-%m-%d %H:%M"),
            "summary": rec.get("summary", "").strip(),
            "revoked": False, "pending": False, "pending_reason": "",
        }
        self.revalidate()
        self.save()
        # 新版本可能正是别人缺失的父版本,相关结论需重算
        return self._invalidate([vid])

    def update_version(self, vid, fields):
        if vid not in self.versions:
            return {"error": "版本不存在: " + vid}
        rec = self.versions[vid]
        for k in ("summary", "author", "time", "parent"):
            if k in fields:
                rec[k] = (fields[k] or "").strip() if k != "summary" else fields[k]
        if "parent" in fields and not rec["parent"]:
            rec["parent"] = None
        self.revalidate()
        self.save()
        return self._invalidate([vid])

    def revoke(self, vid):
        if vid not in self.versions:
            return {"error": "版本不存在: " + vid}
        self.versions[vid]["revoked"] = True
        children = [i for i, r in self.versions.items()
                    if r.get("parent") == vid]
        for c in children:
            self.versions[c]["pending"] = True
            self.versions[c]["pending_reason"] = "父版本 %s 已撤销,待指定新父版本" % vid
        self.revalidate()
        self.save()
        inv = self._invalidate([vid])
        inv["children_pending"] = children
        return inv

    def reparent(self, vid, new_parent):
        if vid not in self.versions:
            return {"error": "版本不存在: " + vid}
        if new_parent and new_parent not in self.versions:
            return {"error": "新父版本不存在: " + new_parent}
        rec = self.versions[vid]
        rec["parent"] = new_parent or None
        rec["pending"] = False
        rec["pending_reason"] = ""
        self.revalidate()
        self.save()
        return self._invalidate([vid])

    def parent_candidates(self, vid):
        """为待处理版本给出可选新父版本:祖父优先,其次同作者,按时间倒序。"""
        if vid not in self.versions:
            return []
        rec = self.versions[vid]
        desc = self.descendants(vid) | {vid}
        old_parent = rec.get("parent")
        grand = (self.versions.get(old_parent) or {}).get("parent")
        cands = []
        for i, r in self.versions.items():
            if i in desc or r.get("revoked"):
                continue
            score = 0
            if i == grand:
                score += 100
            if r.get("author") == rec.get("author"):
                score += 10
            cands.append({"id": i, "author": r["author"], "time": r["time"],
                          "summary": r["summary"], "score": score})
        cands.sort(key=lambda c: (-c["score"], c["time"]), reverse=False)
        cands.sort(key=lambda c: -c["score"])
        return cands[:6]

    # ---------- 导出给前端 ----------
    def state(self):
        return {
            "versions": list(self.versions.values()),
            "problems": self.problems,
            "cache": {k: v["deps"] for k, v in self.cache.items()},
            "cache_log": self.cache_log,
        }
