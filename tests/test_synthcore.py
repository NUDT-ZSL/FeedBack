"""synthcore 单元测试(仅标准库 unittest,可离线运行)。

运行: python -m unittest discover -s tests -v
"""
import json
import random
import unittest
from fractions import Fraction

from synthcore import (
    CycleError,
    Engine,
    NotFoundError,
    ValidationError,
    dumps,
    load,
    replace_state,
)


def snapshot(eng):
    """抓取全部派生状态,用于增量 vs 全量一致性比较。"""
    return {
        "cost": dict(eng._cost),
        "best": dict(eng._best),
        "usable": dict(eng._usable),
        "conflicts": eng.conflicts,
        "unsettled": set(eng._unsettled),
    }


def rebuild_full(eng):
    """用相同基础数据从零构建并全量推导的参照引擎。"""
    ref = Engine()
    for it in eng.items.values():
        ref.add_item(it.id, it.stock)
    for r in eng.recipes.values():
        ref.add_recipe(r.id, list(r.inputs), list(r.outputs))
    ref.full_recompute()
    return ref


# --------------------------------------------------------------------- #
# 需求 1:标识唯一、数量为正整数、非法拒绝并指出位置
# --------------------------------------------------------------------- #
class TestValidation(unittest.TestCase):
    def test_duplicate_item_id(self):
        eng = Engine()
        eng.add_item("a", 1)
        with self.assertRaises(ValidationError):
            eng.add_item("a", 2)

    def test_empty_id_rejected(self):
        eng = Engine()
        with self.assertRaises(ValidationError):
            eng.add_item("")
        with self.assertRaises(ValidationError):
            eng.add_recipe("", {"a": 1}, {"b": 1})

    def test_bad_quantity_rejected_with_position(self):
        eng = Engine()
        eng.add_item("a", 1)
        eng.add_item("b")
        for bad in (0, -3, 1.5, "2", True, None):
            with self.assertRaises(ValidationError) as ctx:
                eng.add_recipe("r1", [("a", 1), ("b", bad)], [("b", 1)])
            msg = str(ctx.exception)
            self.assertIn("r1", msg)
            self.assertIn("inputs[1]", msg, msg)

    def test_bad_output_quantity_position(self):
        eng = Engine()
        eng.add_item("a", 1)
        eng.add_item("b")
        with self.assertRaises(ValidationError) as ctx:
            eng.add_recipe("r2", {"a": 1}, {"b": -1})
        self.assertIn("outputs[0]", str(ctx.exception))

    def test_unknown_item_reference_rejected(self):
        eng = Engine()
        eng.add_item("a", 1)
        with self.assertRaises(ValidationError) as ctx:
            eng.add_recipe("r1", {"a": 1}, {"ghost": 1})
        self.assertIn("ghost", str(ctx.exception))

    def test_duplicate_item_within_list_rejected(self):
        eng = Engine()
        eng.add_item("a", 1)
        with self.assertRaises(ValidationError):
            eng.add_recipe("r1", [("a", 1), ("a", 2)], [("a", 1)])

    def test_empty_io_rejected(self):
        eng = Engine()
        eng.add_item("a", 1)
        with self.assertRaises(ValidationError):
            eng.add_recipe("r1", [], {"a": 1})

    def test_failed_mutation_leaves_state_unchanged(self):
        eng = Engine()
        eng.add_item("a", 1)
        eng.add_recipe("r1", {"a": 1}, {"a": 2})
        before = snapshot(eng)
        with self.assertRaises(ValidationError):
            eng.add_recipe("r2", {"a": 0}, {"a": 1})
        with self.assertRaises(NotFoundError):
            eng.remove_recipe("nope")
        self.assertEqual(snapshot(eng), before)
        self.assertNotIn("r2", eng.recipes)


