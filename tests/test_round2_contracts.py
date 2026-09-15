"""第二轮收紧验收：容器接管逃逸、尾巴边环判定、导出导入往返。

本文件对应 Round 2 反馈的两处契约收紧，以及已稳定的导出导入行为：

* :class:`ScopeEscapeContractTest`
  接管期间，**任何**指向容器外元素的方向推进都必须拒绝（全方向矩阵），
  拒绝码固定为 ``scope-escape`` 且原因可读，焦点保持不变；退出接管后
  焦点回到接管前元素，该元素失效时按“最近可用”规则回退。
* :class:`TailEdgeCycleContractTest`
  只有被走的那条边本身位于环上才以 ``cycle`` 拒绝并报告环序列；
  仅下游可达环的尾巴边必须被**接受**并正常前进一步；环在查询中
  始终可列出。用例按“逐步推导”的方式逐键比对接受/拒绝与落点。
* :class:`ExportImportRoundTripTest`
  ``export_state/import_state`` 与 ``to_json/from_json`` 往返后
  结构、焦点、接管栈、历史、最近拒绝完全一致，再导出字节稳定；
  脏数据被拒绝且不产生半导入状态。

运行::

    python -m unittest discover -s tests -t .
"""

import json
import unittest

from focus_order import FocusEngine, FocusError, ErrorCode, RejectCode

FORM = "form"
DIALOG = "dialog"


def make_engine_with_dialog():
    """form 中 a/b；dialog 中 d1/d2，且 d1、d2 都配了指向 form 的逃逸边。"""
    engine = FocusEngine()
    for spec in (
        ("a", FORM),
        ("b", FORM),
        ("d1", DIALOG),
        ("d2", DIALOG),
    ):
        engine.add_element(*spec)
    # 容器内合法移动
    engine.add_relation("d1", "right", "d2")
    engine.add_relation("d2", "left", "d1")
    # 四个方向上都布一条逃逸边，覆盖全方向矩阵
    engine.add_relation("d1", "up", "a")
    engine.add_relation("d1", "down", "b")
    engine.add_relation("d2", "up", "a")
    engine.add_relation("d2", "down", "b")
    engine.add_relation("d2", "right", "b")
    engine.add_relation("d1", "left", "a")
    return engine


class ScopeEscapeContractTest(unittest.TestCase):
    def test_every_direction_pointing_outside_is_rejected(self):
        engine = make_engine_with_dialog()
        engine.set_focus("a")
        engine.enter_scope(DIALOG)  # 默认初始焦点 d1

        expected = {
            "d1": {"up": "a", "down": "b", "left": "a"},
            "d2": {"up": "a", "down": "b", "right": "b"},
        }
        for start, by_dir in expected.items():
            engine.set_focus(start)
            for direction, outside_target in by_dir.items():
                before = engine.current_focus
                result = engine.advance(direction)
                self.assertFalse(
                    result.accepted,
                    msg=f"{start} 沿 {direction} 指向容器外 {outside_target}，必须拒绝",
                )
                self.assertEqual(result.code, RejectCode.SCOPE_ESCAPE)
                self.assertEqual(result.target, outside_target)
                # 可读原因：点出接管容器、目标容器、方向
                message = result.rejection.message
                self.assertIn(DIALOG, message)
                self.assertIn(FORM, message)
                self.assertIn(direction, message)
                # 最关键的契约：焦点绝不逃逸
                self.assertEqual(
                    engine.current_focus,
                    before,
                    msg=f"{start} 沿 {direction} 被拒后焦点发生了漂移",
                )
                self.assertEqual(
                    engine.get_element(engine.current_focus)["container"], DIALOG
                )

    def test_move_within_scope_still_accepted(self):
        engine = make_engine_with_dialog()
        engine.enter_scope(DIALOG, initial_focus="d1")
        moved = engine.advance("right")  # d1 -> d2，容器内
        self.assertTrue(moved.accepted)
        self.assertEqual(moved.target, "d2")
        self.assertEqual(engine.current_focus, "d2")
        moved_back = engine.advance("left")  # d2 -> d1
        self.assertTrue(moved_back.accepted)
        self.assertEqual(moved_back.target, "d1")

    def test_focus_restored_after_scope_exit(self):
        engine = make_engine_with_dialog()
        engine.set_focus("a")
        engine.enter_scope(DIALOG, initial_focus="d2")
        engine.advance("left")  # 在弹层里移动到 d1
        restored = engine.exit_scope()
        self.assertIsNone(engine.active_container)
        self.assertEqual(restored, "a")
        self.assertEqual(engine.current_focus, "a")

    def test_fallback_when_return_target_removed(self):
        engine = make_engine_with_dialog()
        engine.set_focus("a")
        engine.enter_scope(DIALOG)
        engine.remove_element("a")  # 接管前元素被动态删除
        restored = engine.exit_scope()
        # 回退到同容器（form）最近可用元素 -> b
        self.assertEqual(restored, "b")
        self.assertEqual(engine.current_focus, "b")

    def test_fallback_when_return_target_disabled(self):
        engine = make_engine_with_dialog()
        engine.set_focus("a")
        engine.enter_scope(DIALOG)
        engine.set_disabled("a", True)
        restored = engine.exit_scope()
        self.assertEqual(restored, "b")

    def test_repeated_escape_attempts_are_deterministic(self):
        engine = make_engine_with_dialog()
        engine.enter_scope(DIALOG, initial_focus="d2")
        first = engine.advance("right")  # 逃逸到 b
        for _ in range(3):
            again = engine.advance("right")
            self.assertEqual(again.accepted, first.accepted)
            self.assertEqual(again.code, first.code)
            self.assertEqual(again.target, first.target)
            self.assertEqual(engine.current_focus, "d2")
        self.assertEqual(engine.last_rejection["code"], RejectCode.SCOPE_ESCAPE)

    def test_escape_takes_precedence_over_target_state(self):
        # 目标在容器外，即使同时被禁用/不可聚焦，原因仍是逃逸而非禁用
        engine = make_engine_with_dialog()
        engine.set_disabled("a", True)
        engine.enter_scope(DIALOG, initial_focus="d1")
        result = engine.advance("up")  # d1 -> a(form)，a 已禁用
        self.assertFalse(result.accepted)
        self.assertEqual(result.code, RejectCode.SCOPE_ESCAPE)
        self.assertEqual(engine.current_focus, "d1")
        # 未接管时同一目标才按禁用拒绝
        engine.exit_scope()
        engine.set_focus("b")
        engine.add_relation("b", "up", "a")
        self.assertEqual(engine.advance("up").code, RejectCode.TARGET_DISABLED)


