"""覆盖需求 1~7 的验收测试。"""

import pytest

from profiler import FrameError, GapError, ProfilerSession, Sample


def make_session(threshold=0.2):
    """标准帧树：root(d0) ├─ a(d1) └─ c(d1)；a └─ b(d2)。全部在线程 t1。"""
    s = ProfilerSession(hotspot_threshold=threshold)
    s.add_frame("root", "t1", "main")
    s.add_frame("a", "t1", "func_a", parent_id="root")
    s.add_frame("b", "t1", "func_b", parent_id="a")
    s.add_frame("c", "t1", "func_c", parent_id="root")
    return s


def smp(frame, ts, self_time, depth, thread="t1", source="sampler"):
    return Sample(
        thread_id=thread, timestamp=ts, frame_id=frame,
        depth=depth, self_time=self_time, source=source,
    )


def stats_map(session):
    return {fid: session.frame_stats(fid) for fid in session.frame_ids()}


def assert_stats_equal(s1, s2):
    """两个会话所有帧的耗时/占比/热点判定完全一致。"""
    assert set(s1.frame_ids()) == set(s2.frame_ids())
    m1, m2 = stats_map(s1), stats_map(s2)
    for fid in m1:
        a, b = m1[fid], m2[fid]
        assert a.self_time == pytest.approx(b.self_time), fid
        assert a.cumulative_time == pytest.approx(b.cumulative_time), fid
        assert a.ratio == pytest.approx(b.ratio), fid
        assert a.is_hotspot == b.is_hotspot, fid
        assert a.sample_count == b.sample_count, fid


# ----------------------------------------------------------------------
# 需求 1：帧的唯一标识、所属线程、父帧存在、不允许成环
# ----------------------------------------------------------------------

class TestFrameStructure:
    def test_duplicate_frame_id_rejected(self):
        s = make_session()
        with pytest.raises(FrameError, match="重复"):
            s.add_frame("a", "t1", "again", parent_id="root")

    def test_missing_parent_rejected(self):
        s = ProfilerSession()
        with pytest.raises(FrameError, match="父帧不存在"):
            s.add_frame("orphan", "t1", "f", parent_id="ghost")

    def test_root_and_depth(self):
        s = make_session()
        assert s.frame_stats("root").depth == 0
        assert s.frame_stats("b").depth == 2

    def test_reparent_to_self_rejected(self):
        s = make_session()
        with pytest.raises(FrameError, match="自己"):
            s.reparent_frame("a", "a")

    def test_reparent_cycle_rejected(self):
        s = make_session()
        # b 是 a 的后代，把 a 挂到 b 下会成环
        with pytest.raises(FrameError, match="成环"):
            s.reparent_frame("a", "b")
        # root 挂到任何后代都会成环
        with pytest.raises(FrameError, match="成环"):
            s.reparent_frame("root", "c")

    def test_reparent_to_missing_frame_rejected(self):
        s = make_session()
        with pytest.raises(FrameError, match="父帧不存在"):
            s.reparent_frame("c", "ghost")

    def test_reparent_ok_updates_depth(self):
        s = make_session()
        s.reparent_frame("c", "a")  # c: depth 1 -> 2
        assert s.frame_stats("c").depth == 2
        chain = s.call_chain("c")
        assert [link.frame_id for link in chain] == ["root", "a", "c"]

    def test_reparent_idempotent_noop(self):
        s = make_session()
        s.reparent_frame("c", "root")  # 已是 root 的子帧
        assert s.frame_stats("c").depth == 1

    def test_recursive_frames_are_distinct_nodes(self):
        # 递归/动态派发产生的同名重复帧是不同的节点
        s = ProfilerSession()
        s.add_frame("r0", "t1", "recurse")
        s.add_frame("r1", "t1", "recurse", parent_id="r0")
        s.add_frame("r2", "t1", "recurse", parent_id="r1")
        s.add_samples([smp("r2", 1, 3.0, depth=2)])
        assert s.frame_stats("r0").cumulative_time == pytest.approx(3.0)
        assert s.frame_stats("r2").self_time == pytest.approx(3.0)


# ----------------------------------------------------------------------
# 需求 2：采样校验——幂等、自耗时非正拒绝、深度不一致拒绝并指出位置
# ----------------------------------------------------------------------

