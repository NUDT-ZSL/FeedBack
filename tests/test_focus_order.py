"""focus_order 的离线验收测试。

运行方式（仓库根目录，无需任何第三方依赖）::

    python -m unittest discover -s tests -t . -v

用例与需求逐条对应：

* :class:`Requirement1Test` 元素/关系维护与重复配置冲突
* :class:`Requirement2Test` 方向推进拒绝原因与焦点不变
* :class:`Requirement3Test` 可预测性 / 与配置到达顺序无关
* :class:`Requirement4Test` 环检测、环报告与环路推进拒绝
* :class:`Requirement5Test` 容器接管、焦点陷阱与结束恢复
* :class:`Requirement6Test` 动态增删的增量一致性
* :class:`Requirement7Test` 稳定查询 / 历史 / 最近拒绝原因
"""

import itertools
import unittest

from focus_order import (
    DEFAULT_DIRECTIONS,
    ErrorCode,
    FocusEngine,
    FocusError,
    RejectCode,
)


def build(elements, relations=(), directions=DEFAULT_DIRECTIONS, focus=None):
    """按给定终态配置直接构建一台引擎。"""
    engine = FocusEngine(directions)
    engine.configure(elements=elements, relations=relations)
    if focus is not None:
        engine.set_focus(focus)
    return engine


FORM = "form"
DIALOG = "dialog"
DIALOG2 = "dialog2"


def std_elements():
    return [
        {"id": "a", "container": FORM},
        {"id": "b", "container": FORM},
        {"id": "c", "container": FORM, "disabled": True},
        {"id": "d", "container": FORM, "focusable": False},
    ]


# ---------------------------------------------------------------------------
# 需求 1：元素与顺序关系维护
# ---------------------------------------------------------------------------


class Requirement1Test(unittest.TestCase):
    def test_add_elements_and_query_fields(self):
        engine = build(std_elements(), focus="a")
        self.assertTrue(engine.is_focusable("a"))
        self.assertFalse(engine.is_focusable("c"))  # 禁用
        self.assertFalse(engine.is_focusable("d"))  # 不可聚焦
        self.assertEqual(engine.get_container("b"), FORM)
        self.assertEqual(engine.get_element("c")["usable"], False)

    def test_duplicate_element_rejected(self):
        engine = FocusEngine()
        engine.add_element("a", FORM)
        with self.assertRaises(FocusError) as ctx:
            engine.add_element("a", FORM)
        self.assertEqual(ctx.exception.code, ErrorCode.DUPLICATE_ELEMENT)
        self.assertEqual(ctx.exception.context["id"], "a")

    def test_missing_element_raises_not_found(self):
        engine = FocusEngine()
        with self.assertRaises(FocusError) as ctx:
            engine.is_focusable("ghost")
        self.assertEqual(ctx.exception.code, ErrorCode.ELEMENT_NOT_FOUND)

    def test_relation_conflict_same_direction_reports_direction(self):
        engine = build(std_elements(), [("a", "right", "b")])
        with self.assertRaises(FocusError) as ctx:
            engine.add_relation("a", "right", "c")
        err = ctx.exception
        self.assertEqual(err.code, ErrorCode.RELATION_CONFLICT)
        # 必须指出冲突方向、既有目标与新目标
        self.assertEqual(err.context["direction"], "right")
        self.assertEqual(err.context["existing_target"], "b")
        self.assertEqual(err.context["new_target"], "c")
        self.assertIn("right", str(err))

    def test_identical_relation_is_still_duplicate_config(self):
        # 即使新目标与既有目标相同，重复配置也必须拒绝（每方向至多一个目标）
        engine = build(std_elements(), [("a", "right", "b")])
        with self.assertRaises(FocusError) as ctx:
            engine.add_relation("a", "right", "b")
        self.assertEqual(ctx.exception.code, ErrorCode.RELATION_CONFLICT)

    def test_other_directions_independent(self):
        # 同一元素不同方向可以各指一个目标
        engine = build(std_elements())
        engine.add_relation("a", "right", "b")
        engine.add_relation("a", "left", "c")
        self.assertEqual(engine.get_target("a", "right"), "b")
        self.assertEqual(engine.get_target("a", "left"), "c")

    def test_relation_with_missing_endpoint_rejected(self):
        engine = build(std_elements())
        with self.assertRaises(FocusError) as ctx:
            engine.add_relation("a", "right", "ghost")
        self.assertEqual(ctx.exception.code, ErrorCode.RELATION_TARGET_MISSING)
        with self.assertRaises(FocusError) as ctx:
            engine.add_relation("ghost", "right", "a")
        self.assertEqual(ctx.exception.code, ErrorCode.RELATION_SOURCE_MISSING)
        # 失败的配置不得留下残边
        self.assertEqual(engine.relations_of("a"), [])

    def test_unknown_direction_rejected_at_config_time(self):
        engine = build(std_elements())
        with self.assertRaises(FocusError) as ctx:
            engine.add_relation("a", "diagonal", "b")
        self.assertEqual(ctx.exception.code, ErrorCode.UNKNOWN_DIRECTION)

    def test_configure_is_atomic_on_failure(self):
        engine = build(std_elements(), [("a", "right", "b")], focus="a")
        before = engine.graph_snapshot()
        with self.assertRaises(FocusError):
            engine.configure(
                elements=[{"id": "z", "container": FORM}],
                relations=[
                    ("z", "right", "a"),
                    ("z", "right", "b"),  # 同方向冲突 -> 整批回滚
                ],
            )
        self.assertEqual(engine.graph_snapshot(), before)
        with self.assertRaises(FocusError):
            engine.get_element("z")


