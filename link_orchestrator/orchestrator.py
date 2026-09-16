"""链路切换编排器。

核心约定
========
* 逻辑时钟 ``clock``：已观测到的最大逻辑时刻，单调非递减，随快照持久化。
* 健康状态按“同一链路、同一逻辑时刻”的上报桶推导：桶内所有来源意见
  一致时该时刻状态确定；桶内出现分歧则为冲突时刻，链路有效状态维持
  冲突前状态，编排器不静默择一。若矛盾上报到达前，该时刻的首个（当时
  一致的）上报已经触发过迁移动作，则在冲突产生时按确定性规则撤销该
  动作，使最终状态与“双方并存、不据冲突迁移”完全一致；撤销本身也
  记录在迁移轨迹里，全过程可追溯、可重放。
* 选路排序完全确定：``(优先级升序, 剩余容量降序, 链路标识字典序)``。
* 故障迁出按业务类别优先级（rank 小者优先，同分按会话标识字典序）。
* 恢复只重算 ``return_link`` 指向恢复链路的会话；增量编排与事件日志
  从头重放走同一条代码路径，结果必然一致，可用 ``verify_consistency``
  / ``replay`` 交叉验证，未受影响会话的承载链路绝不改变。
"""

from collections import OrderedDict
from typing import Optional, List, Dict, Any

from .errors import (
    ValidationError,
    DuplicateIdError,
    NotFoundError,
    LinkUnavailableError,
    CapacityExceededError,
    ClockRejectedError,
    PersistenceError,
)
from .models import (
    Link,
    Session,
    HealthReport,
    MigrationRecord,
    ConflictRecord,
    EventEnvelope,
)

# 自动迁移的原因使用固定文案，保证重放逐字节一致。
REASON_INITIAL = "初始放置"
REASON_EVACUATE = "健康上报不可用，按业务类别优先级迁出"
REASON_RECOVER = "承载链路恢复可用，重算会话归属"
REASON_RECOVER_STRANDED = "原承载链路恢复可用，搁浅会话回迁"
REASON_REJECTED = "无可用链路容纳，自动迁移被拒绝，会话搁浅"
REASON_UNDO_EVACUATION = "同一时刻出现矛盾上报，撤销此前迁出（双方状态均保留）"
REASON_UNDO_RECOVERY = "同一时刻出现矛盾上报，撤销此前回迁（双方状态均保留）"