# --------------------------------------------------------------------- #
# 需求 2:增量重算与从零全量推导一致
# --------------------------------------------------------------------- #
class TestIncrementalConsistency(unittest.TestCase):
    def test_basic_incremental_matches_full(self):
        eng = Engine()
        for iid, stock in [("ore", 5), ("coal", 3), ("ingot", 0), ("plate", 0)]:
            eng.add_item(iid, stock)
        eng.add_recipe("smelt", {"ore": 2, "coal": 1}, {"ingot": 1})
        mid = snapshot(eng)
        eng.add_recipe("press", {"ingot": 2}, {"plate": 1})
        self.assertEqual(snapshot(eng), snapshot(rebuild_full(eng)))
        eng.update_recipe("smelt", {"ore": 1, "coal": 1}, {"ingot": 1})
        self.assertEqual(snapshot(eng), snapshot(rebuild_full(eng)))
        eng.remove_recipe("press")
        self.assertEqual(snapshot(eng), snapshot(rebuild_full(eng)))
        eng.set_stock("ore", 0)
        self.assertEqual(snapshot(eng), snapshot(rebuild_full(eng)))
        # 中间快照不应等于最终状态(确实发生了重算)
        self.assertNotEqual(mid, snapshot(eng))

    def test_incremental_only_touches_affected(self):
        eng = Engine()
        for iid in ("a", "b", "c", "d", "e"):
            eng.add_item(iid, 1)
        eng.add_recipe("r_ab", {"a": 1}, {"b": 1})
        eng.add_recipe("r_cd", {"c": 1}, {"d": 1})
        eng.full_recompute()
        eng.add_recipe("r_de", {"d": 1}, {"e": 1})
        # 受影响的是新配方的输出及其下游;输入 d 及其上游 a/b/c 不受影响
        self.assertEqual(eng.last_affected, frozenset({"e"}))

    def test_cycle_structure_changes_match_full(self):
        # 环结构变化(并入/脱离环状分量)前后,增量与全量逐物品一致
        eng = Engine()
        for iid in ("a", "b", "c", "ore"):
            eng.add_item(iid, 1 if iid == "ore" else 0)
        steps = [
            lambda: eng.add_recipe("r_ab", {"a": 1}, {"b": 1}),
            lambda: eng.add_recipe("r_bc", {"b": 1}, {"c": 1}),
            lambda: eng.add_recipe("r_ca", {"c": 1}, {"a": 1}),  # 成环
            lambda: eng.add_recipe("r_ext", {"ore": 1}, {"b": 1}),  # 环外来源
            lambda: eng.remove_recipe("r_ca"),  # 破环
            lambda: eng.add_recipe("r_ca2", {"c": 1}, {"a": 1}),  # 重新成环
            lambda: eng.update_recipe("r_ext", {"ore": 2}, {"b": 1}),
            lambda: eng.remove_recipe("r_ext"),  # 撤掉环外来源
        ]
        for step in steps:
            step()
            self.assertEqual(snapshot(eng), snapshot(rebuild_full(eng)))

    def test_self_improving_cycle_consistency_across_item_growth(self):
        # 自增殖环(1A->2A)不收敛;物品数增长改变截断深度时,
        # 未收敛物品必须被显式重算,增量与全量保持一致
        eng = Engine()
        eng.add_item("a", 1)
        eng.add_recipe("r_dup", {"a": 1}, {"a": 2})
        eng.add_recipe("r_use", {"a": 1}, {"a": 3})
        for k in range(6):
            eng.add_item(f"extra{k}", 0)  # 改变物品数 -> 截断深度变化
            self.assertEqual(snapshot(eng), snapshot(rebuild_full(eng)))
        # 自增殖环物品被标记为未收敛
        self.assertIn("a", eng._unsettled)

    def test_randomized_ops_match_full_recompute(self):
        rng = random.Random(20260915)
        names = [f"i{k}" for k in range(10)]
        eng = Engine()
        rid_counter = [0]

        def random_pairs():
            pool = sorted(eng.items)
            return [(iid, rng.randint(1, 3))
                    for iid in rng.sample(pool, min(len(pool), rng.randint(1, 2)))]

        for step in range(400):
            op = rng.randrange(5)
            if op == 0 or not eng.items:
                iid = rng.choice(names)
                if iid not in eng.items:
                    eng.add_item(iid, rng.randint(0, 3))
            elif op == 1 and eng.items:
                rid = f"r{rid_counter[0]}"
                rid_counter[0] += 1
                eng.add_recipe(rid, random_pairs(), random_pairs())
            elif op == 2 and eng.recipes:
                eng.remove_recipe(rng.choice(sorted(eng.recipes)))
            elif op == 3 and eng.recipes:
                rid = rng.choice(sorted(eng.recipes))
                eng.update_recipe(rid, random_pairs(), random_pairs())
            elif op == 4 and eng.items:
                eng.set_stock(rng.choice(sorted(eng.items)), rng.randint(0, 3))
            ref = rebuild_full(eng)
            self.assertEqual(
                snapshot(eng), snapshot(ref),
                f"第 {step} 步后增量结果与全量推导不一致",
            )