# ---------------------------------------------------------------------------
# 需求 2：推进拒绝原因与焦点保持
# ---------------------------------------------------------------------------


class Requirement2Test(unittest.TestCase):
    def test_move_to_disabled_rejected_and_focus_unchanged(self):
        engine = build(std_elements(), [("a", "right", "c")], focus="a")
        result = engine.advance("right")
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, RejectCode.TARGET_DISABLED)
        self.assertEqual(engine.current_focus, "a")
        self.assertEqual(engine.last_rejection["code"], RejectCode.TARGET_DISABLED)
        self.assertEqual(engine.last_rejection["at"], "a")
        self.assertEqual(engine.last_rejection["target"], "c")
        self.assertTrue(engine.last_rejection["message"])

    def test_move_to_non_focusable_rejected(self):
        engine = build(std_elements(), [("a", "right", "d")], focus="a")
        result = engine.advance("right")
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, RejectCode.TARGET_NOT_FOCUSABLE)
        self.assertEqual(engine.current_focus, "a")

    def test_move_without_relation_rejected(self):
        engine = build(std_elements(), focus="a")
        result = engine.advance("up")
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, RejectCode.NO_RELATION)
        self.assertEqual(engine.current_focus, "a")

    def test_move_unknown_direction_rejected(self):
        engine = build(std_elements(), focus="a")
        result = engine.advance("diagonal")
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, RejectCode.UNKNOWN_DIRECTION)

    def test_move_without_focus_rejected(self):
        engine = build(std_elements())
        result = engine.advance("right")
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, RejectCode.NO_CURRENT_FOCUS)

    def test_dangling_target_rejected_defensively(self):
        # 公共 API 不允许产生悬空关系；这里白-box 注入，验证防御分支
        engine = build(std_elements(), focus="a")
        engine._edges["a"]["right"] = "ghost"
        result = engine.advance("right")
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, RejectCode.TARGET_MISSING)
        self.assertEqual(engine.current_focus, "a")

    def test_successful_move_updates_focus_and_is_repeatable_decision(self):
        engine = build(std_elements(), [("a", "right", "b")], focus="a")
        first = engine.advance("right")
        self.assertTrue(first.accepted)
        self.assertEqual(first.target, "b")
        self.assertEqual(engine.current_focus, "b")
        # b 没有 right 关系：再按一次是稳定的拒绝，焦点仍在 b
        second = engine.advance("right")
        self.assertFalse(second.accepted)
        self.assertEqual(second.code, RejectCode.NO_RELATION)
        self.assertEqual(engine.current_focus, "b")
        # 重复按同一个被拒绝的方向，结果完全一致
        third = engine.advance("right")
        self.assertEqual(third.code, second.code)
        self.assertEqual(engine.current_focus, "b")


# ---------------------------------------------------------------------------
# 需求 3：可预测、不漂移
# ---------------------------------------------------------------------------


def chain_graph():
    elements = [
        {"id": name, "container": FORM} for name in ("a", "b", "c", "d", "e")
    ]
    relations = [
        ("a", "right", "b"),
        ("b", "right", "c"),
        ("c", "right", "d"),
        ("d", "right", "e"),
        ("a", "down", "c"),
        ("c", "down", "e"),
    ]
    return elements, relations


