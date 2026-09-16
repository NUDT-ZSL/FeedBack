"""需求 5：改写 / 新增版本时只重算受影响目标，且结果与从头重排完全一致；
未受影响的段落不得改变。"""

import copy
import unittest

from story_composer import Composer, MaterialUnit, NarrativeGoal, Slot


def U(unit_id, unit_type="scene", body="正文", version=1, prerequisites=(), group=None):
    return MaterialUnit(
        unit_id, unit_type, body, version=version,
        prerequisites=frozenset(prerequisites), group=group,
    )


def build_populated():
    """构造一个多目标、含依赖、含替代版本、含跨来源冲突的编排状态。"""
    c = Composer()
    c.register_unit(U("setup", "scene", "开端"))
    c.register_unit(U("setup2", "scene", "开端重拍", version=2, group="setup"))
    c.register_unit(U("duel", "scene", "决斗", prerequisites=["setup"]))
    c.register_unit(U("duel2", "scene", "决斗重剪", version=2, group="duel",
                      prerequisites=["setup"]))
    c.register_unit(U("ending", "scene", "结局", prerequisites=["duel"]))
    c.register_unit(U("epilogue", "note", "尾声", prerequisites=["ending"]))
    c.register_unit(U("joke", "scene", "独立段子"))  # 与主线无关

    c.register_goal(NarrativeGoal(
        "gmain", "新观众",
        [Slot("p1", "scene"), Slot("p2", "scene"), Slot("p3", "scene"),
         Slot("p4", "note", required=False)],
    ))
    c.register_goal(NarrativeGoal(
        "gside", "老观众",
        [Slot("q1", "scene"), Slot("q2", "scene", required=False)],
    ))

    c.fill_slot("gmain", "p1", "setup2", source="editor")
    c.fill_slot("gmain", "p2", "duel", source="editor")
    c.fill_slot("gmain", "p2", "duel2", source="reviewer")
    c.fill_slot("gmain", "p3", "ending", source="editor")
    c.fill_slot("gmain", "p4", "epilogue", source="editor")
    # gside 只引用独立素材，与主线隔离
    c.fill_slot("gside", "q1", "joke", source="editor")
    # 预热缓存
    for g in ("gmain", "gside"):
        c.get_sequence(g)
    return c


def snapshot(c):
    """与实现无关的完整逻辑快照：序列 + 全部槽位解析 + 冲突。"""
    state = {}
    for goal in c.all_goals():
        g = goal.goal_id
        state[g] = {
            "sequence": c.get_sequence(g),
            "slots": [
                c.get_slot_resolution(g, s.slot_id) for s in goal.slots
            ],
        }
    state["__conflicts__"] = [
        (r.goal_id, r.slot_id,
         tuple((x.source, x.unit_id, x.version) for x in r.choices))
        for r in c.conflicts()
    ]
    return state


