import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from merge_engine import MergeSession, merge_replaces

ROOT = Path(__file__).resolve().parent.parent


def load_session():
    doc = json.loads((ROOT / "sample_data" / "document.json").read_text(encoding="utf-8"))
    edits = json.loads((ROOT / "sample_data" / "edits.json").read_text(encoding="utf-8"))
    return MergeSession(doc, edits)


class MergeReplaceTest(unittest.TestCase):
    def test_disjoint_edits_merge(self):
        base = "系统支持 20 人编辑, 并提供自动保存。"
        a = "系统支持 50 人编辑, 并提供自动保存。"
        b = "系统支持 20 人编辑, 并提供手动保存。"
        ok, text = merge_replaces(base, [a, b])
        self.assertTrue(ok)
        self.assertEqual(text, "系统支持 50 人编辑, 并提供手动保存。")

    def test_overlapping_edits_conflict(self):
        base = "最多 20 人同时编辑。"
        a = "最多 50 人同时编辑。"
        b = "最多 100 人同时编辑。"
        ok, _ = merge_replaces(base, [a, b])
        self.assertFalse(ok)


class SessionTest(unittest.TestCase):
    def test_conflict_detected_on_same_paragraph(self):
        s = load_session()
        groups = s.paragraph_groups()
        # p4: 小林与阿May 的替换区间不重叠, 应可自动合并
        self.assertTrue(groups["p4"]["mergeable"])
        self.assertIn("50 人", groups["p4"]["merged_text"])
        self.assertIn("只观模式", groups["p4"]["merged_text"])
        # p7: 删除与替换冲突
        self.assertFalse(groups["p7"]["mergeable"])
        self.assertTrue(groups["p7"]["conflicts"])

    def test_reject_updates_merge_result(self):
        s = load_session()
        s.decide("e1", "rejected")  # 拒绝小林的 50 人改动
        groups = s.paragraph_groups()
        self.assertNotIn("50 人", groups["p4"]["merged_text"])
        self.assertIn("只观模式", groups["p4"]["merged_text"])

    def test_dependency_invalidation(self):
        s = load_session()
        s.decide("e1", "rejected")  # e3 依赖 e1
        statuses = s.edit_statuses()
        self.assertEqual(statuses["e3"]["status"], "invalid")
        self.assertIn("e1", statuses["e3"]["reason"])

    def test_delete_invalidates_other_edits(self):
        s = load_session()
        s.decide("e4", "accepted")  # 接受删除 p7
        statuses = s.edit_statuses()
        self.assertEqual(statuses["e5"]["status"], "invalid")
        self.assertIn("删除", statuses["e5"]["reason"])
        final = s.final_document()
        texts = [p["text"] for sec in final["sections"]
                 for p in sec["paragraphs"]]
        self.assertNotIn("第一个内测版本计划在第四季度发布。", texts)

    def test_accept_and_final_document(self):
        s = load_session()
        s.decide("e6", "accepted")  # 插入弱网说明
        final = s.final_document()
        paras = final["sections"][1]["children"][0]["paragraphs"]
        self.assertEqual(len(paras), 2)
        self.assertIn("弱网", paras[1]["text"])

    def test_override_wins(self):
        s = load_session()
        s.set_override("p4", "系统应支持最多 30 人同时在线编辑。")
        text, deleted = s.final_paragraph_text("p4")
        self.assertFalse(deleted)
        self.assertEqual(text, "系统应支持最多 30 人同时在线编辑。")

    def test_unresolved_list(self):
        s = load_session()
        u = s.unresolved()
        self.assertTrue(u["pending_edits"])
        self.assertTrue(any(c["paragraph_id"] == "p7" for c in u["conflict_paragraphs"]))
        for eid in ("e1", "e2", "e3", "e4", "e5", "e6", "e7"):
            s.decide(eid, "accepted")
        self.assertEqual(s.unresolved()["pending_edits"], [])


if __name__ == "__main__":
    unittest.main()
