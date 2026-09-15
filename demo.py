#!/usr/bin/env python3
"""离线端到端演示：覆盖 8 条需求。

运行：python demo.py
只使用标准库，不访问网络与文件系统之外的任何外部资源。
"""

from __future__ import annotations

import json
import sys

from evo_kernel import (
    BundleError,
    FieldRule,
    Kernel,
    MigrationError,
    ParseError,
    RuleDefinitionError,
    Transform,
    VersionError,
)
from evo_kernel.persistence import _checksum

from tests.scenario import build_kernel, transform_v3


def section(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def show(label: str, value: object) -> None:
    print(f"{label}:")
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


def main() -> int:
    section("需求 1：版本登记形成无环演进链 v1 -> v2 -> v3")
    k = build_kernel()
    print("已登记版本（稳定顺序）:", k.versions())
    print("v3 的版本链:", k.version_chain("v3"))
    try:
        k.register_version("v2b", [], parent="v1")
    except VersionError as exc:
        print("分叉被拒绝:", exc)

    section("需求 2：字段规则——嵌套、枚举、默认值；非法规则带位置拒绝")
    nested = FieldRule.from_dict(
        {
            "name": "addr",
            "type": "object",
            "fields": [{"name": "city", "type": "string", "required": True}],
        }
    )
    print("合法嵌套规则:", nested.to_dict())
    for bad_rule in [
        {"name": "f", "type": "datetime"},                # 未知类型
        {"name": "f", "type": "string", "enum": []},      # 空枚举
        {"name": "f", "type": "integer", "required": True, "default": 0},  # 互斥
    ]:
        try:
            FieldRule.from_dict(bad_rule)
        except RuleDefinitionError as exc:
            print(f"拒绝 {bad_rule}: {exc}")

    section("需求 3：按版本标记解析，错误带 路径/期望/实际")
    envelope = {
        "version": "v1",
        "data": {"id": "abc", "status": "archived", "extra": [1, 2]},
    }
    probe = k.query_parse("v1", envelope["data"])
    print("解析是否通过:", probe.ok)
    for e in probe.errors:
        print(f"  - 路径={e.path!r} 原因={e.reason} 期望={e.expected!r} 实际={e.actual!r}")
    try:
        k.read_envelope(envelope)
    except ParseError as exc:
        print("read_envelope 聚合报错:", str(exc)[:120], "...")

    section("需求 4：缺字段补默认值；新版本字段在旧文件里标记为未知（不丢弃）")
    legacy = {"id": 1, "name": "报告-2026", "status": "draft", "future_only": {"k": "v"}}
    res_v1 = k.read_envelope({"version": "v1", "data": legacy})
    print("v1 解析数据:", res_v1.data)
    print("补齐默认值路径:", res_v1.defaults_applied)
    print("未知字段（原样保留）:", res_v1.unknown)

    section("需求 5：迁移 v1 -> v3；与直接按目标版本解析一致；失败回滚；可复现")
    k.put_record("doc-1", "v1", {"id": 1, "name": "报告-2026",
                                 "status": "published", "tags": ["财务", "年报"]})
    plan = k.plan_migration("v1", "v3")
    show("迁移计划", plan)
    result = k.migrate_record("doc-1", "v3")
    show("迁移结果（改名/枚举映射/嵌套重排）", result.data)
    print("与直接按目标版本解析一致:", result.consistent_with_direct_parse)

    # 失败回滚：给 v3 换一个产出非法枚举的 transform
    k_bad = Kernel()
    k_bad.register_version("v1", [
        {"name": "id", "type": "integer", "required": True},
        {"name": "s", "type": "string", "required": True},
    ])
    k_bad.register_version(
        "v2",
        [
            {"name": "id", "type": "integer", "required": True},
            {"name": "s", "type": "string", "required": True, "enum": ["ok"]},
        ],
        parent="v1",
        transform=Transform("产出非法枚举", lambda d: d.update(s="boom")),
    )
    k_bad.put_record("r", "v1", {"id": 1, "s": "x"})
    try:
        k_bad.migrate_record("r", "v2")
    except MigrationError as exc:
        print("迁移失败:", str(exc)[:100])
    print("回滚后记录:", k_bad.get_record("r")["version_id"], k_bad.get_record("r")["data"])
    print("失败不留迁移日志:", k_bad.list_migrations())

    # 精确回滚 + 可复现
    mig = k.list_migrations("doc-1")[0]
    k.revert_migration("doc-1", mig["migration_id"])
    print("显式回滚后:", k.get_record("doc-1")["version_id"], k.get_record("doc-1")["data"])
    again = k.migrate_record("doc-1", "v3")
    same_id = k.list_migrations("doc-1")[-1]["migration_id"] == mig["migration_id"]
    print("同样数据再次迁移得到相同迁移 id（可复现）:", same_id)

    section("需求 6：同数据在不同版本规则下的字段差异（稳定排序）")
    report = k.data_diff("v1", "v3", {"id": 1, "name": "n", "status": "published", "ghost": 7})
    kinds = [(d["path"], d["kind"]) for d in report["diffs"]]
    show("差异条目 (path, kind)", kinds)

    section("需求 7：规则 / 引入废弃版本 / 解析结果 / 迁移路径查询")
    show("v3 的 tags[].label 规则", k.field_rule("v3", "tags[].label"))
    show("字段生命周期", k.field_lifecycle())
    print("迁移路径 v1->v3:", k.migration_path("v1", "v3"))

    section("需求 8：导出 / 重新载入；损坏清晰报错；失败后内存状态不变")
    bundle_text = k.export_bundle()
    print("导出包字节数:", len(bundle_text.encode("utf-8")))
    k2 = Kernel()
    k2.import_bundle(
        bundle_text,
        transforms={"v3": Transform("v2->v3 改名/枚举/嵌套", transform_v3)},
    )
    print("重载版本链:", k2.versions())
    print("重载记录:", k2.get_record("doc-1")["version_id"], k2.get_record("doc-1")["data"])

    tampered = json.loads(bundle_text)
    tampered["records"][0]["data"]["id"] = 42  # 改数据不改校验和
    before = (k2.versions(), k2.get_record("doc-1")["data"])
    try:
        k2.import_bundle(json.dumps(tampered, ensure_ascii=False))
    except BundleError as exc:
        print("损坏包被拒绝:", exc)
    after = (k2.versions(), k2.get_record("doc-1")["data"])
    print("导入失败后内存状态保持不变:", before == after)

    print("\n全部演示完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
