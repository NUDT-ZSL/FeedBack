"""经营指标台账验收测试,逐条对应需求 1-8。"""
import json
from fractions import Fraction

import pytest

from metric_ledger import (
    CONFLICT,
    DIVISION_BY_ZERO,
    NO_DATA,
    NO_SPEC_VERSION,
    LedgerError,
    MetricLedger,
)


def make_ledger():
    """多指标多依赖的基础台账:

    字段: revenue(营收), orders(订单数), refund(退款)
    指标: net = revenue - refund          (净营收)
          aov = net / orders              (客单价)
          scale = aov * 2 + 1             (下游复合依赖)
    """
    led = MetricLedger()
    for f in ("revenue", "orders", "refund"):
        led.declare_field(f)
    led.define_metric("net", [(0, "revenue - refund")])
    led.define_metric("aov", [(0, "net / orders")])
    led.define_metric("scale", [(0, "aov * 2 + 1")])
    return led


# ----------------------------------------------------------------------
# 需求 1:指标与口径版本维护,非法配置拒绝并指出位置
# ----------------------------------------------------------------------

class TestDefinition:
    def test_versions_sorted_and_effective_uniquely(self):
        led = MetricLedger()
        led.declare_field("a")
        led.define_metric("m", [(10, "a * 2"), (0, "a")])  # 乱序输入,自动排序
        versions = led.spec_versions("m")
        assert [v["effective_from"] for v in versions] == [0, 10]
        led.ingest("a", 5, time=3)
        led.ingest("a", 5, time=12)
        assert led.query("m", 3).value == 5      # v1: a
        assert led.query("m", 12).value == 10    # v2: a * 2

    def test_duplicate_effective_time_rejected_with_position(self):
        led = MetricLedger()
        led.declare_field("a")
        with pytest.raises(LedgerError) as exc:
            led.define_metric("m", [(5, "a"), (5, "a * 2")])
        msg = str(exc.value)
        assert "m" in msg and "t=5" in msg and "第 0 个" in msg and "第 1 个" in msg

    def test_add_version_at_existing_time_rejected(self):
        led = make_ledger()
        with pytest.raises(LedgerError) as exc:
            led.add_version("net", 0, "revenue")
        assert "t=0" in str(exc.value) and "net" in str(exc.value)

    def test_bad_formula_rejected_with_position(self):
        led = MetricLedger()
        led.declare_field("a")
        with pytest.raises(LedgerError) as exc:
            led.define_metric("m", [(0, "a +* 2")])
        assert "位置" in str(exc.value)

    def test_empty_versions_and_duplicate_definition_rejected(self):
        led = MetricLedger()
        with pytest.raises(LedgerError):
            led.define_metric("m", [])
        led.declare_field("a")
        led.define_metric("m", [(0, "a")])
        with pytest.raises(LedgerError):
            led.define_metric("m", [(0, "a * 2")])


# ----------------------------------------------------------------------
# 需求 2:引用合法性 + 依赖不成环
# ----------------------------------------------------------------------

class TestDependencies:
    def test_unknown_reference_rejected_and_named(self):
        led = MetricLedger()
        led.declare_field("a")
        with pytest.raises(LedgerError) as exc:
            led.define_metric("m", [(0, "a + ghost")])
        assert "ghost" in str(exc.value)

    def test_cycle_rejected_with_chain(self):
        led = make_ledger()
        # net -> aov -> scale 已存在,让 net 回头依赖 scale 构成环
        with pytest.raises(LedgerError) as exc:
            led.add_version("net", 100, "scale + revenue")
        msg = str(exc.value)
        assert "环" in msg
        # 指标链完整呈现: net -> scale -> aov -> net
        assert "net -> scale -> aov -> net" in msg
        # 拒绝后原口径不受影响
        assert led.spec_versions("net")[-1]["effective_from"] == 0

    def test_self_reference_rejected(self):
        led = make_ledger()
        with pytest.raises(LedgerError) as exc:
            led.add_version("net", 100, "net + 1")
        assert "net -> net" in str(exc.value)

    def test_field_metric_namespaces_disjoint(self):
        led = MetricLedger()
        led.declare_field("a")
        with pytest.raises(LedgerError):
            led.define_metric("a", [(0, "1")])
        led.define_metric("m", [(0, "a")])
        with pytest.raises(LedgerError):
            led.declare_field("m")


