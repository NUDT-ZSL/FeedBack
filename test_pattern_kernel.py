# -*- coding: utf-8 -*-
"""pattern_kernel 的 unittest 测试。

覆盖：模式解析、NFA 构造、抽取语义、流式一致性、歧义优先级、
内存上限（max_buffer）、快照往返、错误处理。
"""

import json
import os
import tempfile
import unittest

from pattern_kernel import (
    PatternConflictError,
    PatternError,
    PatternSet,
    PatternSyntaxError,
    SnapshotError,
    StreamExtractor,
    UnknownPatternError,
)


class TestPatternParsing(unittest.TestCase):
    """模式解析：字面量、转义、通配、占位符、类型标注。"""

    def test_literal_and_wildcard(self):
        ps = PatternSet()
        report = ps.compile("p", "ab?d")
        self.assertEqual(report["placeholders"], [])
        self.assertIsNotNone(ps.match("abcd"))
        self.assertIsNotNone(ps.match("abXd"))
        self.assertIsNone(ps.match("abd"))   # ? 必须消费一个字符
        self.assertIsNone(ps.match("abcdd"))  # 整串匹配，不能多

    def test_escapes(self):
        ps = PatternSet()
        ps.compile("p", r"a\?b\{c\}d\\e")
        self.assertIsNotNone(ps.match("a?b{c}d\\e"))
        self.assertIsNone(ps.match("aXb{c}d\\e"))

    def test_dangling_escape(self):
        ps = PatternSet()
        with self.assertRaises(PatternSyntaxError):
            ps.compile("p", "abc\\")

    def test_unterminated_placeholder(self):
        ps = PatternSet()
        with self.assertRaises(PatternSyntaxError) as ctx:
            ps.compile("p", "a {name")
        self.assertIsNotNone(ctx.exception.position)

    def test_unmatched_close_brace(self):
        ps = PatternSet()
        with self.assertRaises(PatternSyntaxError):
            ps.compile("p", "a}b")

    def test_invalid_placeholder_name(self):
        ps = PatternSet()
        for bad in ("{}", "{1abc}", "{a b}", "{:int}"):
            with self.assertRaises(PatternSyntaxError, msg=bad):
                ps.compile("p%s" % bad, bad)

    def test_unknown_placeholder_type(self):
        ps = PatternSet()
        with self.assertRaises(PatternSyntaxError) as ctx:
            ps.compile("p", "{x:float}")
        self.assertIn("float", str(ctx.exception))

    def test_duplicate_placeholder_name(self):
        ps = PatternSet()
        with self.assertRaises(PatternSyntaxError):
            ps.compile("p", "{a} {a}")

    def test_placeholder_report_order(self):
        ps = PatternSet()
        report = ps.compile("p", "{a} {b:int} {c:*} {d:word}")
        self.assertEqual(
            report["placeholders"],
            [
                {"name": "a", "type": "token"},
                {"name": "b", "type": "int"},
                {"name": "c", "type": "greedy"},
                {"name": "d", "type": "word"},
            ],
        )


class TestNfaConstruction(unittest.TestCase):
    """Thompson 构造的编译产物：状态数、转移数。"""

    def test_literal_only(self):
        ps = PatternSet()
        report = ps.compile("p", "ab")
        # char a, char b, match
        self.assertEqual(report["state_count"], 3)
        self.assertEqual(report["transition_count"], 2)

    def test_wildcard(self):
        ps = PatternSet()
        report = ps.compile("p", "a?b")
        # char, any, char, match
        self.assertEqual(report["state_count"], 4)
        self.assertEqual(report["transition_count"], 3)

    def test_token_placeholder(self):
        ps = PatternSet()
        report = ps.compile("p", "{x}")
        # save, class, split(2), save, match
        self.assertEqual(report["state_count"], 5)
        self.assertEqual(report["transition_count"], 5)

    def test_greedy_placeholder(self):
        ps = PatternSet()
        report = ps.compile("p", "{x:*}")
        # save, split(2), any, jmp, save, match
        self.assertEqual(report["state_count"], 6)
        self.assertEqual(report["transition_count"], 6)

    def test_int_placeholder(self):
        ps = PatternSet()
        report = ps.compile("p", "{x:int}")
        # save, split(2), class sign, class digit, split(2), save, match
        self.assertEqual(report["state_count"], 7)
        self.assertEqual(report["transition_count"], 8)

    def test_empty_pattern_matches_empty_text(self):
        ps = PatternSet()
        report = ps.compile("p", "")
        self.assertEqual(report["state_count"], 1)  # 只有 match
        self.assertEqual(ps.match(""), {"pattern_id": "p", "fields": {}})
        self.assertIsNone(ps.match("x"))


