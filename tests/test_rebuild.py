"""需求 7：维度定义变更后的增量重算。

覆盖：
- 新增取值：只有新组合受影响，未受影响组合逐格指纹不变；
- 删除/改名取值：消失组合失效，保留组合结论不变；
- 非法的新矩阵被拒绝且现状不变；
- 随机性质测试：任意事件序列后，增量汇总都与“用公开 API 从头重放”
  以及“从事件日志全量重放”完全一致。
"""
import random
import unittest

from envcompat import CompatibilityRunner, Matrix, Outcome, CellState
from envcompat.errors import DefinitionError

DIMENSIONS_INIT = [("os", ["linux", "windows"]), ("browser", ["chrome", "firefox"])]
GROUPS = ["g1"]
CASES = [("c1", "g1"), ("c2", "g1"), ("c3", "g1")]
SOURCES = ["ci-a", "ci-b"]


def make_runner():
    return CompatibilityRunner(DIMENSIONS_INIT, groups=GROUPS, cases=CASES)


def evolve(dimensions, rng):
    """对维度定义做一次“新增 / 删除 / 改名”演变，返回新定义（可能与旧相同）。"""
    dims = [list(d) for d in dimensions]
    dims = [[name, list(vals)] for name, vals in dims]
    choice = rng.randrange(4)
    if choice == 0:  # 给某个维度加一个新取值
        i = rng.randrange(len(dims))
        candidate = f"new-{dims[i][0]}-{rng.randrange(1000)}"
        dims[i][1].append(candidate)
    elif choice == 1 and any(len(v) > 1 for _, v in dims):  # 删掉一个取值
        i = rng.choice([k for k, (_, v) in enumerate(dims) if len(v) > 1])
        del dims[i][1][rng.randrange(len(dims[i][1]))]
    elif choice == 2:  # 改名（等价于删旧 + 增新）
        i = rng.randrange(len(dims))
        j = rng.randrange(len(dims[i][1]))
        dims[i][1][j] = f"{dims[i][1][j]}-r{rng.randrange(1000)}"
    # choice == 3: 不变
    return [(name, values) for name, values in dims]


class TestIncrementalRebuild(unittest.TestCase):
    def test_add_value_only_affects_new_combinations(self):
        r = make_runner()
        r.record("c1", ("linux", "chrome"), "pass", source="ci-a")
        r.record("c2", ("linux", "chrome"), "fail", source="ci-a")
        r.mark_unavailable(("windows", "firefox"), "离线")

        before = r.fingerprint()
        change = r.rebuild_matrix([
            ("os", ["linux", "windows", "mac"]),
            ("browser", ["chrome", "firefox"]),
        ])
        after = r.fingerprint()

        # 2×2=4 个旧组合，3×2=6 个新组合，新增 2 个。
        self.assertEqual(len(change.unchanged), 4)
        self.assertEqual(len(change.added), 2)
        self.assertEqual(len(change.removed), 0)
        # 未受影响组合：逐格指纹完全相同。
        for sig in change.unchanged:
            self.assertEqual(before[sig], after[sig])
        # 新组合上的用例处于待上报。
        s = r.summary()
        self.assertEqual(s.total_cells, 6 * 3)
        new_combos = [x for x in s.by_combo if x.combination.coords[0] == "mac"]
        self.assertEqual(len(new_combos), 2)
        self.assertTrue(all(x.pending == 3 for x in new_combos))
        # 未受影响组合的待上报数维持原样（linux/chrome 上 c3 仍待上报等）。
        old_pending = sum(
            x.pending for x in s.by_combo if x.combination.coords[0] != "mac"
        )
        self.assertEqual(old_pending, 7)

    def test_existing_conclusions_survive_rebuild(self):
        r = make_runner()
        r.record("c1", ("linux", "chrome"), "fail", source="ci-a")
        r.record("c1", ("linux", "chrome"), "pass", source="ci-b")  # 冲突
        r.rebuild_matrix([("os", ["linux", "windows", "mac"]),
                          ("browser", ["chrome", "firefox"])])
        self.assertIs(r.cell_state("c1", ("linux", "chrome")), CellState.CONFLICTED)
        self.assertEqual(len(r.conflicts()), 1)

    def test_remove_value_drops_its_combinations(self):
        r = make_runner()
        r.record("c1", ("windows", "chrome"), "pass", source="ci-a")
        change = r.rebuild_matrix([("os", ["linux"]),
                                   ("browser", ["chrome", "firefox"])])
        self.assertEqual(len(change.removed), 2)       # windows/* 消失
        self.assertEqual(len(change.unchanged), 2)     # linux/* 保留
        s = r.summary()
        self.assertEqual(s.total_cells, 2 * 3)
        self.assertEqual(s.passed, 0)                  # windows 上的通过随之失效

    def test_rename_value_is_remove_plus_add(self):
        r = make_runner()
        r.record("c1", ("linux", "chrome"), "pass", source="ci-a")
        change = r.rebuild_matrix([
            ("os", ["ubuntu", "windows"]),
            ("browser", ["chrome", "firefox"]),
        ])
        self.assertIn("linux", "".join(sorted(change.removed)))
        # 旧 linux 组合签名已消失。
        self.assertEqual(len(change.unchanged), 2)     # windows/* 仍在

    def test_invalid_new_matrix_rejected_without_state_change(self):
        r = make_runner()
        r.record("c1", ("linux", "chrome"), "pass", source="ci-a")
        before = r.fingerprint()
        with self.assertRaises(DefinitionError):
            r.rebuild_matrix([("os", ["linux", "linux"])])  # 重复取值
        after = r.fingerprint()
        self.assertEqual(before, after, "非法变更必须整体拒绝，现状不变")
        # 原矩阵仍可正常使用。
        self.assertEqual(len(r.matrix.combinations), 4)

    def test_event_log_replay_matches_incremental(self):
        r = make_runner()
        r.record("c1", ("linux", "chrome"), "pass", source="ci-a")
        r.record("c2", ("windows", "chrome"), "fail", source="ci-a")
        r.mark_unavailable(("windows", "firefox"), "断电")
        r.rebuild_matrix([("os", ["linux", "windows", "mac"]),
                          ("browser", ["chrome", "firefox"])])
        r.record("c3", ("mac", "firefox"), "timeout", source="ci-b")
        r.record("c1", ("linux", "chrome"), "fail", source="ci-b")  # 冲突
        ok, incremental, from_scratch = r.verify_equivalence()
        self.assertTrue(ok)
        self.assertEqual(incremental, from_scratch)


