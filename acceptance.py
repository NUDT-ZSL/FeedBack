# -*- coding: utf-8 -*-
"""policy_kernel 离线验收脚本：多主体多条件场景，覆盖优先级、默认拒绝、
环形缓冲、explain 与热替换回滚。运行：python acceptance.py"""
import sys

from policy_kernel import PolicyKernel

try:  # Windows 控制台默认 GBK，避免汇总行乱码
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("PASS  %s" % name)
    else:
        failed += 1
        print("FAIL  %s  %s" % (name, detail))


def expect_raises(name, fn, detail=""):
    try:
        fn()
    except ValueError:
        check(name, True)
    except Exception as exc:  # noqa: BLE001
        check(name, False, "%s 抛出了 %r 而非 ValueError" % (detail, exc))
    else:
        check(name, False, "%s 未抛 ValueError" % detail)


RULES = [
    {"id": "r-deny-intern", "effect": "deny", "priority": 100,
     "subjects": ["role:intern"], "actions": ["delete", "read"], "resources": ["*"]},
    {"id": "r-allow-admin-dept", "effect": "allow", "priority": 80,
     "subjects": ["alice", "bob"], "actions": ["*"], "resources": ["/dept/*"],
     "conditions": {"attr:dept": {"op": "eq", "value": "eng"},
                    "attr:level": {"op": "gt", "value": 3}}},
    {"id": "r-allow-clearance", "effect": "allow", "priority": 60,
     "subjects": ["carol"], "actions": ["read"], "resources": ["*"],
     "conditions": {"attr:clearance": {"op": "in", "value": ["L2", "L3"]}}},
    {"id": "r-allow-staff-read", "effect": "allow", "priority": 50,
     "subjects": ["role:*"], "actions": ["read"], "resources": ["/docs/*"]},
    {"id": "r-deny-legacy", "effect": "deny", "priority": 10,
     "subjects": ["*"], "actions": ["*"], "resources": ["/legacy/*"]},
    {"id": "r-allow-all-delete", "effect": "allow", "priority": 1,
     "subjects": ["*"], "actions": ["delete"], "resources": ["*"]},
]

# ---- 1. 优先级覆盖：高优先级 deny 压过低优先级 allow ----
k = PolicyKernel(RULES)
d = k.decide({"subject": "role:intern", "action": "delete", "resource": "/docs/a"})
check("priority-override", d.allowed is False and d.rule_id == "r-deny-intern",
      "trace_id=%s 期望 deny/r-deny-intern 实际 %s/%s" % (d.trace_id, d.allowed, d.rule_id))

# ---- 2. 前缀主体 + 资源前缀匹配放行 ----
d = k.decide({"subject": "role:staff", "action": "read", "resource": "/docs/guide"})
check("prefix-match-allow", d.allowed is True and d.rule_id == "r-allow-staff-read",
      "trace_id=%s 期望 allow/r-allow-staff-read 实际 %s/%s" % (d.trace_id, d.allowed, d.rule_id))

# ---- 3. 多条件全部满足才命中 ----
d = k.decide({"subject": "alice", "action": "write", "resource": "/dept/eng/spec",
              "attrs": {"dept": "eng", "level": 5}})
check("conditions-all-met", d.allowed is True and d.rule_id == "r-allow-admin-dept",
      "trace_id=%s 期望 allow/r-allow-admin-dept 实际 %s/%s" % (d.trace_id, d.allowed, d.rule_id))

# ---- 4. 条件不满足 -> 默认拒绝，rule_id 为 None ----
d_low = k.decide({"subject": "alice", "action": "write", "resource": "/dept/eng/spec",
                  "attrs": {"dept": "eng", "level": 2}})
check("default-deny", d_low.allowed is False and d_low.rule_id is None,
      "trace_id=%s 期望 False/None 实际 %s/%s" % (d_low.trace_id, d_low.allowed, d_low.rule_id))

# ---- 5. explain：排序顺序与未命中原因 ----
exp = k.explain(d_low.trace_id)
want = [("r-deny-intern", "subject_mismatch"),
        ("r-allow-admin-dept", "condition_failed:attr:level"),
        ("r-allow-clearance", "subject_mismatch"),
        ("r-allow-staff-read", "subject_mismatch"),
        ("r-deny-legacy", "resource_mismatch"),
        ("r-allow-all-delete", "action_mismatch")]
got = [(e["rule_id"], e["result"]) for e in exp] if exp else []
check("explain-reasons", got == want,
      "trace_id=%s 期望 %s 实际 %s" % (d_low.trace_id, want, got))
check("explain-missing-trace", k.explain(99999) is None, "期望 None")

# ---- 6. 类型不匹配安全降级：gt 遇字符串、in 遇非列表、attrs 缺键，均不抛异常 ----
try:
    d1 = k.decide({"subject": "alice", "action": "write", "resource": "/dept/eng/x",
                   "attrs": {"dept": "eng", "level": "5"}})          # gt 遇字符串
    d2 = k.decide({"subject": "carol", "action": "read", "resource": "/x"})  # 缺 clearance
    bad = PolicyKernel([{"id": "r", "effect": "allow", "priority": 1,
                         "subjects": ["*"], "actions": ["*"], "resources": ["*"],
                         "conditions": {"attr:tag": {"op": "in", "value": "notalist"}}}])
    d3 = bad.decide({"subject": "s", "action": "a", "resource": "r", "attrs": {"tag": "t"}})
    ok = (d1.allowed, d2.allowed, d3.allowed) == (False, False, False)
    check("condition-type-safety", ok,
          "trace_id=%s/%s/%s 期望全 False 实际 %s/%s/%s"
          % (d1.trace_id, d2.trace_id, d3.trace_id, d1.allowed, d2.allowed, d3.allowed))
