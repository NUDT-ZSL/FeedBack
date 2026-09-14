"""条带数据模型与异常体系。

本模块定义：

* :class:`BlockStatus` —— 位置状态四态枚举（完好 / 缺失 / 损坏 / 冲突）；
* :class:`Candidate` —— 同一位置的候选内容及其来源；
* :class:`Block` —— 单个位置上的块（内容、状态、候选列表）；
* :class:`Stripe` —— 条带（唯一标识、创建后不可更改的 k/m、块列表）；
* :class:`RepairRecord` —— 一次修复的完整确定性记录；
* :class:`VerificationReport` —— 只读完整性验证报告；
* 一组带条带标识与位置编号的异常类。

状态语义
========

``intact``   位置持有被系统信任的当前内容，未被标记为丢失或损坏。
``missing``  位置被明确标记为丢失（无当前内容）。
``corrupt``  位置被标记为损坏（其当前内容被视为不可信，修复时不使用；
             若内容尚在，仅保留用于诊断展示）。
``conflict`` 同一位置登记了多份**互相矛盾**的候选内容，且按
             :mod:`storage_repair.diagnosis` 的候选规则无法判定唯一可信值。

注意 ``conflict`` 只由候选矛盾产生；标记丢失/损坏不会产生冲突状态。
"""

from __future__ import annotations

import base64
import enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# --- 异常体系 ---------------------------------------------------------------


class StorageRepairError(Exception):
    """所有本系统异常的基类。"""


class StripeError(StorageRepairError):
    """与某条带相关的错误基类。

    :param stripe_id: 相关条带标识（无法确定时为 ``None``）。
    """

    def __init__(self, message: str, stripe_id: Optional[str] = None) -> None:
        self.stripe_id = stripe_id
        if stripe_id is not None:
            message = f"[stripe={stripe_id}] {message}"
        super().__init__(message)


class StripeNotFoundError(StripeError):
    """引用的条带不存在。"""


class DuplicateStripeError(StripeError):
    """条带标识重复（创建或导入时）。"""


class PositionError(StripeError):
    """与某条带内某位置相关的错误基类。

    :param stripe_id: 条带标识。
    :param position: 位置编号。
    """

    def __init__(
        self,
        message: str,
        stripe_id: Optional[str] = None,
        position: Optional[int] = None,
    ) -> None:
        self.position = position
        if position is not None:
            message = f"[position={position}] {message}"
        super().__init__(message, stripe_id)


class InvalidPositionError(PositionError):
    """位置编号越界或类型非法。"""


class InvalidConfigError(StorageRepairError):
    """条带配置非法（k/m 取值、空标识等）。"""


class InvalidContentError(PositionError):
    """块内容非法（非 bytes、长度不一致等）。"""


class NotReconstructableError(StripeError):
    """缺失块数超过校验块数，或诊断无法唯一确定修复方案。"""


class ConflictError(PositionError):
    """同一位置的候选内容互相矛盾且无法按规则裁决。"""


class SerializationError(StorageRepairError):
    """导出文件损坏、字段缺失或语义校验失败。"""


# --- 枚举与数据类 -----------------------------------------------------------


class BlockStatus(str, enum.Enum):
    """位置状态。字符串值即 JSON 中的稳定表示。"""

    INTACT = "intact"
    MISSING = "missing"
    CORRUPT = "corrupt"
    CONFLICT = "conflict"


@dataclass(frozen=True)
class Candidate:
    """同一位置上的一份候选内容。

    :ivar content: 候选字节内容。
    :ivar source: 来源标签（如副本名、修复尝试编号），同一位置内非空且唯一。
    """

    content: bytes
    source: str

    def fingerprint(self) -> str:
        """返回内容指纹（SHA-256 的十六进制摘要）。"""
        import hashlib

        return hashlib.sha256(self.content).hexdigest()