class TestSampleValidation:
    def test_duplicate_sample_idempotent(self):
        s = make_session()
        r1 = s.add_samples([smp("b", 1, 5.0, depth=2)])
        r2 = s.add_samples([smp("b", 1, 5.0, depth=2)])
        assert r1.accepted == 1 and r2.accepted == 0
        assert r2.duplicates == 1
        assert s.frame_stats("b").self_time == pytest.approx(5.0)
        assert s.frame_stats("b").sample_count == 1

    def test_out_of_order_samples_accepted(self):
        s = make_session()
        s.add_samples([smp("b", 9, 1.0, depth=2), smp("b", 2, 2.0, depth=2)])
        assert s.frame_stats("b").self_time == pytest.approx(3.0)

    def test_non_positive_self_time_rejected_with_position(self):
        s = make_session()
        report = s.add_samples([
            smp("a", 1, 1.0, depth=1),      # 正常
            smp("a", 2, 0.0, depth=1),      # 零：拒绝
            smp("b", 3, -4.5, depth=2),     # 负：拒绝
        ])
        assert report.accepted == 1
        assert len(report.rejected) == 2
        assert report.rejected[0].batch_index == 1
        assert report.rejected[1].batch_index == 2
        assert "自耗时" in report.rejected[0].reason
        assert "帧 'b'" in report.rejected[1].describe()

    def test_depth_mismatch_rejected_with_position(self):
        s = make_session()
        report = s.add_samples([
            smp("b", 1, 2.0, depth=1),  # b 实际深度为 2
        ])
        assert report.accepted == 0
        rej = report.rejected[0]
        assert rej.batch_index == 0
        assert "深度" in rej.reason and "2" in rej.reason

    def test_unknown_frame_rejected(self):
        s = make_session()
        report = s.add_samples([smp("ghost", 1, 1.0, depth=0)])
        assert report.accepted == 0
        assert "不存在" in report.rejected[0].reason

    def test_thread_mismatch_rejected(self):
        s = make_session()
        report = s.add_samples([smp("a", 1, 1.0, depth=1, thread="t2")])
        assert report.accepted == 0
        assert "线程不匹配" in report.rejected[0].reason


# ----------------------------------------------------------------------
# 需求 3：归并为调用树，累计 = 自耗时 + 直接子帧累计之和
# ----------------------------------------------------------------------

class TestAggregation:
    def test_tree_aggregation_and_invariant(self):
        s = make_session()
        s.add_samples([
            smp("root", 1, 5.0, depth=0),
            smp("a", 2, 3.0, depth=1),
            smp("b", 3, 4.0, depth=2),
            smp("c", 4, 2.0, depth=1),
        ])
        assert s.frame_stats("b").cumulative_time == pytest.approx(4.0)
        assert s.frame_stats("a").cumulative_time == pytest.approx(7.0)
        assert s.frame_stats("c").cumulative_time == pytest.approx(2.0)
        assert s.frame_stats("root").cumulative_time == pytest.approx(14.0)
        assert s.total_time == pytest.approx(14.0)
        self.assert_invariant(s)

    def test_multi_thread_session_total(self):
        s = make_session()
        s.add_frame("w", "t2", "worker")
        s.add_samples([
            smp("root", 1, 6.0, depth=0),
            smp("w", 1, 4.0, depth=0, thread="t2"),
        ])
        assert s.total_time == pytest.approx(10.0)
        assert s.frame_stats("w").ratio == pytest.approx(0.4)

    def assert_invariant(self, session):
        """对每帧验证：累计 == 自耗时 + 全部直接子帧累计之和。"""
        for fid in session.frame_ids():
            st = session.frame_stats(fid)
            expected = st.self_time + sum(
                session.frame_stats(cid).cumulative_time
                for cid in _children_of(session, fid)
            )
            assert st.cumulative_time == pytest.approx(expected), fid


def _children_of(session, frame_id):
    """直接子帧：调用链中直接父帧为 frame_id 的帧。"""
    result = []
    for fid in session.frame_ids():
        chain = session.call_chain(fid)
        if len(chain) >= 2 and chain[-2].frame_id == frame_id:
            result.append(fid)
    return tuple(result)


# ----------------------------------------------------------------------
# 需求 4：缺失区间标记为数据缺失，不得折算为零，不得误判热点
# ----------------------------------------------------------------------

