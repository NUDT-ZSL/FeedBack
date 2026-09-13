"""离线消息总线内核。

仅依赖 Python 标准库，由可注入的逻辑时钟驱动，不接真实网络。

核心概念：
- :class:`Message`：总线上的一条消息（msg_id 全局唯一）。
- :class:`Subscription`：订阅者及其主题过滤 / 最小优先级阈值 / 背压配置。
- :class:`MessageBus`：总线内核，负责按主题路由、按优先级投递、
  ack 确认、掉线/超时重投递、背压与队列溢出策略、JSON 快照持久化。

投递顺序：优先级降序 -> produced_at 升序 -> msg_id 字典序，全序稳定。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple


class BusError(Exception):
    """总线可预期错误（非法参数、重复 id、引用不存在、快照损坏等）。"""


class OverflowPolicy(str, Enum):
    """待投递队列超过 ``max_queue`` 时 publish 的处理策略。"""

    REJECT = "reject"
    """拒绝新消息（默认）：该订阅者不接收，publish 结果中列入 dropped。"""

    DROP_LOWEST = "drop_lowest"
    """丢弃“队列中 + 新消息”里最低优先级的那条。

    比较规则：优先级最低者淘汰；并列时 produced_at 最大者淘汰；
    再并列 msg_id 字典序最大者淘汰。因此当新消息本身就是最低优先级时，
    效果等同于拒绝新消息（旧队列保持不变）。
    """


class UnsubscribePolicy(str, Enum):
    """订阅者注销时其待投递 / 未确认消息的处理策略。

    规范值为 ``cleanup`` 与 ``transfer``；``drop`` 作为 ``cleanup`` 的
    旧别名保留（旧快照里的 ``"drop"`` 仍可正常加载，行为一致）。
    """

    CLEANUP = "cleanup"
    """直接清理该订阅者持有的消息，并在状态中累计清理条数。

    消息本体仅在没有任何其他订阅者持有时才删除，其他订阅者队列中的副本保留。
    """

    TRANSFER = "transfer"
    """转移给在线、同主题（过滤器匹配）、队列未满、且尚未持有该消息的
    其他订阅者，并在状态中累计转移条数。

    消息按原优先级全序转移（接收方队列重新按优先级排序，不依赖追加顺序）；
    没有任何合格接收者时归入 cleanup 清理。若消息本来就被其他订阅者持有，
    则仅解除注销者的引用（计入 retained，不计清理/转移）。
    """

    DROP = "cleanup"
    """``cleanup`` 的旧名别名（``UnsubscribePolicy.DROP is CLEANUP``）。

    旧快照/旧调用里出现的字符串 ``"drop"`` 由 :meth:`_missing_` 归一到
    ``cleanup``；枚举序列化为规范值 ``"cleanup"``。
    """

    @classmethod
    def _missing_(cls, value: object) -> "Optional[UnsubscribePolicy]":
        # 旧快照/旧参数中的 "drop" 归一到 cleanup，行为完全一致。
        if value == "drop":
            return cls.CLEANUP
        return None


@dataclass(frozen=True)
class Message:
    """一条不可变消息。

    :ivar msg_id: 非空字符串，全局唯一。
    :ivar topic: 非空字符串，主题名。
    :ivar priority: 整数，越大越优先。
    :ivar payload: 任意可 JSON 序列化对象。
    :ivar produced_at: 生产时的逻辑时钟整数，允许乱序。
    """

    msg_id: str
    topic: str
    priority: int
    payload: Any = None
    produced_at: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "msg_id": self.msg_id,
            "topic": self.topic,
            "priority": self.priority,
            "payload": self.payload,
            "produced_at": self.produced_at,
        }

    @staticmethod
    def from_dict(d: Any) -> "Message":
        if not isinstance(d, dict):
            raise BusError("message must be a JSON object")
        for k in ("msg_id", "topic", "priority", "produced_at"):
            if k not in d:
                raise BusError(f"message missing field: {k}")
        msg_id = d["msg_id"]
        topic = d["topic"]
        priority = d["priority"]
        produced_at = d["produced_at"]
        if not isinstance(msg_id, str) or not msg_id:
            raise BusError("msg_id must be a non-empty string")
        if not isinstance(topic, str) or not topic:
            raise BusError("topic must be a non-empty string")
        # bool 是 int 的子类，按非整数拒绝。
        if not isinstance(priority, int) or isinstance(priority, bool):
            raise BusError("priority must be an integer")
        if not isinstance(produced_at, int) or isinstance(produced_at, bool):
            raise BusError("produced_at must be an integer")
        return Message(
            msg_id=msg_id,
            topic=topic,
            priority=priority,
            payload=d.get("payload"),
            produced_at=produced_at,
        )


@dataclass
class _Pending:
    """订阅者待投递队列中的一个条目。"""

    msg_id: str
    enqueued_at: int  # 进入该订阅者队列的逻辑时刻（掉线回队/转移时刷新）
    redelivered: bool = False


@dataclass
class _Inflight:
    """已投递未确认（in-flight）的一个条目。"""

    msg_id: str
    delivered_at: int
    delivery_no: int  # 第几次投递给该订阅者（从 1 开始）
    redelivered: bool


@dataclass
class Subscription:
    """订阅者配置。

    :ivar sub_id: 非空字符串，订阅者标识。
    :ivar topics: 主题白名单；非空时只投递其中主题，空集合表示订阅全部主题。
    :ivar min_priority: 最小优先级阈值（含），低于该值的消息不投递。
    :ivar max_inflight: 未确认消息上限；为 0 时永远处于背压，deliver 返回空。
    :ivar max_queue: 待投递队列上限；为 0 时不接收任何新消息。
    :ivar ack_timeout: 未确认超时（逻辑时钟单位）；None 表示不超时。
    :ivar online: 是否在线。
    """

    sub_id: str
    topics: Set[str] = field(default_factory=set)
    min_priority: int = 0
    max_inflight: int = 100
    max_queue: int = 1000
    ack_timeout: Optional[int] = None
    online: bool = True


class _Clock:
    """可注入的简单逻辑时钟：可调用返回当前值，:meth:`advance` 推进。"""

    def __init__(self, start: int = 0) -> None:
        self.t = start

    def __call__(self) -> int:
        return self.t

    def advance(self, n: int) -> int:
        self.t += n
        return self.t


def _delivery_key(bus: "MessageBus", msg_id: str) -> Tuple[int, int, str]:
    """全局投递顺序键：priority 降序、produced_at 升序、msg_id 升序。"""
    m = bus._messages[msg_id]
    return (-m.priority, m.produced_at, m.msg_id)


class MessageBus:
    """离线消息总线内核。

    逻辑时钟通过构造函数注入（任何无参数、返回单调不减整数的可调用对象），
    默认使用一个内部 :class:`_Clock`，可用 :meth:`tick` 手动推进。
    """

    STATE_VERSION = 1

    def __init__(
        self,
        clock: Optional[Callable[[], int]] = None,
        overflow_policy: "OverflowPolicy | str" = OverflowPolicy.REJECT,
        unsubscribe_policy: "UnsubscribePolicy | str" = UnsubscribePolicy.CLEANUP,
    ) -> None:
        if clock is not None and not callable(clock):
            raise BusError("clock must be a zero-argument callable returning an integer")
        self._external_clock = clock is not None
        self._clock_impl: Any = _Clock(0) if clock is None else clock
        try:
            self.overflow_policy = OverflowPolicy(overflow_policy)
            self.unsubscribe_policy = UnsubscribePolicy(unsubscribe_policy)
        except ValueError as e:
            raise BusError(f"invalid policy: {e}") from None

        self._messages: Dict[str, Message] = {}
        self._known_topics: Set[str] = set()
        self._subs: Dict[str, Subscription] = {}
        # sub_id -> 待投递条目（一个 msg_id 在同一队列中至多出现一次）
        self._pending: Dict[str, List[_Pending]] = {}
        # sub_id -> msg_id -> in-flight 条目
        self._inflight: Dict[str, Dict[str, _Inflight]] = {}
        # sub_id -> 该订阅者的投递历史顺序（重投递会重复出现同一 msg_id）
        self._delivery_order: Dict[str, List[str]] = {}
        # sub_id -> 已确认 msg_id 集合（幂等去重，同时阻止再次投递）
        self._acked: Dict[str, Set[str]] = {}
        # msg_id -> 仍持有该消息（待投递或未确认）的 sub_id 集合
        self._refs: Dict[str, Set[str]] = {}

        self.backpressure_count: Dict[str, int] = {}
        self.redelivered_count: Dict[str, int] = {}
        self.dropped_count: int = 0
        # 注销导致的消息去向累计计数（总线级，注销后仍可在 state 中查到）。
        self.unsubscribe_cleanup_count: int = 0
        self.unsubscribe_transfer_count: int = 0

    # ------------------------------------------------------------------ #
    # 时钟
    # ------------------------------------------------------------------ #
    def now(self) -> int:
        """返回当前逻辑时钟值。"""
        return int(self._clock_impl())

    def tick(self, n: int = 1) -> int:
        """推进内部默认时钟 n 个单位，返回推进后的时钟值。

        注入外部时钟时不可用（会抛 :class:`BusError`），请直接推进外部时钟。
        """
        if self._external_clock:
            raise BusError("external clock is in use; advance it directly")
        if not isinstance(n, int) or isinstance(n, bool) or n < 0:
            raise BusError("tick must be a non-negative integer")
        return self._clock_impl.advance(n)

    # ------------------------------------------------------------------ #
    # 发布与路由
    # ------------------------------------------------------------------ #
    def publish(self, message: "Message | Dict[str, Any]") -> Dict[str, Any]:
        """发布一条消息：只入队，不立即投递。

        消息路由到所有匹配（主题 + 最小优先级）的订阅者，**包括当前离线的
        订阅者**（离线期间消息照常排队，上线后即可投递）。没有任何匹配
        订阅者时，消息本体仍保留在总线中，可通过 :meth:`get_message` 查询。

        :returns: ``{accepted, routed, dropped, reason}``：
            - routed：成功入队的 sub_id（字典序）；
            - dropped：因队列满 / max_queue=0 未接收的 sub_id；
            - 只有至少一个订阅者接收时 accepted 才为 True。
        :raises BusError: msg_id 重复、消息字段非法或 payload 不可 JSON 序列化。
        """
        msg = message if isinstance(message, Message) else Message.from_dict(message)
        if msg.msg_id in self._messages:
            raise BusError(f"duplicate msg_id: {msg.msg_id}")
        try:
            json.dumps(msg.payload)
        except (TypeError, ValueError) as e:
            raise BusError(f"payload of {msg.msg_id} is not JSON serializable: {e}") from None

        self._messages[msg.msg_id] = msg
        self._known_topics.add(msg.topic)

        routed: List[str] = []
        dropped: List[str] = []
        now = self.now()
        for sub_id, sub in self._subs.items():
            if not self._matches(sub, msg):
                continue
            if self._enqueue_one(sub_id, msg, now):
                routed.append(sub_id)
            else:
                dropped.append(sub_id)

        if dropped:
            self.dropped_count += len(dropped)
        return {
            "accepted": bool(routed),
            "routed": sorted(routed),
            "dropped": sorted(dropped),
            "reason": None if routed else "no matching subscriber with capacity",
        }

    def _enqueue_one(self, sub_id: str, msg: Message, now: int) -> bool:
        """把消息放入某订阅者的待投递队列，按溢出策略处理。成功入队返回 True。"""
        sub = self._subs[sub_id]
        q = self._pending[sub_id]
        if sub.max_queue == 0:
            return False
        if len(q) < sub.max_queue:
            q.append(_Pending(msg.msg_id, now))
            self._refs.setdefault(msg.msg_id, set()).add(sub_id)
            return True

        if self.overflow_policy is OverflowPolicy.REJECT:
            return False

        # DROP_LOWEST：在“现有队列 + 新消息”中找最低优先级者。
        victim = 0
        for i in range(1, len(q)):
            if self._is_lower(q[i].msg_id, q[victim].msg_id):
                victim = i
        if self._is_lower(q[victim].msg_id, msg.msg_id):
            # 旧消息比新消息更低 → 淘汰旧消息（抹掉它在该订阅者的痕迹），放入新消息。
            old = q.pop(victim)
            self._evict(sub_id, old.msg_id)
            q.append(_Pending(msg.msg_id, now))
            self._refs.setdefault(msg.msg_id, set()).add(sub_id)
            return True
        # 新消息本身最低（或并列最低中排序最靠后）→ 拒绝新消息。
        return False

    def _is_lower(self, a: str, b: str) -> bool:
        """消息 a 在投递意义上是否“低于”消息 b（用于找最低优先级受害者）。"""
        ma, mb = self._messages[a], self._messages[b]
        if ma.priority != mb.priority:
            return ma.priority < mb.priority
        if ma.produced_at != mb.produced_at:
            return ma.produced_at > mb.produced_at  # 越晚产生的，在“最低”评选中越靠后
        return ma.msg_id > mb.msg_id  # 字典序越大越“低”

    @staticmethod
    def _matches(sub: Subscription, msg: Message) -> bool:
        if sub.topics and msg.topic not in sub.topics:
            return False
        if msg.priority < sub.min_priority:
            return False
        return True

    # ------------------------------------------------------------------ #
    # 订阅
    # ------------------------------------------------------------------ #
    def subscribe(
        self,
        sub_id: str,
        topics: Optional[Iterable[str]] = None,
        min_priority: int = 0,
        max_inflight: int = 100,
        max_queue: int = 1000,
        ack_timeout: Optional[int] = None,
        online: bool = True,
    ) -> Dict[str, Any]:
        """注册或更新一个订阅者。

        已存在的 sub_id 会用新参数整体替换配置；其队列、未确认消息、
        投递历史、已确认集合与计数器全部保留，在线状态也保留（上下线请用
        :meth:`set_online`，``online`` 参数只在首次创建时生效）。过滤器与
        阈值的变更只影响**之后新发布**的消息，已进入队列的消息不受影响、
        仍会投递。调小 ``max_queue`` 不会立即裁剪现有队列（限制在下次
        入队时生效）；调小 ``max_inflight`` 也不回收已投递消息（后续
        deliver 立即进入背压）。
        """
        if not isinstance(sub_id, str) or not sub_id:
            raise BusError("sub_id must be a non-empty string")
        if not isinstance(min_priority, int) or isinstance(min_priority, bool):
            raise BusError("min_priority must be an integer")
        self._validate_limits(max_inflight, max_queue)
        if ack_timeout is not None and (
            not isinstance(ack_timeout, int) or isinstance(ack_timeout, bool) or ack_timeout < 0
        ):
            raise BusError("ack_timeout must be a non-negative integer or null")
        if not isinstance(online, bool):
            raise BusError("online must be a boolean")
        topic_set: Set[str] = set()
        for t in topics or ():
            if not isinstance(t, str) or not t:
                raise BusError("topics must be non-empty strings")
            topic_set.add(t)
        self._known_topics.update(topic_set)

        if sub_id not in self._subs:
            self._subs[sub_id] = Subscription(
                sub_id, set(topic_set), min_priority,
                max_inflight, max_queue, ack_timeout, online,
            )
            self._pending[sub_id] = []
            self._inflight[sub_id] = {}
            self._delivery_order[sub_id] = []
            self._acked[sub_id] = set()
            self.backpressure_count[sub_id] = 0
            self.redelivered_count[sub_id] = 0
            action = "created"
        else:
            sub = self._subs[sub_id]
            sub.topics = set(topic_set)
            sub.min_priority = min_priority
            sub.max_inflight = max_inflight
            sub.max_queue = max_queue
            sub.ack_timeout = ack_timeout
            # 在线状态保留：上下线只能通过 set_online 改变。
            action = "updated"
        return {"sub_id": sub_id, "action": action}

    @staticmethod
    def _validate_limits(max_inflight: Any, max_queue: Any) -> None:
        for name, val in (("max_inflight", max_inflight), ("max_queue", max_queue)):
            if not isinstance(val, int) or isinstance(val, bool) or val < 0:
                raise BusError(f"{name} must be a non-negative integer")

    def unsubscribe(self, sub_id: str,
                    policy: "Optional[UnsubscribePolicy | str]" = None) -> Dict[str, Any]:
        """注销订阅者，并按策略处理其待投递 / 未确认消息。

        :param policy: 覆盖总线默认的 :class:`UnsubscribePolicy`；
            ``"cleanup"``（规范名，旧名 ``"drop"`` 等价）或 ``"transfer"``。
        :returns: ``{sub_id, policy, transferred, retained, dropped,
            transferred_count, cleaned_up_count}``；id 列表按字典序。

            - transfer：每条消息转给在线、同主题（过滤器匹配）、队列未满且
              尚未持有它的其他订阅者；接收方之后按优先级全序取消息，
              原优先级顺序保持；其他订阅者本就持有的计入 retained；
              无处可去的落入 dropped（等同 cleanup）。
            - cleanup：该订阅者持有的消息全部清理；其他订阅者的副本保留，
              消息本体仅在无人持有时回收（不静默泄漏）。
            - cleaned_up_count/transferred_count 同时累计到总线级计数器，
              订阅者注销后仍可通过 :meth:`get_state` 查询。
        """
        self._require_sub(sub_id)
        try:
            pol = UnsubscribePolicy(policy) if policy is not None else self.unsubscribe_policy
        except ValueError:
            raise BusError(f"invalid unsubscribe policy: {policy}") from None
        now = self.now()

        held = self._held_ids(sub_id)  # 已去重，投递历史顺序 + 队列补遗
        ever_delivered = set(self._delivery_order[sub_id])
        transferred: List[str] = []
        retained: List[str] = []
        dropped: List[str] = []
        # 实际接收了转移消息的订阅者；处理完后统一把它们的队列排成全序。
        transfer_targets: Set[str] = set()

        for msg_id in held:
            if pol is UnsubscribePolicy.TRANSFER:
                redeliver = msg_id in ever_delivered
                outcome, target = self._transfer_on_unsubscribe(
                    sub_id, msg_id, now, redeliver
                )
                if outcome == "transferred":
                    transferred.append(msg_id)
                    if target is not None:
                        transfer_targets.add(target)
                elif outcome == "retained":
                    retained.append(msg_id)
                else:
                    dropped.append(msg_id)
            else:
                self._release_ref(msg_id, sub_id)
                dropped.append(msg_id)

        # 关键：转移消息是逐条 append 的；为让接收方队列本身（而非仅靠
        # deliver 时的惰性排序）严格保持与直接投递一致的全序，统一对每个
        # 实际接收方的待投递队列做一次稳定排序（同优先级/同 produced_at
        # 时按 msg_id 字典序）。各条目的 enqueued_at/redelivered 元数据保留。
        for target in transfer_targets:
            self._sort_pending(target)

        del self._subs[sub_id]
        del self._pending[sub_id]
        del self._inflight[sub_id]
        del self._delivery_order[sub_id]
        del self._acked[sub_id]
        self.backpressure_count.pop(sub_id, None)
        self.redelivered_count.pop(sub_id, None)
        # 注销者的数据结构已删除，此时再判断消息本体是否可以回收。
        for msg_id in held:
            self._gc_message(msg_id)

        self.unsubscribe_transfer_count += len(transferred)
        self.unsubscribe_cleanup_count += len(dropped)
        return {
            "sub_id": sub_id,
            "policy": pol.value,
            "transferred": sorted(transferred),
            "retained": sorted(retained),
            "dropped": sorted(dropped),
            "transferred_count": len(transferred),
            "cleaned_up_count": len(dropped),
        }

    def _held_ids(self, sub_id: str) -> List[str]:
        """该订阅者当前持有的全部 msg_id（pending ∪ inflight），去重且有序。

        顺序：投递历史中仍持有的在前，之后补上从未投递过的队列新消息
        （按全局投递键排序）。
        """
        inflight = self._inflight[sub_id]
        q = self._pending[sub_id]
        queued = {p.msg_id for p in q}
        seen: Set[str] = set()
        ordered: List[str] = []
        for mid in self._delivery_order[sub_id]:
            if (mid in inflight or mid in queued) and mid not in seen:
                seen.add(mid)
                ordered.append(mid)
        extras = sorted(queued - seen, key=lambda mid: _delivery_key(self, mid))
        ordered.extend(extras)
        return ordered

    def _transfer_on_unsubscribe(self, from_sub: str, msg_id: str, now: int,
                                 redeliver: bool = False) -> Tuple[str, Optional[str]]:
        """注销转移（只改引用关系，消息本体的 GC 由调用方统一做）。

        :param redeliver: 该消息在注销者处是否已真实投递过。投过则标记
            ``redelivered``；从未投出的消息保持“首次投递”语义，不打标记。
        :returns: ``(outcome, target)``，outcome 为 "transferred"（放入了
            新订阅者队列，target 为接收方 sub_id）、"retained"（其他订阅者
            本来就持有）或 "dropped"（无处可去）；后两者 target 为 None。
        """
        if msg_id not in self._messages:
            return "dropped", None
        msg = self._messages[msg_id]
        for sid in sorted(self._subs):
            if sid == from_sub:
                continue
            other_sub = self._subs[sid]
            if not other_sub.online or not self._matches(other_sub, msg):
                continue
            q = self._pending[sid]
            already = (
                msg_id in self._inflight[sid]
                or msg_id in self._acked[sid]
                or any(p.msg_id == msg_id for p in q)
            )
            if already:
                self._release_ref(msg_id, from_sub)
                return "retained", None
            if len(q) < other_sub.max_queue:
                q.append(_Pending(msg_id, now, redelivered=redeliver))
                self._refs.setdefault(msg_id, set()).add(sid)
                self._release_ref(msg_id, from_sub)
                return "transferred", sid
        self._release_ref(msg_id, from_sub)
        return "dropped", None

    def _sort_pending(self, sub_id: str) -> None:
        """把某订阅者的待投递队列按投递全序原地稳定排序。

        排序键与 :meth:`deliver` 完全一致（priority 降序、produced_at
        升序、msg_id 字典序），保留每个 :class:`_Pending` 对象本身
        （enqueued_at / redelivered 元数据不变）。用于注销转移后让接收方
        队列物理顺序即规范序，而不是仅靠 deliver 时的惰性排序。
        """
        self._pending[sub_id].sort(key=lambda p: _delivery_key(self, p.msg_id))

    # ------------------------------------------------------------------ #
    # 在线状态、超时与重投递
    # ------------------------------------------------------------------ #
    def set_online(self, sub_id: str, online: bool) -> Dict[str, Any]:
        """设置订阅者在线/离线。

        在线 -> 离线时，其全部未确认消息回到待投递队列（保留原优先级顺序，
        下次投地带 ``redelivered`` 标记）。回队不受 max_queue 限制，因为
        这些消息之前已被接收。离线期间 publish 给它的消息照常排队。
        重新上线后可继续 deliver；已确认集合与投递历史不丢失，
        ack_up_to 的位移语义保持不变。重复设置相同状态是空操作。
        """
        sub = self._require_sub(sub_id)
        if not isinstance(online, bool):
            raise BusError("online must be a boolean")
        was_online = sub.online
        sub.online = online

        returned: List[str] = []
        if was_online and not sub.online:
            # 一次掉线 = 恰好一个重投递批次：计数在这个显式触发点按订阅者
            # 加 1（_return_to_queue 内部且仅有在途消息实际回队时才加），
            # 与回队多少条、跨几个主题无关。注意超时回队是另一个独立事件
            # （由 check_timeouts / deliver 惰性触发，各自单独计批）；若
            # 消息此前已被超时回队、此刻没有在途消息，掉线不再另计一批。
            returned = self._return_to_queue(
                sub_id, list(self._inflight[sub_id].keys())
            )
        return {"sub_id": sub_id, "online": sub.online, "returned": returned}

    def _return_to_queue(self, sub_id: str, msg_ids: Iterable[str]) -> List[str]:
        """把指定的未确认消息按当前 in-flight 集合放回待投递队列。

        仅处理当前确实 in-flight 的 id，顺序按投递历史中**第一次**出现的
        位置（重投会让同一 id 在历史中多次出现，这里必须去重，否则一条
        消息会被重复放回队列）；返回实际回队的 msg_id 列表（去重）。

        当确有消息回队时，给该订阅者的重投递批次计数 +1——一次掉线或一次
        扫描中某订阅者的一批超时都只调用本方法一次，因此一批只计一次，
        与消息条数、跨主题数无关；没有在途消息时提前返回、不计数。
        """
        inflight = self._inflight[sub_id]
        wanted = set(msg_ids)
        seen: Set[str] = set()
        ordered: List[str] = []
        for mid in self._delivery_order[sub_id]:
            if mid in wanted and mid in inflight and mid not in seen:
                seen.add(mid)
                ordered.append(mid)
        for mid in sorted(wanted - seen, key=lambda m: _delivery_key(self, m)):
            if mid in inflight:
                ordered.append(mid)
        if not ordered:
            return []
        now = self.now()
        q = self._pending[sub_id]
        queued = {p.msg_id for p in q}
        returned: List[str] = []
        for mid in ordered:
            inflight.pop(mid, None)
            if mid not in queued:
                q.append(_Pending(mid, now, redelivered=True))
                queued.add(mid)
            returned.append(mid)
        # 一次逻辑事件（掉线 / 一批超时）只调用一次，故这里 +1 即一个批次。
        self.redelivered_count[sub_id] = self.redelivered_count.get(sub_id, 0) + 1
        return returned

    def check_timeouts(self, sub_id: Optional[str] = None) -> List[str]:
        """扫描（默认全部）在线订阅者，把超时未确认的消息放回待投递队列。

        超时判定：``now - delivered_at >= ack_timeout``；未配置 ack_timeout
        的订阅者跳过；离线订阅者的消息在掉线时已回队。返回回队 msg_id 列表。
        """
        now = self.now()
        targets = [sub_id] if sub_id is not None else list(self._subs)
        all_returned: List[str] = []
        for sid in targets:
            sub = self._subs.get(sid)
            if sub is None or not sub.online or sub.ack_timeout is None:
                continue
            due = [
                mid for mid, e in self._inflight[sid].items()
                if now - e.delivered_at >= sub.ack_timeout
            ]
            if due:
                all_returned.extend(self._return_to_queue(sid, due))
        return all_returned

    # ------------------------------------------------------------------ #
    # 投递与确认
    # ------------------------------------------------------------------ #
    def deliver(self, sub_id: str, max_messages: int = 1) -> Dict[str, Any]:
        """向一个订阅者投递消息（不立即推送，需显式调用拉取）。

        返回结果按优先级降序、同优先级 produced_at 升序、再 msg_id 字典序
        稳定排列；同一订阅者不会重复投递仍未确认或已确认过的消息。

        以下情况返回空 ``messages``：订阅者离线、``max_messages<=0``、
        已达到 ``max_inflight``（含 max_inflight 为 0）。其中“在线但因
        inflight 打满而一条都没拿到”计一次背压（``backpressure_count``），
        结果中 ``backpressure`` 为 true；离线不计背压。

        投递前会先处理该订阅者自身的 ack 超时回收。
        """
        sub = self._require_sub(sub_id)
        if not isinstance(max_messages, int) or isinstance(max_messages, bool):
            raise BusError("max_messages must be an integer")

        if sub.online and sub.ack_timeout is not None:
            self.check_timeouts(sub_id)

        inflight = self._inflight[sub_id]
        blocked = max_messages > 0 and len(inflight) >= sub.max_inflight
        if not sub.online or max_messages <= 0 or blocked:
            bp = bool(sub.online and max_messages > 0
                      and len(inflight) >= sub.max_inflight)
            if bp:
                self.backpressure_count[sub_id] += 1
            return self._deliver_result(sub_id, [], bp)

        q = self._pending[sub_id]
        acked = self._acked[sub_id]
        # 防御性过滤：正常不变量下 pending 与 inflight/acked 不相交。
        candidates = [p for p in q if p.msg_id not in inflight and p.msg_id not in acked]
        candidates.sort(key=lambda p: _delivery_key(self, p.msg_id))

        capacity = min(max_messages, sub.max_inflight - len(inflight))
        chosen = candidates[:capacity]
        chosen_objs = {id(p) for p in chosen}

        now = self.now()
        delivered: List[Dict[str, Any]] = []
        order = self._delivery_order[sub_id]
        for p in chosen:
            seen_before = sum(1 for mid in order if mid == p.msg_id)
            delivery_no = seen_before + 1
            inflight[p.msg_id] = _Inflight(p.msg_id, now, delivery_no, p.redelivered)
            order.append(p.msg_id)
            # redelivered 标记只表示该条为重投；批次计数在回队/超时时统一加，
            # 这里不再逐条累加，避免“一次掉线 = N 次重投”的口径错误。
            m = self._messages[p.msg_id]
            d = m.to_dict()
            d["redelivered"] = p.redelivered
            d["delivery_no"] = delivery_no
            delivered.append(d)

        if chosen_objs:
            self._pending[sub_id] = [p for p in q if id(p) not in chosen_objs]

        return self._deliver_result(sub_id, delivered, False)

    def _deliver_result(self, sub_id: str, messages: List[Dict[str, Any]],
                        backpressure: bool) -> Dict[str, Any]:
        return {
            "sub_id": sub_id,
            "messages": messages,
            "backpressure": backpressure,
            "inflight": len(self._inflight[sub_id]),
            "max_inflight": self._subs[sub_id].max_inflight,
        }

    def ack(self, sub_id: str, msg_id: str) -> Dict[str, Any]:
        """确认单条消息。幂等。

        - 消息在未确认集合中：确认（加入已确认集合并解除持有引用），
          ``acked=true, already_acked=false``；
        - 消息以前确认过：无操作，``acked=false, already_acked=true``；
        - 消息从未投递给该订阅者：无操作、不报错，``acked=false, known=false``。
        """
        self._require_sub(sub_id)
        was_inflight = msg_id in self._inflight[sub_id]
        was_acked = msg_id in self._acked[sub_id]
        if was_inflight:
            del self._inflight[sub_id][msg_id]
            self._release_ref(msg_id, sub_id)
            self._acked[sub_id].add(msg_id)
            self._gc_message(msg_id)
        return {
            "sub_id": sub_id,
            "msg_id": msg_id,
            "acked": was_inflight,
            "already_acked": was_acked,
            "known": was_inflight or was_acked,
        }

    def ack_up_to(self, sub_id: str, msg_id: str) -> Dict[str, Any]:
        """按该订阅者的投递历史，确认从最早一条到 ``msg_id``（含）的前缀。

        分界位置取该消息**第一次**被投递的位置；重投不会改变游标语义。

        关键约束：只确认当前**真实在途**（已投递给该订阅者、尚未确认，
        即 inflight）且落在前缀内的消息。**不会**触碰待投递队列中尚未
        （重新）投出的消息，也不会把它们加入已确认集合——否则掉线重投后
        队列里还没投出的消息会被误确认、从此再也投递不到。因此典型用法是
        先重新 ``deliver`` 再 ``ack_up_to``。

        早已确认的前缀消息跳过（幂等）；确认一个更早的位移也是幂等空操作。
        ``msg_id`` 从未投递给该订阅者时不做任何事、不报错，返回
        ``found=false``；目标消息本身尚在待投递队列时 ``found`` 仍为 true
        （它曾投递过），但本次只确认在途部分。返回的 ``acked_ids`` 是本次
        调用新确认的消息，按 msg_id 字典序。
        """
        self._require_sub(sub_id)
        order = self._delivery_order[sub_id]
        if msg_id not in order:
            return {"sub_id": sub_id, "msg_id": msg_id, "found": False, "acked_ids": []}
        prefix = set(order[: order.index(msg_id) + 1])

        inflight = self._inflight[sub_id]
        newly: Set[str] = set()
        # 只处理当前真实在途的消息；遍历快照以安全删除。
        for mid in list(inflight):
            if mid in prefix:
                del inflight[mid]
                self._release_ref(mid, sub_id)
                self._acked[sub_id].add(mid)
                newly.add(mid)
        # 注意：刻意不遍历 _pending——待投递队列里尚未投出的消息不能被确认。

        for mid in newly:
            self._gc_message(mid)
        return {
            "sub_id": sub_id,
            "msg_id": msg_id,
            "found": True,
            "acked_ids": sorted(newly),
        }

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #
    def get_message(self, msg_id: str) -> Optional[Dict[str, Any]]:
        """返回消息详情（不含投递状态）；不存在返回 None。"""
        m = self._messages.get(msg_id)
        return m.to_dict() if m is not None else None

    def list_subscriptions(self, topic: Optional[str] = None) -> List[str]:
        """返回订阅了给定主题的 sub_id，按字典序。

        未指定主题过滤（订阅全部主题）的订阅者对任何主题都计入。
        ``topic=None`` 返回全部订阅者。
        """
        result = []
        for sub_id, sub in self._subs.items():
            if topic is None or not sub.topics or topic in sub.topics:
                result.append(sub_id)
        return sorted(result)

    def get_state(self) -> Dict[str, Any]:
        """返回总线整体状态快照（普通字典）。"""
        subscribers: Dict[str, Any] = {}
        for sub_id in sorted(self._subs):
            sub = self._subs[sub_id]
            subscribers[sub_id] = {
                "online": sub.online,
                "topics": sorted(sub.topics),
                "min_priority": sub.min_priority,
                "pending": len(self._pending[sub_id]),
                "inflight": len(self._inflight[sub_id]),
                "acked": len(self._acked[sub_id]),
                "max_inflight": sub.max_inflight,
                "max_queue": sub.max_queue,
                "ack_timeout": sub.ack_timeout,
                "backpressure_count": self.backpressure_count.get(sub_id, 0),
                "redelivered_count": self.redelivered_count.get(sub_id, 0),
            }
        return {
            "clock": self.now(),
            "topics": len(self._known_topics),
            "topic_names": sorted(self._known_topics),
            "messages": len(self._messages),
            "subscribers": len(self._subs),
            "subscriptions": subscribers,
            "dropped_count": self.dropped_count,
            "unsubscribe_cleanup_count": self.unsubscribe_cleanup_count,
            "unsubscribe_transfer_count": self.unsubscribe_transfer_count,
            "overflow_policy": self.overflow_policy.value,
            # 规范序列化为 cleanup；旧快照里的 "drop" 加载时自动归一。
            "unsubscribe_policy": self.unsubscribe_policy.value,
        }

    def dump(self) -> Dict[str, Any]:
        """返回总线内部完整快照字典（与 save 文件内容一致）。"""
        return self.to_dict()

    # ------------------------------------------------------------------ #
    # 内部工具
    # ------------------------------------------------------------------ #
    def _require_sub(self, sub_id: str) -> Subscription:
        if sub_id not in self._subs:
            raise BusError(f"unknown subscriber: {sub_id}")
        return self._subs[sub_id]

    def _release_ref(self, msg_id: str, sub_id: str) -> None:
        """解除一个订阅者对消息的*持有*引用（pending/inflight）。

        只改 ``_refs``，不删除消息本体——消息可能仍需保留给投递历史或
        已确认集合（快照校验要求它们引用的 msg_id 仍然存在）。
        """
        refs = self._refs.get(msg_id)
        if refs is not None:
            refs.discard(sub_id)
            if not refs:
                self._refs.pop(msg_id, None)

    def _gc_message(self, msg_id: str) -> None:
        """当消息不再被任何订阅者持有、确认或留在投递历史中时删除消息本体。"""
        if self._refs.get(msg_id):
            return
        for sid in self._subs:
            if msg_id in self._acked[sid] or msg_id in self._delivery_order[sid]:
                return
        self._refs.pop(msg_id, None)
        self._messages.pop(msg_id, None)

    def _evict(self, sub_id: str, msg_id: str) -> None:
        """队列溢出淘汰：移除该订阅者对一条待投递消息的全部痕迹后尝试 GC。"""
        self._release_ref(msg_id, sub_id)
        order = self._delivery_order[sub_id]
        if msg_id in order:
            self._delivery_order[sub_id] = [m for m in order if m != msg_id]
        self._gc_message(msg_id)

    # ------------------------------------------------------------------ #
    # 持久化
    # ------------------------------------------------------------------ #
    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的普通字典。"""
        return {
            "version": self.STATE_VERSION,
            "clock": self.now(),
            "topics": sorted(self._known_topics),
            "policies": {
                "overflow": self.overflow_policy.value,
                "unsubscribe": self.unsubscribe_policy.value,
            },
            "counters": {
                "dropped": self.dropped_count,
                "backpressure": dict(self.backpressure_count),
                "redelivered": dict(self.redelivered_count),
                # 注销去向累计计数（旧快照缺省时按 0 加载，格式向后兼容）。
                "unsubscribe_cleanup": self.unsubscribe_cleanup_count,
                "unsubscribe_transfer": self.unsubscribe_transfer_count,
            },
            "messages": [self._messages[k].to_dict()
                         for k in sorted(self._messages)],
            "subscriptions": [self._sub_to_dict(sid) for sid in sorted(self._subs)],
        }

    def _sub_to_dict(self, sid: str) -> Dict[str, Any]:
        sub = self._subs[sid]
        return {
            "sub_id": sid,
            "topics": sorted(sub.topics),
            "min_priority": sub.min_priority,
            "max_inflight": sub.max_inflight,
            "max_queue": sub.max_queue,
            "ack_timeout": sub.ack_timeout,
            "online": sub.online,
            "pending": [
                {"msg_id": p.msg_id, "enqueued_at": p.enqueued_at,
                 "redelivered": p.redelivered}
                for p in self._pending[sid]
            ],
            "inflight": [
                {"msg_id": mid,
                 "delivered_at": e.delivered_at,
                 "delivery_no": e.delivery_no,
                 "redelivered": e.redelivered}
                for mid, e in sorted(self._inflight[sid].items())
            ],
            "delivery_order": list(self._delivery_order[sid]),
            "acked": sorted(self._acked[sid]),
        }

    def save(self, path: str) -> None:
        """把完整状态写成 UTF-8 JSON 文件（缩进 2，末尾换行）。"""
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2, sort_keys=False)
            f.write("\n")

    @classmethod
    def from_dict(cls, data: Any,
                  clock: Optional[Callable[[], int]] = None) -> "MessageBus":
        """从快照字典重建总线并做一致性校验。

        校验内容：根结构与必需字段、版本号、时钟非负整数、策略枚举合法、
        msg_id 唯一、消息字段（priority/produced_at 为整数等）、
        订阅引用的 topic 在主题注册表中、pending/inflight/delivery_order/
        acked 之间的一致性（inflight 必须在投递历史中、delivery_order 的
        每条消息必须处于 pending/inflight/acked 之一、acked 不得仍被持有、
        max_queue=0 时队列必须为空等）、计数器形状与引用合法。

        注意不校验“在队消息是否匹配订阅者当前过滤器”：运行时允许变更
        过滤器，变更前已入队的消息仍会被投递。

        :raises BusError: 任何结构损坏、字段缺失或一致性冲突，错误信息指明位置。
        """
        if not isinstance(data, dict):
            raise BusError("snapshot root must be a JSON object")
        for key in ("version", "clock", "topics", "policies",
                    "messages", "subscriptions"):
            if key not in data:
                raise BusError(f"snapshot missing field: {key}")

        version = data["version"]
        if version != cls.STATE_VERSION:
            raise BusError(f"unsupported snapshot version: {version}")

        clock_value = data["clock"]
        if not isinstance(clock_value, int) or isinstance(clock_value, bool) or clock_value < 0:
            raise BusError("snapshot field 'clock' must be a non-negative integer")

        topics_raw = data["topics"]
        if not isinstance(topics_raw, list) or not all(
            isinstance(t, str) and t for t in topics_raw
        ):
            raise BusError("snapshot field 'topics' must be a list of non-empty strings")
        known_topics = set(topics_raw)

        policies = data["policies"]
        if not isinstance(policies, dict):
            raise BusError("snapshot field 'policies' must be an object")
        try:
            overflow = OverflowPolicy(policies.get("overflow", OverflowPolicy.REJECT.value))
            unsub = UnsubscribePolicy(policies.get("unsubscribe", UnsubscribePolicy.DROP.value))
        except ValueError as e:
            raise BusError(f"invalid policy in snapshot: {e}") from None

        messages_raw = data["messages"]
        subs_raw = data["subscriptions"]
        if not isinstance(messages_raw, list):
            raise BusError("snapshot field 'messages' must be a list")
        if not isinstance(subs_raw, list):
            raise BusError("snapshot field 'subscriptions' must be a list")

        if clock is not None:
            if not callable(clock):
                raise BusError("clock must be a zero-argument callable returning an integer")
            bus = cls(clock=clock, overflow_policy=overflow, unsubscribe_policy=unsub)
        else:
            bus = cls(clock=_Clock(clock_value), overflow_policy=overflow,
                      unsubscribe_policy=unsub)
        bus._known_topics = set(known_topics)

        seen_ids: Set[str] = set()
        for raw in messages_raw:
            m = Message.from_dict(raw)
            if m.msg_id in seen_ids:
                raise BusError(f"snapshot violates msg_id uniqueness: {m.msg_id}")
            seen_ids.add(m.msg_id)
            if m.topic not in known_topics:
                raise BusError(
                    f"message {m.msg_id} references topic not in topics registry: {m.topic}"
                )
            try:
                json.dumps(m.payload)
            except (TypeError, ValueError):
                raise BusError(f"message {m.msg_id} payload is not JSON serializable") from None
            bus._messages[m.msg_id] = m

        sub_seen: Set[str] = set()
        for raw in subs_raw:
            cls._load_subscription(bus, raw, sub_seen, clock_value)

        cls._load_counters(bus, data.get("counters", {}))
        return bus

    @classmethod
    def _load_subscription(cls, bus: "MessageBus", raw: Any,
                           sub_seen: Set[str], clock_value: int) -> None:
        if not isinstance(raw, dict):
            raise BusError("subscription entry must be a JSON object")
        for k in ("sub_id", "topics", "pending", "inflight",
                  "delivery_order", "acked"):
            if k not in raw:
                raise BusError(f"subscription missing field: {k}")
        sid = raw["sub_id"]
        if not isinstance(sid, str) or not sid:
            raise BusError("subscription sub_id must be a non-empty string")
        if sid in sub_seen:
            raise BusError(f"duplicate subscription in snapshot: {sid}")
        sub_seen.add(sid)

        topics = raw["topics"]
        if not isinstance(topics, list) or not all(isinstance(t, str) and t for t in topics):
            raise BusError(f"subscription {sid}: topics must be a list of non-empty strings")
        topic_set = set(topics)
        for t in topic_set:
            if t not in bus._known_topics:
                raise BusError(f"subscription {sid} references unknown topic: {t}")

        min_priority = raw.get("min_priority", 0)
        max_inflight = raw.get("max_inflight", 100)
        max_queue = raw.get("max_queue", 1000)
        ack_timeout = raw.get("ack_timeout", None)
        online = raw.get("online", True)
        if not isinstance(min_priority, int) or isinstance(min_priority, bool):
            raise BusError(f"subscription {sid}: min_priority must be an integer")
        cls._validate_limits(max_inflight, max_queue)
        if ack_timeout is not None and (
            not isinstance(ack_timeout, int) or isinstance(ack_timeout, bool) or ack_timeout < 0
        ):
            raise BusError(f"subscription {sid}: ack_timeout must be non-negative integer or null")
        if not isinstance(online, bool):
            raise BusError(f"subscription {sid}: online must be a boolean")

        bus.subscribe(sid, topics=topic_set, min_priority=min_priority,
                      max_inflight=max_inflight, max_queue=max_queue,
                      ack_timeout=ack_timeout, online=online)

        pending_raw, inflight_raw = raw["pending"], raw["inflight"]
        order_raw, acked_raw = raw["delivery_order"], raw["acked"]
        if not isinstance(pending_raw, list):
            raise BusError(f"subscription {sid}: pending must be a list")
        if not isinstance(inflight_raw, list):
            raise BusError(f"subscription {sid}: inflight must be a list")
        if not isinstance(order_raw, list) or not all(isinstance(x, str) for x in order_raw):
            raise BusError(f"subscription {sid}: delivery_order must be a list of strings")
        if not isinstance(acked_raw, list) or not all(isinstance(x, str) for x in acked_raw):
            raise BusError(f"subscription {sid}: acked must be a list of strings")

        q: List[_Pending] = []
        q_ids: Set[str] = set()
        for p in pending_raw:
            if not isinstance(p, dict) or "msg_id" not in p:
                raise BusError(f"subscription {sid}: pending entry malformed")
            pid = p["msg_id"]
            if pid not in bus._messages:
                raise BusError(f"subscription {sid}: pending references unknown msg_id {pid}")
            if pid in q_ids:
                raise BusError(f"subscription {sid}: duplicate pending entry for {pid}")
            q_ids.add(pid)
            enq = p.get("enqueued_at", clock_value)
            if not isinstance(enq, int) or isinstance(enq, bool):
                raise BusError(f"subscription {sid}: pending enqueued_at must be integer")
            red = p.get("redelivered", False)
            if not isinstance(red, bool):
                raise BusError(f"subscription {sid}: pending redelivered must be boolean")
            q.append(_Pending(pid, enq, red))
            bus._refs.setdefault(pid, set()).add(sid)
        bus._pending[sid] = q

        inf: Dict[str, _Inflight] = {}
        for e in inflight_raw:
            if not isinstance(e, dict) or "msg_id" not in e:
                raise BusError(f"subscription {sid}: inflight entry malformed")
            iid = e["msg_id"]
            if iid not in bus._messages:
                raise BusError(f"subscription {sid}: inflight references unknown msg_id {iid}")
            if iid in inf:
                raise BusError(f"subscription {sid}: duplicate inflight entry for {iid}")
            if iid in q_ids:
                raise BusError(f"subscription {sid}: {iid} is both pending and inflight")
            dat = e.get("delivered_at", clock_value)
            dno = e.get("delivery_no", 1)
            red = e.get("redelivered", False)
            if not isinstance(dat, int) or isinstance(dat, bool):
                raise BusError(f"subscription {sid}: delivered_at must be integer")
            if not isinstance(dno, int) or isinstance(dno, bool) or dno < 1:
                raise BusError(f"subscription {sid}: delivery_no must be a positive integer")
            if not isinstance(red, bool):
                raise BusError(f"subscription {sid}: inflight redelivered must be boolean")
            inf[iid] = _Inflight(iid, dat, dno, red)
            bus._refs.setdefault(iid, set()).add(sid)
        bus._inflight[sid] = inf

        held_or_done = q_ids | set(inf.keys()) | set(acked_raw)
        for oid in order_raw:
            if oid not in bus._messages:
                raise BusError(
                    f"subscription {sid}: delivery_order references unknown msg_id {oid}"
                )
            if oid not in held_or_done:
                raise BusError(
                    f"subscription {sid}: {oid} in delivery_order is neither "
                    "pending, inflight nor acked"
                )
        for iid in inf:
            if iid not in order_raw:
                raise BusError(f"subscription {sid}: inflight {iid} missing from delivery_order")
        bus._delivery_order[sid] = list(order_raw)

        acked_set: Set[str] = set()
        for aid in acked_raw:
            if aid not in bus._messages:
                raise BusError(f"subscription {sid}: acked references unknown msg_id {aid}")
            if aid in inf or aid in q_ids:
                raise BusError(f"subscription {sid}: {aid} cannot be acked while still held")
            acked_set.add(aid)
        bus._acked[sid] = acked_set

        sub = bus._subs[sid]
        if sub.max_queue == 0 and q:
            raise BusError(f"subscription {sid}: max_queue is 0 but pending non-empty")
        # 注意：不在此要求 held 消息匹配当前过滤器——运行时允许通过 subscribe
        # 变更过滤器/阈值，而已在队列中的消息仍会投递；快照只需保证消息存在
        # （pending/inflight/acked 的 msg_id 存在性已在上面逐项校验）。

    @classmethod
    def _load_counters(cls, bus: "MessageBus", counters: Any) -> None:
        if not isinstance(counters, dict):
            raise BusError("snapshot field 'counters' must be an object")
        dropped = counters.get("dropped", 0)
        if not isinstance(dropped, int) or isinstance(dropped, bool) or dropped < 0:
            raise BusError("counter 'dropped' must be a non-negative integer")
        bus.dropped_count = dropped
        for name, target in (("backpressure", bus.backpressure_count),
                             ("redelivered", bus.redelivered_count)):
            raw_c = counters.get(name, {})
            if not isinstance(raw_c, dict):
                raise BusError(f"counter '{name}' must be an object")
            for cid, val in raw_c.items():
                if cid not in bus._subs:
                    raise BusError(f"counter '{name}' references unknown subscriber {cid}")
                if not isinstance(val, int) or isinstance(val, bool) or val < 0:
                    raise BusError(f"counter '{name}.{cid}' must be a non-negative integer")
                target[cid] = val

        # 注销去向累计计数：旧快照缺省按 0 加载。
        for name, attr in (("unsubscribe_cleanup", "unsubscribe_cleanup_count"),
                           ("unsubscribe_transfer", "unsubscribe_transfer_count")):
            val = counters.get(name, 0)
            if not isinstance(val, int) or isinstance(val, bool) or val < 0:
                raise BusError(f"counter '{name}' must be a non-negative integer")
            setattr(bus, attr, val)

    @classmethod
    def load(cls, path: str,
             clock: Optional[Callable[[], int]] = None) -> "MessageBus":
        """从 JSON 文件加载并校验。

        :raises BusError: 文件无法读取、不是合法 JSON（错误信息带行列号）
            或快照一致性校验失败。
        """
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError as e:
            raise BusError(f"cannot read snapshot file {path}: {e}") from None
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise BusError(
                f"snapshot file {path} is not valid JSON "
                f"(line {e.lineno}, col {e.colno}): {e.msg}"
            ) from None
        return cls.from_dict(data, clock=clock)
