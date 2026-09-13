"""离线查询计划执行内核（纯 Python 标准库）。

上游以嵌套节点树的形式推送逻辑计划，每个节点是一个 dict：

    {"op": <操作名>, "children": [<子节点>, ...], ...算子特有字段...}

支持的算子：

- scan:      {"op": "scan", "table": <表名>, "batch_size": <可选, 拉取批大小>}
             children 必须为 0。按批从 catalog 拉行，逐行向下游吐。
- filter:    {"op": "filter", "predicate": <谓词表达式>}
             谓词表达式：
               {"col": <列>, "op": "eq|ne|lt|le|gt|ge", "value": <字面值>}
               {"and": [<expr>, ...]} / {"or": [<expr>, ...]} / {"not": <expr>}
- project:   {"op": "project",
              "columns": [<列名> 或 {"column": <列名>, "as": <别名>}, ...]}
- sort:      {"op": "sort",
              "keys": [<列名> 或 {"column": <列名>, "desc": <bool>}, ...]}
             稳定排序：key 相同按输入到达顺序输出。None 视为最小值。
- aggregate: {"op": "aggregate", "group_by": [<列名>, ...],
              "aggregates": [{"func": "count|sum|min|max|avg",
                              "column": <列名, count 可省略表示 count(*)>,
                              "as": <输出列名>}, ...]}
             group_by 为空列表时做全局聚合，即使零输入行也产出一行。
- limit:     {"op": "limit", "limit": <非负整数>}

惰性约定：scan/filter/project/limit 逐行流式处理，不物化中间结果；
sort/aggregate 只在各自节点内部缓冲，输出顺序确定。

游标语义：execute()/fetch() 返回 {"rows": [...], "next_cursor": <str|None>,
"done": <bool>}；next_cursor 为 None 当且仅当 done 为 True。同一 token 重复
fetch 返回同一批行。token 为不可猜测字符串，内部保存 token -> 执行位置快照
的映射；snapshot()/restore() 用 pickle 把执行位置序列化为 bytes 并恢复
（仅供本地可信环境使用，不要反序列化外部数据）。
"""

from __future__ import annotations

import functools
import pickle
import secrets


class PlanError(Exception):
    """计划校验/执行错误，携带从根到出错节点的 op 路径。"""

    def __init__(self, path, message):
        self.path = list(path)
        self.message = message
        super().__init__(
            "{} (path: {})".format(message, " -> ".join(self.path) or "<root>")
        )


_OPS = {"scan", "filter", "project", "sort", "aggregate", "limit"}
_CMP_OPS = {"eq", "ne", "lt", "le", "gt", "ge"}
_AGG_FUNCS = {"count", "sum", "min", "max", "avg"}

_MISSING = object()  # 会话回推行缓冲的空位标记


# ---------------------------------------------------------------------------
# 算子：每个算子提供 next() -> dict | None，以及 get_state()/set_state()
# 用于执行位置的可序列化快照。状态只含标量/行数据，不含迭代器。
# ---------------------------------------------------------------------------


class _Scan:
    """按批从 catalog 拉行，批内逐行吐出；状态只记录已消费行数。"""

    def __init__(self, rows, batch_size):
        self._rows = rows
        self._batch_size = max(1, int(batch_size))
        self._pos = 0  # 下一批在 catalog 中的起始下标
        self._buf = []  # 当前批中尚未吐出的行

    def next(self):
        if not self._buf:
            if self._pos >= len(self._rows):
                return None
            end = min(self._pos + self._batch_size, len(self._rows))
            # 浅拷贝行，避免调用方改到 catalog 里的原始 dict
            self._buf = [dict(r) for r in self._rows[self._pos:end]]
            self._pos = end
        return self._buf.pop(0)

    def get_state(self):
        return {"consumed": self._pos - len(self._buf)}

    def set_state(self, state):
        self._pos = state["consumed"]
        self._buf = []


class _Filter:
    def __init__(self, child, predicate):
        self._child = child
        self._predicate = predicate

    def next(self):
        while True:
            row = self._child.next()
            if row is None:
                return None
            if _eval_predicate(self._predicate, row):
                return row

    def get_state(self):
        return {"child": self._child.get_state()}

    def set_state(self, state):
        self._child.set_state(state["child"])


