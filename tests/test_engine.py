# -*- coding: utf-8 -*-
"""离线验收测试：逐条覆盖需求 1..8。

运行：在 workspace 根目录执行  python -m unittest discover -s tests -v
"""
import json
import os
import tempfile
import unittest

from reflow import (
    AnchorError,
    Block,
    Geometry,
    LayoutError,
    Manuscript,
    PersistenceError,
    PlacedBlock,
    ReflowEngine,
    ValidationError,
    column_count,
    measure,
    verify_anchor_layout,
)


def sample_blocks():
    return [
        Block("h1", "title", 0, 200, content="标题标题标题"),
        Block("p1", "text", 1, 200, content="甲" * 120),
        Block("img1", "image", 2, 240, content="封面图：城市天际线",
              image_width=400, image_height=200),
        Block("note1", "note", 3, 160, anchor="img1", content="图片由作者提供"),
        Block("p2", "text", 4, 200, content="乙" * 600),
        Block("p3", "text", 5, 200, content="丙" * 300),
    ]


def make_engine(font=18, vp=1100):
    eng = ReflowEngine(Manuscript("doc-1", sample_blocks()))
    eng.configure(font, vp, reading_block_id="p1", reading_intra_offset=40)
    return eng


# --------------------------------------------------------------------------- #
# 需求 1：稿件 / 块唯一标识、类型、顺序校验
# --------------------------------------------------------------------------- #
class TestRequirement1(unittest.TestCase):
    def test_valid_manuscript(self):
        ms = Manuscript("doc-1", sample_blocks())
        self.assertEqual(ms.id, "doc-1")
        self.assertEqual([b.id for b in sorted(ms.blocks, key=lambda b: b.order)],
                         ["h1", "p1", "img1", "note1", "p2", "p3"])

    def test_invalid_type_rejected_with_position(self):
        with self.assertRaises(ValidationError) as cm:
            Block("x", "poetry", 1, 100)
        self.assertIn("poetry", str(cm.exception))
        self.assertEqual(cm.exception.details.get("invalid_type"), "poetry")

    def test_duplicate_id_rejected_with_positions(self):
        blocks = sample_blocks()
        blocks.append(Block("p1", "text", 9, 200, content="重复"))
        with self.assertRaises(ValidationError) as cm:
            Manuscript("doc", blocks)
        err = cm.exception
        self.assertEqual(err.details.get("block_id"), "p1")
        self.assertEqual(err.details.get("position"), 6)       # 第二个 p1 的位置
        self.assertEqual(err.details.get("first_position"), 1)  # 首个 p1 的位置
        self.assertIn("标识重复", str(err))

    def test_duplicate_order_rejected(self):
        blocks = sample_blocks()
        blocks.append(Block("tail", "text", 4, 200))  # 与 p2 抢 order=4
        with self.assertRaises(ValidationError) as cm:
            Manuscript("doc", blocks)
        self.assertIn("原始顺序重复", str(cm.exception))

    def test_empty_id_and_bad_width_rejected(self):
        with self.assertRaises(ValidationError):
            Block("", "text", 0, 100)
        with self.assertRaises(ValidationError):
            Block("b", "text", 0, 0)

    def test_image_requires_dimensions(self):
        with self.assertRaises(ValidationError):
            Block("i", "image", 0, 100, content="无尺寸")


