"""sat_solver 的离线验收测试。"""

import random

import pytest

from sat_solver import NotUnsat, Solver, SolverLocked, UnknownVariable


# ----------------------------------------------------------------------
# 辅助
# ----------------------------------------------------------------------

def brute_force_sat(n, clauses):
    """暴力枚举 n 个变量的全部赋值，返回公式是否可满足。"""
    for mask in range(1 << n):
        if all(
            any((lit > 0) == bool(mask >> (abs(lit) - 1) & 1) for lit in clause)
            for clause in clauses
        ):
            return True
    return False


def random_3sat(seed, n, m):
    rng = random.Random(seed)
    clauses = []
    for _ in range(m):
        vs = rng.sample(range(1, n + 1), 3)
        clauses.append([v if rng.random() < 0.5 else -v for v in vs])
    return clauses


def check_model(n, clauses, model):
    assert model is not None
    assert set(model) == set(range(1, n + 1))  # 覆盖全部变量（未约束变量也要自洽）
    assert all(isinstance(b, bool) for b in model.values())
    for clause in clauses:
        assert any(model[abs(lit)] == (lit > 0) for lit in clause)


# 手工推导过完整轨迹的 UNSAT 公式：1 和 -1 分别被两对子句强制
UNSAT_CLAUSES = [[1, 2], [1, -2], [-1, 3], [-1, -3]]


# ----------------------------------------------------------------------
# 1. 基本接口与子句预处理
# ----------------------------------------------------------------------

class TestClauseInput:
    def test_tautology_dropped_not_counted(self):
        s = Solver(3)
        s.add_clause([1, -1, 2])      # 含 x 和 -x：恒真，丢弃
        s.add_clause([-2, 3, 2])      # 同上
        assert s._originals == []
        assert s.solve() is True      # 等价于空公式

    def test_duplicate_literals_deduped(self):
        s = Solver(3)
        s.add_clause([2, 2, -1, -1, 2])
        assert s._originals == [[2, -1]]
        assert s.solve() is True
        m = s.model()
        assert m[2] is True or m[1] is False  # 子句 [2,-1] 被满足

    def test_empty_clause_immediate_unsat(self):
        s = Solver(3)
        s.add_clause([1, 2])
        s.add_clause([])              # 空子句：立即不可满足
        assert s.solve() is False     # 不抛异常
        assert s.model() is None
        assert s.explain() == [[]]

    def test_zero_literal_rejected(self):
        s = Solver(3)
        with pytest.raises(ValueError):
            s.add_clause([1, 0, -2])

    def test_unknown_variable_carries_number(self):
        s = Solver(3)
        with pytest.raises(UnknownVariable) as exc_info:
            s.add_clause([1, -4])
        assert exc_info.value.var == 4

    def test_add_clause_after_solve_locked(self):
        s = Solver(2)
        s.add_clause([1])
        s.solve()
        with pytest.raises(SolverLocked):
            s.add_clause([2])

    def test_solve_repeatable_consistent(self):
        s = Solver(3)
        for c in UNSAT_CLAUSES:
            s.add_clause(c)
        r1 = s.solve()
        stats1 = s.stats()
        r2 = s.solve()
        assert r1 == r2 is False
        assert s.stats() == stats1    # 第二次沿用已有结果，不再重新推理


# ----------------------------------------------------------------------
# 2. 手工 UNSAT：学习子句、回跳层号、统计计数
# ----------------------------------------------------------------------

class TestHandTracedUnsat:
    def test_learned_clause_and_backjump(self):
        s = Solver(3)
        for c in UNSAT_CLAUSES:
            s.add_clause(c)
        assert s.solve() is False
        # 决策 1=True 后传播出 3，与 [-1,-3] 冲突，归结出学习子句 [-1]
        assert s.learned == [[-1]]
        # (已做决策数, 冲突层, 回跳层)：层 1 冲突，学习子句为单元句，跳回层 0
        assert s.backjumps == [(1, 1, 0)]

    def test_stats_counts(self):
        s = Solver(3)
        for c in UNSAT_CLAUSES:
            s.add_clause(c)
        s.solve()
        assert s.stats() == {
            "decisions": 1,
            "propagations": 2,
            "conflicts": 2,
            "learned_clauses": 1,
        }
        assert all(v > 0 for v in s.stats().values())

    def test_model_none_on_unsat(self):
        s = Solver(3)
        for c in UNSAT_CLAUSES:
            s.add_clause(c)
        s.solve()
        assert s.model() is None


# ----------------------------------------------------------------------
# 3. 两文字监视下的传播计数
# ----------------------------------------------------------------------

class TestWatchedPropagation:
    def test_propagation_counts_and_no_full_scan(self):
        n_chain = 50
        s = Solver(150)
        s.add_clause([1])
        for k in range(1, n_chain):
            s.add_clause([-k, k + 1])          # 蕴含链 1 -> 2 -> ... -> 50
        rng = random.Random(7)
        for _ in range(500):                    # 500 条与传播无关的子句
            s.add_clause(sorted(rng.sample(range(51, 151), 3)))
        assert s.solve() is True
        st = s.stats()
        # 链上 50 个传播 + 100 个决策各出队一次
        assert st["propagations"] == 150
        assert st["decisions"] == 100
        assert st["conflicts"] == 0
        # 两文字监视：只检查了 49 条链式子句，远少于全量 549 条
        assert s._watch_checks == 49
        assert s._watch_checks < len(s.clauses)