class LinkOrchestrator:
    def __init__(self, service_classes: Optional[List[str]] = None):
        self.links: "OrderedDict[str, Link]" = OrderedDict()
        self.sessions: "OrderedDict[str, Session]" = OrderedDict()
        self.reports: Dict[str, List[HealthReport]] = {}
        self._last_report_time: Dict[str, int] = {}
        self.migrations: List[MigrationRecord] = []
        self.conflicts: "OrderedDict[str, ConflictRecord]" = OrderedDict()
        self.events: List[EventEnvelope] = []

        self.clock = 0
        self._event_seq = 0
        self._migration_seq = 0
        self._conflict_seq = 0

        # 业务类别优先级：rank 越小越优先；按首次注册顺序登记。
        self.class_order: List[str] = []
        self.class_rank: Dict[str, int] = {}
        for name in service_classes or []:
            self.register_service_class(name)

    # ------------------------------------------------------------------ #
    # 基础维护：链路、业务类别、会话
    # ------------------------------------------------------------------ #
    def register_service_class(self, name: str) -> None:
        if not isinstance(name, str) or not name:
            raise ValidationError("业务类别名称必须是非空字符串", "service_classes")
        if name not in self.class_rank:
            self.class_rank[name] = len(self.class_order)
            self.class_order.append(name)
            self._append_event("class_registered", self.clock, {"name": name})

    def _rank(self, service_class: str) -> int:
        if service_class not in self.class_rank:
            self.register_service_class(service_class)
        return self.class_rank[service_class]

    def add_link(self, link_id: str, priority: int, bandwidth: int,
                 initially_available: bool = True,
                 time: Optional[int] = None) -> Link:
        if not isinstance(link_id, str) or not link_id:
            raise ValidationError("链路标识必须是非空字符串", "link.id")
        if link_id in self.links:
            raise DuplicateIdError("链路", link_id, f"links[{link_id}]")
        if isinstance(priority, bool) or not isinstance(priority, int):
            raise ValidationError("优先级必须是整数", f"links[{link_id}].priority")
        if isinstance(bandwidth, bool) or not isinstance(bandwidth, int) or bandwidth <= 0:
            raise ValidationError(
                f"带宽上限必须为正整数，收到 {bandwidth!r}",
                f"links[{link_id}].bandwidth",
            )
        t = self._tick(time)
        link = Link(id=link_id, priority=priority, bandwidth=bandwidth,
                    initially_available=initially_available, created_at=t)
        self.links[link_id] = link
        self.reports[link_id] = []
        self._append_event("link_added", t, {
            "id": link_id, "priority": priority, "bandwidth": bandwidth,
            "initially_available": initially_available, "created_at": t,
        })
        return link

    def add_session(self, session_id: str, service_class: str, bytes_sent: int,
                    initial_link: Optional[str] = None,
                    time: Optional[int] = None) -> MigrationRecord:
        """登记会话并完成初始放置。

        显式指定 initial_link 时，链路必须存在且当前可用、容量足够；
        不指定时按确定性选路放置。任何校验失败都抛异常且不留下半插入
        状态。所有可用链路都放不下时抛 CapacityExceededError 并给出
        各链路剩余容量。
        """
        if not isinstance(session_id, str) or not session_id:
            raise ValidationError("会话标识必须是非空字符串", "session.id")
        if session_id in self.sessions:
            raise DuplicateIdError("会话", session_id, f"sessions[{session_id}]")
        if not isinstance(service_class, str) or not service_class:
            raise ValidationError("业务类别必须是非空字符串",
                                  f"sessions[{session_id}].service_class")
        if isinstance(bytes_sent, bool) or not isinstance(bytes_sent, int) or bytes_sent < 0:
            raise ValidationError(
                f"已发送字节数必须是非负整数，收到 {bytes_sent!r}",
                f"sessions[{session_id}].bytes_sent",
            )
        if initial_link is not None and initial_link not in self.links:
            raise NotFoundError("链路", initial_link)

        # 先完成全部只读校验与目标选择，再改变任何状态，保证失败时
        # 不留下会话、事件、时钟或业务类别登记等任何痕迹。
        if initial_link is not None:
            self._ensure_available(initial_link, action="会话放置")
            self._ensure_fits(initial_link, bytes_sent, session_id)
            target = initial_link
        else:
            target = self._choose_link(bytes_sent)
            if target is None:
                raise CapacityExceededError(
                    None, 0, 0, bytes_sent, session_id,
                    free_table={lid: self.link_free(lid) for lid in self.available_links()},
                    action="会话放置",
                )

        t = self._tick(time)
        self._rank(service_class)  # 登记类别（产生事件），顺序可重放

        session = Session(id=session_id, service_class=service_class,
                          bytes_sent=bytes_sent, current_link=target, created_at=t)
        self.sessions[session_id] = session
        self._append_event("session_added", t, {
            "id": session_id, "service_class": service_class,
            "bytes_sent": bytes_sent, "initial_link": initial_link,
            "created_at": t,
        })
        return self._record_migration(t, session, None, target, REASON_INITIAL)

    def grow_bytes(self, session_id: str, delta: int) -> int:
        """会话新增已发送字节；会撑爆当前承载链路则拒绝并给出剩余容量。"""
        session = self._get_session(session_id)
        if isinstance(delta, bool) or not isinstance(delta, int) or delta < 0:
            raise ValidationError(
                f"增量字节必须是非负整数，收到 {delta!r}",
                f"sessions[{session_id}].bytes_sent",
            )
        carrier = session.current_link
        if carrier is not None and delta > self.link_free(carrier):
            raise CapacityExceededError(
                carrier, self.link_inflight(carrier), self.link_free(carrier),
                delta, session_id, action="字节增长")
        session.bytes_sent += delta
        self._append_event("bytes_grew", self.clock,
                           {"session_id": session_id, "delta": delta})
        return session.bytes_sent

    def migrate(self, session_id: str, to_link: str,
                time: Optional[int] = None, reason: str = "手动迁移") -> Optional[MigrationRecord]:
        """手动迁移：目标必须存在且当前可用、容量足够，否则拒绝并说明。"""
        session = self._get_session(session_id)
        if to_link not in self.links:
            raise NotFoundError("链路", to_link)
        self._ensure_available(to_link, action="迁移")
        frm = session.current_link
        if to_link == frm:
            return None  # 幂等空操作
        self._ensure_fits(to_link, session.bytes_sent, session_id, exclude_session=session_id)
        t = self._tick(time)
        session.current_link = to_link
        session.return_link = None  # 人工接管归属，恢复重算不再把它视作受影响会话
        self._append_event("manual_migration", t, {
            "session_id": session_id, "to_link": to_link, "reason": reason,
        })
        return self._record_migration(t, session, frm, to_link, reason)

    # ------------------------------------------------------------------ #
    # 健康上报
    # ------------------------------------------------------------------ #
    def report_health(self, link_id: str, time: int, available: bool,
                      source: str) -> Dict[str, Any]:
        """提交一条健康上报。

        返回 ``{"duplicate", "conflicts", "migrations", "stranded",
        "undone"}``：duplicate 表示幂等忽略；conflicts 为新生冲突；
        migrations 为本次触发的迁移；stranded 为放不下而被拒绝的会话
        （含各链路剩余容量）；undone 标记本次是否因同时刻矛盾而撤销
        了此前动作。
        """
        if link_id not in self.links:
            raise NotFoundError("链路", link_id)
        if isinstance(time, bool) or not isinstance(time, int) or time < 0:
            raise ValidationError("上报时刻必须是非负整数",
                                  f"links[{link_id}].reports.time")
        if not isinstance(source, str) or not source:
            raise ValidationError("上报来源必须是非空字符串",
                                  f"links[{link_id}].reports.source")
        available = bool(available)

        last = self._last_report_time.get(link_id)
        if last is not None and time < last:
            raise ClockRejectedError(link_id, time, last)

        bucket_location = f"links[{link_id}].reports[t={time}]"

        # 幂等 / 同来源同时刻改判检查
        for r in self.reports[link_id]:
            if r.time == time and r.source == source:
                if r.available == available:
                    return {"duplicate": True, "conflicts": [], "migrations": [],
                            "stranded": [], "undone": False}
                raise ValidationError(
                    f"同一来源 {source!r} 在同一时刻 t={time} 对链路 {link_id!r} "
                    f"提交了矛盾状态（已报 {r.available}，又报 {available}）",
                    bucket_location,
                )

        before = self.effective_status(link_id)
        prior_bucket = [r for r in self.reports[link_id] if r.time == time]
        # 冲突桶整体不可信：冲突时刻链路维持“严格更早时刻”所确定的状态。
        carried = self._carried_status_before(link_id, time)
        seq = self._next_event_seq()
        report = HealthReport(link_id=link_id, time=time, available=available,
                              source=source, seq=seq)
        self.reports[link_id].append(report)
        self._last_report_time[link_id] = time
        self.clock = max(self.clock, time)

        # 与同一时刻持相反状态的每个来源各生成一条可读冲突记录，双方均保留。
        new_conflicts: List[ConflictRecord] = []
        for r in self.reports[link_id]:
            if r.time == time and r.source != source and r.available != available:
                self._conflict_seq += 1
                rec = ConflictRecord(
                    id=f"C{self._conflict_seq:04d}", link_id=link_id, time=time,
                    source_a=r.source, available_a=r.available,
                    source_b=source, available_b=available,
                    effective_status=carried, created_seq=seq,
                )
                self.conflicts[rec.id] = rec
                new_conflicts.append(rec)

        self._append_event("health_report", time, {
            "link_id": link_id, "time": time, "available": available,
            "source": source,
        }, seq=seq)

        migrations: List[MigrationRecord] = []
        stranded: List[Dict[str, Any]] = []
        undone = False

        if new_conflicts and prior_bucket and not self._bucket_was_conflicted(prior_bucket):
            # 本上报让“此前一致的同时刻桶”首次变成冲突桶。若该桶的一致
            # 状态此前已触发过状态翻转，现在必须撤销，使结果等价于从未
            # 根据该冲突采取动作；撤销直接以迁移记录表为准，因此载入
            # 快照后行为完全一致，且天然跳过期间已被其他动作接管的会话。
            acted = prior_bucket[0].available
            carried = self._carried_status_before(link_id, time)
            if acted != carried:
                undone = True
                if acted is False:
                    # 先报“不可用”触发了迁出，现在矛盾 → 精确回迁。
                    migrations = self._undo_evacuation(link_id, time)
                else:
                    # 先报“恢复可用”触发了回迁，现在矛盾 → 当前承载者重新迁出。
                    migrations, stranded = self._undo_recovery(link_id, time)
        elif not new_conflicts:
            after = self.effective_status(link_id)
            if after != before:
                if before and not after:
                    migrations, stranded = self._evacuate(link_id, time)
                elif not before and after:
                    migrations = self._recover(link_id, time)

        return {"duplicate": False, "conflicts": new_conflicts,
                "migrations": migrations, "stranded": stranded, "undone": undone}

    def _undo_evacuation(self, link_id: str, t: int) -> List[MigrationRecord]:
        """撤销同刻“不可用”触发的迁出：按迁移记录把会话精确还原回原链路。

        只处理当前承载仍等于迁出目标（搁浅者仍搁浅）且 return_link 仍
        指向本链路的会话；期间被手动迁移等动作接管的会话不在回滚范围。
        若会话在此期间增大到原链路已容纳不下，则维持现状并保留回迁
        标记，等链路真正恢复时再重算——容量上限任何时候都不能突破。
        """
        out: List[MigrationRecord] = []
        touched = [m for m in self.migrations
                   if m.time == t and m.from_link == link_id
                   and m.reason in (REASON_EVACUATE, REASON_REJECTED)]
        for rec in touched:
            session = self.sessions.get(rec.session_id)
            if session is None or session.return_link != link_id:
                continue
            if rec.reason == REASON_EVACUATE:
                if session.current_link != rec.to_link:
                    continue
            elif session.current_link is not None:
                continue  # 原搁浅会话已被其他动作安置
            if self.link_free(link_id) < session.bytes_sent:
                continue  # 原链路此刻已放不下：维持现状，保留 return_link
            session.current_link = link_id
            session.return_link = None
            out.append(self._record_migration(
                t, session, rec.to_link, link_id, REASON_UNDO_EVACUATION))
        return out

    def _undo_recovery(self, link_id: str, t: int):
        """撤销同刻“恢复可用”触发的回迁：链路重新按失效处理。

        只有回迁动作放到本链路上的会话此刻承载于它，对这些当前承载者
        执行一次标准迁出即可；其他链路的会话完全不受影响。
        """
        return self._evacuate(link_id, t, reason=REASON_UNDO_RECOVERY)

    def resolve_conflict(self, conflict_id: str, resolution: str) -> ConflictRecord:
        """标记冲突已由人工裁决（只做记录，不伪造任何一方的上报）。"""
        if conflict_id not in self.conflicts:
            raise NotFoundError("冲突", conflict_id)
        if not isinstance(resolution, str) or not resolution:
            raise ValidationError("裁决说明必须是非空字符串",
                                  f"conflicts[{conflict_id}].resolution")
        rec = self.conflicts[conflict_id]
        rec.resolved = True
        rec.resolution = resolution
        self._append_event("conflict_resolved", self.clock,
                           {"conflict_id": conflict_id, "resolution": resolution})
        return rec

    @staticmethod
    def _bucket_was_conflicted(bucket: List[HealthReport]) -> bool:
        return any(r.available != bucket[0].available for r in bucket)

    def _carried_status_before(self, link_id: str, t: int) -> bool:
        """严格早于 t 的上报所确定的有效状态（用于冲突撤销判定）。"""
        current = self.links[link_id].initially_available
        buckets: Dict[int, "OrderedDict[str, bool]"] = OrderedDict()
        for r in self.reports[link_id]:
            if r.time < t:
                buckets.setdefault(r.time, OrderedDict())[r.source] = r.available
        for tt in sorted(buckets):
            opinions = list(buckets[tt].values())
            if all(v == opinions[0] for v in opinions):
                current = opinions[0]
        return current

    # ------------------------------------------------------------------ #
    # 状态推导与确定性选路
    # ------------------------------------------------------------------ #
    def effective_status(self, link_id: str, at_time: Optional[int] = None) -> bool:
        """链路在给定逻辑时刻（默认当前）的有效健康状态。

        逐时刻桶推进：桶内来源意见一致则采纳；桶内矛盾则维持上一状态，
        即保留双方、不静默择一。
        """
        if link_id not in self.links:
            raise NotFoundError("链路", link_id)
        current = self.links[link_id].initially_available
        buckets: Dict[int, "OrderedDict[str, bool]"] = OrderedDict()
        for r in self.reports[link_id]:
            if at_time is not None and r.time > at_time:
                continue
            buckets.setdefault(r.time, OrderedDict())[r.source] = r.available
        for t in sorted(buckets):
            opinions = list(buckets[t].values())
            if all(v == opinions[0] for v in opinions):
                current = opinions[0]
            # 矛盾桶：维持 current
        return current

    def available_links(self, at_time: Optional[int] = None) -> List[str]:
        """任意时刻的可用链路集合，按链路标识字典序稳定返回。"""
        return sorted(lid for lid in self.links
                      if self.effective_status(lid, at_time))

    def link_inflight(self, link_id: str) -> int:
        self._get_link(link_id)
        return sum(s.bytes_sent for s in self.sessions.values()
                   if s.current_link == link_id)

    def link_free(self, link_id: str) -> int:
        link = self._get_link(link_id)
        return link.bandwidth - self.link_inflight(link_id)

    def _ranking_key(self, link_id: str):
        link = self.links[link_id]
        return (link.priority, -self.link_free(link_id), link_id)

    def _choose_link(self, need: int, exclude: Optional[str] = None) -> Optional[str]:
        candidates = [
            lid for lid in self.available_links()
            if lid != exclude and self.link_free(lid) >= need
        ]
        if not candidates:
            return None
        return min(candidates, key=self._ranking_key)

    def _ensure_available(self, link_id: str, action: str = "迁移") -> None:
        if not self.effective_status(link_id):
            raise LinkUnavailableError(link_id, reason="当前不可用（已失效）", action=action)

    def _ensure_fits(self, link_id: str, need: int, session_id: str,
                     exclude_session: Optional[str] = None) -> None:
        inflight = sum(s.bytes_sent for s in self.sessions.values()
                       if s.current_link == link_id and s.id != exclude_session)
        free = self.links[link_id].bandwidth - inflight
        if need > free:
            raise CapacityExceededError(link_id, inflight, free, need, session_id)

    # ------------------------------------------------------------------ #
    # 故障迁出与恢复重算
    # ------------------------------------------------------------------ #
    def _ordered_session_ids(self, ids) -> List[str]:
        return sorted(ids, key=lambda sid: (self.class_rank[self.sessions[sid].service_class],
                                            sid))

    def _evacuate(self, failed_id: str, t: int,
                  reason: str = REASON_EVACUATE):
        """把失效链路上的会话按业务类别优先级迁出。

        放不下的单个会话不会拖垮其他会话：其迁移被拒绝（会话搁浅，
        不占用任何链路），拒绝记录携带各可用链路剩余容量，其他会话
        照常迁出。
        """
        migrations: List[MigrationRecord] = []
        stranded: List[Dict[str, Any]] = []
        victims = self._ordered_session_ids(
            sid for sid, s in self.sessions.items() if s.current_link == failed_id)
        for sid in victims:
            session = self.sessions[sid]
            target = self._choose_link(session.bytes_sent, exclude=failed_id)
            if target is None:
                free_table = {lid: self.link_free(lid)
                              for lid in self.available_links() if lid != failed_id}
                session.current_link = None
                session.return_link = failed_id
                rejection = {
                    "session_id": sid, "need": session.bytes_sent,
                    "max_free": max(free_table.values(), default=0),
                    "free_by_link": dict(sorted(free_table.items())),
                }
                stranded.append(rejection)
                self._append_event("session_stranded", t, {
                    "session_id": sid, "failed_link": failed_id,
                    "need": session.bytes_sent, "free_by_link": free_table,
                })
                self._record_migration(t, session, failed_id, None, REASON_REJECTED)
                continue
            session.current_link = target
            session.return_link = failed_id
            migrations.append(
                self._record_migration(t, session, failed_id, target, reason))
        return migrations, stranded

    def _recover(self, recovered_id: str, t: int,
                 reason_tied: Optional[str] = None,
                 reason_stranded: Optional[str] = None) -> List[MigrationRecord]:
        """只重算受恢复链路影响的会话（return_link 指向它的会话）。

        选路规则、处理顺序与事件日志从头重放完全相同；未受影响会话
        的承载链路不会改变。
        """
        reason_tied = reason_tied or REASON_RECOVER
        reason_stranded = reason_stranded or REASON_RECOVER_STRANDED
        migrations: List[MigrationRecord] = []
        affected = self._ordered_session_ids(
            sid for sid, s in self.sessions.items() if s.return_link == recovered_id)
        for sid in affected:
            session = self.sessions[sid]
            chosen = self._choose_link(session.bytes_sent)
            if chosen is None:
                continue  # 恢复链路自身可用，正常不会发生
            if chosen == session.current_link:
                session.return_link = None
                continue
            frm = session.current_link
            why = reason_stranded if frm is None else reason_tied
            session.current_link = chosen
            session.return_link = None
            migrations.append(self._record_migration(t, session, frm, chosen, why))
        return migrations

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #
    def get_carrier(self, session_id: str) -> Optional[str]:
        """任意会话的当前承载链路；None 表示搁浅（迁移被拒绝、暂无承载）。"""
        return self._get_session(session_id).current_link

    def get_trajectory(self, session_id: str) -> List[MigrationRecord]:
        """会话迁移轨迹，按迁移序号（即时间线）稳定返回。"""
        self._get_session(session_id)
        return [m for m in self.migrations if m.session_id == session_id]

    def get_link_load(self, link_id: str) -> Dict[str, Any]:
        """任意链路的在途字节、带宽上限与剩余容量。"""
        link = self._get_link(link_id)
        inflight = self.link_inflight(link_id)
        return {"link_id": link_id, "bandwidth": link.bandwidth,
                "inflight": inflight, "free": link.bandwidth - inflight,
                "available": self.effective_status(link_id)}

    def stranded_sessions(self) -> List[str]:
        return sorted(sid for sid, s in self.sessions.items() if s.current_link is None)

    def unresolved_conflicts(self) -> List[ConflictRecord]:
        """全部未解决冲突，按 (时刻, 链路, 创建序号, 标识) 稳定返回。"""
        return sorted((c for c in self.conflicts.values() if not c.resolved),
                      key=lambda c: (c.time, c.link_id, c.created_seq, c.id))

    def all_links(self) -> List[Link]:
        return [self.links[lid] for lid in sorted(self.links)]

    def all_sessions(self) -> List[Session]:
        return [self.sessions[sid] for sid in sorted(self.sessions)]

    # ------------------------------------------------------------------ #
    # 事件日志、重放与一致性校验
    # ------------------------------------------------------------------ #
    def replay(self) -> "LinkOrchestrator":
        """从事件日志从头重新编排，返回全新编排器（确定性可复现）。

        每处理一个动作事件，都把重放新生成的事件（健康上报可能派生
        若干 session_stranded 事件）与原日志对应位置逐字段比对，任何
        不一致都说明日志被损坏或编排不确定。
        """
        fresh = LinkOrchestrator()
        events = self.events
        i = 0
        while i < len(events):
            ev = events[i]
            d = ev.data
            kind = ev.kind
            pos = len(fresh.events)
            if kind == "class_registered":
                fresh.register_service_class(d["name"])
            elif kind == "link_added":
                fresh.add_link(d["id"], d["priority"], d["bandwidth"],
                               d.get("initially_available", True), d.get("created_at", 0))
            elif kind == "session_added":
                fresh.add_session(d["id"], d["service_class"], d["bytes_sent"],
                                  d.get("initial_link"), d.get("created_at", 0))
            elif kind == "bytes_grew":
                fresh.grow_bytes(d["session_id"], d["delta"])
            elif kind == "health_report":
                fresh.report_health(d["link_id"], d["time"], d["available"], d["source"])
            elif kind == "manual_migration":
                fresh.migrate(d["session_id"], d["to_link"], ev.time, d["reason"])
            elif kind == "conflict_resolved":
                fresh.resolve_conflict(d["conflict_id"], d["resolution"])
            elif kind == "session_stranded":
                raise PersistenceError(
                    f"事件日志非法：session_stranded 是健康上报的派生事件，"
                    f"不能脱离触发它的上报单独存在（seq={ev.seq}，"
                    f"会话 {d.get('session_id')!r}）")
            else:
                raise PersistenceError(
                    f"事件日志包含未知事件类型 {kind!r}（seq={ev.seq}）")

            produced = [e.to_dict() for e in fresh.events[pos:]]
            expected = [e.to_dict() for e in events[i:i + len(produced)]]
            if produced != expected:
                raise PersistenceError(
                    f"事件重放不确定：seq={ev.seq} 的 {kind} 重放出的事件流与日志不一致\n"
                    f"  日志: {expected}\n  重放: {produced}")
            i += len(produced)
        return fresh

    def verify_consistency(self) -> None:
        """断言增量编排结果与事件日志从头重放完全一致，否则抛 AssertionError。"""
        ref = self.replay()
        a, b = self._state_signature(), ref._state_signature()
        if a != b:
            diffs = []
            for key in sorted(set(a) | set(b)):
                if a.get(key) != b.get(key):
                    diffs.append(f"  - {key}:\n      增量: {a.get(key)}\n      重放: {b.get(key)}")
            raise AssertionError("增量编排与从头重放不一致：\n" + "\n".join(diffs))

    def _state_signature(self) -> Dict[str, Any]:
        return {
            "clock": self.clock,
            "links": [(l.id, l.priority, l.bandwidth, l.initially_available)
                      for l in self.all_links()],
            "sessions": [(s.id, s.service_class, s.bytes_sent,
                          s.current_link, s.return_link) for s in self.all_sessions()],
            "reports": [(r.link_id, r.time, r.available, r.source, r.seq)
                        for lid in sorted(self.reports) for r in self.reports[lid]],
            "migrations": [(m.seq, m.time, m.session_id, m.from_link, m.to_link,
                            m.reason, m.bytes_sent) for m in self.migrations],
            "conflicts": [(c.id, c.link_id, c.time, c.source_a, c.available_a,
                           c.source_b, c.available_b, c.effective_status,
                           c.resolved, c.resolution)
                          for cid in sorted(self.conflicts)
                          for c in [self.conflicts[cid]]],
            "class_order": list(self.class_order),
        }

    # ------------------------------------------------------------------ #
    # 内部小工具
    # ------------------------------------------------------------------ #
    def _get_link(self, link_id: str) -> Link:
        if link_id not in self.links:
            raise NotFoundError("链路", link_id)
        return self.links[link_id]

    def _get_session(self, session_id: str) -> Session:
        if session_id not in self.sessions:
            raise NotFoundError("会话", session_id)
        return self.sessions[session_id]

    def _tick(self, time: Optional[int]) -> int:
        if time is None:
            return self.clock
        if isinstance(time, bool) or not isinstance(time, int) or time < 0:
            raise ValidationError("逻辑时刻必须是非负整数", "time")
        self.clock = max(self.clock, time)
        return time

    def _next_event_seq(self) -> int:
        self._event_seq += 1
        return self._event_seq

    def _append_event(self, kind: str, time: int, data: Dict[str, Any],
                      seq: Optional[int] = None) -> EventEnvelope:
        if seq is None:
            seq = self._next_event_seq()
        else:
            self._event_seq = max(self._event_seq, seq)
        ev = EventEnvelope(seq=seq, kind=kind, time=time, data=data)
        self.events.append(ev)
        self.clock = max(self.clock, time)
        return ev

    def _record_migration(self, t: int, session: Session,
                          frm: Optional[str], to: Optional[str],
                          reason: str) -> MigrationRecord:
        self._migration_seq += 1
        rec = MigrationRecord(
            seq=self._migration_seq, time=t, session_id=session.id,
            service_class=session.service_class, from_link=frm, to_link=to,
            reason=reason, bytes_sent=session.bytes_sent)
        self.migrations.append(rec)
        return rec
