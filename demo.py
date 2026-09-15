"""离线端到端演示：覆盖条目/引用、修订、冲突、合并、删除拆分、查询、持久化。

运行：python -X utf8 demo.py
"""

from __future__ import annotations

import os
import tempfile

from experience_graph import (
    ExperienceGraph,
    MergeConflict,
    StaleRevision,
    persistence,
)


def hr(title: str) -> None:
    print("\n" + "=" * 68)
    print(title)
    print("=" * 68)


def main() -> None:
    g = ExperienceGraph()

    hr("1. 创建条目与无环引用")
    g.create_entry("deploy", "部署", "准备环境\n执行发布\n上线验证", "alice")
    g.create_entry("rollback", "回滚", "回滚到上一稳定版本", "bob")
    g.create_entry("checklist", "清单", "发布前检查项", "carol")
    g.add_reference("deploy", "checklist")
    g.add_reference("deploy", "rollback")
    print("deploy 引用 ->", g.outgoing("deploy"))
    try:
        g.add_reference("rollback", "deploy")  # deploy -> rollback 已存在，会成环
    except Exception as exc:
        print("拒绝成环引用：", exc)

    hr("2. 基于过期版本的修订被拒绝（告知落后版本数）")
    g.submit_revision("deploy", "bob", 0,
                      "准备环境（含冒烟）\n执行发布\n上线验证", "补充冒烟准备")
    print("deploy 当前版本：", g.current_version("deploy"))
    try:
        g.submit_revision("deploy", "dave", 0, "完全旧的正文", "dave 基于 v0")
    except StaleRevision as exc:
        print("拒绝：", exc)
        print("落后版本数 behind =", exc.behind)

    hr("3. 同一段落双方互改 -> 保留双方、不选边、版本不前进")
    before = g.current_version("rollback")
    try:
        g.integrate_revisions("rollback", [
            {"author": "u1", "base_version": 0,
             "body": "回滚到上一稳定版本（方案：切流）", "change": "u1 主张切流"},
            {"author": "u2", "base_version": 0,
             "body": "回滚到上一稳定版本（方案：重放）", "change": "u2 主张重放"},
        ])
    except MergeConflict as exc:
        rec = exc.records[0]
        print(f"条目={rec.entry_id} 段落位置={rec.location} 作者="
              f"{[p['author'] for p in rec.parties]}")
        print("-" * 40)
        print(rec.rendered)
    print("rollback 版本保持：", g.current_version("rollback"), "（合并前", before, "）")

    hr("4. 不同段落自动合并为一条新版本（与到达顺序无关）")
    g.create_entry("guide", "指南", "第一段\n第二段\n第三段", "alice")
    v = g.integrate_revisions("guide", [
        {"author": "bob", "base_version": 0,
         "body": "第一段（bob 修订）\n第二段\n第三段", "change": "bob 改第一段"},
        {"author": "carol", "base_version": 0,
         "body": "第一段\n第二段\n第三段（carol 补充）", "change": "carol 改第三段"},
    ])
    print("自动合并产生单一新版本：v", v)
    print(g.get_entry("guide")["body"])

    hr("5. 删除被引用条目：只重算受影响边，无悬空引用")
    print("删除前 checklist 被引用情况：", g.backlinks("checklist"))
    info = g.delete_entry("checklist")
    print("受影响并移除的边：", info["removed_edges"])
    print("是否存在悬空引用：", g.has_dangling_reference())
    print("deploy 当前出引用：", g.outgoing("deploy"))

    hr("6. 查询：当前版本 / 修订链 / 被谁引用 / 两版差异")
    print("deploy 当前版本 v", g.current_version("deploy"))
    for node in g.revision_chain("deploy"):
        print("  链：", node["kind"], node["revision_id"],
              "作者", node["authors"], "v%s->v%s" % (
                  node["base_version"], node["new_version"]))
    print("rollback 被哪些条目引用：", g.backlinks("rollback"))
    diff = g.diff_versions("deploy", 0, 1)
    print("deploy v0 -> v1 差异：")
    print(diff["rendered"])

    hr("7. 单文件保存 / 重新载入（含逻辑时钟、冲突记录、校验和）")
    path = os.path.join(tempfile.gettempdir(), "experience_graph_demo.json")
    persistence.save(g, path)
    print("已写入：", path)
    loaded = persistence.load(path)
    print("往返一致：", loaded.to_dict() == g.to_dict())
    print("载入后逻辑时钟 clock =", loaded.clock,
          "；冲突记录数 =", len(loaded.list_conflicts()))

    # 演示损坏文件被清晰拒绝，且目标状态不变
    snapshot = loaded.to_dict()
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("!!!损坏")
    try:
        persistence.load(path, into=loaded)
    except Exception as exc:
        print("损坏文件被拒绝：", exc)
    print("失败后载入目标状态不变：", loaded.to_dict() == snapshot)
    os.unlink(path)


if __name__ == "__main__":
    main()
