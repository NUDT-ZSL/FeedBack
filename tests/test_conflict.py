"""需求 7：多通道矛盾数值——双方保留并生成可读冲突记录。"""
from emission_monitor import MonitoringSystem, Reading, ThresholdSegment


def make_system():
    s = MonitoringSystem()
    s.add_source("stack-1", park="东区", metric_type="SO2")
    s.set_baseline("stack-1", [(0, 100.0), (100, 100.0)])
    s.set_thresholds("stack-1", [ThresholdSegment(0, None, tolerance=5.0)])
    return s


def test_conflicting_values_both_kept_and_recorded():
    s = make_system()
    results = s.ingest([Reading("stack-1", 10, 100.0, channel="plc"),
                        Reading("stack-1", 10, 130.0, channel="gateway")])
    assert [r.status for r in results] == ["accepted", "conflict"]

    kept = [(r.channel, r.value) for r in s.readings("stack-1")]
    assert kept == [("gateway", 130.0), ("plc", 100.0)]  # 双方均保留

    (record,) = s.conflicts("stack-1")
    assert record.time == 10
    assert record.entries == (("plc", 100.0), ("gateway", 130.0))
    text = record.describe()
    assert "时刻 10" in text and "plc" in text and "gateway" in text
    assert "100" in text and "130" in text


def test_conflict_values_judged_individually():
    s = make_system()
    s.ingest([Reading("stack-1", 10, 100.0, channel="plc"),      # 正常值
              Reading("stack-1", 10, 130.0, channel="gateway")])  # 偏离 30 > 5
    anomalies = s.anomalies("stack-1")
    assert len(anomalies) == 1
    assert anomalies[0].channel == "gateway" and anomalies[0].value == 130.0


def test_third_channel_extends_conflict_record():
    s = make_system()
    s.ingest([Reading("stack-1", 10, 100.0, channel="a"),
              Reading("stack-1", 10, 130.0, channel="b"),
              Reading("stack-1", 10, 145.0, channel="c")])
    (record,) = s.conflicts("stack-1")
    assert record.entries == (("a", 100.0), ("b", 130.0), ("c", 145.0))
    assert len(s.readings("stack-1")) == 3


def test_same_value_from_other_channel_is_not_conflict():
    s = make_system()
    results = s.ingest([Reading("stack-1", 10, 100.0, channel="a"),
                        Reading("stack-1", 10, 100.0, channel="b")])
    assert results[1].status == "duplicate"
    assert s.conflicts() == []