class Requirement3Test(unittest.TestCase):
    def test_final_state_independent_of_arrival_order(self):
        elements, relations = chain_graph()

        def build_in_order(elem_order, rel_order):
            engine = FocusEngine()
            for spec in elem_order:
                engine.add_element(
                    spec["id"],
                    spec["container"],
                    spec.get("focusable", True),
                    spec.get("disabled", False),
                )
            for source, direction, target in rel_order:
                engine.add_relation(source, direction, target)
            engine.set_focus("a")
            return engine

        snapshots = []
        paths = set()
        key_sequence = ("right", "right", "left", "down", "up", "right")
        for elem_perm in itertools.islice(itertools.permutations(elements), 0, 6):
            for rel_perm in itertools.islice(itertools.permutations(relations), 0, 6):
                engine = build_in_order(elem_perm, rel_perm)
                snapshots.append(engine.graph_snapshot())
                path = []
                for key in key_sequence:
                    result = engine.advance(key)
                    path.append((key, result.accepted, result.target, result.code))
                paths.add(tuple(path))
                self.assertEqual(
                    [e["id"] for e in engine.list_elements()],
                    ["a", "b", "c", "d", "e"],
                )
        self.assertTrue(all(s == snapshots[0] for s in snapshots))
        self.assertEqual(len(paths), 1)

    def test_repeated_advance_from_same_state_identical(self):
        elements, relations = chain_graph()
        engine = build(elements, relations, focus="b")
        runs = []
        for _ in range(3):
            e = build(elements, relations, focus="b")
            run = []
            for _ in range(4):
                r = e.advance("right")
                run.append((r.accepted, r.target, r.code))
            runs.append(tuple(run))
        self.assertEqual(len(set(runs)), 1)
        # 一直走到 e 后继续按 right，稳定停在 e
        self.assertEqual(runs[0][-1], (False, None, RejectCode.NO_RELATION))
        self.assertEqual(engine.current_focus, "b")

    def test_fallback_independent_of_lifecycle_history(self):
        # 三台引擎最终配置相同，到达方式不同；焦点丢失后的回退必须一致
        def fresh_without_b():
            # 从头构建：b 从未存在
            engine = FocusEngine()
            for name in ("a", "c", "d"):
                engine.add_element(name, FORM)
            engine.add_relation("a", "right", "c")
            engine.add_relation("c", "right", "d")
            return engine

        def incremental_remove_b():
            engine = FocusEngine()
            for name in ("a", "b", "c", "d"):
                engine.add_element(name, FORM)
            engine.add_relation("a", "right", "b")
            engine.add_relation("b", "right", "c")
            engine.add_relation("c", "right", "d")
            engine.set_focus("b")
            engine.remove_element("b")  # 触发回退
            return engine

        def toggle_disable_b():
            engine = FocusEngine()
            for name in ("a", "b", "c", "d"):
                engine.add_element(name, FORM)
            engine.add_relation("a", "right", "b")
            engine.add_relation("b", "right", "c")
            engine.add_relation("c", "right", "d")
            engine.set_focus("b")
            engine.set_disabled("b", True)  # 触发回退
            engine.set_disabled("b", False)  # 恢复不抢回焦点
            engine.remove_element("b")
            return engine

        e1, e2, e3 = fresh_without_b(), incremental_remove_b(), toggle_disable_b()
        # 不同生命周期到达同一终态：焦点回退结果一致
        self.assertEqual(e2.current_focus, e3.current_focus)
        # 回退取同容器内 id 不大于 b 的最近可用元素 -> a
        self.assertEqual(e2.current_focus, "a")
        # 增量引擎中 a->b 随 b 一并清除，不允许留下指向 b 的边
        self.assertIsNone(e2.get_target("a", "right"))
        self.assertEqual(
            e2.graph_snapshot()["relations"], e3.graph_snapshot()["relations"]
        )
        self.assertEqual(
            e2.graph_snapshot()["relations"], [("c", "right", "d")]
        )
        # “从头重建”语义：以终态快照重建必然与增量状态逐字段一致
        rebuilt = e2.rebuild()
        self.assertEqual(rebuilt.graph_snapshot(), e2.graph_snapshot())
        self.assertEqual(rebuilt.current_focus, "a")
        # 注：e1 表达的是“上游把 a 的目标改配为 c”的另一份终态，
        # 与删除 b 不是同一终态，故不要求关系相同。
        self.assertEqual(e1.get_target("a", "right"), "c")


# ---------------------------------------------------------------------------
# 需求 4：成环检测与报告
# ---------------------------------------------------------------------------