class TestRandomizedEquivalence(unittest.TestCase):
    """性质测试：随机事件序列下，增量汇总始终等于从头重算。"""

    def _reference_runner(self, script, dim0, groups, cases_init):
        """用公开 API 按脚本从头再跑一遍，作为独立的第二实现路径。"""
        ref = CompatibilityRunner(Matrix(dim0), groups=list(groups), cases=list(cases_init))
        for op in script:
            kind = op[0]
            if kind == "record":
                _, case_id, coords, outcome, source, reason = op
                try:
                    ref.record(case_id, coords, outcome, source=source, reason=reason)
                except Exception:
                    pass  # 两边都可能因“不可用后补报/组合消失”而拒绝，忽略即可
            elif kind == "unavailable":
                _, coords, reason = op
                try:
                    ref.mark_unavailable(coords, reason)
                except Exception:
                    pass
            elif kind == "rebuild":
                try:
                    ref.rebuild_matrix(op[1])
                except DefinitionError:
                    pass
        return ref

    def test_random_scripts(self):
        rng = random.Random(20260916)
        for trial in range(60):
            dimensions = [list(d) for d in DIMENSIONS_INIT]
            r = make_runner()
            script = []
            for _ in range(rng.randrange(1, 40)):
                matrix = Matrix([(n, list(v)) for n, v in dimensions])
                combo = rng.choice(matrix.combinations).coords
                case_id = rng.choice(CASES)[0]
                roll = rng.random()
                if roll < 0.6:
                    outcome = rng.choice(["pass", "fail", "timeout", "skipped"])
                    source = rng.choice(SOURCES)
                    reason = rng.choice(["", "断言失败", "超时", "依赖缺失"])
                    try:
                        r.record(case_id, combo, outcome, source=source, reason=reason)
                        script.append(("record", case_id, combo, outcome, source, reason))
                    except Exception:
                        pass
                elif roll < 0.8:
                    try:
                        r.mark_unavailable(combo, f"环境不可用-{trial}")
                        script.append(("unavailable", combo, f"环境不可用-{trial}"))
                    except Exception:
                        pass
                else:
                    candidate = evolve([(n, list(v)) for n, v in dimensions], rng)
                    try:
                        r.rebuild_matrix(candidate)
                        dimensions = candidate
                        script.append(("rebuild", candidate))
                    except DefinitionError:
                        pass

            # 终态三方可比对：增量、事件日志重放、公开 API 从头重放。
            ok, incremental, from_log = r.verify_equivalence()
            self.assertTrue(ok, f"trial {trial}: 增量与事件日志重放不一致")
            ref = self._reference_runner(script, DIMENSIONS_INIT, GROUPS, CASES)
            self.assertEqual(
                incremental, ref.summary(),
                f"trial {trial}: 增量与公开 API 全量重建不一致",
            )


if __name__ == "__main__":
    unittest.main()