# --------------------------------------------------------------------- #
# 需求 3:环检测
# --------------------------------------------------------------------- #
class TestCycles(unittest.TestCase):
    def build_cycle(self):
        eng = Engine()
        for iid in ("a", "b", "c"):
            eng.add_item(iid)
        eng.add_recipe("r_ab", {"a": 1}, {"b": 1})
        eng.add_recipe("r_bc", {"b": 1}, {"c": 1})
        eng.add_recipe("r_ca", {"c": 1}, {"a": 1})
        return eng

    def test_pure_cycle_unobtainable_and_reported(self):
        eng = self.build_cycle()
        for iid in ("a", "b", "c"):
            self.assertFalse(eng.craftable(iid))
            self.assertIsNone(eng.best_recipe(iid))
        self.assertEqual(len(eng.conflicts), 1)
        cyc = eng.conflicts[0]
        self.assertEqual(cyc["type"], "cycle")
        self.assertEqual(cyc["items"], ["a", "b", "c"])
        # 环上的配方序列首尾相接
        self.assertEqual(sorted(cyc["recipes"]), ["r_ab", "r_bc", "r_ca"])
        self.assertEqual(cyc["obtainable"], {"a": False, "b": False, "c": False})

    def test_self_loop(self):
        eng = Engine()
        eng.add_item("x")
        eng.add_recipe("r_xx", {"x": 1}, {"x": 2})
        self.assertFalse(eng.craftable("x"))
        self.assertEqual(len(eng.conflicts), 1)
        self.assertEqual(eng.conflicts[0]["items"], ["x"])
        self.assertEqual(eng.conflicts[0]["recipes"], ["r_xx"])

    def test_cycle_broken_by_stock(self):
        eng = self.build_cycle()
        eng.set_stock("a", 1)
        # 环仍被记录;a 由库存获得,b、c 沿 a 的无环来源接续推导获得
        self.assertEqual(len(eng.conflicts), 1)
        for iid in ("a", "b", "c"):
            self.assertTrue(eng.craftable(iid), iid)
        self.assertEqual(
            eng.conflicts[0]["obtainable"], {"a": True, "b": True, "c": True}
        )

    def test_cycle_broken_by_external_recipe(self):
        eng = self.build_cycle()
        eng.add_item("ore", 10)
        eng.add_recipe("r_ext", {"ore": 1}, {"b": 1})
        # b 经环外来源获得,a、c 沿该无环来源接续推导
        for iid in ("a", "b", "c"):
            self.assertTrue(eng.craftable(iid), iid)

    def test_cycle_with_external_source_best_plan(self):
        # 验收用例:环 A->B->C->A 且存在 ore->B
        eng = self.build_cycle()
        eng.add_item("ore", 10)
        eng.add_recipe("r_ext", {"ore": 1}, {"b": 1})
        # B 可合成获得且最优方案走 ore->B
        self.assertEqual(eng.best_recipe("b"), "r_ext")
        self.assertEqual(eng.unit_cost("b"), Fraction(1))
        # C、A 沿该无环来源接续推导
        self.assertEqual(eng.best_recipe("c"), "r_bc")
        self.assertEqual(eng.best_recipe("a"), "r_ca")
        self.assertEqual(eng.unit_cost("a"), Fraction(1))
        # 依赖树终止于库存 ore,不含环引用
        tree = eng.dependency_tree("a")
        self.assertEqual(tree["recipe"], "r_ca")
        c_node = tree["inputs"][0]
        self.assertEqual(c_node["recipe"], "r_bc")
        b_node = c_node["inputs"][0]
        self.assertEqual(b_node["recipe"], "r_ext")
        ore_node = b_node["inputs"][0]
        self.assertEqual(ore_node["item"], "ore")
        self.assertEqual(ore_node["source"], "stock")
        # 环冲突仍然记录,但物品都可获得
        self.assertEqual(len(eng.conflicts), 1)
        self.assertEqual(sorted(eng.conflicts[0]["recipes"]),
                         ["r_ab", "r_bc", "r_ca"])

    def test_breaking_cycle_removes_conflict(self):
        eng = self.build_cycle()
        self.assertEqual(len(eng.conflicts), 1)
        eng.remove_recipe("r_ca")
        self.assertEqual(eng.conflicts, [])

    def test_cycle_formed_incrementally(self):
        eng = Engine()
        for iid in ("a", "b"):
            eng.add_item(iid)
        eng.add_recipe("r_ab", {"a": 1}, {"b": 1})
        self.assertEqual(eng.conflicts, [])
        eng.add_recipe("r_ba", {"b": 1}, {"a": 1})
        self.assertEqual(len(eng.conflicts), 1)
        self.assertFalse(eng.craftable("a"))


