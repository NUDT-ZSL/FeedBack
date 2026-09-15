"""原型引擎：注册定义、推进迁移、维护历史与变量、批量原子触发、查询。

设计要点
========
* **逻辑时钟** ``clock`` 从 0 开始，每成功应用一个动作递增 1，迁移记录按
  clock 顺序保存；回滚不产生 clock 空洞（整批回滚连同 clock 一起恢复）。
* **活动变量快照** ``variables``：进入某状态时复制该状态的快照；提交输入
  就地更新它；返回时用历史帧里保存的快照整体替换。
* **历史栈**：仅跨页迁移压栈（帧 = 离开页面、离开状态、当时变量快照）；
  同页切换状态不压栈；返回弹栈。
* **批量触发**：先按 ``(元素标识, 动作标识)`` 稳定排序（同键保持提交顺序），
  再逐个应用；任一步失败即整体恢复到批次前快照，抛出
  :class:`BatchAbortedError`，预览路径不会出现半迁移。
* **条件覆盖语义**：分支取值在构造时强制互斥；运行时变量缺失抛
  :class:`MissingVariablesError`，取值不命中且无兜底目标抛
  :class:`ConditionError`——两种「无法判定」都会被拒绝并说明原因。
"""

import copy
from collections import namedtuple

from .errors import (
    DefinitionError,
    DuplicateIdError,
    TargetNotFoundError,
    ConditionError,
    MissingVariablesError,
    BackRejectedError,
    TriggerError,
    BatchAbortedError,
)
from .models import (
    Page,
    GOTO,
    BACK,
    SET_STATE,
    SUBMIT,
    HistoryFrame,
    MigrationRecord,
    DEFAULT_HIT,
    is_scalar,
    value_sort_key,
)

#: 预览位置
Location = namedtuple("Location", ["page", "state"])

#: 未提供输入值的哨兵（None 本身是合法输入）
_UNSET = object()


class TriggerStep:
    """批量触发中的一步：在某元素上触发某动作，submit 可带输入值。"""

    __slots__ = ("element_id", "action_id", "value")

    def __init__(self, element_id, action_id=None, value=_UNSET):
        self.element_id = element_id
        self.action_id = action_id
        self.value = value

    def sort_key(self):
        # None 只是「元素上只有一个动作时省略」的写法，排在具体标识前
        return (self.element_id, self.action_id or "")