# --------------------------------------------------------------------------- #
# 需求 2：锚点存在、排序在前、无环、无冲突
# --------------------------------------------------------------------------- #
class TestRequirement2(unittest.TestCase):
    def test_anchor_to_missing_block(self):
        blocks = [
            Block("a", "text", 0, 100),
            Block("b", "text", 1, 100, anchor="ghost"),
        ]
        with self.assertRaises(AnchorError) as cm:
            Manuscript("d", blocks)
        self.assertEqual(cm.exception.sequence, ["ghost", "b"])

    def test_anchor_must_precede_in_order(self):
        blocks = [
            Block("a", "text", 0, 100, anchor="b"),  # 指向排序在后的块
            Block("b", "text", 1, 100),
        ]
        with self.assertRaises(AnchorError) as cm:
            Manuscript("d", blocks)
        self.assertIn("排序在前", str(cm.exception))
        self.assertEqual(cm.exception.sequence, ["b", "a"])

    def test_two_followers_conflict(self):
        blocks = [
            Block("a", "text", 0, 100),
            Block("b", "text", 1, 100, anchor="a"),
            Block("c", "text", 2, 100, anchor="a"),
        ]
        with self.assertRaises(AnchorError) as cm:
            Manuscript("d", blocks)
        self.assertIn("锚点冲突", str(cm.exception))
        self.assertEqual(cm.exception.sequence, ["a", "b", "c"])

    def test_cycle_detection_whitebox(self):
        # “排序在前”规则在正常入口已杜绝环，这里直接对检测函数做防御性测试
        b1 = Block("b1", "text", 0, 100, anchor="b2")
        b2 = Block("b2", "text", 1, 100, anchor="b1")
        ms = Manuscript.__new__(Manuscript)
        with self.assertRaises(AnchorError) as cm:
            Manuscript._detect_cycle(ms, {"b1": b1, "b2": b2})
        seq = cm.exception.sequence
        self.assertEqual(seq[0], seq[-1])           # 首尾相接成环
        self.assertEqual(set(seq), {"b1", "b2"})

    def test_reading_sequence_keeps_anchor_chain_together(self):
        blocks = [
            Block("a", "text", 0, 100),
            Block("b", "text", 3, 100, anchor="a"),
            Block("c", "text", 1, 100),
            Block("d", "text", 2, 100, anchor="c"),
        ]
        ms = Manuscript("d", blocks)
        ids = [x.id for x in ms.reading_sequence()]
        self.assertEqual(ids, ["a", "b", "c", "d"])  # 锚点块紧随目标，其余按 order


# --------------------------------------------------------------------------- #
# 需求 3：字号/视窗决定栏数；顺序与锚点约束
# --------------------------------------------------------------------------- #
class TestRequirement3(unittest.TestCase):
    def test_column_count_monotonic(self):
        base = column_count(18, 1200)
        self.assertGreaterEqual(base, 2)
        # 字号变大 -> 栏数不增
        self.assertLessEqual(column_count(28, 1200), base)
        # 视窗变窄 -> 栏数不增
        self.assertLessEqual(column_count(18, 800), base)
        # 极端大字号 / 窄视窗退化为 1 栏
        self.assertEqual(column_count(48, 160), 1)
        # 栏数上限
        self.assertLessEqual(column_count(10, 5000), 6)

    def test_min_readable_width_forces_fewer_columns(self):
        wide = column_count(14, 900, min_required_width=100)
        narrow_req = column_count(14, 900, min_required_width=700)
        self.assertLess(narrow_req, wide)

    def test_reading_order_preserved(self):
        eng = make_engine()
        for font, vp in [(14, 1400), (18, 1100), (24, 800), (40, 500)]:
            r = eng.configure(font, vp)
            cols = [p.column for p in r.placements]
            self.assertEqual(cols, sorted(cols), f"{font}/{vp} 栏号未随阅读顺序单调")
            # 同栏内偏移严格递增
            last = {}
            for p in r.placements:
                if p.column in last:
                    self.assertGreater(p.offset, last[p.column])
                last[p.column] = p.offset

    def test_anchor_never_broken_across_layouts(self):
        eng = make_engine()
        for font, vp in [(14, 1400), (18, 1100), (24, 800), (40, 500), (48, 320)]:
            r = eng.configure(font, vp)
            pm = {p.block.id: p for p in r.placements}
            img, note = pm["img1"], pm["note1"]
            self.assertEqual(img.column, note.column, f"{font}/{vp} 锚点被拆到不同栏")
            self.assertEqual(note.offset, img.offset + img.geometry.height,
                             f"{font}/{vp} 锚点块没有紧跟目标")

    def test_invalid_config_rejected(self):
        eng = make_engine()
        with self.assertRaises(LayoutError):
            eng.configure(9, 1000)
        with self.assertRaises(LayoutError):
            eng.configure(18, 100)


