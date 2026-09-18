"""验收测试：逐条覆盖需求 1-8。"""

import math

import pytest

from eventagg import (
    DuplicateGroupError,
    Event,
    EventTimeEngine,
    IngestStatus,
    ManualClock,
    UnknownDomainError,
    UnknownEventError,
    UnknownGroupError,
    ValidationError,
)


def make_engine(**kwargs):
    clock = kwargs.pop("clock", ManualClock())
    engine = EventTimeEngine(window_size=10, allowed_lateness=5, clock=clock)
    engine.register_domain("sales")
    engine.register_domain("ops")
    engine.register_group("g1", "sales")
    engine.register_group("g2", "ops")
    return engine


def ev(event_id, group="g1", et=0, arr=None, value=1.0, source="A"):
    return Event(
        event_id=event_id,
        group_id=group,
        event_time=et,
        arrival_time=et if arr is None else arr,
        value=value,
        source=source,
    )


# ---------------------------------------------------------------- 需求 1

def test_register_group_ok():
    engine = make_engine()
    engine.register_group("g3", "sales")
    assert engine.watermark("g3") is None


def test_duplicate_group_id_rejected_with_location():
    engine = make_engine()
    with pytest.raises(DuplicateGroupError) as exc:
        engine.register_group("g1", "ops")
    assert "g1" in str(exc.value)
    assert "register_group" in exc.value.location


def test_unregistered_domain_rejected_with_location():
    engine = make_engine()
    with pytest.raises(UnknownDomainError) as exc:
        engine.register_group("g9", "no-such-domain")
    assert exc.value.domain_id == "no-such-domain"
    assert "register_group" in exc.value.location


# ---------------------------------------------------------------- 需求 2

def test_event_time_after_arrival_rejected():
    engine = make_engine()
    with pytest.raises(ValidationError) as exc:
        engine.ingest(ev("e1", et=100, arr=99))
    assert exc.value.field == "event_time"
    assert "e1" in exc.value.location


@pytest.mark.parametrize("bad_value", ["abc", None, float("nan"), float("inf"), True, [1]])
def test_non_numeric_value_rejected_with_reason(bad_value):
    engine = make_engine()
    with pytest.raises(ValidationError) as exc:
        engine.ingest(ev("e1", et=1, value=bad_value))
    assert exc.value.field == "value"
    assert "数值" in str(exc.value)


def test_ingest_into_unknown_group_rejected():
    engine = make_engine()
    with pytest.raises(UnknownGroupError):
        engine.ingest(ev("e1", group="ghost", et=1))


# ---------------------------------------------------------------- 需求 3

def test_window_assignment_derived_from_event_time():
    engine = make_engine()
    engine.ingest(ev("e1", et=7, value=1.0))
    engine.ingest(ev("e2", et=13, value=2.0))
    engine.ingest(ev("e3", et=-1, value=4.0))
    stats = engine.window_stats("g1")
    assert set(stats) == {0, 10, -10}
    assert stats[0].total == 1.0
    assert stats[10].total == 2.0
    assert stats[-10].total == 4.0


def test_duplicate_event_idempotent():
    engine = make_engine()
    r1 = engine.ingest(ev("e1", et=3, value=2.0))
    r2 = engine.ingest(ev("e1", et=3, value=2.0))            # 完全相同
    r3 = engine.ingest(ev("e1", et=3, value=2.0, source="B"))  # 不同来源、相同事实
    assert r1.status is IngestStatus.ACCEPTED
    assert r2.status is IngestStatus.DUPLICATE
    assert r3.status is IngestStatus.DUPLICATE
    stats = engine.window_stats("g1")
    assert stats[0].count == 1
    assert stats[0].total == 2.0
    assert engine.conflicts() == []


# ---------------------------------------------------------------- 需求 4

def test_late_event_marked_with_exact_excess_and_still_counted():
    engine = make_engine()
    engine.ingest(ev("e1", et=100, arr=100))          # 水位线 -> 100，允许到 105
    result = engine.ingest(ev("e2", et=90, arr=110))  # 110 > 105，超出 5
    assert result.status is IngestStatus.LATE
    assert result.late is True
    assert result.lateness_excess == 5
    assert "迟到" in result.message
    # 不静默丢弃：计入窗口 90 的统计
    stats = engine.window_stats("g1")
    assert stats[90].count == 1
    assert stats[90].late_count == 1


