"""MVCC 内存数据库内核：快照隔离（Snapshot Isolation）与可见性判断。

核心概念
--------
- 每个键对应一条版本链，版本按 ``commit_ts`` 升序排列，``commit_ts`` 全局单调递增。
- 事务开始时取快照 ``snapshot_ts``（当前已提交的最大 commit_ts），
  之后只能看到 ``commit_ts <= snapshot_ts`` 的版本，以及自己的未提交写入。
- 写写冲突在提交时检测（first-committer-wins）：若快照之后有其他已提交事务
  写过本事务 write_set 中的任一键，本事务 abort 并返回冲突键列表。
- 只读事务（write_set 为空）提交时不做冲突检查，直接 committed。
- 读写混合事务只检查写集合：读集合与其他事务有交集不影响提交，
  这是快照隔离的标准语义（允许写偏斜 write skew），详见 README。

仅使用 Python 标准库。
"""

from __future__ import annotations

import bisect
import json
from dataclasses import dataclass, field
from typing import Any, Optional

# 事务状态
ACTIVE = "active"
COMMITTED = "committed"
ABORTED = "aborted"
_TXN_STATES = (ACTIVE, COMMITTED, ABORTED)

# 持久化文件格式标识，load 时校验，防止误读其它 JSON 文件
STORAGE_FORMAT = "mvcc-snapshot-v1"


class MVCCError(Exception):
    """数据库运行时错误（事务状态非法、键操作非法等）。"""


class StorageFormatError(MVCCError):
    """持久化文件损坏、字段缺失或一致性校验失败。"""


@dataclass
class Version:
    """一个已提交的版本。

    value 为 None 表示删除墓碑（tombstone）。
    """

    commit_ts: int
    value: Optional[str]
    txn_id: str

    @property
    def is_tombstone(self) -> bool:
        """是否为删除墓碑。"""
        return self.value is None


@dataclass
class Transaction:
    """事务元数据。

    snapshot_ts: 事务开始时已提交的最大 commit_ts。
    read_set:    读过的键集合。
    write_set:   写过的键到新值的映射，值为 None 表示删除。
    start_seq:   事务开始顺序号（全局递增，用于确定最老事务等调试信息）。
    """

    txn_id: str
    state: str
    snapshot_ts: int
    start_seq: int
    read_set: set[str] = field(default_factory=set)
    write_set: dict[str, Optional[str]] = field(default_factory=dict)

    @property
    def is_read_only(self) -> bool:
        """是否为只读事务（尚未写入任何键）。"""
        return not self.write_set


@dataclass
class CommitResult:
    """commit 的结果。

    committed 为 False 时表示因写写冲突被 abort，conflicts 为冲突键列表。
    """

    committed: bool
    conflicts: list[str] = field(default_factory=list)
    commit_ts: Optional[int] = None