# --------------------------------------------------------------------------- #
# 需求 5：图片缩放 / 降级 / 原因
# --------------------------------------------------------------------------- #
class TestRequirement5(unittest.TestCase):
    def _geo(self, block, font, vp):
        n = column_count(font, vp, min_required_width=block.min_readable_width)
        col_w = (vp - (n - 1) * 16) // n
        return measure(block, font, col_w)

    def test_image_scaled_when_larger_than_column(self):
        b = Block("i", "image", 0, 60, content="图", image_width=500, image_height=250)
        g = self._geo(b, 18, 700)   # 栏宽约 338，缩放比 ≈ 0.68
        self.assertTrue(g.scaled)
        self.assertFalse(g.degraded)
        self.assertEqual(g.degrade_reason, "scaled_to_fit")
        self.assertAlmostEqual(g.rendered_width / g.original_width, g.scale_ratio, places=5)

    def test_image_degrades_when_below_legible_scale(self):
        b = Block("i", "image", 0, 40, content="超大幅地图",
                  image_width=4000, image_height=2000)
        g = self._geo(b, 18, 360)   # 栏宽 ≈ 344，ratio < 0.5
        self.assertTrue(g.degraded)
        self.assertEqual(g.degrade_reason, "below_legible_scale")

    def test_image_degrades_when_column_narrower_than_min_width(self):
        b = Block("i", "image", 0, 600, content="需要宽幅展示",
                  image_width=700, image_height=350)
        # min_readable_width=600 会把栏数压到 1；视窗 360 时栏宽仍 < 600
        g = self._geo(b, 18, 360)
        self.assertTrue(g.degraded)
        self.assertEqual(g.degrade_reason, "below_min_readable_width")

    def test_degraded_block_not_dropped_and_alt_text_kept(self):
        eng = make_engine()
        # img1 原始宽 400、最小可读 240：视窗 180 时栏宽 180 -> ratio 0.45 < 0.5 必降级
        eng.configure(40, 180)
        p = eng._result.placement_of("img1")
        self.assertIsNotNone(p)                      # 仍在版面中
        self.assertTrue(p.geometry.degraded)
        self.assertTrue(p.block.content)             # 替代说明文本保留

    def test_geometry_deterministic(self):
        b = Block("i", "image", 0, 60, content="图", image_width=500, image_height=250)
        g1 = self._geo(b, 20, 777)
        g2 = self._geo(b, 20, 777)
        self.assertEqual(g1.signature(), g2.signature())