class TestDataGaps:
    def test_gap_recorded_not_zero_filled(self):
        s = make_session()
        s.mark_gap("t1", 10, 20, reason="线程中断")
        gaps = s.missing_intervals("t1")
        assert len(gaps) == 1
        assert gaps[0].start == 10 and gaps[0].end == 20
        assert gaps[0].reason == "线程中断"
        # 缺失区间内不生成任何零耗时采样
        assert s.frame_stats("a").sample_count == 0
        assert s.frame_stats("a").self_time == 0.0

    def test_gap_affected_frame_not_hotspot(self):
        s = make_session(threshold=0.2)
        # c 的自耗时占比极高（若参与判定必是热点），但其采样落在缺失区间内
        s.add_samples([
            smp("root", 1, 1.0, depth=0),
            smp("c", 15, 100.0, depth=1),
        ])
        s.mark_gap("t1", 10, 20, reason="中断")
        st = s.frame_stats("c")
        assert st.gap_affected
        assert not st.eligible
        assert not st.is_hotspot
        assert any("缺失" in r for r in st.ineligibility_reasons)
        assert "c" not in [h.frame_id for h in s.hotspots()]
        # 耗时本身仍如实统计（只是不参与热点判定）
        assert st.self_time == pytest.approx(100.0)

    def test_clean_frame_unaffected_by_gap_elsewhere(self):
        s = make_session(threshold=0.2)
        s.add_samples([
            smp("root", 1, 1.0, depth=0),
            smp("a", 2, 9.0, depth=1),
        ])
        s.mark_gap("t1", 50, 60)  # 与 a 的采样区间 [2,2] 不相交
        st = s.frame_stats("a")
        assert st.eligible and st.is_hotspot

    def test_invalid_gap_rejected(self):
        s = make_session()
        with pytest.raises(GapError):
            s.mark_gap("t1", 20, 10)


# ----------------------------------------------------------------------
# 需求 5：矛盾采样保留双方并生成可读冲突记录，不静默择一
# ----------------------------------------------------------------------

class TestConflicts:
    def test_conflict_keeps_both_sides(self):
        s = make_session()
        s.add_samples([smp("b", 1, 5.0, depth=2, source="sampler")])
        report = s.add_samples([smp("b", 1, 9.0, depth=2, source="etrace")])
        assert len(report.conflicts) == 1
        record = report.conflicts[0]
        # 双方来源与数值都保留
        sources = {obs.source for obs in record.observations}
        values = {obs.self_time for obs in record.observations}
        assert sources == {"sampler", "etrace"}
        assert values == {5.0, 9.0}
        assert record.frame_ids == ("b", "b")
        # 可读记录指出帧、双方来源与各自数值
        text = record.describe()
        for token in ("b", "sampler", "etrace", "5.0", "9.0"):
            assert token in text

    def test_conflict_neither_side_counted(self):
        s = make_session()
        s.add_samples([
            smp("root", 0, 10.0, depth=0),
            smp("b", 1, 5.0, depth=2, source="sampler"),
        ])
        s.add_samples([smp("b", 1, 9.0, depth=2, source="etrace")])
        # 双方均不计入聚合：b 的自耗时为 0，总耗时只剩 root 的 10
        assert s.frame_stats("b").self_time == 0.0
        assert s.total_time == pytest.approx(10.0)
        st = s.frame_stats("b")
        assert st.has_conflict and not st.eligible and not st.is_hotspot
        # 冲突观测仍可在贡献来源中查到
        report = s.contributions("b")
        assert len(report.conflicts) == 1
        assert report.sources == ()  # 无计入聚合的来源

    def test_conflicting_frame_mismatch_recorded(self):
        s = make_session()
        s.add_samples([smp("a", 1, 5.0, depth=1, source="sampler")])
        report = s.add_samples([smp("c", 1, 5.0, depth=1, source="etrace")])
        record = report.conflicts[0]
        assert set(record.frame_ids) == {"a", "c"}
        assert s.frame_stats("a").has_conflict
        assert s.frame_stats("c").has_conflict

    def test_third_source_appends_to_conflict(self):
        s = make_session()
        s.add_samples([smp("b", 1, 5.0, depth=2, source="s1")])
        s.add_samples([smp("b", 1, 9.0, depth=2, source="s2")])
        report = s.add_samples([smp("b", 1, 7.0, depth=2, source="s3")])
        assert len(s.conflicts) == 1
        record = report.conflicts[0]
        assert len(record.observations) == 3
        assert {o.self_time for o in record.observations} == {5.0, 9.0, 7.0}

    def test_identical_resample_is_not_conflict(self):
        s = make_session()
        s.add_samples([smp("b", 1, 5.0, depth=2, source="s1")])
        report = s.add_samples([smp("b", 1, 5.0, depth=2, source="s2")])
        assert report.duplicates == 1
        assert not report.conflicts
        assert s.frame_stats("b").self_time == pytest.approx(5.0)