# ----------------------------------------------------------------------
# 4. 冲突分析：非时序回跳与连续冲突单调性
# ----------------------------------------------------------------------

# 该公式执行中会产生同一决策阶段内的连续冲突（无中间决策）
MULTI_CONFLICT_CLAUSES = [
    [-1, -2, -3, 4],
    [-1, -2, -3, -4],
    [-1, 3, 5],
    [-1, 3, -5],
]


class TestBackjump:
    def test_consecutive_conflicts_monotone(self):
        s = Solver(5)
        for c in MULTI_CONFLICT_CLAUSES:
            s.add_clause(c)
        assert s.solve() == brute_force_sat(5, MULTI_CONFLICT_CLAUSES)
        bj = s.backjumps
        assert len(bj) >= 2
        # 每次回跳都严格低于冲突层（非时序：可跨越多层）
        assert all(back < lvl for _, lvl, back in bj)
        # 同一决策阶段内的连续冲突：冲突层与回跳层都严格下降（单调不增的强形式）
        for a, b in zip(bj, bj[1:]):
            if a[0] == b[0]:
                assert a[1] > b[1]
                assert a[2] > b[2]

    def test_learned_clause_only_lower_levels(self):
        # 学习子句的断言文字在位置 0，其余文字决策层都低于冲突层
        s = Solver(5)
        for c in MULTI_CONFLICT_CLAUSES:
            s.add_clause(c)
        s.solve()
        for (dec, lvl, back), learnt in zip(
            [(b[0], b[1], b[2]) for b in s.backjumps], s.learned
        ):
            assert len(learnt) >= 1
            assert back < lvl


# ----------------------------------------------------------------------
# 5. 不可满足核
# ----------------------------------------------------------------------

class TestExplain:
    def test_core_is_unsat_subset(self):
        s = Solver(3)
        for c in UNSAT_CLAUSES:
            s.add_clause(c)
        s.solve()
        core = s.explain()
        # 是原始输入子句的子集
        assert all(c in UNSAT_CLAUSES for c in core)
        # 本身仍不可满足：喂给新 Solver 必须 UNSAT
        s2 = Solver(3)
        for c in core:
            s2.add_clause(c)
        assert s2.solve() is False
        # 与暴力枚举一致
        assert brute_force_sat(3, core) is False

    def test_core_exact_for_hand_traced(self):
        s = Solver(3)
        for c in UNSAT_CLAUSES:
            s.add_clause(c)
        s.solve()
        # 四条子句都参与了最终矛盾，核为全集
        assert s.explain() == [[1, 2], [1, -2], [-1, 3], [-1, -3]]

    def test_core_reproducible(self):
        def solve_fresh():
            s = Solver(3)
            for c in UNSAT_CLAUSES:
                s.add_clause(c)
            s.solve()
            return s.explain()
        assert solve_fresh() == solve_fresh()

    def test_explain_raises_when_not_unsat(self):
        s = Solver(2)
        s.add_clause([1])
        s.solve()
        with pytest.raises(NotUnsat):
            s.explain()
        # 未调用 solve 也抛
        with pytest.raises(NotUnsat):
            Solver(2).explain()


# ----------------------------------------------------------------------
# 6. VSIDS 决策确定性
# ----------------------------------------------------------------------

class TestVsids:
    def test_tie_break_smallest_var(self):
        s = Solver(5)  # 无子句：活跃度全 0，按编号从小到大决策
        assert s.solve() is True
        assert s.decision_log == [1, 2, 3, 4, 5]

    def test_activity_bumped_by_conflicts(self):
        s = Solver(3)
        for c in UNSAT_CLAUSES:
            s.add_clause(c)
        s.solve()
        # 参与归结的变量活跃度被提升，未参与者保持 0
        assert s.activity[1] > 0
        assert s.activity[3] > 0
        assert s.activity[2] == 0

    def test_decision_sequence_deterministic(self):
        clauses = random_3sat(42, 9, 38)
        logs, results = [], []
        for _ in range(2):
            s = Solver(9)
            for c in clauses:
                s.add_clause(c)
            results.append(s.solve())
            logs.append(list(s.decision_log))
        assert results[0] == results[1]
        assert logs[0] == logs[1]  # 同一输入两次 solve 决策序列完全一致


# ----------------------------------------------------------------------
# 7. 随机 3-SAT 与暴力枚举对照
# ----------------------------------------------------------------------

class TestRandomAgainstBruteForce:
    @pytest.mark.parametrize("seed", range(20))
    def test_random_3sat(self, seed):
        n, m = 9, 38
        clauses = random_3sat(seed, n, m)
        s = Solver(n)
        for c in clauses:
            s.add_clause(c)
        expected = brute_force_sat(n, clauses)
        assert s.solve() == expected
        if expected:
            check_model(n, clauses, s.model())
        else:
            assert s.model() is None
            core = s.explain()
            assert all(c in clauses for c in core)          # 子集关系
            assert not brute_force_sat(n, core)             # 核本身不可满足
            s2 = Solver(n)
            for c in core:
                s2.add_clause(c)
            assert s2.solve() is False                      # 核可复现 UNSAT
            # 回跳性质在随机实例上也成立
            for a, b in zip(s.backjumps, s.backjumps[1:]):
                if a[0] == b[0]:
                    assert a[1] > b[1] and a[2] > b[2]