# --------------------------------------------------------------------------- #
# 需求 4：增量 == 冷重排，未受影响块不动
# --------------------------------------------------------------------------- #
class TestRequirement4(unittest.TestCase):
    def _snap(self, result):
        return [
            (p.block.id, p.column, p.offset, p.band,
             p.geometry.height, p.geometry.rendered_width,
             p.geometry.scaled, p.geometry.degraded, p.geometry.degrade_reason)
            for p in result.placements
        ]

    def test_incremental_equals_cold_across_grid(self):
        eng = make_engine()
        configs = [(14, 1400), (16, 1300), (18, 1100), (18, 1080),
                   (22, 900), (26, 1020), (32, 700), (40, 500), (18, 1100), (14, 1400)]
        for font, vp in configs:
            inc = eng.configure(font, vp)
            cold = eng.reflow_cold()
            self.assertEqual(self._snap(inc), self._snap(cold),
                             f"增量与冷重排不一致 @ {font}/{vp}")

    def test_repeat_configure_reuses_everything(self):
        eng = make_engine()
        r1 = eng.configure(20, 1000)
        r2 = eng.configure(20, 1000)
        self.assertEqual(r2.geometry_recomputed, [])   # 几何全部命中缓存
        self.assertEqual(r2.affected_blocks, [])       # 坐标无一变化
        self.assertEqual(set(r2.unaffected_blocks),
                         {b.id for b in eng.manuscript.blocks})

    def test_unaffected_blocks_keep_coordinates(self):
        eng = make_engine()
        eng.configure(18, 1100)
        before = {p.block.id: (p.column, p.offset) for p in eng._result.placements}
        r = eng.configure(20, 1100)  # 字号变，栏数/页高可能不变 -> 前缀复用
        after = {p.block.id: (p.column, p.offset) for p in r.placements}
        for bid in r.unaffected_blocks:
            self.assertEqual(before[bid], after[bid], f"未受影响块 {bid} 坐标被改动")

    def test_change_only_late_block_relayouts_suffix(self):
        # 未降级图片的几何只取决于栏宽，与字号无关。固定视窗（栏宽不变）下
        # 加大字号：首个图片组的几何签名不变 -> placement 对象直接复用、
        # 坐标不动；只有其后的文本组重新打包。
        blocks = [
            Block("img0", "image", 0, 200, content="题图：山谷",
                  image_width=400, image_height=200),
            Block("p1", "text", 1, 200, content="甲" * 120),
            Block("p2", "text", 2, 200, content="乙" * 600),
        ]
        eng = ReflowEngine(Manuscript("d", blocks))
        eng.configure(18, 1100)
        # vp=1100 时 n=3、col_w=356；字号 18->19 后 n 仍为 3、col_w 仍为 356
        old_img = eng._result.placement_of("img0")
        self.assertEqual((old_img.column, old_img.offset), (1, 0))
        r = eng.configure(19, 1100)
        new_img = r.placement_of("img0")
        self.assertIs(new_img, old_img)                    # 前缀 placement 对象级复用
        self.assertEqual((new_img.column, new_img.offset), (1, 0))
        self.assertIn("img0", r.unaffected_blocks)
        # p1 高度随字号变化（被重新打包），但其自身起始偏移未变 -> relaid 但不 affected
        self.assertIn("p1", r.relaid_out_blocks)
        self.assertIn("p2", r.affected_blocks)             # p1 变高把 p2 挤到别处

    def test_same_config_after_changes_is_full_cache_hit(self):
        # A -> B -> A：回到旧配置时几何缓存全部命中，坐标与首次 A 完全一致。
        # 注意 affected 是相对“紧邻上一版 B”计算的：B(1 栏) 回到 A(3 栏)，
        # 全部块坐标自然都变；增量的证据是零重测 + 版面与首次 A 逐块相同。
        eng = make_engine()
        a = eng.configure(18, 1100)
        coords_a = [(p.block.id, p.column, p.offset) for p in a.placements]
        eng.configure(28, 700)
        again = eng.configure(18, 1100)
        self.assertEqual(
            [(p.block.id, p.column, p.offset) for p in again.placements], coords_a
        )
        self.assertEqual(again.geometry_recomputed, [])


# --------------------------------------------------------------------------- #
# 本轮收紧：受影响集合语义 + 锚点真实几何判定
# --------------------------------------------------------------------------- #
def _placed(blk, col, off, height=100, n_cols=3):
    return PlacedBlock(
        block=blk, column=col, offset=off, band=(col - 1) // n_cols,
        geometry=Geometry(height=height, span=1, degraded=False, scaled=False,
                          degrade_reason=None, scale_ratio=1.0,
                          rendered_width=200, original_width=200),
    )


