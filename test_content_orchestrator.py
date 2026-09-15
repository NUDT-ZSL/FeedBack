# -*- coding: utf-8 -*-
"""content_orchestrator 的单元测试（仅标准库，可离线运行）。"""

import json
import os
import tempfile
import unittest

from content_orchestrator import (
    ChannelRule,
    LoadError,
    NotFoundError,
    Orchestrator,
    ValidationError,
    trim_text,
)


def make_orchestrator():
    """构造一个带母稿和两个渠道规则的编排器。"""
    orch = Orchestrator()
    orch.add_unit("t1", "title", "新能源汽车销量增长三成")
    orch.add_unit("s1", "summary", "今年新能源汽车销量同比增长 30%，市场持续扩大。")
    orch.add_unit("p1", "point", "要点一：政策补贴延续。")
    orch.add_unit("c1", "caption", "图：某品牌新车发布会现场。")

    weibo = ChannelRule(
        "weibo",
        allowed_types=["title", "summary", "point", "caption"],
        max_lengths={"title": 12, "summary": 20},
        required=["t1", "s1"],
    )
    weibo.add_derivation("t1")
    weibo.add_derivation("s1", {"30%": "百分之三十"})

    wechat = ChannelRule(
        "wechat",
        max_lengths={"title": 50},
        required=["t1", "p1"],
    )
    wechat.add_derivation("t1")
    wechat.add_derivation("p1")
    wechat.add_derivation("c1")

    orch.add_rule(weibo)
    orch.add_rule(wechat)
    return orch


class TestMasterDraft(unittest.TestCase):
    """需求 1：母稿与素材单元维护。"""

    def test_add_and_get(self):
        orch = Orchestrator()
        orch.add_unit("a", "title", "标题")
        self.assertEqual(orch.master.get("a").content, "标题")

    def test_duplicate_id_rejected(self):
        orch = Orchestrator()
        orch.add_unit("a", "title", "标题")
        with self.assertRaises(ValidationError) as ctx:
            orch.add_unit("a", "summary", "摘要")
        self.assertIn("a", str(ctx.exception))
        self.assertIn("重复", str(ctx.exception))

    def test_illegal_type_rejected_with_position(self):
        orch = Orchestrator()
        with self.assertRaises(ValidationError) as ctx:
            orch.add_unit("bad1", "body", "正文")
        msg = str(ctx.exception)
        self.assertIn("bad1", msg)   # 指出位置（单元标识）
        self.assertIn("body", msg)   # 指出非法类型

    def test_update_bumps_version(self):
        orch = Orchestrator()
        orch.add_unit("a", "title", "旧")
        orch.update_unit("a", "新")
        self.assertEqual(orch.master.get("a").version, 2)
        with self.assertRaises(NotFoundError):
            orch.update_unit("nope", "x")


class TestChannelRule(unittest.TestCase):
    """需求 2：渠道规则定义与引用校验。"""

    def test_rule_referencing_missing_unit_rejected(self):
        orch = Orchestrator()
        orch.add_unit("t1", "title", "标题")
        rule = ChannelRule("ch1")
        rule.add_derivation("ghost")
        with self.assertRaises(ValidationError) as ctx:
            orch.add_rule(rule)
        self.assertIn("ghost", str(ctx.exception))
        self.assertIn("ch1", str(ctx.exception))

    def test_required_missing_unit_rejected(self):
        orch = Orchestrator()
        orch.add_unit("t1", "title", "标题")
        rule = ChannelRule("ch1", required=["nope"])
        rule.add_derivation("t1")
        with self.assertRaises(ValidationError) as ctx:
            orch.add_rule(rule)
        self.assertIn("nope", str(ctx.exception))

    def test_disallowed_type_rejected(self):
        orch = Orchestrator()
        orch.add_unit("c1", "caption", "图说")
        rule = ChannelRule("ch1", allowed_types=["title"])
        rule.add_derivation("c1")
        with self.assertRaises(ValidationError) as ctx:
            orch.add_rule(rule)
        self.assertIn("caption", str(ctx.exception))

    def test_duplicate_rule_rejected(self):
        orch = make_orchestrator()
        with self.assertRaises(ValidationError):
            orch.add_rule(ChannelRule("weibo"))