class PrototypeEngine:
    """串联模块的核心引擎。

    构造时传入起始页面标识；该页面的入口状态成为初始预览位置。
    """

    def __init__(self, start_page_id):
        if not isinstance(start_page_id, str) or not start_page_id:
            raise DefinitionError("起始页面标识必须是非空字符串")
        self.pages = {}
        self._start_page_id = start_page_id
        self._started = False

        # 运行期状态（reset 时统一初始化）
        self.current_page_id = None
        self.current_state_id = None
        self.variables = {}
        self.history = []
        self.clock = 0
        self.log = []

    # ------------------------------------------------------------------ #
    # 定义注册
    # ------------------------------------------------------------------ #

    def add_page(self, page):
        if not isinstance(page, Page):
            raise DefinitionError("add_page 需要 Page 实例")
        if page.id in self.pages:
            raise DuplicateIdError(f"页面标识 {page.id!r} 全局重复")
        self.pages[page.id] = page
        return page

    def start_page_id(self):
        return self._start_page_id

    def validate(self):
        """整体校验：起始页存在、入口状态、目标存在性、条件互斥、动作形状。

        页面注册过程中不做跨页校验（页面可以按任意顺序 add_page）；
        在 :meth:`reset`、保存文件等时点统一调用本方法。
        """
        if self._start_page_id not in self.pages:
            raise TargetNotFoundError(
                f"起始页面 {self._start_page_id!r} 不存在，"
                f"已注册页面：{sorted(self.pages)}"
            )
        for page in self.pages.values():
            if page.entry_state_id not in page.states:
                raise DefinitionError(
                    f"页面 {page.id!r} 的入口状态 {page.entry_state_id!r} 不存在"
                )
            for element in page.elements.values():
                for action in element.actions.values():
                    self._validate_action(page, element, action)

    def _validate_action(self, page, element, action):
        where = f"页面 {page.id!r} 元素 {element.id!r} 动作 {action.id!r}"
        if action.kind == SET_STATE:
            if action.target_state not in page.states:
                raise TargetNotFoundError(
                    f"{where} 切换的目标状态 {action.target_state!r} 在本页不存在"
                )
        if action.kind in (GOTO, SUBMIT) and action.target_page:
            self._resolve_ref(
                action.target_page, action.target_state, where
            )
        if action.branches is not None:
            # 互斥性在构造时已保证，这里防御性复查
            seen = set()
            for branch in action.branches:
                key = (type(branch.value).__name__, repr(branch.value))
                if key in seen:
                    raise ConditionError(
                        f"{where} 分支取值不互斥：{branch.value!r} 重复"
                    )
                seen.add(key)
                self._resolve_ref_str(branch.target, where)
            if action.default_target is not None:
                self._resolve_ref_str(action.default_target, where)

    def _resolve_ref(self, page_id, state_id, where):
        if page_id not in self.pages:
            raise TargetNotFoundError(
                f"{where} 引用的目标页面 {page_id!r} 不存在"
            )
        if state_id is not None and state_id not in self.pages[page_id].states:
            raise TargetNotFoundError(
                f"{where} 引用的目标状态 {page_id}.{state_id} 不存在"
            )

    def _resolve_ref_str(self, ref, where):
        parts = ref.split(".")
        target_page = parts[0]
        target_state = parts[1] if len(parts) == 2 else None
        self._resolve_ref(target_page, target_state, where)

    # ------------------------------------------------------------------ #
    # 生命周期：把预览光标放到起始页面的入口状态
    # ------------------------------------------------------------------ #

    def reset(self):
        """清空运行期状态并回到起始页面入口状态（定义保留）。"""
        self.validate()
        start = self.pages[self._start_page_id]
        self.current_page_id = start.id
        self.current_state_id = start.entry_state_id
        self.variables = copy.deepcopy(start.states[start.entry_state_id].variables)
        self.history = []
        self.clock = 0
        self.log = []
        self._started = True

    def _ensure_started(self):
        if not self._started:
            self.reset()

    # ------------------------------------------------------------------ #
    # 触发
    # ------------------------------------------------------------------ #

    def trigger(self, element_id, action_id=None, value=_UNSET):
        """触发单个动作，返回本条 :class:`MigrationRecord`。"""
        self._ensure_started()
        step = TriggerStep(element_id, action_id, value)
        return self._apply_step(step)

    def trigger_batch(self, steps):
        """同一时刻到达的多个动作：稳定排序后逐个应用，失败整批回滚。

        Returns:
            按应用顺序排列的 :class:`MigrationRecord` 列表。
        Raises:
            BatchAbortedError: 任一步失败，index 为排序后批次中的失败下标。
        """
        self._ensure_started()
        ordered = sorted(steps, key=lambda s: s.sort_key())
        snapshot = self._snapshot()
        records = []
        for index, step in enumerate(ordered):
            try:
                records.append(self._apply_step(step))
            except (TriggerError, MissingVariablesError, BackRejectedError,
                    ConditionError, TargetNotFoundError) as exc:
                self._restore(snapshot)
                raise BatchAbortedError(index, exc, completed=index) from exc
        return records

    def _find_action(self, element_id, action_id):
        page = self.pages.get(self.current_page_id)
        element = page.elements.get(element_id) if page else None
        if element is None:
            raise TriggerError(
                f"当前页面 {self.current_page_id!r} 上不存在元素 {element_id!r}"
            )
        if action_id is None:
            if len(element.actions) == 1:
                return next(iter(element.actions.values()))
            raise TriggerError(
                f"元素 {element_id!r} 绑定了 {len(element.actions)} 个动作，"
                f"必须显式指定动作标识：{sorted(element.actions)}"
            )
        action = element.actions.get(action_id)
        if action is None:
            raise TriggerError(
                f"当前页面 {self.current_page_id!r} 元素 {element_id!r} "
                f"上不存在动作 {action_id!r}"
            )
        return action

    def _apply_step(self, step):
        action = self._find_action(step.element_id, step.action_id)
        source_page = self.current_page_id
        source_state = self.current_state_id

        if action.kind == BACK:
            return self._do_back(action, step.element_id,
                                 source_page, source_state)

        if action.kind == SUBMIT:
            if step.value is _UNSET:
                raise MissingVariablesError(
                    [action.input_var],
                    reason=f"提交动作 {action.id!r} 缺少输入变量 "
                           f"{action.input_var!r} 的值",
                )
            if not is_scalar(step.value):
                raise TriggerError(
                    f"提交动作 {action.id!r} 的输入必须是标量，"
                    f"得到 {type(step.value).__name__}"
                )
            self.variables[action.input_var] = copy.deepcopy(step.value)
            dest_page_id, dest_state_id, branch_hit = self._submit_dest(action)
            record = self._finish_move(
                action, step.element_id,
                source_page, source_state,
                dest_page_id, dest_state_id,
                branch=branch_hit,
                input_var=action.input_var, input_value=step.value,
            )
            return record

        if action.kind == SET_STATE:
            dest_page_id = source_page
            dest_state_id = action.target_state
            return self._finish_move(
                action, step.element_id,
                source_page, source_state,
                dest_page_id, dest_state_id,
            )

        # GOTO：无条件或条件分支
        if action.is_conditional:
            matched, ref = action.evaluate(self.variables)
            parts = ref.split(".")
            dest_page_id = parts[0]
            dest_state_id = parts[1] if len(parts) == 2 else None
            branch_hit = "__default__" if matched is DEFAULT_HIT else matched
        else:
            dest_page_id = action.target_page
            dest_state_id = action.target_state
            branch_hit = None
        return self._finish_move(
            action, step.element_id,
            source_page, source_state,
            dest_page_id, dest_state_id,
            branch=branch_hit,
        )

    def _submit_dest(self, action):
        """提交动作写完变量后的去向：留在本状态或跳往固定目标。"""
        if not action.target_page:
            return self.current_page_id, self.current_state_id, None
        return action.target_page, action.target_state, None

    def _do_back(self, action, element_id, source_page, source_state):
        if not self.history:
            raise BackRejectedError(
                f"历史栈为空：当前页面 {source_page!r} 已无上级页面，"
                f"返回动作 {action.id!r} 被拒绝"
            )
        frame = self.history.pop()
        dest_page_id = frame.page_id
        dest_state_id = frame.state_id
        self._land(dest_page_id, dest_state_id, frame.variables)
        return self._record(
            action, element_id,
            source_page, source_state,
            dest_page_id, dest_state_id,
        )

    def _finish_move(self, action, element_id,
                     source_page, source_state,
                     dest_page_id, dest_state_id,
                     branch=None, input_var=None, input_value=None):
        # 目标存在性兜底（正常定义经 validate 不会触发）
        if dest_page_id not in self.pages:
            raise TargetNotFoundError(
                f"动作 {action.id!r} 的目标页面 {dest_page_id!r} 不存在"
            )
        target_page = self.pages[dest_page_id]
        if dest_state_id is None:
            dest_state_id = target_page.entry_state_id
        if dest_state_id not in target_page.states:
            raise TargetNotFoundError(
                f"动作 {action.id!r} 的目标状态 "
                f"{dest_page_id}.{dest_state_id} 不存在"
            )

        crossing = dest_page_id != source_page
        staying_submit = (
            action.kind == SUBMIT and not crossing and not action.target_page
        )
        if crossing:
            # 离开本页：把当前位置与变量快照压入历史
            self.history.append(HistoryFrame(
                source_page, source_state, copy.deepcopy(self.variables)
            ))

        if staying_submit:
            # 提交且不导航：留在当前状态，保留活动变量（含刚写入的输入）
            self.current_page_id = dest_page_id
            self.current_state_id = dest_state_id
        else:
            # 其余一切导航（跨页落地、同页切状态/跳转）都载入目标状态快照
            snapshot = target_page.states[dest_state_id].variables
            self._land(dest_page_id, dest_state_id, snapshot)

        return self._record(
            action, element_id,
            source_page, source_state,
            dest_page_id, dest_state_id,
            branch=branch, input_var=input_var, input_value=input_value,
        )

    def _land(self, page_id, state_id, variables):
        self.current_page_id = page_id
        self.current_state_id = state_id
        self.variables = copy.deepcopy(variables)

    def _record(self, action, element_id,
                source_page, source_state,
                dest_page_id, dest_state_id,
                branch=None, input_var=None, input_value=None):
        self.clock += 1
        record = MigrationRecord(
            self.clock, element_id, action.id, action.kind,
            source_page, source_state,
            dest_page_id, dest_state_id,
            branch=branch, input_var=input_var, input_value=input_value,
        )
        self.log.append(record)
        return record

    # ------------------------------------------------------------------ #
    # 事务快照（批量回滚）
    # ------------------------------------------------------------------ #

    def _snapshot(self):
        return {
            "page": self.current_page_id,
            "state": self.current_state_id,
            "variables": copy.deepcopy(self.variables),
            "history": copy.deepcopy(self.history),
            "clock": self.clock,
            "log_len": len(self.log),
        }

    def _restore(self, snap):
        self.current_page_id = snap["page"]
        self.current_state_id = snap["state"]
        self.variables = copy.deepcopy(snap["variables"])
        self.history = copy.deepcopy(snap["history"])
        self.clock = snap["clock"]
        del self.log[snap["log_len"]:]

    # ------------------------------------------------------------------ #
    # 查询（全部按稳定顺序返回）
    # ------------------------------------------------------------------ #

    def current_position(self):
        """当前预览位置 ``(页面标识, 状态标识)``。"""
        self._ensure_started()
        return Location(self.current_page_id, self.current_state_id)

    def get_variables(self):
        """当前活动变量快照（按键名稳定排序的副本）。"""
        self._ensure_started()
        return {k: copy.deepcopy(self.variables[k])
                for k in sorted(self.variables)}

    def history_depth(self):
        """历史栈深度（帧数）。"""
        return len(self.history)

    def history_frames(self):
        """历史帧的只读副本列表，栈底在前、栈顶在后。"""
        return [HistoryFrame(f.page_id, f.state_id, copy.deepcopy(f.variables))
                for f in self.history]

    def migration_log(self):
        """迁移日志副本，按逻辑时刻升序。"""
        return list(self.log)

    def page_ids(self):
        return sorted(self.pages)

    def reachable_paths(self, page_id, max_depth=64):
        """从某页面入口状态出发的全部结构可达简单路径。

        路径以 ``[[页面, 状态], ...]`` 的形式返回，按
        「元素标识 → 动作标识 → 分支取值」的字典序做深度优先枚举，
        结果稳定。结构分析会列出条件动作的**每一条**分支与兜底目标
        （不判断当前变量）；``back`` 依赖运行期历史，不参与静态可达性。
        路径不重复经过同一 ``(页面, 状态)``，并受 ``max_depth`` 保护。
        """
        if page_id not in self.pages:
            raise TargetNotFoundError(f"页面 {page_id!r} 不存在")
        start = Location(page_id, self.pages[page_id].entry_state_id)
        results = [[start]]

        def edges_of(loc):
            page = self.pages[loc.page]
            edges = []
            for eid in sorted(page.elements):
                element = page.elements[eid]
                for aid in sorted(element.actions):
                    action = element.actions[aid]
                    if action.kind == BACK:
                        continue
                    if action.kind == SET_STATE:
                        edges.append((eid, aid, None,
                                      Location(loc.page, action.target_state)))
                        continue
                    if action.kind == SUBMIT and not action.target_page:
                        continue
                    if action.branches is not None:
                        ordered = sorted(action.branches,
                                         key=lambda b: value_sort_key(b.value))
                        for branch in ordered:
                            edges.append((eid, aid,
                                          ("v", branch.value),
                                          self._ref_to_location(branch.target)))
                        if action.default_target is not None:
                            edges.append((eid, aid, ("d", None),
                                          self._ref_to_location(
                                              action.default_target)))
                    elif action.target_page:
                        state = action.target_state or self.pages[
                            action.target_page].entry_state_id
                        edges.append((eid, aid, None,
                                      Location(action.target_page, state)))
            edges.sort(key=lambda e: (e[0], e[1],
                                      _edge_branch_key(e[2])))
            return edges

        def dfs(loc, path, visited):
            if len(path) - 1 >= max_depth:
                return
            for _eid, _aid, _br, target in edges_of(loc):
                if target in visited:
                    continue
                new_path = path + [target]
                results.append(new_path)
                dfs(target, new_path, visited | {target})

        dfs(start, [start], {start})
        # 按路径上的位置元组排序，得到与内部枚举顺序无关的稳定结果
        results.sort(key=lambda path: tuple(path))
        return results

    def _ref_to_location(self, ref):
        parts = ref.split(".")
        page_id = parts[0]
        state_id = parts[1] if len(parts) == 2 \
            else self.pages[parts[0]].entry_state_id
        return Location(page_id, state_id)

    def which_branch(self, element_id, action_id=None, variables=None):
        """查询某条件动作在给定变量下会走哪条分支。

        Args:
            variables: 给定变量；缺省用当前活动变量快照。
        Returns:
            ``{"variable", "matched", "default", "target_page",
            "target_state", "target_ref"}``；``matched`` 为命中取值，
            走兜底时为 None 且 ``default=True``。
        """
        scope_vars = self.get_variables() if variables is None else dict(variables)
        # 允许在任意页面上查询：先在当前页找，找不到再全局找（唯一元素无需定位）
        action = self._locate_action_for_query(element_id, action_id)
        if not action.is_conditional:
            raise TriggerError(
                f"动作 {action.id!r} 不是条件跳转动作，没有分支可判定"
            )
        matched, ref = action.evaluate(scope_vars)
        parts = ref.split(".")
        page_id = parts[0]
        state_id = parts[1] if len(parts) == 2 \
            else self.pages[page_id].entry_state_id
        return {
            "variable": action.variable,
            "matched": None if matched is DEFAULT_HIT else matched,
            "default": matched is DEFAULT_HIT,
            "target_ref": ref,
            "target_page": page_id,
            "target_state": state_id,
        }

    def _locate_action_for_query(self, element_id, action_id):
        page = self.pages.get(self.current_page_id)
        if page is not None and element_id in page.elements:
            element = page.elements[element_id]
            if action_id is None:
                if len(element.actions) != 1:
                    raise TriggerError(
                        f"元素 {element_id!r} 绑定多个动作，"
                        f"必须指定动作标识：{sorted(element.actions)}"
                    )
                return next(iter(element.actions.values()))
            if action_id in element.actions:
                return element.actions[action_id]
        # 全局兜底搜索
        for pid in sorted(self.pages):
            element = self.pages[pid].elements.get(element_id)
            if element is not None:
                if action_id is None:
                    if len(element.actions) == 1:
                        return next(iter(element.actions.values()))
                elif action_id in element.actions:
                    return element.actions[action_id]
        raise TriggerError(f"找不到元素 {element_id!r} 上的动作 {action_id!r}")


def _edge_branch_key(branch):
    if branch is None:
        return (0, "")
    kind, value = branch
    if kind == "d":
        return (2, "")
    return (1, repr(value))