# ---------------------------------------------------------------------------
# 环判定：只有环上边才拒绝，尾巴边正常推进
# ---------------------------------------------------------------------------


def tail_cycle_engine():
    """t1 -> t2 -> a -> b -> c -> a；tail 方向另有 a -> x（链尾，无环）。"""
    engine = FocusEngine()
    for node in ("t1", "t2", "a", "b", "c", "x"):
        engine.add_element(node, FORM)
    engine.add_relation("t1", "right", "t2")
    engine.add_relation("t2", "right", "a")
    engine.add_relation("a", "right", "b")
    engine.add_relation("b", "right", "c")
    engine.add_relation("c", "right", "a")
    engine.add_relation("a", "left", "x")
    return engine


class TailEdgeCycleContractTest(unittest.TestCase):
    CYCLE = ("a", "b", "c")

    def test_existing_cycle_listed_even_without_attempting_move(self):
        engine = tail_cycle_engine()
        cycles = engine.find_cycles("right")
        self.assertEqual([c.nodes for c in cycles], [self.CYCLE])
        self.assertEqual(cycles[0].direction, "right")

    def test_step_by_step_derivation_along_tail_into_cycle(self):
        engine = tail_cycle_engine()
        engine.set_focus("t1")
        # 逐步推导表：(按键方向, 是否接受, 落点/拒绝码)
        expected = [
            ("right", True, "t2"),    # 尾巴边 t1->t2
            ("right", True, "a"),     # 尾巴边 t2->a（仅下游是环，走的边不在环上）
            ("right", False, RejectCode.CYCLE),  # a->b 是环上边
        ]
        for direction, accepted, value in expected:
            result = engine.advance(direction)
            self.assertEqual(result.accepted, accepted, msg=f"at {engine.current_focus}")
            if accepted:
                self.assertEqual(result.target, value)
                self.assertEqual(engine.current_focus, value)
            else:
                self.assertEqual(result.code, value)
                # 拒绝时报告的环序列必须是规范化的 a,b,c
                self.assertEqual(result.rejection.cycle, self.CYCLE)
                # 焦点停在环口 a，不进环
                self.assertEqual(engine.current_focus, "a")

    def test_tail_vertices_are_not_reported_as_cycle_members(self):
        engine = tail_cycle_engine()
        for cycle in engine.find_cycles():
            self.assertNotIn("t1", cycle.nodes)
            self.assertNotIn("t2", cycle.nodes)

    def test_edge_off_the_cycle_to_plain_chain_accepted(self):
        engine = tail_cycle_engine()
        engine.set_focus("a")
        result = engine.advance("left")  # a -> x，与环无关，正常
        self.assertTrue(result.accepted)
        self.assertEqual(result.target, "x")
        # 环仍然可查
        self.assertEqual(
            [c.nodes for c in engine.find_cycles("right")], [self.CYCLE]
        )

    def test_every_edge_on_cycle_rejected(self):
        engine = tail_cycle_engine()
        for node in self.CYCLE:
            engine.set_focus(node)
            result = engine.advance("right")
            self.assertFalse(result.accepted, msg=f"环上节点 {node} 的出边必须拒绝")
            self.assertEqual(result.code, RejectCode.CYCLE)
            self.assertEqual(result.rejection.cycle, self.CYCLE)
            self.assertEqual(engine.current_focus, node)

    def test_breaking_cycle_moves_again_and_query_reflects_it(self):
        engine = tail_cycle_engine()
        engine.set_focus("a")
        self.assertEqual(engine.advance("right").code, RejectCode.CYCLE)
        self.assertTrue(engine.remove_relation("c", "right"))  # 断开 c->a
        self.assertEqual(engine.find_cycles("right"), [])
        # 原来的环边现在变成普通链边，逐步走 a->b->c
        path = []
        for _ in range(2):
            result = engine.advance("right")
            self.assertTrue(result.accepted)
            path.append(result.target)
        self.assertEqual(path, ["b", "c"])
        self.assertEqual(engine.current_focus, "c")
        self.assertEqual(engine.advance("right").code, RejectCode.NO_RELATION)