class TestGenerationAndTrim(unittest.TestCase):
    """需求 3：派生、确定性裁剪与裁剪记录。"""

    def test_derivation_with_replacement(self):
        orch = make_orchestrator()
        orch.generate("weibo")
        view = orch.variant_view("weibo")
        self.assertEqual(view["items"]["s1"][:len("今年新能源汽车销量同比增长 ")],
                         "今年新能源汽车销量同比增长 ")
        self.assertNotIn("30%", view["items"]["s1"])  # 已被替换或裁剪

    def test_trim_is_deterministic_and_recorded(self):
        orch = make_orchestrator()
        orch.generate("weibo")
        view = orch.variant_view("weibo")
        # 标题上限 12，原标题 11 个字符不超；摘要上限 20 会超
        self.assertLessEqual(len(view["items"]["s1"]), 20)
        trims = [t for t in view["trims"] if t["unit_id"] == "s1"]
        self.assertEqual(len(trims), 1)
        self.assertEqual(trims[0]["original"],
                         "今年新能源汽车销量同比增长 百分之三十，市场持续扩大。")
        self.assertEqual(trims[0]["trimmed"], view["items"]["s1"])
        self.assertEqual(trims[0]["limit"], 20)
        # 再生成一次，结果完全一致（确定性）
        orch.generate("weibo")
        self.assertEqual(orch.variant_view("weibo")["items"], view["items"])

    def test_trim_text_prefers_boundary(self):
        text, rec = trim_text("aa bb cc dd", 6)
        self.assertEqual(text, "aa bb")
        self.assertEqual(rec["original"], "aa bb cc dd")
        # 短文本不裁剪、无记录
        text2, rec2 = trim_text("短", 10)
        self.assertEqual((text2, rec2), ("短", None))


class TestStaleness(unittest.TestCase):
    """需求 4：母稿修改后过期识别与增量重算。"""

    def test_update_marks_only_dependents_stale(self):
        orch = make_orchestrator()
        orch.generate_all()
        self.assertEqual(orch.stale_channels(), [])
        orch.update_unit("p1", "要点一：政策补贴延续至年底。")
        # p1 只被 wechat 引用
        self.assertEqual(orch.stale_channels(), ["wechat"])
        self.assertFalse(orch.is_stale("weibo"))
        self.assertTrue(orch.is_stale("wechat"))

    def test_refresh_equals_full_regeneration(self):
        orch = make_orchestrator()
        orch.generate_all()
        orch.update_unit("t1", "新能源销量创新高")
        orch.update_unit("s1", "今年新能源汽车销量同比增长 30%。")
        refreshed = orch.refresh_stale()
        self.assertEqual(sorted(refreshed), ["wechat", "weibo"])

        # 另起炉灶：同样的母稿与规则，从头生成
        fresh = make_orchestrator()
        fresh.update_unit("t1", "新能源销量创新高")
        fresh.update_unit("s1", "今年新能源汽车销量同比增长 30%。")
        fresh.generate_all()

        for ch in ("weibo", "wechat"):
            self.assertEqual(orch.variants[ch], fresh.variants[ch])
        self.assertEqual(orch.stale_channels(), [])


