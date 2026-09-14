"""租约调度内核。

安全模型
========

* 内核不读取墙上时间，所有判定基于注入的 :class:`~leasekernel.clock.LogicalClock`。
* 每个租约有授予时刻 ``grant_mono`` 与硬到期时刻 ``expire_mono``，二者都建立在
  时钟的*单调高水位*上，因此时钟回退或向下跳变不会让已经到期的租约复活，也不会
  缩短或延长安全期之外的任何判定。
* ``epsilon`` 是节点时钟相对内核时钟允许的最大偏差上界。租约在
  ``monotonic + epsilon < expire_mono`` 时处于安全期（:state:`SAFE`）；
  到期前 ``epsilon`` 宽的区间为偏差不确定区（:state:`UNCERTAIN`），区内一切
  续租与写入都偏向拒绝；``monotonic >= expire_mono`` 为硬过期（:state:`EXPIRED`）。
* 每次授予产生一个单调递增的 fancing token（``generation``）。租约被回收后，
  旧持有者携带旧 token 的任何写入都会被永久拒绝；资源在旧租约硬到期之前不会被
  重新发放，因此系统判定中不会出现两个持有者同时有效的窗口。

事件日志记录每次授予、续租（同意/拒绝）、释放、回收与写入拒绝及其原因和所用的
时间依据；除输入外不读取任何外部状态，同一输入序列必然产生完全相同的结果。
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from .clock import LogicalClock, ManualClock

__all__ = [
    "LeaseState",
    "Lease",
    "LeaseEvent",
    "ResourceStatus",
    "LeaseKernel",
    "ValidationError",
    "PersistenceError",
    "FORMAT_VERSION",
]

FORMAT_VERSION = 1


class ValidationError(ValueError):
    """注册/续租参数本身不合法（区别于“合法但被安全策略拒绝”）。"""


class PersistenceError(ValueError):
    """快照文件损坏、字段缺失或一致性校验失败。"""


class LeaseState(str, Enum):
    """资源/租约在某一逻辑时刻的判定状态。"""

    FREE = "free"
    """从未发放或已被正常释放且无不确定性遗留。"""

    SAFE = "safe"
    """严格处于安全期：距硬到期超过一个偏差上界，可续租、可写入。"""

    UNCERTAIN = "uncertain"
    """偏差不确定区：可能在另一节点视角下已经到期，续租与写入一律拒绝。"""

    EXPIRED = "expired"
    """已硬到期：持有者失效；等待或执行回收后可重新发放。"""


@dataclass(frozen=True)
class Lease:
    """一条租约记录。时间字段全部基于时钟单调读数。"""

    lease_id: str
    resource: str
    holder: str
    generation: int
    grant_mono: float
    expire_mono: float
    ttl: float
    epsilon: float
    grant_clock: float
    renew_count: int = 0
    last_renew_mono: Optional[float] = None
    last_renew_clock: Optional[float] = None
    active: bool = True
    ended_reason: Optional[str] = None
    ended_mono: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "lease_id": self.lease_id,
            "resource": self.resource,
            "holder": self.holder,
            "generation": self.generation,
            "grant_mono": self.grant_mono,
            "expire_mono": self.expire_mono,
            "ttl": self.ttl,
            "epsilon": self.epsilon,
            "grant_clock": self.grant_clock,
            "renew_count": self.renew_count,
            "last_renew_mono": self.last_renew_mono,
            "last_renew_clock": self.last_renew_clock,
            "active": self.active,
            "ended_reason": self.ended_reason,
            "ended_mono": self.ended_mono,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Lease":
        """从字典恢复，缺失/类型错误抛 :class:`PersistenceError`。"""
        required = {
            "lease_id": str,
            "resource": str,
            "holder": str,
            "generation": int,
            "grant_mono": (int, float),
            "expire_mono": (int, float),
            "ttl": (int, float),
            "epsilon": (int, float),
            "grant_clock": (int, float),
            "renew_count": int,
            "active": bool,
        }
        for key, typ in required.items():
            if key not in d:
                raise PersistenceError("租约缺少字段: %s" % key)
            if not isinstance(d[key], typ) or isinstance(d[key], bool) and typ != bool:
                raise PersistenceError(
                    "租约字段 %s 类型错误: %r" % (key, type(d[key]).__name__)
                )
        for key in ("last_renew_mono", "last_renew_clock", "ended_mono"):
            v = d.get(key)
            if v is not None and not isinstance(v, (int, float)):
                raise PersistenceError("租约字段 %s 必须是数值或 null" % key)
        if d.get("ended_reason") is not None and not isinstance(d["ended_reason"], str):
            raise PersistenceError("租约字段 ended_reason 必须是字符串或 null")
        kwargs = {
            "lease_id": d["lease_id"],
            "resource": d["resource"],
            "holder": d["holder"],
            "generation": d["generation"],
            "grant_mono": float(d["grant_mono"]),
            "expire_mono": float(d["expire_mono"]),
            "ttl": float(d["ttl"]),
            "epsilon": float(d["epsilon"]),
            "grant_clock": float(d["grant_clock"]),
            "renew_count": d["renew_count"],
            "last_renew_mono": (
                float(d["last_renew_mono"])
                if d.get("last_renew_mono") is not None
                else None
            ),
            "last_renew_clock": (
                float(d["last_renew_clock"])
                if d.get("last_renew_clock") is not None
                else None
            ),
            "active": d["active"],
            "ended_reason": d.get("ended_reason"),
            "ended_mono": (
                float(d["ended_mono"]) if d.get("ended_mono") is not None else None
            ),
        }
        lease = cls(**kwargs)
        if lease.expire_mono < lease.grant_mono:
            raise PersistenceError(
                "租约 %s 的到期时刻 %s 早于授予时刻 %s"
                % (lease.lease_id, lease.expire_mono, lease.grant_mono)
            )
        if lease.ttl <= 0:
            raise PersistenceError("租约 %s 的 ttl 必须为正" % lease.lease_id)
        if lease.epsilon < 0:
            raise PersistenceError("租约 %s 的 epsilon 不能为负" % lease.lease_id)
        if lease.renew_count < 0 or lease.generation < 1:
            raise PersistenceError("租约 %s 计数值非法" % lease.lease_id)
        return lease


@dataclass(frozen=True)
class LeaseEvent:
    """事件日志中的一条记录，字段即“所用时间依据”。"""

    seq: int
    kind: str
    result: str
    reason: str
    resource: Optional[str]
    holder: Optional[str]
    monotonic: float
    clock_now: float
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "seq": self.seq,
            "kind": self.kind,
            "result": self.result,
            "reason": self.reason,
            "resource": self.resource,
            "holder": self.holder,
            "monotonic": self.monotonic,
            "clock_now": self.clock_now,
            "details": self.details,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "LeaseEvent":
        """从字典恢复一条事件。"""
        try:
            return cls(
                seq=int(d["seq"]),
                kind=str(d["kind"]),
                result=str(d["result"]),
                reason=str(d["reason"]),
                resource=d.get("resource"),
                holder=d.get("holder"),
                monotonic=float(d["monotonic"]),
                clock_now=float(d["clock_now"]),
                details=dict(d.get("details") or {}),
            )
        except KeyError as exc:
            raise PersistenceError("事件缺少字段: %s" % exc) from None
        except (TypeError, ValueError):
            raise PersistenceError("事件字段类型错误") from None


class _ResourceState:
    """单个资源的配置与当前租约（内部结构）。"""

    __slots__ = (
        "name",
        "ttl",
        "epsilon",
        "node_epsilons",
        "generation",
        "lease",
        "last_expire_mono",
    )

    def __init__(
        self,
        name: str,
        ttl: float,
        epsilon: float,
        node_epsilons: Optional[Dict[str, float]] = None,
    ) -> None:
        self.name = name
        self.ttl = float(ttl)
        self.epsilon = float(epsilon)
        self.node_epsilons: Dict[str, float] = {
            k: float(v) for k, v in (node_epsilons or {}).items()
        }
        self.generation = 0
        self.lease: Optional[Lease] = None
        # 最近一条“非正常释放”租约的硬到期时刻；新发放不得早于它。
        self.last_expire_mono: Optional[float] = None

    def effective_epsilon(self, holder: Optional[str]) -> float:
        """某持有者实际适用的偏差上界：节点级覆盖优先，否则用资源级默认。"""
        if holder is not None and holder in self.node_epsilons:
            return self.node_epsilons[holder]
        return self.epsilon

    def to_dict(self) -> Dict[str, Any]:
        """序列化资源状态。"""
        return {
            "ttl": self.ttl,
            "epsilon": self.epsilon,
            "node_epsilons": self.node_epsilons,
            "generation": self.generation,
            "lease": self.lease.to_dict() if self.lease is not None else None,
            "last_expire_mono": self.last_expire_mono,
        }

    @classmethod
    def from_dict(cls, name: str, d: Dict[str, Any]) -> "_ResourceState":
        """从字典恢复资源状态并做一致性校验。"""
        try:
            ttl = float(d["ttl"])
            epsilon = float(d["epsilon"])
        except KeyError as exc:
            raise PersistenceError("资源 %s 缺少字段: %s" % (name, exc)) from None
        except (TypeError, ValueError):
            raise PersistenceError("资源 %s 的 ttl/epsilon 必须为数值" % name) from None
        if not math.isfinite(ttl) or ttl <= 0:
            raise PersistenceError("资源 %s 的 ttl 必须为正的有限数" % name)
        if not math.isfinite(epsilon) or epsilon < 0:
            raise PersistenceError("资源 %s 的 epsilon 必须为非负有限数" % name)
        ne_raw = d.get("node_epsilons") or {}
        if not isinstance(ne_raw, dict):
            raise PersistenceError("资源 %s 的 node_epsilons 必须是对象" % name)
        node_epsilons: Dict[str, float] = {}
        for node, val in ne_raw.items():
            try:
                fv = float(val)
            except (TypeError, ValueError):
                raise PersistenceError(
                    "资源 %s 的节点偏差 %s 不是数值" % (name, node)
                ) from None
            if not math.isfinite(fv) or fv < 0:
                raise PersistenceError(
                    "资源 %s 的节点偏差 %s 必须为非负有限数" % (name, node)
                )
            node_epsilons[str(node)] = fv
        rs = cls(name, ttl, epsilon, node_epsilons)
        try:
            rs.generation = int(d["generation"])
        except KeyError:
            raise PersistenceError("资源 %s 缺少 generation" % name) from None
        if rs.generation < 0:
            raise PersistenceError("资源 %s 的 generation 不能为负" % name)
        lease_raw = d.get("lease")
        if lease_raw is not None:
            if not isinstance(lease_raw, dict):
                raise PersistenceError("资源 %s 的 lease 段必须是对象" % name)
            lease = Lease.from_dict(lease_raw)
            if lease.resource != name:
                raise PersistenceError(
                    "资源 %s 的租约记录属于其它资源 %s" % (name, lease.resource)
                )
            if lease.generation > rs.generation:
                raise PersistenceError(
                    "资源 %s 的租约 generation %d 超过资源代次 %d"
                    % (name, lease.generation, rs.generation)
                )
            if not isinstance(lease.holder, str) or not lease.holder:
                raise PersistenceError("资源 %s 的持有者不能为空" % name)
            rs.lease = lease
        last = d.get("last_expire_mono")
        if last is not None:
            try:
                rs.last_expire_mono = float(last)
            except (TypeError, ValueError):
                raise PersistenceError(
                    "资源 %s 的 last_expire_mono 不是数值" % name
                ) from None
        return rs


@dataclass(frozen=True)
class ResourceStatus:
    """``status`` 查询的结果。"""

    resource: str
    state: LeaseState
    holder: Optional[str]
    lease_id: Optional[str]
    generation: Optional[int]
    grant_mono: Optional[float]
    expire_mono: Optional[float]
    safe_until_mono: Optional[float]
    monotonic: float
    clock_now: float
    epsilon: Optional[float]
    acquirable: bool

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "resource": self.resource,
            "state": self.state.value,
            "holder": self.holder,
            "lease_id": self.lease_id,
            "generation": self.generation,
            "grant_mono": self.grant_mono,
            "expire_mono": self.expire_mono,
            "safe_until_mono": self.safe_until_mono,
            "monotonic": self.monotonic,
            "clock_now": self.clock_now,
            "epsilon": self.epsilon,
            "acquirable": self.acquirable,
        }


class LeaseKernel:
    """租约调度内核。

    :param clock: 可注入逻辑时钟；缺省使用从 0 开始的 :class:`ManualClock`。
    """

    def __init__(self, clock: Optional[LogicalClock] = None) -> None:
        self.clock: LogicalClock = clock if clock is not None else ManualClock(0.0)
        self._resources: Dict[str, _ResourceState] = {}
        self._events: List[LeaseEvent] = []
        self._seq = 0

    # ---------------------------------------------------------------- 基础工具

    def reset(self, initial: float = 0.0) -> None:
        """清空全部资源、租约与事件日志，并把逻辑时钟重置为 ``initial``。"""
        initial = float(initial)
        if not math.isfinite(initial):
            raise ValidationError("initial 必须是有限数")
        self.clock = ManualClock(initial)
        self._resources = {}
        self._events = []
        self._seq = 0

    @staticmethod
    def _require_name(value: Any, what: str) -> str:
        if not isinstance(value, str) or not value:
            raise ValidationError("%s 必须是非空字符串" % what)
        return value

    @staticmethod
    def _require_positive(value: Any, what: str) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError("%s 必须是数值" % what)
        fv = float(value)
        if not math.isfinite(fv) or fv <= 0:
            raise ValidationError("%s 必须为正的有限数" % what)
        return fv

    @staticmethod
    def _require_nonneg(value: Any, what: str) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError("%s 必须是数值" % what)
        fv = float(value)
        if not math.isfinite(fv) or fv < 0:
            raise ValidationError("%s 必须为非负有限数" % what)
        return fv

    def _log(
        self,
        kind: str,
        result: str,
        reason: str,
        resource: Optional[str],
        holder: Optional[str],
        details: Optional[Dict[str, Any]] = None,
    ) -> LeaseEvent:
        self._seq += 1
        evt = LeaseEvent(
            seq=self._seq,
            kind=kind,
            result=result,
            reason=reason,
            resource=resource,
            holder=holder,
            monotonic=self.clock.monotonic,
            clock_now=self.clock.now,
            details=dict(details or {}),
        )
        self._events.append(evt)
        return evt

    @property
    def events(self) -> List[LeaseEvent]:
        """事件日志的只读视图（按时间顺序）。"""
        return list(self._events)

    # ---------------------------------------------------------------- 资源管理

    def register_resource(
        self,
        name: str,
        ttl: float,
        epsilon: float = 0.0,
        node_epsilons: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """注册一个命名资源。

        :param name: 资源名（非空字符串）。
        :param ttl: 租约时长（逻辑时间单位），必须为正。
        :param epsilon: 节点时钟相对内核时钟的最大偏差上界，必须非负；
            为 0 时退化为严格时间比较（无不确定区）。
        :param node_epsilons: 可选的按节点覆盖的偏差上界。
        """
        name = self._require_name(name, "资源名")
        ttl = self._require_positive(ttl, "ttl")
        epsilon = self._require_nonneg(epsilon, "epsilon")
        ne: Dict[str, float] = {}
        if node_epsilons is not None:
            if not isinstance(node_epsilons, dict):
                raise ValidationError("node_epsilons 必须是对象")
            for node, val in node_epsilons.items():
                ne[self._require_name(node, "节点名")] = self._require_nonneg(
                    val, "节点 %s 的 epsilon" % node
                )
        if name in self._resources:
            raise ValidationError("资源已存在: %s" % name)
        self._resources[name] = _ResourceState(name, ttl, epsilon, ne)
        self._log(
            "register", "ok", "registered", name, None,
            {"ttl": ttl, "epsilon": epsilon, "node_epsilons": ne},
        )
        return {"resource": name, "ttl": ttl, "epsilon": epsilon}

    def _state_of(self, rs: _ResourceState) -> LeaseState:
        mono = self.clock.monotonic
        lease = rs.lease
        if lease is not None and lease.active:
            if mono >= lease.expire_mono:
                return LeaseState.EXPIRED
            if mono + lease.epsilon >= lease.expire_mono:
                return LeaseState.UNCERTAIN
            return LeaseState.SAFE
        # 无活跃租约。若在偏差不确定区被回收，硬到期前仍视为不确定区，
        # 不向任何新持有者发放（安全优先）；正常释放会清掉该门限。
        if rs.last_expire_mono is not None and mono < rs.last_expire_mono:
            return LeaseState.UNCERTAIN
        return LeaseState.FREE

    # ---------------------------------------------------------------- 查询

    def status(self, resource: str) -> ResourceStatus:
        """返回某资源当前的完整判定；资源不存在抛 :class:`ValidationError`。"""
        name = self._require_name(resource, "资源名")
        if name not in self._resources:
            raise ValidationError("资源不存在: %s" % name)
        rs = self._resources[name]
        state = self._state_of(rs)
        lease = rs.lease
        mono = self.clock.monotonic
        acquirable = self._acquirable(rs, mono, state)
        if lease is not None:
            return ResourceStatus(
                resource=name,
                state=state,
                holder=lease.holder if lease.active else None,
                lease_id=lease.lease_id if lease.active else None,
                generation=lease.generation if lease.active else None,
                grant_mono=lease.grant_mono,
                expire_mono=lease.expire_mono,
                safe_until_mono=lease.expire_mono - lease.epsilon,
                monotonic=mono,
                clock_now=self.clock.now,
                epsilon=lease.epsilon,
                acquirable=acquirable,
            )
        return ResourceStatus(
            resource=name,
            state=LeaseState.FREE,
            holder=None,
            lease_id=None,
            generation=None,
            grant_mono=None,
            expire_mono=None,
            safe_until_mono=None,
            monotonic=mono,
            clock_now=self.clock.now,
            epsilon=rs.epsilon,
            acquirable=acquirable,
        )

    def _acquirable(
        self, rs: _ResourceState, mono: float, state: LeaseState
    ) -> bool:
        if state in (LeaseState.SAFE, LeaseState.UNCERTAIN):
            return False
        # 仅当旧租约已硬到期（或本来就不存在/被显式释放且无遗留门限）才可发放。
        if rs.last_expire_mono is not None and mono < rs.last_expire_mono:
            return False
        return True

    # ---------------------------------------------------------------- 发放

    def acquire(self, resource: str, holder: str) -> Dict[str, Any]:
        """为 ``holder`` 申请 ``resource`` 的新租约。

        成功返回租约信息；资源仍被有效持有、或旧租约尚在硬到期前的偏差
        遗留窗口内时都会拒绝（安全优先于可用）。
        """
        name = self._require_name(resource, "资源名")
        holder = self._require_name(holder, "持有者名")
        if name not in self._resources:
            self._log("acquire", "denied", "unknown_resource", name, holder)
            raise ValidationError("资源不存在: %s" % name)
        rs = self._resources[name]
        mono = self.clock.monotonic
        state = self._state_of(rs)

        if rs.lease is not None and rs.lease.active:
            if state == LeaseState.EXPIRED:
                # 硬到期：先自动回收，再继续走发放判定。
                self._end_lease(rs, "auto_expired", "expire")
                state = LeaseState.FREE
            else:
                reason = (
                    "already_held"
                    if rs.lease.holder == holder
                    else "lease_active_other_holder"
                )
                self._log(
                    "acquire", "denied", reason, name, holder,
                    {
                        "current_holder": rs.lease.holder,
                        "state": state.value,
                        "expire_mono": rs.lease.expire_mono,
                    },
                )
                return {
                    "granted": False,
                    "reason": reason,
                    "state": state.value,
                    "current_holder": rs.lease.holder,
                    "lease_id": rs.lease.lease_id,
                }

        if rs.last_expire_mono is not None and mono < rs.last_expire_mono:
            self._log(
                "acquire", "denied", "within_expiry_uncertainty_grace", name, holder,
                {"last_expire_mono": rs.last_expire_mono, "monotonic": mono},
            )
            return {
                "granted": False,
                "reason": "within_expiry_uncertainty_grace",
                "state": LeaseState.UNCERTAIN.value,
            }

        generation = rs.generation + 1
        epsilon = rs.effective_epsilon(holder)
        lease = Lease(
            lease_id="%s#L%d" % (name, generation),
            resource=name,
            holder=holder,
            generation=generation,
            grant_mono=mono,
            expire_mono=mono + rs.ttl,
            ttl=rs.ttl,
            epsilon=epsilon,
            grant_clock=self.clock.now,
        )
        rs.generation = generation
        rs.lease = lease
        rs.last_expire_mono = lease.expire_mono
        self._log(
            "grant", "ok", "granted", name, holder,
            {
                "lease_id": lease.lease_id,
                "generation": generation,
                "grant_mono": mono,
                "expire_mono": lease.expire_mono,
                "safe_until_mono": lease.expire_mono - epsilon,
                "ttl": rs.ttl,
                "epsilon": epsilon,
                "clock_now": self.clock.now,
            },
        )
        return {
            "granted": True,
            "lease_id": lease.lease_id,
            "generation": generation,
            "holder": holder,
            "grant_mono": mono,
            "expire_mono": lease.expire_mono,
            "safe_until_mono": lease.expire_mono - epsilon,
            "ttl": rs.ttl,
            "epsilon": epsilon,
        }

    # ---------------------------------------------------------------- 续租

    def renew(
        self,
        resource: str,
        holder: str,
        generation: int,
        local_time: float,
        lease_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """处理一次续租请求。

        请求必须携带请求方自报的本地时间 ``local_time`` 与上一次已知授予的
        fancing token（``generation``，可选 ``lease_id``）。以下任一不满足即拒绝
        并记录原因，绝不默默续期：

        1. 资源与租约存在且仍活跃，持有者、token 全部匹配；
        2. 当前严格处于安全期（不确定区与已过期一律拒绝）；
        3. ``|local_time - 内核时钟绝对读数| <= epsilon``。
        """
        name = self._require_name(resource, "资源名")
        holder = self._require_name(holder, "持有者名")
        if isinstance(generation, bool) or not isinstance(generation, int):
            raise ValidationError("generation 必须是整数")
        if isinstance(local_time, bool) or not isinstance(local_time, (int, float)):
            raise ValidationError("local_time 必须是数值")
        local_time = float(local_time)
        if not math.isfinite(local_time):
            raise ValidationError("local_time 必须是有限数")
        if name not in self._resources:
            self._log("renew", "denied", "unknown_resource", name, holder,
                      {"generation": generation, "local_time": local_time})
            return {"renewed": False, "reason": "unknown_resource"}

        rs = self._resources[name]
        lease = rs.lease
        mono = self.clock.monotonic
        clock_now = self.clock.now

        def deny(reason: str, **extra: Any) -> Dict[str, Any]:
            details = {
                "generation": generation,
                "presented_lease_id": lease_id,
                "local_time": local_time,
                "monotonic": mono,
                "clock_now": clock_now,
            }
            if lease is not None:
                details.update(
                    expire_mono=lease.expire_mono, epsilon=lease.epsilon
                )
            details.update(extra)
            self._log("renew", "denied", reason, name, holder, details)
            return {"renewed": False, "reason": reason, **extra}

        if lease is None:
            return deny("no_active_lease")
        if lease_id is not None and lease_id != lease.lease_id:
            return deny(
                "stale_lease_id",
                current_lease_id=lease.lease_id,
            )
        if generation != lease.generation:
            return deny("stale_generation", current_generation=lease.generation)
        if lease.holder != holder:
            return deny("not_holder", current_holder=lease.holder)
        if not lease.active:
            return deny("lease_ended", ended_reason=lease.ended_reason)

        state = self._state_of(rs)
        if state == LeaseState.EXPIRED:
            self._end_lease(rs, "auto_expired_on_renew", "expire")
            return deny(
                "expired",
                expire_mono=lease.expire_mono,
                current_generation=lease.generation,
            )
        if state == LeaseState.UNCERTAIN:
            return deny(
                "uncertainty_window",
                safe_until_mono=lease.expire_mono - lease.epsilon,
                expire_mono=lease.expire_mono,
            )

        skew = abs(local_time - clock_now)
        if skew > lease.epsilon:
            return deny(
                "clock_skew_exceeded",
                skew=skew,
                epsilon=lease.epsilon,
                safe_until_mono=lease.expire_mono - lease.epsilon,
            )

        new_expire = mono + lease.ttl
        renewed = Lease(
            lease_id=lease.lease_id,
            resource=lease.resource,
            holder=lease.holder,
            generation=lease.generation,
            grant_mono=lease.grant_mono,
            expire_mono=new_expire,
            ttl=lease.ttl,
            epsilon=lease.epsilon,
            grant_clock=lease.grant_clock,
            renew_count=lease.renew_count + 1,
            last_renew_mono=mono,
            last_renew_clock=clock_now,
            active=True,
        )
        rs.lease = renewed
        rs.last_expire_mono = new_expire
        self._log(
            "renew", "ok", "renewed", name, holder,
            {
                "lease_id": renewed.lease_id,
                "generation": renewed.generation,
                "local_time": local_time,
                "skew": skew,
                "monotonic": mono,
                "clock_now": clock_now,
                "old_expire_mono": lease.expire_mono,
                "new_expire_mono": new_expire,
                "safe_until_mono": new_expire - renewed.epsilon,
                "renew_count": renewed.renew_count,
            },
        )
        return {
            "renewed": True,
            "lease_id": renewed.lease_id,
            "generation": renewed.generation,
            "grant_mono": renewed.grant_mono,
            "expire_mono": new_expire,
            "safe_until_mono": new_expire - renewed.epsilon,
            "renew_count": renewed.renew_count,
            "epsilon": renewed.epsilon,
        }

    # ---------------------------------------------------------------- 写入校验

    def check_write(
        self, resource: str, holder: str, generation: int,
        lease_id: Optional[str] = None, log: bool = True,
    ) -> Dict[str, Any]:
        """模拟持有者的一次受租约保护的写入/操作。

        只有携带当前 token 且租约严格处于安全期时允许；租约回收后来自旧持有
        者的任何调用都会被拒绝（token 不匹配或租约已终止）。
        """
        name = self._require_name(resource, "资源名")
        holder = self._require_name(holder, "持有者名")
        if isinstance(generation, bool) or not isinstance(generation, int):
            raise ValidationError("generation 必须是整数")
        if name not in self._resources:
            if log:
                self._log("write", "denied", "unknown_resource", name, holder,
                          {"generation": generation})
            return {"allowed": False, "reason": "unknown_resource"}
        rs = self._resources[name]
        lease = rs.lease
        mono = self.clock.monotonic

        def deny(reason: str, **extra: Any) -> Dict[str, Any]:
            if log:
                details = {"generation": generation, "monotonic": mono}
                if lease is not None:
                    details.update(
                        current_generation=lease.generation,
                        expire_mono=lease.expire_mono,
                        epsilon=lease.epsilon,
                    )
                details.update(extra)
                self._log("write", "denied", reason, name, holder, details)
            return {"allowed": False, "reason": reason, **extra}

        if lease is None:
            return deny("no_active_lease")
        if lease_id is not None and lease_id != lease.lease_id:
            return deny("stale_lease_id", current_lease_id=lease.lease_id)
        if generation != lease.generation:
            return deny("stale_generation", current_generation=lease.generation)
        if lease.holder != holder:
            return deny("not_holder", current_holder=lease.holder)
        if not lease.active:
            return deny("lease_ended", ended_reason=lease.ended_reason)
        state = self._state_of(rs)
        if state == LeaseState.EXPIRED:
            return deny("expired", expire_mono=lease.expire_mono)
        if state == LeaseState.UNCERTAIN:
            return deny(
                "uncertainty_window",
                safe_until_mono=lease.expire_mono - lease.epsilon,
            )
        return {
            "allowed": True,
            "lease_id": lease.lease_id,
            "generation": lease.generation,
            "state": LeaseState.SAFE.value,
        }

    # ---------------------------------------------------------------- 释放/回收

    def release(self, resource: str, holder: str, generation: int) -> Dict[str, Any]:
        """持有者主动释放租约；token 不匹配、租约不存在均报错。"""
        name = self._require_name(resource, "资源名")
        holder = self._require_name(holder, "持有者名")
        if isinstance(generation, bool) or not isinstance(generation, int):
            raise ValidationError("generation 必须是整数")
        if name not in self._resources:
            self._log("release", "denied", "unknown_resource", name, holder,
                      {"generation": generation})
            raise ValidationError("资源不存在: %s" % name)
        rs = self._resources[name]
        lease = rs.lease
        if lease is None:
            self._log("release", "denied", "no_active_lease", name, holder,
                      {"generation": generation})
            raise ValidationError("资源 %s 不存在活跃租约" % name)
        if generation != lease.generation:
            self._log(
                "release", "denied", "stale_generation", name, holder,
                {"generation": generation, "current_generation": lease.generation},
            )
            raise ValidationError(
                "generation 不匹配： presented=%d current=%d"
                % (generation, lease.generation)
            )
        if lease.holder != holder:
            self._log("release", "denied", "not_holder", name, holder,
                      {"current_holder": lease.holder})
            raise ValidationError("持有者不匹配： %s != %s" % (holder, lease.holder))
        if not lease.active:
            self._log("release", "denied", "lease_ended", name, holder,
                      {"ended_reason": lease.ended_reason})
            raise ValidationError("租约已结束: %s" % (lease.ended_reason or "?"))
        # 主动释放：持有者明确放弃，不留到期门限，资源立即可重新发放；
        # 旧 generation 依然永久失效（fancing）。
        rs.lease = self._ended_copy(lease, "released", self.clock.monotonic)
        rs.last_expire_mono = None
        self._log(
            "release", "ok", "released", name, holder,
            {"lease_id": lease.lease_id, "generation": lease.generation,
             "monotonic": self.clock.monotonic},
        )
        return {"released": True, "lease_id": lease.lease_id,
                "generation": lease.generation}

    def reclaim(self, resource: Optional[str] = None) -> Dict[str, Any]:
        """安全回收。

        * 指定资源：仅当租约已硬到期，或处于偏差不确定区（持有者已经可能
          过期）时允许回收。安全期内拒绝回收。
        * ``resource=None``：扫描所有资源，回收全部可回收租约。

        被回收租约的 token 立即失效；资源在该租约记录的硬到期时刻之前不会
        重新发放，杜绝两个持有者同时被判有效的窗口。
        """
        if resource is None:
            reclaimed: List[Dict[str, Any]] = []
            for name in list(self._resources):
                state = self._state_of(self._resources[name])
                if state in (LeaseState.UNCERTAIN, LeaseState.EXPIRED):
                    reclaimed.append(self._reclaim_one(name, state))
            return {"reclaimed": reclaimed}

        name = self._require_name(resource, "资源名")
        if name not in self._resources:
            self._log("reclaim", "denied", "unknown_resource", name, None)
            raise ValidationError("资源不存在: %s" % name)
        rs = self._resources[name]
        state = self._state_of(rs)
        if rs.lease is None or not rs.lease.active:
            self._log("reclaim", "denied", "no_active_lease", name, None)
            raise ValidationError("资源 %s 不存在活跃租约" % name)
        if state == LeaseState.SAFE:
            self._log(
                "reclaim", "denied", "still_in_safe_period", name,
                rs.lease.holder,
                {"expire_mono": rs.lease.expire_mono,
                 "safe_until_mono": rs.lease.expire_mono - rs.lease.epsilon},
            )
            return {"reclaimed": False, "reason": "still_in_safe_period",
                    "state": state.value}
        return {"reclaimed": True, **self._reclaim_one(name, state)}

    def _reclaim_one(self, name: str, state: LeaseState) -> Dict[str, Any]:
        rs = self._resources[name]
        reason = "reclaimed_expired" if state == LeaseState.EXPIRED else "reclaimed_uncertain"
        info = self._end_lease(rs, reason)
        return info

    def _end_lease(
        self, rs: _ResourceState, reason: str, kind: str = "reclaim"
    ) -> Dict[str, Any]:
        lease = rs.lease
        assert lease is not None and lease.active
        rs.lease = self._ended_copy(lease, reason, self.clock.monotonic)
        rs.last_expire_mono = lease.expire_mono
        self._log(
            kind, "ok", reason, rs.name, lease.holder,
            {
                "lease_id": lease.lease_id,
                "generation": lease.generation,
                "expire_mono": lease.expire_mono,
                "safe_until_mono": lease.expire_mono - lease.epsilon,
                "monotonic": self.clock.monotonic,
            },
        )
        return {
            "resource": rs.name,
            "lease_id": lease.lease_id,
            "generation": lease.generation,
            "holder": lease.holder,
            "reason": reason,
            "expire_mono": lease.expire_mono,
        }

    @staticmethod
    def _ended_copy(lease: Lease, reason: str, ended_mono: Optional[float]) -> Lease:
        return Lease(
            lease_id=lease.lease_id,
            resource=lease.resource,
            holder=lease.holder,
            generation=lease.generation,
            grant_mono=lease.grant_mono,
            expire_mono=lease.expire_mono,
            ttl=lease.ttl,
            epsilon=lease.epsilon,
            grant_clock=lease.grant_clock,
            renew_count=lease.renew_count,
            last_renew_mono=lease.last_renew_mono,
            last_renew_clock=lease.last_renew_clock,
            active=False,
            ended_reason=reason,
            ended_mono=ended_mono,
        )

    # ---------------------------------------------------------------- 持久化

    def to_dict(self) -> Dict[str, Any]:
        """导出完整快照（资源、租约、时钟、偏差配置、事件日志）。"""
        clock_dict: Dict[str, Any]
        if isinstance(self.clock, ManualClock):
            clock_dict = {"type": "manual", **self.clock.to_dict()}
        else:  # pragma: no cover - 自定义时钟无法通用序列化
            clock_dict = {
                "type": "manual",
                "now": self.clock.now,
                "high": self.clock.monotonic,
            }
        return {
            "format_version": FORMAT_VERSION,
            "seq": self._seq,
            "clock": clock_dict,
            "resources": {
                name: rs.to_dict() for name, rs in self._resources.items()
            },
            "events": [e.to_dict() for e in self._events],
        }

    def export_json(self, path: str) -> None:
        """把快照写入 ``path``（JSON，UTF-8，带缩进，键排序以便比对）。"""
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.write("\n")

    def import_dict(self, data: Any) -> None:
        """从快照字典恢复；先完整构建并校验新状态，成功后才替换当前状态。

        任何校验失败都抛 :class:`PersistenceError`，当前状态保持不变。
        """
        new = self._build_from_dict(data)
        self.clock = new.clock
        self._resources = new._resources
        self._events = new._events
        self._seq = new._seq

    @classmethod
    def from_dict(cls, data: Any) -> "LeaseKernel":
        """从快照字典构建全新内核，失败抛 :class:`PersistenceError`。"""
        return cls._build_from_dict(data)

    @staticmethod
    def _build_from_dict(data: Any) -> "LeaseKernel":
        if not isinstance(data, dict):
            raise PersistenceError("快照顶层必须是 JSON 对象")
        version = data.get("format_version")
        if version != FORMAT_VERSION:
            raise PersistenceError(
                "不支持的 format_version=%r，期望 %d" % (version, FORMAT_VERSION)
            )
        clock_raw = data.get("clock")
        if not isinstance(clock_raw, dict):
            raise PersistenceError("clock 段缺失或不是对象")
        try:
            clock = ManualClock.from_dict(clock_raw)
        except ValueError as exc:
            raise PersistenceError(str(exc)) from None
        if not math.isfinite(clock.now) or not math.isfinite(clock.monotonic):
            raise PersistenceError("clock 时间必须是有限数")

        resources_raw = data.get("resources")
        if not isinstance(resources_raw, dict):
            raise PersistenceError("resources 段缺失或不是对象")
        kernel = LeaseKernel(clock)
        seen_holders: Dict[str, str] = {}
        for name, rdata in resources_raw.items():
            if not isinstance(name, str) or not name:
                raise PersistenceError("资源名必须是非空字符串")
            if not isinstance(rdata, dict):
                raise PersistenceError("资源 %s 的段必须是对象" % name)
            rs = _ResourceState.from_dict(name, rdata)
            if rs.lease is not None and rs.lease.active:
                # 持有者唯一性：同一资源至多一条活跃租约（结构上已保证），
                # 再校验同一持有者不得在同名资源上出现冲突记录。
                if name in seen_holders:
                    raise PersistenceError("资源 %s 存在多个活跃持有者" % name)
                seen_holders[name] = rs.lease.holder
            kernel._resources[name] = rs

        events_raw = data.get("events")
        if not isinstance(events_raw, list):
            raise PersistenceError("events 段缺失或不是数组")
        expected_seq = 0
        for edata in events_raw:
            if not isinstance(edata, dict):
                raise PersistenceError("事件必须是对象")
            evt = LeaseEvent.from_dict(edata)
            expected_seq += 1
            if evt.seq != expected_seq:
                raise PersistenceError(
                    "事件序号不连续：第 %d 条 seq=%d" % (expected_seq, evt.seq)
                )
            kernel._events.append(evt)
        try:
            saved_seq = int(data["seq"])
        except KeyError:
            raise PersistenceError("顶层缺少 seq") from None
        if saved_seq != expected_seq:
            raise PersistenceError(
                "顶层 seq=%d 与事件条数 %d 不一致" % (saved_seq, expected_seq)
            )
        kernel._seq = saved_seq
        return kernel

    def import_json(self, path: str) -> None:
        """从 JSON 文件恢复；文件损坏/字段缺失抛 :class:`PersistenceError`，
        失败时当前状态保持不变。"""
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except OSError as exc:
            raise PersistenceError("无法读取快照文件: %s" % exc) from None
        except json.JSONDecodeError as exc:
            raise PersistenceError(
                "快照不是合法 JSON（第 %d 行第 %d 列）: %s"
                % (exc.lineno, exc.colno, exc.msg)
            ) from None
        self.import_dict(data)
