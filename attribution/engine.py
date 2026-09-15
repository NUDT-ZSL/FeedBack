"""归因核心引擎。

职责
----
1. 维护改版（Revision）与分群（Segment）登记，非法配置拒绝并指出位置；
2. 维护“用户在某一时刻属于哪个分群”的唯一归属：冲突按确定性规则裁决
   （分群 id 字典序最小者胜），台账由当前全量纪元确定性推导，与登记
   顺序无关；
3. 按逻辑时钟接收观测值：``(分群, 时刻, 体验项)`` 唯一，重复上报幂等；
   从未上报的格子为 MISSING（``None``），绝不当作 0；
4. 每次改版算出受影响体验项前后变化，并按分群做结构 / 真实的对称
   （Kitagawa/Shapley）分解，结构 + 真实 == 总变化；
5. 前后成员构成明显不同（Jaccard < 阈值）的分群，其分群内水平变化计入
   “用户结构”归因（composition_migration）并给出贡献占比；
6. 同一体验项被多次改版先后影响时，按生效时刻逐段望远镜拆分，段贡献
   之和 == 首末总变化，且与登记顺序无关；
7. 提供净影响、分群贡献、被抵消部分、来源链等查询，稳定排序、
   重复计算完全一致。

跨分群口径
----------
对比域为前后两侧都上报了该体验项、且都有活动成员的分群（完整样本）；
其余在窗口边缘出现过的分群列入 ``excluded_segments``，缺失不猜、不补零。
``n_{g,t}`` 为分群活动成员数，``N_t = Σ_g n_{g,t}``，
``p_{g,t}=n_{g,t}/N_t`` 为成员份额，``y_{g,t}`` 为分群取值：

    分群总贡献  total_g = p1·y1 - p0·y0
    真实变化    real_g  = (p1+p0)/2·(y1-y0)
    结构混合    mix_g   = (y1+y0)/2·(p1-p0)

    real_g + mix_g == total_g；Σ_g total_g == 整体加权均值 y1̄ - y0̄。

结构项与真实项可能异号（低分群体扩张拖累均值，而改版实际在提分），
由此得到“被结构变化抵消的部分” = min(|structural|, |real|)（异号时）。
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

from .clock import LogicalClock
from .errors import ConsistencyError, ValidationError, require
from .records import Epoch, Revision, Segment

# 缺失标记：绝不用 0 顶替
MISSING = None

# 守恒校验容忍度
_EPS = 1e-7
# 默认“构成明显不同”的 Jaccard 阈值（低于它判定为结构主导）
DEFAULT_COMPOSITION_THRESHOLD = 0.5
# 来源链中无改版窗口的标注
NATURAL_LABEL = "(自然波动)"


# ---------------------------------------------------------------------------
# 结果类型
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AssignmentConflict:
    """一次用户重复归属的裁决记录。"""

    user_id: str
    time: int
    rejected_segment: str
    kept_segment: str
    rule: str = "同一时刻重复归属时，分群 id 字典序最小者生效"


@dataclass(frozen=True)
class ObservationConflict:
    """同一 (分群, 时刻, 体验项) 用不同数值重复上报时的冲突说明。

    冲突上报会被**拒绝**（引擎状态不变），异常中携带本记录，便于调用方
    明确知道冲突双方而不是静默覆盖。
    """

    segment_id: str
    time: int
    item: str
    existing_value: float
    rejected_value: float


NEWLY_ENTERED = "(新进入)"
DEPARTED = "(已离开)"


@dataclass(frozen=True)
class MemberFlow:
    """分群在一个对比窗口内的成员来源/去向。

    - ``retained``：    前后都在本分群的成员；
    - ``joined_from``： 改版后新进入本分群的成员及其来源分群
      （来源为 :data:`NEWLY_ENTERED` 表示此前不在任何分群）；
    - ``left_to``：     改版前在本分群、改版后离开的成员及其去向分群
      （去向为 :data:`DEPARTED` 表示此后不在任何分群）。

    所有用户清单与 ``(user, other)`` 对都按稳定顺序排列。
    """

    segment_id: str
    before_time: int
    after_time: int
    before_members: Tuple[str, ...]
    after_members: Tuple[str, ...]
    retained: Tuple[str, ...]
    joined_from: Tuple[Tuple[str, str], ...]
    left_to: Tuple[Tuple[str, str], ...]


@dataclass(frozen=True)
class MigrationRecord:
    """一次跨分群的归属迁移事件（由构成纪元时间线确定性推导）。

    每次某个分群在纪元 ``time`` 失去用户 ``uid``，而该用户在同一纪元时刻
    （或之后最近的纪元时刻）出现在另一个分群，记一条从 ``from_segment``
    到 ``to_segment`` 的迁移。``from_segment`` 为 :data:`NEWLY_ENTERED`
    表示外部流入；``to_segment`` 为 :data:`DEPARTED` 表示流出到外部。
    同一路径的重复往返（A→B→A）会产生各自独立的记录，不被合并。
    """

    user_id: str
    time: int
    from_segment: str
    to_segment: str



@dataclass(frozen=True)
class SegmentAttribution:
    """单个分群在单个对比窗口、单个体验项上的归因结果。

    ``total = structural + real = mix + composition_migration + real``。
    """

    segment_id: str
    total: float
    structural: float
    real: float
    mix: float                        # 成员跨分群迁移（份额变化）
    composition_migration: float     # 构成被判定明显不同时分群内水平变化
    overlap: float                    # 前后活动成员 Jaccard，∈ [0, 1]
    attributed_to_composition: bool
    before_value: Optional[float]
    after_value: Optional[float]
    before_weight: float              # p0
    after_weight: float               # p1
    before_count: int
    after_count: int

    @property
    def canceled_by_structure(self) -> float:
        """被结构变化抵消的量级（结构项与真实项异号时取较小绝对值）。"""
        if self.structural == 0.0 or self.real == 0.0:
            return 0.0
        if (self.structural > 0) != (self.real > 0):
            return min(abs(self.structural), abs(self.real))
        return 0.0


@dataclass(frozen=True)
class ItemRevisionAttribution:
    """单次改版对单个体验项的归因（跨分群汇总）。"""

    revision_id: str
    item: str
    before_time: int
    after_time: int
    total: float
    structural: float
    real: float
    canceled_by_structure: float
    segment_attributions: Tuple[SegmentAttribution, ...]
    # 各分群对总变化绝对值的贡献占比（∈ [0, 1]，按绝对值归一）
    segment_shares: Tuple[Tuple[str, float], ...]
    # 构成被判定为明显不同、其分群内水平变化整体归因到结构的分群
    composition_segments: Tuple[str, ...]
    # 窗口边缘出现过该体验项、但因另一侧缺失等无法纳入对比域的分群
    excluded_segments: Tuple[str, ...]
    # 对比域内各分群改版前后的成员来源/去向（稳定排序）
    member_flows: Tuple[MemberFlow, ...]


@dataclass(frozen=True)
class AttributionReport:
    """一次改版的完整归因报告（覆盖它调整的全部体验项）。"""

    revision: Revision
    items: Tuple[ItemRevisionAttribution, ...] = field(default=())

    def item(self, item: str) -> Optional[ItemRevisionAttribution]:
        for r in self.items:
            if r.item == item:
                return r
        return None


@dataclass(frozen=True)
class ChainSegment:
    """来源链上的一段：某时间窗内对某体验项的变化贡献。"""

    revision_id: str
    window_start: int
    window_end: int
    contribution: float
    structural: float
    real: float
    canceled_by_structure: float
    # 该窗口内面板各分群的成员来源/去向（稳定排序）
    member_flows: Tuple[MemberFlow, ...] = ()


@dataclass(frozen=True)
class ItemSourceChain:
    """某体验项从首末时刻的变化来源链（段贡献之和 == 首末总变化）。

    采用**平衡面板**：在链上每个边界刻度都有观测、且各时刻都有活动成员
    的分群才入链；其余分群在 ``excluded_segments`` 显式标注。
    """

    item: str
    start_time: int
    end_time: int
    start_value: float
    end_value: float
    total_change: float
    segments: Tuple[ChainSegment, ...]
    panel_segments: Tuple[str, ...]
    excluded_segments: Tuple[str, ...]


# ---------------------------------------------------------------------------
# 引擎
# ---------------------------------------------------------------------------


class AttributionEngine:
    def __init__(self, clock: Optional[LogicalClock] = None,
                 composition_threshold: float = DEFAULT_COMPOSITION_THRESHOLD):
        self.clock = clock or LogicalClock(0)
        require(isinstance(float(composition_threshold), float),
                "构成差异阈值必须是数值", "composition_threshold")
        require(0.0 <= float(composition_threshold) <= 1.0,
                "构成差异阈值必须在 [0, 1] 区间", "composition_threshold")
        self._threshold = float(composition_threshold)

        self._revisions: Dict[str, Revision] = {}
        self._segments: Dict[str, Segment] = {}
        # obs[segment_id][time][item] = float；同键异值上报直接拒绝
        self._obs: Dict[str, Dict[int, Dict[str, float]]] = {}

    # ------------------------------------------------------------------
    # 1. 改版登记
    # ------------------------------------------------------------------

    def register_revision(self, revision_id: str, time: int,
                          items: Sequence[str]) -> Revision:
        loc = f"revisions[{revision_id!r}]"
        try:
            rev = Revision(revision_id, time, items)
        except ValidationError as e:
            raise e.at(f"{loc}.{e.path}" if e.path else loc)
        require(rev.id not in self._revisions,
                f"改版 id {rev.id!r} 重复", f"{loc}.id")
        require(rev.time <= self.clock.now,
                f"改版生效时刻 {rev.time} 晚于逻辑时钟当前时刻 "
                f"{self.clock.now}，请先推进时钟", f"{loc}.time")
        self._revisions[rev.id] = rev
        return rev

    # ------------------------------------------------------------------
    # 2. 分群、构成纪元与归属裁决
    # ------------------------------------------------------------------

    def register_segment(self, segment_id: str, entry_time: int,
                         users: Sequence[str]) -> Segment:
        """登记一个新分群（建立首个构成纪元）。"""
        loc = f"segments[{segment_id!r}]"
        try:
            epoch = Epoch(entry_time, users)
            seg = Segment(segment_id, [epoch])
        except ValidationError as e:
            raise e.at(f"{loc}.{e.path}" if e.path else loc)
        require(seg.id not in self._segments,
                f"分群 id {seg.id!r} 重复", f"{loc}.id")
        require(seg.entry_time <= self.clock.now,
                f"分群进入时刻 {seg.entry_time} 晚于逻辑时钟当前时刻 "
                f"{self.clock.now}", f"{loc}.entry_time")
        self._segments[seg.id] = seg
        return seg

    def replace_composition(self, segment_id: str, time: int,
                            users: Sequence[str]) -> Segment:
        """在严格递增的 ``time`` 替换某分群成员构成（新增纪元）。"""
        loc = f"segments[{segment_id!r}]"
        require(segment_id in self._segments,
                f"未知分群 {segment_id!r}", f"{loc}.id")
        seg = self._segments[segment_id]
        require(time > seg.epochs[-1].time,
                f"构成纪元时刻必须严格递增：{time} 不晚于上一纪元 "
                f"{seg.epochs[-1].time}", f"{loc}.epochs")
        require(time <= self.clock.now,
                f"纪元时刻 {time} 晚于逻辑时钟当前时刻 {self.clock.now}",
                f"{loc}.epochs")
        try:
            new_epoch = Epoch(time, users)
        except ValidationError as e:
            raise e.at(f"{loc}.epochs.{e.path}" if e.path
                       else f"{loc}.epochs")
        seg = Segment(segment_id, list(seg.epochs) + [new_epoch])
        self._segments[segment_id] = seg
        return seg

    def _claimants(self, user_id: str, time: int) -> List[str]:
        """在 ``time`` 声称拥有该用户的全部分群 id。"""
        out = []
        for seg in self._segments.values():
            if user_id in set(seg.members_at(time)):
                out.append(seg.id)
        return sorted(out)

    def owner_at(self, user_id: str, time: int) -> Optional[str]:
        """该用户在 ``time`` 的唯一归属分群（字典序最小者胜）。"""
        claimants = self._claimants(user_id, time)
        return claimants[0] if claimants else None

    def active_members(self, segment_id: str, time: int) -> Tuple[str, ...]:
        """分群在某时刻的活动成员：当时纪元成员中归属裁决获胜者。"""
        require(segment_id in self._segments,
                f"未知分群 {segment_id!r}", "segment_id")
        members = self._segments[segment_id].members_at(time)
        return tuple(sorted(
            uid for uid in members if self.owner_at(uid, time) == segment_id))

    def assignment_conflicts(self) -> Tuple[AssignmentConflict, ...]:
        """重复归属裁决台账（由当前全量纪元确定性推导，与登记顺序无关）。"""
        event_times = sorted({
            e.time for seg in self._segments.values() for e in seg.epochs})
        out: List[AssignmentConflict] = []
        for t in event_times:
            table: Dict[str, List[str]] = {}
            for seg in self._segments.values():
                for uid in seg.members_at(t):
                    table.setdefault(uid, []).append(seg.id)
            for uid, ids in table.items():
                ordered = sorted(set(ids))
                if len(ordered) <= 1:
                    continue
                kept = ordered[0]
                for rejected in ordered[1:]:
                    out.append(AssignmentConflict(
                        user_id=uid, time=t,
                        rejected_segment=rejected, kept_segment=kept))
        return tuple(sorted(out,
                            key=lambda c: (c.time, c.user_id,
                                           c.rejected_segment)))

    # ------------------------------------------------------------------
    # 2b. 迁移台账（由归属时间线确定性推导，含回迁）
    # ------------------------------------------------------------------

    def migrations(self) -> Tuple[MigrationRecord, ...]:
        """跨分群归属迁移台账。

        沿所有构成纪元时刻，逐用户跟踪其唯一归属分群（裁决后）的变化：
        归属从 A 变为 B 即记一条 ``A -> B``；从无到有记
        :data:`NEWLY_ENTERED -> 分群`，从有到无记
        ``分群 -> :data:`DEPARTED```。A->B->A 的往返产生两条独立记录，
        不被合并。结果由当前数据推导，与登记顺序无关。
        """
        event_times = sorted({
            e.time for seg in self._segments.values() for e in seg.epochs})
        # 只跟踪在任一纪元出现过的用户
        users = set()
        for seg in self._segments.values():
            for e in seg.epochs:
                users.update(e.users)

        out: List[MigrationRecord] = []
        for uid in users:
            prev = None
            prev_time = None
            for t in event_times:
                cur = self.owner_at(uid, t)
                if cur == prev:
                    continue
                if prev is None and cur is not None:
                    out.append(MigrationRecord(
                        uid, t, NEWLY_ENTERED, cur))
                elif prev is not None and cur is None:
                    out.append(MigrationRecord(
                        uid, t, prev, DEPARTED))
                elif prev is not None and cur is not None:
                    out.append(MigrationRecord(
                        uid, t, prev, cur))
                # prev is None and cur is None：不变，不记录
                prev, prev_time = cur, t
        return tuple(sorted(out,
                            key=lambda m: (m.time, m.user_id,
                                           m.from_segment, m.to_segment)))

    def member_flow(self, segment_id: str, t0: int,
                    t1: int) -> MemberFlow:
        """单个分群在窗口 (t0, t1] 的成员来源/去向。

        来源以窗口内的**迁移事件**为准（而非只看两端集合），因此 A→B→A
        的回迁用户在最终分群里会显示“从 B 迁回”，不会被误判为一直留存：

        - 改版后成员若在窗口内有迁入本分群的事件，``joined_from`` 记录其
          最近一次迁入的来源分群（即使 t0 时它也在本分群）；
        - 否则若 t0 时也在本分群，记为 ``retained``；
        - t0 在、t1 不在的成员进 ``left_to``，去向取其 t1 的归属。
        """
        before = set(self.active_members(segment_id, t0))
        after = set(self.active_members(segment_id, t1))

        # 窗口内迁入本分群的最后一条事件（migrations 已按时刻排序）
        last_in: Dict[str, MigrationRecord] = {}
        for m in self.migrations():
            if t0 < m.time <= t1 and m.to_segment == segment_id:
                last_in[m.user_id] = m

        retained: List[str] = []
        joined: List[Tuple[str, str]] = []
        for uid in sorted(after):
            if uid in last_in:
                joined.append((uid, last_in[uid].from_segment))
            elif uid in before:
                retained.append(uid)
            else:
                joined.append((uid, self.owner_at(uid, t0)
                               or NEWLY_ENTERED))

        left = [(uid, self.owner_at(uid, t1) or DEPARTED)
                for uid in sorted(before - after)]

        return MemberFlow(
            segment_id=segment_id, before_time=t0, after_time=t1,
            before_members=tuple(sorted(before)),
            after_members=tuple(sorted(after)),
            retained=tuple(retained),
            joined_from=tuple(joined),
            left_to=tuple(left))

    def member_flows(self, t0: int, t1: int,
                     segments: Optional[Sequence[str]] = None
                     ) -> Tuple[MemberFlow, ...]:
        """窗口内各分群（默认全部已知分群）的成员来源/去向，稳定排序。"""
        sids = sorted(segments) if segments is not None \
            else sorted(self._segments)
        return tuple(self.member_flow(s, t0, t1) for s in sids)

    # ------------------------------------------------------------------
    # 3. 观测上报（幂等 + 异值拒绝 + 缺失标注）
    # ------------------------------------------------------------------

    def observe(self, segment_id: str, time: int, item: str,
                value: float) -> None:
        """上报一条观测，键为 ``(分群, 时刻, 体验项)``。

        - 首次上报：写入，返回 ``None``；
        - 同键同值重复上报：幂等忽略，返回 ``None``；
        - 同键异值重复上报：**拒绝**并抛 :class:`ValidationError`
          （``error.conflict`` 携带 :class:`ObservationConflict`），
          引擎已有观测与任何状态都不改变（绝不静默覆盖基线）。

        所有参数校验先于任何写入，因此非法上报不会留下空桶等副作用。
        """
        require(segment_id in self._segments,
                f"观测引用了未知分群 {segment_id!r}", "segment_id")
        require(isinstance(time, int) and not isinstance(time, bool),
                "观测时刻必须是 int", "time")
        require(time <= self.clock.now,
                f"观测时刻 {time} 晚于逻辑时钟当前时刻 {self.clock.now}",
                "time")
        require(self._segments[segment_id].entry_time <= time,
                f"观测时刻 {time} 早于分群 {segment_id!r} 的进入时刻 "
                f"{self._segments[segment_id].entry_time}", "time")
        require(self.active_members(segment_id, time),
                f"分群 {segment_id!r} 在时刻 {time} 没有任何活动成员"
                f"（归属裁决后为空），无法上报观测", "segment_id")
        require(isinstance(item, str) and item.strip(),
                "体验项名称不允许为空", "item")
        require(isinstance(value, (int, float)) and not isinstance(value, bool),
                "观测值必须是数值", "value")
        val = float(value)
        require(val == val and val not in (float("inf"), float("-inf")),
                "观测值不允许是 NaN/Inf", "value")
        name = item.strip()

        # 冲突检查在读路径完成；确认可写入后才落桶
        existing = self._obs.get(segment_id, {}).get(time)
        if existing is not None and name in existing:
            if existing[name] == val:
                return None  # 幂等
            err = ValidationError(
                f"同一分群 {segment_id!r} 在时刻 {time} 对体验项 "
                f"{name!r} 上报了冲突数值：已存在 {existing[name]}，"
                f"本次 {val} 被拒绝（重复上报必须与原值一致）",
                f"observations[{segment_id!r}][{time}][{name!r}]")
            err.conflict = ObservationConflict(
                segment_id=segment_id, time=time, item=name,
                existing_value=existing[name], rejected_value=val)
            raise err

        at = self._obs.setdefault(segment_id, {}).setdefault(time, {})
        at[name] = val
        return None

    def value_at(self, segment_id: str, time: int, item: str
                 ) -> Optional[float]:
        """分群在某时刻对某体验项的取值；未上报/无活动成员返回 ``None``。"""
        require(segment_id in self._segments,
                f"未知分群 {segment_id!r}", "segment_id")
        if not self.active_members(segment_id, time):
            return MISSING
        at = self._obs.get(segment_id, {}).get(time)
        if at is None or item not in at:
            return MISSING
        return at[item]

    def missing_slots(self, item: str) -> Tuple[Tuple[str, int], ...]:
        """显式列出某体验项“本应有但缺失”的 (分群, 时刻) 格子。

        刻度取该体验项在全引擎出现过的观测时刻；分群在该刻度已进入
        （有时效纪元）却没有观测，即列为缺失。绝不当作 0。
        """
        ticks = sorted({t for by_time in self._obs.values()
                        for t, its in by_time.items() if item in its})
        out: List[Tuple[str, int]] = []
        for sid in sorted(self._segments):
            seg = self._segments[sid]
            for t in ticks:
                if t < seg.entry_time or t > self.clock.now:
                    continue
                if item not in self._obs.get(sid, {}).get(t, {}):
                    out.append((sid, t))
        return tuple(out)

    # ------------------------------------------------------------------
    # 4/5. 窗口归因（按成员份额加权的对称分解）
    # ------------------------------------------------------------------

    def _window_domain(self, t0: int, t1: int, item: str
                       ) -> Tuple[List[str], List[str]]:
        """返回 (对比域分群, 边缘出现但被排除的分群)，均按 id 排序。"""
        sids = sorted(self._obs.keys())
        included, edge = [], []
        for sid in sids:
            ok0 = (item in self._obs[sid].get(t0, {})
                   and bool(self.active_members(sid, t0)))
            ok1 = (item in self._obs[sid].get(t1, {})
                   and bool(self.active_members(sid, t1)))
            if ok0 and ok1:
                included.append(sid)
            elif (item in self._obs[sid].get(t0, {})
                  or item in self._obs[sid].get(t1, {})):
                edge.append(sid)
        return included, edge

    def _revision_window(self, rev: Revision, item: str
                         ) -> Tuple[int, int]:
        """改版前后观测时刻：严格早于生效时刻的最近刻度 / 不早于的最近刻度。"""
        before_times: Set[int] = set()
        after_times: Set[int] = set()
        for sid, by_time in self._obs.items():
            for t, items in by_time.items():
                if item not in items or not self.active_members(sid, t):
                    continue
                if t < rev.time:
                    before_times.add(t)
                else:
                    after_times.add(t)
        require(before_times,
                f"改版 {rev.id!r} 生效前缺少体验项 {item!r} 的观测",
                f"revisions[{rev.id!r}]")
        require(after_times,
                f"改版 {rev.id!r} 生效后缺少体验项 {item!r} 的观测",
                f"revisions[{rev.id!r}]")
        t0, t1 = max(before_times), min(after_times)
        require(t0 < t1, "改版前观测时刻必须早于改版后观测时刻")
        return t0, t1

    def _window_attributions(self, t0: int, t1: int, item: str,
                             sids: Sequence[str]) -> List[SegmentAttribution]:
        """对给定对比域做成员份额加权的对称分解。"""
        raw = []
        n_total0 = n_total1 = 0
        for sid in sids:
            y0 = self.value_at(sid, t0, item)
            y1 = self.value_at(sid, t1, item)
            assert y0 is not None and y1 is not None
            n0 = len(self.active_members(sid, t0))
            n1 = len(self.active_members(sid, t1))
            n_total0 += n0
            n_total1 += n1
            raw.append((sid, n0, n1, y0, y1))
        require(n_total0 > 0 and n_total1 > 0,
                "对比域在窗口两侧都必须有活动成员", "observations")

        attrs: List[SegmentAttribution] = []
        for sid, n0, n1, y0, y1 in raw:
            p0, p1 = n0 / n_total0, n1 / n_total1
            members0 = set(self.active_members(sid, t0))
            members1 = set(self.active_members(sid, t1))
            union = members0 | members1
            overlap = len(members0 & members1) / len(union) if union else 1.0

            total = p1 * y1 - p0 * y0
            real = (p1 + p0) / 2.0 * (y1 - y0)
            mix = (y1 + y0) / 2.0 * (p1 - p0)

            composition_driven = overlap < self._threshold
            if composition_driven:
                # 分群内水平变化不归改版，并入结构
                structural = mix + real
                composition_migration = real
                real_attr = 0.0
            else:
                structural = mix
                composition_migration = 0.0
                real_attr = real

            if abs((mix + (composition_migration if composition_driven
                           else 0.0) + real_attr) - total) > _EPS:
                raise ConsistencyError(
                    f"分群 {sid} 分解不守恒")
            if abs((structural + real_attr) - total) > _EPS:
                raise ConsistencyError(
                    f"分群 {sid} 结构+真实 != 总变化")

            attrs.append(SegmentAttribution(
                segment_id=sid, total=total, structural=structural,
                real=real_attr, mix=mix,
                composition_migration=composition_migration,
                overlap=overlap,
                attributed_to_composition=composition_driven,
                before_value=y0, after_value=y1,
                before_weight=p0, after_weight=p1,
                before_count=n0, after_count=n1))
        return attrs

    def attribute_revision(self, revision_id: str,
                           items: Optional[Sequence[str]] = None
                           ) -> AttributionReport:
        """计算某次改版的归因报告。"""
        require(revision_id in self._revisions,
                f"未知改版 {revision_id!r}", "revision_id")
        rev = self._revisions[revision_id]
        targets = list(items) if items is not None else list(rev.items)
        for it in targets:
            require(it in rev.item_set,
                    f"体验项 {it!r} 不在改版 {revision_id!r} 的调整范围内",
                    f"items[{it!r}]")

        results: List[ItemRevisionAttribution] = []
        for item in sorted(set(targets)):
            t0, t1 = self._revision_window(rev, item)
            sids, edge = self._window_domain(t0, t1, item)
            require(sids,
                    f"体验项 {item!r} 在改版 {rev.id!r} 前后没有共同可对比分群",
                    f"revisions[{rev.id!r}]")
            attrs = self._window_attributions(t0, t1, item, sids)

            total = sum(a.total for a in attrs)
            structural = sum(a.structural for a in attrs)
            real = sum(a.real for a in attrs)
            # 抵消量在体验项汇总层级判定（异号可能跨分群出现）
            if structural != 0.0 and real != 0.0 and \
                    (structural > 0) != (real > 0):
                canceled = min(abs(structural), abs(real))
            else:
                canceled = 0.0
            if abs((structural + real) - total) > _EPS:
                raise ConsistencyError(f"体验项 {item} 级归因不守恒")

            denom = sum(abs(a.total) for a in attrs)
            shares = tuple(
                (a.segment_id, (abs(a.total) / denom if denom else 0.0))
                for a in sorted(attrs, key=lambda a: a.segment_id))
            comp_sids = tuple(sorted(
                a.segment_id for a in attrs if a.attributed_to_composition))
            flows = tuple(self.member_flow(s, t0, t1) for s in sids)

            results.append(ItemRevisionAttribution(
                revision_id=revision_id, item=item,
                before_time=t0, after_time=t1,
                total=total, structural=structural, real=real,
                canceled_by_structure=canceled,
                segment_attributions=tuple(
                    sorted(attrs, key=lambda a: a.segment_id)),
                segment_shares=shares,
                composition_segments=comp_sids,
                excluded_segments=tuple(edge),
                member_flows=flows))

        return AttributionReport(
            revision=rev,
            items=tuple(sorted(results, key=lambda r: r.item)))

    # ------------------------------------------------------------------
    # 6/7. 多次改版的来源链
    # ------------------------------------------------------------------

    def item_chain(self, item: str,
                   start_time: Optional[int] = None,
                   end_time: Optional[int] = None) -> ItemSourceChain:
        """某体验项被多次改版影响时的变化来源链。

        以相邻观测刻度之间的间隔为一段（望远镜拆分）：每段归因给生效时刻
        落在该间隔内、生效最晚的改版；间隔内没有改版则标注
        ``"(自然波动)"``。若多次改版落在同两个观测刻度之间，观测上无法
        区分，整段确定性归给最晚改版（不凭空拆分）。
        """
        revs = sorted(
            (r for r in self._revisions.values() if item in r.item_set),
            key=lambda r: (r.time, r.id))

        ticks = sorted({
            t for sid, by_time in self._obs.items()
            for t, its in by_time.items()
            if item in its and self.active_members(sid, t)})
        require(ticks, f"体验项 {item!r} 没有任何观测", "item")
        lo = ticks[0] if start_time is None else start_time
        hi = ticks[-1] if end_time is None else end_time
        require(lo in ticks and hi in ticks and lo < hi,
                f"来源链端点必须都是 {item!r} 的观测刻度且严格递增",
                "start_time/end_time")
        window_ticks = [t for t in ticks if lo <= t <= hi]

        # 平衡面板：在窗口内每个观测刻度都有观测、且都有活动成员
        panel = [
            sid for sid in sorted(self._obs.keys())
            if all(item in self._obs.get(sid, {}).get(t, {})
                   and self.active_members(sid, t) for t in window_ticks)]
        require(panel,
                f"体验项 {item!r} 在来源链窗口内没有跨全部刻度的平衡面板分群",
                "item")
        excluded = tuple(sid for sid in sorted(self._obs.keys())
                         if sid not in panel)

        seg_out: List[ChainSegment] = []
        for ta, tb in zip(window_ticks, window_ticks[1:]):
            owners = [r for r in revs if ta < r.time <= tb]
            rev_id = (max(owners, key=lambda r: (r.time, r.id)).id
                      if owners else NATURAL_LABEL)
            attrs = self._window_attributions(ta, tb, item, panel)
            s_struct = sum(a.structural for a in attrs)
            s_real = sum(a.real for a in attrs)
            if s_struct != 0.0 and s_real != 0.0 and \
                    (s_struct > 0) != (s_real > 0):
                s_cancel = min(abs(s_struct), abs(s_real))
            else:
                s_cancel = 0.0
            seg_out.append(ChainSegment(
                revision_id=rev_id, window_start=ta, window_end=tb,
                contribution=sum(a.total for a in attrs),
                structural=s_struct, real=s_real,
                canceled_by_structure=s_cancel,
                member_flows=tuple(self.member_flow(s, ta, tb)
                                   for s in panel)))

        start_val = self._weighted_level(lo, item, panel)
        end_val = self._weighted_level(hi, item, panel)
        total_change = end_val - start_val
        if abs(sum(s.contribution for s in seg_out) - total_change) > _EPS:
            raise ConsistencyError("来源链段贡献之和 != 首末总变化")
        return ItemSourceChain(
            item=item, start_time=lo, end_time=hi,
            start_value=start_val, end_value=end_val,
            total_change=total_change, segments=tuple(seg_out),
            panel_segments=tuple(panel), excluded_segments=excluded)

    def _weighted_level(self, time: int, item: str,
                        sids: Sequence[str]) -> float:
        """域内按活动成员数加权的整体取值（权重和为 1）。"""
        num = den = 0.0
        for sid in sids:
            v = self.value_at(sid, time, item)
            require(v is not None,
                    f"面板分群 {sid!r} 在时刻 {time} 缺少体验项 "
                    f"{item!r} 的观测", "panel")
            n = len(self.active_members(sid, time))
            num += n * v
            den += n
        require(den > 0, f"时刻 {time} 对比域内没有活动成员", "time")
        return num / den

    # ------------------------------------------------------------------
    # 7. 查询
    # ------------------------------------------------------------------

    def net_impact(self, revision_id: str) -> Dict[str, float]:
        """改版净影响：{体验项: 真实变化}（剔除结构变化后的改版效果）。"""
        report = self.attribute_revision(revision_id)
        return {r.item: r.real
                for r in sorted(report.items, key=lambda x: x.item)}

    def segment_contributions(self, revision_id: str
                              ) -> Dict[str, Tuple[Tuple[str, float], ...]]:
        """各体验项上各分群对总变化的贡献占比（绝对值归一，稳定顺序）。"""
        report = self.attribute_revision(revision_id)
        return {r.item: tuple(sorted(r.segment_shares))
                for r in sorted(report.items, key=lambda x: x.item)}

    def canceled_parts(self, revision_id: str
                       ) -> Dict[str, Tuple[Tuple[str, float], ...]]:
        """各体验项上被结构变化抵消的部分（按分群列出，稳定顺序）。"""
        report = self.attribute_revision(revision_id)
        out: Dict[str, Tuple[Tuple[str, float], ...]] = {}
        for r in sorted(report.items, key=lambda x: x.item):
            out[r.item] = tuple(sorted(
                ((a.segment_id, a.canceled_by_structure)
                 for a in r.segment_attributions
                 if a.canceled_by_structure),
                key=lambda x: x[0]))
        return out

    def all_reports(self) -> Tuple[AttributionReport, ...]:
        """所有改版的归因报告，按 (生效时刻, id) 排序，与登记顺序无关。"""
        ordered = sorted(self._revisions.values(),
                         key=lambda r: (r.time, r.id))
        return tuple(self.attribute_revision(r.id) for r in ordered)

    # ------------------------------------------------------------------
    # 只读视图（供持久化使用）
    # ------------------------------------------------------------------

    @property
    def revisions(self) -> Tuple[Revision, ...]:
        return tuple(sorted(self._revisions.values(),
                            key=lambda r: (r.time, r.id)))

    @property
    def segments(self) -> Tuple[Segment, ...]:
        return tuple(sorted(self._segments.values(),
                            key=lambda s: (s.entry_time, s.id)))

    def raw_observations(self) -> Tuple[Tuple[str, int, str, float], ...]:
        rows = []
        for sid in sorted(self._obs):
            for t in sorted(self._obs[sid]):
                for item in sorted(self._obs[sid][t]):
                    rows.append((sid, t, item, self._obs[sid][t][item]))
        return tuple(rows)

    def raw_observations_grouped(self) -> Dict[str, Dict[int, Dict[str, float]]]:
        """观测的只读分组视图（供持久化校验使用）。"""
        return {sid: {t: dict(items) for t, items in by_time.items()}
                for sid, by_time in self._obs.items()}

    @property
    def composition_threshold(self) -> float:
        return self._threshold