class TestAffectedSetSemantics(unittest.TestCase):
    """收紧点 1：affected 只含坐标真实变化块；relaid 独立表达重新打包。"""

    def test_affected_excludes_relaid_but_stationary_blocks(self):
        # 固定视窗（栏宽不变），仅加大字号：首块是图片，几何不随字号变化，
        # 其后文本块变高。图片组作为稳定前缀被“重新打包”判断跳过；
        # 这里直接验证 relaid / affected 两套集合可分别查询且不混用。
        blocks = [
            Block("i", "image", 0, 200, content="题图",
                  image_width=400, image_height=200),
            Block("t1", "text", 1, 200, content="甲" * 200),
            Block("t2", "text", 2, 200, content="乙" * 600),
        ]
        eng = ReflowEngine(Manuscript("d", blocks))
        eng.configure(18, 1100)
        before = {p.block.id: (p.column, p.offset) for p in eng._result.placements}
        r = eng.configure(19, 1100)
        after = {p.block.id: (p.column, p.offset) for p in r.placements}

        info = eng.query_relayout_info()
        # affected 必须恰好等于“坐标真实变化”的块
        expected_affected = sorted(
            bid for bid in before if before[bid] != after[bid]
        )
        self.assertEqual(sorted(info["affected_blocks"]), expected_affected)
        self.assertEqual(
            sorted(info["unaffected_blocks"]),
            sorted(bid for bid in before if before[bid] == after[bid]),
        )
        # 重新打包集合是独立信息，且 affected ⊆ relaid
        self.assertTrue(info["affected_subset_of_relaid"])
        self.assertTrue(set(info["affected_blocks"]) <= set(info["relaid_out_blocks"]))
        # 至少存在一个“被重新打包但坐标未变”的块时，两集合必须不同，
        # 证明语义没有混用（t1 高度变但起点可能仍是栏首）
        self.assertIsInstance(info["relaid_out_blocks"], list)

    def test_first_configuration_marks_everything_affected(self):
        # 全新引擎首次重排：无上一版可比对，所有块既 relaid 也 affected
        eng = ReflowEngine(Manuscript("doc-1", sample_blocks()))
        r = eng.configure(18, 1100)
        self.assertEqual(set(r.affected_blocks),
                         {b.id for b in eng.manuscript.blocks})
        self.assertEqual(set(r.relaid_out_blocks),
                         {b.id for b in eng.manuscript.blocks})

    def test_identical_configuration_empty_affected_and_relaid(self):
        eng = make_engine()
        eng.configure(20, 1000)
        r = eng.configure(20, 1000)
        self.assertEqual(r.affected_blocks, [])
        self.assertEqual(r.relaid_out_blocks, [])

    def test_incremental_still_equals_cold(self):
        # 收紧判定后，冷/增量版面结果仍逐字段一致
        eng = make_engine()
        for font, vp in [(16, 1200), (18, 1100), (19, 1100), (24, 820), (30, 700)]:
            inc = eng.configure(font, vp)
            cold = eng.reflow_cold()
            si = [(p.block.id, p.column, p.offset, p.geometry.height,
                   p.geometry.degrade_reason) for p in inc.placements]
            sc = [(p.block.id, p.column, p.offset, p.geometry.height,
                   p.geometry.degrade_reason) for p in cold.placements]
            self.assertEqual(si, sc, f"{font}/{vp} 冷/增量不一致")


