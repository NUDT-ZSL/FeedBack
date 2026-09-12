"""textindex 的 unittest 测试集。"""

import time
import unittest

from textindex import InvertedIndex, SearchHit, Token, tokenize


class TestTokenize(unittest.TestCase):
    def test_english_and_numbers(self):
        tokens = tokenize("Hello World 123")
        self.assertEqual(
            [(t.term, t.start, t.end) for t in tokens],
            [("hello", 0, 5), ("world", 6, 11), ("123", 12, 15)],
        )

    def test_lowercase_toggle(self):
        self.assertEqual([t.term for t in tokenize("AbC")], ["abc"])
        self.assertEqual(
            [t.term for t in tokenize("AbC", lowercase=False)], ["AbC"]
        )

    def test_keep_numbers_toggle(self):
        self.assertEqual(
            [t.term for t in tokenize("a1 42 b", keep_numbers=True)],
            ["a1", "42", "b"],
        )
        self.assertEqual(
            [t.term for t in tokenize("a1 42 b", keep_numbers=False)],
            ["a1", "b"],
        )

    def test_cjk_each_char_is_a_token(self):
        tokens = tokenize("你好世界")
        self.assertEqual(
            [(t.term, t.start, t.end) for t in tokens],
            [("你", 0, 1), ("好", 1, 2), ("世", 2, 3), ("界", 3, 4)],
        )

    def test_cjk_english_mixed(self):
        tokens = tokenize("使用Python语言")
        self.assertEqual(
            [(t.term, t.start, t.end) for t in tokens],
            [("使", 0, 1), ("用", 1, 2), ("python", 2, 8),
             ("语", 8, 9), ("言", 9, 10)],
        )

    def test_punctuation_and_whitespace_dropped(self):
        tokens = tokenize("  foo, bar!  …baz\t\n")
        self.assertEqual([t.term for t in tokens], ["foo", "bar", "baz"])

    def test_offsets_are_char_offsets_not_bytes(self):
        # "中" 是 3 字节 UTF-8，但偏移必须按字符计
        tokens = tokenize("中abc")
        self.assertEqual((tokens[1].start, tokens[1].end), (1, 4))

    def test_empty_and_punct_only(self):
        self.assertEqual(tokenize(""), [])
        self.assertEqual(tokenize("，。！、 …"), [])


