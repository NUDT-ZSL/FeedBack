"""需求 1、2：来源维护；重复上报幂等；时刻倒退 / 非数值拒绝并指出位置。"""
import pytest

from emission_monitor import MonitoringSystem, Reading


def make_system():
    s = MonitoringSystem()
    s.add_source("stack-1", park="东区", metric_type="SO2")
    s.add_source("drain-1", park="东区", metric_type="COD")
    return s


def test_sources_have_unique_id_park_and_metric():
    s = make_system()
    assert s.sources() == {"stack-1": ("东区", "SO2"), "drain-1": ("东区", "COD")}
    with pytest.raises(ValueError, match="重复"):
        s.add_source("stack-1", park="西区", metric_type="NOx")


def test_readings_arrive_by_logical_time():
    s = make_system()
    results = s.ingest([Reading("stack-1", 0, 10.0), Reading("stack-1", 1, 11.0)])
    assert [r.status for r in results] == ["accepted", "accepted"]
    assert [(r.time, r.value) for r in s.readings("stack-1")] == [(0, 10.0), (1, 11.0)]


def test_duplicate_report_is_idempotent():
    s = make_system()
    s.ingest([Reading("stack-1", 5, 10.0)])
    dup = s.ingest([Reading("stack-1", 5, 10.0),  # 同通道重复
                    Reading("stack-1", 5, 10.0, channel="backup")])  # 另一通道同值
    assert [r.status for r in dup] == ["duplicate", "duplicate"]
    assert len(s.readings("stack-1")) == 1  # 状态不变
    assert s.conflicts() == []


def test_time_regression_rejected_with_position():
    s = make_system()
    s.ingest([Reading("stack-1", 10, 1.0)])
    results = s.ingest([Reading("stack-1", 11, 1.0),
                        Reading("stack-1", 7, 2.0),   # 倒退，位置 1
                        Reading("drain-1", 3, 1.0)])
    assert results[1].status == "rejected"
    assert results[1].index == 1
    assert "时刻倒退" in results[1].reason and "7" in results[1].reason
    assert results[2].status == "accepted"  # 其他来源不受影响
    assert [r.time for r in s.readings("stack-1")] == [10, 11]


@pytest.mark.parametrize("bad", ["abc", None, float("nan"), float("inf"), True, [1]])
def test_non_numeric_value_rejected_with_position(bad):
    s = make_system()
    results = s.ingest([Reading("stack-1", 0, 1.0),
                        Reading("stack-1", 1, bad),
                        Reading("stack-1", 2, 2.0)])
    assert results[1].status == "rejected"
    assert results[1].index == 1
    assert "不是有效数值" in results[1].reason
    assert [r.time for r in s.readings("stack-1")] == [0, 2]  # 坏读数不入库


def test_unknown_source_rejected():
    s = make_system()
    (res,) = s.ingest([Reading("ghost", 0, 1.0)])
    assert res.status == "rejected" and "未知来源" in res.reason