class Requirement4Test(unittest.TestCase):
    def test_report_existing_cycle_normalized(self):
        # 配置顺序是 c->a, b->c, a->b，报告必须规范化为从最小 id 开始
        engine = build(
            [{"id": n, "container": FORM} for n in ("a", "b", "c")],
            [("c", "right", "a"), ("b", "right", "c"), ("a", "right", "b")],
        )
        cycles = engine.find_cycles()
        self.assertEqual(len(cycles), 1)
        self.assertEqual(cycles[0].direction, "right")
        self.assertEqual(cycles[0].nodes, ("a", "b", "c"))
        # 即使从未尝试推进，环也必须能被列出（不静默忽略）

    def test_advance_into_cycle_rejected_with_sequence(self):
        engine = build(
            [{"id": n, "container": FORM} for n in ("a", "b", "c", "d")],
            [
                ("a", "right", "b"),
                ("b", "right", "c"),
                ("c", "right", "a"),
                ("d", "right", "a"),  # 汇入环的尾巴
            ],
            focus="d",
        )
        # 尾巴边本身不在环上：允许走一步到达环口 a（不会形成循环）
        onto = engine.advance("right")
        self.assertTrue(onto.accepted)
        self.assertEqual(onto.target, "a")
        # 环口上的边位于环上：拒绝并报告规范化环序列，焦点停在 a
        result = engine.advance("right")
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, RejectCode.CYCLE)
        self.assertEqual(result.rejection.cycle, ("a", "b", "c"))
        self.assertEqual(engine.current_focus, "a")
        # 环上任意节点推进同样被拒绝，焦点不变
        engine.set_focus("b")
        self.assertEqual(engine.advance("right").code, RejectCode.CYCLE)
        self.assertEqual(engine.current_focus, "b")
        engine.set_focus("c")
        self.assertEqual(engine.advance("right").code, RejectCode.CYCLE)
        self.assertEqual(engine.current_focus, "c")

    def test_successful_advances_never_revisit_a_node(self):
        # 不变量：连续成功推进绝不会重复经过任何节点（无死循环）
        engine = build(
            [{"id": n, "container": FORM} for n in ("a", "b", "c", "d")],
            [
                ("a", "right", "b"),
                ("b", "right", "c"),
                ("c", "right", "a"),
                ("d", "right", "a"),
            ],
            focus="d",
        )
        visited = ["d"]
        for _ in range(10):
            result = engine.advance("right")
            if result.accepted:
                self.assertNotIn(result.target, visited)
                visited.append(result.target)
        self.assertEqual(visited, ["d", "a"])

    def test_cycle_is_per_direction_other_directions_still_move(self):
        engine = build(
            [{"id": n, "container": FORM} for n in ("a", "b", "c")],
            [
                ("a", "down", "b"),
                ("b", "down", "a"),  # down 方向成环
                ("a", "right", "c"),  # right 方向无环
            ],
            focus="a",
        )
        self.assertEqual(engine.advance("down").code, RejectCode.CYCLE)
        moved = engine.advance("right")
        self.assertTrue(moved.accepted)
        self.assertEqual(moved.target, "c")
        down_cycles = engine.find_cycles("down")
        self.assertEqual([c.nodes for c in down_cycles], [("a", "b")])
        self.assertEqual(engine.find_cycles("right"), [])

    def test_multiple_disjoint_cycles_listed_stably(self):
        engine = build(
            [{"id": n, "container": FORM} for n in ("a", "b", "c", "x", "y")],
            [
                ("a", "right", "b"),
                ("b", "right", "a"),
                ("x", "right", "y"),
                ("y", "right", "x"),
                ("c", "right", "a"),
            ],
        )
        cycles = engine.find_cycles("right")
        self.assertEqual([c.nodes for c in cycles], [("a", "b"), ("x", "y")])

    def test_self_loop_is_a_cycle(self):
        engine = build(
            [{"id": "a", "container": FORM}],
            [("a", "right", "a")],
            focus="a",
        )
        self.assertEqual([c.nodes for c in engine.find_cycles()], [("a",)])
        self.assertEqual(engine.advance("right").code, RejectCode.CYCLE)
        self.assertEqual(engine.current_focus, "a")

    def test_acyclic_graph_has_no_cycle(self):
        elements, relations = chain_graph()
        engine = build(elements, relations)
        self.assertEqual(engine.find_cycles(), [])


# ---------------------------------------------------------------------------
# 需求 5：容器接管（弹层焦点陷阱）
# ---------------------------------------------------------------------------


