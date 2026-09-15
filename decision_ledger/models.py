"""领域对象模型。

设计要点
--------
1. 所有对象可 JSON 序列化（``to_dict`` / ``from_dict``），不依赖第三方库。
2. 证据（Evidence）有两类：
   - 决策前录入的"依据"：kind="basis"
   - 决策后到达、回填进决策的"实际结果"：kind="result"
   两者共用同一套身份/可信度字段，便于推导与冲突检测时统一处理。
3. 结果（Outcome）是对"某次观测"的登记，它本身会被同步物化成一条
   kind="result" 的证据，参与结论推导；outcome 与 evidence 通过
   outcome_id 一一对应，可互相追溯。
4. 状态机：PENDING（待定）→ CHOSEN（已选择）→ REVIEWED（已复盘）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .errors import StateFlowError

# ---- 状态与证据方向常量 ----------------------------------------------------

PENDING = "待定"
CHOSEN = "已选择"
REVIEWED = "已复盘"
DECISION_STATES = (PENDING, CHOSEN, REVIEWED)

# 合法流转表：非法流转在 transition_state 中被拒绝。
_STATE_FLOW: Dict[str, str] = {
    PENDING: CHOSEN,
    CHOSEN: REVIEWED,
}

BASIS = "basis"    # 决策依据
RESULT = "result"  # 实际结果（回填证据）

SUPPORTS = "supports"  # 支持
CONTRADICTS = "contradicts"  # 反对
STANCE_VALUES = (SUPPORTS, CONTRADICTS)

# 结论结论值与立场的映射
STANCE_TO_VERDICT = {
    SUPPORTS: "成立",
    CONTRADICTS: "不成立",
}
VERDICT_TO_STANCE = {v: k for k, v in STANCE_TO_VERDICT.items()}

INITIAL_VERDICT = "待定"


def transition_state(current: str, target: str) -> str:
    """校验状态流转，返回新状态；非法流转抛 StateFlowError。"""
    if current == target:
        raise StateFlowError(f"决策当前已是「{current}」，无需重复流转")
    expected = _STATE_FLOW.get(current)
    if expected is None:
        raise StateFlowError(f"「{current}」是终态，不能再流转到「{target}」")
    if target != expected:
        raise StateFlowError(
            f"非法状态流转：{current} → {target}；"
            f"「{current}」只能流转到「{expected}」"
        )
    return target


@dataclass
class Evidence:
    """依据 / 结果证据。

    属性
    ----
    evidence_id: 同一决策内唯一的标识。
    kind: BASIS 或 RESULT。
    source: 来源说明，必填非空。
    weight: 可信度权重，必须为正数。
    stance: SUPPORTS / CONTRADICTS，该证据对决策主题的立场。
    observed_at: 依据的获取时刻（ISO 字符串）；结果证据取结果发生时刻。
    outcome_id: 结果证据对应的 Outcome 标识；依据为 None。
    content: 证据内容（依据描述或结果观测值文本）。
    """

    evidence_id: str
    kind: str
    source: str
    weight: float
    stance: str
    observed_at: str
    content: str = ""
    outcome_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "evidence_id": self.evidence_id,
            "kind": self.kind,
            "source": self.source,
            "weight": self.weight,
            "stance": self.stance,
            "observed_at": self.observed_at,
            "content": self.content,
            "outcome_id": self.outcome_id,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Evidence":
        return cls(
            evidence_id=d["evidence_id"],
            kind=d["kind"],
            source=d["source"],
            weight=float(d["weight"]),
            stance=d["stance"],
            observed_at=d["observed_at"],
            content=d.get("content", ""),
            outcome_id=d.get("outcome_id"),
        )


@dataclass
class Outcome:
    """决策作出后登记的实际结果（可能很晚才到达，按 decision_id 回填）。"""

    outcome_id: str
    decision_id: str
    occurred_at: str          # 结果实际发生时刻
    observed_value: str       # 观测值
    evidence_id: str          # 该结果自身物化出的（结果）证据标识
    stance: str               # 结果对决策主题的立场
    weight: float             # 结果可信度权重
    source: str               # 结果观测来源
    basis_ids: List[str] = field(default_factory=list)  # 该结果对应的依据标识
    conflicts: List[str] = field(default_factory=list)  # 触发的冲突记录 id

    @property
    def basis_id(self) -> Optional[str]:
        """主对应依据（basis_ids 的第一个），兼容单依据使用方式。"""
        return self.basis_ids[0] if self.basis_ids else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "outcome_id": self.outcome_id,
            "decision_id": self.decision_id,
            "basis_id": self.basis_id,
            "basis_ids": list(self.basis_ids),
            "occurred_at": self.occurred_at,
            "observed_value": self.observed_value,
            "evidence_id": self.evidence_id,
            "stance": self.stance,
            "weight": self.weight,
            "source": self.source,
            "conflicts": list(self.conflicts),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Outcome":
        basis_ids = list(d.get("basis_ids") or [])
        if not basis_ids and d.get("basis_id"):
            basis_ids = [d["basis_id"]]  # 向后兼容旧导出文件
        return cls(
            outcome_id=d["outcome_id"],
            decision_id=d["decision_id"],
            basis_ids=basis_ids,
            occurred_at=d["occurred_at"],
            observed_value=d["observed_value"],
            evidence_id=d["evidence_id"],
            stance=d["stance"],
            weight=float(d["weight"]),
            source=d["source"],
            conflicts=list(d.get("conflicts", [])),
        )


@dataclass
class ConclusionEntry:
    """结论变化轨迹中的一个版本。

    第 0 版是决策创建时的初始结论（「待定」，无触发结果）；
    此后每登记一个结果重算一次，结论若发生变化则追加新版本。
    """

    version: int
    verdict: str
    score_supports: float
    score_contradicts: float
    changed_at: str                       # 本版本生成时刻
    triggering_outcome_id: Optional[str]  # 触发本版本的结果；初始版本为 None
    basis_evidence_ids: List[str]         # 本版本所依据的证据链（快照）
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "verdict": self.verdict,
            "score_supports": self.score_supports,
            "score_contradicts": self.score_contradicts,
            "changed_at": self.changed_at,
            "triggering_outcome_id": self.triggering_outcome_id,
            "basis_evidence_ids": list(self.basis_evidence_ids),
            "note": self.note,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ConclusionEntry":
        return cls(
            version=d["version"],
            verdict=d["verdict"],
            score_supports=float(d["score_supports"]),
            score_contradicts=float(d["score_contradicts"]),
            changed_at=d["changed_at"],
            triggering_outcome_id=d.get("triggering_outcome_id"),
            basis_evidence_ids=list(d.get("basis_evidence_ids", [])),
            note=d.get("note", ""),
        )


@dataclass
class ConflictRecord:
    """矛盾记录：结果与既有依据立场对立时生成，双方都保留、互不覆盖。"""

    conflict_id: str
    decision_id: str
    outcome_id: str
    result_evidence_id: str
    basis_evidence_id: str
    point: str          # 分歧点的可读说明
    created_at: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "conflict_id": self.conflict_id,
            "decision_id": self.decision_id,
            "outcome_id": self.outcome_id,
            "result_evidence_id": self.result_evidence_id,
            "basis_evidence_id": self.basis_evidence_id,
            "point": self.point,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ConflictRecord":
        return cls(
            conflict_id=d["conflict_id"],
            decision_id=d["decision_id"],
            outcome_id=d["outcome_id"],
            result_evidence_id=d["result_evidence_id"],
            basis_evidence_id=d["basis_evidence_id"],
            point=d["point"],
            created_at=d["created_at"],
        )


@dataclass
class Lesson:
    """由某次结论连同其支撑证据/结果固化而成的经验。"""

    lesson_id: str
    source_decision_id: str
    conclusion_version: int          # 固化自结论的第几个版本
    verdict: str
    title: str
    content: str
    created_at: str
    evidence_ids: List[str] = field(default_factory=list)  # 支撑依据+结果证据
    outcome_ids: List[str] = field(default_factory=list)
    cited_by: List[str] = field(default_factory=list)      # 引用它的决策 id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "lesson_id": self.lesson_id,
            "source_decision_id": self.source_decision_id,
            "conclusion_version": self.conclusion_version,
            "verdict": self.verdict,
            "title": self.title,
            "content": self.content,
            "created_at": self.created_at,
            "evidence_ids": list(self.evidence_ids),
            "outcome_ids": list(self.outcome_ids),
            "cited_by": list(self.cited_by),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Lesson":
        return cls(
            lesson_id=d["lesson_id"],
            source_decision_id=d["source_decision_id"],
            conclusion_version=d["conclusion_version"],
            verdict=d["verdict"],
            title=d["title"],
            content=d["content"],
            created_at=d["created_at"],
            evidence_ids=list(d.get("evidence_ids", [])),
            outcome_ids=list(d.get("outcome_ids", [])),
            cited_by=list(d.get("cited_by", [])),
        )


@dataclass
class Decision:
    """一条决策条目。"""

    decision_id: str
    topic: str
    created_at: str                # 发生时刻
    state: str = PENDING
    chosen_option: Optional[str] = None   # 进入「已选择」时记录的选择内容
    chosen_at: Optional[str] = None
    reviewed_at: Optional[str] = None
    evidences: Dict[str, Evidence] = field(default_factory=dict)  # id -> Evidence
    outcomes: Dict[str, Outcome] = field(default_factory=dict)    # id -> Outcome
    conclusion_history: List[ConclusionEntry] = field(default_factory=list)
    conflict_ids: List[str] = field(default_factory=list)
    lesson_ids: List[str] = field(default_factory=list)          # 固化出的经验
    cited_lesson_ids: List[str] = field(default_factory=list)    # 引用的经验

    # ---- 证据访问（统一稳定顺序：按标识字典序） ----

    def evidence_list(self) -> List[Evidence]:
        return [self.evidences[k] for k in sorted(self.evidences)]

    def basis_list(self) -> List[Evidence]:
        return [e for e in self.evidence_list() if e.kind == BASIS]

    def result_evidence_list(self) -> List[Evidence]:
        return [e for e in self.evidence_list() if e.kind == RESULT]

    def outcome_list(self) -> List[Outcome]:
        return [self.outcomes[k] for k in sorted(self.outcomes)]

    def current_conclusion(self) -> Optional[ConclusionEntry]:
        return self.conclusion_history[-1] if self.conclusion_history else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "topic": self.topic,
            "created_at": self.created_at,
            "state": self.state,
            "chosen_option": self.chosen_option,
            "chosen_at": self.chosen_at,
            "reviewed_at": self.reviewed_at,
            "evidences": [e.to_dict() for e in self.evidence_list()],
            "outcomes": [o.to_dict() for o in self.outcome_list()],
            "conclusion_history": [c.to_dict() for c in self.conclusion_history],
            "conflict_ids": list(self.conflict_ids),
            "lesson_ids": list(self.lesson_ids),
            "cited_lesson_ids": list(self.cited_lesson_ids),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Decision":
        evidences = {}
        for ed in d.get("evidences", []):
            e = Evidence.from_dict(ed)
            evidences[e.evidence_id] = e
        outcomes = {}
        for od in d.get("outcomes", []):
            o = Outcome.from_dict(od)
            outcomes[o.outcome_id] = o
        return cls(
            decision_id=d["decision_id"],
            topic=d["topic"],
            created_at=d["created_at"],
            state=d.get("state", PENDING),
            chosen_option=d.get("chosen_option"),
            chosen_at=d.get("chosen_at"),
            reviewed_at=d.get("reviewed_at"),
            evidences=evidences,
            outcomes=outcomes,
            conclusion_history=[
                ConclusionEntry.from_dict(c) for c in d.get("conclusion_history", [])
            ],
            conflict_ids=list(d.get("conflict_ids", [])),
            lesson_ids=list(d.get("lesson_ids", [])),
            cited_lesson_ids=list(d.get("cited_lesson_ids", [])),
        )