class _Project:
    def __init__(self, child, specs):
        self._child = child
        self._specs = specs  # [(源列, 输出名), ...]

    def next(self):
        row = self._child.next()
        if row is None:
            return None
        return {alias: row.get(src) for src, alias in self._specs}

    def get_state(self):
        return {"child": self._child.get_state()}

    def set_state(self, state):
        self._child.set_state(state["child"])


class _Sort:
    """读完子节点后稳定排序，再按序吐出；缓冲只发生在本节点内。"""

    def __init__(self, child, keys):
        self._child = child
        self._keys = keys  # [{"column": ..., "desc": bool}, ...]
        self._buf = None  # None 表示还在读取阶段
        self._idx = 0

    def next(self):
        if self._buf is None:
            rows = []
            while True:
                row = self._child.next()
                if row is None:
                    break
                rows.append(row)
            self._buf = _stable_sort(rows, self._keys)
            self._idx = 0
        if self._idx >= len(self._buf):
            return None
        row = self._buf[self._idx]
        self._idx += 1
        return row

    def get_state(self):
        if self._buf is None:
            return {"phase": "read", "child": self._child.get_state()}
        # 只保存未吐出的行，快照更小
        return {"phase": "emit", "rows": self._buf[self._idx:]}

    def set_state(self, state):
        if state["phase"] == "read":
            self._buf = None
            self._idx = 0
            self._child.set_state(state["child"])
        else:
            self._buf = list(state["rows"])
            self._idx = 0


class _Aggregate:
    """读完子节点后计算分组聚合，再按分组首次出现顺序吐出。"""

    def __init__(self, child, group_by, aggregates):
        self._child = child
        self._group_by = group_by
        self._aggregates = aggregates  # [{"func","column","as"}, ...]
        self._out = None
        self._idx = 0

    def next(self):
        if self._out is None:
            self._out = self._compute()
            self._idx = 0
        if self._idx >= len(self._out):
            return None
        row = self._out[self._idx]
        self._idx += 1
        return row

    def get_state(self):
        if self._out is None:
            return {"phase": "read", "child": self._child.get_state()}
        return {"phase": "emit", "rows": self._out[self._idx:]}

    def set_state(self, state):
        if state["phase"] == "read":
            self._out = None
            self._idx = 0
            self._child.set_state(state["child"])
        else:
            self._out = list(state["rows"])
            self._idx = 0

    def _compute(self):
        groups = {}  # 分组 key tuple -> 累加器列表
        order = []  # 分组首次出现顺序，保证输出确定
        while True:
            row = self._child.next()
            if row is None:
                break
            key = tuple(row.get(g) for g in self._group_by)
            accs = groups.get(key)
            if accs is None:
                accs = groups[key] = [_new_acc(a["func"]) for a in self._aggregates]
                order.append(key)
            for acc, spec in zip(accs, self._aggregates):
                _acc_add(acc, spec, row)
        if not self._group_by and not order:
            # 分组键为空的全局聚合：零输入行也要产出一行
            key = ()
            groups[key] = [_new_acc(a["func"]) for a in self._aggregates]
            order.append(key)
        out = []
        for key in order:
            row = {g: v for g, v in zip(self._group_by, key)}
            for acc, spec in zip(groups[key], self._aggregates):
                row[spec["as"]] = _acc_result(acc, spec["func"])
            out.append(row)
        return out


class _Limit:
    def __init__(self, child, limit):
        self._child = child
        self._remaining = limit

    def next(self):
        if self._remaining <= 0:
            return None
        row = self._child.next()
        if row is None:
            return None
        self._remaining -= 1
        return row

    def get_state(self):
        return {"remaining": self._remaining, "child": self._child.get_state()}

    def set_state(self, state):
        self._remaining = state["remaining"]
        self._child.set_state(state["child"])


# ---------------------------------------------------------------------------
# 表达式求值 / 排序比较 / 聚合累加器
# ---------------------------------------------------------------------------


def _eval_predicate(expr, row):
    if "and" in expr:
        return all(_eval_predicate(e, row) for e in expr["and"])
    if "or" in expr:
        return any(_eval_predicate(e, row) for e in expr["or"])
    if "not" in expr:
        return not _eval_predicate(expr["not"], row)
    value = row.get(expr["col"])
    target = expr.get("value")
    op = expr["op"]
    if op == "eq":
        return value == target
    if op == "ne":
        return value != target
    if value is None or target is None:
        return False  # None 不参与大小比较
    if op == "lt":
        return value < target
    if op == "le":
        return value <= target
    if op == "gt":
        return value > target
    return value >= target  # "ge"