class Requirement5Test(unittest.TestCase):
    def dialog_engine(self):
        return build(
            [
                {"id": "a", "container": FORM},
                {"id": "b", "container": FORM},
                {"id": "d1", "container": DIALOG},
                {"id": "d2", "container": DIALOG},
                {"id": "d3", "container": DIALOG, "disabled": True},
            ],
            [
                ("a", "right", "b"),
                ("d1", "right", "d2"),
                ("d2", "left", "d1"),
                ("d1", "left", "a"),   # 关系指向容器外：接管期间构成逃逸边
                ("d2", "right", "b"),  # 同上
            ],
            focus="a",
        )

    def test_enter_scope_traps_and_restores_focus(self):
        engine = self.dialog_engine()
        entered = engine.enter_scope(DIALOG)
        # 未指定初始焦点：取容器内 id 最小的可用元素
        self.assertEqual(entered, "d1")
        self.assertEqual(engine.active_container, DIALOG)
        self.assertEqual(engine.scope_stack()[0]["return_to"], "a")

        moved = engine.advance("right")
        self.assertTrue(moved.accepted)
        self.assertEqual(moved.target, "d2")

        # 逃逸边必须被拒绝，焦点不得离开容器
        escape = engine.advance("right")  # d2 -> b（form）
        self.assertFalse(escape.accepted)
        self.assertEqual(escape.code, RejectCode.SCOPE_ESCAPE)
        self.assertEqual(engine.current_focus, "d2")
        self.assertEqual(engine.get_element(engine.current_focus)["container"], DIALOG)

        back_left = engine.advance("left")  # d2 -> d1，容器内，允许
        self.assertTrue(back_left.accepted)
        self.assertEqual(engine.current_focus, "d1")
        self.assertEqual(engine.advance("left").code, RejectCode.SCOPE_ESCAPE)

        restored = engine.exit_scope()
        self.assertIsNone(engine.active_container)
        self.assertEqual(restored, "a")
        self.assertEqual(engine.current_focus, "a")

    def test_cannot_set_focus_outside_active_scope(self):
        engine = self.dialog_engine()
        engine.enter_scope(DIALOG)
        with self.assertRaises(FocusError) as ctx:
            engine.set_focus("a")
        self.assertEqual(ctx.exception.code, ErrorCode.INVALID_FOCUS_TARGET)

    def test_scope_lifecycle_errors(self):
        engine = self.dialog_engine()
        with self.assertRaises(FocusError) as ctx:
            engine.exit_scope()
        self.assertEqual(ctx.exception.code, ErrorCode.SCOPE_NOT_ACTIVE)

        engine.enter_scope(DIALOG)
        with self.assertRaises(FocusError) as ctx:
            engine.enter_scope(DIALOG)
        self.assertEqual(ctx.exception.code, ErrorCode.SCOPE_ALREADY_ACTIVE)

        with self.assertRaises(FocusError) as ctx:
            engine.exit_scope(FORM)
        self.assertEqual(ctx.exception.code, ErrorCode.SCOPE_MISMATCH)

    def test_enter_scope_with_explicit_initial_focus(self):
        engine = self.dialog_engine()
        entered = engine.enter_scope(DIALOG, initial_focus="d2")
        self.assertEqual(entered, "d2")
        engine.exit_scope()

        # 初始焦点不属于接管容器或不存在/不可用，必须拒绝接管
        engine2 = self.dialog_engine()
        with self.assertRaises(FocusError) as ctx:
            engine2.enter_scope(DIALOG, initial_focus="a")
        self.assertEqual(ctx.exception.code, ErrorCode.INVALID_SCOPE_TARGET)

        engine3 = self.dialog_engine()
        with self.assertRaises(FocusError) as ctx:
            engine3.enter_scope(DIALOG, initial_focus="d3")  # d3 已禁用
        self.assertEqual(ctx.exception.code, ErrorCode.INVALID_SCOPE_TARGET)

    def test_return_to_removed_element_falls_back(self):
        engine = self.dialog_engine()
        engine.enter_scope(DIALOG)  # 将回到 a
        engine.remove_element("a")  # 接管期间删除接管前元素（它在容器外）
        restored = engine.exit_scope()
        # a 已不存在：回退到同容器最近可用元素 -> b
        self.assertEqual(restored, "b")
        self.assertEqual(engine.current_focus, "b")

    def test_return_to_disabled_element_falls_back(self):
        engine = self.dialog_engine()
        engine.enter_scope(DIALOG)
        engine.set_disabled("a", True)
        restored = engine.exit_scope()
        self.assertEqual(restored, "b")

    def test_nested_scopes_must_exit_lifo_and_fallback_stays_in_outer(self):
        engine = build(
            [
                {"id": "a", "container": FORM},
                {"id": "d1", "container": DIALOG},
                {"id": "d2", "container": DIALOG},
                {"id": "e1", "container": DIALOG2},
                {"id": "e2", "container": DIALOG2},
            ],
            [("d1", "right", "e1")],
            focus="a",
        )
        engine.enter_scope(DIALOG, initial_focus="d1")
        engine.enter_scope(DIALOG2, initial_focus="e1")
        self.assertEqual(engine.scope_depth, 2)
        # 内层接管期间删除外层将返回的元素 d1
        engine.remove_element("d1")
        restored = engine.exit_scope()  # 退出 DIALOG2
        self.assertEqual(engine.active_container, DIALOG)
        # 仍处外层接管：回退被限制在 DIALOG 容器内 -> d2，而不是 form 的 a
        self.assertEqual(restored, "d2")
        self.assertEqual(engine.current_focus, "d2")
        # 逃逸边即使存在也不可用
        engine.exit_scope()
        self.assertEqual(engine.current_focus, "a")

    def test_empty_scope_then_element_appears_recovers(self):
        engine = build(
            [
                {"id": "a", "container": FORM},
                {"id": "x", "container": "other"},
            ],
            focus="a",
        )
        entered = engine.enter_scope(DIALOG)
        self.assertIsNone(entered)
        self.assertIsNone(engine.current_focus)
        # 其它容器出现元素不得抢夺焦点
        engine.add_element("x2", "other")
        self.assertIsNone(engine.current_focus)
        # 接管容器内出现可用元素：安全恢复
        engine.add_element("d1", DIALOG)
        self.assertEqual(engine.current_focus, "d1")
        restored = engine.exit_scope()
        self.assertEqual(restored, "a")