class TestExtractionSemantics(unittest.TestCase):
    """抽取语义：各类占位符、类型转换、整串匹配。"""

    def setUp(self):
        self.ps = PatternSet()

    def test_token_placeholder(self):
        self.ps.compile("p", "user={u} host={h}")
        self.assertEqual(
            self.ps.extract("user=alice host=web01", "p"), ["alice", "web01"]
        )
        # token 不能含空白、不能为空
        self.assertIsNone(self.ps.extract("user=al ice host=web01", "p"))
        self.assertIsNone(self.ps.extract("user= host=web01", "p"))

    def test_greedy_placeholder(self):
        self.ps.compile("p", "ERROR {msg:*} end")
        self.assertEqual(
            self.ps.extract("ERROR something went badly wrong end", "p"),
            ["something went badly wrong"],
        )
        # 贪婪可为空
        self.assertEqual(self.ps.extract("ERROR  end", "p"), [""])

    def test_greedy_extends_to_last_possible(self):
        self.ps.compile("p", "{a:*}={b}")
        self.assertEqual(self.ps.extract("x=y=z", "p"), ["x=y", "z"])

    def test_adjacent_placeholders_split_greedily(self):
        self.ps.compile("p", "{a}{b}")
        self.assertEqual(self.ps.extract("xyz", "p"), ["xy", "z"])

    def test_int_placeholder(self):
        self.ps.compile("p", "code={c:int}")
        self.assertEqual(self.ps.extract("code=42", "p"), [42])
        self.assertIsInstance(self.ps.extract("code=42", "p")[0], int)
        self.assertEqual(self.ps.extract("code=-7", "p"), [-7])
        self.assertEqual(self.ps.extract("code=+8", "p"), [8])

    def test_int_type_mismatch_rejects_match(self):
        """类型标注不匹配的策略：该模式整体不匹配，extract 返回 None。"""
        self.ps.compile("p", "code={c:int}")
        self.assertIsNone(self.ps.extract("code=abc", "p"))
        self.assertIsNone(self.ps.extract("code=12a", "p"))
        self.assertIsNone(self.ps.extract("code=-", "p"))
        self.assertIsNone(self.ps.extract("code=", "p"))

    def test_word_placeholder(self):
        self.ps.compile("p", "kw={w:word}")
        self.assertEqual(self.ps.extract("kw=hello_123", "p"), ["hello_123"])
        self.assertIsNone(self.ps.extract("kw=hello-world", "p"))
        self.assertIsNone(self.ps.extract("kw=", "p"))

    def test_match_fields_are_typed(self):
        self.ps.compile("p", "{name}={val:int}")
        hit = self.ps.match("answer=42")
        self.assertEqual(hit, {"pattern_id": "p", "fields": {"name": "answer", "val": 42}})

    def test_full_match_required(self):
        self.ps.compile("p", "abc")
        self.assertIsNone(self.ps.match("abcd"))
        self.assertIsNone(self.ps.match("xabc"))
        self.assertIsNone(self.ps.match("ab"))


class TestAmbiguityPriority(unittest.TestCase):
    """歧义优先级：match 取 pattern_id 升序第一个，match_all 升序。"""

    def test_match_returns_lowest_id(self):
        ps = PatternSet()
        ps.compile("b", "{x}")
        ps.compile("a", "{x}")
        ps.compile("c", "{x}")
        self.assertEqual(ps.match("hello")["pattern_id"], "a")

    def test_match_all_ascending(self):
        ps = PatternSet()
        ps.compile("c", "{x}")
        ps.compile("a", "{x}")
        ps.compile("e", "zzz")  # 不命中
        ps.compile("b", "{x}")
        hits = ps.match_all("hello")
        self.assertEqual([h["pattern_id"] for h in hits], ["a", "b", "c"])

    def test_match_all_empty_when_no_hit(self):
        ps = PatternSet()
        ps.compile("a", "xyz")
        self.assertEqual(ps.match_all("nope"), [])

    def test_specific_beats_generic_by_id_order(self):
        ps = PatternSet()
        ps.compile("01", "ERROR {code:int} {msg:*}")
        ps.compile("02", "{line:*}")
        hit = ps.match("ERROR 7 boom")
        self.assertEqual(hit["pattern_id"], "01")
        self.assertEqual(hit["fields"], {"code": 7, "msg": "boom"})
        # 通用模式兜底
        self.assertEqual(ps.match("anything else")["pattern_id"], "02")


