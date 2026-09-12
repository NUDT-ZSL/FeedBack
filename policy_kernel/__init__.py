"""policy_kernel — 可嵌入的策略决策与审计追踪内核。

对外只暴露 PolicyKernel 类。仅使用 Python 标准库。
"""

from __future__ import annotations

import copy
import threading
from collections import deque

__all__ = ["PolicyKernel"]

_VALID_EFFECTS = ("allow", "deny")
_VALID_OPS = ("eq", "ne", "in", "gt", "lt")
_NUMERIC = (int, float)


class Decision:
    """一次决策的结果。allowed / rule_id / reason / trace_id 为只读属性。"""

    __slots__ = ("allowed", "rule_id", "reason", "trace_id")

    def __init__(self, allowed, rule_id, reason, trace_id):
        self.allowed = allowed
        self.rule_id = rule_id
        self.reason = reason
        self.trace_id = trace_id

    def __repr__(self):
        return ("Decision(allowed=%r, rule_id=%r, reason=%r, trace_id=%r)"
                % (self.allowed, self.rule_id, self.reason, self.trace_id))


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _match_pattern(pattern, value):
    """'*' 全匹配；以 '*' 结尾做前缀匹配（如 role:*、/docs/*）；否则精确匹配。"""
    if not isinstance(pattern, str) or not isinstance(value, str):
        return False
    if pattern == "*":
        return True
    if pattern.endswith("*"):
        return value.startswith(pattern[:-1])
    return pattern == value


def _eval_condition(key, spec, attrs):
    """求值单条条件。任何类型不匹配或异常都视为不满足，绝不向上抛异常。"""
    try:
        if not isinstance(key, str) or not key.startswith("attr:"):
            return False
        name = key[len("attr:"):]
        if name not in attrs:
            return False
        actual = attrs[name]
        if not isinstance(spec, dict):
            return False
        op = spec.get("op")
        expected = spec.get("value")
        if op == "eq":
            return actual == expected
        if op == "ne":
            return actual != expected
        if op == "in":
            if not isinstance(expected, list):
                return False
            return actual in expected
        if op in ("gt", "lt"):
            if (not isinstance(actual, _NUMERIC) or isinstance(actual, bool)
                    or not isinstance(expected, _NUMERIC) or isinstance(expected, bool)):
                return False
            return actual > expected if op == "gt" else actual < expected
        return False
    except Exception:
        return False


def _validate_rules(rules):
    """全量校验规则集，返回按 (priority 降序, id 字典序) 排序后的深拷贝。

    id 缺失/非字符串/重复、effect 非法、priority 非整数时抛 ValueError。
    """
    if not isinstance(rules, (list, tuple)):
        raise ValueError("rules must be a list of rule dicts")
    seen_ids = set()
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ValueError("rule at index %d is not a dict" % index)
        rid = rule.get("id")
        if not isinstance(rid, str) or not rid:
            raise ValueError("rule at index %d has missing or invalid id" % index)
        if rid in seen_ids:
            raise ValueError("duplicate rule id: %r" % rid)
        seen_ids.add(rid)
        if rule.get("effect") not in _VALID_EFFECTS:
            raise ValueError("rule %r has invalid effect (must be allow/deny)" % rid)
        if not _is_int(rule.get("priority")):
            raise ValueError("rule %r has non-integer priority" % rid)
    copied = copy.deepcopy(list(rules))
    copied.sort(key=lambda r: (-r["priority"], r["id"]))
    return copied


def _first_miss(rule, subject, action, resource, attrs):
    """返回规则对请求的第一个未命中原因；全部命中返回 None。"""
    subjects = rule.get("subjects")
    if not isinstance(subjects, list) or not any(
            _match_pattern(p, subject) for p in subjects):
        return "subject_mismatch"
    actions = rule.get("actions")
    if not isinstance(actions, list) or not any(
            _match_pattern(p, action) for p in actions):
        return "action_mismatch"
    resources = rule.get("resources")
    if not isinstance(resources, list) or not any(
            _match_pattern(p, resource) for p in resources):
        return "resource_mismatch"
    conditions = rule.get("conditions")
    if conditions:
        if not isinstance(conditions, dict):
            return "condition_failed:<invalid>"
        for key, spec in conditions.items():
            if not _eval_condition(key, spec, attrs):
                return "condition_failed:%s" % key
    return None


class PolicyKernel:
    """策略决策与审计追踪内核。

    rules: 规则 dict 列表；audit_capacity: 审计环形缓冲容量（正整数，默认 1024）。
    """

    def __init__(self, rules, audit_capacity=1024):
        if not _is_int(audit_capacity) or audit_capacity <= 0:
            raise ValueError("audit_capacity must be a positive integer")
        self._lock = threading.Lock()
        self._audit = deque(maxlen=audit_capacity)
        self._trace_counter = 0
        self._rules = []
        self.set_rules(rules)  # 校验失败时抛 ValueError

    def set_rules(self, rules):
        """热替换规则集。校验失败抛 ValueError 且原规则集保持不变。"""
        validated = _validate_rules(rules)  # 先完整校验+排序，再原子替换
        with self._lock:
            self._rules = validated

    def decide(self, request):
        """对一次请求做出放行判定，返回 Decision，并写入审计环形缓冲。"""
        if not isinstance(request, dict):
            raise ValueError("request must be a dict")
        subject = request.get("subject")
        action = request.get("action")
        resource = request.get("resource")
        attrs = request.get("attrs")
        if not isinstance(attrs, dict):
            attrs = {}
        with self._lock:
            self._trace_counter += 1
            trace_id = self._trace_counter
            rules = list(self._rules)
        explanation = []
        matched = None
        for rule in rules:
            miss = _first_miss(rule, subject, action, resource, attrs)
            explanation.append({"rule_id": rule["id"],
                                "result": miss if miss else "matched"})
            if miss is None and matched is None:
                matched = rule
        if matched is not None:
            allowed = matched["effect"] == "allow"
            rule_id = matched["id"]
            reason = "rule %r matched: %s" % (rule_id, matched["effect"])
        else:
            allowed = False
            rule_id = None
            reason = "no rule matched; default deny"
        record = {
            "trace_id": trace_id,
            "request": copy.deepcopy(request),
            "allowed": allowed,
            "rule_id": rule_id,
            "reason": reason,
            "explain": explanation,
        }
        with self._lock:
            self._audit.append(record)  # deque(maxlen) 满时自动覆盖最旧记录
        return Decision(allowed, rule_id, reason, trace_id)

    def audit_log(self, limit=None):
        """返回最近的决策快照列表（时间正序）。limit 为负数或非整数时抛 ValueError。"""
        if limit is not None and (not _is_int(limit) or limit < 0):
            raise ValueError("limit must be a non-negative integer or None")
        with self._lock:
            records = list(self._audit)
        if limit is not None:
            records = records[-limit:] if limit else []
        return [{
            "trace_id": r["trace_id"],
            "request": copy.deepcopy(r["request"]),
            "allowed": r["allowed"],
            "rule_id": r["rule_id"],
            "reason": r["reason"],
        } for r in records]

    def explain(self, trace_id):
        """返回某次决策的规则匹配过程（按排序顺序）；trace_id 不存在时返回 None。"""
        with self._lock:
            for record in self._audit:
                if record["trace_id"] == trace_id:
                    return [dict(entry) for entry in record["explain"]]
        return None
