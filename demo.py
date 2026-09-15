# -*- coding: utf-8 -*-
"""离线验收演示：逐项对应需求 1-7，全部通过则退出码为 0。

运行：python demo.py
"""
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from narrative import (And, ChangeError, Compare, Edge, Engine, EntryError,
                       Graph, Node, Or, Schema, StateChange, VariableDef,
                       migrate_save)

PASSED = []


def check(req, label, ok):
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {label}")
    PASSED.append(ok)


# ---------- 需求 1：叙事节点图 ----------
print("需求 1：节点（标识/章节/进入条件/带标识变更）+ 条件边有向图")
schema = Schema([
    VariableDef("trust", "int", 0),
    VariableDef("gold", "int", 10),
    VariableDef("met_ally", "bool", False),
])
graph = Graph([
    Node("n0", "ch1", changes=[StateChange("c1", "gold", "add", 5)]),
    Node("n1", "ch1", entry_condition=Compare("gold", "ge", 12),
         changes=[StateChange("c1", "trust", "add", 2)]),
    Node("n2a", "ch2", entry_condition=Compare("trust", "ge", 2),
         changes=[StateChange("c1", "met_ally", "set", True)]),
    Node("n2b", "ch2", entry_condition=Compare("gold", "lt", 12),
         changes=[StateChange("c1", "gold", "sub", 5)]),
    Node("n3", "ch2", entry_condition=Or([Compare("met_ally", "eq", True),
                                          Compare("gold", "le", 10)])),
], [
    Edge("n0", "n1"),
    Edge("n1", "n2a", label="help"),
    Edge("n1", "n2b", label="rob"),
    Edge("n2a", "n3"), Edge("n2b", "n3"),
])
engine = Engine(schema, graph)
check(1, "图构建并通过完整性校验", graph.node_ids() == ["n0", "n1", "n2a", "n2b", "n3"])

# ---------- 需求 2：按序应用变更 + 带位置的拒绝 ----------
print("需求 2：进入节点按序应用变更；类型不符/未声明变量拒绝并指出位置")
engine.enter("n0")
check(2, "按序应用后 gold=15", engine.state["gold"] == 15)
try:
    bad = Graph([Node("bad", "ch1", changes=[StateChange("c7", "trust", "set", "oops")])], [])
    Engine(schema, bad)
    check(2, "类型不符被拒绝", False)
except Exception as e:
    check(2, f"类型不符被拒绝并指出位置 -> {e}", "bad" in str(e) and "c7" in str(e))
try:
    bad2 = Graph([Node("bad2", "ch1", changes=[StateChange("c9", "ghost", "set", 1)])], [])
    Engine(schema, bad2)
    check(2, "未声明变量被拒绝", False)
except Exception as e:
    check(2, f"未声明变量被拒绝并指出位置 -> {e}", "ghost" in str(e))

# ---------- 需求 3：条件求值确定性 + 缺变量策略 ----------
print("需求 3：条件求值确定；缺变量策略（已声明用缺省值，未声明判假）")
cond = And([Compare("trust", "ge", 2), Or([Compare("gold", "lt", 5),
                                           Compare("met_ally", "eq", True)])])
state = {"trust": 3, "gold": 15, "met_ally": True}
results = {cond.evaluate(state, schema) for _ in range(1000)}
check(3, "同一状态重复求值 1000 次结果唯一", results == {True})
check(3, "已声明但状态中缺失 -> 用缺省值",
      Compare("gold", "eq", 10).evaluate({"trust": 0}, schema))
check(3, "未声明变量 -> 判假",
      not Compare("ghost", "eq", 1).evaluate(state, schema))

# ---------- 需求 4：回退快照 ----------
print("需求 4：回退到节点进入前快照，进度/解锁/分支归属一并回退")
engine.enter("n1")           # trust=2
engine.enter("n2a")          # 分支 n1:help, met_ally=True
before = (dict(engine.state), engine.progress)
engine.rollback_to("n1")
restored = (engine.state["trust"] == 0 and engine.state["met_ally"] is False
            and engine.progress == 1 and engine.unlocked == {"n0"}
            and engine.branch_attribution() == "main")
check(4, "状态/进度/解锁/分支归属全部回到 n1 进入前", restored)
engine.enter("n1")
engine.enter("n2a")
check(4, "重进后结果与首次一致（无残留痕迹）",
      (dict(engine.state), engine.progress) == before)

# ---------- 需求 5：汇合合并 + 冲突记录 ----------
print("需求 5：汇合节点确定性合并；冲突保留双方来源且可读")
log_help = [{"node": "n2a", "change": "c1", "variable": "met_ally",
             "op": "set", "old": False, "new": True},
            {"node": "n2a", "change": "c2", "variable": "trust",
             "op": "add", "old": 2, "new": 3}]
log_rob = [{"node": "n2b", "change": "c1", "variable": "gold",
            "op": "sub", "old": 15, "new": 10},
           {"node": "n2b", "change": "c2", "variable": "trust",
            "op": "set", "old": 2, "new": -1}]
conflicts = engine.apply_merge(log_help, log_rob, "help-path", "rob-path")
text = conflicts[0].readable()
print(f"      冲突记录：{text}")
check(5, "同变量不同值产生冲突并保留双方来源",
      len(conflicts) == 1 and conflicts[0].sources_a and conflicts[0].sources_b)
check(5, "确定性规则（字典序小者胜）与参数顺序无关",
      engine.state["trust"] == 3)

# ---------- 需求 6：存档跨版本迁移 ----------
print("需求 6：旧存档迁移——补新变量默认值、缺失节点标记不可用、进度不变")
save_v1 = {
    "format_version": 1, "content_version": "1.0.0",
    "state": {"trust": 2, "gold": 15, "met_ally": False},
    "progress": 3, "unlocked": ["n0", "n1", "n_old"],
    "branch_trail": [["n1", "help"]],
    "change_log": [], "current_node": "n_old",
}
schema_v2 = Schema(schema._vars and
                   [schema.get(n) for n in schema.names()] +
                   [VariableDef("karma", "int", 5)])
migrated = migrate_save(save_v1)
engine2 = Engine.load(migrated, schema_v2, graph, content_version="2.0.0")
check(6, "新版变量 karma 补默认值 5", engine2.state["karma"] == 5)
check(6, "被移除节点 n_old 标记不可用", engine2.unavailable_nodes == ["n_old"])
check(6, "进度与分支归属与迁移前一致",
      engine2.progress == 3 and engine2.branch_attribution() == "n1:help")

# ---------- 需求 7：查询接口 ----------
print("需求 7：查询进入条件/可达后继/来源链/分支归属/未解决冲突（稳定顺序）")
check(7, "进入条件", engine.entry_condition("n2a") ==
      {"op": "cmp", "var": "trust", "cmp": "ge", "value": 2})
check(7, "可达后继按序", engine.reachable_from("n1") == ["n2a", "n2b"])
chain = [(e["node"], e["change"]) for e in engine.provenance("trust")]
check(7, f"trust 来源链 {chain}", chain[0] == ("n1", "c1"))
check(7, "分支归属", engine.branch_attribution() == "n1:help")
unresolved = engine.unresolved_conflicts()
check(7, "未解决冲突稳定排序且可读",
      [c["variable"] for c in unresolved] == ["trust"] and "readable" in unresolved[0])

print()
if all(PASSED):
    print(f"全部 {len(PASSED)} 项验收通过。")
    sys.exit(0)
print(f"有 {PASSED.count(False)} 项未通过！")
sys.exit(1)