# --------------------------------------------------------------------- #
# 需求 4:最优方案选择(成本最小,成本相同按配方标识)
# --------------------------------------------------------------------- #
class TestBestPlan(unittest.TestCase):
    def test_cheaper_recipe_wins(self):
        eng = Engine()
        eng.add_item("ore", 10)
        eng.add_item("ingot")
        eng.add_recipe("r_expensive", {"ore": 3}, {"ingot": 1})
        eng.add_recipe("r_cheap", {"ore": 1}, {"ingot": 1})
        self.assertEqual(eng.best_recipe("ingot"), "r_cheap")
        self.assertEqual(eng.unit_cost("ingot"), Fraction(1))

    def test_tie_broken_by_id_regardless_of_depth(self):
        # 验收用例:同成本、不同推导深度的两条无环配方,按配方标识裁决
        eng = Engine()
        eng.add_item("ore", 10)
        eng.add_item("mid")
        eng.add_item("x")
        # r_z:直接由库存产出(浅),成本 2
        eng.add_recipe("r_z", {"ore": 2}, {"x": 1})
        # r_a:经更长链产出(深),成本同为 2
        eng.add_recipe("r_a", {"mid": 1}, {"x": 1})
        eng.add_recipe("r_m", {"ore": 2}, {"mid": 1})
        self.assertEqual(eng.unit_cost("x"), Fraction(2))
        # 深度不参与裁决,按配方标识取 r_a
        self.assertEqual(eng.best_recipe("x"), "r_a")
        # 依赖树同样按标识裁决的结果展开
        tree = eng.dependency_tree("x")
        self.assertEqual(tree["recipe"], "r_a")
        self.assertEqual(tree["inputs"][0]["item"], "mid")
        self.assertEqual(tree["inputs"][0]["recipe"], "r_m")

    def test_tie_broken_by_recipe_id(self):
        eng = Engine()
        eng.add_item("ore", 10)
        eng.add_item("ingot")
        eng.add_recipe("r_z", {"ore": 2}, {"ingot": 1})
        eng.add_recipe("r_a", {"ore": 2}, {"ingot": 1})
        self.assertEqual(eng.best_recipe("ingot"), "r_a")
        # 反向顺序添加结果不变
        eng2 = Engine()
        eng2.add_item("ore", 10)
        eng2.add_item("ingot")
        eng2.add_recipe("r_a", {"ore": 2}, {"ingot": 1})
        eng2.add_recipe("r_z", {"ore": 2}, {"ingot": 1})
        self.assertEqual(eng2.best_recipe("ingot"), "r_a")

    def test_output_quantity_normalizes_cost(self):
        eng = Engine()
        eng.add_item("ore", 10)
        eng.add_item("ingot")
        eng.add_recipe("r_bulk", {"ore": 4}, {"ingot": 4})  # 单位成本 1
        eng.add_recipe("r_single", {"ore": 2}, {"ingot": 1})  # 单位成本 2
        self.assertEqual(eng.best_recipe("ingot"), "r_bulk")
        self.assertEqual(eng.unit_cost("ingot"), Fraction(1))

    def test_fractional_cost_exact(self):
        eng = Engine()
        eng.add_item("ore", 10)
        eng.add_item("shard")
        eng.add_recipe("r_crush", {"ore": 1}, {"shard": 3})
        self.assertEqual(eng.unit_cost("shard"), Fraction(1, 3))

    def test_stock_preferred_on_equal_cost(self):
        eng = Engine()
        eng.add_item("a", 1)  # 库存单位成本 1
        eng.add_item("b")
        eng.add_recipe("r1", {"b": 1}, {"a": 1})  # 若 b 免费则成本 0... b 无库存
        # b 不可获得 -> a 只能来自库存
        self.assertEqual(eng.source("a"), "stock")
        eng.add_item("c", 5)
        eng.add_recipe("r2", {"c": 1}, {"b": 1})
        # 现在 r1 成本为 1,与库存相同 -> 优先库存
        self.assertEqual(eng.source("a"), "stock")
        eng.add_recipe("r3", {"c": 1}, {"a": 2})  # 单位成本 1/2,更便宜
        self.assertEqual(eng.source("a"), "recipe")
        self.assertEqual(eng.best_recipe("a"), "r3")