# ---------------------------------------------------------------------------
# 需求 6：动态增删 / 禁用 —— 增量与重建等价、无悬空关系
# ---------------------------------------------------------------------------


class Requirement6Test(unittest.TestCase):
    def scenario(self, engine):
        for name in ("a", "b", "c", "d", "e"):
            engine.add_element(name, FORM)
        engine.add_relation("a", "right", "b")
        engine.add_relation("b", "right", "c")
        engine.add_relation("c", "right", "d")
        engine.add_relation("d", "right", "e")
        engine.add_relation("e", "left", "d")
        engine.add_relation("a", "down", "c")
        engine.set_focus("a")
        engine.advance("right")  # -> b
        engine.set_disabled("d", True)
        engine.remove_element("c")  # b->c 入边、a->c 入边、c->d 出边全部清理
        engine.set_disabled("d", False)
        engine.add_element("f", FORM)
        engine.add_relation("b", "down", "f")

    def test_no_dangling_relations_after_removal(self):
        engine = FocusEngine()
        self.scenario(engine)
        self.assertEqual(engine.validate_integrity(), [])
        self.assertIsNone(engine.get_target("b", "right"))  # 指向 c 的边已清
        self.assertIsNone(engine.get_target("a", "down"))
        with self.assertRaises(FocusError):
            engine.get_target("c", "right")
        # 删除后同 id 重新加入，不得继承旧关系
        engine.add_element("c", FORM)
        self.assertEqual(engine.relations_of("c"), [])
        self.assertIsNone(engine.get_target("b", "right"))

    def test_incremental_matches_fresh_rebuild_from_final_config(self):
        incremental = FocusEngine()
        self.scenario(incremental)

        # 按增量引擎的终态快照从头构建（最强的“从头重建”语义）
        snapshot = incremental.graph_snapshot()
        fresh = FocusEngine(snapshot["directions"])
        for id_, container, focusable, disabled in snapshot["elements"]:
            fresh.add_element(id_, container, focusable, disabled)
        for source, direction, target in snapshot["relations"]:
            fresh.add_relation(source, direction, target)
        fresh.set_focus(snapshot["focus"])

        self.assertEqual(fresh.graph_snapshot(), incremental.graph_snapshot())
        self.assertEqual(fresh.current_focus, incremental.current_focus)
        self.assertEqual(
            [(c.direction, c.nodes) for c in fresh.find_cycles()],
            [(c.direction, c.nodes) for c in incremental.find_cycles()],
        )
        for id_ in snapshot["elements"]:
            node_id = id_[0]
            self.assertEqual(fresh.targets(node_id), incremental.targets(node_id))

    def test_rebuild_method_matches(self):
        engine = FocusEngine()
        self.scenario(engine)
        rebuilt = engine.rebuild()
        self.assertEqual(rebuilt.graph_snapshot(), engine.graph_snapshot())
        self.assertEqual(rebuilt.validate_integrity(), [])

    def test_removing_current_focus_falls_back_and_matches_rebuild(self):
        engine = build(
            [{"id": n, "container": FORM} for n in ("a", "b", "c")],
            [("a", "right", "b"), ("b", "right", "c")],
            focus="b",
        )
        engine.remove_element("b")
        self.assertEqual(engine.current_focus, "a")  # 最近可用前驱
        self.assertEqual(engine.validate_integrity(), [])
        rebuilt = engine.rebuild()
        self.assertEqual(rebuilt.current_focus, "a")

    def test_disabling_current_focus_falls_back_within_scope(self):
        engine = build(
            [
                {"id": "d1", "container": DIALOG},
                {"id": "d2", "container": DIALOG},
                {"id": "a", "container": FORM},
            ],
            focus="a",
        )
        engine.enter_scope(DIALOG, initial_focus="d2")
        engine.set_disabled("d2", True)
        # 接管中：只在 DIALOG 内回退，绝不能退到 form 的 a
        self.assertEqual(engine.current_focus, "d1")
        engine.set_disabled("d1", True)
        self.assertIsNone(engine.current_focus)  # 容器内无可用元素
        engine.set_disabled("d1", False)
        self.assertEqual(engine.current_focus, "d1")  # 可用元素出现后恢复

    def test_only_affected_relations_recomputed(self):
        # 删除 z 不得影响与 z 无关的边（白-box 检查同一字典对象上的其它边保留）
        engine = build(
            [{"id": n, "container": FORM} for n in ("a", "b", "z")],
            [("a", "right", "b"), ("a", "down", "z"), ("z", "right", "b")],
            focus="a",
        )
        edges_a = engine._edges["a"]
        engine.remove_element("z")
        self.assertIs(engine._edges["a"], edges_a)
        self.assertEqual(engine.get_target("a", "right"), "b")
        self.assertIsNone(engine.get_target("a", "down"))

    def test_remove_unknown_element_raises(self):
        engine = build(std_elements())
        with self.assertRaises(FocusError) as ctx:
            engine.remove_element("ghost")
        self.assertEqual(ctx.exception.code, ErrorCode.ELEMENT_NOT_FOUND)

    def test_reset_clears_everything(self):
        engine = FocusEngine()
        self.scenario(engine)
        engine.configure(reset=True)
        self.assertEqual(engine.list_elements(), [])
        self.assertIsNone(engine.current_focus)
        self.assertEqual(engine.history(), [])

    def test_randomized_incremental_equivalent_to_rebuild(self):
        # 固定种子的差分测试：任意增删/禁用/配边序列下，增量引擎的结构
        # 快照、当前焦点、环集合必须始终与“按终态从头重建”一致。
        import random

        rng = random.Random(20260916)
        engine = FocusEngine()
        pool = [f"n{i}" for i in range(12)]
        for step in range(400):
            action = rng.random()
            present = [e["id"] for e in engine.list_elements()]
            if action < 0.45 or not present:
                candidate = next((x for x in pool if x not in present), None)
                if candidate is not None:
                    engine.add_element(
                        candidate,
                        FORM if rng.random() < 0.8 else "other",
                        focusable=rng.random() < 0.9,
                        disabled=rng.random() < 0.2,
                    )
            elif action < 0.6 and len(present) > 1:
                engine.remove_element(rng.choice(present))
            elif action < 0.75:
                node = rng.choice(present)
                engine.set_disabled(node, rng.random() < 0.5)
            elif action < 0.9 and len(present) >= 2:
                s, t = rng.sample(present, 2)
                d = rng.choice(DEFAULT_DIRECTIONS)
                try:
                    engine.add_relation(s, d, t)
                except FocusError as err:
                    self.assertEqual(err.code, ErrorCode.RELATION_CONFLICT)
            else:
                node = rng.choice(present)
                d = rng.choice(DEFAULT_DIRECTIONS)
                engine.remove_relation(node, d)

            # 焦点可能因删除/禁用而回退；若为空则选一个可用元素放置
            self.assertEqual(engine.validate_integrity(), [])
            if engine.current_focus is None:
                usable = [e["id"] for e in engine.list_elements() if e["usable"]]
                if usable:
                    engine.set_focus(usable[0])

            if step % 7 == 0:
                rebuilt = engine.rebuild()
                self.assertEqual(
                    rebuilt.graph_snapshot(),
                    engine.graph_snapshot(),
                    msg=f"step {step} 快照不一致",
                )
                self.assertEqual(
                    [(c.direction, c.nodes) for c in rebuilt.find_cycles()],
                    [(c.direction, c.nodes) for c in engine.find_cycles()],
                    msg=f"step {step} 环集合不一致",
                )
                for e in engine.list_elements():
                    self.assertEqual(rebuilt.targets(e["id"]), engine.targets(e["id"]))