# ----------------------------------------------------------------------
# 需求 3:可注入逻辑时钟、幂等上报、冲突保留
# ----------------------------------------------------------------------

class TestIngestion:
    def test_injectable_clock(self):
        now = [10]
        led = MetricLedger(clock=lambda: now[0])
        led.declare_field("a")
        led.define_metric("m", [(0, "a * 2")])
        led.ingest("a", 7)          # 使用逻辑时钟时刻 10
        assert led.query("m", 10).value == 14
        assert led.query("m", 9).missing[0].reason == NO_DATA

    def test_duplicate_report_is_idempotent(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=1, source="s1")
        r = led.ingest("revenue", 100, time=1, source="s1")
        assert r["status"] == "duplicate"
        assert led.conflicts() == []
        # 幂等:重复上报不产生新的重算变化
        ingest_logs = [x for x in led.recompute_log() if x["event"] == "data_ingested"]
        assert len(ingest_logs) == 1

    def test_conflicting_sources_kept_and_recorded(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=1, source="系统A")
        r = led.ingest("revenue", 120, time=1, source="系统B")
        assert r["status"] == "conflict"
        records = led.conflicts()
        assert len(records) == 1
        rec = records[0]
        assert rec["field"] == "revenue" and rec["time"] == 1
        # 双方都被保留
        assert {e["source"] for e in rec["reports"]} == {"系统A", "系统B"}
        assert {e["value"] for e in rec["reports"]} == {100, 120}
        # 冲突记录可读
        assert "系统A" in rec["message"] and "系统B" in rec["message"]
        assert "100" in rec["message"] and "120" in rec["message"]

    def test_same_value_from_two_sources_is_not_conflict(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=1, source="s1")
        r = led.ingest("revenue", 100, time=1, source="s2")
        assert r["status"] == "ok"
        assert led.conflicts() == []

    def test_undeclared_field_rejected(self):
        led = MetricLedger()
        with pytest.raises(LedgerError):
            led.ingest("nope", 1, time=0)


# ----------------------------------------------------------------------
# 需求 4:按生效口径逐层计算,缺失显式标注不为零
# ----------------------------------------------------------------------

class TestQuery:
    def test_layered_computation_with_effective_spec(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=5)
        led.ingest("refund", 10, time=5)
        led.ingest("orders", 3, time=5)
        assert led.query("net", 5).value == 90
        assert led.query("aov", 5).value == 30
        assert led.query("scale", 5).value == 61

    def test_missing_dependency_marked_not_zero(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=5)
        led.ingest("orders", 3, time=5)
        # refund 缺失: net 必须缺失,而不是当作 100 - 0
        res = led.query("net", 5)
        assert res.value is None
        reasons = {m.reason for m in res.missing}
        assert reasons == {NO_DATA}
        assert res.missing[0].source == "refund"
        # 缺失沿依赖链向上传播
        assert led.query("aov", 5).value is None
        assert led.query("scale", 5).value is None

    def test_conflict_value_is_missing_not_picked(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=5, source="A")
        led.ingest("revenue", 120, time=5, source="B")
        led.ingest("refund", 10, time=5)
        res = led.query("net", 5)
        assert res.value is None
        assert res.missing[0].reason == CONFLICT

    def test_division_by_zero_marked(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=5)
        led.ingest("refund", 0, time=5)
        led.ingest("orders", 0, time=5)
        res = led.query("aov", 5)
        assert res.value is None
        assert DIVISION_BY_ZERO in {m.reason for m in res.missing}

    def test_no_spec_version_before_first_version(self):
        led = MetricLedger()
        led.declare_field("a")
        led.define_metric("m", [(10, "a")])
        led.ingest("a", 3, time=5)
        res = led.query("m", 5)
        assert res.value is None
        assert res.missing[0].reason == NO_SPEC_VERSION