# --------------------------------------------------------------------- #
# 需求 5:失效配方标记 + 缺失输入链 + 备选配方
# --------------------------------------------------------------------- #
class TestUnusableRecipes(unittest.TestCase):
    def setUp(self):
        eng = Engine()
        eng.add_item("ore", 10)
        for iid in ("ingot", "plate", "gear", "widget", "magic_dust"):
            eng.add_item(iid)
        eng.add_recipe("r_smelt", {"ore": 2}, {"ingot": 1})
        eng.add_recipe("r_press", {"ingot": 1}, {"plate": 1})
        eng.add_recipe("r_cut", {"plate": 1}, {"gear": 1})
        eng.add_recipe("r_widget_gear", {"gear": 1}, {"widget": 1})
        eng.add_recipe("r_widget_magic", {"magic_dust": 1}, {"widget": 1})
        self.eng = eng

    def test_unusable_recipe_flagged(self):
        eng = self.eng
        self.assertFalse(eng.recipe_usable("r_widget_magic"))
        self.assertTrue(eng.recipe_usable("r_widget_gear"))

    def test_missing_chain_reported(self):
        eng = self.eng
        status = eng.recipe_status("r_widget_magic")
        self.assertFalse(status["usable"])
        missing = status["missing"]
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0]["item"], "magic_dust")
        self.assertIn("无库存", missing[0]["cause"])

    def test_deep_missing_chain(self):
        eng = self.eng
        eng.set_stock("ore", 0)  # 整条链断裂
        status = eng.recipe_status("r_widget_gear")
        self.assertFalse(status["usable"])
        gear = status["missing"][0]
        self.assertEqual(gear["item"], "gear")
        plate = gear["candidates"][0]["missing"][0]
        self.assertEqual(plate["item"], "plate")
        ingot = plate["candidates"][0]["missing"][0]
        self.assertEqual(ingot["item"], "ingot")
        ore = ingot["candidates"][0]["missing"][0]
        self.assertEqual(ore["item"], "ore")
        self.assertIn("无库存", ore["cause"])

    def test_fallback_to_alternative_recipe(self):
        eng = self.eng
        # 主配方可用时选最便宜的
        self.assertEqual(eng.best_recipe("widget"), "r_widget_gear")
        # 让 gear 链断裂 -> 主配方失效,此时无可用配方
        eng.set_stock("ore", 0)
        self.assertIsNone(eng.best_recipe("widget"))
        # 提供备选配方的输入 -> 自动切换到备选
        eng.set_stock("magic_dust", 1)
        self.assertEqual(eng.best_recipe("widget"), "r_widget_magic")
        self.assertTrue(eng.recipe_usable("r_widget_magic"))

    def test_cycle_missing_chain_terminates(self):
        eng = Engine()
        eng.add_item("a")
        eng.add_item("b")
        eng.add_recipe("r_ab", {"a": 1}, {"b": 1})
        eng.add_recipe("r_ba", {"b": 1}, {"a": 1})
        status = eng.recipe_status("r_ab")
        chain = status["missing"][0]
        # 沿 candidates 向下最终命中 cycle 标记,不会死循环
        node = chain
        while "candidates" in node:
            node = node["candidates"][0]["missing"][0]
        self.assertEqual(node["cause"], "cycle")


