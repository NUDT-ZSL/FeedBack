"""条带存储修复引擎。

:class:`StorageEngine` 维护全部条带，接收逐条操作请求：创建条带、
写入/更新块、标记丢失或损坏、登记候选、触发修复、只读验证、查询
状态、查询修复历史、查看内部状态（导出/导入见
:mod:`storage_repair.persistence`）。

修复与验证共用 :meth:`StorageEngine._assess` 的纯评估逻辑，因此
“能否重建 / 冲突位置组合 / 参与位置”在验证报告与实际修复之间永远
一致。所有遍历均按位置编号升序或字符串字典序进行，修复记录与最终
内容在相同初始状态下重复执行完全相同（与候选到达顺序无关）。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from .coding import ReedSolomonCodec
from .diagnosis import (
    DiagnosisLimitReached,
    diagnose,
    resolve_candidates,
)
from .models import (
    Block,
    BlockStatus,
    Candidate,
    DuplicateStripeError,
    InvalidConfigError,
    InvalidContentError,
    InvalidPositionError,
    PositionError,
    RepairRecord,
    Stripe,
    StripeNotFoundError,
    VerificationReport,
)


class DuplicateCandidateError(PositionError):
    """同一位置上使用已存在的来源标签登记了不同内容。"""


def sha256_hex(content: bytes) -> str:
    """返回字节内容的 SHA-256 十六进制指纹。"""
    return hashlib.sha256(content).hexdigest()


@dataclass
class CandidateResolution:
    """单个位置的候选裁决结果（评估内部使用）。

    :ivar position: 位置编号。
    :ivar outcome: unanimous / majority / conflict。
    :ivar content: 被采纳内容（冲突时为 ``None``）。
    :ivar source: 代表来源（冲突时为 ``None``）。
    """

    position: int
    outcome: str
    content: Optional[bytes]
    source: Optional[str]


@dataclass
class Assessment:
    """一次全条带评估的结论，修复与验证共用。

    字段含义见各属性；``reconstructable=False`` 时 ``reason`` 给出
    明确原因，``combos`` 列出互相矛盾的位置组合（可能为空）。
    """

    targets: List[int]
    trusted: Dict[int, bytes]
    adopted: Dict[int, CandidateResolution]
    resolutions: Dict[int, CandidateResolution]
    candidate_conflicts: List[int]
    bad_sets: List[List[int]]
    combos: List[List[int]]
    reconstructable: bool
    reason: Optional[str]
    used_positions: List[int]
    trigger_reason: str
    ambiguous: bool = False


class StorageEngine:
    """离线条带存储与修复引擎。仅使用 Python 标准库。"""

    def __init__(self) -> None:
        self._stripes: Dict[str, Stripe] = {}
        self._histories: Dict[str, List[RepairRecord]] = {}
        self._codecs: Dict[str, ReedSolomonCodec] = {}
        # 最近一次导入快照中携带的验证报告（导入后可查询；修复后不自动更新）。
        self._imported_reports: Dict[str, VerificationReport] = {}

    # --- 条带管理 ----------------------------------------------------------

    def create_stripe(
        self,
        stripe_id: str,
        k: int,
        m: int,
        data_blocks: Optional[Sequence[bytes]] = None,
    ) -> Stripe:
        """创建条带。

        :param stripe_id: 非空唯一标识。
        :param k: 数据块数量（≥1）。
        :param m: 校验块数量（≥0，k+m≤256），创建后不可更改。
        :param data_blocks: 可选的 k 个数据块初始内容；不给定时所有
            位置以“缺失”开始。块长可不同，右侧补零对齐，补零数按
            位置记录。
        :return: 新创建的 :class:`Stripe`。
        :raises DuplicateStripeError: 标识已存在。
        :raises InvalidConfigError: 参数非法。
        """
        if not isinstance(stripe_id, str) or not stripe_id:
            raise InvalidConfigError("stripe id must be a non-empty string")
        if stripe_id in self._stripes:
            raise DuplicateStripeError(
                f"stripe id {stripe_id!r} already exists", stripe_id
            )
        if not isinstance(k, int) or isinstance(k, bool) or k < 1:
            raise InvalidConfigError("k must be a positive integer")
        if not isinstance(m, int) or isinstance(m, bool) or m < 0 or k + m > 256:
            raise InvalidConfigError("m must satisfy 0 <= m and k + m <= 256")
        blocks = [
            Block(position=pos, content=None, status=BlockStatus.MISSING)
            for pos in range(k + m)
        ]
        stripe = Stripe(
            stripe_id=stripe_id, k=k, m=m, blocks=blocks, block_length=0
        )
        self._stripes[stripe_id] = stripe
        self._histories[stripe_id] = []
        self._codecs[stripe_id] = ReedSolomonCodec(k, m)
        if data_blocks is not None:
            if len(data_blocks) != k:
                raise InvalidConfigError(
                    f"expected {k} data blocks, got {len(data_blocks)}"
                )
            block_length = max((len(b) for b in data_blocks), default=0)
            stripe.block_length = block_length
            for pos, content in enumerate(data_blocks):
                self._store_content(stripe, pos, content)
            self._recompute_parity_from_data(stripe)
            for block in stripe.blocks:
                block.status = BlockStatus.INTACT
        return stripe

    def list_stripes(self) -> List[str]:
        """返回全部条带标识（字典序）。"""
        return sorted(self._stripes)

    def get_stripe(self, stripe_id: str) -> Stripe:
        """按标识取条带；不存在抛 :class:`StripeNotFoundError`。"""
        try:
            return self._stripes[stripe_id]
        except KeyError:
            raise StripeNotFoundError(
                f"stripe {stripe_id!r} does not exist", stripe_id
            ) from None

    # --- 块写入与标记 ------------------------------------------------------

    def write_block(self, stripe_id: str, position: int, content: bytes) -> None:
        """写入或更新某位置的块内容，该位置转为完好状态。

        内容长度不得超过条带块长；条带块长为 0（空条带）时由首次
        写入确定。短于块长时右侧补零（补零数按位置记录）。写入会
        清空该位置已登记的候选（旧候选针对的是此前的内容）。
        """
        stripe = self.get_stripe(stripe_id)
        self._check_position(stripe, position)
        if not isinstance(content, bytes):
            raise InvalidContentError(
                "block content must be bytes", stripe_id, position
            )
        if stripe.block_length == 0:
            stripe.block_length = len(content)
        self._store_content(stripe, position, content)
        block = stripe.block(position)
        block.status = BlockStatus.INTACT
        block.candidates = []

    def mark_missing(self, stripe_id: str, position: int) -> None:
        """把位置标记为丢失并清除其当前内容。

        重复标记同一位置为幂等操作：已经是丢失状态时不报错、不改动。
        补零长度与已登记候选保留，供修复时裁决使用。
        """
        stripe = self.get_stripe(stripe_id)
        self._check_position(stripe, position)
        block = stripe.block(position)
        block.content = None
        block.status = BlockStatus.MISSING

    def mark_corrupt(self, stripe_id: str, position: int) -> None:
        """把位置标记为损坏。

        内容若仍在则保留但修复时不予信任（仅用于诊断）；无内容时
        效果等同于丢失。重复标记幂等。
        """
        stripe = self.get_stripe(stripe_id)
        self._check_position(stripe, position)
        stripe.block(position).status = BlockStatus.CORRUPT

    def add_candidate(
        self, stripe_id: str, position: int, source: str, content: bytes
    ) -> None:
        """为某位置登记一份候选内容。

        :param source: 非空来源标签；同一位置内唯一。同一来源重复
            登记**完全相同**的内容是幂等 no-op；登记不同内容抛
            :class:`DuplicateCandidateError`。
        候选长度不得超过条带块长（块长为 0 时由首份候选确定）。
        本操作不修改位置状态，结论在修复/验证时按
        :mod:`storage_repair.diagnosis` 的规则统一裁决；裁决只依赖
        候选内容与份数，与登记顺序无关。
        """
        stripe = self.get_stripe(stripe_id)
        self._check_position(stripe, position)
        if not isinstance(source, str) or not source:
            raise PositionError(
                "candidate source must be a non-empty string", stripe_id, position
            )
        if not isinstance(content, bytes):
            raise InvalidContentError(
                "candidate content must be bytes", stripe_id, position
            )
        if stripe.block_length == 0:
            stripe.block_length = len(content)
        if len(content) > stripe.block_length:
            raise InvalidContentError(
                f"candidate length {len(content)} exceeds stripe block length "
                f"{stripe.block_length}",
                stripe_id,
                position,
            )
        block = stripe.block(position)
        for existing in block.candidates:
            if existing.source == source:
                if existing.content == content:
                    return
                raise DuplicateCandidateError(
                    f"source {source!r} already registered different content at "
                    "this position",
                    stripe_id,
                    position,
                )
        block.candidates.append(Candidate(content=content, source=source))

    # --- 修复 --------------------------------------------------------------

    def repair_stripe(
        self, stripe_id: str, positions: Optional[Sequence[int]] = None
    ) -> RepairRecord:
        """对条带执行一次修复，返回并归档确定性的 :class:`RepairRecord`。

        :param positions: 显式指定要修复的位置；默认自动选取全部
            非完好位置、携带候选的位置以及诊断出的不一致位置。
        :return: 修复记录。修复失败（缺失过多、候选冲突、矛盾无法
            唯一确定、枚举超限）时不修改任何块内容或状态，归档一条
            ``success=False`` 的记录，并在 ``reason`` 中说明原因，
            ``inconsistent_positions`` 列出矛盾位置组合。
        """
        stripe = self.get_stripe(stripe_id)
        codec = self._codecs[stripe_id]
        explicit = positions is not None
        explicit_targets: Optional[List[int]] = None
        if explicit:
            explicit_targets = sorted(set(positions))
            for pos in explicit_targets:
                self._check_position(stripe, pos)

        assessment = self._assess(stripe, codec, explicit_targets)
        history = self._histories[stripe_id]
        sequence = len(history) + 1

        if not assessment.reconstructable:
            record = RepairRecord(
                sequence=sequence,
                trigger_reason=assessment.trigger_reason,
                target_positions=assessment.targets,
                used_positions=[],
                candidate_sources={},
                adopted_fingerprints={},
                inconsistent_positions=assessment.combos,
                success=False,
                reason=assessment.reason,
            )
            history.append(record)
            return record

        # 计算每个目标位置最终安装的（逻辑）内容。
        installed: Dict[int, bytes] = {}
        sources: Dict[int, str] = {}
        reconstruct: List[int] = []
        for pos in assessment.targets:
            resolution = assessment.adopted.get(pos)
            if resolution is not None and resolution.content is not None:
                installed[pos] = resolution.content
                sources[pos] = resolution.source  # type: ignore[assignment]
            else:
                reconstruct.append(pos)

        used: List[int] = []
        if reconstruct:
            available = [
                (pos, assessment.trusted[pos])
                for pos in sorted(assessment.trusted)
                if pos not in reconstruct
            ]
            recovered, used = codec.reconstruct_positions(available, reconstruct)
            for pos, padded in zip(reconstruct, recovered):
                block = stripe.block(pos)
                if pos < stripe.k and block.pad_length:
                    installed[pos] = padded[: len(padded) - block.pad_length]
                else:
                    installed[pos] = padded

        # 全部内容计算成功后再落地，避免半修复状态。
        for pos in assessment.targets:
            logical = installed[pos]
            block = stripe.block(pos)
            block.content = logical
            block.pad_length = stripe.block_length - len(logical)
            block.status = BlockStatus.INTACT
            block.candidates = []

        fingerprints = {
            pos: sha256_hex(installed[pos]) for pos in sorted(installed)
        }
        record = RepairRecord(
            sequence=sequence,
            trigger_reason=assessment.trigger_reason,
            target_positions=assessment.targets,
            used_positions=used,
            candidate_sources={pos: sources[pos] for pos in sorted(sources)},
            adopted_fingerprints=fingerprints,
            inconsistent_positions=assessment.combos,
            success=True,
            reason=None,
        )
        history.append(record)
        return record

    # --- 验证与查询 --------------------------------------------------------

    def verify_stripe(self, stripe_id: str) -> VerificationReport:
        """对条带做只读完整性验证。

        不修改任何块内容或状态；同一输入重复验证得到完全相同的结论
        与报告顺序。被标记为完好但与校验方程矛盾、且坏位置可唯一
        诊断时，报告状态呈现为 ``corrupt``（条带中的实际标记不变）；
        矛盾无法唯一确定时，相关位置在 ``detail`` 中注明参与了无法
        裁决的矛盾组合。
        """
        stripe = self.get_stripe(stripe_id)
        codec = self._codecs[stripe_id]
        assessment = self._assess(stripe, codec, None)

        uniquely_bad: set[int] = set()
        if not assessment.ambiguous and len(assessment.bad_sets) == 1:
            uniquely_bad = set(assessment.bad_sets[0])
        combo_members = {
            pos for combo in assessment.combos for pos in combo
        } if assessment.ambiguous else set()

        statuses: Dict[int, BlockStatus] = {}
        details: Dict[int, str] = {}
        for block in stripe.blocks:
            pos = block.position
            status = block.status
            if pos in assessment.candidate_conflicts:
                status = BlockStatus.CONFLICT
                detail = "candidates disagree without a strict majority"
            elif status == BlockStatus.INTACT and pos in uniquely_bad:
                status = BlockStatus.CORRUPT
                kind = "parity" if pos >= codec.k else "data"
                detail = (
                    f"declared intact but contradicts the parity equations "
                    f"(uniquely diagnosed bad {kind} block)"
                )
            else:
                detail = self._status_detail(block)
            if assessment.ambiguous and pos in combo_members:
                detail = (
                    f"{detail}; participates in an unresolvable contradiction "
                    f"(see inconsistent_positions)"
                )
            statuses[pos] = status
            details[pos] = detail
        return VerificationReport(
            stripe_id=stripe_id,
            positions=statuses,
            reconstructable=assessment.reconstructable,
            inconsistent_positions=assessment.combos,
            detail=details,
        )

    def query_position(self, stripe_id: str, position: int) -> Dict[str, Any]:
        """查询某位置的状态详情（纯只读，不触发裁决或修改）。"""
        stripe = self.get_stripe(stripe_id)
        self._check_position(stripe, position)
        block = stripe.block(position)
        return {
            "stripe_id": stripe_id,
            "position": position,
            "kind": "data" if position < stripe.k else "parity",
            "status": block.status.value,
            "has_content": block.content is not None,
            "length": None if block.content is None else len(block.content),
            "pad_length": block.pad_length,
            "fingerprint": (
                None if block.content is None else sha256_hex(block.content)
            ),
            "candidates": [
                {
                    "source": cand.source,
                    "length": len(cand.content),
                    "fingerprint": cand.fingerprint(),
                }
                for cand in sorted(block.candidates, key=lambda c: c.source)
            ],
        }

    def repair_history(self, stripe_id: str) -> List[RepairRecord]:
        """返回条带的修复历史记录列表（按序号升序的副本）。"""
        self.get_stripe(stripe_id)
        return list(self._histories[stripe_id])

    def imported_report(self, stripe_id: str) -> Optional[VerificationReport]:
        """返回最近一次导入快照中该条带携带的验证报告；无则为 ``None``。"""
        self.get_stripe(stripe_id)
        return self._imported_reports.get(stripe_id)

    def internal_state(self) -> Dict[str, Any]:
        """查看内部状态：每条带的配置、位置状态、候选与历史数量。"""
        result: Dict[str, Any] = {"stripes": {}}
        for stripe_id in sorted(self._stripes):
            stripe = self._stripes[stripe_id]
            result["stripes"][stripe_id] = {
                "k": stripe.k,
                "m": stripe.m,
                "total": stripe.total,
                "block_length": stripe.block_length,
                "positions": {
                    str(pos): {
                        "status": stripe.block(pos).status.value,
                        "has_content": stripe.block(pos).content is not None,
                        "candidate_count": len(stripe.block(pos).candidates),
                    }
                    for pos in range(stripe.total)
                },
                "repair_history_count": len(self._histories[stripe_id]),
            }
        return result

    # --- 评估（修复与验证共用，只读） --------------------------------------

    def _assess(
        self,
        stripe: Stripe,
        codec: ReedSolomonCodec,
        explicit_targets: Optional[List[int]],
    ) -> Assessment:
        """对条带做纯只读评估，结论封装在 :class:`Assessment`。

        评估步骤（全部按确定顺序）：

        1. 对每个携带候选的位置按候选规则裁决（与到达顺序无关）；
        2. 组装受信任内容：显式目标处的候选采纳值、完好块内容；
        3. 候选冲突 → 直接失败；
        4. 受信任内容不少于 k 时做统一静默诊断（unique 修复；
           ambiguous / underdetermined 拒绝并列出全部组合）；
        5. 移除唯一坏块集后复核依据块数量是否达到 k；
        6. 输出目标、依据位置（编号最小的 k 个）与触发原因。
        """
        k, m = stripe.k, stripe.m

        # 1) 候选裁决（位置升序；结论与候选到达顺序无关）。
        resolutions: Dict[int, CandidateResolution] = {}
        candidate_conflicts: List[int] = []
        for block in stripe.blocks:
            if block.candidates:
                decision = resolve_candidates(
                    [(cand.source, cand.content) for cand in block.candidates]
                )
                resolution = CandidateResolution(
                    position=block.position,
                    outcome=decision.outcome,
                    content=decision.content,
                    source=decision.source,
                )
                resolutions[block.position] = resolution
                if decision.outcome == "conflict":
                    candidate_conflicts.append(block.position)

        target_set = set(explicit_targets) if explicit_targets is not None else {
            block.position
            for block in stripe.blocks
            if block.status != BlockStatus.INTACT or block.candidates
        }

        # 2) 受信任内容。自动模式下所有候选采纳值都可信；显式模式下
        #    仅采纳显式目标位置上的候选，其余位置只认真正完好的内容。
        trusted: Dict[int, bytes] = {}
        adopted: Dict[int, CandidateResolution] = {}
        for block in stripe.blocks:
            pos = block.position
            resolution = resolutions.get(pos)
            candidate_trusted = resolution is not None and resolution.content is not None
            if explicit_targets is not None and pos not in target_set:
                candidate_trusted = False
            if candidate_trusted:
                trusted[pos] = self._padded(stripe, resolution.content)  # type: ignore[arg-type]
                adopted[pos] = resolution
            elif block.status == BlockStatus.INTACT and block.content is not None:
                trusted[pos] = self._padded(stripe, block.content)

        trigger = self._trigger_reason(stripe, candidate_conflicts, explicit_targets)
        targets = sorted(target_set)

        # 3) 候选冲突：无法裁决，拒绝重建。
        if candidate_conflicts:
            return Assessment(
                targets=targets,
                trusted=trusted,
                adopted=adopted,
                resolutions=resolutions,
                candidate_conflicts=candidate_conflicts,
                bad_sets=[],
                combos=[[pos] for pos in candidate_conflicts],
                reconstructable=False,
                reason=(
                    "candidate conflict without strict majority at positions "
                    f"{candidate_conflicts}; refusing to reconstruct"
                ),
                used_positions=[],
                trigger_reason=trigger,
            )

        # 4) 校验诊断：统一的最小一致损坏集诊断（不设“数据齐全即以
        #    数据为准”特判——数据块也可能静默损坏）。
        #    unique        —— 唯一经校验余力验证的坏集，修复它；
        #    ambiguous     —— 多个可验证解释，拒绝挑选；
        #    underdetermined —— 错误过多，只剩不可验证的平凡解释，拒绝。
        #    标记丢失/损坏的位置已被排除在 trusted 之外，不参与枚举。
        bad_sets: List[List[int]] = []
        ambiguous = False
        if len(trusted) >= k:
            try:
                diagnosis_result = diagnose(codec, trusted)
            except DiagnosisLimitReached as exc:
                return Assessment(
                    targets=targets,
                    trusted=trusted,
                    adopted=adopted,
                    resolutions=resolutions,
                    candidate_conflicts=[],
                    bad_sets=[],
                    combos=[],
                    reconstructable=False,
                    reason=f"diagnosis inconclusive: {exc}",
                    used_positions=[],
                    trigger_reason=trigger,
                )
            if diagnosis_result.status in ("ambiguous", "underdetermined"):
                combos = [list(combo) for combo in diagnosis_result.sets]
                if diagnosis_result.status == "underdetermined":
                    reason_text = (
                        "too many silent errors to locate uniquely; all minimal "
                        f"explanations are unverifiable: {combos}; mark the known-bad "
                        "positions missing/corrupt explicitly before repair"
                    )
                else:
                    reason_text = (
                        "multiple mutually contradictory explanations for the "
                        f"bad blocks: {combos}; cannot uniquely determine which "
                        "positions are correct"
                    )
                return Assessment(
                    targets=targets,
                    trusted=trusted,
                    adopted=adopted,
                    resolutions=resolutions,
                    candidate_conflicts=[],
                    bad_sets=combos,
                    combos=combos,
                    reconstructable=False,
                    reason=reason_text,
                    used_positions=[],
                    trigger_reason=trigger,
                    ambiguous=True,
                )
            if diagnosis_result.status == "unique":
                bad_sets = [list(diagnosis_result.sets[0])]

        # 5) 唯一坏块集：从受信任内容中移除并纳入目标。
        if len(bad_sets) == 1:
            for pos in bad_sets[0]:
                trusted.pop(pos, None)
            target_set.update(bad_sets[0])
            targets = sorted(target_set)

        # 6) 依据充分性：需要重建的目标之外，受信任块至少 k 个。
        reconstruct_targets = {
            pos for pos in targets if pos not in adopted
        }
        available = sorted(pos for pos in trusted if pos not in reconstruct_targets)
        losses = stripe.total - len(set(trusted) | set(adopted))
        if len(available) < k:
            if losses > m:
                reason = (
                    f"{losses} positions unavailable but only {m} parity blocks "
                    "exist; loss exceeds repair capacity"
                )
            else:
                reason = (
                    f"only {len(available)} trusted blocks outside repair targets, "
                    f"need {k} to reconstruct uniquely"
                )
            return Assessment(
                targets=targets,
                trusted=trusted,
                adopted=adopted,
                resolutions=resolutions,
                candidate_conflicts=[],
                bad_sets=bad_sets,
                combos=[],
                reconstructable=False,
                reason=reason,
                used_positions=[],
                trigger_reason=trigger,
            )

        combos = [list(bad_sets[0])] if len(bad_sets) == 1 else []
        return Assessment(
            targets=targets,
            trusted=trusted,
            adopted=adopted,
            resolutions=resolutions,
            candidate_conflicts=[],
            bad_sets=bad_sets,
            combos=combos,
            reconstructable=True,
            reason=None,
            used_positions=available[:k],
            trigger_reason=trigger,
        )

    # --- 内部辅助 ----------------------------------------------------------

    def _check_position(self, stripe: Stripe, position: Any) -> None:
        """校验位置编号类型与范围，错误带条带与位置信息。"""
        if not isinstance(position, int) or isinstance(position, bool):
            raise InvalidPositionError(
                f"position must be an integer in [0, {stripe.total})",
                stripe.stripe_id,
                None,
            )
        if not 0 <= position < stripe.total:
            raise InvalidPositionError(
                f"position must be in [0, {stripe.total})",
                stripe.stripe_id,
                position,
            )

    def _store_content(self, stripe: Stripe, position: int, content: bytes) -> None:
        """写入逻辑内容并记录补零数（内容长度不超过块长）。"""
        if len(content) > stripe.block_length:
            raise InvalidContentError(
                f"content length {len(content)} exceeds stripe block length "
                f"{stripe.block_length}",
                stripe.stripe_id,
                position,
            )
        block = stripe.block(position)
        block.content = content
        block.pad_length = stripe.block_length - len(content)

    def _padded(self, stripe: Stripe, content: bytes) -> bytes:
        """把逻辑内容右侧补零到条带块长。"""
        if len(content) < stripe.block_length:
            return content + b"\x00" * (stripe.block_length - len(content))
        return content

    def _recompute_parity_from_data(self, stripe: Stripe) -> None:
        """以当前数据块（补零后）重算并写入全部校验块。"""
        codec = self._codecs[stripe.stripe_id]
        data_blocks = [
            self._padded(stripe, stripe.block(pos).content or b"")
            for pos in range(stripe.k)
        ]
        parity = codec.encode_parity(data_blocks)
        for j, content in enumerate(parity):
            block = stripe.block(stripe.k + j)
            block.content = content
            block.pad_length = 0

    def _status_detail(self, block: Block) -> str:
        """给验证报告中的位置生成一句话说明。"""
        status = block.status
        if status == BlockStatus.INTACT:
            if block.candidates:
                return (
                    f"ok; {len(block.candidates)} candidate(s) registered, "
                    "pending repair to adopt"
                )
            return "ok"
        if status == BlockStatus.MISSING:
            return "marked missing; no content held"
        if status == BlockStatus.CORRUPT:
            return "marked corrupt; content not trusted for repair"
        return "conflicting candidates without a strict majority"

    def _trigger_reason(
        self,
        stripe: Stripe,
        candidate_conflicts: List[int],
        explicit_targets: Optional[List[int]],
    ) -> str:
        """根据条带当前状态归类修复触发原因（确定的单一字符串）。"""
        if candidate_conflicts:
            return "conflict"
        kinds = {
            block.status
            for block in stripe.blocks
            if block.status != BlockStatus.INTACT
        }
        if BlockStatus.MISSING in kinds and (
            BlockStatus.CORRUPT in kinds or BlockStatus.CONFLICT in kinds
        ):
            return "mixed"
        if BlockStatus.MISSING in kinds:
            return "missing"
        if BlockStatus.CORRUPT in kinds:
            return "corrupt"
        if BlockStatus.CONFLICT in kinds:
            return "conflict"
        if any(block.candidates for block in stripe.blocks):
            return "candidate_update"
        if explicit_targets:
            return "manual"
        return "none"