# ----------------------------------------------------------------------
# 需求 5:口径变更只重算受影响范围,且与全量重算一致
# ----------------------------------------------------------------------

class TestRecompute:
    def build_history(self, led, times=range(0, 20)):
        for t in times:
            led.ingest("revenue", 100 + t, time=t)
            led.ingest("refund", 10, time=t)
            led.ingest("orders", 2, time=t)

    def test_incremental_equals_full_recompute(self):
        led = make_ledger()
        self.build_history(led)
        led.add_version("net", 10, "revenue - refund - 1")   # 口径微调
        led.add_version("aov", 15, "net / (orders + 1)")     # 分母范围调整
        assert led.verify_consistency() == []

    def test_only_affected_metrics_and_times_recomputed(self):
        led = make_ledger()
        self.build_history(led)
        before_unaffected = led.query("scale", 3)
        record = led.add_version("net", 10, "revenue - refund - 1")
        # 受影响指标: net 及其下游 aov、scale
        assert record["affected_metrics"] == ["aov", "net", "scale"]
        # 受影响时段: 仅 t >= 10
        assert record["affected_times"] == list(range(10, 20))
        # 未受影响的时段结果不变(对象级不变)
        assert led.query("scale", 3) is before_unaffected
        assert led.query("scale", 3).value == before_unaffected.value
        # 变化记录只覆盖受影响范围
        assert all(c["time"] >= 10 for c in record["changes"])
        assert {c["metric"] for c in record["changes"]} <= {"aov", "net", "scale"}

    def test_unrelated_metric_untouched(self):
        led = make_ledger()
        led.declare_field("other")
        led.define_metric("lonely", [(0, "other * 3")])
        self.build_history(led)
        led.ingest("other", 7, time=12)
        before = led.query("lonely", 12)
        record = led.add_version("net", 10, "revenue - refund - 5")
        assert "lonely" not in record["affected_metrics"]
        assert led.query("lonely", 12) is before

    def test_inserted_middle_version_bounds_recompute_range(self):
        led = make_ledger()
        led.add_version("net", 10, "revenue")          # 先有 t=10 的版本
        self.build_history(led)
        record = led.add_version("net", 5, "revenue - refund - 2")  # 中间插入
        # 只影响 [5, 10)
        assert record["affected_times"] == list(range(5, 10))
        assert led.verify_consistency() == []

    def test_recompute_log_is_complete_and_ordered(self):
        led = make_ledger()
        self.build_history(led, times=range(0, 5))
        led.add_version("net", 3, "revenue")
        log = led.recompute_log()
        seqs = [r["seq"] for r in log]
        assert seqs == list(range(1, len(log) + 1))
        kinds = {r["event"] for r in log}
        assert kinds <= {"metric_defined", "data_ingested", "spec_version_added"}


# ----------------------------------------------------------------------
# 需求 6:完整来源链,结果与顺序确定
# ----------------------------------------------------------------------

class TestProvenance:
    def test_explain_full_chain(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=5)
        led.ingest("refund", 10, time=5)
        led.ingest("orders", 3, time=5)
        ex = led.explain("aov", 5)
        assert ex["value"] == 30
        prov = ex["provenance"]
        assert prov["kind"] == "metric" and prov["name"] == "aov"
        assert prov["version"] == 1
        assert prov["formula"] == "(net / orders)"
        # 依赖贡献:net=90, orders=3,顺序与公式引用顺序一致
        contribs = prov["contributions"]
        assert [c["name"] for c in contribs] == ["net", "orders"]
        assert contribs[0]["value"] == 90
        assert contribs[1]["value"] == 3
        # net 的来源链继续向下: revenue=100, refund=10
        net_contribs = contribs[0]["contributions"]
        assert [c["name"] for c in net_contribs] == ["revenue", "refund"]
        assert [c["value"] for c in net_contribs] == [100, 10]
        assert all(c["kind"] == "field" for c in net_contribs)

    def test_explain_is_deterministic(self):
        led = make_ledger()
        led.ingest("revenue", 100, time=5)
        led.ingest("refund", 10, time=5)
        led.ingest("orders", 3, time=5)
        first = json.dumps(led.explain("scale", 5), sort_keys=False)
        second = json.dumps(led.explain("scale", 5), sort_keys=False)
        assert first == second

    def test_provenance_records_version_used(self):
        led = make_ledger()
        led.add_version("net", 10, "revenue")   # v2: 不再扣退款
        led.ingest("revenue", 100, time=12)
        led.ingest("refund", 10, time=12)
        ex = led.explain("net", 12)
        assert ex["value"] == 100
        assert ex["provenance"]["version"] == 2
        assert ex["provenance"]["formula"] == "revenue"


