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
        # 权威拆分事件账：[{parent, children, point_version, clock}]，按发生次序
        self._splits: List[dict] = []
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

    def _is_archived(self, entry_id: str) -> bool:
        return self._entries[entry_id].get("status", "active") == "split"

    def _require_active(self, entry_id: str) -> None:
        self._require(entry_id)
        if self._is_archived(entry_id):
            targets = self._entries[entry_id].get("split_into", [])
            raise GraphError(
                f"条目 {entry_id!r} 已拆分归档（拆分至 {targets}），只读不可再修改；"
                f"请对其分片操作"
            )

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
        self._entries[entry_id] = {
            "topic": topic,
            "status": "active",       # active / split
            "split_into": [],         # 拆分归档时记录分片
        }
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
            "status": self._entries[entry_id].get("status", "active"),
            "split_into": list(self._entries[entry_id].get("split_into", [])),
            "split_from": self._entries[entry_id].get("split_from"),
            "split_from_version": self._entries[entry_id].get("split_from_version"),
        }

    # ---- 引用 ----

    def add_reference(self, source: str, target: str) -> None:
        """建立 ``source -> target`` 引用；目标必须存在且不允许成环。"""
        self._require_active(source)
        self._require_active(target)
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
        self._require_active(entry_id)
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
        self._require_active(entry_id)
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
        self._require_active(entry_id)
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

        已拆分归档条目不可删除（它是分片的历史凭证）；如需彻底清除，请先删除
        其全部分片后另行处理。
        """
        self._require_active(entry_id)
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
        """把一个活跃条目拆分为多个新条目。

        归属规则（确定性）：

        * **旧条目不删除**，而是转为只读的"已拆分归档"：其完整版本序列与修订链
          原样保留、冻结在拆分点，仍可通过 :meth:`revision_chain` /
          :meth:`diff_versions` 查询；``split_into`` 记录分片。
        * 锚定旧条目历史版本/段落的**冲突记录随旧条目归档保留**（其 ``entry_id``
          始终指向一个存在的条目，不会悬空）。新分片干净起步，不携带旧冲突。
        * 每个**新分片从拆分点以自己的 v0 开始**独立计版本，元数据记录
          ``split_from`` 来源。
        * 仅拆除并重定向与旧条目相关的引用边（默认入引用->第一个分片、
          出引用由第一个分片继承），旧条目不再是任何边的端点；结果无悬空引用。

        ``parts`` 为 ``[{id, topic, body, author}]``（顺序即结果顺序）。
        """
        self._require_active(old_id)
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
        split_point = self._current_number(old_id)

        tick = self._tick()

        # 1) 仅拆除与旧条目相关的边（受影响部分）；旧条目转归档，保留历史与冲突
        for s, t in list(self._edges):
            if s == old_id or t == old_id:
                self._drop_edge(s, t)
        meta = self._entries[old_id]
        meta["status"] = "split"
        meta["split_into"] = list(new_ids)
        meta["split_clock"] = tick
        meta["split_point_version"] = split_point
        # 邻接置空：旧条目不再是任何引用边的端点（key 保留以便只读查询）
        self._out[old_id] = set()
        self._in[old_id] = set()
        # 权威拆分事件：导入旧格式快照时据此推断并回填归档状态
        self._splits.append({
            "parent": old_id,
            "children": list(new_ids),
            "point_version": split_point,
            "clock": tick,
        })

        # 2) 建立分片：各自从拆分点以 v0 开始自己的版本序列
        for p in parts:
            self._entries[p["id"]] = {
                "topic": p["topic"],
                "status": "active",
                "split_into": [],
                "split_from": old_id,
                "split_from_version": split_point,
            }
            self._versions[p["id"]] = [
                Version(
                    0, p["body"], [p.get("author", "split")],
                    f"由 {old_id!r} v{split_point} 拆分",
                    kind="create", clock=tick,
                )
            ]
            self._revisions[p["id"]] = []
            self._out[p["id"]] = set()
            self._in[p["id"]] = set()

        # 3) 把旧条目的引用关系收敛到指定分片
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
            "archived": old_id,
            "split_point_version": split_point,
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

    def list_entries(self, include_archived: bool = False) -> List[str]:
        """返回活跃条目标识（字典序）。

        归档（已拆分）条目默认不列；需要连同归档一起枚举时传
        ``include_archived=True``。归档条目仍可按 id 做只读查询。
        """
        return sorted(
            eid for eid, meta in self._entries.items()
            if include_archived or meta.get("status", "active") != "split"
        )

    # ---- 序列化（供 persistence 使用）----

    def to_dict(self) -> dict:
        return {
            "schema": SCHEMA_VERSION,
            "clock": self.clock,
            "seq": self._seq,
            "entries": {
                eid: {
                    "topic": meta["topic"],
                    "status": meta.get("status", "active"),
                    "split_into": list(meta.get("split_into", [])),
                    "split_from": meta.get("split_from"),
                    "split_from_version": meta.get("split_from_version"),
                    "split_clock": meta.get("split_clock"),
                }
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
            "splits": [dict(ev) for ev in self._splits],
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
        # splits 为后增字段：旧快照可能没有，缺省视为空，稍后据其它线索推断
        splits_raw = data.get("splits", [])
        if not isinstance(splits_raw, list):
            raise CorruptSnapshot("快照损坏：splits 必须是数组")

        # 第一遍：原样读入条目（旧快照可能没有任何归档字段）。
        for eid, meta in entries.items():
            if not isinstance(meta, dict) or "topic" not in meta:
                raise CorruptSnapshot(f"快照损坏：entries[{eid!r}] 缺少 topic")
            if not isinstance(meta["topic"], str):
                raise CorruptSnapshot(f"快照损坏：entries[{eid!r}].topic 必须是字符串")
            if "status" in meta and meta["status"] not in ("active", "split"):
                raise CorruptSnapshot(
                    f"快照损坏：entries[{eid!r}] 非法状态 {meta['status']!r}"
                )
            split_into = meta.get("split_into", [])
            if not isinstance(split_into, list):
                raise CorruptSnapshot(
                    f"快照损坏：entries[{eid!r}].split_into 必须是数组"
                )
            g._entries[eid] = {
                "topic": meta["topic"],
                "status": meta.get("status", "active"),
                "split_into": list(split_into),
                "split_from": meta.get("split_from"),
                "split_from_version": meta.get("split_from_version"),
                "split_clock": meta.get("split_clock"),
                # 临时标记字段是否显式给出（区分旧快照缺失与显式 active），推断后清除
                "_status_explicit": "status" in meta,
                "_split_from_explicit": "split_from" in meta,
                "_split_from_version_explicit": "split_from_version" in meta,
                "_split_into_explicit": "split_into" in meta,
            }
            g._out[eid] = set()
            g._in[eid] = set()

        # 解析权威拆分事件账（字段严格校验）
        for i, ev in enumerate(splits_raw):
            where = f"splits[{i}]"
            if not isinstance(ev, dict):
                raise CorruptSnapshot(f"快照损坏：{where} 必须是对象")
            parent = need(ev, "parent", where, str)
            children = need(ev, "children", where, list)
            point = need(ev, "point_version", where, int)
            clock = need(ev, "clock", where, int)
            if not children or not all(isinstance(c, str) for c in children):
                raise CorruptSnapshot(f"快照损坏：{where}.children 非法")
            if len(set(children)) != len(children):
                raise CorruptSnapshot(f"快照损坏：{where}.children 有重复分片")
            if parent not in g._entries:
                raise CorruptSnapshot(
                    f"快照损坏：{where} 的来源条目 {parent!r} 不存在"
                )
            for c in children:
                if c not in g._entries:
                    raise CorruptSnapshot(
                        f"快照损坏：{where} 拆分到不存在的条目 {c!r}"
                    )
            g._splits.append({
                "parent": parent,
                "children": list(children),
                "point_version": point,
                "clock": clock,
            })

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

        # 第二遍：解析完版本后，按拆分事件账 + 子分片回指推断并回填归档状态
        # （兼容没有归档字段的旧快照），必须在边的归档校验之前完成。
        cls._infer_archive_state(g)

        for i, e in enumerate(edges):
            if not isinstance(e, list) or len(e) != 2:
                raise CorruptSnapshot(f"快照损坏：edges[{i}] 必须是长度 2 的数组")
            s, t = e
            if s not in g._entries or t not in g._entries:
                raise CorruptSnapshot(f"快照损坏：悬空引用 {s!r} -> {t!r}")
            if s == t:
                raise CorruptSnapshot(f"快照损坏：自引用 {s!r}")
            # 已拆分归档条目不再是任何引用边的端点
            if g._is_archived(s) or g._is_archived(t):
                raise CorruptSnapshot(
                    f"快照损坏：引用边触及已拆分归档条目 {s!r} -> {t!r}"
                )
            g._edges.add((s, t))
            g._out[s].add(t)
            g._in[t].add(s)

        # 成环校验
        if g._contains_cycle():
            raise CorruptSnapshot("快照损坏：引用图存在环路")

        # 拆分归档的跨条目一致性校验
        for eid, meta in g._entries.items():
            if meta.get("status") == "split":
                targets = meta.get("split_into", [])
                if not targets:
                    raise CorruptSnapshot(
                        f"快照损坏：归档条目 {eid!r} 缺少 split_into 分片"
                    )
                if g._out[eid] or g._in[eid]:
                    raise CorruptSnapshot(
                        f"快照损坏：归档条目 {eid!r} 仍持有引用边"
                    )
                parent_point = len(g._versions[eid]) - 1
                for t in targets:
                    if t not in g._entries:
                        raise CorruptSnapshot(
                            f"快照损坏：{eid!r} 拆分到不存在的条目 {t!r}"
                        )
                    child = g._entries[t]
                    if child.get("split_from") != eid:
                        raise CorruptSnapshot(
                            f"快照损坏：分片 {t!r} 未回指其来源 {eid!r}"
                        )
                    if child.get("split_from_version") != parent_point:
                        raise CorruptSnapshot(
                            f"快照损坏：分片 {t!r} 的拆分点版本与 {eid!r} 不一致"
                        )
            sf = meta.get("split_from")
            if sf is not None:
                if sf not in g._entries:
                    raise CorruptSnapshot(
                        f"快照损坏：{eid!r} 的来源条目 {sf!r} 不存在"
                    )
                if eid not in g._entries[sf].get("split_into", []):
                    raise CorruptSnapshot(
                        f"快照损坏：{sf!r} 的分片清单未包含 {eid!r}"
                    )

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

    @classmethod
    def _infer_archive_state(cls, g: "ExperienceGraph") -> None:
        """合并三类证据推断并回填拆分归档状态（兼容没有归档字段的旧快照）。

        证据来源：权威拆分事件账 ``splits``、父条目自带的 ``status/split_into``、
        子分片的 ``split_from`` 回指。三者必须一致；任一来源/目标缺失或互相矛盾，
        以及回指指向不存在条目，都按 :class:`CorruptSnapshot` 拒绝。回填后清除
        临时显式性标记。
        """
        metas = g._entries

        def corrupt(msg: str):
            raise CorruptSnapshot(f"快照损坏：{msg}")

        # parent -> 子分片（保持权威事件顺序）；child -> (parent, point)
        parent_children: Dict[str, List[str]] = {}
        authoritative_parents: Set[str] = set()
        child_parent: Dict[str, tuple] = {}

        def declare_parent(parent: str, children, where: str,
                           authoritative: bool = True) -> None:
            kids = list(children)
            for c in kids:
                if c not in metas:
                    corrupt(f"{where} 拆分到不存在的条目 {c!r}")
            existing = parent_children.get(parent)
            if existing is not None and (
                set(existing) != set(kids) or len(existing) != len(kids)
            ):
                corrupt(f"条目 {parent!r} 的分片归属在快照中不一致："
                        f"{existing} vs {kids}")
            if existing is None:
                parent_children[parent] = kids
            elif authoritative:
                parent_children[parent] = kids     # 权威声明覆盖重建顺序
            if authoritative:
                authoritative_parents.add(parent)

        def declare_child(child: str, parent: str, point, where: str) -> None:
            if parent not in metas:
                corrupt(f"{where} 的来源条目 {parent!r} 不存在")
            prev = child_parent.get(child)
            if prev is not None and (prev[0] != parent or
                                     (point is not None and prev[1] is not None
                                      and point != prev[1])):
                corrupt(f"分片 {child!r} 的来源在快照中不一致：{prev} vs "
                        f"({parent!r}, {point})")
            if prev is None:
                child_parent[child] = (parent, point)

        # 证据一：权威拆分事件账
        for i, ev in enumerate(g._splits):
            where = f"splits[{i}]"
            if ev["parent"] not in metas:
                corrupt(f"{where} 的来源条目 {ev['parent']!r} 不存在")
            declare_parent(ev["parent"], ev["children"], where)
            for c in ev["children"]:
                declare_child(c, ev["parent"], ev["point_version"], where)

        # 证据二/三：条目自带字段（旧快照可能只有其中一部分）
        for eid, meta in metas.items():
            status_explicit = meta.get("_status_explicit")
            into_explicit = meta.get("_split_into_explicit")
            from_explicit = meta.get("_split_from_explicit")

            if status_explicit and meta["status"] == "split":
                if not meta.get("split_into"):
                    corrupt(f"归档条目 {eid!r} 缺少 split_into 分片")
                declare_parent(eid, meta["split_into"], f"entries[{eid!r}]")
            elif status_explicit and meta["status"] == "active" and into_explicit \
                    and meta.get("split_into"):
                corrupt(f"条目 {eid!r} 标记为 active 却声明了 split_into 分片")
            elif into_explicit and meta.get("split_into"):
                # 状态字段缺失但给了分片清单：据此推断为归档
                declare_parent(eid, meta["split_into"], f"entries[{eid!r}]")

            if from_explicit:
                parent = meta.get("split_from")
                if parent is not None:
                    point = meta.get("split_from_version")
                    declare_child(eid, parent, point, f"entries[{eid!r}]")

        # 子分片回指反过来也确认父条目应归档
        for child, (parent, _point) in child_parent.items():
            if parent not in parent_children:
                # 旧快照只有子片回指、没有任何父侧记录：以回指集合重建（非权威）
                parent_children[parent] = [child]
            elif parent in authoritative_parents:
                # 父侧已权威声明：回指分片必须在其清单内，否则归属不一致
                if child not in parent_children[parent]:
                    corrupt(f"条目 {parent!r} 的分片清单未包含回指分片 {child!r}")
            elif child not in parent_children[parent]:
                # 同为回指重建：补入（最终统一排序确定化）
                parent_children[parent].append(child)

        # 回填父条目归档状态
        for parent, kids in parent_children.items():
            if parent not in metas:
                corrupt(f"归档条目 {parent!r} 不存在")
            if not kids:
                corrupt(f"归档条目 {parent!r} 缺少分片")
            meta = metas[parent]
            if meta.get("_status_explicit") and meta["status"] == "active":
                corrupt(f"条目 {parent!r} 标记为 active 却被拆分记录指为归档源")
            # 权威来源保留声明顺序；纯由回指重建时按字典序确定化
            ordered = list(kids) if parent in authoritative_parents else sorted(kids)
            meta["status"] = "split"
            meta["split_into"] = ordered

        # 回填子分片来源指针
        for child, (parent, point) in child_parent.items():
            meta = metas[child]
            parent_point = len(g._versions[parent]) - 1
            if meta.get("_status_explicit") and meta["status"] == "split":
                corrupt(f"分片 {child!r} 自身被标记为归档，不能再作为分片")
            if point is None:
                point = parent_point
            if point != parent_point:
                corrupt(f"分片 {child!r} 的拆分点版本 {point} 与来源 "
                        f"{parent!r} 的末版本 v{parent_point} 不一致")
            meta["status"] = "active"
            meta["split_into"] = []
            meta["split_from"] = parent
            meta["split_from_version"] = point

        # 回填父条目上缺失的拆分点版本（仅供展示/校验，权威值取子片回指）
        for parent, kids in parent_children.items():
            meta = metas[parent]
            points = {metas[c].get("split_from_version") for c in kids}
            points.discard(None)
            if points:
                meta.setdefault("split_point_version", next(iter(points)))

        # 旧快照没有 splits 事件账：据推断结果补齐，使重导出即为当前规范格式。
        ledger_parents = {ev["parent"]: ev for ev in g._splits}
        for parent in sorted(parent_children):
            kids = parent_children[parent]
            parent_meta = metas[parent]
            if parent in ledger_parents:
                # 以推断出的规范分片集合校正事件账
                ledger_parents[parent]["children"] = list(kids)
                resolved_clock = ledger_parents[parent]["clock"]
            else:
                point = len(g._versions[parent]) - 1
                resolved_clock = parent_meta.get("split_clock")
                if resolved_clock is None:
                    resolved_clock = g._versions[kids[0]][0].clock
                g._splits.append({
                    "parent": parent,
                    "children": list(kids),
                    "point_version": point,
                    "clock": resolved_clock,
                })
            # 回填父条目缺失的拆分时钟（消除旧/新格式的非功能性差异）
            if parent_meta.get("split_clock") is None:
                parent_meta["split_clock"] = resolved_clock
        g._splits.sort(key=lambda ev: (ev["clock"], ev["parent"]))

        # 清除临时标记
        for meta in metas.values():
            for key in ("_status_explicit", "_split_from_explicit",
                        "_split_from_version_explicit", "_split_into_explicit"):
                meta.pop(key, None)