class TestIncrementalRecompose(unittest.TestCase):
    def test_only_referencing_goals_recomputed(self):
        c = build_populated()
        c.reset_recompose_log()

        # 改写 gside 引用的 joke：只有 gside 应重算，gmain 不动
        c.update_unit(U("joke", "scene", "独立段子（润色）"))
        c.get_sequence("gmain")
        c.get_sequence("gside")
        self.assertEqual(c.recompose_log, ["gside"])

        # 改写 gmain 才会重算 gmain
        c.reset_recompose_log()
        c.update_unit(U("setup", "scene", "开端（字幕修正）"))
        c.get_sequence("gmain")
        c.get_sequence("gside")
        self.assertEqual(c.recompose_log, ["gmain"])

    def test_no_recompute_on_query_when_clean(self):
        c = build_populated()
        c.reset_recompose_log()
        c.get_sequence("gmain")
        c.get_sequence("gside")
        self.assertEqual(c.recompose_log, [])

    def test_new_version_only_recomputes_referencing_goal(self):
        c = build_populated()
        c.reset_recompose_log()
        # 新增 duel 的 v3（新 unit_id、同 group），并由 gmain 引用
        c.register_unit(U("duel3", "scene", "决斗终剪", version=3, group="duel",
                          prerequisites=["setup"]))
        # 注册本身不影响任何目标（还没人引用 duel3）
        self.assertEqual(c.recompose_log, [])
        c.fill_slot("gmain", "p2", "duel3", source="director")
        c.reset_recompose_log()
        seq = c.get_sequence("gmain")
        self.assertEqual(seq.entries[1].unit_id, "duel3")
        self.assertEqual(c.recompose_log, ["gmain"])
        # gside 未被触碰
        c.get_sequence("gside")
        self.assertEqual(c.recompose_log, ["gmain"])

    def test_incremental_matches_full_recompute_after_body_edit(self):
        # 关键不变式：对任意操作序列，增量结果 == 全新实例重放全部操作的结果
        c = build_populated()
        # 在已预热缓存的实例上做增量改写
        c.update_unit(U("duel", "scene", "决斗（改写正文）",
                        prerequisites=["setup"]))
        c.update_unit(U("setup2", "scene", "开端重拍（再修）", version=2,
                        group="setup"))
        inc = snapshot(c)

        fresh = build_populated()
        fresh.update_unit(U("duel", "scene", "决斗（改写正文）",
                            prerequisites=["setup"]))
        fresh.update_unit(U("setup2", "scene", "开端重拍（再修）", version=2,
                            group="setup"))
        full = snapshot(fresh)
        self.assertEqual(inc, full)

    def test_incremental_matches_full_recompute_many_operations(self):
        # 用一组固定操作在"增量实例"和"对照实例"上重放，逐拍比对
        ops = [
            ("reg", U("extra1", "scene", "额外1")),
            ("reg", U("extra2", "scene", "额外2", prerequisites=["extra1"])),
            ("upd", U("setup", "scene", "开端-改1")),
            ("reg", U("duel9", "scene", "决斗v9", version=9, group="duel",
                      prerequisites=["setup"])),
            ("fill", ("gmain", "p2", "duel9", "qc")),
            ("upd", U("joke", "scene", "段子-改1")),
            ("clear", ("gmain", "p2", "qc", False)),
            ("reg", U("ending2", "scene", "结局新版", version=2, group="ending",
                      prerequisites=["duel"])),
            ("fill", ("gmain", "p3", "ending2", "qc")),
            ("upd", U("epilogue", "note", "尾声-改1", prerequisites=["ending"])),
        ]
        inc = build_populated()
        ref = build_populated()
        for i, (kind, payload) in enumerate(ops):
            if kind == "reg":
                inc.register_unit(copy.deepcopy(payload))
                ref.register_unit(copy.deepcopy(payload))
            elif kind == "upd":
                inc.update_unit(copy.deepcopy(payload))
                ref.update_unit(copy.deepcopy(payload))
            elif kind == "fill":
                g, s, u, src = payload
                inc.fill_slot(g, s, u, source=src)
                ref.fill_slot(g, s, u, source=src)
            elif kind == "clear":
                g, s, src, _ = payload
                inc.clear_slot(g, s, source=src)
                ref.clear_slot(g, s, source=src)
            # 每一步后：懒增量的 inc 必须与强制全量重算的 ref 完全一致
            ref.recompose_all()
            self.assertEqual(
                snapshot(inc), snapshot(ref), msg=f"操作 {i}({kind}) 后不一致"
            )

    def test_unaffected_slot_result_unchanged(self):
        c = build_populated()
        before_p1 = c.get_slot_resolution("gmain", "p1")
        before_p3 = c.get_slot_resolution("gmain", "p3")
        before_gside = c.get_slot_resolution("gside", "q1")

        # 把 ending 升到 v2：只有 p3 的输入指纹改变；p1 与 gside 槽位结果对象不变
        c.update_unit(U("ending", "scene", "结局（补一行旁白）", version=2,
                        prerequisites=["duel"]))
        c.get_sequence("gmain")
        self.assertIs(c.get_slot_resolution("gmain", "p1"), before_p1)
        self.assertIsNot(c.get_slot_resolution("gmain", "p3"), before_p3)
        self.assertEqual(c.get_slot_resolution("gmain", "p3").chosen.version, 2)
        self.assertIs(c.get_slot_resolution("gside", "q1"), before_gside)

    def test_body_change_visible_in_referencing_sequence(self):
        c = build_populated()
        c.update_unit(U("joke", "scene", "全新笑点"))
        # 序列本身记录 id/版本；正文通过单元查询可见
        self.assertEqual(c.get_unit("joke").body, "全新笑点")
        self.assertEqual(c.referencing_goals("joke"), ["gside"])

    def test_destructive_overwrite_rejected_state_unchanged(self):
        c = build_populated()
        seq_before = c.get_sequence("gmain")
        # 把 setup 挪到另一个替代版本组：下游 duel/duel2 前置依赖的是 "setup" 组，
        # p1 里的 setup2 仍属 setup 组，于是 p2 的依赖在改写后无处满足 -> 拒绝
        with self.assertRaises(Exception) as cm:
            c.update_unit(U("setup", "scene", "开端", group="cold-open"))
        self.assertIn("p2", str(cm.exception))
        # 被整体拒绝：库与序列保持原状
        self.assertEqual(c.get_unit("setup").group, "setup")
        self.assertEqual(c.get_sequence("gmain"), seq_before)

    def test_destructive_overwrite_via_transitive_alias(self):
        # p2 只选了别名 duel2（group=duel），p3 的 ending 依赖具体单元 duel；
        # 把 duel 挪组后，duel2 与 ending 的依赖都受影响，必须在 p3 被检出
        c = build_populated()
        c.clear_slot("gmain", "p2", source="editor")  # 只留 reviewer 的 duel2
        with self.assertRaises(Exception) as cm:
            c.update_unit(U("duel", "scene", "决斗", prerequisites=["setup"],
                            group="duel-alt"))
        self.assertIn("p3", str(cm.exception))

    def test_transitive_prerequisite_change_marks_goal_dirty_but_keeps_slots(self):
        # setup 没有被任何槽位直接选择（p1 选的是同组别名 setup2），
        # 但它处在被选单元 duel 的传递依赖上：改写其版本号应标记 gmain，
        # 由于没有槽位直接选 setup，所有段落结果对象保持不变
        c = build_populated()
        before = [
            c.get_slot_resolution("gmain", s)
            for s in ("p1", "p2", "p3", "p4")
        ]
        c.reset_recompose_log()
        c.update_unit(U("setup", "scene", "开端（存档版）", version=9))
        c.get_sequence("gmain")
        c.get_sequence("gside")
        # gmain 的被选单元依赖 setup（传递闭包），故重算；gside 不重算
        self.assertEqual(c.recompose_log, ["gmain"])
        after = [
            c.get_slot_resolution("gmain", s)
            for s in ("p1", "p2", "p3", "p4")
        ]
        # 没有槽位直接选择 setup，所有段落结果对象保持不变
        self.assertEqual(before, after)


