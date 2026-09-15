"""focus_order —— 离线键盘焦点顺序引擎。

对外导出见 ``__init__``。本模块只依赖 Python 标准库。

设计要点（详见 README）：

* 每个元素在任一方向上至多有一个出边，关系图是按方向分片的函数图
  （functional graph），因此从任一元素出发的轨迹唯一，焦点推进不存在
  遍历顺序漂移。
* 所有对外枚举（元素列表、环列表、方向目标等）都按显式的稳定全序
  返回：方向按注册顺序，元素按 id 全序（见 :func:`_id_key`）。
* 环始终允许配置存在，通过 :meth:`FocusEngine.find_cycles` 列出；
  任何会进入环的方向推进被拒绝，当前焦点保持不变。
* 容器接管（弹层）是一个严格的栈；接管期间方向键不得离开栈顶容器，
  退出时焦点回到接管前元素，元素失效时按声明式的“最近可用”规则回退。
* 动态删除只清理受影响的边（出边 + 反向索引中的入边），其结果与
  用最终配置从头重建完全一致（由验收测试中的等价性用例保证）。
"""

from __future__ import annotations

import copy
import json
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

__all__ = [
    "DEFAULT_DIRECTIONS",
    "FocusError",
    "ErrorCode",
    "RejectCode",
    "Element",
    "MoveResult",
    "Rejection",
    "HistoryEntry",
    "Cycle",
    "FocusEngine",
]

DEFAULT_DIRECTIONS: Tuple[str, ...] = ("up", "down", "left", "right")

# ---------------------------------------------------------------------------
# 错误与原因码
# ---------------------------------------------------------------------------


class ErrorCode:
    """配置类错误码（以异常抛出，调用方写错了，需要修正配置）。"""

    DUPLICATE_ELEMENT = "duplicate-element"
    ELEMENT_NOT_FOUND = "element-not-found"
    UNKNOWN_DIRECTION = "unknown-direction"
    RELATION_CONFLICT = "relation-conflict"
    RELATION_SOURCE_MISSING = "relation-source-missing"
    RELATION_TARGET_MISSING = "relation-target-missing"
    SCOPE_ALREADY_ACTIVE = "scope-already-active"
    SCOPE_NOT_ACTIVE = "scope-not-active"
    SCOPE_MISMATCH = "scope-mismatch"
    INVALID_FOCUS_TARGET = "invalid-focus-target"
    INVALID_SCOPE_TARGET = "invalid-scope-target"


class RejectCode:
    """推进被拒绝的原因码（运行时按键路径，焦点保持不变）。"""

    NO_CURRENT_FOCUS = "no-current-focus"
    UNKNOWN_DIRECTION = "unknown-direction"
    NO_RELATION = "no-relation"
    TARGET_MISSING = "target-missing"
    TARGET_DISABLED = "target-disabled"
    TARGET_NOT_FOCUSABLE = "target-not-focusable"
    SCOPE_ESCAPE = "scope-escape"
    CYCLE = "cycle"


class FocusError(Exception):
    """配置/调用错误。

    :param code: :class:`ErrorCode` 中的稳定机器码
    :param message: 面向人的中文说明
    :param context: 结构化附加上下文（冲突方向、冲突目标等）
    """

    def __init__(self, code: str, message: str, **context: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.context = context

    def __str__(self) -> str:  # pragma: no cover - 调试用
        return f"[{self.code}] {self.message}"


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Element:
    """可聚焦元素。

    :param id: 唯一标识（同批元素须可互相比较，建议统一用 str 或 int）
    :param container: 所在容器标识
    :param focusable: 是否可聚焦（配置层面）
    :param disabled: 是否被禁用
    """

    id: Any
    container: Any
    focusable: bool = True
    disabled: bool = False

    @property
    def usable(self) -> bool:
        """当前是否真正可以接收焦点。"""
        return bool(self.focusable) and not bool(self.disabled)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "container": self.container,
            "focusable": bool(self.focusable),
            "disabled": bool(self.disabled),
            "usable": self.usable,
        }


@dataclass(frozen=True)
class Rejection:
    """一次被拒绝的推进。"""

    seq: int
    direction: Optional[str]
    at: Any
    code: str
    message: str
    target: Any = None
    container: Any = None
    cycle: Optional[Tuple[Any, ...]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "seq": self.seq,
            "direction": self.direction,
            "at": self.at,
            "code": self.code,
            "message": self.message,
            "target": self.target,
            "container": self.container,
            "cycle": list(self.cycle) if self.cycle is not None else None,
        }


@dataclass(frozen=True)
class MoveResult:
    """方向键推进结果。失败时 ``accepted`` 为 False，焦点一定未改变。"""

    accepted: bool
    direction: str
    source: Any
    target: Any = None
    seq: Optional[int] = None
    rejection: Optional[Rejection] = None

    @property
    def code(self) -> Optional[str]:
        return self.rejection.code if self.rejection else None


@dataclass(frozen=True)
class HistoryEntry:
    """焦点历史中的一条记录（只有真正改变焦点的事件才入历史）。"""

    seq: int
    kind: str  # focus | move | scope-enter | scope-exit | fallback | refocus
    source: Any = None
    target: Any = None
    direction: Optional[str] = None
    detail: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "seq": self.seq,
            "kind": self.kind,
            "source": self.source,
            "target": self.target,
            "direction": self.direction,
            "detail": dict(self.detail),
        }


@dataclass(frozen=True)
class Cycle:
    """一个方向上的环；``nodes`` 已规范化为从最小 id 开始。"""

    direction: str
    nodes: Tuple[Any, ...]

    def to_dict(self) -> Dict[str, Any]:
        return {"direction": self.direction, "nodes": list(self.nodes)}


@dataclass
class _ScopeFrame:
    container: Any
    return_to: Any
    return_container: Any


_UNSET = object()


