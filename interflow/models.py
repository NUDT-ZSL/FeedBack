"""数据模型：页面 / 页面状态 / 交互元素 / 动作 / 迁移记录 / 历史帧。

标识规则
--------
* 所有标识均为非空字符串；
* 标识中不允许出现 ``.``，因为跨页目标用 ``"页面标识.状态标识"`` 表示；
* 状态标识在页面内唯一，元素 / 动作标识分别在页面 / 元素内唯一，
  页面标识全局唯一（唯一性的最终校验由引擎负责）。
"""

from .errors import (
    DefinitionError,
    DuplicateIdError,
    ConditionError,
)

# 动作类型
GOTO = "goto"          # 跳转（可带条件分支）
BACK = "back"          # 返回上一个页面
SET_STATE = "set"      # 在本页内切换状态
SUBMIT = "submit"      # 提交输入（可随后跳转）

ACTION_KINDS = (GOTO, BACK, SET_STATE, SUBMIT)

#: 条件判定命中兜底分支时 evaluate 返回的哨兵（分支取值本身允许为 None）
DEFAULT_HIT = object()


def _check_id(identifier, what):
    if not isinstance(identifier, str) or not identifier:
        raise DefinitionError(f"{what}标识必须是非空字符串，得到 {identifier!r}")
    if "." in identifier:
        raise DefinitionError(f"{what}标识 {identifier!r} 中不允许包含字符 '.'")


def value_category(value):
    """标量的类型类别：JSON 的 bool 与 number 必须区分（True != 1）。"""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "num"
    if isinstance(value, str):
        return "str"
    return "other"


def values_equal(a, b):
    """类型感知的标量相等判断（避免 Python 中 ``True == 1`` 的陷阱）。"""
    ca, cb = value_category(a), value_category(b)
    if ca != cb:
        return False
    if ca in ("null", "other"):
        return True  # 同类即等（null 只有一个值；other 不允许出现在分支取值中）
    return a == b


def value_sort_key(value):
    """分支取值的稳定排序键。"""
    cat = value_category(value)
    order = {"null": 0, "bool": 1, "num": 2, "str": 3, "other": 4}
    return (order[cat], value if cat in ("num", "str") else repr(value))


def is_scalar(value):
    """分支取值只允许 JSON 标量。"""
    return value is None or isinstance(value, (bool, int, float, str))


class ConditionBranch:
    """条件分支：当判定变量等于 ``value`` 时跳往 ``target``。

    ``target`` 形如 ``"页面标识"`` 或 ``"页面标识.状态标识"``。
    """

    __slots__ = ("value", "target")

    def __init__(self, value, target):
        if not is_scalar(value):
            raise ConditionError(f"分支取值必须是标量，得到 {type(value).__name__}")
        _check_target_ref(target)
        self.value = value
        self.target = target

    def to_dict(self):
        return {"value": self.value, "target": self.target}


def _check_target_ref(ref):
    if not isinstance(ref, str) or not ref:
        raise DefinitionError(f"目标引用必须是非空字符串，得到 {ref!r}")
    parts = ref.split(".")
    if len(parts) > 2 or any(not p for p in parts):
        raise DefinitionError(
            f"目标引用 {ref!r} 格式非法，应为 '页面标识' 或 '页面标识.状态标识'"
        )
    for i, part in enumerate(parts):
        _check_id(part, "目标引用中的页面" if i == 0 else "目标引用中的状态")


