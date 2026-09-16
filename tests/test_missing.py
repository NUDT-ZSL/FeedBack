"""需求 5：连续多周期未上报标记为数据缺失，缺失区间明确列出且不按零值判定。"""
from emission_monitor import MonitoringSystem, Reading, ThresholdSegment


def make_system():
    s = MonitoringSystem()
    s.add_source("stack-1", park="东区", metric_type="SO2", period=10,
                 max_missed_periods=1)  # 连续缺失 >=2 个周期才标记
    s.set_baseline("stack-1", [(0, 100.0), (1000, 100.0)])
    s.set_thresholds("stack-1", [ThresholdSegment(0, None, tolerance=5.0, max_jump=10.0)])
    return s


def test_missing_interval_listed_explicitly():
    s = make_system()
    # 时刻 0 上报后直接跳到 50：缺失 10、20、30、40 共 4 个周期
    s.ingest([Reading("stack-1", 0, 100.0), Reading("stack-1", 50, 100.0)])
    intervals = s.missing_intervals("stack-1")
    assert len(intervals) == 1
    iv = intervals[0]
    assert iv.missing_times == (10, 20, 30, 40)
    assert iv.start == 10 and iv.end == 40 and iv.count == 4
    assert "10~40" in iv.describe()


def test_short_gap_below_threshold_not_marked():
    s = make_system()
    s.ingest([Reading("stack-1", 0, 100.0), Reading("stack-1", 20, 100.0)])  # 只缺 1 个周期
    assert s.missing_intervals("stack-1") == []


def test_missing_not_treated_as_zero():
    s = make_system()
    # 若缺失被当作 0，则 0 与基线 100 偏离 100，必然产生 deviation 异常
    s.ingest([Reading("stack-1", 0, 100.0), Reading("stack-1", 50, 100.0)])
    assert s.anomalies("stack-1") == []


def test_no_jump_judgement_across_missing_gap():
    s = make_system()
    # 缺失区间两侧数值差异很大，但中间无连续观测，不做跳变判定
    s.ingest([Reading("stack-1", 0, 100.0), Reading("stack-1", 50, 200.0)])
    jumps = [a for a in s.anomalies("stack-1") if a.kind == "jump"]
    assert jumps == []


def test_multiple_missing_intervals():
    s = make_system()
    s.ingest([Reading("stack-1", 0, 100.0), Reading("stack-1", 40, 100.0),
              Reading("stack-1", 50, 100.0), Reading("stack-1", 90, 100.0)])
    intervals = s.missing_intervals("stack-1")
    assert [iv.missing_times for iv in intervals] == [(10, 20, 30), (60, 70, 80)]