class TestConflicts(unittest.TestCase):
    """需求 5：矛盾改写保留双方并生成可读冲突记录。"""

    def test_conflicting_rewrites_recorded(self):
        orch = Orchestrator()
        orch.add_unit("s1", "summary", "销量增长 30%。")
        ra = ChannelRule("chA")
        ra.add_derivation("s1", {"30%": "三成"})
        rb = ChannelRule("chB")
        rb.add_derivation("s1", {"30%": "百分之三十"})
        orch.add_rule(ra)
        orch.add_rule(rb)
        orch.generate_all()

        conflicts = orch.detect_conflicts()
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        self.assertEqual(c["unit_id"], "s1")
        self.assertEqual(c["token"], "30%")
        self.assertEqual(c["channels"], ["chA", "chB"])
        self.assertEqual(c["rewrites"], {"chA": "三成", "chB": "百分之三十"})
        # 双方内容都保留，未被静默选择
        self.assertEqual(orch.variants["chA"].items["s1"], "销量增长 三成。")
        self.assertEqual(orch.variants["chB"].items["s1"], "销量增长 百分之三十。")
        self.assertEqual(c["contents"]["chA"], "销量增长 三成。")
        self.assertEqual(c["contents"]["chB"], "销量增长 百分之三十。")
        self.assertIn("chA", c["message"])
        self.assertIn("chB", c["message"])

    def test_same_rewrite_no_conflict(self):
        orch = Orchestrator()
        orch.add_unit("s1", "summary", "销量增长 30%。")
        for ch in ("a", "b"):
            r = ChannelRule(ch)
            r.add_derivation("s1", {"30%": "三成"})
            orch.add_rule(r)
        orch.generate_all()
        self.assertEqual(orch.detect_conflicts(), [])


class TestValidation(unittest.TestCase):
    """需求 6：一致性校验报告。"""

    def test_missing_required_reported(self):
        orch = Orchestrator()
        orch.add_unit("t1", "title", "标题")
        orch.add_unit("s1", "summary", "摘要")
        rule = ChannelRule("ch", required=["t1", "s1"])
        rule.add_derivation("t1")  # 故意不派生 s1
        orch.add_rule(rule)
        orch.generate("ch")
        report = orch.validate()
        kinds = [(i["kind"], i["unit_id"]) for i in report]
        self.assertIn(("missing_required", "s1"), kinds)

    def test_length_exceeded_reported(self):
        # 通过篡改生成后的内容模拟超限（正常生成路径会裁剪）
        orch = make_orchestrator()
        orch.generate("weibo")
        orch.variants["weibo"].items["t1"] = "x" * 100
        report = orch.validate()
        self.assertTrue(any(i["kind"] == "length_exceeded" and i["unit_id"] == "t1"
                            for i in report))

    def test_report_is_stable_and_repeatable(self):
        orch = Orchestrator()
        orch.add_unit("s1", "summary", "销量增长 30%。")
        orch.add_unit("t1", "title", "标题")
        ra = ChannelRule("chB", required=["t1"])
        ra.add_derivation("s1", {"30%": "三成"})
        rb = ChannelRule("chA", required=["t1"])
        rb.add_derivation("s1", {"30%": "百分之三十"})
        orch.add_rule(ra)
        orch.add_rule(rb)
        orch.generate_all()
        r1 = orch.validate()
        r2 = orch.validate()
        self.assertEqual(r1, r2)  # 重复校验结果相同
        keys = [(i["kind"], i["channel"], i["unit_id"] or "") for i in r1]
        self.assertEqual(keys, sorted(keys))  # 稳定顺序
        # 冲突与必填缺失都被报告
        kinds = {i["kind"] for i in r1}
        self.assertIn("semantic_conflict", kinds)
        self.assertIn("missing_required", kinds)


class TestQuery(unittest.TestCase):
    """需求 7：变体查询。"""

    def test_variant_view(self):
        orch = make_orchestrator()
        orch.generate_all()
        view = orch.variant_view("weibo")
        self.assertEqual(view["channel"], "weibo")
        self.assertEqual(view["sources"]["t1"], 1)
        self.assertFalse(view["stale"])
        self.assertTrue(all(t["channel"] == "weibo" for t in view["trims"]))
        orch.update_unit("t1", "新标题")
        self.assertTrue(orch.variant_view("weibo")["stale"])
        with self.assertRaises(NotFoundError):
            orch.variant_view("nope")

    def test_variant_view_includes_conflicts(self):
        orch = Orchestrator()
        orch.add_unit("s1", "summary", "增长 30%。")
        for ch, rep in (("a", "三成"), ("b", "百分之三十")):
            r = ChannelRule(ch)
            r.add_derivation("s1", {"30%": rep})
            orch.add_rule(r)
        orch.generate_all()
        orch.validate()
        self.assertEqual(len(orch.variant_view("a")["conflicts"]), 1)
        self.assertEqual(len(orch.variant_view("b")["conflicts"]), 1)


