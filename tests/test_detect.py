"""需求 3、4：基线 + 分段阈值配置；偏离 / 跳变 / 越界判定并给出依据。"""
import pytest

from emission_monitor import MonitoringSystem, Reading, ThresholdSegment


def make_system():
    s = MonitoringSystem()
    s.add_source("stack-1", park="东区", metric_type="SO2", period=1)
    s.set_baseline("stack-1", [(0, 100.0), (10, 100.0)])  # 恒定基线 100
    return s


def test_overlapping_threshold_segments_rejected():
    s = make_system()
    with pytest.raises(ValueError, match="最多一个生效阈值"):
        s.set_thresholds("stack-1", [
            ThresholdSegment(0, 10, tolerance=5),
            ThresholdSegment(5, 15, tolerance=8),  # 与上一段在 5~9 重叠
        ])
    with pytest.raises(ValueError, match="最多一个生效阈值"):
        s.set_thresholds("stack-1", [
            ThresholdSegment(0, None, tolerance=5),   # 无限延伸
            ThresholdSegment(100, 200, tolerance=8),
        ])


def test_deviation_from_baseline_with_evidence():
    s = make_system()
    s.set_thresholds("stack-1", [ThresholdSegment(0, None, tolerance=5.0)])
    s.ingest([Reading("stack-1", 0, 101.0),   # 正常
              Reading("stack-1", 1, 108.0)])  # 偏离 8 > 5
    anomalies = s.anomalies("stack-1")
    assert len(anomalies) == 1
    a = anomalies[0]
    assert a.kind == "deviation" and a.time == 1
    assert a.evidence == {"baseline": 100.0, "tolerance": 5.0, "deviation": 8.0}
    assert "偏离基线" in a.reason and "容差" in a.reason
    assert a.severity == pytest.approx(8.0 / 5.0)


def test_sudden_jump_with_evidence():
    s = make_system()
    s.set_thresholds("stack-1", [ThresholdSegment(0, None, tolerance=50.0, max_jump=3.0)])
    s.ingest([Reading("stack-1", 0, 100.0),
              Reading("stack-1", 1, 102.0),   # 跳变 2，正常
              Reading("stack-1", 2, 110.0)])  # 跳变 8 > 3
    jumps = [a for a in s.anomalies("stack-1") if a.kind == "jump"]
    assert len(jumps) == 1
    a = jumps[0]
    assert a.time == 2
    assert a.evidence["prev_time"] == 1 and a.evidence["prev_value"] == 102.0
    assert a.evidence["delta"] == 8.0 and a.evidence["max_jump"] == 3.0
    assert "跳变" in a.reason


def test_out_of_bounds_with_evidence():
    s = make_system()
    s.set_thresholds("stack-1", [ThresholdSegment(0, None, lower=90.0, upper=120.0)])
    s.ingest([Reading("stack-1", 0, 100.0),
              Reading("stack-1", 1, 125.0),   # 越上限
              Reading("stack-1", 2, 85.0)])   # 越下限
    bounds = [a for a in s.anomalies("stack-1") if a.kind == "out_of_bounds"]
    assert [(a.time, a.evidence["side"], a.evidence["bound"]) for a in bounds] == [
        (1, "upper", 120.0), (2, "lower", 90.0)]
    assert "上限" in bounds[0].reason and "下限" in bounds[1].reason


def test_threshold_segments_switch_by_logical_time():
    """同一读数在不同时段按不同阈值判定。"""
    s = make_system()
    s.set_thresholds("stack-1", [
        ThresholdSegment(0, 10, tolerance=20.0),   # 检修期放宽
        ThresholdSegment(10, None, tolerance=2.0),  # 正常运行收紧
    ])
    s.ingest([Reading("stack-1", 5, 110.0),    # 偏离 10 < 20，正常
              Reading("stack-1", 10, 110.0)])  # 偏离 10 > 2，异常
    anomalies = s.anomalies("stack-1")
    assert [a.time for a in anomalies] == [10]


def test_no_threshold_means_no_judgement():
    s = make_system()
    s.ingest([Reading("stack-1", 0, 999.0)])
    assert s.anomalies("stack-1") == []


def test_baseline_curve_interpolates():
    s = MonitoringSystem()
    s.add_source("drain-1", park="西区", metric_type="COD")
    s.set_baseline("drain-1", [(0, 10.0), (10, 20.0)])  # 每时刻 +1
    s.set_thresholds("drain-1", [ThresholdSegment(0, None, tolerance=0.5)])
    s.ingest([Reading("drain-1", 5, 15.2),   # 基线 15，偏离 0.2，正常
              Reading("drain-1", 6, 20.0)])  # 基线 16，偏离 4，异常
    anomalies = s.anomalies("drain-1")
    assert len(anomalies) == 1 and anomalies[0].time == 6
    assert anomalies[0].evidence["baseline"] == pytest.approx(16.0)