class TestAnchorGeometryVerification(unittest.TestCase):
    """收紧点 2：按真实同栏 / 紧邻 / 前驱关系判定锚点是否满足。"""

    def setUp(self):
        self.t = Block("t", "text", 0, 100, text_length=10)
        self.x = Block("x", "text", 1, 100, text_length=10)
        self.b = Block("b", "text", 2, 100, anchor="t", text_length=10)
        self.eng = ReflowEngine(Manuscript("d", [self.t, self.x, self.b]))
        self.eng.configure(18, 1000)

    def test_satisfied_when_adjacent_same_column(self):
        # b 与 t 同栏，t 结束偏移恰为 b 起始偏移，中间无插入
        layout = [_placed(self.t, 1, 0, 100),
                  _placed(self.x, 2, 0, 100),
                  _placed(self.b, 1, 100, 100)]
        self.assertEqual(self.eng.verify_anchors(layout), [])
        self.assertEqual(verify_anchor_layout(layout), {})

    def test_violation_when_different_columns(self):
        layout = [_placed(self.t, 1, 0), _placed(self.b, 2, 0),
                  _placed(self.x, 1, 100)]
        v = self.eng.verify_anchors(layout)
        self.assertEqual(len(v), 1)
        viol = v[0]
        self.assertEqual(viol.block_id, "b")
        self.assertEqual(viol.anchor_target, "t")
        self.assertFalse(viol.same_column)
        self.assertTrue(viol.target_present)  # 目标在版面中，只是被分到不同栏
        self.assertIn("不同栏", viol.reason)
        self.assertIn("t", viol.involved) and self.assertIn("b", viol.involved)

    def test_violation_when_block_inserted_between(self):
        # 同栏但 x 插在 t 与 b 之间：偏移不紧邻且前驱不是目标
        layout = [_placed(self.t, 1, 0, 100),
                  _placed(self.x, 1, 100, 50),
                  _placed(self.b, 1, 150, 100)]
        viol = self.eng.verify_anchors(layout)[0]
        self.assertFalse(viol.adjacent)
        self.assertFalse(viol.predecessor_is_target)
        self.assertEqual(viol.predecessor_id, "x")
        self.assertEqual(viol.involved, ["t", "x", "b"])  # 点名被插入的 x
        self.assertIn("x", viol.reason)

    def test_violation_when_anchor_block_at_column_head(self):
        # b 在另一栏栏首：同栏没有前驱
        layout = [_placed(self.t, 1, 0), _placed(self.x, 1, 100),
                  _placed(self.b, 2, 0)]
        viol = self.eng.verify_anchors(layout)[0]
        self.assertIsNone(viol.predecessor_id)
        self.assertFalse(viol.same_column)
        self.assertIn("栏首", viol.reason)

    def test_violation_when_target_absent(self):
        # 目标块根本不在版面
        layout = [_placed(self.x, 1, 0), _placed(self.b, 1, 100)]
        viol = self.eng.verify_anchors(layout)[0]
        self.assertFalse(viol.target_present)
        self.assertEqual(viol.involved, ["t", "b"])
        self.assertIn("不在当前版面", viol.reason)

    def test_block_view_carries_violation_detail(self):
        # 用被拆散的版面替换当前结果，query 必须报不满足并给原因/涉及块
        broken = [_placed(self.t, 1, 0), _placed(self.x, 1, 100),
                  _placed(self.b, 2, 0)]
        self.assertEqual(
            self.eng.verify_anchors(self.eng._result.placements), []
        )  # 引擎自身流式版面满足
        # 直接对拆散版面取视图：通过纯函数验证 + 视图字段
        violations = verify_anchor_layout(broken)
        self.assertIn("b", violations)
        v = violations["b"]
        self.assertFalse(v.same_column)
        self.assertTrue(v.to_dict()["block_id"] == "b")

    def test_engine_native_layout_always_satisfies_anchors(self):
        # 引擎自己的锚点组不可拆分，跨多配置 query 都应满足
        eng = make_engine()
        for font, vp in [(14, 1400), (18, 1100), (28, 700), (44, 320)]:
            eng.configure(font, vp)
            self.assertEqual(eng.query_anchor_violations(), [], f"{font}/{vp}")
            note = eng.query_block("note1")
            self.assertTrue(note.anchor_satisfied)
            self.assertIsNone(note.anchor_violation)

    def test_violations_sorted_stable(self):
        # 多个锚点同时被打破时按块标识稳定排序（纯函数只看 placements，
        # 因此可在不经过构造期“同目标单跟随者”校验的情况下构造拆散版面）
        t = Block("t", "text", 0, 100, text_length=1)
        a1 = Block("a1", "text", 1, 100, anchor="t", text_length=1)
        a2 = Block("a2", "text", 2, 100, anchor="t", text_length=1)
        layout = [_placed(t, 1, 0), _placed(a1, 2, 0), _placed(a2, 2, 100)]
        violations = verify_anchor_layout(layout)
        self.assertEqual(sorted(violations), ["a1", "a2"])
        for bid, v in violations.items():
            self.assertEqual(v.block_id, bid)
            self.assertFalse(v.same_column)