# ---------------------------------------------------------------------------
# 导出 / 导入往返
# ---------------------------------------------------------------------------


class ExportImportRoundTripTest(unittest.TestCase):
    def _rich_engine(self):
        engine = make_engine_with_dialog()
        engine.set_focus("a")
        engine.advance("down")  # a 没有 down 关系：拒绝但记录，焦点仍为 a
        engine.enter_scope(DIALOG, initial_focus="d1")
        engine.advance("right")  # d1 -> d2
        rejected = engine.advance("right")  # d2 -> b 逃逸，被拒
        self.assertEqual(rejected.code, RejectCode.SCOPE_ESCAPE)
        return engine

    def test_export_import_preserves_full_runtime_state(self):
        engine = self._rich_engine()
        state = engine.export_state()
        restored = FocusEngine.import_state(state)

        # 结构
        self.assertEqual(restored.graph_snapshot(), engine.graph_snapshot())
        # 运行时：焦点、接管栈、历史、最近拒绝
        self.assertEqual(restored.current_focus, engine.current_focus)
        self.assertEqual(restored.active_container, engine.active_container)
        self.assertEqual(restored.scope_stack(), engine.scope_stack())
        self.assertEqual(restored.scope_depth, engine.scope_depth)
        self.assertEqual(restored.history(), engine.history())
        self.assertEqual(restored.last_rejection, engine.last_rejection)
        # 再导出完全相等（往返幂等）
        self.assertEqual(restored.export_state(), state)

        # 恢复后行为可继续：仍在接管中，逃逸依旧被拒；退出后精确回到 a
        again = restored.advance("right")
        self.assertEqual(again.code, RejectCode.SCOPE_ESCAPE)
        self.assertEqual(restored.exit_scope(), "a")

    def test_json_round_trip_byte_stable(self):
        engine = self._rich_engine()
        text = engine.to_json()
        # 合法 JSON 且可解析回同样的状态
        restored = FocusEngine.from_json(text)
        self.assertEqual(restored.export_state(), engine.export_state())
        self.assertEqual(restored.to_json(), text)  # 字节稳定
        json.loads(text)  # 确保是严格 JSON

    def test_export_with_cycle_records_and_rejects_same_way(self):
        engine = tail_cycle_engine()
        engine.set_focus("a")
        engine.advance("right")  # cycle 拒绝，写入最近拒绝
        restored = FocusEngine.from_json(engine.to_json())
        self.assertEqual(
            [c.nodes for c in restored.find_cycles("right")],
            [("a", "b", "c")],
        )
        self.assertEqual(restored.current_focus, "a")
        self.assertEqual(restored.last_rejection["code"], RejectCode.CYCLE)
        result = restored.advance("right")
        self.assertEqual(result.code, RejectCode.CYCLE)
        self.assertEqual(result.rejection.cycle, ("a", "b", "c"))

    def test_import_rejects_dirty_state_without_partial_import(self):
        good = self._rich_engine().export_state()

        # 悬空关系：指向不存在的目标
        dirty = json.loads(json.dumps(good))
        dirty["relations"][0]["target"] = "ghost"
        with self.assertRaises(FocusError):
            FocusEngine.import_state(dirty)

        # 焦点逃逸出接管容器
        dirty2 = json.loads(json.dumps(good))
        dirty2["current"] = "b"  # b 在 form，而栈顶是 dialog
        with self.assertRaises(FocusError):
            FocusEngine.import_state(dirty2)

        # 非法 JSON
        with self.assertRaises(FocusError):
            FocusEngine.from_json("{not json")

        # 重复方向
        dirty3 = json.loads(json.dumps(good))
        dirty3["directions"] = ["right", "right"]
        with self.assertRaises(FocusError):
            FocusEngine.import_state(dirty3)

    def test_import_empty_state_is_valid(self):
        engine = FocusEngine.import_state(
            {"version": 1, "directions": ["up", "down"], "elements": [], "relations": []}
        )
        self.assertEqual(engine.list_elements(), [])
        self.assertIsNone(engine.current_focus)
        self.assertEqual(engine.export_state()["directions"], ["up", "down"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