class TestUnitDeletion(unittest.TestCase):
    """删除仍被引用的母稿单元后的行为收紧。"""

    def test_orphaned_items_marked_and_stale(self):
        orch = make_orchestrator()
        orch.generate_all()
        orch.remove_unit("p1")
        view = orch.variant_view("wechat")
        # 历史内容保留，但来源失效被明确标记
        self.assertIn("p1", view["items"])
        self.assertEqual(view["sources"]["p1"], 1)  # 溯源记录保留
        self.assertEqual(view["orphaned"], ["p1"])
        self.assertTrue(view["stale"])
        # 未涉及删除的变体不受影响
        weibo = orch.variant_view("weibo")
        self.assertEqual(weibo["orphaned"], [])
        self.assertFalse(weibo["stale"])
        with self.assertRaises(NotFoundError):
            orch.remove_unit("p1")  # 已删除，再删报错

    def test_regeneration_drops_deleted_unit(self):
        orch = make_orchestrator()
        orch.generate_all()
        before_weibo = dict(orch.variants["weibo"].items)
        orch.remove_unit("p1")
        refreshed = orch.refresh_stale()
        self.assertEqual(refreshed, ["wechat"])
        # 重新生成后不再引用已删除单元
        view = orch.variant_view("wechat")
        self.assertNotIn("p1", view["items"])
        self.assertNotIn("p1", view["sources"])
        self.assertEqual(view["orphaned"], [])
        self.assertFalse(view["stale"])
        # 未受影响的变体内容不变
        self.assertEqual(dict(orch.variants["weibo"].items), before_weibo)

    def test_validation_reports_source_missing(self):
        orch = make_orchestrator()
        orch.generate_all()
        orch.remove_unit("p1")
        report = orch.validate()
        self.assertTrue(any(
            i["kind"] == "source_missing" and i["unit_id"] == "p1"
            and i["channel"] == "wechat" for i in report))
        # 重复校验结果相同
        self.assertEqual(orch.validate(), report)


class TestChannelCancellation(unittest.TestCase):
    """冲突一方渠道被取消后，冲突记录保留并标注失效。"""

    def _orch_with_conflict(self):
        orch = Orchestrator()
        orch.add_unit("s1", "summary", "销量增长 30%。")
        ra = ChannelRule("chA")
        ra.add_derivation("s1", {"30%": "三成"})
        rb = ChannelRule("chB")
        rb.add_derivation("s1", {"30%": "百分之三十"})
        orch.add_rule(ra)
        orch.add_rule(rb)
        orch.generate_all()
        orch.validate()
        return orch

    def test_conflict_retained_and_annotated_after_cancellation(self):
        orch = self._orch_with_conflict()
        orch.remove_channel("chB")
        records = orch.conflict_records()
        self.assertEqual(len(records), 1)  # 不静默丢弃
        rec = records[0]
        # 双方原始内容保留
        self.assertEqual(rec["contents"]["chA"], "销量增长 三成。")
        self.assertEqual(rec["contents"]["chB"], "销量增长 百分之三十。")
        self.assertEqual(rec["rewrites"], {"chA": "三成", "chB": "百分之三十"})
        # 失效标注
        self.assertEqual(rec["channel_status"],
                         {"chA": "active", "chB": "cancelled"})
        self.assertFalse(rec["active"])
        self.assertTrue(rec["unit_exists"])
        # 存续渠道的查询视图也能看到该历史冲突及标注
        view_conflicts = orch.variant_view("chA")["conflicts"]
        self.assertEqual(len(view_conflicts), 1)
        self.assertEqual(view_conflicts[0]["channel_status"]["chB"], "cancelled")
        # 再次校验不会丢弃历史冲突，且报告标注失效方
        report = orch.validate()
        self.assertEqual(len(orch.conflicts), 1)
        conflict_issues = [i for i in report if i["kind"] == "semantic_conflict"]
        self.assertEqual(len(conflict_issues), 1)
        self.assertIn("chB", conflict_issues[0]["message"])
        self.assertIn("已失效", conflict_issues[0]["message"])
        self.assertEqual(orch.validate(), report)  # 可重复

    def test_cancel_unknown_channel_rejected(self):
        orch = self._orch_with_conflict()
        with self.assertRaises(NotFoundError):
            orch.remove_channel("nope")


