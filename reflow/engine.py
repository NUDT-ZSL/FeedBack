"""离线重排引擎（零依赖，仅标准库）。

核心模型
========
- :class:`Block`      内容块：正文 / 标题 / 图片 / 注释
- :class:`Manuscript` 稿件：块的容器，构造时完成全部结构校验
- :class:`ReflowEngine` 给定字号 / 视窗做确定性重排、增量更新、位置恢复与查询

确定性几何模型（全部整数/定点，无随机、无时钟）
------------------------------------------------
栏数::

    n = clamp(floor(viewport_width / (font_size * 16)), 1, 6)

即字号越大、视窗越窄，栏数越少且严格单调。栏内宽::

    col_w = floor((viewport_width - (n - 1) * gutter) / n)

块高度（px，字号相关，因此字号变化必然使其失效）：
- 文本类（正文/标题/注释）按每行可容纳字数折行，line-height 分别为 1.5/1.3/1.35；
- 图片保持长宽比缩放到栏宽；缩放比例或栏宽低于可读阈值时降级为占位说明。

栏数还受块最小可读宽度约束：若某栏数下栏宽小于任一块的 min_readable_width，
栏数继续下调（最少 1 栏）——这与“字号越大 / 视窗越窄栏数越少”同向。

锚点语义
--------
锚点表示“阅读序列中必须紧跟目标块”。构造阅读序列时，把锚点链整体取出，
链头（无锚点的块）按原始顺序排序：未被锚点调整的块严格保持原始相对顺序，
锚点块按作者的显式指示紧随目标。分栏时锚点链作为不可拆分的整体打包，
因此锚点约束在结构上不可能被打破。
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .errors import AnchorError, LayoutError, PersistenceError, ValidationError

BLOCK_TYPES = ("text", "title", "image", "note")
TYPE_LABELS = {"text": "正文", "title": "标题", "image": "图片", "note": "注释"}

MIN_FONT_SIZE = 10
MAX_FONT_SIZE = 48
MIN_VIEWPORT = 160
MAX_COLUMNS = 6
DEFAULT_GUTTER = 16
COLUMN_WIDTH_FACTOR = 16  # 每栏期望宽度 ≈ 字号的 16 倍
IMAGE_LEGIBLE_RATIO = 0.5  # 缩放比例低于 50% 即判定不可读 -> 占位降级
SAVE_FORMAT = "reflow-doc/v1"

LINE_HEIGHT = {"text": 1.5, "title": 1.3, "note": 1.35, "image": 1.0}


# --------------------------------------------------------------------------- #
# 领域模型
# --------------------------------------------------------------------------- #
@dataclass
class Block:
    """一个内容块。

    文本块用 ``content``（或 ``text_length``）给出篇幅；图片块用
    ``image_width`` / ``image_height`` 给出原始像素尺寸，``content`` 作为
    图片说明 / 替代文本（降级占位时展示，保证不静默丢弃内容）。
    """

    id: str
    type: str
    order: int
    min_readable_width: int
    anchor: Optional[str] = None
    content: Optional[str] = None
    text_length: Optional[int] = None
    image_width: Optional[int] = None
    image_height: Optional[int] = None

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not self.id:
            raise ValidationError("块标识必须为非空字符串", position=0)
        if self.type not in BLOCK_TYPES:
            raise ValidationError(
                f"块 {self.id} 的类型非法：{self.type!r}，允许值为 {BLOCK_TYPES}",
                position=self.order,
                block_id=self.id,
                invalid_type=self.type,
            )
        if not isinstance(self.order, int) or self.order < 0:
            raise ValidationError(f"块 {self.id} 的原始顺序必须为非负整数", position=0, block_id=self.id)
        if not isinstance(self.min_readable_width, int) or self.min_readable_width <= 0:
            raise ValidationError(
                f"块 {self.id} 的最小可读宽度必须为正整数", position=self.order, block_id=self.id
            )
        if self.type == "image":
            if not (
                isinstance(self.image_width, int)
                and isinstance(self.image_height, int)
                and self.image_width > 0
                and self.image_height > 0
            ):
                raise ValidationError(
                    f"图片块 {self.id} 必须提供正整数 image_width / image_height",
                    position=self.order,
                    block_id=self.id,
                )
        else:
            if self.text_length is None:
                self.text_length = len(self.content) if self.content is not None else 0
            if self.text_length < 0:
                raise ValidationError(
                    f"块 {self.id} 的 text_length 不能为负", position=self.order, block_id=self.id
                )

    def to_dict(self) -> dict:
        d = {
            "id": self.id,
            "type": self.type,
            "order": self.order,
            "min_readable_width": self.min_readable_width,
        }
        if self.anchor is not None:
            d["anchor"] = self.anchor
        if self.content is not None:
            d["content"] = self.content
        if self.type == "image":
            d["image_width"] = self.image_width
            d["image_height"] = self.image_height
        if self.text_length is not None and self.type != "image":
            d["text_length"] = self.text_length
        return d

    @classmethod
    def from_dict(cls, d: dict, position: int) -> "Block":
        if not isinstance(d, dict):
            raise PersistenceError(f"第 {position} 个块不是对象", position=position)
        required = ("id", "type", "order", "min_readable_width")
        missing = [k for k in required if k not in d]
        if missing:
            raise PersistenceError(
                f"第 {position} 个块（id={d.get('id', '?')}）缺少字段：{missing}",
                position=position,
                block_id=d.get("id"),
                missing=missing,
            )
        try:
            return cls(
                id=d["id"],
                type=d["type"],
                order=d["order"],
                min_readable_width=d["min_readable_width"],
                anchor=d.get("anchor"),
                content=d.get("content"),
                text_length=d.get("text_length"),
                image_width=d.get("image_width"),
                image_height=d.get("image_height"),
            )
        except ValidationError as e:
            # 载入语境下统一翻译为 PersistenceError：失败后状态不变由调用方保证
            raise PersistenceError(str(e), position=position, block_id=d.get("id")) from e


class Manuscript:
    """带唯一标识的稿件，由若干内容块组成。"""

    def __init__(self, manuscript_id: str, blocks: List[Block], title: Optional[str] = None):
        if not isinstance(manuscript_id, str) or not manuscript_id:
            raise ValidationError("稿件标识必须为非空字符串", position=0)
        self.id = manuscript_id
        self.title = title
        self.blocks: List[Block] = list(blocks)
        self._validate()

    # -- 校验 ------------------------------------------------------------- #
    def _validate(self) -> None:
        seen_ids: Dict[str, int] = {}
        seen_orders: Dict[int, str] = {}
        for index, b in enumerate(self.blocks):
            if not isinstance(b, Block):
                raise ValidationError(f"第 {index} 个内容项不是 Block", position=index)
            if b.id in seen_ids:
                raise ValidationError(
                    f"块标识重复：{b.id!r} 同时出现在第 {seen_ids[b.id]} 个位置和第 {index} 个位置",
                    position=index,
                    block_id=b.id,
                    first_position=seen_ids[b.id],
                )
            seen_ids[b.id] = index
            if b.order in seen_orders:
                raise ValidationError(
                    f"原始顺序重复：order={b.order} 被块 {seen_orders[b.order]!r} 和 {b.id!r} 同时占用"
                    f"（后者在第 {index} 个位置）",
                    position=index,
                    block_id=b.id,
                    order=b.order,
                )
            seen_orders[b.order] = b.id

        by_id = {b.id: b for b in self.blocks}
        # 锚点目标存在性 + 必须排序在前
        for index, b in enumerate(self.blocks):
            if b.anchor is None:
                continue
            if b.anchor not in by_id:
                raise AnchorError(
                    f"块 {b.id} 的锚点指向不存在的块 {b.anchor!r}",
                    sequence=[b.anchor, b.id],
                    position=index,
                    block_id=b.id,
                )
            target = by_id[b.anchor]
            if target.order >= b.order:
                raise AnchorError(
                    f"块 {b.id} 的锚点目标 {target.id} 必须排序在前，"
                    f"但 order({target.id})={target.order} >= order({b.id})={b.order}",
                    sequence=[target.id, b.id],
                    position=index,
                    block_id=b.id,
                )
            if target.id == b.id:  # 自环（被上一条覆盖，留作显式说明）
                raise AnchorError(f"块 {b.id} 不允许锚定自身", cycle=[b.id], sequence=[b.id, b.id])

        # 同一目标只能有一个“紧跟者”，否则紧邻约束互相冲突
        incoming: Dict[str, List[str]] = {}
        for b in self.blocks:
            if b.anchor is not None:
                incoming.setdefault(b.anchor, []).append(b.id)
        for target, followers in incoming.items():
            if len(followers) > 1:
                raise AnchorError(
                    f"锚点冲突：块 {target} 后只能紧跟一个块，但 {followers} 都声明紧跟其后",
                    sequence=[target] + followers,
                    block_id=target,
                )

        # 成环检测（在“排序在前”约束下理论上不可达，仍做通用 DFS 防御）
        self._detect_cycle(by_id)

    def _detect_cycle(self, by_id: Dict[str, "Block"]) -> None:
        color: Dict[str, int] = {bid: 0 for bid in by_id}  # 0 白 1 灰 2 黑
        stack: List[str] = []

        def visit(bid: str) -> None:
            color[bid] = 1
            stack.append(bid)
            cur = by_id[bid]
            if cur.anchor is not None and cur.anchor in by_id:
                a = cur.anchor
                if color[a] == 1:
                    start = stack.index(a)
                    cycle = stack[start:]
                    raise AnchorError(
                        "锚点成环：" + " -> ".join(cycle + [a]),
                        cycle=cycle,
                        sequence=cycle + [a],
                    )
                if color[a] == 0:
                    visit(a)
            stack.pop()
            color[bid] = 2

        for bid in by_id:
            if color[bid] == 0:
                visit(bid)

    # -- 阅读序列（锚点链整体前置） --------------------------------------- #
    def reading_sequence(self) -> List["Block"]:
        """返回锚点约束下的线性阅读序列。"""
        by_id = {b.id: b for b in self.blocks}
        followers: Dict[str, str] = {}
        for b in self.blocks:
            if b.anchor is not None:
                followers[b.anchor] = b.id
        ordered = sorted(self.blocks, key=lambda b: b.order)
        result: List[Block] = []
        emitted = set()
        for head in ordered:
            if head.anchor is not None or head.id in emitted:
                continue
            cur: Optional[Block] = head
            while cur is not None:
                if cur.id in emitted:  # 防御性：链不应交汇
                    raise AnchorError(
                        "锚点链交汇成环/分叉", sequence=[c.id for c in result] + [cur.id]
                    )
                emitted.add(cur.id)
                result.append(cur)
                nxt = followers.get(cur.id)
                cur = by_id[nxt] if nxt else None
        return result

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "blocks": [b.to_dict() for b in sorted(self.blocks, key=lambda x: x.order)],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Manuscript":
        if not isinstance(d, dict):
            raise PersistenceError("稿件节点不是对象")
        for key in ("id", "blocks"):
            if key not in d:
                raise PersistenceError(f"稿件缺少字段：{key!r}", missing=[key])
        if not isinstance(d["blocks"], list):
            raise PersistenceError("稿件 blocks 必须为数组")
        blocks = [Block.from_dict(bd, i) for i, bd in enumerate(d["blocks"])]
        try:
            return cls(d["id"], blocks, title=d.get("title"))
        except (ValidationError, AnchorError) as e:
            raise PersistenceError(f"稿件校验失败：{e}", **(e.details or {})) from e


# --------------------------------------------------------------------------- #
# 几何计算（纯函数，便于缓存与单测）
# --------------------------------------------------------------------------- #
def column_count(
    font_size: int,
    viewport_width: int,
    min_required_width: int = 1,
    gutter: int = DEFAULT_GUTTER,
) -> int:
    """确定性栏数：字号越大 / 视窗越窄 / 块要求越宽 -> 栏数越少。"""
    if not isinstance(font_size, int) or not (MIN_FONT_SIZE <= font_size <= MAX_FONT_SIZE):
        raise LayoutError(f"字号必须为 {MIN_FONT_SIZE}..{MAX_FONT_SIZE} 之间的整数，收到 {font_size!r}")
    if not isinstance(viewport_width, int) or viewport_width < MIN_VIEWPORT:
        raise LayoutError(f"视窗宽度必须为 ≥{MIN_VIEWPORT} 的整数，收到 {viewport_width!r}")
    n = max(1, min(MAX_COLUMNS, viewport_width // (font_size * COLUMN_WIDTH_FACTOR)))
    # 下调栏数，直到栏宽能容纳最宽块的最小可读宽度
    while n > 1 and column_width(viewport_width, n, gutter) < min_required_width:
        n -= 1
    return n


def column_width(viewport_width: int, n: int, gutter: int) -> int:
    return max(1, (viewport_width - (n - 1) * gutter) // n)


@dataclass
class Geometry:
    """一块在给定字号 / 栏宽下的确定性几何与降级信息。"""

    height: int            # px，占位高度
    span: int              # 横向占用栏数
    degraded: bool
    scaled: bool
    degrade_reason: Optional[str]
    scale_ratio: float
    rendered_width: int
    original_width: int

    def signature(self) -> tuple:
        return (
            self.height,
            self.span,
            self.degraded,
            self.scaled,
            self.degrade_reason,
            round(self.scale_ratio, 6),
            self.rendered_width,
        )


def measure(block: Block, font_size: int, col_w: int) -> Geometry:
    """计算单块几何。规则对相同输入永远产生相同输出。"""
    import math

    if block.type in ("text", "title", "note"):
        assert block.text_length is not None
        lh = LINE_HEIGHT[block.type]
        chars_per_line = max(1.0, col_w / font_size)  # 字身宽近似 1.0 em
        lines = max(1, math.ceil(block.text_length / chars_per_line))
        height = int(round(lines * font_size * lh))
        return Geometry(height, 1, False, False, None, 1.0, col_w, col_w)

    # 图片：宽度确定性缩放到栏宽（不跨栏，保证阅读顺序与栏顺序一致）
    iw, ih = block.image_width, block.image_height
    ratio = col_w / iw
    if ratio >= 1.0:
        # 栏比图宽：原样摆放，顶部对齐栏宽
        return Geometry(ih, 1, False, False, None, 1.0, iw, iw)
    if ratio >= IMAGE_LEGIBLE_RATIO and col_w >= block.min_readable_width:
        # 等比缩小但仍可读
        height = int(round(ih * ratio))
        return Geometry(height, 1, False, True, "scaled_to_fit", round(ratio, 6), col_w, iw)

    # 缩到阈值以下或栏宽小于最小可读宽度 -> 降级为占位说明，绝不静默丢弃
    reason = (
        "below_legible_scale"
        if ratio < IMAGE_LEGIBLE_RATIO
        else "below_min_readable_width"
    )
    alt_len = len(block.content or "") or 1
    lines = max(2, math.ceil(alt_len / max(1.0, col_w / font_size)) + 1)
    height = int(round(lines * font_size * LINE_HEIGHT["text"]))
    return Geometry(height, 1, True, False, reason, round(ratio, 6), col_w, iw)


# --------------------------------------------------------------------------- #
# 重排结果
# --------------------------------------------------------------------------- #
@dataclass
class PlacedBlock:
    block: Block
    column: int       # 1 基、按阅读方向连续编号（跨水平带累加）
    offset: int       # 栏内纵向偏移 px
    band: int
    geometry: Geometry


@dataclass
class AnchorViolation:
    """锚点约束在实际版面几何中被打破的证据。"""

    block_id: str            # 声明锚点的块
    anchor_target: str       # 它应紧跟的目标块
    predecessor_id: Optional[str]  # 版面中它在同栏的真实前驱
    target_present: bool
    same_column: bool
    adjacent: bool
    predecessor_is_target: bool
    involved: List[str]      # 涉及的块序列（去重、稳定排序）
    reason: str              # 中文说明，明确点名涉及块

    def to_dict(self) -> dict:
        return {
            "block_id": self.block_id,
            "anchor_target": self.anchor_target,
            "predecessor_id": self.predecessor_id,
            "target_present": self.target_present,
            "same_column": self.same_column,
            "adjacent": self.adjacent,
            "predecessor_is_target": self.predecessor_is_target,
            "involved": list(self.involved),
            "reason": self.reason,
        }


def verify_anchor_layout(placements: List[PlacedBlock]) -> Dict[str, AnchorViolation]:
    """按真实几何关系校验全部锚点（纯函数，可对任意 placements 使用）。

    对每个声明锚点的块 B（锚点目标 T），必须同时满足：
      1. T 存在于版面；
      2. T 与 B 同栏；
      3. B 在同栏的紧邻前驱恰为 T（中间无其他块插入）；
      4. 偏移紧邻：T.offset + T.height == B.offset。
    任一不满足即记录一条 :class:`AnchorViolation`，返回 {块id: 违约}。
    """
    ordered = sorted(placements, key=lambda p: (p.column, p.offset, p.block.order))
    by_id = {p.block.id: p for p in ordered}
    violations: Dict[str, AnchorViolation] = {}
    last_by_col: Dict[int, PlacedBlock] = {}

    for p in ordered:
        predecessor = last_by_col.get(p.column)
        last_by_col[p.column] = p
        anc = p.block.anchor
        if anc is None:
            continue

        target = by_id.get(anc)
        if target is None:
            violations[p.block.id] = AnchorViolation(
                block_id=p.block.id,
                anchor_target=anc,
                predecessor_id=predecessor.block.id if predecessor else None,
                target_present=False,
                same_column=False,
                adjacent=False,
                predecessor_is_target=False,
                involved=[anc, p.block.id],
                reason=(
                    f"锚点被打破：块 {p.block.id} 声明紧跟 {anc}，"
                    f"但目标块 {anc} 不在当前版面中（涉及块：{anc} -> {p.block.id}）"
                ),
            )
            continue

        same_column = target.column == p.column
        adjacent = target.offset + target.geometry.height == p.offset
        predecessor_is_target = predecessor is not None and predecessor.block.id == anc

        if same_column and adjacent and predecessor_is_target:
            continue  # 约束成立

        problems = []
        if not same_column:
            problems.append(
                f"二者位于不同栏（{anc} 在栏 {target.column}，{p.block.id} 在栏 {p.column}）"
            )
        if same_column and not adjacent:
            problems.append(
                f"偏移不紧邻（{anc} 结束于偏移 {target.offset + target.geometry.height}，"
                f"{p.block.id} 起始于偏移 {p.offset}）"
            )
        if not predecessor_is_target:
            if predecessor is None:
                problems.append(f"{p.block.id} 位于栏首，同栏没有前驱块")
            elif predecessor.block.id != anc:
                problems.append(
                    f"{p.block.id} 的同栏前驱是 {predecessor.block.id} 而非锚点目标 {anc}"
                )

        involved: List[str] = [anc]
        if predecessor is not None and predecessor.block.id != anc:
            involved.append(predecessor.block.id)
        involved.append(p.block.id)

        violations[p.block.id] = AnchorViolation(
            block_id=p.block.id,
            anchor_target=anc,
            predecessor_id=predecessor.block.id if predecessor else None,
            target_present=True,
            same_column=same_column,
            adjacent=adjacent,
            predecessor_is_target=predecessor_is_target,
            involved=involved,
            reason="锚点被打破：" + "；".join(problems)
            + f"（涉及块序列：{' -> '.join(involved)}）",
        )

    return violations


@dataclass
class BlockView:
    """需求 7 的单块查询视图（稳定、可重复）。"""

    block_id: str
    type: str
    order: int
    column: int
    offset: int
    height: int
    rendered_width: int
    degraded: bool
    degrade_reason: Optional[str]
    anchor: Optional[str]
    anchor_satisfied: bool
    anchor_violation: Optional[str] = None   # 不满足时的中文原因
    anchor_involved: Optional[List[str]] = None  # 不满足时涉及的块序列

    def to_dict(self) -> dict:
        return {
            "block_id": self.block_id,
            "type": self.type,
            "order": self.order,
            "column": self.column,
            "offset": self.offset,
            "height": self.height,
            "rendered_width": self.rendered_width,
            "degraded": self.degraded,
            "degrade_reason": self.degrade_reason,
            "anchor": self.anchor,
            "anchor_satisfied": self.anchor_satisfied,
            "anchor_violation": self.anchor_violation,
            "anchor_involved": list(self.anchor_involved) if self.anchor_involved else None,
        }


@dataclass
class ReflowResult:
    version: int
    font_size: int
    viewport_width: int
    column_count: int
    placements: List[PlacedBlock]
    affected_blocks: List[str]          # 相对上一版 (栏号,偏移) 实际变化的块
    relaid_out_blocks: List[str]        # 本次真正重新打包的块（首个变化组起的后缀）
    geometry_recomputed: List[str]      # 几何缓存未命中、重新测量的块
    unaffected_blocks: List[str]        # 位置保持不变的块（需求 4 可追溯）
    anchor_violations: Dict[str, "AnchorViolation"] = field(default_factory=dict)

    def placement_of(self, block_id: str) -> Optional[PlacedBlock]:
        for p in self.placements:
            if p.block.id == block_id:
                return p
        return None


# --------------------------------------------------------------------------- #
# 引擎
# --------------------------------------------------------------------------- #
class ReflowEngine:
    def __init__(self, manuscript: Manuscript, gutter: int = DEFAULT_GUTTER):
        self.manuscript = manuscript
        self.gutter = gutter
        self.font_size: Optional[int] = None
        self.viewport_width: Optional[int] = None
        self.version = 0
        self._result: Optional[ReflowResult] = None
        self.reading_block_id: Optional[str] = None
        self.reading_intra_offset: int = 0
        # 几何缓存：(块标识, 字号, 栏宽) -> Geometry
        self._geo_cache: Dict[Tuple[str, int, int], Geometry] = {}
        # 上一版增量续排所需状态（稿件不可变，组结构恒定）
        self._groups: Optional[List[List[Block]]] = None
        self._prev_n: Optional[int] = None
        self._prev_page_height: Optional[int] = None
        # 每组打包结束后的游标 (band, col, used) 与该组产生的 placements
        self._prev_states: List[Tuple[int, int, int]] = []
        self._prev_placements: List[List[PlacedBlock]] = []
        self._group_sigs: List[tuple] = []

    # -- 配置与重排 ------------------------------------------------------- #
    def configure(
        self,
        font_size: int,
        viewport_width: int,
        reading_block_id: Optional[str] = None,
        reading_intra_offset: int = 0,
    ) -> ReflowResult:
        """改变字号 / 视窗并重排（真增量）。

        1. 几何缓存：只有 (块, 字号, 栏宽) 未见过的块才重新测量；
        2. 前缀稳定：栏数 / 页高不变时，找到第一个几何签名变化的锚点组，
           其之前的组**逐对象复用**上一版 placement（坐标不可能改变），
           只从该组所在游标续排其后所有组；
        3. 结果等价性：增量结果与 :meth:`reflow_cold` 冷重排逐字段一致；
        4. 返回值显式列出受影响 / 未受影响 / 重新测量的块，全程可追溯。
        """
        sequence = self.manuscript.reading_sequence()
        if self._groups is None:
            self._groups = self._anchor_groups(sequence)
        groups = self._groups
        n = column_count(
            font_size,
            viewport_width,
            min_required_width=max((b.min_readable_width for b in sequence), default=1),
            gutter=self.gutter,
        )
        col_w = column_width(viewport_width, n, self.gutter)
        page_height = int(viewport_width * 4 / 3)

        # ---- 测量（带缓存，记录哪些块真正重新测量）与组几何签名 ---- #
        recomputed: List[str] = []
        geometries: Dict[str, Geometry] = {}
        group_sigs: List[tuple] = []
        for grp in groups:
            sig = []
            for b in grp:
                key = (b.id, font_size, col_w)
                g = self._geo_cache.get(key)
                if g is None:
                    g = measure(b, font_size, col_w)
                    self._geo_cache[key] = g
                    recomputed.append(b.id)
                geometries[b.id] = g
                sig.append((b.id, g.signature()))
            group_sigs.append(tuple(sig))

        # ---- 决定可复用前缀（self._group_sigs 此刻持有“上一版”签名） ---- #
        start = 0
        if (
            self._result is not None
            and self._prev_n == n
            and self._prev_page_height == page_height
            and len(self._prev_states) == len(groups)
        ):
            while start < len(groups) and group_sigs[start] == self._group_sigs[start]:
                start += 1

        if start == 0 or self._result is None:
            placements_groups: List[List[PlacedBlock]] = []
            states: List[Tuple[int, int, int]] = []
            tail = self._pack_groups(groups, geometries, n, page_height, 0, 0, 0)
            for i, item in enumerate(tail):
                placements_groups.append(item[0])
                states.append(item[1])
        else:
            placements_groups = [list(pg) for pg in self._prev_placements[:start]]
            states = list(self._prev_states[:start])
            band0, col0, used0 = self._prev_states[start - 1]
            tail = self._pack_groups(
                groups[start:], geometries, n, page_height, band0, col0, used0
            )
            for plist, state in tail:
                placements_groups.append(plist)
                states.append(state)

        placements = [p for pg in placements_groups for p in pg]
        placements.sort(key=lambda p: (p.band, p.column, p.offset, p.block.order))

        # relaid_out：本次实际重新打包的后缀（前缀组逐对象复用，未参与重排）
        relaid = [b.id for grp in groups[start:] for b in grp]
        # affected：相对上一版 (栏号, 偏移) 实际变化；unaffected：坐标完全一致。
        # 语义不混用：relaid 描述“被重新打包”（触碰范围），affected 描述
        # “坐标真的变了”（调用方需要重绘的最小集合）。未移动前缀两者皆否；
        # 后缀块可能 relaid 但不 affected（块高微变但自身起点未动）。
        prev_coords = (
            {p.block.id: (p.column, p.offset) for p in self._result.placements}
            if self._result is not None
            else {}
        )
        affected, unaffected = [], []
        for p in placements:
            if prev_coords.get(p.block.id) != (p.column, p.offset):
                affected.append(p.block.id)
            else:
                unaffected.append(p.block.id)
        relaid_set, affected_set = set(relaid), set(affected)
        # 不变量：坐标变化只可能发生在重新打包后缀内（前缀逐对象复用）
        if not affected_set <= relaid_set:
            raise RuntimeError(  # 防御性：理论不可达
                f"内部不变量被破坏：受影响块 {sorted(affected_set - relaid_set)} "
                f"不在重新打包后缀 {sorted(relaid_set)} 内"
            )

        # 锚点几何校验：按真实同栏 / 偏移紧邻 / 前驱恰为目标判定
        anchor_violations = verify_anchor_layout(placements)

        self.font_size = font_size
        self.viewport_width = viewport_width
        self.version += 1
        if reading_block_id is not None:
            self.reading_block_id = reading_block_id
            self.reading_intra_offset = max(0, int(reading_intra_offset))

        # 提交续排状态
        self._prev_n = n
        self._prev_page_height = page_height
        self._prev_states = states
        self._prev_placements = placements_groups
        self._group_sigs = group_sigs

        self._result = ReflowResult(
            version=self.version,
            font_size=font_size,
            viewport_width=viewport_width,
            column_count=n,
            placements=placements,
            affected_blocks=affected,
            relaid_out_blocks=relaid,
            geometry_recomputed=recomputed,
            unaffected_blocks=unaffected,
            anchor_violations=anchor_violations,
        )
        return self._result

    def reflow_cold(self) -> ReflowResult:
        """丢弃全部缓存与续排状态后冷重排（验收用：证明增量 == 冷重排）。"""
        self._geo_cache.clear()
        self._prev_n = None
        self._prev_page_height = None
        self._prev_states = []
        self._prev_placements = []
        self._group_sigs = []
        assert self.font_size is not None and self.viewport_width is not None
        return self.configure(self.font_size, self.viewport_width)

    # -- 锚点链分组 ------------------------------------------------------- #
    @staticmethod
    def _anchor_groups(sequence: List[Block]) -> List[List[Block]]:
        groups: List[List[Block]] = []
        index = {b.id: i for i, b in enumerate(sequence)}
        seen = set()
        # 链头：在阅读序列中其前一元素不是它的锚点目标
        for i, b in enumerate(sequence):
            if b.anchor is not None and i > 0 and sequence[i - 1].id == b.anchor:
                continue
            group: List[Block] = []
            cur: Optional[Block] = b
            while cur is not None and cur.id not in seen:
                # 仅收编在序列中确实紧随其后的锚点后继
                j = index[cur.id]
                group.append(cur)
                seen.add(cur.id)
                if j + 1 < len(sequence) and sequence[j + 1].anchor == cur.id:
                    cur = sequence[j + 1]
                else:
                    cur = None
            groups.append(group)
        return groups

    # -- 顺序流式分栏（支持从任意游标续排，供增量复用） ------------------- #
    @staticmethod
    def _pack_groups(
        groups: List[List[Block]],
        geometries: Dict[str, Geometry],
        n: int,
        page_height: int,
        band0: int,
        col0: int,
        used0: int,
    ) -> List[Tuple[List[PlacedBlock], Tuple[int, int, int]]]:
        """从游标 (band0, col0, used0) 起依次打包组。

        阅读视口按 4:3 确定性建模（页高由调用方传入）。组（锚点链整体，不可
        拆分）依次填入当前栏：当前栏剩余高度不足就整体移到下一栏；填满 n 栏
        就开启下一水平带。因此栏号随阅读顺序单调不减，栏号顺序严格等于阅读
        顺序。单组高于整页时允许溢出（不丢弃内容）。

        :return: 与 ``groups`` 等长，每项为 (该组 placements, 打包结束游标)。
        """
        out: List[Tuple[List[PlacedBlock], Tuple[int, int, int]]] = []
        band, col, used = band0, col0, used0
        for gi, grp in enumerate(groups):
            group_height = sum(geometries[b.id].height for b in grp)
            if used > 0 and used + group_height > page_height:
                # 当前栏放不下整组 -> 下一栏；列满则换带
                col += 1
                if col >= n:
                    band += 1
                    col = 0
                used = 0
            top = used
            column_no = band * n + col + 1  # 1 基、跨带连续
            plist: List[PlacedBlock] = []
            for b in grp:
                g = geometries[b.id]
                plist.append(PlacedBlock(b, column_no, top, band, g))
                top += g.height
            used = top
            out.append((plist, (band, col, used)))
        return out

    # -- 阅读位置恢复（需求 6） ------------------------------------------- #
    def restore_reading_position(
        self, block_id: str, intra_offset: int = 0
    ) -> dict:
        """把中断位置恢复到当前版面上。

        成功：返回同一块的栏号与块内偏移。块已不存在（稿件被删改）时回退到
        原始顺序最接近的可用块，并在 ``fallback_reason`` 中说明原因。
        """
        if self._result is None:
            raise LayoutError("尚未进行任何重排，无法恢复阅读位置")
        intra_offset = max(0, int(intra_offset))
        p = self._result.placement_of(block_id)
        if p is not None:
            clamped = min(intra_offset, p.geometry.height)
            return {
                "restored": True,
                "requested_block_id": block_id,
                "block_id": block_id,
                "column": p.column,
                "intra_offset": clamped,
                "requested_intra_offset": intra_offset,
                "offset_clamped": clamped != intra_offset,
                "offset": p.offset,
                "degraded": p.geometry.degraded,
                "fallback_reason": None,
            }
        # 回退：按原始顺序找最近的仍存在块（同序距取更靠前的）
        survivors = {pb.block.id: pb.block for pb in self._result.placements}
        if not survivors:
            return {
                "restored": False,
                "requested_block_id": block_id,
                "block_id": None,
                "column": None,
                "intra_offset": 0,
                "requested_intra_offset": intra_offset,
                "offset_clamped": False,
                "offset": None,
                "degraded": None,
                "fallback_reason": f"块 {block_id} 不存在，且稿件中没有任何可用块",
            }
        target_order = None
        for b in self.manuscript.blocks:
            if b.id == block_id:
                target_order = b.order
                break
        if target_order is None:
            # 存档引用了一个当前稿件完全未知的块：退回首块
            nearest = self._result.placements[0].block
            reason = f"块 {block_id} 在当前稿件中不存在，回退到阅读序列首块 {nearest.id}"
        else:
            nearest = min(
                survivors.values(),
                key=lambda b: (abs(b.order - target_order), 0 if b.order < target_order else 1),
            )
            reason = (
                f"块 {block_id} 已不存在，按原始顺序最近原则回退到块 {nearest.id}"
                f"（order {target_order} -> {nearest.order}）"
            )
        pn = self._result.placement_of(nearest.id)
        return {
            "restored": False,
            "requested_block_id": block_id,
            "block_id": nearest.id,
            "column": pn.column,
            "intra_offset": 0,
            "requested_intra_offset": intra_offset,
            "offset_clamped": False,
            "offset": pn.offset,
            "degraded": pn.geometry.degraded,
            "fallback_reason": reason,
        }

    # -- 查询（需求 7） --------------------------------------------------- #
    def query_block(self, block_id: str) -> BlockView:
        if self._result is None:
            raise LayoutError("尚未进行任何重排，无可查询版面")
        p = self._result.placement_of(block_id)
        if p is None:
            raise KeyError(f"块 {block_id} 不存在")
        return self._to_view(p)

    def query_all(self) -> List[BlockView]:
        if self._result is None:
            raise LayoutError("尚未进行任何重排，无可查询版面")
        # 稳定顺序：栏号 -> 栏内偏移 -> 原始顺序
        ordered = sorted(
            self._result.placements, key=lambda p: (p.column, p.offset, p.block.order)
        )
        return [self._to_view(p) for p in ordered]

    def query_anchor_violations(self) -> List[AnchorViolation]:
        """返回当前版面所有被打破的锚点，按块标识稳定排序。"""
        if self._result is None:
            raise LayoutError("尚未进行任何重排，无可查询版面")
        return [self._result.anchor_violations[k]
                for k in sorted(self._result.anchor_violations)]

    def verify_anchors(self, placements: Optional[List[PlacedBlock]] = None) -> List[AnchorViolation]:
        """校验锚点几何关系；不传参则校验当前版面。

        也可传入任意 placements（例如外部排版结果 / 被人为拆散的版面），
        返回所有违约，按块标识稳定排序。引擎自身的锚点组不可拆分，正常
        版面返回空列表；当目标与锚点块被分到不同栏、偏移不紧邻或中间插入
        了别的块时，对应条目会给出原因与涉及块序列。
        """
        if placements is None:
            if self._result is None:
                raise LayoutError("尚未进行任何重排，无可查询版面")
            placements = self._result.placements
        violations = verify_anchor_layout(placements)
        return [violations[k] for k in sorted(violations)]

    def query_relayout_info(self) -> dict:
        """分别返回“重新打包”与“坐标实际变化”两组信息（语义不混用）。

        - relaid_out_blocks：本次参与重新打包的块（触碰范围，供失效缓存）；
        - affected_blocks  ：相对上一版 (栏号,偏移) 真正变化的块（最小重绘集）；
        - geometry_recomputed：几何缓存未命中而重新测量的块；
        - unaffected_blocks：坐标保持不变的块。
        不变量：affected ⊆ relaid_out。
        """
        if self._result is None:
            raise LayoutError("尚未进行任何重排，无可查询版面")
        r = self._result
        return {
            "relaid_out_blocks": list(r.relaid_out_blocks),
            "affected_blocks": list(r.affected_blocks),
            "geometry_recomputed": list(r.geometry_recomputed),
            "unaffected_blocks": list(r.unaffected_blocks),
            "affected_subset_of_relaid":
                set(r.affected_blocks) <= set(r.relaid_out_blocks),
        }

    def _to_view(self, p: PlacedBlock) -> BlockView:
        violation = self._result.anchor_violations.get(p.block.id)
        return BlockView(
            block_id=p.block.id,
            type=p.block.type,
            order=p.block.order,
            column=p.column,
            offset=p.offset,
            height=p.geometry.height,
            rendered_width=p.geometry.rendered_width,
            degraded=p.geometry.degraded,
            degrade_reason=p.geometry.degrade_reason,
            anchor=p.block.anchor,
            anchor_satisfied=violation is None,
            anchor_violation=None if violation is None else violation.reason,
            anchor_involved=None if violation is None else list(violation.involved),
        )

    @property
    def layout_version(self) -> int:
        return self.version

    # -- 持久化（需求 8） ------------------------------------------------- #
    def save(self, path: str) -> None:
        """原子写入存档（同目录临时文件 + os.replace）。"""
        if self._result is None:
            raise LayoutError("尚未进行任何重排，无版面可保存")
        payload = {
            "format": SAVE_FORMAT,
            "manuscript": self.manuscript.to_dict(),
            "config": {
                "font_size": self.font_size,
                "viewport_width": self.viewport_width,
                "gutter": self.gutter,
            },
            "layout": {
                "version": self.version,
                "column_count": self._result.column_count,
                "blocks": [
                    {
                        "block_id": p.block.id,
                        "column": p.column,
                        "offset": p.offset,
                        "height": p.geometry.height,
                        "rendered_width": p.geometry.rendered_width,
                        "span": p.geometry.span,
                        "degraded": p.geometry.degraded,
                        "degrade_reason": p.geometry.degrade_reason,
                    }
                    for p in sorted(
                        self._result.placements, key=lambda p: (p.column, p.offset, p.block.order)
                    )
                ],
            },
            "reading_position": (
                None
                if self.reading_block_id is None
                else {
                    "block_id": self.reading_block_id,
                    "intra_offset": self.reading_intra_offset,
                }
            ),
        }
        directory = os.path.dirname(os.path.abspath(path))
        fd, tmp = tempfile.mkstemp(prefix=".reflow-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=True)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    @classmethod
    def load(cls, path: str) -> "ReflowEngine":
        """从存档载入。

        全部校验（字段完整 -> 标识唯一 -> 锚点合法 -> 栏号自洽）通过后才
        构造并返回引擎；任何一步失败都抛 :class:`PersistenceError`，调用方
        原有引擎状态不受影响（本方法不修改任何现存对象）。
        """
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            raise PersistenceError(f"存档不存在：{path}", path=path)
        except json.JSONDecodeError as e:
            raise PersistenceError(f"存档不是合法 JSON：{e}", path=path) from e

        if not isinstance(data, dict):
            raise PersistenceError("存档根节点必须是对象")
        if data.get("format") != SAVE_FORMAT:
            raise PersistenceError(
                f"存档格式标识不匹配：期望 {SAVE_FORMAT}，实际 {data.get('format')!r}"
            )
        for section in ("manuscript", "config", "layout"):
            if section not in data:
                raise PersistenceError(f"存档缺少顶层字段：{section!r}", missing=[section])

        manuscript = Manuscript.from_dict(data["manuscript"])  # 结构 / 标识 / 锚点校验

        cfg = data["config"]
        for k in ("font_size", "viewport_width"):
            if k not in cfg:
                raise PersistenceError(f"config 缺少字段：{k!r}", missing=[k])
        gutter = cfg.get("gutter", DEFAULT_GUTTER)
        try:
            engine = cls(manuscript, gutter=gutter)
            result = engine.configure(cfg["font_size"], cfg["viewport_width"])
        except (LayoutError, ValidationError, AnchorError) as e:
            raise PersistenceError(f"按存档配置重排失败：{e}") from e

        cls._verify_layout_snapshot(data["layout"], result, manuscript)
        # 版本号是会话内单调计数器，不可从内容重算：校验其形态后恢复
        stored_version = data["layout"].get("version")
        if not isinstance(stored_version, int) or stored_version < 1:
            raise PersistenceError(f"版本号非法：{stored_version!r}（需为 ≥1 的整数）")
        engine.version = stored_version
        result.version = stored_version

        rp = data.get("reading_position")
        if rp is not None:
            if not isinstance(rp, dict) or "block_id" not in rp:
                raise PersistenceError("reading_position 节点损坏：需包含 block_id")
            if result.placement_of(rp["block_id"]) is None:
                raise PersistenceError(
                    f"阅读位置引用了不存在的块 {rp['block_id']!r}（可载入但需修正阅读位置）",
                    block_id=rp["block_id"],
                )
            engine.reading_block_id = rp["block_id"]
            engine.reading_intra_offset = max(0, int(rp.get("intra_offset", 0)))
        return engine

    @staticmethod
    def _verify_layout_snapshot(layout: dict, result: ReflowResult, manuscript: Manuscript) -> None:
        if not isinstance(layout, dict):
            raise PersistenceError("layout 节点不是对象")
        stored_version = layout.get("version")
        if not isinstance(stored_version, int) or stored_version < 1:
            raise PersistenceError(f"版本号非法：{stored_version!r}（需为 ≥1 的整数）")
        if layout.get("column_count") != result.column_count:
            raise PersistenceError(
                f"栏数不自洽：存档 column_count={layout.get('column_count')}，"
                f"重算={result.column_count}"
            )
        stored = layout.get("blocks")
        if not isinstance(stored, list):
            raise PersistenceError("layout.blocks 必须为数组")
        if len(stored) != len(result.placements):
            raise PersistenceError(
                f"版面块数不自洽：存档 {len(stored)} 块，重算 {len(result.placements)} 块"
            )
        expected = {
            p.block.id: (p.column, p.offset, p.geometry.height,
                         p.geometry.rendered_width, p.geometry.span,
                         p.geometry.degraded, p.geometry.degrade_reason)
            for p in result.placements
        }
        seen = set()
        for row in stored:
            bid = row.get("block_id")
            if bid not in expected:
                raise PersistenceError(f"版面出现稿件中不存在的块：{bid!r}", block_id=bid)
            if bid in seen:
                raise PersistenceError(f"版面中块 {bid!r} 重复出现", block_id=bid)
            seen.add(bid)
            exp = expected[bid]
            actual = (
                row.get("column"), row.get("offset"), row.get("height"),
                row.get("rendered_width"), row.get("span"),
                row.get("degraded"), row.get("degrade_reason"),
            )
            if actual != exp:
                raise PersistenceError(
                    f"块 {bid} 的栏号/偏移自洽校验失败：存档 {actual} != 重算 {exp}",
                    block_id=bid,
                )