class TestExplain(unittest.TestCase):
    """explain：失败位置与原因。"""

    def setUp(self):
        self.ps = PatternSet()
        self.ps.compile("p", "ERROR {code:int} {msg:*}")

    def test_success(self):
        info = self.ps.explain("ERROR 42 disk full", "p")
        self.assertTrue(info["matched"])
        self.assertIsNone(info["position"])
        self.assertIsNone(info["reason"])

    def test_literal_mismatch_position(self):
        info = self.ps.explain("ERR0R 42 x", "p")
        self.assertFalse(info["matched"])
        self.assertEqual(info["position"], 3)
        self.assertEqual(info["found"], "0")
        self.assertIn("position 3", info["reason"])

    def test_type_mismatch_position_and_reason(self):
        info = self.ps.explain("ERROR abc", "p")
        self.assertFalse(info["matched"])
        self.assertEqual(info["position"], 6)  # 'a' 处
        self.assertEqual(info["found"], "a")
        self.assertIn("digit", info["reason"])

    def test_text_too_short(self):
        info = self.ps.explain("ERR", "p")
        self.assertFalse(info["matched"])
        self.assertEqual(info["position"], 3)
        self.assertIsNone(info["found"])
        self.assertIn("end of text", info["reason"])

    def test_trailing_text(self):
        ps = PatternSet()
        ps.compile("p", "abc")
        info = ps.explain("abcd", "p")
        self.assertFalse(info["matched"])
        self.assertEqual(info["position"], 3)
        self.assertIn("unexpected", info["reason"])

    def test_unknown_pattern_id(self):
        with self.assertRaises(UnknownPatternError):
            self.ps.explain("x", "nope")


class TestStreamConsistency(unittest.TestCase):
    """流式一致性：任意分片 == 一次性。"""

    TEXT = (
        "ERROR 42 disk full\n"
        "INFO started pid=1234\n"
        "WARN user alice_9 logged in\n"
        "unmatched line here\n"
        "ERROR -7 overheating\n"
    )

    def setUp(self):
        self.ps = PatternSet()
        self.ps.compile("01", "ERROR {code:int} {msg:*}")
        self.ps.compile("02", "INFO started pid={pid:int}")
        self.ps.compile("03", "WARN user {user:word} logged in")

    def _expected(self):
        lines = self.TEXT.split("\n")[:-1]  # 末尾 \n 不产生空记录
        out = []
        for i, line in enumerate(lines, 1):
            hit = self.ps.match(line)
            rec = {"line_no": i, "pattern_id": None, "fields": {}}
            if hit:
                rec["pattern_id"] = hit["pattern_id"]
                rec["fields"] = hit["fields"]
            out.append(rec)
        return out

    def _run_stream(self, chunks):
        ex = StreamExtractor(self.ps)
        out = []
        for chunk in chunks:
            out.extend(ex.feed(chunk))
        out.extend(ex.finish())
        return out

    def test_single_shot(self):
        self.assertEqual(self._run_stream([self.TEXT]), self._expected())

    def test_every_chunk_size(self):
        expected = self._expected()
        for size in range(1, 17):
            chunks = [
                self.TEXT[i : i + size] for i in range(0, len(self.TEXT), size)
            ]
            self.assertEqual(
                self._run_stream(chunks), expected, msg="chunk size %d" % size
            )

    def test_char_by_char(self):
        self.assertEqual(self._run_stream(list(self.TEXT)), self._expected())

    def test_placeholder_split_across_chunks(self):
        # 占位符值正好被切在两块之间
        text = "ERROR 12345 boom\n"
        cut = text.index("123") + 2
        out = self._run_stream([text[:cut], text[cut:]])
        self.assertEqual(out[0]["fields"], {"code": 12345, "msg": "boom"})

    def test_unterminated_tail_flushed_by_finish(self):
        out = self._run_stream(["ERROR 9 crash", " boom"])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["fields"], {"code": 9, "msg": "crash boom"})

    def test_crlf_tolerated(self):
        out = self._run_stream(["ERROR 1 a\r\n", "ERROR 2 b\r\n"])
        self.assertEqual(out[0]["fields"], {"code": 1, "msg": "a"})
        self.assertEqual(out[1]["fields"], {"code": 2, "msg": "b"})

    def test_empty_stream(self):
        self.assertEqual(self._run_stream([]), [])
        self.assertEqual(self._run_stream([""]), [])

    def test_feed_after_finish_raises(self):
        ex = StreamExtractor(self.ps)
        ex.finish()
        with self.assertRaises(PatternError):
            ex.feed("x")

    def test_non_str_chunk_raises(self):
        ex = StreamExtractor(self.ps)
        with self.assertRaises(TypeError):
            ex.feed(b"bytes")