class MVCCDatabase:
    """基于多版本并发控制的内存键值数据库，提供快照隔离。"""

    def __init__(self) -> None:
        # key -> 版本链，按 commit_ts 升序，无重复 commit_ts
        self._versions: dict[str, list[Version]] = {}
        # txn_id -> 事务
        self._txns: dict[str, Transaction] = {}
        # 已分配的最大 commit_ts（0 表示还没有任何提交）
        self._commit_ts_counter: int = 0
        # 事务开始顺序号计数器
        self._start_seq_counter: int = 0

    # ------------------------------------------------------------------
    # 事务生命周期
    # ------------------------------------------------------------------

    def begin(self, txn_id: str) -> Transaction:
        """开启事务，快照为当前已提交的最大 commit_ts。

        :raises MVCCError: txn_id 为空或已存在。
        """
        if not isinstance(txn_id, str) or not txn_id:
            raise MVCCError("txn_id must be a non-empty string")
        if txn_id in self._txns:
            raise MVCCError(f"duplicate txn_id: {txn_id!r}")
        self._start_seq_counter += 1
        txn = Transaction(
            txn_id=txn_id,
            state=ACTIVE,
            snapshot_ts=self._commit_ts_counter,
            start_seq=self._start_seq_counter,
        )
        self._txns[txn_id] = txn
        return txn

    def get(self, txn_id: str, key: str) -> Optional[str]:
        """在事务快照下读取 key。

        自己未提交的写入对自己可见，优先于版本链；版本链上从新到旧找第一个
        ``commit_ts <= snapshot_ts`` 的版本；墓碑和键不存在都返回 None。

        :raises MVCCError: 事务不存在或已结束。
        """
        txn = self._require_active(txn_id)
        txn.read_set.add(key)
        if key in txn.write_set:
            # 自己的未提交写入（None 表示自己已删除）
            return txn.write_set[key]
        chain = self._versions.get(key)
        if not chain:
            return None
        # 版本链按 commit_ts 升序，从后往前找第一个 <= snapshot_ts 的版本
        idx = bisect.bisect_right(
            [v.commit_ts for v in chain], txn.snapshot_ts
        )
        if idx == 0:
            return None
        return chain[idx - 1].value  # 墓碑时 value 为 None，直接返回

    def put(self, txn_id: str, key: str, value: str) -> None:
        """把 key -> value 记入事务 write_set，提交时才真正写版本。

        :raises MVCCError: 事务不存在/已结束，或 value 不是字符串。
        """
        txn = self._require_active(txn_id)
        if not isinstance(value, str):
            raise MVCCError("value must be a string (use delete for tombstones)")
        txn.write_set[key] = value

    def delete(self, txn_id: str, key: str) -> None:
        """把 key 的删除（墓碑）记入事务 write_set。删除不存在的键合法。"""
        txn = self._require_active(txn_id)
        txn.write_set[key] = None

    def commit(self, txn_id: str) -> CommitResult:
        """提交事务。

        - 只读事务（write_set 为空）：不检查冲突，直接 committed。
        - 读写事务：若 snapshot_ts 之后有其他已提交事务写过 write_set 中
          任一键，则本事务 abort 并返回冲突键列表（first-committer-wins）；
          否则分配新 commit_ts，把 write_set 写成新版本。

        注意：只检查写集合，不检查读集合 —— 读集合与别人重叠不阻塞提交，
        这是快照隔离的语义（写偏斜不会被检测）。
        """
        txn = self._require_active(txn_id)
        if txn.write_set:
            conflicts = sorted(
                key
                for key in txn.write_set
                if self._written_after(key, txn.snapshot_ts)
            )
            if conflicts:
                txn.state = ABORTED
                return CommitResult(committed=False, conflicts=conflicts)
            self._commit_ts_counter += 1
            commit_ts = self._commit_ts_counter
            for key, value in txn.write_set.items():
                chain = self._versions.setdefault(key, [])
                chain.append(Version(commit_ts=commit_ts, value=value, txn_id=txn_id))
            txn.state = COMMITTED
            return CommitResult(committed=True, commit_ts=commit_ts)
        txn.state = COMMITTED
        return CommitResult(committed=True, commit_ts=None)

    def abort(self, txn_id: str) -> None:
        """主动回滚事务，丢弃 write_set（版本从未写入，无需清理）。"""
        txn = self._require_active(txn_id)
        txn.state = ABORTED

    def state(self, txn_id: str) -> dict[str, Any]:
        """返回事务状态信息（不存在则报错）。"""
        txn = self._txns.get(txn_id)
        if txn is None:
            raise MVCCError(f"unknown txn_id: {txn_id!r}")
        return {
            "txn_id": txn.txn_id,
            "state": txn.state,
            "snapshot_ts": txn.snapshot_ts,
            "start_seq": txn.start_seq,
            "read_set": sorted(txn.read_set),
            "write_set": dict(txn.write_set),
        }

    # ------------------------------------------------------------------
    # 垃圾回收
    # ------------------------------------------------------------------

    def gc(self) -> int:
        """回收不再被任何活跃事务需要的旧版本，返回清理的版本数。

        阈值取当前最老 active 事务的 snapshot_ts（无 active 事务时取当前
        最大 commit_ts）。每个键保留：所有 commit_ts > 阈值的版本，加上
        小于等于阈值的最新一个版本（保证阈值快照下仍有可见版本）。
        等于阈值的版本必须保留 —— 最老事务的快照正好能看到它。
        """
        active_snapshots = [
            t.snapshot_ts for t in self._txns.values() if t.state == ACTIVE
        ]
        threshold = (
            min(active_snapshots) if active_snapshots else self._commit_ts_counter
        )
        collected = 0
        for chain in self._versions.values():
            ts_list = [v.commit_ts for v in chain]
            # 小于等于阈值的版本个数；其中最新一个必须保留
            n_visible = bisect.bisect_right(ts_list, threshold)
            n_drop = max(0, n_visible - 1)
            if n_drop:
                del chain[:n_drop]
                collected += n_drop
        return collected

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------

    def save(self, path: str) -> None:
        """把版本链、事务表、计数器写成 JSON 文件。"""
        data = {
            "format": STORAGE_FORMAT,
            "commit_ts_counter": self._commit_ts_counter,
            "start_seq_counter": self._start_seq_counter,
            "versions": {
                key: [
                    {"commit_ts": v.commit_ts, "value": v.value, "txn_id": v.txn_id}
                    for v in chain
                ]
                for key, chain in sorted(self._versions.items())
            },
            "transactions": [
                {
                    "txn_id": t.txn_id,
                    "state": t.state,
                    "snapshot_ts": t.snapshot_ts,
                    "start_seq": t.start_seq,
                    "read_set": sorted(t.read_set),
                    "write_set": t.write_set,
                }
                for t in sorted(
                    self._txns.values(), key=lambda t: t.start_seq
                )
            ],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: str) -> "MVCCDatabase":
        """从 JSON 文件重建数据库，并做一致性校验。

        校验内容：格式标识、字段类型、txn_id 唯一、commit_ts 单调、
        版本链按 commit_ts 严格升序、墓碑不带值（value 只能是字符串或
        null）、版本引用的 txn_id 存在且已提交、active 事务的 snapshot_ts
        不超过 commit_ts 计数器。任何损坏都抛 StorageFormatError，
        不静默吞掉。
        """
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            raise StorageFormatError(f"file not found: {path}") from None
        except json.JSONDecodeError as e:
            raise StorageFormatError(f"invalid JSON in {path}: {e}") from None
        except OSError as e:
            raise StorageFormatError(f"cannot read {path}: {e}") from None

        if not isinstance(data, dict):
            raise StorageFormatError("top-level value must be a JSON object")
        if data.get("format") != STORAGE_FORMAT:
            raise StorageFormatError(
                f"bad or missing format tag, expected {STORAGE_FORMAT!r}"
            )

        commit_ts_counter = cls._checked_int(data, "commit_ts_counter", minimum=0)
        start_seq_counter = cls._checked_int(data, "start_seq_counter", minimum=0)

        # ---- 事务表 ----
        raw_txns = data.get("transactions")
        if not isinstance(raw_txns, list):
            raise StorageFormatError("'transactions' must be a list")
        txns: dict[str, Transaction] = {}
        for i, rt in enumerate(raw_txns):
            where = f"transactions[{i}]"
            if not isinstance(rt, dict):
                raise StorageFormatError(f"{where} must be an object")
            txn_id = rt.get("txn_id")
            if not isinstance(txn_id, str) or not txn_id:
                raise StorageFormatError(f"{where}.txn_id must be a non-empty string")
            if txn_id in txns:
                raise StorageFormatError(f"duplicate txn_id in file: {txn_id!r}")
            state = rt.get("state")
            if state not in _TXN_STATES:
                raise StorageFormatError(
                    f"{where}.state must be one of {_TXN_STATES}, got {state!r}"
                )
            snapshot_ts = cls._checked_int(rt, "snapshot_ts", minimum=0, where=where)
            start_seq = cls._checked_int(rt, "start_seq", minimum=1, where=where)
            read_set_raw = rt.get("read_set")
            if not isinstance(read_set_raw, list) or not all(
                isinstance(k, str) for k in read_set_raw
            ):
                raise StorageFormatError(f"{where}.read_set must be a list of strings")
            write_set_raw = rt.get("write_set")
            if not isinstance(write_set_raw, dict):
                raise StorageFormatError(f"{where}.write_set must be an object")
            write_set: dict[str, Optional[str]] = {}
            for k, v in write_set_raw.items():
                if v is not None and not isinstance(v, str):
                    raise StorageFormatError(
                        f"{where}.write_set[{k!r}] must be a string or null"
                    )
                write_set[k] = v
            if state == ACTIVE and snapshot_ts > commit_ts_counter:
                raise StorageFormatError(
                    f"{where}: active txn snapshot_ts {snapshot_ts} exceeds "
                    f"commit_ts_counter {commit_ts_counter}"
                )
            txns[txn_id] = Transaction(
                txn_id=txn_id,
                state=state,
                snapshot_ts=snapshot_ts,
                start_seq=start_seq,
                read_set=set(read_set_raw),
                write_set=write_set,
            )

        # ---- 版本链 ----
        raw_versions = data.get("versions")
        if not isinstance(raw_versions, dict):
            raise StorageFormatError("'versions' must be an object")
        versions: dict[str, list[Version]] = {}
        max_seen_ts = 0
        for key, chain_raw in raw_versions.items():
            where = f"versions[{key!r}]"
            if not isinstance(chain_raw, list) or not chain_raw:
                raise StorageFormatError(f"{where} must be a non-empty list")
            chain: list[Version] = []
            prev_ts = 0
            for j, rv in enumerate(chain_raw):
                vwhere = f"{where}[{j}]"
                if not isinstance(rv, dict):
                    raise StorageFormatError(f"{vwhere} must be an object")
                commit_ts = cls._checked_int(
                    rv, "commit_ts", minimum=1, where=vwhere
                )
                if commit_ts <= prev_ts:
                    raise StorageFormatError(
                        f"{vwhere}: commit_ts {commit_ts} not strictly greater "
                        f"than previous {prev_ts} (chain must be ascending, "
                        "duplicates not allowed)"
                    )
                if "value" not in rv:
                    raise StorageFormatError(f"{vwhere}.value is missing")
                value = rv["value"]
                if value is not None and not isinstance(value, str):
                    raise StorageFormatError(
                        f"{vwhere}.value must be a string or null (tombstone)"
                    )
                vtxn = rv.get("txn_id")
                if not isinstance(vtxn, str) or not vtxn:
                    raise StorageFormatError(
                        f"{vwhere}.txn_id must be a non-empty string"
                    )
                producer = txns.get(vtxn)
                if producer is None:
                    raise StorageFormatError(
                        f"{vwhere}: version references unknown txn_id {vtxn!r}"
                    )
                if producer.state != COMMITTED:
                    raise StorageFormatError(
                        f"{vwhere}: version produced by non-committed txn {vtxn!r}"
                    )
                chain.append(Version(commit_ts=commit_ts, value=value, txn_id=vtxn))
                prev_ts = commit_ts
                max_seen_ts = max(max_seen_ts, commit_ts)
            versions[key] = chain

        if max_seen_ts > commit_ts_counter:
            raise StorageFormatError(
                f"commit_ts_counter {commit_ts_counter} is behind the max "
                f"version commit_ts {max_seen_ts} (counter must be monotone)"
            )

        db = cls()
        db._versions = versions
        db._txns = txns
        db._commit_ts_counter = commit_ts_counter
        db._start_seq_counter = start_seq_counter
        return db

    # ------------------------------------------------------------------
    # 调试 / CLI 辅助
    # ------------------------------------------------------------------

    def dump(self) -> dict[str, Any]:
        """导出完整内部状态（版本链 + 事务表 + 计数器），用于调试和 CLI。"""
        return {
            "commit_ts_counter": self._commit_ts_counter,
            "start_seq_counter": self._start_seq_counter,
            "versions": {
                key: [
                    {"commit_ts": v.commit_ts, "value": v.value, "txn_id": v.txn_id}
                    for v in chain
                ]
                for key, chain in sorted(self._versions.items())
            },
            "transactions": [
                self.state(t.txn_id)
                for t in sorted(self._txns.values(), key=lambda t: t.start_seq)
            ],
        }

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    def _require_active(self, txn_id: str) -> Transaction:
        """取事务并要求其处于 active 状态，否则报错。"""
        txn = self._txns.get(txn_id)
        if txn is None:
            raise MVCCError(f"unknown txn_id: {txn_id!r}")
        if txn.state != ACTIVE:
            raise MVCCError(
                f"txn {txn_id!r} is {txn.state}, only active txns allow this operation"
            )
        return txn

    def _written_after(self, key: str, snapshot_ts: int) -> bool:
        """key 是否在 snapshot_ts 之后被其他已提交事务写过。

        版本只在 commit 时写入且 commit_ts 全局递增，因此链尾版本的
        commit_ts > snapshot_ts 当且仅当存在这样的提交。
        """
        chain = self._versions.get(key)
        return bool(chain) and chain[-1].commit_ts > snapshot_ts

    @staticmethod
    def _checked_int(
        obj: dict[str, Any], field_name: str, minimum: int, where: str = "top-level"
    ) -> int:
        """从 JSON 对象取整数字段并校验下界，缺失或类型错误抛 StorageFormatError。"""
        value = obj.get(field_name)
        # bool 是 int 的子类，显式排除
        if not isinstance(value, int) or isinstance(value, bool):
            raise StorageFormatError(
                f"{where}.{field_name} must be an integer, got {value!r}"
            )
        if value < minimum:
            raise StorageFormatError(
                f"{where}.{field_name} must be >= {minimum}, got {value}"
            )
        return value