class TestInvertedIndex(unittest.TestCase):
    def setUp(self):
        self.idx = InvertedIndex()
        self.idx.add_document("d1", "the quick brown fox")
        self.idx.add_document("d2", "the lazy dog")
        self.idx.add_document("d3", "quick quick dog")

    def test_add_returns_token_count(self):
        idx = InvertedIndex()
        self.assertEqual(idx.add_document("x", "a b c a"), 4)
        self.assertEqual(idx.add_document("y", ""), 0)

    def test_empty_doc_id_raises(self):
        with self.assertRaises(ValueError):
            self.idx.add_document("", "text")

    def test_and_mode(self):
        hits = self.idx.search("quick dog", mode="AND")
        self.assertEqual([h.doc_id for h in hits], ["d3"])

    def test_or_mode(self):
        hits = self.idx.search("quick dog", mode="OR")
        self.assertEqual([h.doc_id for h in hits], ["d3", "d1", "d2"])
        # d3 命中 2/2 词，d1/d2 各命中 1/2
        self.assertEqual(hits[0].score, 1.0)
        self.assertEqual(hits[1].score, 0.5)
        self.assertEqual(hits[2].score, 0.5)

    def test_tie_break_by_doc_id_ascending(self):
        # d1 和 d2 都只命中 "the"，同分，必须按 doc_id 升序
        hits = self.idx.search("the", mode="OR")
        self.assertEqual([h.doc_id for h in hits], ["d1", "d2"])
        self.assertTrue(all(h.score == 1.0 for h in hits))

    def test_positions_sorted_deduped(self):
        hits = self.idx.search("quick", mode="OR")
        hit = {h.doc_id: h for h in hits}["d3"]
        self.assertEqual(hit.positions, {"quick": [0, 6]})

    def test_positions_are_char_offsets(self):
        idx = InvertedIndex()
        idx.add_document("doc", "中文 test 中文")
        hits = idx.search("中 test")
        self.assertEqual(len(hits), 1)
        # "中文 test 中文"：中 在 0 和 8，test 起始偏移为 3
        self.assertEqual(hits[0].positions["中"], [0, 8])
        self.assertEqual(hits[0].positions["test"], [3])

    def test_overwrite_removes_old_postings(self):
        self.idx.add_document("d1", "completely new text")
        self.assertEqual(self.idx.search("fox"), [])
        self.assertEqual(self.idx.search("quick", mode="AND"),
                         [h for h in self.idx.search("quick", mode="AND")
                          if h.doc_id != "d1"])
        hits = self.idx.search("new")
        self.assertEqual([h.doc_id for h in hits], ["d1"])
        self.assertEqual(hits[0].positions["new"], [11])

    def test_remove_document(self):
        self.assertTrue(self.idx.remove_document("d2"))
        self.assertFalse(self.idx.remove_document("d2"))
        self.assertFalse(self.idx.remove_document("never-existed"))
        for hit in self.idx.search("the lazy dog", mode="OR"):
            self.assertNotEqual(hit.doc_id, "d2")

    def test_limit(self):
        # 三篇文档都命中 2/3 词，同分按 doc_id 升序，取前 2 个
        hits = self.idx.search("the quick dog", mode="OR", limit=2)
        self.assertEqual([h.doc_id for h in hits], ["d1", "d2"])
        self.assertTrue(all(h.score == 2 / 3 for h in hits))
        self.assertEqual(self.idx.search("the", limit=0), [])
        self.assertEqual(self.idx.search("the", limit=-5), [])
        self.assertEqual(len(self.idx.search("the", limit=None)), 2)

    def test_empty_and_punct_only_query(self):
        self.assertEqual(self.idx.search(""), [])
        self.assertEqual(self.idx.search("   "), [])
        self.assertEqual(self.idx.search("！！！。。。"), [])

    def test_duplicate_query_terms_deduped(self):
        # "quick quick" 去重后只有 1 个查询词，d3 得满分
        hits = self.idx.search("quick quick quick", mode="AND")
        by_id = {h.doc_id: h for h in hits}
        self.assertEqual(by_id["d3"].score, 1.0)
        self.assertEqual(by_id["d1"].score, 1.0)
        # 同分按 doc_id 升序
        self.assertEqual([h.doc_id for h in hits], ["d1", "d3"])

    def test_query_normalization(self):
        # 查询走同样的 tokenize：大小写折叠、标点丢弃
        hits = self.idx.search("  QUICK, Dog! ", mode="AND")
        self.assertEqual([h.doc_id for h in hits], ["d3"])

    def test_invalid_mode_raises(self):
        with self.assertRaises(ValueError):
            self.idx.search("quick", mode="XOR")

    def test_stats_reflect_changes_immediately(self):
        s0 = self.idx.stats()
        self.assertEqual(s0["doc_count"], 3)
        self.assertEqual(
            s0["term_count"],
            len({"the", "quick", "brown", "fox", "lazy", "dog"}),
        )
        # d1:4 + d2:3 + d3:3 = 10 个位置条目
        self.assertEqual(s0["posting_count"], 10)

        self.idx.add_document("d4", "brand new terms here")
        s1 = self.idx.stats()
        self.assertEqual(s1["doc_count"], 4)
        self.assertEqual(s1["term_count"], s0["term_count"] + 4)
        self.assertEqual(s1["posting_count"], s0["posting_count"] + 4)

        self.idx.remove_document("d4")
        self.assertEqual(self.idx.stats(), s0)

        # 覆盖写也要立刻反映
        self.idx.add_document("d1", "the")
        s2 = self.idx.stats()
        self.assertEqual(s2["posting_count"], s0["posting_count"] - 3)

    def test_cjk_english_mixed_search(self):
        idx = InvertedIndex()
        idx.add_document("log1", "用户登录失败 error code 500")
        idx.add_document("log2", "用户登录成功")
        hits = idx.search("登录 error", mode="AND")
        self.assertEqual([h.doc_id for h in hits], ["log1"])
        self.assertEqual(hits[0].positions["登"], [2])
        self.assertEqual(hits[0].positions["录"], [3])
        hits_or = idx.search("登录 error", mode="OR")
        self.assertEqual([h.doc_id for h in hits_or], ["log1", "log2"])

    def test_large_document_performance(self):
        idx = InvertedIndex()
        text = ("日志内容 log entry 12345 error occurred。 " * 6000)[:200_000]
        self.assertEqual(len(text), 200_000)
        start = time.perf_counter()
        n = idx.add_document("big", text)
        elapsed = time.perf_counter() - start
        self.assertGreater(n, 0)
        self.assertLess(elapsed, 2.0, f"add_document 耗时 {elapsed:.2f}s")
        # 写入后仍可检索
        hits = idx.search("error")
        self.assertEqual([h.doc_id for h in hits], ["big"])


if __name__ == "__main__":
    unittest.main()