class TestMaxBuffer(unittest.TestCase):
    """max_buffer 超限策略：丢弃缓冲、产出 overflow 记录、继续工作。"""

    def test_overflow_record_and_recovery(self):
        ps = PatternSet()
        ps.compile("p", "OK {v:int}")
        ex = StreamExtractor(ps, max_buffer=8)
        out = ex.feed("x" * 20)  # 无换行，超限
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["error"], "buffer_overflow")
        self.assertIsNone(out[0]["pattern_id"])
        # 缓冲已丢弃，后续行正常处理
        out = ex.feed("OK 5\n")
        self.assertEqual(out[0]["pattern_id"], "p")
        self.assertEqual(out[0]["fields"], {"v": 5})
        self.assertEqual(out[0]["line_no"], 2)

    def test_no_overflow_when_terminated_in_time(self):
        ps = PatternSet()
        ps.compile("p", "{x}")
        ex = StreamExtractor(ps, max_buffer=8)
        self.assertEqual(ex.feed("12345678"), [])  # 恰好不超限
        out = ex.feed("\n")
        self.assertEqual(out[0]["pattern_id"], "p")

    def test_invalid_max_buffer(self):
        ps = PatternSet()
        with self.assertRaises(PatternError):
            StreamExtractor(ps, max_buffer=0)


class TestSnapshotRoundTrip(unittest.TestCase):
    """快照：save/load 往返一致，损坏文件报错清楚。"""

    def setUp(self):
        self.ps = PatternSet()
        self.ps.compile("01", "ERROR {code:int} {msg:*}")
        self.ps.compile("02", "user={u} host={h}")
        self.ps.compile("03", "a?c")
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.path = os.path.join(self.tmpdir.name, "snap.json")

    def test_round_trip(self):
        self.ps.save(self.path)
        loaded = PatternSet.load(self.path)
        self.assertEqual(loaded.pattern_ids, self.ps.pattern_ids)
        self.assertEqual(loaded.stats(), self.ps.stats())
        # 行为一致
        text = "ERROR 42 disk full"
        self.assertEqual(loaded.match(text), self.ps.match(text))
        self.assertEqual(loaded.extract(text, "01"), self.ps.extract(text, "01"))

    def test_stats_content(self):
        stats = self.ps.stats()
        self.assertEqual(stats["pattern_count"], 3)
        self.assertEqual(
            stats["total_states"],
            sum(p["state_count"] for p in stats["patterns"].values()),
        )

    def test_load_not_json(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("this is not json{")
        with self.assertRaises(SnapshotError) as ctx:
            PatternSet.load(self.path)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_load_wrong_format(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"format": "other", "version": 1}, fh)
        with self.assertRaises(SnapshotError) as ctx:
            PatternSet.load(self.path)
        self.assertIn("format", str(ctx.exception))

    def test_load_wrong_version(self):
        self.ps.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        data["version"] = 999
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(SnapshotError) as ctx:
            PatternSet.load(self.path)
        self.assertIn("version", str(ctx.exception))

    def test_load_missing_fields(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"format": "patternset-snapshot", "version": 1}, fh)
        with self.assertRaises(SnapshotError):
            PatternSet.load(self.path)

    def test_load_tampered_stats(self):
        self.ps.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        data["stats"]["total_states"] += 1
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(SnapshotError) as ctx:
            PatternSet.load(self.path)
        self.assertIn("stats", str(ctx.exception))

    def test_load_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            PatternSet.load(os.path.join(self.tmpdir.name, "nope.json"))


class TestErrorHandling(unittest.TestCase):
    """错误处理：冲突 id、未知 id、非法参数。"""

    def test_duplicate_compile_reports_conflict_id(self):
        ps = PatternSet()
        ps.compile("dup", "a")
        with self.assertRaises(PatternConflictError) as ctx:
            ps.compile("dup", "b")
        self.assertEqual(ctx.exception.pattern_id, "dup")
        self.assertIn("dup", str(ctx.exception))
        # 原模式未被覆盖
        self.assertIsNotNone(ps.match("a"))
        self.assertIsNone(ps.match("b"))

    def test_unknown_pattern_extract(self):
        ps = PatternSet()
        with self.assertRaises(UnknownPatternError) as ctx:
            ps.extract("x", "ghost")
        self.assertEqual(ctx.exception.pattern_id, "ghost")

    def test_invalid_pattern_id(self):
        ps = PatternSet()
        for bad in ("", None, 123):
            with self.assertRaises(PatternError, msg=repr(bad)):
                ps.compile(bad, "x")

    def test_long_text_no_blowup(self):
        """长文本上线性时间，无递归无回溯爆炸。"""
        ps = PatternSet()
        ps.compile("p", "start {a:*} mid {b:*} end")
        text = "start " + "x" * 200000 + " mid " + "y" * 200000 + " end"
        fields = ps.match(text)["fields"]
        self.assertEqual(fields["a"], "x" * 200000)
        self.assertEqual(fields["b"], "y" * 200000)


if __name__ == "__main__":
    unittest.main()