# ----------------------------------------------------------------------
# 需求 6：增量重算 == 从头归并，未受影响帧耗时不变
# ----------------------------------------------------------------------

class TestIncrementalRecompute:
    def build_batches(self):
        batch1 = [
            smp("root", 1, 5.0, depth=0),
            smp("a", 2, 3.0, depth=1),
            smp("b", 3, 4.0, depth=2),
        ]
        batch2 = [
            smp("c", 4, 2.0, depth=1),
            smp("b", 5, 1.5, depth=2),
            smp("root", 6, 0.5, depth=0),
        ]
        batch3 = [
            smp("a", 7, 2.5, depth=1),
            smp("c", 8, 3.0, depth=1),
        ]
        return batch1, batch2, batch3

    def test_incremental_equals_single_shot(self):
        b1, b2, b3 = self.build_batches()
        inc = make_session()
        for batch in (b1, b2, b3):
            inc.add_samples(batch)
        full = make_session()
        full.add_samples(b1 + b2 + b3)
        assert_stats_equal(inc, full)

    def test_incremental_equals_full_recompute(self):
        b1, b2, b3 = self.build_batches()
        s = make_session()
        for batch in (b1, b2, b3):
            s.add_samples(batch)
        before = stats_map(s)
        s.recompute_full()
        after = stats_map(s)
        for fid in before:
            assert before[fid].self_time == after[fid].self_time
            assert before[fid].cumulative_time == after[fid].cumulative_time

    def test_unaffected_frames_unchanged(self):
        s = make_session()
        s.add_frame("iso", "t2", "isolated")  # 独立的另一棵子树
        s.add_samples([
            smp("root", 1, 5.0, depth=0),
            smp("a", 2, 3.0, depth=1),
            smp("iso", 1, 7.0, depth=0, thread="t2"),
        ])
        snapshot = {
            fid: (s.frame_stats(fid).self_time, s.frame_stats(fid).cumulative_time)
            for fid in ("iso", "c")
        }
        # 新增一批只触及 b 及其祖先（a、root）的采样
        s.add_samples([smp("b", 3, 4.0, depth=2)])
        for fid, (self_t, cum_t) in snapshot.items():
            st = s.frame_stats(fid)
            assert st.self_time == self_t, fid
            assert st.cumulative_time == cum_t, fid
        # 受影响链确实更新了
        assert s.frame_stats("b").cumulative_time == pytest.approx(4.0)
        assert s.frame_stats("a").cumulative_time == pytest.approx(7.0)
        assert s.frame_stats("root").cumulative_time == pytest.approx(12.0)

    def test_reparent_incremental_equals_from_scratch(self):
        # 会话 A：先按旧结构摄入，再修正归属，再继续摄入（全程增量）
        a = ProfilerSession()
        a.add_frame("root", "t1", "main")
        a.add_frame("x", "t1", "fx", parent_id="root")
        a.add_frame("y", "t1", "fy", parent_id="root")
        a.add_frame("z", "t1", "fz", parent_id="y")  # z 最初挂在 y 下
        a.add_samples([
            smp("root", 1, 2.0, depth=0),
            smp("x", 2, 3.0, depth=1),
            smp("y", 3, 1.0, depth=1),
        ])
        a.reparent_frame("z", "x")  # 修正归属：z 改挂 x 下（深度仍为 2）
        a.add_samples([
            smp("z", 4, 6.0, depth=2),
            smp("x", 5, 1.0, depth=1),
        ])
        # 会话 B：直接按最终结构从头归并同样的采样
        b = ProfilerSession()
        b.add_frame("root", "t1", "main")
        b.add_frame("x", "t1", "fx", parent_id="root")
        b.add_frame("y", "t1", "fy", parent_id="root")
        b.add_frame("z", "t1", "fz", parent_id="x")
        b.add_samples([
            smp("root", 1, 2.0, depth=0),
            smp("x", 2, 3.0, depth=1),
            smp("y", 3, 1.0, depth=1),
            smp("z", 4, 6.0, depth=2),
            smp("x", 5, 1.0, depth=1),
        ])
        assert_stats_equal(a, b)
        # 未受影响分支 y 的耗时在归属修正前后不变
        assert a.frame_stats("y").cumulative_time == pytest.approx(1.0)
        # 数值上：x 累计 = 3 + 1 + 6 = 10，root = 2 + 10 + 1 = 13
        assert a.frame_stats("x").cumulative_time == pytest.approx(10.0)
        assert a.frame_stats("root").cumulative_time == pytest.approx(13.0)

    def test_reparent_cycle_still_blocked_after_ingest(self):
        s = make_session()
        s.add_samples([smp("b", 1, 4.0, depth=2)])
        with pytest.raises(FrameError, match="成环"):
            s.reparent_frame("root", "b")