class TestClearCascade(unittest.TestCase):
    def test_clear_without_cascade_blocked_when_dependents_exist(self):
        c = build_populated()
        with self.assertRaises(Exception):
            c.clear_slot("gmain", "p1")  # p2/p3 依赖 setup 组
        # 选择仍在
        self.assertIsNotNone(c.get_slot_resolution("gmain", "p1").chosen)

    def test_clear_with_cascade_removes_chain(self):
        c = build_populated()
        removed = c.clear_slot("gmain", "p1", cascade=True)
        # 从 p1 起整条依赖链都被连带清空（p4 依赖 ending 链，同样失效）
        self.assertEqual(set(removed), {"p1", "p2", "p3", "p4"})
        self.assertEqual(c.get_sequence("gmain").material_ids(), ())

    def test_clear_single_source_keeps_other(self):
        c = build_populated()
        # p2 有 editor(duel v1) 与 reviewer(duel2 v2) 两个来源；
        # 撤掉 reviewer 后只剩 editor，入选回落到 v1（不影响依赖满足）
        c.clear_slot("gmain", "p2", source="reviewer")
        r = c.get_slot_resolution("gmain", "p2")
        self.assertEqual(r.chosen.unit_id, "duel")
        self.assertEqual(r.sources, ("editor",))


if __name__ == "__main__":
    unittest.main()
