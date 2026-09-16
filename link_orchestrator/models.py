"""数据模型：链路、会话、健康上报、迁移记录、冲突记录与事件信封。

模型本身只做形状序列化；业务校验集中在 ``LinkOrchestrator``，
载入校验集中在 ``persistence``，保证错误信息能指出具体位置。
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any


@dataclass
class Link:
    """上行链路。

    priority 为优先级序号，数值越小优先级越高（默认排序的第一关键字）。
    bandwidth 为带宽上限（字节/逻辑时刻口径的在途容量），必须为正整数。
    """

    id: str
    priority: int
    bandwidth: int
    initially_available: bool = True
    created_at: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]):
        return cls(
            id=d["id"],
            priority=d["priority"],
            bandwidth=d["bandwidth"],
            initially_available=bool(d.get("initially_available", True)),
            created_at=d.get("created_at", 0),
        )


@dataclass
class Session:
    """业务会话。

    bytes_sent 为该会话已发送（在途）字节数；承载链路的在途总量是其上
    所有会话 bytes_sent 之和。current_link 为 None 表示尚未挂载（搁浅）。
    return_link 用于故障迁出后标记“原承载链路”，恢复时据此重算。
    """

    id: str
    service_class: str
    bytes_sent: int
    current_link: Optional[str] = None
    return_link: Optional[str] = None
    created_at: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]):
        return cls(
            id=d["id"],
            service_class=d["service_class"],
            bytes_sent=d["bytes_sent"],
            current_link=d.get("current_link"),
            return_link=d.get("return_link"),
            created_at=d.get("created_at", 0),
        )


@dataclass
class HealthReport:
    """一条健康上报。

    同一链路上报时刻必须非递减。source 为上报来源标识；
    同 (链路, 时刻, 来源, 状态) 的完全重复上报按幂等忽略。
    """

    link_id: str
    time: int
    available: bool
    source: str
    seq: int = 0  # 全局接收序号，用于同时刻平局与可复现重放

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]):
        return cls(
            link_id=d["link_id"],
            time=d["time"],
            available=bool(d["available"]),
            source=d["source"],
            seq=d.get("seq", 0),
        )


@dataclass
class MigrationRecord:
    """一次迁移（含初始挂载，from_link 为 None 表示初始放置）。"""

    seq: int
    time: int
    session_id: str
    service_class: str
    from_link: Optional[str]
    to_link: str
    reason: str
    bytes_sent: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]):
        return cls(
            seq=d["seq"],
            time=d["time"],
            session_id=d["session_id"],
            service_class=d["service_class"],
            from_link=d.get("from_link"),
            to_link=d["to_link"],
            reason=d["reason"],
            bytes_sent=d["bytes_sent"],
        )


@dataclass
class ConflictRecord:
    """同一链路同一时刻互相矛盾的健康状态。

    双方上报都原样保留；编排器不静默择一，链路维持冲突前的有效状态。
    """

    id: str
    link_id: str
    time: int
    source_a: str
    available_a: bool
    source_b: str
    available_b: bool
    effective_status: bool
    created_seq: int
    resolved: bool = False
    resolution: Optional[str] = None

    def describe(self) -> str:
        """人类可读的冲突描述。"""
        sa = "可用" if self.available_a else "不可用"
        sb = "可用" if self.available_b else "不可用"
        tail = f"，处置: {self.resolution}" if self.resolved else ""
        return (
            f"冲突[{self.id}] 链路 {self.link_id!r} 在逻辑时刻 t={self.time} "
            f"收到互相矛盾的健康状态：来源 {self.source_a!r} 上报“{sa}”，"
            f"来源 {self.source_b!r} 上报“{sb}”。双方上报均保留，"
            f"链路维持{'可用' if self.effective_status else '不可用'}状态、"
            f"不据此迁移任何会话，等待显式裁决{tail}。"
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]):
        return cls(
            id=d["id"],
            link_id=d["link_id"],
            time=d["time"],
            source_a=d["source_a"],
            available_a=bool(d["available_a"]),
            source_b=d["source_b"],
            available_b=bool(d["available_b"]),
            effective_status=bool(d["effective_status"]),
            created_seq=d.get("created_seq", 0),
            resolved=bool(d.get("resolved", False)),
            resolution=d.get("resolution"),
        )


@dataclass
class EventEnvelope:
    """已接受操作的事件信封；快照重放与恢复重算都以它为准。"""

    seq: int
    kind: str       # link_added / session_added / report_agreed / migrated / bytes_grew
    time: int
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"seq": self.seq, "kind": self.kind, "time": self.time, "data": self.data}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]):
        return cls(seq=d["seq"], kind=d["kind"], time=d["time"], data=dict(d.get("data", {})))