class TestDeletionPersistence(unittest.TestCase):
    """删除/取消后的标记与状态在导出导入后保持一致。"""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "state.json")

    def test_roundtrip_preserves_marks(self):
        orch = Orchestrator()
        orch.add_unit("s1", "summary", "销量增长 30%。")
        orch.add_unit("p1", "point", "要点一。")
        ra = ChannelRule("chA")
        ra.add_derivation("s1", {"30%": "三成"})
        ra.add_derivation("p1")
        rb = ChannelRule("chB")
        rb.add_derivation("s1", {"30%": "百分之三十"})
        orch.add_rule(ra)
        orch.add_rule(rb)
        orch.generate_all()
        orch.validate()
        orch.remove_channel("chB")   # 冲突一方失效
        orch.remove_unit("p1")       # chA 的 p1 来源失效
        orch.validate()
        orch.save(self.path)

        loaded = Orchestrator.load(self.path)
        # 变体标记一致
        view = loaded.variant_view("chA")
        self.assertEqual(view["orphaned"], ["p1"])
        self.assertTrue(view["stale"])
        # 冲突记录与标注一致
        records = loaded.conflict_records()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["channel_status"],
                         {"chA": "active", "chB": "cancelled"})
        self.assertFalse(records[0]["active"])
        self.assertEqual(records[0]["contents"]["chB"], "销量增长 百分之三十。")
        # 校验报告一致
        self.assertEqual(loaded.report, orch.report)
        # 载入后刷新过期变体：不再引用已删除单元
        self.assertEqual(loaded.refresh_stale(), ["chA"])
        self.assertNotIn("p1", loaded.variant_view("chA")["items"])

    def test_load_conflict_with_cancelled_channel_accepted(self):
        # 手工构造：冲突记录引用一个已不存在的渠道，应能载入并标注
        orch = Orchestrator()
        orch.add_unit("s1", "summary", "销量增长 30%。")
        ra = ChannelRule("chA")
        ra.add_derivation("s1", {"30%": "三成"})
        orch.add_rule(ra)
        orch.generate_all()
        orch.validate()
        data = orch.to_dict()
        data["conflicts"] = [{
            "unit_id": "s1",
            "token": "30%",
            "channels": ["chA", "chGone"],
            "rewrites": {"chA": "三成", "chGone": "百分之三十"},
            "contents": {"chA": "销量增长 三成。"},
            "message": "母稿单元 's1' 的改写点 '30%' 在渠道间互相矛盾",
        }]
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        loaded = Orchestrator.load(self.path)
        rec = loaded.conflict_records()[0]
        self.assertEqual(rec["channel_status"],
                         {"chA": "active", "chGone": "cancelled"})
        self.assertFalse(rec["active"])