# --------------------------------------------------------------------- #
# 需求 6:查询
# --------------------------------------------------------------------- #
class TestQueries(unittest.TestCase):
    def setUp(self):
        eng = Engine()
        eng.add_item("ore", 100)
        eng.add_item("coal", 100)
        for iid in ("ingot", "plate", "gear"):
            eng.add_item(iid)
        eng.add_recipe("r_smelt", {"ore": 2, "coal": 1}, {"ingot": 1})
        eng.add_recipe("r_press", {"ingot": 2}, {"plate": 1})
        eng.add_recipe("r_cut", {"plate": 1}, {"gear": 2})
        self.eng = eng

    def test_best_plan(self):
        plan = self.eng.best_plan("gear")
        self.assertEqual(plan["source"], "recipe")
        self.assertEqual(plan["recipe"], "r_cut")
        # ingot 成本 = 2*1+1 = 3; plate = 2*3 = 6; gear = 6/2 = 3
        self.assertEqual(plan["cost"], Fraction(3))

    def test_dependency_tree(self):
        tree = self.eng.dependency_tree("gear")
        self.assertEqual(tree["source"], "recipe")
        self.assertEqual(tree["recipe"], "r_cut")
        plate = tree["inputs"][0]
        self.assertEqual(plate["recipe"], "r_press")
        leaves = {n["item"] for n in plate["inputs"][0]["inputs"]}
        self.assertEqual(leaves, {"ore", "coal"})
        for n in plate["inputs"][0]["inputs"]:
            self.assertEqual(n["source"], "stock")

    def test_dependency_tree_unobtainable(self):
        eng = Engine()
        eng.add_item("x")
        tree = eng.dependency_tree("x")
        self.assertIsNone(tree["source"])

    def test_transitive_inputs(self):
        result = self.eng.transitive_inputs("r_cut")
        # 1 plate -> 2 ingot -> 4 ore + 2 coal
        self.assertEqual(result["raw"], {"ore": Fraction(4), "coal": Fraction(2)})
        self.assertEqual(result["missing"], {})

    def test_transitive_inputs_with_missing(self):
        eng = Engine()
        eng.add_item("ore", 5)
        eng.add_item("ingot")
        eng.add_item("magic")
        eng.add_recipe("r1", {"ore": 1, "magic": 2}, {"ingot": 1})
        result = eng.transitive_inputs("r1")
        self.assertEqual(result["raw"], {"ore": Fraction(1)})
        self.assertEqual(result["missing"], {"magic": Fraction(2)})

    def test_relation(self):
        eng = self.eng
        self.assertEqual(eng.relation("gear", "ore"), "a_depends_on_b")
        self.assertEqual(eng.relation("ore", "gear"), "b_depends_on_a")
        self.assertEqual(eng.relation("ore", "coal"), "none")

    def test_relation_cyclic(self):
        eng = Engine()
        eng.add_item("a")
        eng.add_item("b")
        eng.add_recipe("r_ab", {"a": 1}, {"b": 1})
        eng.add_recipe("r_ba", {"b": 1}, {"a": 1})
        self.assertEqual(eng.relation("a", "b"), "cyclic")

    def test_relation_unknown_item(self):
        eng = self.eng
        with self.assertRaises(NotFoundError):
            eng.relation("gear", "nope")