def test_lateness_boundary_is_on_time():
    engine = make_engine()
    engine.ingest(ev("e1", et=100, arr=100))
    # 到达时间恰好等于 水位线 + 允许范围 -> 不迟到
    result = engine.ingest(ev("e2", et=95, arr=105))
    assert result.status is IngestStatus.ACCEPTED
    assert result.late is False


def test_first_event_never_late():
    engine = make_engine()
    result = engine.ingest(ev("e1", et=0, arr=10_000))
    assert result.status is IngestStatus.ACCEPTED


# ---------------------------------------------------------------- 需求 5

def test_watermark_advances_per_group_independently():
    engine = make_engine()
    engine.ingest(ev("e1", group="g1", et=50))
    engine.ingest(ev("e2", group="g2", et=20))
    engine.ingest(ev("e3", group="g1", et=40))  # 不推进
    assert engine.watermark("g1") == 50
    assert engine.watermark("g2") == 20


def test_incremental_state_equals_full_recompute_after_every_event():
    engine = make_engine()
    events = [
        ev("e1", et=100, arr=100, value=1.0),
        ev("e2", et=103, arr=104, value=2.0),
        ev("e3", et=95, arr=110, value=4.0),    # 迟到
        ev("e4", et=101, arr=102, value=8.0),
        ev("e5", et=20, arr=200, value=16.0),   # 极度迟到
        ev("e6", group="g2", et=7, arr=7, value=32.0),
    ]
    for event in events:
        engine.ingest(event)
        for group in ("g1", "g2"):
            live = engine.snapshot(group)
            full = engine.recompute_from_scratch(group)
            assert live.watermark == full.watermark
            assert live.windows == full.windows


# ---------------------------------------------------------------- 需求 6

def test_conflicting_versions_kept_and_readable_record():
    engine = make_engine()
    engine.ingest(ev("e1", et=100, value=1.0, source="sensor-A"))
    result = engine.ingest(ev("e1", et=100, value=9.0, source="sensor-B"))
    assert result.status is IngestStatus.CONFLICT

    conflicts = engine.conflicts("g1")
    assert len(conflicts) == 1
    record = conflicts[0]
    # 双方都被保留
    assert {v.source for v in record.versions} == {"sensor-A", "sensor-B"}
    assert {v.value for v in record.versions} == {1.0, 9.0}
    # 可读记录指出事件、双方来源与各自取值
    text = str(record)
    assert "e1" in text and "sensor-A" in text and "sensor-B" in text
    assert "1.0" in text and "9.0" in text
    # 先到生效：统计未被矛盾版本污染
    assert engine.window_stats("g1")[100].total == 1.0


def test_conflicting_event_time_kept_out_of_stats_until_resolved():
    engine = make_engine()
    engine.ingest(ev("e1", et=103, value=1.0, source="A"))
    engine.ingest(ev("e1", et=95, value=1.0, source="B"))  # 事件时间矛盾
    stats = engine.window_stats("g1")
    assert set(stats) == {100}
    assert stats[100].count == 1


# ---------------------------------------------------------------- 需求 7

def test_query_window_details_watermark_and_correction_trail():
    clock = ManualClock(start=1000)
    engine = make_engine(clock=clock)
    engine.ingest(ev("e1", et=100, arr=100, value=1.0))
    engine.ingest(ev("e2", et=102, arr=103, value=2.0))
    clock.set(2000)
    engine.ingest(ev("e3", et=95, arr=110, value=4.0))  # 迟到，超出 110-(102+5)=3

    # 窗口统计值
    stats = engine.window_stats("g1")
    assert stats[100].count == 2 and stats[100].total == 3.0
    assert stats[100].mean == 1.5
    assert stats[90].late_count == 1

    # 窗口内事件明细
    entries = engine.window_events("g1", 90)
    assert len(entries) == 1
    assert entries[0].event.event_id == "e3"
    assert entries[0].late is True
    assert entries[0].lateness_excess == 3

    # 水位线位置
    assert engine.watermark("g1") == 102

    # 迟到修正轨迹：before -> after，时间戳来自注入时钟
    corrections = engine.corrections("g1")
    assert len(corrections) == 1
    c = corrections[0]
    assert c.reason == "late-event" and c.event_id == "e3"
    assert c.window_start == 90
    assert c.before is None  # 窗口 90 此前不存在
    assert c.after.count == 1 and c.after.total == 4.0
    assert c.lateness_excess == 3
    assert c.recorded_at == 2000