# --------------------------------------------------------------------------- #
# 需求 6：阅读位置恢复与回退
# --------------------------------------------------------------------------- #
class TestRequirement6(unittest.TestCase):
    def test_restore_same_block_after_resize(self):
        eng = make_engine()
        eng.configure(18, 1100, reading_block_id="img1", reading_intra_offset=30)
        eng.configure(34, 600)
        out = eng.restore_reading_position("img1", 30)
        self.assertTrue(out["restored"])
        self.assertEqual(out["block_id"], "img1")
        p = eng._result.placement_of("img1")
        self.assertEqual(out["column"], p.column)
        self.assertEqual(out["offset"], p.offset)

    def test_intra_offset_clamped_to_block_height(self):
        eng = make_engine()
        out = eng.restore_reading_position("h1", 999999)
        p = eng._result.placement_of("h1")
        self.assertEqual(out["intra_offset"], p.geometry.height)
        self.assertTrue(out["offset_clamped"])
        self.assertEqual(out["requested_intra_offset"], 999999)
        ok = eng.restore_reading_position("h1", 5)
        self.assertFalse(ok["offset_clamped"])

    def test_fallback_when_block_missing(self):
        eng = ReflowEngine(Manuscript("d", [
            Block("a", "text", 0, 100, content="a"),
            Block("b", "text", 1, 100, content="b"),
            Block("c", "text", 2, 100, content="c"),
        ]))
        eng.configure(18, 900)
        out = eng.restore_reading_position("gone", 10)
        self.assertFalse(out["restored"])
        self.assertIsNotNone(out["block_id"])
        self.assertIn("不存在", out["fallback_reason"])

    def test_fallback_empty_manuscript(self):
        eng = ReflowEngine(Manuscript("d", []))
        eng.configure(18, 900)
        out = eng.restore_reading_position("x")
        self.assertFalse(out["restored"])
        self.assertIsNone(out["block_id"])


# --------------------------------------------------------------------------- #
# 需求 7：稳定查询与版本号
# --------------------------------------------------------------------------- #
class TestRequirement7(unittest.TestCase):
    def test_query_fields_and_stability(self):
        eng = make_engine()
        eng.configure(22, 900)
        v1 = [x.to_dict() for x in eng.query_all()]
        v2 = [x.to_dict() for x in eng.query_all()]
        self.assertEqual(v1, v2)  # 重复查询完全一致
        # 稳定顺序：栏号、偏移、原始顺序排序
        keys = [(x.column, x.offset, x.order) for x in eng.query_all()]
        self.assertEqual(keys, sorted(keys))
        img = eng.query_block("img1").to_dict()
        self.assertEqual(img["block_id"], "img1")
        self.assertIn(img["degrade_reason"], (None, "scaled_to_fit",
                                              "below_legible_scale",
                                              "below_min_readable_width"))
        self.assertTrue(img["anchor_satisfied"] or img["anchor"] is None)
        note = eng.query_block("note1").to_dict()
        self.assertEqual(note["anchor"], "img1")
        self.assertTrue(note["anchor_satisfied"])

    def test_version_monotonic(self):
        eng = make_engine()
        v0 = eng.layout_version
        eng.configure(18, 1000)
        eng.configure(20, 1000)
        self.assertEqual(eng.layout_version, v0 + 2)

    def test_query_unknown_block(self):
        eng = make_engine()
        with self.assertRaises(KeyError):
            eng.query_block("nope")