# --------------------------------------------------------------------- #
# 需求 7:导出 / 载入
# --------------------------------------------------------------------- #
class TestPersistence(unittest.TestCase):
    def build_engine(self):
        eng = Engine()
        eng.add_item("ore", 10)
        eng.add_item("ingot")
        eng.add_item("plate")
        eng.add_recipe("r_smelt", {"ore": 2}, {"ingot": 1})
        eng.add_recipe("r_press", {"ingot": 2}, {"plate": 1})
        return eng

    def test_round_trip(self):
        eng = self.build_engine()
        text = dumps(eng)
        loaded = load(text)
        self.assertEqual(snapshot(eng), snapshot(loaded))
        self.assertEqual(eng.items, loaded.items)
        self.assertEqual(eng.recipes, loaded.recipes)

    def test_export_contains_derived_data(self):
        data = json.loads(dumps(self.build_engine()))
        self.assertIn("derived", data)
        self.assertIn("best", data["derived"])
        self.assertIn("conflicts", data["derived"])
        self.assertEqual(data["derived"]["best"]["plate"]["recipe"], "r_press")
        # 库存也可导出
        ore = next(i for i in data["items"] if i["id"] == "ore")
        self.assertEqual(ore["stock"], 10)

    def test_load_rejects_bad_json(self):
        with self.assertRaises(ValidationError):
            load("{not json")

    def test_load_rejects_missing_fields(self):
        with self.assertRaises(ValidationError) as ctx:
            load({"items": []})
        self.assertIn("recipes", str(ctx.exception))

    def test_load_rejects_duplicate_ids(self):
        data = {"items": [{"id": "a", "stock": 0}, {"id": "a", "stock": 1}],
                "recipes": []}
        with self.assertRaises(ValidationError) as ctx:
            load(data)
        self.assertIn("重复", str(ctx.exception))

    def test_load_rejects_bad_quantity_with_position(self):
        data = {
            "items": [{"id": "a", "stock": 1}, {"id": "b", "stock": 0}],
            "recipes": [{"id": "r1",
                         "inputs": [{"item": "a", "qty": 1}],
                         "outputs": [{"item": "b", "qty": 0}]}],
        }
        with self.assertRaises(ValidationError) as ctx:
            load(data)
        self.assertIn("recipes[0].outputs[0].qty", str(ctx.exception))

    def test_load_rejects_dangling_reference(self):
        data = {
            "items": [{"id": "a", "stock": 1}],
            "recipes": [{"id": "r1",
                         "inputs": [{"item": "ghost", "qty": 1}],
                         "outputs": [{"item": "a", "qty": 1}]}],
        }
        with self.assertRaises(ValidationError) as ctx:
            load(data)
        self.assertIn("ghost", str(ctx.exception))

    def test_load_rejects_bad_stock(self):
        data = {"items": [{"id": "a", "stock": -1}], "recipes": []}
        with self.assertRaises(ValidationError):
            load(data)

    def test_failed_replace_leaves_state_unchanged(self):
        eng = self.build_engine()
        before = snapshot(eng)
        bad = {"items": [{"id": "x", "stock": "lots"}], "recipes": []}
        with self.assertRaises(ValidationError):
            replace_state(eng, bad)
        self.assertEqual(snapshot(eng), before)
        self.assertEqual(eng.best_recipe("plate"), "r_press")

    def test_strict_cycles_rejected(self):
        data = {
            "items": [{"id": "a", "stock": 0}, {"id": "b", "stock": 0}],
            "recipes": [
                {"id": "r_ab", "inputs": [{"item": "a", "qty": 1}],
                 "outputs": [{"item": "b", "qty": 1}]},
                {"id": "r_ba", "inputs": [{"item": "b", "qty": 1}],
                 "outputs": [{"item": "a", "qty": 1}]},
            ],
        }
        with self.assertRaises(CycleError) as ctx:
            load(data, strict_cycles=True)
        self.assertIn("r_ab", str(ctx.exception))
        # 非严格模式:环被记录为冲突,物品不可获得
        eng = load(data)
        self.assertEqual(len(eng.conflicts), 1)
        self.assertFalse(eng.craftable("a"))

    def test_derived_field_ignored_on_load(self):
        # 载入以 items/recipes 为唯一事实来源,derived 即使被篡改也不影响结果
        data = json.loads(dumps(self.build_engine()))
        data["derived"]["best"]["plate"]["recipe"] = "fake"
        eng = load(data)
        self.assertEqual(eng.best_recipe("plate"), "r_press")


if __name__ == "__main__":
    unittest.main()