def _compare_values(a, b):
    if a is None and b is None:
        return 0
    if a is None:
        return -1  # None 视为最小
    if b is None:
        return 1
    return (a > b) - (a < b)


def _stable_sort(rows, keys):
    def cmp(r1, r2):
        for k in keys:
            c = _compare_values(r1.get(k["column"]), r2.get(k["column"]))
            if c:
                return -c if k["desc"] else c
        return 0

    # sorted 本身稳定：key 相同保持输入到达顺序
    return sorted(rows, key=functools.cmp_to_key(cmp))


def _new_acc(func):
    if func == "count":
        return {"n": 0}
    if func == "avg":
        return {"total": None, "n": 0}
    return {"v": None}  # sum / min / max


def _acc_add(acc, spec, row):
    func = spec["func"]
    col = spec["column"]
    if func == "count":
        if col is None or row.get(col) is not None:
            acc["n"] += 1
        return
    value = row.get(col)
    if value is None:
        return  # sum/min/max/avg 跳过 None
    if func == "avg":
        acc["total"] = value if acc["total"] is None else acc["total"] + value
        acc["n"] += 1
    elif func == "sum":
        acc["v"] = value if acc["v"] is None else acc["v"] + value
    elif func == "min":
        if acc["v"] is None or value < acc["v"]:
            acc["v"] = value
    else:  # max
        if acc["v"] is None or value > acc["v"]:
            acc["v"] = value


def _acc_result(acc, func):
    if func == "count":
        return acc["n"]
    if func == "avg":
        if acc["n"] == 0:
            return None  # 无输入行返回 None 而不是除零
        return acc["total"] / acc["n"]
    return acc["v"]  # sum/min/max：无非 None 输入时为 None


# ---------------------------------------------------------------------------
# 会话：根算子 + 一行回推缓冲 + 耗尽标记，整体可序列化
# ---------------------------------------------------------------------------


class _Session:
    def __init__(self, root):
        self.root = root
        self.pushback = _MISSING
        self.exhausted = False

    def next_row(self):
        if self.pushback is not _MISSING:
            row, self.pushback = self.pushback, _MISSING
            return row
        if self.exhausted:
            return None
        row = self.root.next()
        if row is None:
            self.exhausted = True
        return row

    def get_state(self):
        return {
            "root": self.root.get_state(),
            "has_pushback": self.pushback is not _MISSING,
            "pushback": None if self.pushback is _MISSING else self.pushback,
            "exhausted": self.exhausted,
        }

    def set_state(self, state):
        self.root.set_state(state["root"])
        self.pushback = state["pushback"] if state["has_pushback"] else _MISSING
        self.exhausted = state["exhausted"]


# ---------------------------------------------------------------------------
# 执行器
# ---------------------------------------------------------------------------


