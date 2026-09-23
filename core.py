"""Semantic note-threading engine (zero dependency).

Notes are vectorized with word + CJK unigram/bigram TF-IDF. Pairs whose
cosine similarity reaches EDGE_THRESHOLD become association edges. Threads
are connected components of that graph, with manual pins (move/merge/split)
acting as hard union constraints. Incremental recompute expands to the
closure of affected notes before re-clustering, so the result always equals
a full reorganize of all notes.
"""
import copy
import itertools
import math
import re
from collections import Counter, defaultdict

EDGE_THRESHOLD = 0.10

_WORD_RE = re.compile(r"[a-z0-9]+")
_CJK_RE = re.compile(r"[一-鿿]+")


def tokenize(text):
    text = text.lower()
    toks = _WORD_RE.findall(text)
    for run in _CJK_RE.findall(text):
        toks.extend(run)
        toks.extend(run[i:i + 2] for i in range(len(run) - 1))
    return toks


class UserError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class Engine:
    def __init__(self):
        self.notes = {}        # note_id -> {id, text, source, ts}
        self.assignments = {}  # note_id -> thread_id (exactly one per note)
        self.pinned = {}       # note_id -> thread_id (manual constraint)
        self.threads = {}      # thread_id -> {"id", "label"}
        self.edges = []        # [(a, b, sim)] global similarity edges, a < b
        self.history = []      # undo snapshots
        self._vecs = {}
        self._note_seq = 0
        self._thread_seq = 0

    # ---------------- import & vectorization ----------------
    def add_notes(self, items):
        added = []
        for it in items:
            text = str(it.get("text", "")).strip()
            if not text:
                continue
            self._note_seq += 1
            nid = "n%d" % self._note_seq
            self.notes[nid] = {
                "id": nid,
                "text": text,
                "source": str(it.get("source") or "未知来源"),
                "ts": str(it.get("ts") or it.get("time") or ""),
            }
            added.append(nid)
        if added:
            self._rebuild_edges()
            self._recompute(set(self.threads), extra=set(self.notes))
        return added

    def reset(self):
        self.__init__()

    def _rebuild_edges(self):
        ids = sorted(self.notes, key=lambda i: int(i[1:]))
        docs = {i: tokenize(self.notes[i]["text"]) for i in ids}
        df = Counter()
        for toks in docs.values():
            for t in set(toks):
                df[t] += 1
        n_docs = max(len(ids), 1)
        self._vecs = {}
        for i, toks in docs.items():
            tf = Counter(toks)
            vec, norm = {}, 0.0
            for t, c in tf.items():
                w = (c / max(len(toks), 1)) * (math.log((1 + n_docs) / (1 + df[t])) + 1.0)
                vec[t] = w
                norm += w * w
            self._vecs[i] = (vec, math.sqrt(norm) or 1.0)
        self.edges = []
        for a, b in itertools.combinations(ids, 2):
            s = self._cos(a, b)
            if s >= EDGE_THRESHOLD:
                self.edges.append((a, b, round(s, 4)))
        # phrase index (CJK n-grams + latin words) for thread labels;
        # phrases aligned to punctuation/run boundaries get a bonus so
        # labels come out as whole words instead of fragments
        self._note_phrases = {}
        pdf = Counter()
        for i in ids:
            text = self.notes[i]["text"].lower()
            ph = {w: 1.0 for w in _WORD_RE.findall(text)}
            for run in _CJK_RE.findall(text):
                run_len = len(run)
                for ln in range(2, min(run_len, 12) + 1):
                    for k in range(run_len - ln + 1):
                        w = 1.0 + (0.16 if k == 0 else 0.0) + (
                            0.14 if k + ln == run_len else 0.0)
                        p = run[k:k + ln]
                        ph[p] = max(ph.get(p, 0.0), w)
            self._note_phrases[i] = ph
            for p in ph:
                pdf[p] += 1
        self._phrase_idf = {p: math.log((1 + n_docs) / (1 + c)) + 1.0
                            for p, c in pdf.items()}

    def _cos(self, a, b):
        va, na = self._vecs[a]
        vb, nb = self._vecs[b]
        if len(va) > len(vb):
            va, vb, na, nb = vb, va, nb, na
        dot = sum(w * vb.get(t, 0.0) for t, w in va.items())
        return dot / (na * nb)

    # ---------------- clustering ----------------
    def _members_of(self, tid):
        return {n for n, t in self.assignments.items() if t == tid}

    def _new_thread_id(self):
        self._thread_seq += 1
        return "t%d" % self._thread_seq
    def _edge_active(self, a, b):
        """An automatic edge is ignored when exactly one endpoint is pinned:
        a manually moved/split note drops its old automatic associations."""
        pa, pb = self.pinned.get(a), self.pinned.get(b)
        if pa is None and pb is None:
            return True
        return pa is not None and pa == pb

    def _cluster(self, scope):
        parent = {n: n for n in scope}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

        for a, b, _ in self.edges:
            if a in parent and b in parent and self._edge_active(a, b):
                union(a, b)
        # pin groups: pinned notes union with each other and with the
        # current (unpinned) members of their target thread
        groups = defaultdict(list)
        for n in scope:
            t = self.pinned.get(n)
            if t:
                groups[t].append(n)
        for t, members in groups.items():
            for n in scope:
                if n not in self.pinned and self.assignments.get(n) == t:
                    members.append(n)
        for members in groups.values():
            for m in members[1:]:
                union(members[0], m)
        comps = defaultdict(list)
        for n in scope:
            comps[find(n)].append(n)
        return sorted((sorted(c, key=lambda i: int(i[1:])) for c in comps.values()),
                      key=lambda c: int(c[0][1:]))

    def _closure(self, seed_threads, extra):
        scope = set(extra)
        for t in seed_threads:
            scope |= self._members_of(t)
        scope &= set(self.notes)
        changed = True
        while changed:
            changed = False
            tset = {self.pinned.get(n) for n in scope}
            tset |= {self.assignments.get(n) for n in scope}
            tset.discard(None)
            for n in self.notes:
                if n not in scope and (self.pinned.get(n) in tset
                                       or self.assignments.get(n) in tset):
                    scope.add(n)
                    changed = True
            for a, b, _ in self.edges:
                if self._edge_active(a, b) and (a in scope) != (b in scope):
                    scope.add(a)
                    scope.add(b)
                    changed = True
        return scope

    def _recompute(self, seed_threads, extra=()):
        """Re-cluster only the closure of affected notes. Notes outside the
        closure keep their exact assignment, so the outcome equals a full
        reorganize restricted to the changed region."""
        scope = self._closure(seed_threads, extra)
        affected = {self.assignments[n] for n in scope if n in self.assignments}
        affected |= set(seed_threads)
        old_members = {t: self._members_of(t) for t in affected}
        used = []
        for comp in self._cluster(scope):
            pin_counts = Counter(self.pinned[n] for n in comp if n in self.pinned)
            tid = None
            if pin_counts:
                cand = sorted(pin_counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
                if cand not in used:
                    tid = cand
            if tid is None:
                comp_set = set(comp)
                best, best_ov = None, 0
                for t in sorted(old_members):
                    if t in used:
                        continue
                    ov = len(old_members[t] & comp_set)
                    if ov > best_ov:
                        best, best_ov = t, ov
                tid = best if best else self._new_thread_id()
            used.append(tid)
            self.threads.setdefault(tid, {"id": tid})
            for n in comp:
                self.assignments[n] = tid
        for t in list(self.threads):
            if not self._members_of(t):
                del self.threads[t]
        for t in used:
            self.threads[t]["label"] = self._label_for(t)
        return sorted(used, key=lambda t: int(t[1:]))

    def reorganize_all(self):
        """Full reorganize of every note (same code path as incremental)."""
        return self._recompute(set(self.threads), extra=set(self.notes))

    @staticmethod
    def _bigrams(p):
        return {p[i:i + 2] for i in range(len(p) - 1)} or {p}

    def _label_for(self, tid):
        members = self._members_of(tid)
        scores, covers = Counter(), Counter()
        for n in members:
            for p, w in self._note_phrases.get(n, {}).items():
                scores[p] += self._phrase_idf.get(p, 1.0) * w * (1.0 + 0.1 * len(p))
                covers[p] += 1
        if len(members) > 1:
            multi = {p for p, c in covers.items() if c >= 2}
            if multi:
                scores = Counter({p: s for p, s in scores.items() if p in multi})
        top, seen = [], set()
        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
        for p, _ in ranked:
            bg = self._bigrams(p)
            if bg & seen:
                continue
            top.append(p)
            seen |= bg
            if len(top) == 3:
                break
        return " / ".join(top) if top else "(empty)"
    # ---------------- manual operations ----------------
    def _require_note(self, nid):
        if nid not in self.notes:
            raise UserError("笔记不存在: %s" % nid, 404)

    def _require_thread(self, tid):
        if tid not in self.threads:
            raise UserError("线索不存在: %s" % tid, 404)

    def _snapshot(self):
        self.history.append(copy.deepcopy({
            "assignments": self.assignments,
            "pinned": self.pinned,
            "threads": self.threads,
        }))
        del self.history[:-50]

    def move_note(self, note_id, target):
        self._require_note(note_id)
        self._require_thread(target)
        src = self.assignments[note_id]
        if src == target:
            raise UserError("笔记已在该线索中")
        self._snapshot()
        self.pinned[note_id] = target
        return self._recompute({src, target})

    def merge_threads(self, ta, tb):
        self._require_thread(ta)
        self._require_thread(tb)
        if ta == tb:
            raise UserError("不能合并同一条线索")
        ma, mb = self._members_of(ta), self._members_of(tb)
        dup = sorted(ma & mb)
        if dup:
            raise UserError(
                "合并会造成笔记重复归属 (%s)，已阻止该操作" % ", ".join(dup),
                status=409)
        self._snapshot()
        for n in ma | mb:
            self.pinned[n] = ta
        return self._recompute({ta, tb})

    def split_note(self, note_id):
        self._require_note(note_id)
        src = self.assignments[note_id]
        if len(self._members_of(src)) <= 1:
            raise UserError("该线索只有一条笔记，无需拆出")
        self._snapshot()
        tid = self._new_thread_id()
        self.threads[tid] = {"id": tid}
        self.pinned[note_id] = tid
        return self._recompute({src, tid})

    def undo(self):
        if not self.history:
            raise UserError("没有可撤销的操作")
        snap = self.history.pop()
        self.assignments = snap["assignments"]
        self.pinned = snap["pinned"]
        self.threads = snap["threads"]
        return sorted(self.threads, key=lambda t: int(t[1:]))

    # ---------------- state serialization ----------------
    def state(self, affected=()):
        out = []
        for tid in sorted(self.threads, key=lambda t: int(t[1:])):
            members = sorted(self._members_of(tid), key=lambda i: int(i[1:]))
            if not members:
                continue
            notes = sorted((self.notes[n] for n in members),
                           key=lambda x: (x["ts"], x["id"]))
            internal = [(a, b, s) for a, b, s in self.edges
                        if self.assignments.get(a) == tid
                        and self.assignments.get(b) == tid]
            strength = (sum(s for _, _, s in internal) / len(internal)) if internal else 0.0
            out.append({
                "id": tid,
                "label": self.threads[tid].get("label", tid),
                "note_count": len(members),
                "latest_ts": max((n["ts"] for n in notes), default=""),
                "strength": round(strength, 4),
                "notes": notes,
                "edges": [{"a": a, "b": b, "sim": s} for a, b, s in internal],
            })
        return {"threads": out,
                "affected": sorted(affected, key=lambda t: int(t[1:]) if t[1:].isdigit() else 0),
                "can_undo": bool(self.history),
                "note_total": len(self.notes)}