# ----------------------------------------------------------------------
# 需求 7：查询——自耗时/累计/占比/热点、调用链、贡献来源、稳定顺序
# ----------------------------------------------------------------------

class TestQueries:
    def build(self):
        s = make_session(threshold=0.2)
        s.add_samples([
            smp("root", 1, 2.0, depth=0),
            smp("a", 2, 3.0, depth=1, source="sampler"),
            smp("a", 3, 1.0, depth=1, source="etrace"),
            smp("b", 4, 4.0, depth=2, source="sampler"),
            smp("c", 5, 2.0, depth=1, source="etrace"),
        ])
        return s  # 总耗时 12：root=12, a=8, b=4, c=2

    def test_frame_stats_fields(self):
        s = self.build()
        st = s.frame_stats("a")
        assert st.self_time == pytest.approx(4.0)
        assert st.cumulative_time == pytest.approx(8.0)
        assert st.ratio == pytest.approx(8.0 / 12.0)
        assert st.is_hotspot
        assert st.sample_count == 2
        st_c = s.frame_stats("c")
        assert st_c.ratio == pytest.approx(2.0 / 12.0)
        assert not st_c.is_hotspot  # 低于 0.2 阈值

    def test_root_ratios_sum_to_one(self):
        s = self.build()
        s.add_frame("w", "t2", "worker")
        s.add_samples([smp("w", 1, 8.0, depth=0, thread="t2")])
        roots = [fid for fid in s.frame_ids() if s.frame_stats(fid).depth == 0]
        assert sum(s.frame_stats(r).ratio for r in roots) == pytest.approx(1.0)

    def test_hotspots_stable_order(self):
        s = self.build()
        hot1 = [h.frame_id for h in s.hotspots()]
        hot2 = [h.frame_id for h in s.hotspots()]
        assert hot1 == hot2 == ["root", "a", "b"]  # 累计降序；c 占比 1/6 低于阈值
        # 并列时按帧标识升序
        s2 = ProfilerSession(hotspot_threshold=0.1)
        s2.add_frame("r", "t1", "root")
        s2.add_frame("f2", "t1", "n2", parent_id="r")
        s2.add_frame("f1", "t1", "n1", parent_id="r")
        s2.add_samples([
            smp("r", 1, 1.0, depth=0),
            smp("f2", 2, 5.0, depth=1),
            smp("f1", 3, 5.0, depth=1),
        ])
        ids = [h.frame_id for h in s2.hotspots()]
        assert ids.index("f1") < ids.index("f2")

    def test_call_chain_root_to_leaf(self):
        s = self.build()
        chain = s.call_chain("b")
        assert [link.frame_id for link in chain] == ["root", "a", "b"]
        assert [link.name for link in chain] == ["main", "func_a", "func_b"]
        assert chain[-1].cumulative_time == pytest.approx(4.0)
        assert chain[0].share == pytest.approx(1.0)
        assert chain[-1].share == pytest.approx(4.0 / 12.0)

    def test_contributions_sorted_and_complete(self):
        s = self.build()
        report = s.contributions("a")
        assert [c.source for c in report.sources] == ["etrace", "sampler"]  # 名称排序
        by_source = {c.source: c for c in report.sources}
        assert by_source["sampler"].self_time == pytest.approx(3.0)
        assert by_source["sampler"].sample_count == 1
        assert by_source["etrace"].self_time == pytest.approx(1.0)
        assert report.conflicts == ()

    def test_query_results_repeatable(self):
        s = self.build()
        first = (
            tuple(s.frame_stats(f) for f in s.frame_ids()),
            s.hotspots(),
            s.call_chain("b"),
            s.contributions("a"),
            s.missing_intervals(),
        )
        second = (
            tuple(s.frame_stats(f) for f in s.frame_ids()),
            s.hotspots(),
            s.call_chain("b"),
            s.contributions("a"),
            s.missing_intervals(),
        )
        assert first == second