class PlanExecutor:
    """对 catalog（表名 -> dict 行列表）执行逻辑计划，支持分页游标与快照。"""

    def __init__(self, catalog, default_batch_size=16):
        self.catalog = catalog
        self.default_batch_size = default_batch_size
        # token -> {"plan": ..., "state": <该 token 对应的执行位置快照>,
        #           "page": <已计算的页, 用于同 token 重复 fetch 一致>}
        self._sessions = {}

    # -- 对外 API ---------------------------------------------------------

    def execute(self, plan, cursor=None):
        """cursor 为 None：从头执行并返回第一页；
        否则 cursor 为 {"token": ..., "batch_size": 可选}，续读该游标。"""
        if cursor is not None:
            token = cursor.get("token")
            batch_size = cursor.get("batch_size", self.default_batch_size)
            return self.fetch(token, batch_size)
        self._validate_node(plan, [])
        token = self._mint_token(plan, self._build_session(plan).get_state())
        return self._compute_page(token, self.default_batch_size)

    def fetch(self, cursor_token, batch_size=None):
        """取下一页。同一 token 重复调用返回同一批行。"""
        if batch_size is None:
            batch_size = self.default_batch_size
        if not isinstance(batch_size, int) or isinstance(batch_size, bool) or batch_size < 1:
            raise ValueError("batch_size must be a positive integer")
        entry = self._sessions.get(cursor_token)
        if entry is None:
            raise ValueError("unknown cursor token: {!r}".format(cursor_token))
        if entry["page"] is not None:
            return self._copy_page(entry["page"])
        return self._compute_page(cursor_token, batch_size)

    def snapshot(self, cursor_token):
        """把游标当前执行位置序列化为 bytes。"""
        entry = self._sessions.get(cursor_token)
        if entry is None:
            raise ValueError("unknown cursor token: {!r}".format(cursor_token))
        payload = {"version": 1, "plan": entry["plan"], "state": entry["state"]}
        return pickle.dumps(payload, protocol=4)

    def restore(self, data):
        """从 snapshot 字节恢复执行位置，返回新的 cursor_token。"""
        payload = pickle.loads(data)
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise ValueError("unrecognized snapshot data")
        plan = payload["plan"]
        self._validate_node(plan, [])  # catalog 可能已变化，重新校验
        session = self._build_session(plan)
        session.set_state(payload["state"])
        return self._mint_token(plan, session.get_state())

    # -- 内部：分页 ---------------------------------------------------------

    def _mint_token(self, plan, state):
        token = secrets.token_urlsafe(16)
        self._sessions[token] = {"plan": plan, "state": state, "page": None}
        return token

    def _compute_page(self, token, batch_size):
        entry = self._sessions[token]
        session = self._build_session(entry["plan"])
        session.set_state(entry["state"])
        rows = []
        for _ in range(batch_size):
            row = session.next_row()
            if row is None:
                break
            rows.append(row)
        extra = session.next_row()  # 多探一行，确定 done 的精确时机
        if extra is None:
            page = {"rows": rows, "next_cursor": None, "done": True}
        else:
            session.pushback = extra
            next_token = self._mint_token(entry["plan"], session.get_state())
            page = {"rows": rows, "next_cursor": next_token, "done": False}
        # token 的 state 保持为“本页之前”的位置：snapshot 该 token 恢复后
        # 继续 fetch 得到的剩余行序列与不中断完全一致（本页会被重放）。
        entry["page"] = page
        return self._copy_page(page)

    @staticmethod
    def _copy_page(page):
        return {
            "rows": [dict(r) for r in page["rows"]],
            "next_cursor": page["next_cursor"],
            "done": page["done"],
        }

    # -- 内部：构建 ---------------------------------------------------------

    def _build_session(self, plan):
        return _Session(self._build_op(plan))

    def _build_op(self, node):
        op = node["op"]
        if op == "scan":
            return _Scan(self.catalog[node["table"]], node.get("batch_size", 64))
        child = self._build_op(node["children"][0])
        if op == "filter":
            return _Filter(child, node["predicate"])
        if op == "project":
            return _Project(child, _project_specs(node))
        if op == "sort":
            return _Sort(child, _sort_keys(node))
        if op == "aggregate":
            return _Aggregate(
                child, node.get("group_by", []), _aggregate_specs(node)
            )
        return _Limit(child, node["limit"])  # "limit"

    # -- 内部：校验 ---------------------------------------------------------

    def _validate_node(self, node, path):
        """校验子树并返回该节点的输出列集合。"""
        if not isinstance(node, dict):
            raise PlanError(path, "plan node must be a dict")
        op = node.get("op")
        if op not in _OPS:
            raise PlanError(path + [op if isinstance(op, str) else "?"],
                            "unknown op {!r}".format(op))
        path = path + [op]
        children = node.get("children", [])
        if not isinstance(children, list):
            raise PlanError(path, "'children' must be a list")

        if op == "scan":
            self._require_arity(children, 0, path)
            table = node.get("table")
            if table not in self.catalog:
                raise PlanError(path, "unknown table {!r}".format(table))
            columns = set()
            for row in self.catalog[table]:
                if not isinstance(row, dict):
                    raise PlanError(path, "table {!r} rows must be dicts".format(table))
                columns.update(row.keys())
            return columns

        self._require_arity(children, 1, path)
        child_columns = self._validate_node(children[0], path)

        if op == "filter":
            self._validate_predicate(node.get("predicate"), child_columns, path)
            return set(child_columns)

        if op == "project":
            out = set()
            for src, alias in _project_specs(node, path):
                if src not in child_columns:
                    raise PlanError(path, "unknown column {!r}".format(src))
                out.add(alias)
            return out

        if op == "sort":
            keys = _sort_keys(node, path)
            if not keys:
                raise PlanError(path, "sort requires a non-empty 'keys' list")
            for k in keys:
                if k["column"] not in child_columns:
                    raise PlanError(
                        path, "unknown sort column {!r}".format(k["column"]))
            return set(child_columns)

        if op == "aggregate":
            group_by = node.get("group_by", [])
            if not isinstance(group_by, list):
                raise PlanError(path, "'group_by' must be a list")
            for g in group_by:
                if g not in child_columns:
                    raise PlanError(path, "unknown group_by column {!r}".format(g))
            specs = _aggregate_specs(node, path)
            out = set(group_by)
            for spec in specs:
                if spec["func"] not in _AGG_FUNCS:
                    raise PlanError(
                        path, "unknown aggregate function {!r}".format(spec["func"]))
                col = spec["column"]
                if col is not None and col not in child_columns:
                    raise PlanError(path, "unknown column {!r}".format(col))
                if spec["as"] in out:
                    raise PlanError(
                        path, "duplicate output column {!r}".format(spec["as"]))
                out.add(spec["as"])
            return out

        # limit
        n = node.get("limit")
        if not isinstance(n, int) or isinstance(n, bool):
            raise PlanError(path, "limit must be an integer")
        if n < 0:
            raise PlanError(path, "limit must not be negative")
        return set(child_columns)

    def _validate_predicate(self, expr, columns, path):
        if not isinstance(expr, dict):
            raise PlanError(path, "predicate must be a dict")
        if "and" in expr or "or" in expr:
            key = "and" if "and" in expr else "or"
            items = expr[key]
            if not isinstance(items, list) or not items:
                raise PlanError(path, "{!r} requires a non-empty list".format(key))
            for e in items:
                self._validate_predicate(e, columns, path)
            return
        if "not" in expr:
            self._validate_predicate(expr["not"], columns, path)
            return
        cmp_op = expr.get("op")
        if cmp_op not in _CMP_OPS:
            raise PlanError(path, "unknown predicate operator {!r}".format(cmp_op))
        if expr.get("col") not in columns:
            raise PlanError(path, "unknown column {!r}".format(expr.get("col")))
        if "value" not in expr:
            raise PlanError(path, "predicate missing 'value'")

    @staticmethod
    def _require_arity(children, expected, path):
        if len(children) != expected:
            raise PlanError(
                path,
                "expected {} child node(s), got {}".format(expected, len(children)),
            )