# ----------------------------------------------------------------------
# 需求 7:口径切换轨迹,差异归因到具体依赖
# ----------------------------------------------------------------------

class TestTrajectory:
    def test_switch_trajectory_with_attribution(self):
        led = make_ledger()
        for t in range(0, 20):
            led.ingest("revenue", 100, time=t)
            led.ingest("refund", 10, time=t)
            led.ingest("orders", 2, time=t)
        # t=10 起 aov 改口径: 分母从 orders 变为 orders + 1
        led.add_version("aov", 10, "net / (orders + 1)")
        traj = led.trajectory("aov", 0, 20)
        assert len(traj) == 1
        sw = traj[0]
        assert sw["effective_from"] == 10
        assert sw["from_version"] == 1 and sw["to_version"] == 2
        assert sw["from_formula"] == "(net / orders)"
        assert sw["to_formula"] == "(net / (orders + 1))"
        # 同一切换时刻分别按旧/新口径计算: 90/2=45 vs 90/3=30
        assert sw["value_before"] == 45
        assert sw["value_after"] == 30
        assert sw["diff"] == -15
        # 归因到具体依赖: net 保留(90), orders 保留(2)
        attrs = {a["dependency"]: a for a in sw["attribution"]}
        assert attrs["net"]["status"] == "retained"
        assert attrs["net"]["value_at_switch"] == 90
        assert attrs["orders"]["status"] == "retained"

    def test_attribution_marks_added_and_removed_dependencies(self):
        led = make_ledger()
        for t in range(0, 10):
            led.ingest("revenue", 100, time=t)
            led.ingest("refund", 10, time=t)
            led.ingest("orders", 2, time=t)
        # 新口径引入 refund、移除 orders
        led.add_version("aov", 5, "net / 3 - refund")
        sw = led.trajectory("aov", 0, 10)[0]
        attrs = {a["dependency"]: a["status"] for a in sw["attribution"]}
        assert attrs["net"] == "retained"
        assert attrs["orders"] == "removed"
        assert attrs["refund"] == "added"

    def test_trajectory_empty_without_switch_in_range(self):
        led = make_ledger()
        led.add_version("net", 10, "revenue")
        assert led.trajectory("net", 10, 20) == []
        assert led.trajectory("net", 0, 10) == []  # 首个版本不算切换
        assert len(led.trajectory("net", 0, 11)) == 1


# ----------------------------------------------------------------------
# 需求 8:切换时刻附近的不连续点必须报告
# ----------------------------------------------------------------------

class TestDiscontinuity:
    def test_discontinuity_reported_with_attribution(self):
        led = make_ledger()
        for t in range(0, 20):
            led.ingest("revenue", 100, time=t)
            led.ingest("refund", 10, time=t)
            led.ingest("orders", 2, time=t)
        led.add_version("aov", 10, "net / (orders + 1)")
        disc = led.discontinuities("aov", 0, 20)
        assert len(disc) == 1
        d = disc[0]
        assert d["time"] == 10
        assert d["kind"] == "value_jump"
        assert d["value_at_t-1"] == 45     # t=9 旧口径
        assert d["value_at_t"] == 30       # t=10 新口径
        assert d["jump"] == -15
        # 差异能归因到具体依赖变化
        assert d["switch"]["attribution"]

    def test_continuous_switch_not_reported(self):
        led = make_ledger()
        for t in range(0, 20):
            led.ingest("revenue", 100, time=t)
            led.ingest("refund", 10, time=t)
            led.ingest("orders", 2, time=t)
        # 等价改写: (revenue - refund) / orders == net / orders,不产生跳变
        led.add_version("aov", 10, "(revenue - refund) / orders")
        assert led.discontinuities("aov", 0, 20) == []

    def test_missing_appearance_is_discontinuity(self):
        led = make_ledger()
        for t in range(0, 20):
            led.ingest("revenue", 100, time=t)
            led.ingest("refund", 10, time=t)
            led.ingest("orders", 2, time=t)
        # 新口径依赖一个从未上报的字段 -> 取值在切换时刻消失
        led.declare_field("bonus")
        led.add_version("net", 10, "revenue - refund + bonus")
        disc = led.discontinuities("net", 0, 20)
        assert len(disc) == 1
        assert disc[0]["kind"] == "vanishes"
        assert disc[0]["value_at_t-1"] == 90
        assert disc[0]["value_at_t"] is None


