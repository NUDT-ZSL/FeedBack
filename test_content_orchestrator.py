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

    def test_load_rule_referencing_missing_unit(self):
        data = self._valid_data()
        data["rules"][0]["derivations"].append(
            {"source": "ghost", "replacements": {}})
        self._write_json(data)
        with self.assertRaises(LoadError) as ctx:
            Orchestrator.load(self.path)
        self.assertIn("ghost", str(ctx.exception))

    def test_load_variant_with_missing_source(self):
        data = self._valid_data()
        data["variants"][0]["sources"]["ghost"] = 1
        self._write_json(data)
        with self.assertRaises(LoadError) as ctx:
            Orchestrator.load(self.path)
        self.assertIn("ghost", str(ctx.exception))

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
