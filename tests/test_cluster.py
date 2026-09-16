"""需求 6：同时段多来源异常按园区 + 指标聚类，指出可能同源并给出贡献占比。"""
import pytest

from emission_monitor import MonitoringSystem, Reading, ThresholdSegment


def make_system():
    s = MonitoringSystem()
    for sid, park, metric in [("stack-1", "东区", "SO2"),
                              ("stack-2", "东区", "SO2"),
                              ("drain-1", "东区", "COD"),
                              ("stack-9", "西区", "SO2")]:
        s.add_source(sid, park=park, metric_type=metric)
        s.set_baseline(sid, [(0, 100.0), (1000, 100.0)])
        s.set_thresholds(sid, [ThresholdSegment(0, None, tolerance=5.0)])
    return s


def test_cluster_with_contribution_shares():
    s = make_system()
    # stack-1 在时刻 100 偏离 40（严重度 8），stack-2 在时刻 102 偏离 10（严重度 2）
    s.ingest([Reading("stack-1", 100, 140.0),
              Reading("stack-2", 102, 110.0)])
    clusters = s.clusters(window=5)
    assert len(clusters) == 1
    c = clusters[0]
    assert c.park == "东区" and c.metric_type == "SO2"
    assert c.start == 100 and c.end == 102
    assert c.contributions["stack-1"] == pytest.approx(0.8)
    assert c.contributions["stack-2"] == pytest.approx(0.2)
    assert sum(c.contributions.values()) == pytest.approx(1.0)
    assert "同源" in c.describe()


def test_different_park_or_metric_not_clustered_together():
    s = make_system()
    s.ingest([Reading("stack-1", 100, 140.0),   # 东区 SO2
              Reading("stack-2", 101, 130.0),   # 东区 SO2 -> 与 stack-1 同簇
              Reading("drain-1", 101, 150.0),   # 东区 COD -> 指标不同，单独来源不成簇
              Reading("stack-9", 101, 160.0)])  # 西区 SO2 -> 园区不同，单独来源不成簇
    clusters = s.clusters(window=5)
    assert len(clusters) == 1
    assert set(clusters[0].contributions) == {"stack-1", "stack-2"}


def test_single_source_not_a_cluster():
    s = make_system()
    s.ingest([Reading("stack-1", 100, 140.0), Reading("stack-1", 101, 145.0)])
    assert s.clusters(window=5) == []


def test_window_splits_episodes():
    s = make_system()
    # stack-1 与 stack-2 在 100 附近同时异常；stack-1 与 stack-9 无关；
    # 200 时刻只有 stack-1 自己异常 -> 不成簇
    s.ingest([Reading("stack-1", 100, 140.0), Reading("stack-2", 103, 130.0),
              Reading("stack-1", 200, 150.0)])
    clusters = s.clusters(window=5)
    assert len(clusters) == 1
    assert clusters[0].end == 103
