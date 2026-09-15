"""内核门面 :class:`Kernel`：把版本登记、解析、迁移、差异、查询、
导入导出组合成一个有状态、线程外可推理的归档内核。

状态分三部分：

- ``registry``：版本链与字段规则（只增不改，保证旧文件永远可识别）；
- ``records``：已登记数据，按记录 id 存放数据、版本与解析结果；
- ``migrations``：迁移记录，含迁移前快照，可用于精确回滚。

迁移与导入都遵循“先在副本上完成、全部成功后再替换状态”的原则：
迁移失败时记录恢复到迁移前的版本与数据，导入失败时整个内核保持原状。
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

from .diff import data_diff, version_diff
from .errors import (
    BundleError,
    EvoKernelError,
    MigrationError,
    ParseError,
    VersionError,
)
from .migration import MigrationResult, migrate
from .parser import ParseResult, parse
from .paths import canonical_bytes
from .persistence import (
    build_bundle,
    fingerprint,
    loads as bundle_loads,
    restore_from_bundle,
)
from .rules import FieldRule
from .versions import Transform, Version, VersionRegistry

ENVELOPE_VERSION_KEY = "version"
ENVELOPE_DATA_KEY = "data"


class Kernel:
    """格式演进与兼容读取内核。"""

    def __init__(self) -> None:
        self.registry = VersionRegistry()
        self._records: Dict[str, Dict[str, Any]] = {}
        self._migrations: List[Dict[str, Any]] = []

    # ---- 版本登记（需求 1、2） -----------------------------------------

    def register_version(
        self,
        version_id: str,
        fields: List[Any],
        parent: Optional[str] = None,
        description: str = "",
        transform: Optional[Transform] = None,
    ) -> Version:
        return self.registry.register(
            version_id=version_id,
            fields=fields,
            parent=parent,
            description=description,
            transform=transform,
        )

    def versions(self) -> List[str]:
        return self.registry.versions()

    def version_chain(self, version_id: str) -> List[str]:
        return self.registry.chain(version_id)

    # ---- 解析（需求 3、4） ---------------------------------------------

    def parse(self, version_id: str, raw: Any) -> ParseResult:
        """按指定版本规则解析内存数据，不修改内核状态。"""
        return parse(self.registry.get(version_id), raw)

    def read_envelope(self, envelope: Any) -> ParseResult:
        """读取带版本标记的数据 ``{"version": v, "data": {...}}``。

        失败时抛 :class:`ParseError`（版本不存在抛 :class:`VersionError`）。
        """
        if not isinstance(envelope, dict):
            raise EvoKernelError(
                "带版本数据必须是 {'version', 'data'} 对象，"
                f"实际为 {type(envelope).__name__}"
            )
        extra = set(envelope) - {ENVELOPE_VERSION_KEY, ENVELOPE_DATA_KEY}
        if extra:
            raise EvoKernelError(f"带版本数据存在未知键: {sorted(extra)}")
        if ENVELOPE_VERSION_KEY not in envelope:
            raise EvoKernelError("带版本数据缺少 version 标记")
        version_id = envelope[ENVELOPE_VERSION_KEY]
        if not self.registry.has(version_id):
            raise VersionError(f"数据标记的版本 {version_id!r} 未登记，无法识别")
        result = self.parse(version_id, envelope.get(ENVELOPE_DATA_KEY))
        return result.require_ok()

    def put_record(self, record_id: str, version_id: str, raw: Any) -> ParseResult:
        """登记一条数据：解析成功才入库，失败抛错且内核状态不变。"""
        result = self.parse(version_id, raw)
        if not result.ok:
            raise ParseError(version_id, result.errors)
        self._records[record_id] = {
            "record_id": record_id,
            "version_id": version_id,
            "data": copy.deepcopy(result.data),
            "parse_result": self._parse_result_dict(result),
        }
        return result

    def get_record(self, record_id: str) -> Dict[str, Any]:
        self._require_record(record_id)
        return copy.deepcopy(self._records[record_id])

    def list_records(self) -> List[str]:
        return sorted(self._records)

    def query_parse(self, version_id: str, raw: Any) -> ParseResult:
        """查询任意数据在任意版本下的解析结果（不入库、不抛错，读 ``.ok``）。"""
        return self.parse(version_id, raw)

    @staticmethod
    def _parse_result_dict(result: ParseResult) -> Dict[str, Any]:
        d = result.to_dict()
        return {
            "ok": d["ok"],
            "data": d["data"],
            "unknown": d["unknown"],
            "defaults_applied": d["defaults_applied"],
            "errors": d["errors"],
        }

    # ---- 迁移与回滚（需求 5） -----------------------------------------

    def migration_path(self, source_version: str, target_version: str) -> List[str]:
        return self.registry.common_chain(source_version, target_version)

    def plan_migration(self, source_version: str, target_version: str) -> Dict[str, Any]:
        """只规划不执行：返回逐版本路径及每步的字段增删。"""
        path = self.migration_path(source_version, target_version)
        steps = []
        for a, b in zip(path, path[1:]):
            diff = version_diff(self.registry, a, b)["diffs"]
            steps.append(
                {
                    "from_version": a,
                    "to_version": b,
                    "fields_added": [
                        d["path"] for d in diff if d["kind"] == "added"
                    ],
                    "fields_removed": [
                        d["path"] for d in diff if d["kind"] == "removed"
                    ],
                }
            )
        return {"path": path, "steps": steps}

    def migrate_record(self, record_id: str, target_version: str) -> MigrationResult:
        """把已登记记录迁移到目标版本。

        - 成功：更新记录版本与数据，追加迁移记录；
        - 失败：记录恢复到迁移前的版本与数据（回滚），抛出 MigrationError。
        """
        self._require_record(record_id)
        record = self._records[record_id]
        source_version = record["version_id"]

        # 状态快照（记录本身 + 迁移日志），失败时整体还原。
        snapshot = copy.deepcopy((self._records, self._migrations))
        try:
            result = migrate(
                self.registry, source_version, target_version, record["data"]
            )
        except EvoKernelError:
            self._records, self._migrations = snapshot
            raise

        migration_id = self._next_migration_id(
            record_id, source_version, target_version, result.data
        )
        entry = {
            "migration_id": migration_id,
            "record_id": record_id,
            "source_version": source_version,
            "target_version": target_version,
            "result": result.to_dict(),
            "before": {
                "version_id": source_version,
                "data": copy.deepcopy(record["data"]),
            },
            "status": "applied",
            "fingerprint": fingerprint(result.data),
        }
        record["version_id"] = target_version
        record["data"] = copy.deepcopy(result.data)
        record["parse_result"] = self._parse_result_dict(
            self.parse(target_version, result.data)
        )
        self._migrations.append(entry)
        return result

    def revert_migration(self, record_id: str, migration_id: str) -> Dict[str, Any]:
        """按迁移记录中保存的快照精确回滚一次已完成的迁移。

        只允许回滚该记录**最后一次**迁移（必须按逆序回滚）；回滚后数据
        与版本逐字节恢复到迁移前，迁移条目标记为 ``reverted``（不删除日志）。
        """
        self._require_record(record_id)
        applied = [
            m for m in self._migrations
            if m["record_id"] == record_id and m["status"] == "applied"
        ]
        if not applied:
            raise MigrationError(f"记录 {record_id!r} 没有可回滚的已应用迁移")
        latest = applied[-1]
        if latest["migration_id"] != migration_id:
            raise MigrationError(
                f"只能按逆序回滚：记录 {record_id!r} 当前最后一次迁移是 "
                f"{latest['migration_id']!r}，不能先回滚 {migration_id!r}"
            )
        record = self._records[record_id]
        if record["version_id"] != latest["target_version"]:
            raise MigrationError(
                f"记录当前版本 {record['version_id']!r} 与迁移目标 "
                f"{latest['target_version']!r} 不一致，拒绝回滚"
            )
        snapshot = copy.deepcopy((self._records, self._migrations))
        try:
            before = latest["before"]
            record["version_id"] = before["version_id"]
            record["data"] = copy.deepcopy(before["data"])
            record["parse_result"] = self._parse_result_dict(
                self.parse(before["version_id"], before["data"])
            )
            latest["status"] = "reverted"
        except EvoKernelError:
            self._records, self._migrations = snapshot
            raise
        return copy.deepcopy(latest)

    def list_migrations(self, record_id: Optional[str] = None) -> List[Dict[str, Any]]:
        entries = [
            copy.deepcopy(m)
            for m in self._migrations
            if record_id is None or m["record_id"] == record_id
        ]
        entries.sort(key=lambda m: (m["record_id"], m["migration_id"]))
        return entries

    def _next_migration_id(
        self, record_id: str, source: str, target: str, data: Dict[str, Any]
    ) -> str:
        fp8 = fingerprint(
            {"record_id": record_id, "from": source, "to": target, "data": data}
        )[:8]
        base = f"mig:{record_id}:{source}->{target}:{fp8}"
        # 已回滚的历史条目不占用 id：回滚后用同样数据重新迁移应得到同样的 id。
        active = {m["migration_id"] for m in self._migrations if m["status"] != "reverted"}
        if base not in active:
            return base
        i = 2
        while f"{base}#{i}" in active:
            i += 1
        return f"{base}#{i}"

    # ---- 差异（需求 6） ------------------------------------------------

    def version_diff(self, version_a: str, version_b: str) -> Dict[str, Any]:
        return version_diff(self.registry, version_a, version_b)

    def data_diff(self, version_a: str, version_b: str, raw: Any) -> Dict[str, Any]:
        return data_diff(self.registry, version_a, version_b, raw)

    # ---- 查询（需求 7） ------------------------------------------------

    def field_rule(self, version_id: str, path: str) -> Dict[str, Any]:
        rule: FieldRule = self.registry.field_rule(version_id, path)
        return rule.to_dict()

    def field_lifecycle(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        records = self.registry.field_lifecycle()
        if path is not None:
            records = [r for r in records if r["path"] == path]
        return [
            {
                "path": r["path"],
                "introduced": r["introduced"],
                "deprecated": r["deprecated"],
            }
            for r in records
        ]

    # ---- 导入导出（需求 8） --------------------------------------------

    def export_bundle(self) -> str:
        """导出版本链、规则、数据、迁移记录与解析结果为 JSON 文本。"""
        bundle = build_bundle(
            self.registry.snapshot(),
            [self._records[r] for r in self.list_records()],
            self.list_migrations(),
        )
        from .persistence import dumps

        return dumps(bundle)

    def import_bundle(self, text: str, transforms: Optional[Dict[str, Transform]] = None) -> None:
        """从导出包重建全部状态。

        :param transforms: transform 是代码无法序列化；导入后若仍需向挂有
            transform 的版本迁移，需在此按版本 id 重新提供。
        :raises BundleError: 包损坏 / 字段缺失 / 校验和不一致 / 结果不自洽。
            失败时当前内核状态保持不变。
        """
        bundle = bundle_loads(text)  # 结构 + 校验和校验，失败抛 BundleError
        registry_snapshot, records, migrations = restore_from_bundle(bundle)

        # 在全新的临时内核上重建，任何一步失败都不影响 self。
        tmp = Kernel()
        try:
            tmp.registry.restore(registry_snapshot, transforms=transforms or {})
            for r in records:
                # 用包内规则重新解析，解析结果必须与包内记录逐字节一致。
                reparsed = tmp.parse(r["version_id"], r["data"])
                if not reparsed.ok:
                    raise BundleError(
                        f"records/{r['record_id']} 无法按其版本规则重新解析："
                        f"{reparsed.errors[0]}"
                    )
                stored = r["parse_result"]
                if canonical_bytes(stored.get("data")) != canonical_bytes(reparsed.data):
                    raise BundleError(
                        f"records/{r['record_id']} 的解析结果与数据不自洽，导出包可能已损坏"
                    )
                tmp._records[r["record_id"]] = copy.deepcopy(r)
            for m in migrations:
                tmp._migrations.append(copy.deepcopy(m))
        except BundleError:
            raise
        except EvoKernelError as exc:
            raise BundleError(f"导出包重建失败：{exc}") from exc

        # 全部成功后原子替换。
        self.registry = tmp.registry
        self._records = tmp._records
        self._migrations = tmp._migrations

    # ---- 内部工具 -------------------------------------------------------

    def _require_record(self, record_id: str) -> None:
        if record_id not in self._records:
            raise EvoKernelError(f"记录 {record_id!r} 不存在")