class TestPersistence(unittest.TestCase):
    """需求 7/8：保存、载入与载入校验。"""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "state.json")

    def _save_sample(self):
        orch = Orchestrator()
        orch.add_unit("s1", "summary", "增长 30%，市场扩大。")
        orch.add_unit("t1", "title", "标题")
        ra = ChannelRule("chA", max_lengths={"summary": 8}, required=["s1"])
        ra.add_derivation("s1", {"30%": "三成"})
        rb = ChannelRule("chB")
        rb.add_derivation("s1", {"30%": "百分之三十"})
        rb.add_derivation("t1")
        orch.add_rule(ra)
        orch.add_rule(rb)
        orch.generate_all()
        orch.update_unit("t1", "标题 v2")  # 让 chB 过期
        orch.validate()
        orch.save(self.path)
        return orch

    def test_roundtrip(self):
        orch = self._save_sample()
        loaded = Orchestrator.load(self.path)
        self.assertEqual(loaded.master.to_list(), orch.master.to_list())
        self.assertEqual(set(loaded.rules), set(orch.rules))
        for ch in orch.variants:
            self.assertEqual(loaded.variants[ch], orch.variants[ch])
        self.assertEqual(loaded.conflicts, orch.conflicts)
        self.assertEqual(loaded.report, orch.report)
        # 过期状态在载入后依然正确
        self.assertTrue(loaded.is_stale("chB"))
        self.assertFalse(loaded.is_stale("chA"))
        # 冲突记录载入后仍可读
        self.assertEqual(len(loaded.conflicts), 1)
        self.assertEqual(loaded.conflicts[0]["channels"], ["chA", "chB"])

    def test_load_missing_file(self):
        with self.assertRaises(LoadError):
            Orchestrator.load(os.path.join(self.dir, "nope.json"))

    def _write_json(self, obj):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)

    def _valid_data(self):
        orch = self._save_sample()
        return orch.to_dict()

    def test_load_corrupt_json(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{not json")
        with self.assertRaises(LoadError):
            Orchestrator.load(self.path)

    def test_load_missing_field(self):
        data = self._valid_data()
        del data["rules"]
        self._write_json(data)
        with self.assertRaises(LoadError) as ctx:
            Orchestrator.load(self.path)
        self.assertIn("rules", str(ctx.exception))

    def test_load_duplicate_unit_id(self):
        data = self._valid_data()
        dup = dict(data["master"]["units"][0])
        data["master"]["units"].append(dup)
        self._write_json(data)
        with self.assertRaises(LoadError) as ctx:
            Orchestrator.load(self.path)
        self.assertIn("重复", str(ctx.exception))

    def test_load_rule_with_illegal_type_rejected(self):
        data = self._valid_data()
        data["rules"][0]["allowed_types"].append("body")
        self._write_json(data)
        with self.assertRaises(LoadError) as ctx:
            Orchestrator.load(self.path)
        self.assertIn("body", str(ctx.exception))

    def test_load_rule_referencing_deleted_unit_accepted(self):
        # 单元删除后的规则引用是合法历史状态，载入不拒绝
        data = self._valid_data()
        data["rules"][0]["derivations"].append(
            {"source": "ghost", "replacements": {}})
        self._write_json(data)
        loaded = Orchestrator.load(self.path)
        self.assertIsNotNone(loaded.rules[data["rules"][0]["channel"]])

    def test_load_variant_with_orphaned_source_accepted(self):
        # 来源单元已删除的变体是合法历史状态：载入保留，视图标记失效
        data = self._valid_data()
        data["variants"][0]["sources"]["ghost"] = 1
        data["variants"][0]["items"]["ghost"] = "残留内容"
        self._write_json(data)
        loaded = Orchestrator.load(self.path)
        view = loaded.variant_view(data["variants"][0]["channel"])
        self.assertEqual(view["orphaned"], ["ghost"])
        self.assertTrue(view["stale"])

    def test_load_inconsistent_conflict(self):
        data = self._valid_data()
        # 篡改冲突记录：改写值相同，不构成冲突
        data["conflicts"][0]["rewrites"] = {"chA": "一样", "chB": "一样"}
        self._write_json(data)
        with self.assertRaises(LoadError):
            Orchestrator.load(self.path)

    def test_failed_load_leaves_state_untouched(self):
        orch = self._save_sample()
        before = orch.to_dict()
        data = self._valid_data()
        del data["master"]
        self._write_json(data)
        with self.assertRaises(LoadError):
            Orchestrator.load(self.path)
        # 已有实例的内存状态保持不变
        self.assertEqual(orch.to_dict(), before)


if __name__ == "__main__":
    unittest.main()