# ---------------------------------------------------------------------------
# 需求 7：查询、历史、拒绝原因 —— 全部稳定顺序
# ---------------------------------------------------------------------------


class Requirement7Test(unittest.TestCase):
    def test_targets_and_relations_follow_direction_order(self):
        engine = FocusEngine(("north", "south", "east", "west"))
        engine.add_element("a", FORM)
        engine.add_element("b", FORM)
        engine.add_relation("a", "west", "b")
        engine.add_relation("a", "north", "b")
        self.assertEqual(
            list(engine.targets("a").keys()), ["north", "south", "east", "west"]
        )
        self.assertEqual(
            [r["direction"] for r in engine.relations_of("a")], ["north", "west"]
        )

    def test_list_elements_sorted_stably(self):
        engine = FocusEngine()
        for name in ("e", "b", "a", "d", "c"):
            engine.add_element(name, FORM)
        self.assertEqual(
            [e["id"] for e in engine.list_elements()], ["a", "b", "c", "d", "e"]
        )
        element = engine.describe_element("a")
        self.assertEqual(set(element), {"id", "container", "focusable", "disabled",
                                        "usable", "targets", "relations",
                                        "is_current_focus"})

    def test_integer_ids_order_numerically(self):
        engine = FocusEngine()
        for i in (10, 2, 1, 20):
            engine.add_element(i, FORM)
        self.assertEqual([e["id"] for e in engine.list_elements()], [1, 2, 10, 20])
        engine.remove_element(10)
        self.assertEqual(engine.nearest_usable(10), 2)  # 最近前驱
        self.assertEqual(engine.nearest_usable(0), 1)   # 无前驱取最近后继
        self.assertEqual(engine.nearest_usable(30), 20)  # 无后继取最后前驱

    def test_history_records_focus_changing_events_only(self):
        engine = build(std_elements(), [("a", "right", "b")], focus="a")
        engine.advance("right")   # a -> b，入历史
        engine.advance("right")   # b 无关系被拒绝，不入历史
        kinds = [(h["kind"], h["source"], h["target"]) for h in engine.history()]
        self.assertEqual(kinds[0], ("focus", None, "a"))
        self.assertEqual(kinds[1], ("move", "a", "b"))
        self.assertEqual(len(kinds), 2)
        # 历史序号单调递增，可追溯
        seqs = [h["seq"] for h in engine.history()]
        self.assertEqual(seqs, sorted(seqs))

    def test_last_rejection_queryable_and_stale_until_next(self):
        engine = build(std_elements(), [("a", "right", "c")], focus="a")
        self.assertIsNone(engine.last_rejection)
        engine.advance("right")
        first = engine.last_rejection
        self.assertEqual(first["code"], RejectCode.TARGET_DISABLED)
        self.assertEqual(first["direction"], "right")
        # 成功移动会更新焦点；拒绝原因作为“最近一次拒绝”保留可查
        engine.remove_relation("a", "right")
        engine.add_relation("a", "right", "b")
        engine.advance("right")
        self.assertEqual(engine.current_focus, "b")
        self.assertEqual(engine.last_rejection["seq"], first["seq"])

    def test_fallback_and_scope_events_in_history(self):
        engine = build(
            [
                {"id": "a", "container": FORM},
                {"id": "d1", "container": DIALOG},
            ],
            focus="a",
        )
        engine.enter_scope(DIALOG)
        engine.remove_element("a")  # 接管期间删除接管前元素（非当前焦点）
        engine.exit_scope()
        kinds = [h["kind"] for h in engine.history()]
        self.assertEqual(kinds, ["focus", "scope-enter", "scope-exit"])
        exit_entry = engine.history()[-1]
        self.assertEqual(exit_entry["target"], "d1")  # 全局最近可用
        self.assertTrue(exit_entry["detail"]["fallback"])
        self.assertFalse(exit_entry["detail"]["recovered"])

    def test_nearest_usable_rule_is_declarative(self):
        engine = build(
            [
                {"id": "a", "container": FORM},
                {"id": "b", "container": FORM},
                {"id": "x", "container": "other"},
            ]
        )
        # 同容器优先：即使全局存在更大的 x，FORM 内只在 a/b 中挑选
        self.assertEqual(engine.nearest_usable("z", container_hint=FORM), "b")
        self.assertEqual(engine.nearest_usable("a"), "a")
        # 指定提示容器无候选时扩大到全局：z 之后无元素，取最大前驱 x
        self.assertEqual(engine.nearest_usable("z", container_hint="empty"), "x")
        # 没有前驱时取最近后继
        self.assertEqual(engine.nearest_usable("0", container_hint="empty"), "a")


if __name__ == "__main__":
    unittest.main(verbosity=2)
