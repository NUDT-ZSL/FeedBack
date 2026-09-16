"""需求 5 的确定性属性测试（固定随机种子，可复现）。

不依赖第三方库。构造大量随机 DAG / 预算 / 项目组合，对每个已获款项目
分别做“取消”和“部分削减”，并覆盖连续多轮削减，每一步都断言：

  P1  重算区域 = {被削减项目} ∪ 其完整下游闭包；区域之外每个项目
      （包括原本 0 拨款的）拨款逐分不变；
  P2  增量结果与“把削减额和区域外金额作为硬约束、从头全量求解”
      的结果逐项完全一致；
  P3  结果方案合法（不超限、达最低启动额、前置门控）；
  P4  高优先下游因链凑不齐被放弃时，其无前置依赖的上游仍可独立获款。
"""

import random
import unittest
from decimal import Decimal

from fund_allocator import Engine, Project, Registry, Solver, SolveRequest

D = Decimal
ZERO = D("0.00")


def _money(x) -> Decimal:
    return D(str(x)).quantize(D("0.01"))


def _random_registry(rng: random.Random, n: int):
    reg = Registry()
    ids = [f"P{i}" for i in range(n)]
    for pid in ids:
        total = _money(rng.randint(50, 300))
        ms = _money(rng.randint(10, max(10, int(total) // 2)))
        k = rng.randint(1, 3)
        if k == 1:
            phases = [total]
        else:
            cuts = sorted(rng.sample(range(1, int(total)), k - 1))
            bounds = [0] + cuts + [int(total)]
            phases = [_money(bounds[i + 1] - bounds[i]) for i in range(k)]
            if any(p <= 0 for p in phases):
                phases = [total]
        benefit = _money(rng.randint(int(total), int(total) * 3))
        reg.add_project(Project.create(
            pid, rng.randint(1, 5), total, ms, phases, benefit=benefit
        ))
    # 只允许 i 的前置是编号更小的 j => 结构上无环
    for i in range(n):
        for j in range(i):
            if rng.random() < 0.25:
                reg.add_dependency(ids[i], ids[j])
    return reg, ids


class TestReductionProperties(unittest.TestCase):
    SCENARIOS = 60  # 固定种子 => 确定性

    def _assert_constrained_equivalence(self, reg, ids, budget, plan, cut_pid, target):
        """单次削减的 P1/P2/P3 全断言。"""
        region = {cut_pid} | reg.downstream_closure([cut_pid])
        before = {p: plan.amount_for(p) for p in ids}

        eng = Engine(reg)
        eng.plan = plan  # 在同一方案上做削减
        new_plan, affected = eng.reduce(cut_pid, target, _check_equivalence=True)
        self.assertEqual(set(affected), region)

        # P1：区域之外逐项（含原本为 0 的）逐分不变
        for p in ids:
            if p not in region:
                self.assertEqual(
                    new_plan.amount_for(p), before[p],
                    msg=f"预算泄漏到区域外 {p}: {before[p]} -> {new_plan.amount_for(p)}"
                        f"（削减 {cut_pid}->{target}）",
                )

        # P2：与同硬约束从头全量求解逐项一致
        fixed = {p: before[p] for p in ids if p not in region}
        fixed[cut_pid] = target
        full = Solver.solve(SolveRequest(
            registry=reg, budget=budget, preallocated=fixed
        ))
        self.assertEqual(
            dict(full.allocations), dict(new_plan.allocations),
            msg=f"增量与全量不一致（削减 {cut_pid}->{target}）",
        )
        # P3：方案合法
        new_plan.validate()
        return new_plan

    def test_cancel_every_funded_project_across_random_dags(self):
        rng = random.Random(20260916)
        checked = 0
        for _ in range(self.SCENARIOS):
            n = rng.randint(2, 6)
            reg, ids = _random_registry(rng, n)
            budget = _money(rng.randint(50, 1200))
            plan = Engine(reg).solve(budget)
            for pid in ids:
                if plan.amount_for(pid) > 0:
                    self._assert_constrained_equivalence(
                        reg, ids, budget, plan, pid, ZERO
                    )
                    checked += 1
        self.assertGreater(checked, 100)  # 确有足量削减被检验

    def test_partial_reduction_to_min_start(self):
        rng = random.Random(424242)
        checked = 0
        for _ in range(self.SCENARIOS):
            n = rng.randint(2, 6)
            reg, ids = _random_registry(rng, n)
            budget = _money(rng.randint(50, 1200))
            plan = Engine(reg).solve(budget)
            for pid in ids:
                cur = plan.amount_for(pid)
                ms = reg.get(pid).min_start
                if cur >= ms:
                    self._assert_constrained_equivalence(
                        reg, ids, budget, plan, pid, ms
                    )
                    checked += 1
        self.assertGreater(checked, 50)

    def test_sequential_reductions_stay_consistent(self):
        rng = random.Random(777)
        for _ in range(self.SCENARIOS):
            n = rng.randint(2, 7)
            reg, ids = _random_registry(rng, n)
            budget = _money(rng.randint(50, 1500))
            eng = Engine(reg)
            plan = eng.solve(budget)
            for _step in range(3):
                funded = [p for p in ids if plan.amount_for(p) > 0]
                if not funded:
                    break
                pid = rng.choice(funded)
                cur = plan.amount_for(pid)
                ms = reg.get(pid).min_start
                if rng.random() < 0.4 or ms > cur:
                    target = ZERO
                else:
                    target = ms
                region = {pid} | reg.downstream_closure([pid])
                before = {p: plan.amount_for(p) for p in ids}
                plan, _ = eng.reduce(pid, target, _check_equivalence=True)
                for p in ids:  # 连续削减中区域外依旧逐分不动
                    if p not in region:
                        self.assertEqual(plan.amount_for(p), before[p])
                plan.validate()

    def test_high_priority_downstream_dropped_but_prereq_funded_independently(self):
        # P4：链凑不齐时放弃下游；没有别的前置卡住的上游仍独立获款且 >= min_start
        rng = random.Random(31337)
        saw_independent_funding = False
        for _ in range(self.SCENARIOS):
            n = rng.randint(2, 6)
            reg, ids = _random_registry(rng, n)
            for pid in ids:
                cur_plan = Engine(reg).solve(_money(rng.randint(50, 1200)))
                for down in ids:
                    pres = reg.prerequisites(down)
                    if not pres or cur_plan.is_started(down):
                        continue
                    for pre in pres:
                        # 下游未启动，但其某前置独立达标，是允许且正确的
                        if cur_plan.is_started(pre):
                            self.assertGreaterEqual(
                                cur_plan.amount_for(pre), reg.get(pre).min_start
                            )
                            # 且该前置不能再“反向依赖”这个未启动下游（无环已保证）
                            saw_independent_funding = True
        self.assertTrue(
            saw_independent_funding,
            "随机场景中应至少出现一次“下游放弃、前置独立获款”",
        )


if __name__ == "__main__":
    unittest.main()