def _id_key(value: Any) -> Tuple[int, Any]:
    """元素 id 的稳定全序键。

    数值按数值序，字符串按字典序，其它类型退化为 ``repr``；不同大类
    之间用固定档位隔开，避免 str/int 混用时抛 ``TypeError``。
    """
    if isinstance(value, bool):
        return (0, int(value))
    if isinstance(value, (int, float)):
        return (0, float(value))
    if isinstance(value, str):
        return (1, value)
    return (2, repr(value))


# ---------------------------------------------------------------------------
# 引擎
# ---------------------------------------------------------------------------


class FocusEngine:
    """焦点顺序引擎。线程模型：单线程使用（无障碍交互层本身是事件串行的）。"""

    def __init__(
        self,
        directions: Sequence[str] = DEFAULT_DIRECTIONS,
        *,
        initial_focus: Any = None,
        history_limit: Optional[int] = 1000,
    ) -> None:
        if not directions:
            raise ValueError("directions 不能为空")
        dirs = tuple(directions)
        if len(set(dirs)) != len(dirs):
            raise ValueError(f"方向存在重复: {dirs!r}")
        self._directions: Tuple[str, ...] = dirs
        self._dir_index: Dict[str, int] = {d: i for i, d in enumerate(dirs)}

        self._elements: Dict[Any, Element] = {}
        # source -> {direction: target}
        self._edges: Dict[Any, Dict[str, Any]] = {}
        # target -> {direction: set(sources)}，仅用于增量删除时清理入边
        self._incoming: Dict[Any, Dict[str, set]] = {}

        self._current: Any = None
        self._frames: List[_ScopeFrame] = []
        # 焦点因异常丢失、等待同范围重新出现可用元素时的锚点
        self._lost: Optional[Dict[str, Any]] = None

        self._seq: int = 0
        self._history: Deque[HistoryEntry] = deque(maxlen=history_limit)
        self._last_rejection: Optional[Rejection] = None

        if initial_focus is not None:
            self.set_focus(initial_focus)

    # ------------------------------------------------------------------
    # 基本属性
    # ------------------------------------------------------------------

    @property
    def directions(self) -> Tuple[str, ...]:
        return self._directions

    @property
    def current_focus(self) -> Any:
        return self._current

    @property
    def active_container(self) -> Any:
        """当前接管容器（栈顶）；未接管时为 None。"""
        return self._frames[-1].container if self._frames else None

    @property
    def scope_depth(self) -> int:
        return len(self._frames)

    # ------------------------------------------------------------------
    # 元素维护
    # ------------------------------------------------------------------

    def add_element(
        self,
        id: Any,
        container: Any,
        focusable: bool = True,
        disabled: bool = False,
    ) -> Element:
        if id is None:
            raise FocusError(ErrorCode.ELEMENT_NOT_FOUND, "元素 id 不能为 None")
        if id in self._elements:
            raise FocusError(
                ErrorCode.DUPLICATE_ELEMENT,
                f"元素 {id!r} 已存在，重复注册被拒绝",
                id=id,
            )
        element = Element(id=id, container=container, focusable=focusable, disabled=disabled)
        self._elements[id] = element
        self._edges[id] = {}
        self._incoming[id] = {}
        # 若焦点此前在当前范围内因异常丢失，新可用元素出现时尝试安全恢复。
        self._recover_lost_focus()
        return element

    def update_element(
        self,
        id: Any,
        *,
        container: Any = _UNSET,
        focusable: Optional[bool] = _UNSET,  # type: ignore[assignment]
        disabled: Optional[bool] = _UNSET,  # type: ignore[assignment]
    ) -> Element:
        element = self._require_element(id)
        new_container = element.container if container is _UNSET else container
        new_focusable = element.focusable if focusable is _UNSET else bool(focusable)
        new_disabled = element.disabled if disabled is _UNSET else bool(disabled)
        updated = Element(
            id=id,
            container=new_container,
            focusable=new_focusable,
            disabled=new_disabled,
        )
        self._elements[id] = updated

        active = self.active_container
        if self._current == id:
            if active is not None and updated.container != active:
                # 焦点元素被移出当前接管容器：在接管范围内回退。
                self._fallback_from(updated, reason="moved-out-of-scope")
            elif not updated.usable:
                reason = "disabled" if updated.disabled else "not-focusable"
                self._fallback_from(updated, reason=reason)
        else:
            self._recover_lost_focus()
        return updated

    def set_disabled(self, id: Any, disabled: bool) -> Element:
        return self.update_element(id, disabled=disabled)

    def set_focusable(self, id: Any, focusable: bool) -> Element:
        return self.update_element(id, focusable=focusable)

    def move_to_container(self, id: Any, container: Any) -> Element:
        return self.update_element(id, container=container)

    def remove_element(self, id: Any) -> None:
        """动态删除元素。

        只清理与该元素相关的顺序关系（出边 + 所有指向它的入边），
        不留悬空关系；若删除的是当前焦点，按最近可用规则回退。
        """
        if id not in self._elements:
            raise FocusError(
                ErrorCode.ELEMENT_NOT_FOUND,
                f"元素 {id!r} 不存在，无法删除",
                id=id,
            )
        element = self._elements.pop(id)

        # 出边：source -> d -> target，清理 target 的反向索引
        outgoing = self._edges.pop(id, {})
        for direction, target in outgoing.items():
            sources = self._incoming.get(target, {}).get(direction)
            if sources is not None:
                sources.discard(id)

        # 入边：所有 source -> d -> id，删除这些出边
        incoming = self._incoming.pop(id, {})
        for direction, sources in incoming.items():
            for source in sources:
                if self._edges.get(source, {}).get(direction) == id:
                    del self._edges[source][direction]

        if self._current == id:
            self._fallback_from(element, reason="removed")

    # ------------------------------------------------------------------
    # 顺序关系维护
    # ------------------------------------------------------------------

    def add_relation(self, source: Any, direction: str, target: Any) -> None:
        """添加一条带方向的顺序关系。

        同一元素同一方向最多一个目标；重复配置（即使目标相同）一律
        拒绝，错误中指出冲突方向、既有目标与新目标。
        """
        if source not in self._elements:
            raise FocusError(
                ErrorCode.RELATION_SOURCE_MISSING,
                f"关系起点 {source!r} 不存在，拒绝添加 {direction!r} 方向关系",
                source=source,
                direction=direction,
                target=target,
            )
        if target not in self._elements:
            raise FocusError(
                ErrorCode.RELATION_TARGET_MISSING,
                f"关系终点 {target!r} 不存在，拒绝添加 {source!r} 沿 {direction!r} 的关系",
                source=source,
                direction=direction,
                target=target,
            )
        if direction not in self._dir_index:
            raise FocusError(
                ErrorCode.UNKNOWN_DIRECTION,
                f"未知方向 {direction!r}，合法方向为 {self._directions!r}",
                direction=direction,
            )
        existing = self._edges[source].get(direction)
        if existing is not None:
            raise FocusError(
                ErrorCode.RELATION_CONFLICT,
                (
                    f"元素 {source!r} 在方向 {direction!r} 上已指向 "
                    f"{existing!r}，拒绝重复配置为 {target!r}（冲突方向：{direction!r}）"
                ),
                source=source,
                direction=direction,
                existing_target=existing,
                new_target=target,
            )
        self._edges[source][direction] = target
        self._incoming[target].setdefault(direction, set()).add(source)

    def remove_relation(self, source: Any, direction: str) -> bool:
        """删除一条关系；关系不存在返回 False。元素不存在抛配置错误。"""
        if source not in self._elements:
            raise FocusError(
                ErrorCode.RELATION_SOURCE_MISSING,
                f"关系起点 {source!r} 不存在",
                source=source,
                direction=direction,
            )
        if direction not in self._dir_index:
            raise FocusError(
                ErrorCode.UNKNOWN_DIRECTION,
                f"未知方向 {direction!r}",
                direction=direction,
            )
        target = self._edges.get(source, {}).pop(direction, None)
        if target is None:
            return False
        sources = self._incoming.get(target, {}).get(direction)
        if sources is not None:
            sources.discard(source)
        return True

    def configure(
        self,
        elements: Iterable[Any] = (),
        relations: Iterable[Sequence[Any]] = (),
        *,
        reset: bool = False,
    ) -> None:
        """批量配置。

        ``elements`` 每项可以是 dict（``id/container/focusable/disabled``）
        或元组 ``(id, container)`` / ``(id, container, focusable, disabled)``；
        ``relations`` 每项为 ``(source, direction, target)``。

        任一配置非法时整体回滚到调用前状态（原子配置），便于上游重试。
        ``reset=True`` 时先清空全部配置与运行时状态（含历史与接管栈）。
        """
        saved = copy.deepcopy(self._runtime_state())
        if reset:
            self._hard_reset()
        try:
            for spec in elements:
                id, container, focusable, disabled = self._coerce_element_spec(spec)
                self.add_element(id, container, focusable, disabled)
            for relation in relations:
                try:
                    source, direction, target = tuple(relation)
                except (TypeError, ValueError) as exc:
                    raise FocusError(
                        ErrorCode.RELATION_CONFLICT,
                        f"关系必须是 (source, direction, target) 三元组，收到 {relation!r}",
                    ) from exc
                self.add_relation(source, direction, target)
        except FocusError:
            self._restore_runtime_state(saved)
            raise

    @staticmethod
    def _coerce_element_spec(spec: Any) -> Tuple[Any, Any, bool, bool]:
        if isinstance(spec, Element):
            return spec.id, spec.container, spec.focusable, spec.disabled
        if isinstance(spec, Mapping):
            if "id" not in spec or "container" not in spec:
                raise FocusError(
                    ErrorCode.ELEMENT_NOT_FOUND,
                    f"元素配置必须包含 id 与 container，收到 {spec!r}",
                )
            return (
                spec["id"],
                spec["container"],
                bool(spec.get("focusable", True)),
                bool(spec.get("disabled", False)),
            )
        if isinstance(spec, (list, tuple)):
            if len(spec) == 2:
                return spec[0], spec[1], True, False
            if len(spec) == 4:
                return spec[0], spec[1], bool(spec[2]), bool(spec[3])
        raise FocusError(
            ErrorCode.ELEMENT_NOT_FOUND,
            f"无法识别的元素配置: {spec!r}",
        )

    # ------------------------------------------------------------------
    # 焦点推进
    # ------------------------------------------------------------------

    def set_focus(self, id: Any) -> None:
        """显式设置焦点。目标必须存在、可用，且在当前接管容器内。"""
        element = self._elements.get(id)
        if element is None:
            raise FocusError(
                ErrorCode.INVALID_FOCUS_TARGET,
                f"焦点目标 {id!r} 不存在",
                target=id,
            )
        active = self.active_container
        if active is not None and element.container != active:
            raise FocusError(
                ErrorCode.INVALID_FOCUS_TARGET,
                f"接管期间焦点必须停留在容器 {active!r} 内，"
                f"不能设置到位于容器 {element.container!r} 的元素 {id!r}",
                target=id,
                container=element.container,
                active_container=active,
            )
        if not element.usable:
            raise FocusError(
                ErrorCode.INVALID_FOCUS_TARGET,
                f"焦点目标 {id!r} 不可用"
                f"{'（已禁用）' if element.disabled else '（不可聚焦）'}",
                target=id,
            )
        previous = self._current
        self._current = id
        self._lost = None
        self._append_history("focus", previous, id)

    def advance(self, direction: str) -> MoveResult:
        """按一次方向键。

        返回 :class:`MoveResult`；被拒绝时 ``accepted=False`` 且当前
        焦点不变，拒绝原因同时记录到 :attr:`last_rejection`。
        """
        at = self._current

        if direction not in self._dir_index:
            return self._reject(
                direction,
                at,
                RejectCode.UNKNOWN_DIRECTION,
                f"未知方向 {direction!r}，合法方向为 {self._directions!r}",
            )
        if at is None:
            return self._reject(
                direction,
                None,
                RejectCode.NO_CURRENT_FOCUS,
                "当前没有焦点元素，无法沿任何方向推进",
            )

        target_id = self._edges.get(at, {}).get(direction)
        if target_id is None:
            return self._reject(
                direction,
                at,
                RejectCode.NO_RELATION,
                f"元素 {at!r} 没有 {direction!r} 方向的顺序关系",
            )

        target = self._elements.get(target_id)
        if target is None:
            # 正常流程下增量删除已保证不会出现悬空关系，这里是防御性分支。
            return self._reject(
                direction,
                at,
                RejectCode.TARGET_MISSING,
                f"方向 {direction!r} 的目标 {target_id!r} 不存在（悬空关系）",
                target=target_id,
            )

        # 接管生效期间，逃逸判定优先于目标自身状态：目标在容器外这一
        # 事实与它是否禁用/可聚焦无关，任何指向容器外的推进一律拒绝。
        active = self.active_container
        if active is not None and target.container != active:
            return self._reject(
                direction,
                at,
                RejectCode.SCOPE_ESCAPE,
                (
                    f"容器 {active!r} 已接管焦点，{direction!r} 方向会逃逸到"
                    f"容器 {target.container!r} 内的元素 {target_id!r}，推进被拒绝"
                ),
                target=target_id,
                container=target.container,
            )

        if target.disabled:
            return self._reject(
                direction,
                at,
                RejectCode.TARGET_DISABLED,
                f"方向 {direction!r} 的目标 {target_id!r} 已被禁用",
                target=target_id,
            )
        if not target.focusable:
            return self._reject(
                direction,
                at,
                RejectCode.TARGET_NOT_FOCUSABLE,
                f"方向 {direction!r} 的目标 {target_id!r} 不可聚焦",
                target=target_id,
            )

        cycle = self._cycle_for_edge(at, direction, target_id)
        if cycle is not None:
            return self._reject(
                direction,
                at,
                RejectCode.CYCLE,
                (
                    f"沿 {direction!r} 方向的边 {at!r} -> {target_id!r} 位于环 "
                    f"{' -> '.join(repr(x) for x in cycle)}（含回到起点）上，"
                    f"继续推进会无限循环，推进被拒绝"
                ),
                target=target_id,
                cycle=cycle,
            )

        self._current = target_id
        self._lost = None
        seq = self._append_history("move", at, target_id, direction=direction)
        return MoveResult(
            accepted=True,
            direction=direction,
            source=at,
            target=target_id,
            seq=seq,
        )

    # ------------------------------------------------------------------
    # 容器接管（弹层焦点陷阱）
    # ------------------------------------------------------------------

    def enter_scope(self, container: Any, initial_focus: Any = None) -> Any:
        """容器临时接管焦点。

        :returns: 接管后容器内获得焦点的元素 id（容器内无可用元素时为 None）
        """
        if any(frame.container == container for frame in self._frames):
            raise FocusError(
                ErrorCode.SCOPE_ALREADY_ACTIVE,
                f"容器 {container!r} 已在接管栈中，不得重复接管",
                container=container,
            )

        return_to = self._current
        return_container = (
            self._elements[return_to].container if return_to in self._elements else None
        )

        if initial_focus is not None:
            target_element = self._elements.get(initial_focus)
            if target_element is None or not target_element.usable:
                raise FocusError(
                    ErrorCode.INVALID_SCOPE_TARGET,
                    f"接管初始焦点 {initial_focus!r} 不存在或不可用",
                    container=container,
                    target=initial_focus,
                )
            if target_element.container != container:
                raise FocusError(
                    ErrorCode.INVALID_SCOPE_TARGET,
                    (
                        f"接管初始焦点 {initial_focus!r} 位于容器 "
                        f"{target_element.container!r}，不属于接管容器 {container!r}"
                    ),
                    container=container,
                    target=initial_focus,
                )
            target_id = initial_focus
        else:
            pool = self._usable_elements_in(container)
            target_id = pool[0].id if pool else None

        previous = self._current
        self._frames.append(_ScopeFrame(container, return_to, return_container))
        self._current = target_id
        if target_id is None:
            # 进入一个空弹层：焦点丢失锚点在该容器内，等待可用元素出现。
            self._lost = {
                "anchor": return_to,
                "container": container,
                "reason": "scope-empty",
            }
        else:
            self._lost = None
        self._append_history(
            "scope-enter",
            previous,
            target_id,
            detail={"container": container, "return_to": return_to},
        )
        return target_id

    def exit_scope(self, container: Any = None) -> Any:
        """结束栈顶接管并恢复焦点。

        :returns: 恢复后的焦点 id；接管前元素已失效时为最近可用回退元素，
                  无任何可用元素时为 None
        """
        if not self._frames:
            raise FocusError(
                ErrorCode.SCOPE_NOT_ACTIVE,
                "当前没有活动的焦点接管，无法结束",
            )
        frame = self._frames[-1]
        if container is not None and container != frame.container:
            raise FocusError(
                ErrorCode.SCOPE_MISMATCH,
                (
                    f"请求结束容器 {container!r} 的接管，但栈顶是 "
                    f"{frame.container!r}，嵌套接管必须按后进先出结束"
                ),
                container=container,
                top_container=frame.container,
            )

        self._frames.pop()
        previous = self._current
        active = self.active_container
        recovered = False
        target_id: Any = None

        if frame.return_to is None:
            # 接管前本就没有焦点：退出后保持无焦点，不擅自抢夺。
            target_id = None
            self._lost = None
        else:
            ret_element = self._elements.get(frame.return_to)
            if (
                ret_element is not None
                and ret_element.usable
                and (active is None or ret_element.container == active)
            ):
                target_id = frame.return_to
                recovered = True
            else:
                hint = ret_element.container if ret_element is not None else frame.return_container
                fallback = self._pick_fallback(
                    anchor=frame.return_to,
                    container_hint=hint,
                    scope_container=active,
                )
                target_id = fallback.id if fallback is not None else None
                if target_id is None:
                    self._lost = {
                        "anchor": frame.return_to,
                        "container": hint,
                        "reason": "scope-return-unavailable",
                    }

        self._current = target_id
        self._append_history(
            "scope-exit",
            previous,
            target_id,
            detail={
                "container": frame.container,
                "return_to": frame.return_to,
                "recovered": recovered,
                "fallback": (not recovered) if frame.return_to is not None else False,
            },
        )
        return target_id

    def scope_stack(self) -> List[Dict[str, Any]]:
        return [
            {"container": f.container, "return_to": f.return_to}
            for f in self._frames
        ]

    def nearest_usable(self, anchor: Any, container_hint: Any = _UNSET) -> Any:
        """按声明式回退规则计算离 ``anchor`` 最近的可用元素 id。

        规则与焦点丢失时的自动回退完全相同：接管中只在接管容器内挑选；
        否则优先同容器（``container_hint`` 默认为 anchor 所在容器），
        同容器无可用元素时扩大到全局；取 id 不大于 anchor 的最大者，
        没有前驱时取 id 大于 anchor 的最小者。无候选返回 None。
        该结果只取决于最终配置，与历史增删顺序无关。
        """
        active = self.active_container
        if container_hint is _UNSET:
            anchor_element = self._elements.get(anchor)
            hint = anchor_element.container if anchor_element is not None else None
        else:
            hint = container_hint
        picked = self._pick_fallback(
            anchor=anchor,
            container_hint=hint,
            scope_container=active,
        )
        return picked.id if picked is not None else None

    # ------------------------------------------------------------------
    # 环检测
    # ------------------------------------------------------------------

    def find_cycles(self, direction: str = None) -> List[Cycle]:
        """列出（指定方向或全部方向上的）所有环。

        函数图中每个弱连通分量至多一个环。环序列统一从最小 id 开始，
        多环结果按 (方向注册序, 环序列) 稳定排序；已存在的环不会被
        静默忽略。
        """
        if direction is not None and direction not in self._dir_index:
            raise FocusError(
                ErrorCode.UNKNOWN_DIRECTION,
                f"未知方向 {direction!r}",
                direction=direction,
            )
        dirs = (direction,) if direction is not None else self._directions
        results: List[Tuple[int, Tuple[Any, ...], str]] = []

        for d in dirs:
            globally_done: set = set()
            for start in sorted(self._elements, key=_id_key):
                if start in globally_done:
                    continue
                positions: Dict[Any, int] = {}
                order: List[Any] = []
                cur: Any = start
                while (
                    cur is not None
                    and cur in self._elements
                    and cur not in globally_done
                    and cur not in positions
                ):
                    positions[cur] = len(order)
                    order.append(cur)
                    nxt = self._edges.get(cur, {}).get(d)
                    cur = nxt if nxt in self._elements else None
                if cur is not None and cur in positions:
                    nodes = self._normalize_cycle(tuple(order[positions[cur] :]))
                    results.append((self._dir_index[d], nodes, d))
                globally_done.update(order)

        results.sort(key=lambda item: (item[0], tuple(_id_key(x) for x in item[1])))
        return [Cycle(direction=d, nodes=nodes) for _, nodes, d in results]

    def _cycle_for_edge(
        self, source: Any, direction: str, target: Any
    ) -> Optional[Tuple[Any, ...]]:
        """判断边 source -> target 本身是否位于环上。

        当且仅当从 target 沿同方向最终能回到 source（轨迹必然先汇回
        target，构成包含该边的唯一环）时成立。只是"下游远处存在环"
        的汇入尾巴不在此列：单次按键只跨越一条边，走上尾巴不会循环，
        连续成功推进也永远不会重复经过节点。
        """
        cur: Any = target
        seen = {target}
        while True:
            nxt = self._edges.get(cur, {}).get(direction)
            if nxt is None or nxt not in self._elements:
                return None
            if nxt == source:
                # 环序列从 source 出发：source -> target -> ... -> source
                return self._trace_cycle(source, direction)
            if nxt in seen:
                # 汇入了一个不含 source 的环：该边是尾巴而非环边
                return None
            seen.add(nxt)
            cur = nxt

    def _trace_cycle(self, start: Any, direction: str) -> Tuple[Any, ...]:
        """从环上节点 start 出发收集环，再规范化为从最小 id 开始。"""
        nodes: List[Any] = [start]
        cur = start
        while True:
            nxt = self._edges[cur][direction]
            if nxt == start:
                return self._normalize_cycle(tuple(nodes))
            nodes.append(nxt)
            cur = nxt

    @staticmethod
    def _normalize_cycle(nodes: Tuple[Any, ...]) -> Tuple[Any, ...]:
        if not nodes:
            return nodes
        min_index = min(range(len(nodes)), key=lambda i: _id_key(nodes[i]))
        return nodes[min_index:] + nodes[:min_index]

    # ------------------------------------------------------------------
    # 查询（需求 7）：全部按稳定顺序返回
    # ------------------------------------------------------------------

    def is_focusable(self, id: Any) -> bool:
        """元素当前可否接收焦点（存在且 focusable 且未禁用）。"""
        return self._require_element(id).usable

    def get_element(self, id: Any) -> Dict[str, Any]:
        return self._require_element(id).to_dict()

    def get_container(self, id: Any) -> Any:
        return self._require_element(id).container

    def get_target(self, id: Any, direction: str) -> Any:
        """某方向的直接目标；无关系返回 None。"""
        self._require_element(id)
        if direction not in self._dir_index:
            raise FocusError(
                ErrorCode.UNKNOWN_DIRECTION,
                f"未知方向 {direction!r}",
                direction=direction,
            )
        return self._edges.get(id, {}).get(direction)

    def targets(self, id: Any) -> Dict[str, Any]:
        """全部方向的目标（按方向注册顺序；无关系的方向值为 None）。"""
        self._require_element(id)
        edges = self._edges.get(id, {})
        return {d: edges.get(d) for d in self._directions}

    def relations_of(self, id: Any) -> List[Dict[str, Any]]:
        """实际配置了的方向关系，按方向注册顺序返回。"""
        self._require_element(id)
        edges = self._edges.get(id, {})
        return [
            {"direction": d, "target": edges[d]}
            for d in self._directions
            if d in edges
        ]

    def describe_element(self, id: Any) -> Dict[str, Any]:
        element = self._require_element(id)
        data = element.to_dict()
        data["targets"] = self.targets(id)
        data["relations"] = self.relations_of(id)
        data["is_current_focus"] = self._current == id
        return data

    def list_elements(self) -> List[Dict[str, Any]]:
        """所有元素的稳定排序视图（按 id 全序）。"""
        return [
            self.describe_element(element.id)
            for element in sorted(self._elements.values(), key=lambda e: _id_key(e.id))
        ]

    def history(self) -> List[Dict[str, Any]]:
        return [entry.to_dict() for entry in self._history]

    @property
    def last_rejection(self) -> Optional[Dict[str, Any]]:
        return self._last_rejection.to_dict() if self._last_rejection else None

    # ------------------------------------------------------------------
    # 快照 / 重建 / 完整性校验（支撑需求 3、6 的等价性验收）
    # ------------------------------------------------------------------

    def graph_snapshot(self) -> Dict[str, Any]:
        """声明式结构状态：元素、关系、当前焦点与接管容器。

        不含历史流水等运行时痕迹；两份语义相同的配置必然产生相同快照，
        与配置到达顺序无关。
        """
        elements = sorted(
            (
                (e.id, e.container, bool(e.focusable), bool(e.disabled))
                for e in self._elements.values()
            ),
            key=lambda item: _id_key(item[0]),
        )
        relations = sorted(
            (
                (source, direction, target)
                for source, by_dir in self._edges.items()
                for direction, target in by_dir.items()
            ),
            key=lambda item: (
                self._dir_index[item[1]],
                _id_key(item[0]),
                _id_key(item[2]),
            ),
        )
        return {
            "directions": self._directions,
            "elements": [tuple(item) for item in elements],
            "relations": relations,
            "focus": self._current,
            "active_container": self.active_container,
        }

    def rebuild(self) -> "FocusEngine":
        """用当前声明式配置从头重建一台引擎并放置当前焦点。

        接管栈与历史属于运行时状态，不参与重建；结构与焦点位置与
        增量维护的引擎一致（由验收测试断言）。
        """
        snapshot = self.graph_snapshot()
        fresh = FocusEngine(snapshot["directions"], history_limit=self._history.maxlen)
        for id, container, focusable, disabled in snapshot["elements"]:
            fresh.add_element(id, container, focusable, disabled)
        for source, direction, target in snapshot["relations"]:
            fresh.add_relation(source, direction, target)
        if snapshot["focus"] is not None:
            fresh.set_focus(snapshot["focus"])
        return fresh

    # ------------------------------------------------------------------
    # 完整运行时状态的导出 / 导入（往返不丢接管栈、历史与最近拒绝）
    # ------------------------------------------------------------------

    STATE_VERSION = 1

    def export_state(self) -> Dict[str, Any]:
        """导出**完整运行时状态**为 JSON 安全的普通 dict。

        与只含声明式结构的 :meth:`graph_snapshot` 不同，导出包含接管栈
        （含每层的返回元素）、焦点历史、最近一次拒绝、序号计数器等，
        :meth:`import_state` 可无损恢复。
        """
        return {
            "version": self.STATE_VERSION,
            "directions": list(self._directions),
            "history_limit": self._history.maxlen,
            "elements": [
                {
                    "id": e.id,
                    "container": e.container,
                    "focusable": bool(e.focusable),
                    "disabled": bool(e.disabled),
                }
                for e in sorted(self._elements.values(), key=lambda e: _id_key(e.id))
            ],
            "relations": [
                {"source": s, "direction": d, "target": t}
                for s, d, t in sorted(
                    (
                        (s, d, t)
                        for s, by_dir in self._edges.items()
                        for d, t in by_dir.items()
                    ),
                    key=lambda triple: (
                        self._dir_index[triple[1]],
                        _id_key(triple[0]),
                        _id_key(triple[2]),
                    ),
                )
            ],
            "current": self._current,
            "frames": [
                {
                    "container": f.container,
                    "return_to": f.return_to,
                    "return_container": f.return_container,
                }
                for f in self._frames
            ],
            "lost": copy.deepcopy(self._lost),
            "seq": self._seq,
            "history": [entry.to_dict() for entry in self._history],
            "last_rejection": (
                self._last_rejection.to_dict() if self._last_rejection else None
            ),
        }

    def to_json(self, indent: int = 2) -> str:
        """导出为 JSON 字符串（id/container 须是 JSON 可序列化类型）。"""
        return json.dumps(self.export_state(), ensure_ascii=False, indent=indent)

    @classmethod
    def import_state(cls, state: Mapping[str, Any], *, strict: bool = True) -> "FocusEngine":
        """从 :meth:`export_state` 的产物完整恢复一台引擎。

        :param strict: True 时对任何结构/不变量违例抛 :class:`FocusError`；
            非法状态绝不会部分导入。
        """
        if not isinstance(state, Mapping):
            raise FocusError(
                ErrorCode.ELEMENT_NOT_FOUND,
                "导入状态必须是 dict（export_state/to_json 的产物）",
            )
        version = state.get("version", cls.STATE_VERSION)
        if version != cls.STATE_VERSION:
            raise FocusError(
                ErrorCode.ELEMENT_NOT_FOUND,
                f"不支持的状态版本 {version!r}，当前版本为 {cls.STATE_VERSION}",
                version=version,
            )

        raw_dirs = state.get("directions")
        if not isinstance(raw_dirs, (list, tuple)) or not raw_dirs:
            raise FocusError(ErrorCode.UNKNOWN_DIRECTION, "导入状态缺少合法 directions")
        directions = tuple(raw_dirs)
        if len(set(directions)) != len(directions):
            raise FocusError(
                ErrorCode.UNKNOWN_DIRECTION,
                f"导入状态的方向存在重复: {directions!r}",
            )

        history_limit = state.get("history_limit", 1000)
        engine = cls(directions, history_limit=history_limit)
        try:
            raw_elements = state.get("elements", [])
            if not isinstance(raw_elements, (list, tuple)):
                raise FocusError(ErrorCode.ELEMENT_NOT_FOUND, "elements 必须是列表")
            seen_ids = set()
            for item in raw_elements:
                if not isinstance(item, Mapping) or "id" not in item or "container" not in item:
                    raise FocusError(
                        ErrorCode.ELEMENT_NOT_FOUND,
                        f"非法元素记录: {item!r}",
                    )
                if item["id"] in seen_ids:
                    raise FocusError(
                        ErrorCode.DUPLICATE_ELEMENT,
                        f"导入状态中元素 id 重复: {item['id']!r}",
                        id=item["id"],
                    )
                seen_ids.add(item["id"])
                engine.add_element(
                    item["id"],
                    item["container"],
                    focusable=bool(item.get("focusable", True)),
                    disabled=bool(item.get("disabled", False)),
                )

            for item in state.get("relations", []):
                if not isinstance(item, Mapping) or not all(
                    k in item for k in ("source", "direction", "target")
                ):
                    raise FocusError(
                        ErrorCode.RELATION_CONFLICT,
                        f"非法关系记录: {item!r}",
                    )
                engine.add_relation(item["source"], item["direction"], item["target"])

            raw_frames = state.get("frames", [])
            if not isinstance(raw_frames, (list, tuple)):
                raise FocusError(ErrorCode.SCOPE_MISMATCH, "frames 必须是列表")
            frames: List[_ScopeFrame] = []
            active_containers = set()
            for item in raw_frames:
                if not isinstance(item, Mapping) or "container" not in item:
                    raise FocusError(
                        ErrorCode.SCOPE_MISMATCH, f"非法接管帧: {item!r}"
                    )
                if item["container"] in active_containers:
                    raise FocusError(
                        ErrorCode.SCOPE_ALREADY_ACTIVE,
                        f"导入的接管栈中容器重复: {item['container']!r}",
                        container=item["container"],
                    )
                active_containers.add(item["container"])
                frames.append(
                    _ScopeFrame(
                        container=item["container"],
                        return_to=item.get("return_to"),
                        return_container=item.get("return_container"),
                    )
                )
            engine._frames = frames

            raw_history = state.get("history", [])
            if not isinstance(raw_history, (list, tuple)):
                raise FocusError(ErrorCode.ELEMENT_NOT_FOUND, "history 必须是列表")
            history: Deque[HistoryEntry] = deque(maxlen=history_limit)
            for item in raw_history:
                if not isinstance(item, Mapping) or "seq" not in item or "kind" not in item:
                    raise FocusError(
                        ErrorCode.ELEMENT_NOT_FOUND,
                        f"非法历史记录: {item!r}",
                    )
                history.append(
                    HistoryEntry(
                        seq=int(item["seq"]),
                        kind=str(item["kind"]),
                        source=item.get("source"),
                        target=item.get("target"),
                        direction=item.get("direction"),
                        detail=dict(item.get("detail", {})),
                    )
                )
            engine._history = history

            raw_rejection = state.get("last_rejection")
            if raw_rejection is not None:
                if not isinstance(raw_rejection, Mapping) or "code" not in raw_rejection:
                    raise FocusError(
                        ErrorCode.ELEMENT_NOT_FOUND,
                        f"非法最近拒绝记录: {raw_rejection!r}",
                    )
                cycle_raw = raw_rejection.get("cycle")
                engine._last_rejection = Rejection(
                    seq=int(raw_rejection.get("seq", 0)),
                    direction=raw_rejection.get("direction"),
                    at=raw_rejection.get("at"),
                    code=str(raw_rejection["code"]),
                    message=str(raw_rejection.get("message", "")),
                    target=raw_rejection.get("target"),
                    container=raw_rejection.get("container"),
                    cycle=tuple(cycle_raw) if cycle_raw is not None else None,
                )

            engine._lost = copy.deepcopy(state.get("lost"))
            engine._seq = int(state.get("seq", 0))
            engine._current = state.get("current")

            if strict:
                problems = engine.validate_integrity()
                if problems:
                    raise FocusError(
                        ErrorCode.ELEMENT_NOT_FOUND,
                        "导入状态未通过不变量校验: " + "; ".join(problems),
                        problems=problems,
                    )
        except FocusError:
            raise
        except Exception as exc:  # 脏数据（类型错误等）一律拒绝，不部分导入
            raise FocusError(
                ErrorCode.ELEMENT_NOT_FOUND,
                f"导入状态格式非法: {exc}",
            ) from exc
        return engine

    @classmethod
    def from_json(cls, text: str, *, strict: bool = True) -> "FocusEngine":
        """从 :meth:`to_json` 的 JSON 字符串恢复引擎。"""
        try:
            state = json.loads(text)
        except json.JSONDecodeError as exc:
            raise FocusError(
                ErrorCode.ELEMENT_NOT_FOUND,
                f"导入内容不是合法 JSON: {exc}",
            ) from exc
        return cls.import_state(state, strict=strict)

    def validate_integrity(self) -> List[str]:
        """返回自检发现的问题列表；空列表表示所有不变量成立。"""
        problems: List[str] = []

        for source, by_dir in self._edges.items():
            if source not in self._elements:
                problems.append(f"边属于已删除元素 {source!r}")
            for direction, target in by_dir.items():
                if target not in self._elements:
                    problems.append(
                        f"存在悬空关系 {source!r} --{direction}--> {target!r}"
                    )
                else:
                    sources = self._incoming.get(target, {}).get(direction, set())
                    if source not in sources:
                        problems.append(
                            f"反向索引缺失 {source!r} --{direction}--> {target!r}"
                        )

        for target, by_dir in self._incoming.items():
            if target not in self._elements:
                problems.append(f"反向索引属于已删除元素 {target!r}")
            for direction, sources in by_dir.items():
                for source in sources:
                    if self._edges.get(source, {}).get(direction) != target:
                        problems.append(
                            f"反向索引残留 {source!r} --{direction}--> {target!r}"
                        )

        if self._current is not None:
            current = self._elements.get(self._current)
            if current is None:
                problems.append(f"当前焦点 {self._current!r} 不存在")
            elif not current.usable:
                problems.append(f"当前焦点 {self._current!r} 不可用")
            elif self.active_container is not None and current.container != self.active_container:
                problems.append(
                    f"当前焦点 {self._current!r} 逃逸出接管容器 "
                    f"{self.active_container!r}"
                )
        return problems

    # ------------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------------

    def _require_element(self, id: Any) -> Element:
        element = self._elements.get(id)
        if element is None:
            raise FocusError(
                ErrorCode.ELEMENT_NOT_FOUND,
                f"元素 {id!r} 不存在",
                id=id,
            )
        return element

    def _reject(
        self,
        direction: str,
        at: Any,
        code: str,
        message: str,
        *,
        target: Any = None,
        container: Any = None,
        cycle: Optional[Tuple[Any, ...]] = None,
    ) -> MoveResult:
        self._seq += 1
        rejection = Rejection(
            seq=self._seq,
            direction=direction if direction in self._dir_index else None,
            at=at,
            code=code,
            message=message,
            target=target,
            container=container,
            cycle=tuple(cycle) if cycle is not None else None,
        )
        self._last_rejection = rejection
        return MoveResult(
            accepted=False,
            direction=direction,
            source=at,
            target=target,
            rejection=rejection,
        )

    def _append_history(
        self,
        kind: str,
        source: Any,
        target: Any,
        *,
        direction: str = None,
        detail: Dict[str, Any] = None,
    ) -> int:
        self._seq += 1
        entry = HistoryEntry(
            seq=self._seq,
            kind=kind,
            source=source,
            target=target,
            direction=direction,
            detail=dict(detail or {}),
        )
        self._history.append(entry)
        return self._seq

    def _usable_elements_in(self, container: Any) -> List[Element]:
        return sorted(
            (
                e
                for e in self._elements.values()
                if e.container == container and e.usable
            ),
            key=lambda e: _id_key(e.id),
        )

    def _pick_fallback(
        self,
        anchor: Any,
        container_hint: Any,
        *,
        scope_container: Any = None,
    ) -> Optional[Element]:
        """声明式“最近可用元素”规则（与历史增删顺序无关）：

        1. 接管中：只在接管容器内挑选；否则优先与锚点同容器，
           同容器没有可用元素时才扩大到全局；
        2. 在候选中取 id 不大于锚点的最大者（前驱），没有前驱时
           取 id 大于锚点的最小者（后继）；锚点为 None 时取最小 id；
        3. 没有任何候选返回 None。
        """
        usable = [e for e in self._elements.values() if e.usable]
        if scope_container is not None:
            pool = [e for e in usable if e.container == scope_container]
        else:
            same = [e for e in usable if e.container == container_hint]
            pool = same if same else usable
        if not pool:
            return None
        ordered = sorted(pool, key=lambda e: _id_key(e.id))
        if anchor is None:
            return ordered[0]
        anchor_key = _id_key(anchor)
        predecessors = [e for e in ordered if _id_key(e.id) <= anchor_key]
        return predecessors[-1] if predecessors else ordered[0]

    def _fallback_from(self, element: Element, *, reason: str) -> None:
        active = self.active_container
        target = self._pick_fallback(
            anchor=element.id,
            container_hint=element.container,
            scope_container=active,
        )
        self._current = target.id if target is not None else None
        if target is None:
            self._lost = {
                "anchor": element.id,
                "container": active if active is not None else element.container,
                "reason": reason,
            }
        self._append_history(
            "fallback",
            element.id,
            self._current,
            detail={"reason": reason},
        )

    def _recover_lost_focus(self) -> None:
        if self._current is not None or not self._lost:
            return
        active = self.active_container
        target = self._pick_fallback(
            anchor=self._lost["anchor"],
            container_hint=self._lost["container"],
            scope_container=active,
        )
        if target is None:
            return
        self._current = target.id
        self._append_history(
            "refocus",
            None,
            target.id,
            detail={"reason": self._lost.get("reason")},
        )
        self._lost = None

    def _runtime_state(self) -> Dict[str, Any]:
        return {
            "directions": self._directions,
            "dir_index": self._dir_index,
            "elements": self._elements,
            "edges": self._edges,
            "incoming": self._incoming,
            "current": self._current,
            "frames": self._frames,
            "lost": self._lost,
            "seq": self._seq,
            "history": self._history,
            "last_rejection": self._last_rejection,
            "history_limit": self._history.maxlen,
        }

    def _restore_runtime_state(self, state: Dict[str, Any]) -> None:
        self._directions = state["directions"]
        self._dir_index = state["dir_index"]
        self._elements = state["elements"]
        self._edges = state["edges"]
        self._incoming = state["incoming"]
        self._current = state["current"]
        self._frames = state["frames"]
        self._lost = state["lost"]
        self._seq = state["seq"]
        self._history = state["history"]
        self._last_rejection = state["last_rejection"]

    def _hard_reset(self) -> None:
        self._elements = {}
        self._edges = {}
        self._incoming = {}
        self._current = None
        self._frames = []
        self._lost = None
        self._seq = 0
        self._history = deque(maxlen=self._history.maxlen)
        self._last_rejection = None