def test_snapshot_as_of_replays_arrival_order():
    engine = make_engine()
    engine.ingest(ev("e1", et=100, arr=100, value=1.0))
    engine.ingest(ev("e2", et=90, arr=110, value=2.0))  # 迟到事件
    snap = engine.snapshot_as_of("g1", 105)
    assert 90 not in snap.windows
    assert snap.windows[100].count == 1
    assert snap.watermark == 100
    assert engine.snapshot_as_of("g1", 110).windows[90].count == 1


def test_queries_on_unknown_group_rejected():
    engine = make_engine()
    with pytest.raises(UnknownGroupError):
        engine.window_stats("ghost")


# ---------------------------------------------------------------- 需求 8

def test_unaffected_windows_unchanged_after_late_arrival():
    engine = make_engine()
    engine.ingest(ev("e1", et=100, arr=100, value=1.0))
    engine.ingest(ev("e2", et=103, arr=104, value=2.0))
    before = engine.window_stats("g1")
    engine.ingest(ev("e3", et=95, arr=110, value=4.0))  # 迟到，只影响窗口 90
    after = engine.window_stats("g1")
    assert after[100] == before[100]  # 未受影响窗口完全不变
    assert after[90].total == 4.0
    assert after == engine.recompute_from_scratch("g1").windows


def test_conflict_resolution_recomputes_affected_and_matches_full():
    engine = make_engine()
    engine.ingest(ev("e1", et=103, arr=103, value=1.0, source="A"))
    engine.ingest(ev("e2", et=108, arr=108, value=2.0, source="A"))
    engine.ingest(ev("e1", et=95, arr=109, value=5.0, source="B"))  # 冲突版本
    before = engine.window_stats("g1")

    result = engine.resolve_conflict("e1", "B")
    assert result.window_start == 90
    after = engine.window_stats("g1")

    # 受影响：窗口 100 失去 e1(1.0)，窗口 90 获得 e1(5.0)
    assert after[100].count == 1 and after[100].total == 2.0
    assert after[90].count == 1 and after[90].total == 5.0
    # 与从头全量重算完全一致
    assert after == engine.recompute_from_scratch("g1").windows
    # 修正轨迹记录了 before -> after
    corrections = [c for c in engine.corrections("g1") if c.reason == "conflict-resolution"]
    assert {c.window_start for c in corrections} == {90, 100}
    c100 = next(c for c in corrections if c.window_start == 100)
    assert c100.before.total == before[100].total
    assert c100.after.total == after[100].total


def test_resolve_conflict_with_unknown_source_or_event_rejected():
    engine = make_engine()
    engine.ingest(ev("e1", et=1, value=1.0, source="A"))
    with pytest.raises(ValidationError):
        engine.resolve_conflict("e1", "nobody")
    with pytest.raises(UnknownEventError):
        engine.resolve_conflict("ghost", "A")


def test_watermark_path_change_on_resolution_stays_consistent():
    # 解决冲突改变事件时间 -> 水位线推进路径改变 -> 后续事件迟到标记随之变化，
    # 引擎状态仍必须与全量重算一致。
    engine = make_engine()
    engine.ingest(ev("e1", et=200, arr=200, value=1.0, source="A"))
    engine.ingest(ev("e2", et=150, arr=201, value=2.0))   # 准时（201 <= 205）
    engine.ingest(ev("e1", et=100, arr=202, value=1.0, source="B"))  # 冲突
    engine.resolve_conflict("e1", "B")  # e1 事件时间 200 -> 100，水位线路径改变
    live = engine.snapshot("g1")
    full = engine.recompute_from_scratch("g1")
    assert live.watermark == full.watermark
    assert live.windows == full.windows