@dataclass
class Block:
    """条带中一个位置上的块。

    :ivar position: 位置编号（0..k+m-1）。
    :ivar content: 当前内容；被标记丢失或从未写入时为 ``None``。
    :ivar status: 当前状态。
    :ivar candidates: 已登记的候选内容（按登记顺序保存，判定不依赖顺序）。
    :ivar pad_length: 末块逻辑长度短于条带块长时的右侧补零字节数。
    """

    position: int
    content: Optional[bytes] = None
    status: BlockStatus = BlockStatus.INTACT
    candidates: List[Candidate] = field(default_factory=list)
    pad_length: int = 0

    def is_data(self, k: int) -> bool:
        """该位置是否为数据块位置（编号小于 k）。"""
        return self.position < k

    def to_dict(self) -> Dict[str, object]:
        """序列化为 JSON 兼容的字典。"""
        return {
            "position": self.position,
            "status": self.status.value,
            "content": (
                None if self.content is None else base64.b64encode(self.content).decode("ascii")
            ),
            "pad_length": self.pad_length,
            "candidates": [
                {
                    "source": cand.source,
                    "content": base64.b64encode(cand.content).decode("ascii"),
                    "fingerprint": cand.fingerprint(),
                }
                for cand in self.candidates
            ],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "Block":
        """从字典反序列化；结构或编码错误抛 :class:`SerializationError`。"""
        try:
            position = data["position"]
            status_raw = data["status"]
            content_raw = data["content"]
            pad_length = data.get("pad_length", 0)
            candidates_raw = data.get("candidates", [])
            if not isinstance(position, int) or isinstance(position, bool):
                raise SerializationError("block 'position' must be an integer")
            try:
                status = BlockStatus(status_raw)
            except ValueError:
                raise SerializationError(
                    f"block at position {position}: unknown status {status_raw!r}"
                ) from None
            content = _decode_b64(content_raw, "block content")
            if not isinstance(pad_length, int) or isinstance(pad_length, bool) or pad_length < 0:
                raise SerializationError("'pad_length' must be a non-negative integer")
            if not isinstance(candidates_raw, list):
                raise SerializationError("'candidates' must be a list")
            candidates: List[Candidate] = []
            for item in candidates_raw:
                if not isinstance(item, dict):
                    raise SerializationError("each candidate must be an object")
                source = item.get("source")
                if not isinstance(source, str) or not source:
                    raise SerializationError("candidate 'source' must be a non-empty string")
                cand_content = _decode_b64(item.get("content"), "candidate content")
                stored_fp = item.get("fingerprint")
                if stored_fp is not None:
                    import hashlib

                    actual = hashlib.sha256(cand_content).hexdigest()
                    if stored_fp != actual:
                        raise SerializationError(
                            f"candidate fingerprint mismatch for source {source!r}: "
                            f"stored={stored_fp} actual={actual}"
                        )
                candidates.append(Candidate(content=cand_content, source=source))
            return cls(
                position=position,
                content=content,
                status=status,
                candidates=candidates,
                pad_length=pad_length,
            )
        except KeyError as exc:
            raise SerializationError(f"missing block field: {exc.args[0]!r}") from exc


def _decode_b64(value: object, what: str) -> Optional[bytes]:
    """把可为 null 的 base64 字符串解码为 bytes。"""
    if value is None:
        return None
    if not isinstance(value, str):
        raise SerializationError(f"{what} must be a base64 string or null")
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except (ValueError, UnicodeEncodeError) as exc:
        raise SerializationError(f"{what} is not valid base64: {exc}") from exc


@dataclass
class Stripe:
    """一条带。

    :ivar stripe_id: 非空唯一标识。
    :ivar k: 数据块数量，创建后不可更改。
    :ivar m: 校验块数量，创建后不可更改。
    :ivar blocks: 长度恒为 ``k+m``，位置编号连续。
    """

    stripe_id: str
    k: int
    m: int
    blocks: List[Block]
    block_length: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.stripe_id, str) or not self.stripe_id:
            raise InvalidConfigError("stripe id must be a non-empty string")
        if not isinstance(self.k, int) or isinstance(self.k, bool) or self.k < 1:
            raise InvalidConfigError("k must be a positive integer")
        if not isinstance(self.m, int) or isinstance(self.m, bool) or self.m < 0:
            raise InvalidConfigError("m must be a non-negative integer")
        if self.k + self.m > 256:
            raise InvalidConfigError("k + m must not exceed 256")
        if len(self.blocks) != self.k + self.m:
            raise InvalidConfigError(
                f"stripe {self.stripe_id!r}: expected {self.k + self.m} blocks, "
                f"got {len(self.blocks)}"
            )
        for index, block in enumerate(self.blocks):
            if block.position != index:
                raise InvalidConfigError(
                    f"stripe {self.stripe_id!r}: block positions must be contiguous; "
                    f"index {index} holds position {block.position}"
                )
        if (
            not isinstance(self.block_length, int)
            or isinstance(self.block_length, bool)
            or self.block_length < 0
        ):
            raise InvalidConfigError("block_length must be a non-negative integer")

    @property
    def total(self) -> int:
        """总块数 k+m。"""
        return self.k + self.m

    def block(self, position: int) -> Block:
        """按编号取块；越界抛 :class:`InvalidPositionError`。"""
        if not isinstance(position, int) or isinstance(position, bool) or not 0 <= position < self.total:
            raise InvalidPositionError(
                f"position must be an integer in [0, {self.total})",
                self.stripe_id,
                position if isinstance(position, int) and not isinstance(position, bool) else None,
            )
        return self.blocks[position]

    def to_dict(self) -> Dict[str, object]:
        """序列化为 JSON 兼容的字典。"""
        return {
            "stripe_id": self.stripe_id,
            "k": self.k,
            "m": self.m,
            "block_length": self.block_length,
            "blocks": [block.to_dict() for block in self.blocks],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "Stripe":
        """从字典反序列化并做结构校验。"""
        try:
            stripe_id = data["stripe_id"]
            k = data["k"]
            m = data["m"]
            blocks_raw = data["blocks"]
        except KeyError as exc:
            raise SerializationError(f"missing stripe field: {exc.args[0]!r}") from exc
        if not isinstance(stripe_id, str) or not stripe_id:
            raise SerializationError("'stripe_id' must be a non-empty string")
        for name, value in (("k", k), ("m", m)):
            if not isinstance(value, int) or isinstance(value, bool):
                raise SerializationError(f"'{name}' must be an integer")
        if not isinstance(blocks_raw, list):
            raise SerializationError("'blocks' must be a list")
        blocks: List[Block] = []
        for raw in blocks_raw:
            if not isinstance(raw, dict):
                raise SerializationError("each block must be an object")
            blocks.append(Block.from_dict(raw))
        try:
            stripe = cls(stripe_id=stripe_id, k=k, m=m, blocks=blocks)
        except InvalidConfigError as exc:
            raise SerializationError(str(exc)) from exc
        block_length = data.get("block_length", 0)
        if not isinstance(block_length, int) or isinstance(block_length, bool) or block_length < 0:
            raise SerializationError("'block_length' must be a non-negative integer")
        stripe.block_length = block_length
        # 块内位置编号连续性已由 Stripe.__post_init__ 保证；再校验 k/m 范围。
        if k < 1 or m < 0 or k + m > 256:
            raise SerializationError(f"invalid k/m: k={k}, m={m}")
        return stripe


@dataclass(frozen=True)
class RepairRecord:
    """一次修复尝试的完整、确定性的记录。

    失败的修复同样产生记录（``success=False``），并在 ``reason`` 中
    说明原因。

    :ivar sequence: 该条带内单调递增的修复序号（从 1 开始）。
    :ivar trigger_reason: 触发原因（missing/corrupt/conflict/mixed/none）。
    :ivar target_positions: 本次需要修复的目标位置（升序）。
    :ivar used_positions: 实际作为重建依据的位置（升序）。
    :ivar candidate_sources: 最终采用候选的来源，键为位置，值为来源标签。
    :ivar adopted_fingerprints: 最终采用内容的 SHA-256 指纹，键为位置。
    :ivar inconsistent_positions: 诊断出的互相矛盾位置组合列表。
    :ivar success: 本次修复是否成功。
    :ivar reason: 失败原因（成功时为 ``None``）。
    """

    sequence: int
    trigger_reason: str
    target_positions: List[int]
    used_positions: List[int]
    candidate_sources: Dict[int, str]
    adopted_fingerprints: Dict[int, str]
    inconsistent_positions: List[List[int]]
    success: bool
    reason: Optional[str] = None

    def to_dict(self) -> Dict[str, object]:
        """序列化为 JSON 兼容的字典（字典键按位置升序）。"""
        return {
            "sequence": self.sequence,
            "trigger_reason": self.trigger_reason,
            "target_positions": list(self.target_positions),
            "used_positions": list(self.used_positions),
            "candidate_sources": {
                str(pos): self.candidate_sources[pos] for pos in sorted(self.candidate_sources)
            },
            "adopted_fingerprints": {
                str(pos): self.adopted_fingerprints[pos]
                for pos in sorted(self.adopted_fingerprints)
            },
            "inconsistent_positions": [list(combo) for combo in self.inconsistent_positions],
            "success": self.success,
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "RepairRecord":
        """从字典反序列化。"""
        try:
            return cls(
                sequence=data["sequence"],
                trigger_reason=data["trigger_reason"],
                target_positions=list(data["target_positions"]),
                used_positions=list(data["used_positions"]),
                candidate_sources={
                    int(key): value for key, value in data["candidate_sources"].items()
                },
                adopted_fingerprints={
                    int(key): value for key, value in data["adopted_fingerprints"].items()
                },
                inconsistent_positions=[
                    list(combo) for combo in data["inconsistent_positions"]
                ],
                success=data["success"],
                reason=data.get("reason"),
            )
        except KeyError as exc:
            raise SerializationError(
                f"missing repair-record field: {exc.args[0]!r}"
            ) from exc


@dataclass(frozen=True)
class VerificationReport:
    """只读完整性验证报告。

    :ivar stripe_id: 条带标识。
    :ivar positions: 每个位置的状态（键为位置编号，按升序输出）。
    :ivar reconstructable: 该条带当前能否被完整重建。
    :ivar inconsistent_positions: 发现的不一致位置组合（升序去重）。
    :ivar detail: 每个位置的人读说明（键为位置编号）。
    """

    stripe_id: str
    positions: Dict[int, BlockStatus]
    reconstructable: bool
    inconsistent_positions: List[List[int]]
    detail: Dict[int, str]

    def to_dict(self) -> Dict[str, object]:
        """序列化为 JSON 兼容的字典。"""
        return {
            "stripe_id": self.stripe_id,
            "reconstructable": self.reconstructable,
            "positions": {
                str(pos): self.positions[pos].value for pos in sorted(self.positions)
            },
            "inconsistent_positions": [list(combo) for combo in self.inconsistent_positions],
            "detail": {str(pos): self.detail[pos] for pos in sorted(self.detail)},
        }

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "VerificationReport":
        """从字典反序列化；非法状态或缺字段抛 :class:`SerializationError`。"""
        try:
            stripe_id = data["stripe_id"]
            reconstructable = data["reconstructable"]
            positions_raw = data["positions"]
            combos_raw = data["inconsistent_positions"]
            detail_raw = data["detail"]
        except KeyError as exc:
            raise SerializationError(
                f"missing verification-report field: {exc.args[0]!r}"
            ) from exc
        if not isinstance(stripe_id, str):
            raise SerializationError("verification report 'stripe_id' must be a string")
        if not isinstance(reconstructable, bool):
            raise SerializationError("verification report 'reconstructable' must be boolean")
        if not isinstance(positions_raw, dict) or not isinstance(detail_raw, dict):
            raise SerializationError("report 'positions' and 'detail' must be objects")
        if not isinstance(combos_raw, list):
            raise SerializationError("report 'inconsistent_positions' must be a list")
        try:
            positions = {}
            for key, value in positions_raw.items():
                if not (isinstance(key, str) and key.isdigit()):
                    raise SerializationError(
                        f"report position key {key!r} must be a non-negative integer string"
                    )
                positions[int(key)] = BlockStatus(value)
            combos = []
            for combo in combos_raw:
                if not isinstance(combo, list) or not all(
                    isinstance(pos, int) and not isinstance(pos, bool) for pos in combo
                ):
                    raise SerializationError(
                        "each inconsistent combo must be a list of integer positions"
                    )
                combos.append(list(combo))
            detail = {}
            for key, value in detail_raw.items():
                if not (isinstance(key, str) and key.isdigit()):
                    raise SerializationError(
                        f"report detail key {key!r} must be a non-negative integer string"
                    )
                detail[int(key)] = str(value)
        except (TypeError, ValueError) as exc:
            raise SerializationError(f"malformed verification report: {exc}") from exc
        return cls(
            stripe_id=stripe_id,
            positions=positions,
            reconstructable=reconstructable,
            inconsistent_positions=combos,
            detail=detail,
        )