class Action:
    """绑定在交互元素上的动作。

    四种动作请使用对应的构造方法：

    * :meth:`goto`      无条件跳转；
    * :meth:`branch_goto` 按变量取值分支跳转（可带兜底目标）；
    * :meth:`back`      返回上一个页面；
    * :meth:`set_state` 切换本页状态（替换变量快照）；
    * :meth:`submit`    提交输入变量，可附带跳转目标。
    """

    __slots__ = (
        "id", "kind", "target_page", "target_state",
        "variable", "branches", "default_target",
        "input_var", "exhaustive",
    )

    def __init__(self, id, kind, **kwargs):
        _check_id(id, "动作")
        if kind not in ACTION_KINDS:
            raise DefinitionError(f"未知动作类型 {kind!r}")
        self.id = id
        self.kind = kind
        self.target_page = kwargs.get("target_page")
        self.target_state = kwargs.get("target_state")
        self.variable = kwargs.get("variable")
        self.branches = kwargs.get("branches")
        self.default_target = kwargs.get("default_target")
        self.input_var = kwargs.get("input_var")
        self.exhaustive = kwargs.get("exhaustive", False)
        self._validate_shape()

    # ---- 构造方法 -------------------------------------------------------

    @classmethod
    def goto(cls, id, target_page, target_state=None):
        _check_id(target_page, "目标页面")
        if target_state is not None:
            _check_id(target_state, "目标状态")
        return cls(id, GOTO, target_page=target_page, target_state=target_state)

    @classmethod
    def back(cls, id):
        return cls(id, BACK)

    @classmethod
    def set_state(cls, id, target_state):
        _check_id(target_state, "目标状态")
        return cls(id, SET_STATE, target_state=target_state)

    @classmethod
    def submit(cls, id, input_var, target_page=None, target_state=None):
        _check_id(input_var, "输入变量")
        if target_page is not None:
            _check_id(target_page, "目标页面")
        if target_state is not None:
            _check_id(target_state, "目标状态")
        return cls(
            id, SUBMIT,
            target_page=target_page, target_state=target_state,
            input_var=input_var,
        )

    @classmethod
    def branch_goto(cls, id, variable, branches, default_target=None,
                    exhaustive=False):
        """按 ``variable`` 的当前取值选择目标。

        条件必须**互斥且覆盖全部取值**：

        * ``branches`` 中的取值两两不同（互斥，构造时强制检查）；
        * 覆盖性二选一：提供 ``default_target`` 作为兜底目标，覆盖其余一切
          取值；或在能保证分支取值就是该变量完整定义域时显式传
          ``exhaustive=True`` 声明穷尽。两者皆无时构造被拒绝。

        Args:
            branches: ``(取值, 目标引用)`` 列表，取值必须两两互斥。
            default_target: 可选兜底目标；取值不命中任何分支时使用。
            exhaustive: 显式声明列出的取值已穷尽全部可能取值。
        """
        _check_id(variable, "判定变量")
        if not branches:
            raise ConditionError("条件动作至少需要一个分支")
        if default_target is None and not exhaustive:
            raise ConditionError(
                f"条件动作 {id!r} 未覆盖全部取值：请提供兜底目标 default_target，"
                f"或在取值已列尽时显式声明 exhaustive=True"
            )
        objs = []
        seen = {}
        for value, target in branches:
            branch = ConditionBranch(value, target)
            key = (value_category(value),
                   value if value_category(value) in ("num", "str") else repr(value))
            if key in seen:
                raise ConditionError(
                    f"条件动作 {id!r} 的分支取值不互斥：{value!r} 重复出现"
                )
            seen[key] = True
            objs.append(branch)
        if default_target is not None:
            _check_target_ref(default_target)
        return cls(
            id, GOTO, variable=variable, branches=objs,
            default_target=default_target, exhaustive=bool(exhaustive),
        )

    # ---- 内部 -----------------------------------------------------------

    def _validate_shape(self):
        if self.kind == GOTO:
            if self.branches is not None:
                if not self.branches:
                    raise ConditionError(f"动作 {self.id!r} 的分支列表为空")
            else:
                if not self.target_page:
                    raise DefinitionError(f"跳转动作 {self.id!r} 缺少目标页面")
        elif self.kind == SET_STATE:
            if not self.target_state:
                raise DefinitionError(f"切换状态动作 {self.id!r} 缺少目标状态")
        elif self.kind == SUBMIT:
            if not self.input_var:
                raise DefinitionError(f"提交动作 {self.id!r} 缺少输入变量名")
            if self.target_state is not None and not self.target_page:
                raise DefinitionError(
                    f"提交动作 {self.id!r} 指定了目标状态但未指定目标页面"
                )

    @property
    def is_conditional(self):
        return self.branches is not None

    def evaluate(self, variables):
        """在给定变量快照下判定分支目标。

        Returns:
            ``(命中取值, 目标引用)``；兜底命中时第一元素为哨兵
            :data:`DEFAULT_HIT`（因为取值本身合法地可以是 None）。
        Raises:
            MissingVariablesError: 判定变量缺失。
            ConditionError: 取值不命中任何分支且无兜底目标。
        """
        from .errors import MissingVariablesError

        if self.variable not in variables:
            raise MissingVariablesError(
                [self.variable], reason=f"动作 {self.id!r} 的条件无法判定"
            )
        actual = variables[self.variable]
        for branch in self.branches:
            if values_equal(actual, branch.value):
                return branch.value, branch.target
        if self.default_target is not None:
            return DEFAULT_HIT, self.default_target
        raise ConditionError(
            f"动作 {self.id!r}：变量 {self.variable!r} 的取值 {actual!r} "
            f"不被任何分支覆盖，且未配置兜底目标（声明 exhaustive=True 的"
            f"取值集合也不含此值）"
        )

    def target_refs(self):
        """该动作引用的全部跨页/本页目标（用于存在性校验）。"""
        refs = []
        if self.kind in (GOTO, SUBMIT) and self.target_page:
            ref = self.target_page + (
                "." + self.target_state if self.target_state else ""
            )
            refs.append(ref)
        if self.branches:
            refs.extend(b.target for b in self.branches)
            if self.default_target is not None:
                refs.append(self.default_target)
        return refs

    def to_dict(self):
        data = {
            "id": self.id,
            "kind": self.kind,
            "target_page": self.target_page,
            "target_state": self.target_state,
            "variable": self.variable,
            "branches": [b.to_dict() for b in self.branches]
            if self.branches is not None else None,
            "default_target": self.default_target,
            "input_var": self.input_var,
            "exhaustive": self.exhaustive,
        }
        return data