# ----------------------------------------------------------------------
# 综合:多指标多依赖端到端,逐步推导比对
# ----------------------------------------------------------------------

class TestEndToEnd:
    def test_multi_metric_multi_version_scenario(self):
        led = MetricLedger()
        for f in ("gmv", "cancel", "ship", "users"):
            led.declare_field(f)
        # 指标体系: 有效GMV -> 履约率 -> 人均履约(两层依赖)
        led.define_metric("valid_gmv", [(0, "gmv - cancel")])
        led.define_metric("fulfill_rate", [(0, "ship / valid_gmv")])
        led.define_metric("per_user", [(0, "ship / users")])
        for t in range(0, 12):
            led.ingest("gmv", 1000, time=t)
            led.ingest("cancel", 100, time=t)
            led.ingest("ship", 450, time=t)
            led.ingest("users", 50, time=t)
        # t=6 起: 取消单口径放宽(只扣一半), 影响 valid_gmv 与 fulfill_rate
        led.add_version("valid_gmv", 6, "gmv - cancel / 2")
        # t=9 起: 人均口径改用有效GMV
        led.add_version("per_user", 9, "valid_gmv / users")

        # 逐步推导: t<6 valid=900, rate=450/900=1/2; 6<=t valid=950, rate=450/950=9/19
        assert led.query("valid_gmv", 5).value == 900
        assert led.query("valid_gmv", 6).value == 950
        assert led.query("fulfill_rate", 5).value == Fraction(1, 2)
        assert led.query("fulfill_rate", 6).value == Fraction(9, 19)
        # per_user: t<9 为 450/50=9; t>=9 为 950/50=19
        assert led.query("per_user", 8).value == 9
        assert led.query("per_user", 9).value == 19

        # 全量一致性
        assert led.verify_consistency() == []

        # 切换轨迹: fulfill_rate 在 t=6 有一次切换(由 valid_gmv 口径变化引起?
        # 不 —— fulfill_rate 自身口径未变,轨迹只记录自身口径切换)
        assert led.trajectory("fulfill_rate", 0, 12) == []
        # 但其取值的不连续由上游引起,不连续点检测针对自身口径切换,
        # 因此 fulfill_rate 无不连续点; valid_gmv 在 t=6 有不连续点
        disc = led.discontinuities("valid_gmv", 0, 12)
        assert [d["time"] for d in disc] == [6]
        assert disc[0]["value_at_t-1"] == 900
        assert disc[0]["value_at_t"] == 950

        # per_user 在 t=9 切换,差异归因: users 保留, valid_gmv 新增, ship 移除
        sw = led.trajectory("per_user", 0, 12)[0]
        attrs = {a["dependency"]: a["status"] for a in sw["attribution"]}
        assert attrs == {"ship": "removed", "users": "retained",
                         "valid_gmv": "added"}
        assert sw["value_before"] == 9
        assert sw["value_after"] == 19

        # 来源链: per_user@10 -> valid_gmv@10(v2) -> gmv/cancel
        ex = led.explain("per_user", 10)
        assert ex["provenance"]["version"] == 2
        dep = ex["provenance"]["contributions"][0]
        assert dep["name"] == "valid_gmv" and dep["version"] == 2
        assert dep["value"] == 950
