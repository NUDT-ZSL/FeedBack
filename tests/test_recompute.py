"""需求 8：阈值调整 / 基线修正只重算受影响时段与来源，且与从头重判完全一致。"""
from emission_monitor import MonitoringSystem, Reading, ThresholdSegment


def make_system(values=None, period=1):
    s = MonitoringSystem()
    s.add_source("stack-1", park="东区", metric_type="SO2", period=period)
    s.add_source("stack-2", park="东区", metric_type="SO2", period=period)
    for sid in ("stack-1", "stack-2"):
        s.set_baseline(sid, [(0, 100.0), (1000, 100.0)])
        s.set_thresholds(sid, [ThresholdSegment(0, None, tolerance=5.0, max_jump=50.0)])
    vals = values if values is not None else [100.0] * 21
    for t, v in enumerate(vals):
        s.ingest([Reading("stack-1", t, v), Reading("stack-2", t, v)])
    s.source("stack-1").recompute_log.clear()
    s.source("stack-2").recompute_log.clear()
    return s


def test_threshold_change_recomputes_only_affected_range():
    vals = [100.0] * 21
    vals[5], vals[12] = 120.0, 130.0  # 两处偏离
    s = make_system(vals)
    before = {a.time: a for a in s.anomalies("stack-1")}
    assert set(before) == {5, 12}

    # 只把 [10, 20) 的容差放宽到 50，其余时段不变
    s.set_thresholds("stack-1", [
        ThresholdSegment(0, 10, tolerance=5.0, max_jump=50.0),
        ThresholdSegment(10, 20, tolerance=50.0, max_jump=50.0),
        ThresholdSegment(20, None, tolerance=5.0, max_jump=50.0),
    ])

    st = s.source("stack-1")
    assert st.recompute_log == [(10, 19)]          # 只重算了受影响时段
    after = s.anomalies("stack-1")
    assert [a.time for a in after] == [5]          # 时刻 12 的异常被消除
    assert after[0] is before[5]                   # 区间外的判定原样保留（未重算）
    assert s.is_consistent("stack-1")
    assert s.anomalies("stack-1") == s.recompute_all("stack-1")


def test_threshold_change_does_not_touch_other_sources():
    s = make_system()
    s.set_thresholds("stack-1", [ThresholdSegment(0, None, tolerance=1.0)])
    assert s.source("stack-2").recompute_log == []  # 其他来源不受影响
    assert s.is_consistent("stack-2")


def test_baseline_correction_recomputes_only_affected_span():
    vals = [100.0] * 101
    vals[50] = 200.0  # 旧基线下偏离 100，是异常
    s = make_system(vals)
    assert any(a.time == 50 and a.kind == "deviation" for a in s.anomalies("stack-1"))

    # 把基线在时刻 50 处修正为 200：只有相邻点之间的时段受影响
    s.set_baseline("stack-1", [(0, 100.0), (50, 200.0), (100, 100.0), (1000, 100.0)])
    st = s.source("stack-1")
    assert st.recompute_log == [(0, 100)]  # 覆盖基线实际变化的时段（端点保守并入）
    # 修正后时刻 50 的偏离异常被消除（跳变异常与基线无关，不受影响）
    assert all(not (a.time == 50 and a.kind == "deviation")
               for a in s.anomalies("stack-1"))
    assert s.is_consistent("stack-1")
    assert s.anomalies("stack-1") == s.recompute_all("stack-1")


def test_baseline_tail_change_extends_to_infinity():
    s = make_system()
    s.set_baseline("stack-1", [(0, 100.0), (1000, 120.0)])  # 末点被修正
    lo, hi = s.source("stack-1").recompute_log[-1]
    assert hi is None  # 尾端变化影响其后所有时刻
    assert s.is_consistent("stack-1")


def test_repeated_changes_and_ingestion_stay_consistent():
    vals = [100.0, 100.0, 100.0, 160.0, 100.0] + [100.0] * 16
    s = make_system(vals)
    # 多次调整阈值与基线，并穿插新读数上报
    s.set_thresholds("stack-1", [ThresholdSegment(0, None, tolerance=2.0, max_jump=10.0)])
    s.set_baseline("stack-1", [(0, 100.0), (10, 110.0), (20, 100.0), (1000, 100.0)])
    s.ingest([Reading("stack-1", 21, 105.0), Reading("stack-1", 22, 180.0)])
    s.set_thresholds("stack-1", [
        ThresholdSegment(0, 15, tolerance=2.0, max_jump=10.0),
        ThresholdSegment(15, None, tolerance=1.0, max_jump=5.0),
    ])
    assert s.is_consistent("stack-1")
    assert s.anomalies("stack-1") == s.recompute_all("stack-1")


def test_jump_recomputation_consistent_across_range_boundary():
    """跳变异常依赖上一条读数：区间边界处的重算也必须与全量一致。"""
    vals = [100.0] * 21
    vals[10], vals[11] = 100.0, 170.0  # 时刻 11 相对 10 跳变 70
    s = make_system(vals)
    # 调整 [11, 20) 的 max_jump：时刻 11 的跳变判定依赖区间外的时刻 10
    s.set_thresholds("stack-1", [
        ThresholdSegment(0, 11, tolerance=5.0, max_jump=50.0),
        ThresholdSegment(11, 20, tolerance=5.0, max_jump=200.0),
        ThresholdSegment(20, None, tolerance=5.0, max_jump=50.0),
    ])
    assert s.source("stack-1").recompute_log == [(11, 19)]
    jumps = [a for a in s.anomalies("stack-1") if a.kind == "jump"]
    assert jumps == []  # 新阈值下 70 < 200，跳变异常消除
    assert s.is_consistent("stack-1")
    assert s.anomalies("stack-1") == s.recompute_all("stack-1")
