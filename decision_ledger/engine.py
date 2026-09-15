"""台账核心逻辑：校验、状态流转、结论推导、冲突检测、经验固化。

结论推导规则（确定性、可解释）
-----------------------------
每条证据（决策依据 + 回填结果）带立场（supports / contradicts）与正权重：

    score_supports    = Σ 支持类证据权重
    score_contradicts = Σ 反对类证据权重

- max 一方严格大于另一方 → 结论「成立」/「不成立」
- 双方相等或都没有证据   → 结论「待定」

每登记一条结果就重算一次；仅当结论（verdict）发生变化时，向变化轨迹
追加一个新版本，记录触发结果与变化前后的结论。权重的细微变化不会产生
新版本，但每次版本都会留存当时的双方总分与证据链快照。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

from .errors import (
    ConflictError,
    NotFoundError,
    StateFlowError,
    ValidationError,
)
from .models import (
    BASIS,
    RESULT,
    CHOSEN,
    CONTRADICTS,
    INITIAL_VERDICT,
    PENDING,
    REVIEWED,
    STANCE_VALUES,
    STANCE_TO_VERDICT,
    SUPPORTS,
    ConclusionEntry,
    ConflictRecord,
    Decision,
    Evidence,
    Lesson,
    Outcome,
    transition_state,
)

_STANCE_ALIASES = {
    SUPPORTS: SUPPORTS,
    CONTRADICTS: CONTRADICTS,
    "支持": SUPPORTS,
    "反对": CONTRADICTS,
    "正面": SUPPORTS,
    "负面": CONTRADICTS,
}


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _parse_iso(value: str, field: str, where: str) -> str:
    """校验时间字符串，返回规范化的 ISO 文本。"""
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{where}的「{field}」缺失：必须填写 ISO 格式时间")
    text = value.strip()
    try:
        datetime.fromisoformat(text)
    except ValueError:
        raise ValidationError(
            f"{where}的「{field}」格式非法：{value!r}，应为 ISO 时间，如 2026-09-01T10:00:00"
        )
    return text


def _normalize_stance(value: str, where: str) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{where}的立场必须是 supports / contradicts（或 支持/反对）")
    stance = _STANCE_ALIASES.get(value.strip())
    if stance is None:
        raise ValidationError(
            f"{where}的立场非法：{value!r}，只支持 supports(支持) / contradicts(反对)"
        )
    return stance


def _check_weight(weight: Any, where: str) -> float:
    try:
        w = float(weight)
    except (TypeError, ValueError):
        raise ValidationError(f"{where}的可信度权重必须是正数，收到 {weight!r}")
    if w <= 0:
        raise ValidationError(f"{where}的可信度权重必须为正数，收到 {w:g}（权重非正）")
    return w


def _check_text(value: Any, field: str, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{where}的「{field}」缺失：必须填写非空文本")
    return value.strip()


class Ledger:
    """内存中的台账。通过 :mod:`decision_ledger.store` 做 JSON 持久化。"""

    def __init__(self, clock: Optional[Callable[[], str]] = now_iso) -> None:
        self.decisions: Dict[str, Decision] = {}
        self.lessons: Dict[str, Lesson] = {}
        self.conflicts: Dict[str, ConflictRecord] = {}
        self._clock = clock
        self._counters = {
            "decision": 0,
            "outcome": 0,
            "conflict": 0,
            "lesson": 0,
        }
        # 每个决策内的依据 / 结果证据序号各自独立：
        # decision_id -> {"B": 依据数, "R": 结果数}
        self._evidence_seq: Dict[str, Dict[str, int]] = {}

    # ------------------------------------------------------------------ #
    # 序列化
    # ------------------------------------------------------------------ #

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": 1,
            "counters": dict(self._counters),
            "evidence_seq": dict(self._evidence_seq),
            "decisions": [self.decisions[k].to_dict()
                          for k in sorted(self.decisions)],
            "conflicts": [self.conflicts[k].to_dict()
                          for k in sorted(self.conflicts)],
            "lessons": [self.lessons[k].to_dict() for k in sorted(self.lessons)],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Ledger":
        ledger = cls(clock=None)  # 反序列化不需要时钟
        ledger._counters.update(data.get("counters", {}))
        ledger._evidence_seq.update(data.get("evidence_seq", {}))
        for d in data.get("decisions", []):
            dec = Decision.from_dict(d)
            ledger.decisions[dec.decision_id] = dec
        for ld in data.get("lessons", []):
            lesson = Lesson.from_dict(ld)
            ledger.lessons[lesson.lesson_id] = lesson
        for cd in data.get("conflicts", []):
            record = ConflictRecord.from_dict(cd)
            ledger.conflicts[record.conflict_id] = record
        return ledger

    def _next_id(self, kind: str, prefix: str) -> str:
        self._counters[kind] += 1
        return f"{prefix}-{self._counters[kind]:04d}"

    # ------------------------------------------------------------------ #
    # 需求 1：决策条目与状态流转
    # ------------------------------------------------------------------ #

    def create_decision(self, topic: str, created_at: Optional[str] = None) -> Decision:
        """新建一条「待定」决策，并写入第 0 版结论（待定）。"""
        topic = _check_text(topic, "主题", "新建决策")
        ts = _parse_iso(created_at, "发生时刻", "新建决策") if created_at else self._now()
        decision_id = self._next_id("decision", "D")
        decision = Decision(decision_id=decision_id, topic=topic, created_at=ts)
        # 初始结论：v0「待定」，无触发结果，证据链为空。
        decision.conclusion_history.append(
            ConclusionEntry(
                version=0,
                verdict=INITIAL_VERDICT,
                score_supports=0.0,
                score_contradicts=0.0,
                changed_at=ts,
                triggering_outcome_id=None,
                basis_evidence_ids=[],
                note="决策建立，尚无依据与结果",
            )
        )
        self.decisions[decision_id] = decision
        self._evidence_seq[decision_id] = {"B": 0, "R": 0}
        return decision

    def mark_chosen(self, decision_id: str, option: str,
                    chosen_at: Optional[str] = None) -> Decision:
        """待定 → 已选择，记录所选方案，并基于既有依据形成初判结论。"""
        decision = self._require_decision(decision_id)
        try:
            decision.state = transition_state(decision.state, CHOSEN)
        except StateFlowError:
            raise
        decision.chosen_option = _check_text(option, "所选方案", f"决策 {decision_id}")
        decision.chosen_at = _parse_iso(chosen_at, "选择时刻", f"决策 {decision_id}") \
            if chosen_at else self._now()
        # 决策作出：基于决策前录入的依据形成第一版实质性结论。
        self._recompute_conclusion(decision, triggering_outcome_id=None)
        return decision

    def mark_reviewed(self, decision_id: str,
                      reviewed_at: Optional[str] = None) -> Decision:
        """已选择 → 已复盘。"""
        decision = self._require_decision(decision_id)
        decision.state = transition_state(decision.state, REVIEWED)
        decision.reviewed_at = _parse_iso(reviewed_at, "复盘时刻", f"决策 {decision_id}") \
            if reviewed_at else self._now()
        return decision

    # ------------------------------------------------------------------ #
    # 需求 2：依据
    # ------------------------------------------------------------------ #

    def add_basis(
        self,
        decision_id: str,
        source: str,
        weight: float,
        stance: str,
        content: str = "",
        evidence_id: Optional[str] = None,
        observed_at: Optional[str] = None,
    ) -> Evidence:
        """向待定决策追加一条依据。

        依据标识在同一决策内不得重复；来源缺失、权重非正都会被拒绝，
        错误信息指出问题依据所在的决策、序号与标识。
        """
        decision = self._require_decision(decision_id)
        if decision.state != PENDING:
            raise StateFlowError(
                f"决策 {decision_id} 当前为「{decision.state}」：依据只能在「{PENDING}」"
                f"阶段录入；决策作出后到达的信息请用 record_outcome 登记为结果"
            )

        seq = self._evidence_seq.get(decision_id, {"B": 0, "R": 0})["B"] + 1
        eid = evidence_id.strip() if isinstance(evidence_id, str) and evidence_id.strip() \
            else f"{decision_id}.B{seq:02d}"
        where = f"决策 {decision_id} 的第 {seq} 条依据（evidence_id={eid}）"

        if eid in decision.evidences:
            raise ConflictError(
                f"依据标识重复：{where} 在该决策下已存在，同一决策内标识不得重复"
            )
        src = _check_text(source, "来源", where)
        w = _check_weight(weight, where)
        st = _normalize_stance(stance, where)
        ts = _parse_iso(observed_at, "获取时刻", where) if observed_at else self._now()
        text = content.strip() if isinstance(content, str) else ""

        evidence = Evidence(
            evidence_id=eid,
            kind=BASIS,
            source=src,
            weight=w,
            stance=st,
            observed_at=ts,
            content=text,
        )
        decision.evidences[eid] = evidence
        self._evidence_seq.setdefault(decision_id, {"B": 0, "R": 0})["B"] = seq
        return evidence

    # ------------------------------------------------------------------ #
    # 需求 3 + 4 + 5：结果登记（迟到回填）、结论推导、冲突记录
    # ------------------------------------------------------------------ #

    def record_outcome(
        self,
        decision_id: str,
        basis_id: str,
        observed_value: str,
        stance: str,
        weight: float,
        source: str,
        occurred_at: str,
    ) -> Tuple[Outcome, List[ConflictRecord], Optional[ConclusionEntry]]:
        """登记一条实际结果并回填到决策。

        - 决策必须已作出选择（已选择/已复盘均可）——复盘后很久才到的
          "迟到结果"同样允许回填。
        - basis_id 是该结果对应的依据，必须存在。
        - 与既有依据立场对立时，为每一对对立生成冲突记录并保留双方。
        - 登记后重算结论；结论变化时追加轨迹版本。

        返回 (结果对象, 新冲突列表, 新结论版本或 None)。
        """
        decision = self._require_decision(decision_id)
        if decision.state == PENDING:
            raise StateFlowError(
                f"决策 {decision_id} 尚未作出选择（当前「{PENDING}」），"
                f"实际结果只能在决策作出后登记"
            )

        basis = decision.evidences.get(basis_id)
        where = f"决策 {decision_id} 登记结果（对应依据 {basis_id}）"
        if basis is None or basis.kind != BASIS:
            raise NotFoundError(
                f"{where} 失败：该决策下不存在标识为 {basis_id} 的依据，"
                f"结果必须对应一条既有依据"
            )

        value = _check_text(observed_value, "观测值", where)
        ts = _parse_iso(occurred_at, "发生时刻", where)
        st = _normalize_stance(stance, where)
        w = _check_weight(weight, where)
        src = _check_text(source, "来源", where)

        outcome_id = self._next_id("outcome", "O")
        counters = self._evidence_seq.setdefault(decision_id, {"B": 0, "R": 0})
        seq = counters["R"] + 1
        result_eid = f"{decision_id}.R{seq:02d}"
        # 同一决策内证据标识不冲突（结果标识由系统按序号生成，此处双保险）
        if result_eid in decision.evidences:  # pragma: no cover - 理论不可达
            raise ConflictError(f"结果证据标识 {result_eid} 已存在")
        counters["R"] = seq

        result_evidence = Evidence(
            evidence_id=result_eid,
            kind=RESULT,
            source=src,
            weight=w,
            stance=st,
            observed_at=ts,
            content=value,
            outcome_id=outcome_id,
        )
        decision.evidences[result_eid] = result_evidence

        outcome = Outcome(
            outcome_id=outcome_id,
            decision_id=decision_id,
            basis_id=basis.evidence_id,
            occurred_at=ts,
            observed_value=value,
            evidence_id=result_eid,
            stance=st,
            weight=w,
            source=src,
        )
        decision.outcomes[outcome_id] = outcome

        # 需求 5：与立场对立的既有依据逐一生成冲突记录，双方原样保留。
        conflicts = self._detect_conflicts(
            decision, outcome, result_evidence, linked_basis_id=basis.evidence_id
        )

        # 需求 4：重算结论并记录变化。
        new_entry = self._recompute_conclusion(decision, outcome_id)
        return outcome, conflicts, new_entry

    def _detect_conflicts(
        self,
        decision: Decision,
        outcome: Outcome,
        result_evidence: Evidence,
        linked_basis_id: str,
    ) -> List[ConflictRecord]:
        conflicts: List[ConflictRecord] = []
        for other in decision.basis_list():
            if other.stance == result_evidence.stance:
                continue
            # 与每一条立场对立的既有依据都生成冲突记录；该结果直接对应的
            # 依据在分歧点中特别标出。
            linked = "（该结果直接对应的依据）" if other.evidence_id == linked_basis_id else ""
            self._counters["conflict"] += 1
            cid = f"C-{self._counters['conflict']:04d}"
            point = (
                f"决策主题「{decision.topic}」上立场对立："
                f"依据 {other.evidence_id}（来源 {other.source}）"
                f"认为「{STANCE_TO_VERDICT[other.stance]}」，"
                f"而结果 {outcome.outcome_id}（观测：{outcome.observed_value}，"
                f"来源 {outcome.source}）表明「{STANCE_TO_VERDICT[result_evidence.stance]}」；"
                f"分歧点在于该依据对主题的判断与实际观测不符{linked}"
            )
            record = ConflictRecord(
                conflict_id=cid,
                decision_id=decision.decision_id,
                outcome_id=outcome.outcome_id,
                result_evidence_id=result_evidence.evidence_id,
                basis_evidence_id=other.evidence_id,
                point=point,
                created_at=self._now(),
            )
            conflicts.append(record)
            self.conflicts[cid] = record
            decision.conflict_ids.append(cid)
            outcome.conflicts.append(cid)
        return conflicts

    def _scores(self, decision: Decision) -> Tuple[float, float, List[str]]:
        s_for = s_against = 0.0
        ids: List[str] = []
        for e in decision.evidence_list():
            ids.append(e.evidence_id)
            if e.stance == SUPPORTS:
                s_for += e.weight
            else:
                s_against += e.weight
        return s_for, s_against, ids

    def _verdict(self, s_for: float, s_against: float) -> str:
        if s_for == 0.0 and s_against == 0.0:
            return INITIAL_VERDICT
        if s_for == s_against:
            return INITIAL_VERDICT
        return STANCE_TO_VERDICT[SUPPORTS] if s_for > s_against \
            else STANCE_TO_VERDICT[CONTRADICTS]

    def _recompute_conclusion(
        self, decision: Decision,
        triggering_outcome_id: Optional[str],
    ) -> Optional[ConclusionEntry]:
        s_for, s_against, ids = self._scores(decision)
        verdict = self._verdict(s_for, s_against)
        current = decision.current_conclusion()
        if current is not None and current.verdict == verdict:
            return None  # 结论未变：不新增版本，避免轨迹噪声。
        if triggering_outcome_id is None and current is not None \
                and current.verdict == INITIAL_VERDICT:
            note = f"决策作出，基于既有依据形成初判「{verdict}」"
        elif current:
            note = (f"结论由「{current.verdict}」变为「{verdict}」"
                    + (f"，触发结果 {triggering_outcome_id}"
                       if triggering_outcome_id else ""))
        else:
            note = f"结论初始化为「{verdict}」"
        entry = ConclusionEntry(
            version=(current.version + 1) if current else 0,
            verdict=verdict,
            score_supports=round(s_for, 10),
            score_contradicts=round(s_against, 10),
            changed_at=self._now(),
            triggering_outcome_id=triggering_outcome_id,
            basis_evidence_ids=ids,
            note=note,
        )
        decision.conclusion_history.append(entry)
        return entry

    # ------------------------------------------------------------------ #
    # 需求 6：经验固化与引用
    # ------------------------------------------------------------------ #

    def crystallize_lesson(
        self,
        decision_id: str,
        title: str,
        content: str,
        version: Optional[int] = None,
    ) -> Lesson:
        """把某次结论连同支撑它的依据与结果固化为经验。"""
        decision = self._require_decision(decision_id)
        t = _check_text(title, "经验标题", f"决策 {decision_id} 固化经验")
        c = _check_text(content, "经验内容", f"决策 {decision_id} 固化经验")

        if not decision.conclusion_history:  # pragma: no cover - 创建时必有 v0
            raise ValidationError(f"决策 {decision_id} 尚无结论，无法固化经验")
        entry = self._conclusion_version(decision, version)
        if entry.verdict == INITIAL_VERDICT:
            raise ValidationError(
                f"决策 {decision_id} 的第 {entry.version} 版结论仍为「{INITIAL_VERDICT}」，"
                f"没有成形结论，不能固化为经验"
            )

        winning_stance = SUPPORTS if entry.verdict == STANCE_TO_VERDICT[SUPPORTS] \
            else CONTRADICTS
        # 固化当前版结论：取当下台账中与结论同向的全部依据与结果（包括没有
        # 翻转结论、故不在版本快照里的同向结果）；显式固化某个历史版本时，
        # 严格限定在该版本形成时的证据快照内。
        latest = decision.conclusion_history[-1]
        if version is not None and entry.version != latest.version:
            scope = {eid for eid in entry.basis_evidence_ids}
            evidence_pool = [e for e in decision.evidence_list()
                             if e.evidence_id in scope]
        else:
            evidence_pool = decision.evidence_list()
        evidence_ids = sorted(
            e.evidence_id for e in evidence_pool
            if e.kind == BASIS and e.stance == winning_stance
        )
        outcome_ids = sorted(
            e.outcome_id for e in evidence_pool
            if e.kind == RESULT and e.stance == winning_stance and e.outcome_id
        )

        lesson_id = self._next_id("lesson", "L")
        lesson = Lesson(
            lesson_id=lesson_id,
            source_decision_id=decision_id,
            conclusion_version=entry.version,
            verdict=entry.verdict,
            title=t,
            content=c,
            created_at=self._now(),
            evidence_ids=evidence_ids,
            outcome_ids=outcome_ids,
        )
        self.lessons[lesson_id] = lesson
        decision.lesson_ids = sorted(set(decision.lesson_ids) | {lesson_id})
        return lesson

    def cite_lesson(self, decision_id: str, lesson_id: str) -> Decision:
        """决策引用一条既有经验；经验不存在或重复引用都会被拒绝。"""
        decision = self._require_decision(decision_id)
        if lesson_id not in self.lessons:
            raise NotFoundError(
                f"决策 {decision_id} 引用经验失败：不存在标识为 {lesson_id} 的经验；"
                f"请先用 crystallize_lesson 固化，或检查标识"
            )
        if lesson_id in decision.cited_lesson_ids:
            raise ConflictError(
                f"决策 {decision_id} 已经引用过经验 {lesson_id}，不能重复引用"
            )
        lesson = self.lessons[lesson_id]
        decision.cited_lesson_ids = sorted(
            set(decision.cited_lesson_ids) | {lesson_id}
        )
        lesson.cited_by = sorted(set(lesson.cited_by) | {decision_id})
        return decision

    # ------------------------------------------------------------------ #
    # 需求 7：查询（全部稳定顺序）
    # ------------------------------------------------------------------ #

    def list_decisions(self) -> List[Decision]:
        return [self.decisions[k] for k in sorted(self.decisions)]

    def get_decision(self, decision_id: str) -> Decision:
        return self._require_decision(decision_id)

    def current_conclusion(self, decision_id: str) -> ConclusionEntry:
        decision = self._require_decision(decision_id)
        return decision.current_conclusion()

    def conclusion_trajectory(self, decision_id: str) -> List[ConclusionEntry]:
        """结论变化轨迹：按版本号升序（追加顺序），含触发结果。"""
        decision = self._require_decision(decision_id)
        return list(decision.conclusion_history)

    def reasoning_chain(
        self, decision_id: str, version: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """推导依据链。

        稳定顺序：先依据（按标识升序），再结果证据（按发生时刻、标识升序）。
        每条返回立场、权重、来源、贡献分值以及是否参与该版本快照。
        """
        decision = self._require_decision(decision_id)
        entry = self._conclusion_version(decision, version)
        snapshot = set(entry.basis_evidence_ids)

        bases = sorted(
            (e for e in decision.evidence_list() if e.kind == BASIS),
            key=lambda e: e.evidence_id,
        )
        results = sorted(
            (e for e in decision.evidence_list() if e.kind == RESULT),
            key=lambda e: (e.observed_at, e.evidence_id),
        )
        chain: List[Dict[str, Any]] = []
        for e in list(bases) + list(results):
            chain.append({
                "evidence_id": e.evidence_id,
                "kind": e.kind,
                "source": e.source,
                "content": e.content,
                "stance": e.stance,
                "stance_cn": "支持" if e.stance == SUPPORTS else "反对",
                "weight": e.weight,
                "observed_at": e.observed_at,
                "outcome_id": e.outcome_id,
                "contributes_score": e.weight
                if e.stance == SUPPORTS else -e.weight,
                "in_version_snapshot": e.evidence_id in snapshot,
            })
        return chain

    def list_conflicts(self, decision_id: Optional[str] = None) -> List[ConflictRecord]:
        """冲突记录，按冲突标识升序；可限定某条决策。"""
        if decision_id is not None:
            decision = self._require_decision(decision_id)
            ids = set(decision.conflict_ids)
            return [self._conflict_by_id(cid) for cid in sorted(ids)]
        records: List[ConflictRecord] = []
        for decision in self.list_decisions():
            records.extend(self.list_conflicts(decision.decision_id))
        return records

    def _conflict_by_id(self, conflict_id: str) -> ConflictRecord:
        if conflict_id not in self.conflicts:
            raise NotFoundError(f"冲突记录 {conflict_id} 不存在")
        return self.conflicts[conflict_id]

    def list_lessons(self) -> List[Lesson]:
        return [self.lessons[k] for k in sorted(self.lessons)]

    def get_lesson(self, lesson_id: str) -> Lesson:
        if lesson_id not in self.lessons:
            raise NotFoundError(f"经验 {lesson_id} 不存在")
        return self.lessons[lesson_id]

    def lesson_references(self, lesson_id: str) -> Dict[str, Any]:
        """某条经验被哪些决策引用过：cited_by 按标识升序稳定返回。"""
        lesson = self.get_lesson(lesson_id)
        return {
            "lesson_id": lesson.lesson_id,
            "source_decision_id": lesson.source_decision_id,
            "cited_by": sorted(lesson.cited_by),
        }

    # ------------------------------------------------------------------ #
    # 内部工具
    # ------------------------------------------------------------------ #

    def _require_decision(self, decision_id: str) -> Decision:
        if decision_id not in self.decisions:
            raise NotFoundError(f"决策 {decision_id} 不存在")
        return self.decisions[decision_id]

    def _conclusion_version(
        self, decision: Decision, version: Optional[int]
    ) -> ConclusionEntry:
        history = decision.conclusion_history
        if not history:  # pragma: no cover
            raise NotFoundError(f"决策 {decision.decision_id} 尚无结论版本")
        if version is None:
            return history[-1]
        for entry in history:
            if entry.version == version:
                return entry
        raise NotFoundError(
            f"决策 {decision.decision_id} 不存在第 {version} 版结论，"
            f"现有版本：{[e.version for e in history]}"
        )

    def _now(self) -> str:
        if self._clock is None:  # 反序列化对象上再操作时的兜底
            return now_iso()
        return self._clock()