# ---------------------------------------------------------------------------
# 节点字段规范化（校验与构建共用）
# ---------------------------------------------------------------------------


def _project_specs(node, path=()):
    columns = node.get("columns")
    if not isinstance(columns, list):
        raise PlanError(path, "project requires a 'columns' list")
    specs = []
    for item in columns:
        if isinstance(item, str):
            specs.append((item, item))
        elif isinstance(item, dict) and isinstance(item.get("column"), str):
            specs.append((item["column"], item.get("as") or item["column"]))
        else:
            raise PlanError(path, "invalid project item {!r}".format(item))
    return specs


def _sort_keys(node, path=()):
    keys = node.get("keys")
    if not isinstance(keys, list):
        raise PlanError(path, "sort requires a 'keys' list")
    out = []
    for k in keys:
        if isinstance(k, str):
            out.append({"column": k, "desc": False})
        elif isinstance(k, dict) and isinstance(k.get("column"), str):
            out.append({"column": k["column"], "desc": bool(k.get("desc", False))})
        else:
            raise PlanError(path, "invalid sort key {!r}".format(k))
    return out


def _aggregate_specs(node, path=()):
    aggs = node.get("aggregates")
    if not isinstance(aggs, list) or not aggs:
        raise PlanError(path, "aggregate requires a non-empty 'aggregates' list")
    specs = []
    for a in aggs:
        if not isinstance(a, dict):
            raise PlanError(path, "invalid aggregate spec {!r}".format(a))
        func = a.get("func")
        col = a.get("column")
        alias = a.get("as") or (func if col is None else "{}_{}".format(func, col))
        specs.append({"func": func, "column": col, "as": alias})
    return specs