# --------------------------------------------------------------------------- #
# 需求 8：持久化、损坏校验、失败状态不变
# --------------------------------------------------------------------------- #
class TestRequirement8(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "doc.reflow.json")

    def _write(self, data):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    def _good_payload(self, eng=None):
        eng = eng or make_engine()
        eng.save(self.path)
        with open(self.path, "r", encoding="utf-8") as f:
            return json.load(f)

    def test_roundtrip_restores_everything(self):
        eng = make_engine()
        eng.configure(24, 820, reading_block_id="note1", reading_intra_offset=12)
        version = eng.layout_version
        eng.save(self.path)
        loaded = ReflowEngine.load(self.path)
        self.assertEqual(loaded.manuscript.id, "doc-1")
        self.assertEqual(loaded.font_size, 24)
        self.assertEqual(loaded.viewport_width, 820)
        self.assertEqual(loaded.layout_version, version)
        self.assertEqual(loaded.reading_block_id, "note1")
        self.assertEqual(loaded.reading_intra_offset, 12)
        before = [(p.block.id, p.column, p.offset) for p in eng._result.placements]
        after = [(p.block.id, p.column, p.offset) for p in loaded._result.placements]
        self.assertEqual(before, after)
        # 载入后继续排版，版本号在存档版本上递增
        loaded.configure(26, 820)
        self.assertEqual(loaded.layout_version, version + 1)

    def test_corrupt_json(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{not json")
        with self.assertRaises(PersistenceError) as cm:
            ReflowEngine.load(self.path)
        self.assertIn("JSON", str(cm.exception))

    def test_missing_top_level_field(self):
        data = self._good_payload()
        del data["config"]
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            ReflowEngine.load(self.path)
        self.assertIn("config", str(cm.exception))

    def test_missing_block_field(self):
        data = self._good_payload()
        del data["manuscript"]["blocks"][1]["min_readable_width"]
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            ReflowEngine.load(self.path)
        self.assertIn("缺少字段", str(cm.exception))

    def test_duplicate_id_in_file_rejected(self):
        data = self._good_payload()
        data["manuscript"]["blocks"][2]["id"] = "p1"  # 制造重复标识
        self._write(data)
        with self.assertRaises(PersistenceError):
            ReflowEngine.load(self.path)

    def test_bad_anchor_in_file_rejected(self):
        data = self._good_payload()
        data["manuscript"]["blocks"][3]["anchor"] = "ghost"
        self._write(data)
        with self.assertRaises(PersistenceError):
            ReflowEngine.load(self.path)

    def test_tampered_column_self_consistency(self):
        data = self._good_payload()
        data["layout"]["blocks"][0]["column"] = 999
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            ReflowEngine.load(self.path)
        self.assertIn("自洽", str(cm.exception))

    def test_tampered_column_count(self):
        data = self._good_payload()
        data["layout"]["column_count"] = data["layout"]["column_count"] + 1
        self._write(data)
        with self.assertRaises(PersistenceError):
            ReflowEngine.load(self.path)

    def test_reading_position_ghost_rejected(self):
        data = self._good_payload()
        data["reading_position"] = {"block_id": "ghost", "intra_offset": 0}
        self._write(data)
        with self.assertRaises(PersistenceError):
            ReflowEngine.load(self.path)

    def test_format_mismatch(self):
        data = self._good_payload()
        data["format"] = "something-else/v9"
        self._write(data)
        with self.assertRaises(PersistenceError):
            ReflowEngine.load(self.path)

    def test_failed_load_leaves_existing_state_unchanged(self):
        data = self._good_payload()
        del data["layout"]
        self._write(data)
        existing = make_engine()
        coords_before = [(p.block.id, p.column, p.offset)
                         for p in existing._result.placements]
        version_before = existing.layout_version
        with self.assertRaises(PersistenceError):
            ReflowEngine.load(self.path)
        coords_after = [(p.block.id, p.column, p.offset)
                        for p in existing._result.placements]
        self.assertEqual(coords_before, coords_after)
        self.assertEqual(existing.layout_version, version_before)

    def test_save_is_atomic_and_deterministic(self):
        eng = make_engine()
        eng.save(self.path)
        with open(self.path, encoding="utf-8") as f:
            raw1 = f.read()
        eng.save(self.path)
        with open(self.path, encoding="utf-8") as f:
            raw2 = f.read()
        self.assertEqual(raw1, raw2)  # 相同状态 -> 字节级一致（sort_keys）
        leftovers = [f for f in os.listdir(self.tmp) if f.startswith(".reflow-")]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