class InteractionElement:
    """页面上的一个交互元素，可绑定多个动作。"""

    def __init__(self, id):
        _check_id(id, "元素")
        self.id = id
        self.actions = {}

    def add_action(self, action):
        if not isinstance(action, Action):
            raise DefinitionError("add_action 需要 Action 实例")
        if action.id in self.actions:
            raise DuplicateIdError(
                f"元素 {self.id!r} 中动作标识 {action.id!r} 重复"
            )
        self.actions[action.id] = action
        return action

    def to_dict(self):
        return {
            "id": self.id,
            "actions": [a.to_dict() for a in sorted(self.actions.values(),
                                                    key=lambda a: a.id)],
        }


class PageState:
    """页面状态：唯一标识 + 一组变量快照。"""

    def __init__(self, id, variables=None):
        _check_id(id, "状态")
        self.variables = {}
        if variables is not None:
            if not isinstance(variables, dict):
                raise DefinitionError(f"状态 {id!r} 的变量必须是对象（字典）")
            for key in variables:
                if not isinstance(key, str):
                    raise DefinitionError(
                        f"状态 {id!r} 的变量名必须是字符串，得到 {key!r}"
                    )
            self.variables = dict(variables)
        self.id = id

    def to_dict(self):
        return {"id": self.id, "variables": self.variables}


class Page:
    """原型页面：若干状态、一个入口状态和一组交互元素。"""

    def __init__(self, id, entry_state_id, states=None):
        _check_id(id, "页面")
        _check_id(entry_state_id, "入口状态")
        self.id = id
        self.entry_state_id = entry_state_id
        self.states = {}
        self.elements = {}
        if states is not None:
            for state in states:
                self.add_state(state)
        if entry_state_id not in self.states:
            raise DefinitionError(
                f"页面 {id!r} 的入口状态 {entry_state_id!r} 不存在"
            )

    def add_state(self, state):
        if not isinstance(state, PageState):
            raise DefinitionError("add_state 需要 PageState 实例")
        if state.id in self.states:
            raise DuplicateIdError(
                f"页面 {self.id!r} 中状态标识 {state.id!r} 重复"
            )
        self.states[state.id] = state
        return state

    def add_element(self, element):
        if isinstance(element, str):
            element = InteractionElement(element)
        if not isinstance(element, InteractionElement):
            raise DefinitionError("add_element 需要 InteractionElement 实例或字符串标识")
        if element.id in self.elements:
            raise DuplicateIdError(
                f"页面 {self.id!r} 中元素标识 {element.id!r} 重复"
            )
        self.elements[element.id] = element
        return element

    def state_ids_sorted(self):
        return sorted(self.states)

    def to_dict(self):
        return {
            "id": self.id,
            "entry_state": self.entry_state_id,
            "states": [self.states[sid].to_dict()
                       for sid in sorted(self.states)],
            "elements": [self.elements[eid].to_dict()
                         for eid in sorted(self.elements)],
        }


class HistoryFrame:
    """历史栈中的一帧：离开某个页面时它所在的状态与变量快照。"""

    __slots__ = ("page_id", "state_id", "variables")

    def __init__(self, page_id, state_id, variables):
        self.page_id = page_id
        self.state_id = state_id
        self.variables = variables

    def to_dict(self):
        return {
            "page": self.page_id,
            "state": self.state_id,
            "variables": self.variables,
        }


class MigrationRecord:
    """一次迁移的完整记录。

    Attributes:
        clock: 逻辑时刻，从 1 开始，每成功应用一个动作递增 1。
        source / dest: ``(页面标识, 状态标识)``。
        branch: 条件跳转命中的取值；兜底命中为 ``"__default__"``；否则为 None。
        input_: 提交动作写入的 ``(变量名, 值)``，否则为 None。
    """

    __slots__ = (
        "clock", "element_id", "action_id", "kind",
        "source_page", "source_state",
        "dest_page", "dest_state",
        "branch", "input_var", "input_value",
    )

    def __init__(self, clock, element_id, action_id, kind,
                 source_page, source_state, dest_page, dest_state,
                 branch=None, input_var=None, input_value=None):
        self.clock = clock
        self.element_id = element_id
        self.action_id = action_id
        self.kind = kind
        self.source_page = source_page
        self.source_state = source_state
        self.dest_page = dest_page
        self.dest_state = dest_state
        self.branch = branch
        self.input_var = input_var
        self.input_value = input_value

    @property
    def source(self):
        return self.source_page, self.source_state

    @property
    def dest(self):
        return self.dest_page, self.dest_state

    def to_dict(self):
        return {
            "clock": self.clock,
            "element": self.element_id,
            "action": self.action_id,
            "kind": self.kind,
            "source": {"page": self.source_page, "state": self.source_state},
            "dest": {"page": self.dest_page, "state": self.dest_state},
            # branch：命中的分支取值；走兜底时为 null 且 default=true；
            # 无条件动作为 null 且 default=false
            "branch": None if self.branch in (None, "__default__")
            else self.branch,
            "default": self.branch == "__default__",
            "input": None if self.input_var is None
            else {"var": self.input_var, "value": self.input_value},
        }
