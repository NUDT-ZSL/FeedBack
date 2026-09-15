"""经验图谱核心：条目、有向无环引用、修订历史、冲突消解、增量重算、逻辑时钟。

仅使用标准库。所有对外返回的集合均按稳定顺序（通常按标识字典序）排列。
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Set, Tuple

from . import merge as merge_mod
from .errors import (
    CorruptSnapshot,
    EntryExists,
    EntryNotFound,
    GraphError,
    MergeConflict,
    ReferenceError,
    StaleRevision,
)

SCHEMA_VERSION = 1


# ---- 记录类型 ----------------------------------------------------------------

@dataclass
class Version:
    number: int
    body: str
    authors: List[str]
    change: str
    kind: str = "edit"          # create / edit / merge / resolve
    clock: int = 0


@dataclass
class Revision:
    """一次修订记录（修订链上的一环）。"""
    revision_id: str
    entry_id: str
    authors: List[str]
    base_version: int
    new_version: int
    changes: List[str]
    kind: str                   # edit / merge / resolve
    clock: int
    conflict_id: Optional[str] = None


@dataclass
class ConflictRecord:
    conflict_id: str
    entry_id: str
    base_version: int
    location: int               # 段落位置（0 基）
    location_kind: str          # slot / gap
    parties: List[dict]         # [{author, action, lines, change}]
    rendered: str
    clock: int
    resolved_by: Optional[str] = None


# ---- 图谱 --------------------------------------------------------------------

class ExperienceGraph:
    def __init__(self):
        self._entries: Dict[str, dict] = {}          # id -> {topic}
        self._versions: Dict[str, List[Version]] = {}
        self._revisions: Dict[str, List[Revision]] = {}
        self._edges: Set[Tuple[str, str]] = set()    # 规范的引用边集合
        # 增量维护的索引
        self._out: Dict[str, Set[str]] = {}
        self._in: Dict[str, Set[str]] = {}
        self._conflicts: Dict[str, ConflictRecord] = {}
        self.clock = 0
        self._seq = 0

    # ---- 内部工具 ----

    def _tick(self) -> int:
        self.clock += 1
        return self.clock

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def _require(self, entry_id: str) -> None:
        if entry_id not in self._entries:
            raise EntryNotFound(f"条目不存在：{entry_id!r}")

    def _current_number(self, entry_id: str) -> int:
        return len(self._versions[entry_id]) - 1

    def _body(self, entry_id: str, number: int) -> str:
        return self._versions[entry_id][number].body

    # ---- 条目 ----

    def create_entry(self, entry_id: str, topic: str, body: str, author: str,
                     change: str = "创建条目") -> int:
        if not isinstance(entry_id, str) or not entry_id:
            raise GraphError("条目标识必须是非空字符串")
        if entry_id in self._entries:
            raise EntryExists(f"条目已存在：{entry_id!r}")
        tick = self._tick()
        self._entries[entry_id] = {"topic": topic}
        self._versions[entry_id] = [
            Version(0, body, [author], change, kind="create", clock=tick)
        ]
        self._revisions[entry_id] = []
        self._out[entry_id] = set()
        self._in[entry_id] = set()
        return 0

    def current_version(self, entry_id: str) -> int:
        self._require(entry_id)
        return self._current_number(entry_id)

    def get_entry(self, entry_id: str) -> dict:
        self._require(entry_id)
        v = self._versions[entry_id][-1]
        return {
            "id": entry_id,
            "topic": self._entries[entry_id]["topic"],
            "body": v.body,
            "version": v.number,
            "authors": list(v.authors),
        }

    # ---- 引用 ----

    def add_reference(self, source: str, target: str) -> None:
        """建立 ``source -> target`` 引用；目标必须存在且不允许成环。"""
        self._require(source)
        self._require(target)
        if source == target:
            raise ReferenceError(f"不允许条目自引用：{source!r}")
        if (source, target) in self._edges:
            raise ReferenceError(f"引用已存在：{source!r} -> {target!r}")
        if self._reaches(target, source):
            raise ReferenceError(
                f"拒绝引用 {source!r} -> {target!r}：会形成环路"
            )
        self._tick()
        self._edges.add((source, target))
        self._out[source].add(target)
        self._in[target].add(source)

    def _reaches(self, start: str, goal: str) -> bool:
        """有向图上 start 是否能到达 goal（含新增边前的判定）。"""
        stack = [start]
        seen: Set[str] = set()
        while stack:
            node = stack.pop()
            if node == goal:
                return True
            if node in seen:
                continue
            seen.add(node)
            stack.extend(self._out.get(node, ()))
        return False

    def _drop_edge(self, source: str, target: str) -> bool:
        if (source, target) not in self._edges:
            return False
        self._edges.discard((source, target))
        self._out.get(source, set()).discard(target)
        self._in.get(target, set()).discard(source)
        return True

    def backlinks(self, entry_id: str) -> List[str]:
        """返回引用了该条目的条目标识，按字典序稳定排列。"""
        self._require(entry_id)
        return sorted(self._in[entry_id])

    def outgoing(self, entry_id: str) -> List[str]:
        self._require(entry_id)
        return sorted(self._out[entry_id])

    # ---- 修订 ----

    def submit_revision(self, entry_id: str, author: str, base_version: int,
                        new_body: str, change: str) -> int:
        """提交单个修订（乐观并发）。

        基于过期版本会抛出 :class:`StaleRevision`（含落后版本数），不会覆盖。
        """
        self._require(entry_id)
        cur = self._current_number(entry_id)
        if base_version < 0 or base_version > cur:
            raise GraphError(
                f"非法基准版本 v{base_version}：{entry_id!r} 当前为 v{cur}"
            )
        if base_version < cur:
            raise StaleRevision(
                f"修订被拒绝：{author!r} 基于 v{base_version}，"
                f"但 {entry_id!r} 当前为 v{cur}，落后 {cur - base_version} 个版本",
                behind=cur - base_version,
                current_version=cur,
                base_version=base_version,
            )
        if new_body == self._body(entry_id, cur):
            raise GraphError("修订无实际改动（正文与当前版本相同）")

        tick = self._tick()
        new_number = cur + 1
        self._versions[entry_id].append(
            Version(new_number, new_body, [author], change, kind="edit", clock=tick)
        )
        rev_id = f"R{self._next_seq():04d}"
        self._revisions[entry_id].append(Revision(
            revision_id=rev_id, entry_id=entry_id, authors=[author],
            base_version=base_version, new_version=new_number,
            changes=[change], kind="edit", clock=tick,
        ))
        return new_number

    def integrate_revisions(self, entry_id: str, candidates: List[dict],
                            strict: bool = True):
        """集成多个基于同一版本的候选修订。

        candidate 字段：``author``、``base_version``、``body``、``change``。

        * 基准版本过期 -> :class:`StaleRevision`；
        * 改动不同段落 -> 自动合并为**一条**新版本；
        * 同一段落互斥修改 -> 保留双方、写入冲突记录，条目不前进版本，
          ``strict=True`` 时抛出 :class:`MergeConflict`。

        返回新版本号（冲突时返回冲突 id 列表）。
        """
        self._require(entry_id)
        if not candidates:
            raise GraphError("没有候选修订")
        cur = self._current_number(entry_id)
        bases = {c["base_version"] for c in candidates}
        if len(bases) != 1:
            raise GraphError(f"候选修订必须基于同一版本，实际基准：{sorted(bases)}")
        base_version = bases.pop()
        if base_version < 0 or base_version > cur:
            raise GraphError(
                f"非法基准版本 v{base_version}：{entry_id!r} 当前为 v{cur}"
            )
        if base_version < cur:
            raise StaleRevision(
                f"批量修订被拒绝：基于 v{base_version}，但 {entry_id!r} 当前为 v{cur}，"
                f"落后 {cur - base_version} 个版本",
                behind=cur - base_version,
                current_version=cur,
                base_version=base_version,
            )

        authors = sorted({c["author"] for c in candidates})
        if len(authors) != len(candidates):
            raise GraphError("同一批集成中作者必须唯一（同一作者请合并为一个候选）")

        base_body = self._body(entry_id, base_version)
        changed = [c for c in candidates if c["body"] != base_body]
        if not changed:
            raise GraphError("候选修订均无实际改动")

        cand_tuples = [(c["author"], base_version, c["body"]) for c in changed]
        blocks, conflicts = merge_mod.integrate(base_body, cand_tuples)
        change_by_author = {c["author"]: c["change"] for c in changed}

        tick = self._tick()

        if conflicts:
            # 保留双方：写入可读冲突记录，条目不前进版本，绝不任选一方。
            ids = []
            for conf in conflicts:
                parties = []
                for p in conf["parties"]:
                    parties.append({
                        "author": p["author"],
                        "action": p["action"],
                        "lines": p["lines"],
                        "change": change_by_author.get(p["author"], ""),
                    })
                cid = f"C{self._next_seq():04d}"
                record = ConflictRecord(
                    conflict_id=cid,
                    entry_id=entry_id,
                    base_version=base_version,
                    location=conf["location"],
                    location_kind=conf["kind"],
                    parties=parties,
                    rendered=self._render_conflict(entry_id, base_version,
                                                   conf, change_by_author),
                    clock=tick,
                )
                self._conflicts[cid] = record
                ids.append(cid)
            if strict:
                raise MergeConflict(
                    f"条目 {entry_id!r} 在段落位置 "
                    f"{[c['location'] for c in conflicts]} 出现 "
                    f"{len(conflicts)} 处冲突，已保留双方（冲突记录 {ids}）",
                    records=[self._conflicts[i] for i in ids],
                )
            return ids

        # 干净合并：一条新版本
        new_body = merge_mod.render_blocks(blocks)
        new_number = cur + 1
        self._versions[entry_id].append(Version(
            new_number, new_body, authors,
            "；".join(c["change"] for c in sorted(changed, key=lambda x: x["author"])),
            kind="merge", clock=tick,
        ))
        rev_id = f"R{self._next_seq():04d}"
        self._revisions[entry_id].append(Revision(
            revision_id=rev_id, entry_id=entry_id, authors=authors,
            base_version=base_version, new_version=new_number,
            changes=[c["change"] for c in sorted(changed, key=lambda x: x["author"])],
            kind="merge", clock=tick,
        ))
        return new_number

    @staticmethod
    def _render_conflict(entry_id, base_version, conf, change_by_author) -> str:
        header = (
            f"冲突：条目 {entry_id!r} 基于 v{base_version}，"
            + ("段落" if conf["kind"] == "slot" else "段落间隙")
            + f" 位置 {conf['location']}\n"
        )
        parts = []
        for p in conf["parties"]:
            who = f"作者 {p['author']} 主张{p['action']}"
            body = "\n".join(p["lines"])
            parts.append(who + "\n" + body)
        return header + "\n------ 分歧分隔线 ------\n".join(parts)

    def resolve_conflict(self, conflict_id: str, author: str, body: str,
                         change: str) -> int:
        """人工解决冲突：在冲突基准版本之上提交确定的合并正文。"""
        if conflict_id not in self._conflicts:
            raise EntryNotFound(f"冲突记录不存在：{conflict_id!r}")
        record = self._conflicts[conflict_id]
        entry_id = record.entry_id
        cur = self._current_number(entry_id)
        if record.base_version != cur:
            raise StaleRevision(
                f"冲突 {conflict_id} 基于 v{record.base_version}，"
                f"条目已前进到 v{cur}，落后 {cur - record.base_version} 个版本",
                behind=cur - record.base_version,
                current_version=cur,
                base_version=record.base_version,
            )
        tick = self._tick()
        new_number = cur + 1
        self._versions[entry_id].append(Version(
            new_number, body, [author], change, kind="resolve", clock=tick
        ))
        rev_id = f"R{self._next_seq():04d}"
        self._revisions[entry_id].append(Revision(
            revision_id=rev_id, entry_id=entry_id, authors=[author],
            base_version=cur, new_version=new_number, changes=[change],
            kind="resolve", clock=tick, conflict_id=conflict_id,
        ))
        record.resolved_by = rev_id
        return new_number

    def get_conflict(self, conflict_id: str) -> ConflictRecord:
        if conflict_id not in self._conflicts:
            raise EntryNotFound(f"冲突记录不存在：{conflict_id!r}")
        return self._conflicts[conflict_id]

    def list_conflicts(self, entry_id: Optional[str] = None) -> List[ConflictRecord]:
        out = [c for c in self._conflicts.values()
               if entry_id is None or c.entry_id == entry_id]
        return sorted(out, key=lambda c: (c.entry_id, c.location, c.conflict_id))

    # ---- 删除 / 拆分：只重算受影响的引用关系 ----

    def _purge_entry_state(self, entry_id: str) -> None:
        """删除条目本体及其版本/修订/冲突（冲突随条目级联清除）。"""
        for cid in [c for c in self._conflicts.values() if c.entry_id == entry_id]:
            del self._conflicts[cid.conflict_id]
        del self._entries[entry_id]
        del self._versions[entry_id]
        del self._revisions[entry_id]
        del self._out[entry_id]
        del self._in[entry_id]

    def delete_entry(self, entry_id: str) -> dict:
        """删除条目，并清除所有与之关联的引用边（绝不留悬空引用）。

        返回受影响的边，便于验收"只重算受影响部分"。
        """
        self._require(entry_id)
        tick = self._tick()
        affected = sorted(
            [(s, entry_id) for s in self._in[entry_id]]
            + [(entry_id, t) for t in self._out[entry_id]]
        )
        for s, t in list(self._edges):
            if s == entry_id or t == entry_id:
                self._drop_edge(s, t)
        self._purge_entry_state(entry_id)
        return {"clock": tick, "removed_edges": affected}

    def split_entry(self, old_id: str, parts: List[dict],
                    incoming_target: Optional[str] = None,
                    outgoing_source: Optional[str] = None) -> dict:
        """把一个条目拆分为多个新条目，仅重算与旧条目相关的引用边。

        ``parts`` 为 ``[{id, topic, body, author}]``（按给定顺序，顺序即结果顺序）。
        默认所有"指向旧条目"的引用改指向第一个分片，旧条目的出引用由第一个分片
        继承；可用 ``incoming_target`` / ``outgoing_source`` 指定其它分片。

        结果与从头重建完全一致（无旧节点、无悬空边）。
        """
        self._require(old_id)
        if len(parts) < 2:
            raise GraphError("拆分至少需要两个新条目")
        new_ids = [p["id"] for p in parts]
        if len(set(new_ids)) != len(new_ids):
            raise GraphError("分片标识必须唯一")
        for p in parts:
            if p["id"] in self._entries:
                raise EntryExists(f"条目已存在：{p['id']!r}")

        in_target = incoming_target or new_ids[0]
        out_source = outgoing_source or new_ids[0]
        if in_target not in new_ids or out_source not in new_ids:
            raise GraphError("重定向目标必须是分片之一")

        old_incoming = sorted(self._in[old_id])
        old_outgoing = sorted(self._out[old_id])

        tick = self._tick()

        # 拆除与旧条目相关的边（受影响部分）
        for s, t in list(self._edges):
            if s == old_id or t == old_id:
                self._drop_edge(s, t)
        self._purge_entry_state(old_id)

        # 建立分片（不再各自动时钟，整体算作一次拆分操作）
        for p in parts:
            self._entries[p["id"]] = {"topic": p["topic"]}
            self._versions[p["id"]] = [
                Version(0, p["body"], [p.get("author", "split")],
                        f"由 {old_id!r} 拆分", kind="create", clock=tick)
            ]
            self._revisions[p["id"]] = []
            self._out[p["id"]] = set()
            self._in[p["id"]] = set()

        redirected = []
        for s in old_incoming:
            self._edges.add((s, in_target))
            self._out[s].add(in_target)
            self._in[in_target].add(s)
            redirected.append((s, in_target))
        for t in old_outgoing:
            self._edges.add((out_source, t))
            self._out[out_source].add(t)
            self._in[t].add(out_source)
            redirected.append((out_source, t))

        return {
            "clock": tick,
            "new_ids": list(new_ids),
            "redirected_edges": sorted(redirected),
        }

    def rebuild_indexes(self) -> None:
        """从规范边集合从头重建邻接索引（供验收：增量结果必须与之相等）。"""
        nodes = set(self._entries)
        out: Dict[str, Set[str]] = {n: set() for n in nodes}
        back: Dict[str, Set[str]] = {n: set() for n in nodes}
        for s, t in self._edges:
            if s not in nodes or t not in nodes:
                raise CorruptSnapshot(
                    f"引用边悬空：{s!r} -> {t!r}（端点不存在）"
                )
            out[s].add(t)
            back[t].add(s)
        self._out = out
        self._in = back

    def has_dangling_reference(self) -> bool:
        nodes = set(self._entries)
        return any(s not in nodes or t not in nodes for s, t in self._edges)

    # ---- 查询 ----

    def revision_chain(self, entry_id: str) -> List[dict]:
        """完整修订链（v0 为创建，之后按修订次序，稳定排列）。"""
        self._require(entry_id)
        chain = [{
            "revision_id": f"v{0}",
            "authors": list(self._versions[entry_id][0].authors),
            "base_version": None,
            "new_version": 0,
            "changes": [self._versions[entry_id][0].change],
            "kind": "create",
            "clock": self._versions[entry_id][0].clock,
            "conflict_id": None,
        }]
        for r in self._revisions[entry_id]:
            chain.append({
                "revision_id": r.revision_id,
                "authors": list(r.authors),
                "base_version": r.base_version,
                "new_version": r.new_version,
                "changes": list(r.changes),
                "kind": r.kind,
                "clock": r.clock,
                "conflict_id": r.conflict_id,
            })
        return chain

    def diff_versions(self, entry_id: str, version_a: int,
                      version_b: int) -> dict:
        """两版之间的实际差异，稳定顺序返回。

        返回 ``{entry_id, from_version, to_version, lines:[('eq'|'del'|'ins', 行)]}``。
        """
        self._require(entry_id)
        versions = self._versions[entry_id]
        hi = len(versions) - 1
        if not (0 <= version_a <= hi) or not (0 <= version_b <= hi):
            raise GraphError(f"版本号越界：{entry_id!r} 仅有 v0..v{hi}")
        lines = merge_mod.line_diff(versions[version_a].body, versions[version_b].body)
        return {
            "entry_id": entry_id,
            "from_version": version_a,
            "to_version": version_b,
            "lines": lines,
            "rendered": merge_mod.render_diff(versions[version_a].body,
                                              versions[version_b].body),
        }

    def list_entries(self) -> List[str]:
        return sorted(self._entries)

    # ---- 序列化（供 persistence 使用）----

    def to_dict(self) -> dict:
        return {
            "schema": SCHEMA_VERSION,
            "clock": self.clock,
            "seq": self._seq,
            "entries": {
                eid: {"topic": meta["topic"]}
                for eid, meta in sorted(self._entries.items())
            },
            "versions": {
                eid: [asdict(v) for v in vers]
                for eid, vers in sorted(self._versions.items())
            },
            "revisions": {
                eid: [asdict(r) for r in revs]
                for eid, revs in sorted(self._revisions.items())
            },
            "edges": sorted([list(e) for e in self._edges]),
            "conflicts": {
                cid: asdict(c) for cid, c in sorted(self._conflicts.items())
            },
        }

    @classmethod
    def from_dict(cls, data: dict):
        g = cls()
        # 严格校验：缺字段/类型不符一律 CorruptSnapshot
        def need(mapping, key, where, typ):
            if key not in mapping:
                raise CorruptSnapshot(f"快照损坏：{where} 缺少字段 {key!r}")
            val = mapping[key]
            if not isinstance(val, typ):
                raise CorruptSnapshot(
                    f"快照损坏：{where}.{key} 类型错误（应为 {typ.__name__}）"
                )
            return val

        need(data, "schema", "根", int)
        if data["schema"] != SCHEMA_VERSION:
            raise CorruptSnapshot(f"不支持的快照版本：{data['schema']}")
        g.clock = need(data, "clock", "根", int)
        g._seq = need(data, "seq", "根", int)

        entries = need(data, "entries", "根", dict)
        versions = need(data, "versions", "根", dict)
        revisions = need(data, "revisions", "根", dict)
        edges = need(data, "edges", "根", list)
        conflicts = need(data, "conflicts", "根", dict)

        for eid, meta in entries.items():
            if not isinstance(meta, dict) or "topic" not in meta:
                raise CorruptSnapshot(f"快照损坏：entries[{eid!r}] 缺少 topic")
            g._entries[eid] = {"topic": meta["topic"]}
            g._out[eid] = set()
            g._in[eid] = set()

        for eid, vers in versions.items():
            if eid not in g._entries:
                raise CorruptSnapshot(f"快照损坏：版本属于不存在的条目 {eid!r}")
            if not isinstance(vers, list) or not vers:
                raise CorruptSnapshot(f"快照损坏：versions[{eid!r}] 非法")
            built = []
            for i, v in enumerate(vers):
                where = f"versions[{eid!r}][{i}]"
                num = need(v, "number", where, int)
                if num != i:
                    raise CorruptSnapshot(f"快照损坏：{where} 版本号不连续")
                built.append(Version(
                    number=num,
                    body=need(v, "body", where, str),
                    authors=list(need(v, "authors", where, list)),
                    change=need(v, "change", where, str),
                    kind=need(v, "kind", where, str),
                    clock=need(v, "clock", where, int),
                ))
            g._versions[eid] = built

        for eid, revs in revisions.items():
            if eid not in g._entries:
                raise CorruptSnapshot(f"快照损坏：修订属于不存在的条目 {eid!r}")
            if not isinstance(revs, list):
                raise CorruptSnapshot(f"快照损坏：revisions[{eid!r}] 非法")
            built = []
            for i, r in enumerate(revs):
                where = f"revisions[{eid!r}][{i}]"
                built.append(Revision(
                    revision_id=need(r, "revision_id", where, str),
                    entry_id=eid,
                    authors=list(need(r, "authors", where, list)),
                    base_version=need(r, "base_version", where, int),
                    new_version=need(r, "new_version", where, int),
                    changes=list(need(r, "changes", where, list)),
                    kind=need(r, "kind", where, str),
                    clock=need(r, "clock", where, int),
                    conflict_id=r.get("conflict_id"),
                ))
            g._revisions[eid] = built

        for i, e in enumerate(edges):
            if not isinstance(e, list) or len(e) != 2:
                raise CorruptSnapshot(f"快照损坏：edges[{i}] 必须是长度 2 的数组")
            s, t = e
            if s not in g._entries or t not in g._entries:
                raise CorruptSnapshot(f"快照损坏：悬空引用 {s!r} -> {t!r}")
            if s == t:
                raise CorruptSnapshot(f"快照损坏：自引用 {s!r}")
            g._edges.add((s, t))
            g._out[s].add(t)
            g._in[t].add(s)

        # 成环校验
        if g._contains_cycle():
            raise CorruptSnapshot("快照损坏：引用图存在环路")

        for cid, c in conflicts.items():
            where = f"conflicts[{cid!r}]"
            record = ConflictRecord(
                conflict_id=cid,
                entry_id=need(c, "entry_id", where, str),
                base_version=need(c, "base_version", where, int),
                location=need(c, "location", where, int),
                location_kind=need(c, "location_kind", where, str),
                parties=list(need(c, "parties", where, list)),
                rendered=need(c, "rendered", where, str),
                clock=need(c, "clock", where, int),
                resolved_by=c.get("resolved_by"),
            )
            if record.entry_id not in g._entries:
                raise CorruptSnapshot(f"快照损坏：冲突属于不存在的条目 {record.entry_id!r}")
            g._conflicts[cid] = record

        return g

    def _contains_cycle(self) -> bool:
        color: Dict[str, int] = {n: 0 for n in self._entries}  # 0 白 1 灰 2 黑

        def dfs(node: str) -> bool:
            color[node] = 1
            for nxt in self._out[node]:
                if color[nxt] == 1 or (color[nxt] == 0 and dfs(nxt)):
                    return True
            color[node] = 2
            return False

        return any(color[n] == 0 and dfs(n) for n in self._entries)