except Exception as exc:  # noqa: BLE001
    check("condition-type-safety", False, "条件求值抛出异常 %r" % exc)

# ---- 7. in 条件命中 ----
d = k.decide({"subject": "carol", "action": "read", "resource": "/anywhere",
              "attrs": {"clearance": "L2"}})
check("condition-in-hit", d.allowed is True and d.rule_id == "r-allow-clearance",
      "trace_id=%s 期望 allow/r-allow-clearance 实际 %s/%s" % (d.trace_id, d.allowed, d.rule_id))

# ---- 8. 同优先级按 id 字典序稳定排序 ----
tie = PolicyKernel([
    {"id": "b-tie", "effect": "allow", "priority": 5,
     "subjects": ["*"], "actions": ["*"], "resources": ["*"]},
    {"id": "a-tie", "effect": "deny", "priority": 5,
     "subjects": ["*"], "actions": ["*"], "resources": ["*"]}])
d = tie.decide({"subject": "s", "action": "a", "resource": "r"})
check("tie-break-by-id", d.allowed is False and d.rule_id == "a-tie",
      "trace_id=%s 期望 deny/a-tie 实际 %s/%s" % (d.trace_id, d.allowed, d.rule_id))

# ---- 9. 环形缓冲覆盖最旧记录 ----
ring = PolicyKernel([{"id": "r-all", "effect": "allow", "priority": 1,
                      "subjects": ["*"], "actions": ["*"], "resources": ["*"]}],
                    audit_capacity=4)
for i in range(6):
    ring.decide({"subject": "s%d" % i, "action": "a", "resource": "r"})
log = ring.audit_log()
check("ring-overwrite", [r["trace_id"] for r in log] == [3, 4, 5, 6],
      "期望 trace_id [3,4,5,6] 实际 %s" % [r["trace_id"] for r in log])
check("ring-explain-evicted", ring.explain(1) is None and ring.explain(6) is not None,
      "trace_id=1 应被覆盖返回 None，trace_id=6 应存在")

# ---- 10. audit_log 的 limit 与快照深拷贝 ----
check("audit-limit", [r["trace_id"] for r in ring.audit_log(limit=2)] == [5, 6],
      "期望 [5,6] 实际 %s" % [r["trace_id"] for r in ring.audit_log(limit=2)])
check("audit-limit-zero", ring.audit_log(limit=0) == [], "期望空列表")
expect_raises("audit-limit-negative", lambda: ring.audit_log(limit=-1))
expect_raises("audit-limit-nonint", lambda: ring.audit_log(limit="2"))
req = {"subject": "alice", "action": "write", "resource": "/dept/eng/x",
       "attrs": {"dept": "eng", "level": 9}}
d = k.decide(req)
req["subject"] = "mallory"
req["attrs"]["level"] = 0
snap = k.audit_log(limit=1)[0]
check("audit-deep-copy",
      snap["request"]["subject"] == "alice" and snap["request"]["attrs"]["level"] == 9,
      "trace_id=%s 快照被外部修改污染: %s" % (d.trace_id, snap["request"]))

# ---- 11. 热替换：新规则生效，历史审计不受影响 ----
before = k.decide({"subject": "dave", "action": "read", "resource": "/x"})
k.set_rules([{"id": "r-open", "effect": "allow", "priority": 1,
              "subjects": ["*"], "actions": ["*"], "resources": ["*"]}])
after = k.decide({"subject": "dave", "action": "read", "resource": "/x"})
check("hot-swap-effective",
      before.allowed is False and after.allowed is True and after.rule_id == "r-open",
      "trace_id=%s->%s 期望 False->True/r-open 实际 %s->%s/%s"
      % (before.trace_id, after.trace_id, before.allowed, after.allowed, after.rule_id))
check("hot-swap-keeps-history", k.explain(before.trace_id) is not None,
      "trace_id=%s 的历史 explain 丢失" % before.trace_id)

# ---- 12. 热替换失败回滚：三类非法规则集均抛 ValueError 且原规则集不变 ----
dup = [{"id": "x", "effect": "allow", "priority": 1, "subjects": ["*"],
        "actions": ["*"], "resources": ["*"]}] * 2
bad_effect = [{"id": "x", "effect": "permit", "priority": 1, "subjects": ["*"],
               "actions": ["*"], "resources": ["*"]}]
bad_prio = [{"id": "x", "effect": "allow", "priority": "1", "subjects": ["*"],
             "actions": ["*"], "resources": ["*"]}]
expect_raises("swap-reject-dup-id", lambda: k.set_rules(dup))
expect_raises("swap-reject-bad-effect", lambda: k.set_rules(bad_effect))
expect_raises("swap-reject-bad-priority", lambda: k.set_rules(bad_prio))
d = k.decide({"subject": "dave", "action": "read", "resource": "/x"})
check("swap-rollback", d.allowed is True and d.rule_id == "r-open",
      "trace_id=%s 期望回滚后仍 allow/r-open 实际 %s/%s" % (d.trace_id, d.allowed, d.rule_id))

print("-" * 60)
print("通过 %d 项，失败 %d 项" % (passed, failed))
raise SystemExit(1 if failed else 0)
