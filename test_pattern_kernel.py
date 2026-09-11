"""pattern_kernel 的单元测试。

覆盖：模式解析、NFA 构造报告、抽取语义、流式一致性（随机分片）、
歧义优先级、类型标注策略、内存上限、快照往返、错误处理与 CLI。
"""

from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import tempfile
import unittest

from pattern_kernel import (
    BufferLimitExceeded,
    Literal,
    PatternConflictError,
    PatternSet,
    PatternSyntaxError,
    Placeholder,
    SnapshotError,
    StreamExtractor,
    StreamStateError,
    UnknownPatternError,
    Wildcard,
    parse_pattern,
)

HERE = os.path.dirname(os.path.abspath(__file__))


def make_ps():
    ps = PatternSet()
    ps.compile("log", "{ts} {level} {msg:*}")
    ps.compile("kv", "user={user} id={uid:int}")
    return ps


class TestParse(unittest.TestCase):
    """模式解析。"""

    def test_literal_and_placeholder(self):
        frags = parse_pattern("INFO {msg}")
        self.assertEqual(frags[0], Literal("INFO "))
        self.assertEqual(frags[1], Placeholder("msg", "normal"))

    def test_wildcard(self):
        frags = parse_pattern("a?c")
        self.assertEqual(frags[1], Wildcard())

    def test_typed_placeholders(self):
        frags = parse_pattern("{a:*}{b:int}{c:word}")
        self.assertEqual([f.kind for f in frags], ["greedy", "int", "word"])

    def test_escapes(self):
        frags = parse_pattern(r"\{x\}\?\\")
        self.assertEqual(frags, [Literal("{x}?\\")])

    def test_empty_pattern_rejected(self):
        with self.assertRaises(PatternSyntaxError):
            parse_pattern("")

    def test_empty_name_rejected(self):
        for bad in ("{}", "{:int}"):
            with self.assertRaises(PatternSyntaxError, msg=bad):
                parse_pattern(bad)

    def test_bad_name_rejected(self):
        with self.assertRaises(PatternSyntaxError):
            parse_pattern("{1abc}")

    def test_duplicate_name_rejected(self):
        with self.assertRaises(PatternSyntaxError):
            parse_pattern("{a} {a}")

    def test_unknown_type_rejected(self):
        with self.assertRaises(PatternSyntaxError):
            parse_pattern("{a:float}")

    def test_empty_type_rejected(self):
        with self.assertRaises(PatternSyntaxError):
            parse_pattern("{a:}")

    def test_unterminated_rejected(self):
        with self.assertRaises(PatternSyntaxError):
            parse_pattern("abc {a")

    def test_stray_close_brace_rejected(self):
        with self.assertRaises(PatternSyntaxError):
            parse_pattern("a}b")

    def test_dangling_backslash_rejected(self):
        with self.assertRaises(PatternSyntaxError):
            parse_pattern("abc\\")


class TestCompileReport(unittest.TestCase):
    """NFA 构造与编译报告。"""

    def test_report_fields(self):
        ps = PatternSet()
        rep = ps.compile("p", "INFO {msg:*}")
        self.assertGreater(rep["states"], 0)
        self.assertGreater(rep["transitions"], 0)
        self.assertEqual(rep["placeholders"], [{"name": "msg", "type": "greedy"}])
        self.assertIn("possibly_ambiguous", rep)

    def test_ambiguity_detected_for_adjacent_placeholders(self):
        ps = PatternSet()
        rep = ps.compile("p", "{a}{b}")
        self.assertTrue(rep["possibly_ambiguous"])
        self.assertTrue(rep["ambiguity_reasons"])

    def test_ambiguity_detected_for_greedy_before_literal(self):
        ps = PatternSet()
        rep = ps.compile("p", "{a:*} END")
        self.assertTrue(rep["possibly_ambiguous"])

    def test_no_ambiguity_with_whitespace_delimiter(self):
        ps = PatternSet()
        rep = ps.compile("p", "{a} {b}")
        self.assertFalse(rep["possibly_ambiguous"])

    def test_duplicate_pattern_id_conflict(self):
        ps = PatternSet()
        ps.compile("p", "x")
        with self.assertRaises(PatternConflictError) as ctx:
            ps.compile("p", "y")
        self.assertEqual(ctx.exception.conflict_id, "p")

    def test_empty_pattern_id_rejected(self):
        ps = PatternSet()
        with self.assertRaises(PatternSyntaxError):
            ps.compile("", "x")


class TestExtract(unittest.TestCase):
    """一次性抽取语义。"""

    def test_basic_extract(self):
        ps = make_ps()
        fields = ps.extract("2026-09-11 INFO hello world", "log")
        self.assertEqual(
            fields, {"ts": "2026-09-11", "level": "INFO", "msg": "hello world"}
        )
        self.assertEqual(list(fields), ["ts", "level", "msg"])  # 出现顺序

    def test_extract_requires_full_match(self):
        ps = make_ps()
        # extract 是整串匹配：前后有多余内容都不命中
        self.assertIsNone(ps.extract("x user=b id=1", "kv"))
        self.assertIsNone(ps.extract("user=b id=1 trailing", "kv"))

    def test_int_type_ok(self):
        ps = make_ps()
        self.assertEqual(
            ps.extract("user=bob id=42", "kv"), {"user": "bob", "uid": "42"}
        )

    def test_int_type_negative(self):
        ps = make_ps()
        self.assertEqual(ps.extract("user=bob id=-7", "kv")["uid"], "-7")

    def test_int_type_mismatch_fails(self):
        ps = make_ps()
        # 类型标注是硬约束：id 不是整数则整体不匹配
        self.assertIsNone(ps.extract("user=bob id=4x", "kv"))
        self.assertIsNone(ps.extract("user=bob id=x4", "kv"))

    def test_word_type(self):
        ps = PatternSet()
        ps.compile("w", "key={v:word};")
        self.assertEqual(ps.extract("key=abc_09;", "w"), {"v": "abc_09"})
        self.assertIsNone(ps.extract("key=a-b;", "w"))

    def test_wildcard(self):
        ps = PatternSet()
        ps.compile("p", "a?c")
        self.assertEqual(ps.extract("abc", "p"), {})
        self.assertIsNone(ps.extract("ac", "p"))
        self.assertIsNone(ps.extract("abbc", "p"))

    def test_greedy_at_end(self):
        ps = PatternSet()
        ps.compile("p", "rest={r:*}")
        self.assertEqual(ps.extract("rest=a b c", "p"), {"r": "a b c"})

    def test_only_placeholder_empty_text(self):
        ps = PatternSet()
        ps.compile("p", "{a:*}")
        self.assertEqual(ps.extract("", "p"), {"a": ""})

    def test_normal_placeholder_nonempty(self):
        ps = PatternSet()
        ps.compile("p", "{a}")
        self.assertIsNone(ps.extract("", "p"))

    def test_empty_text_literal_pattern(self):
        ps = PatternSet()
        ps.compile("p", "x")
        self.assertIsNone(ps.extract("", "p"))

    def test_unknown_pattern_id(self):
        ps = PatternSet()
        with self.assertRaises(UnknownPatternError):
            ps.extract("x", "nope")

    def test_field_values_are_strings(self):
        ps = make_ps()
        fields = ps.extract("user=bob id=42", "kv")
        self.assertIsInstance(fields["uid"], str)

    def test_deterministic_repeated_runs(self):
        ps = make_ps()
        a = ps.extract("2026-09-11 INFO hello", "log")
        b = ps.extract("2026-09-11 INFO hello", "log")
        self.assertEqual(a, b)


class TestAmbiguityPriority(unittest.TestCase):
    """歧义切分优先级：总跨度最长优先，并列时靠前占位符取最长。"""

    def test_adjacent_placeholders_earlier_takes_more(self):
        ps = PatternSet()
        ps.compile("p", "{a}{b}")
        # "abc" 的所有切分总长度相同 -> 靠前的 a 尽量长
        self.assertEqual(ps.extract("abc", "p"), {"a": "ab", "b": "c"})

    def test_greedy_takes_longest(self):
        ps = PatternSet()
        ps.compile("p", "{a:*} END")
        # 贪婪 a 尽量长 -> 吃掉第一个 END
        self.assertEqual(ps.extract("a END b END", "p"), {"a": "a END b"})

    def test_greedy_before_placeholder(self):
        ps = PatternSet()
        ps.compile("p", "{a:*}|{b}")
        self.assertEqual(ps.extract("x|y|z", "p"), {"a": "x|y", "b": "z"})

    def test_priority_deterministic_across_runs(self):
        ps = PatternSet()
        ps.compile("p", "{a}{b}{c}")
        results = {json.dumps(ps.extract("abcdef", "p"), sort_keys=True) for _ in range(10)}
        self.assertEqual(len(results), 1)


class TestMatch(unittest.TestCase):
    """match / match_all 搜索语义。"""

    def test_match_returns_lowest_pattern_id(self):
        ps = PatternSet()
        ps.compile("b", "INFO {m:*}")
        ps.compile("a", "INFO {m:*}")
        hit = ps.match("INFO hello")
        self.assertEqual(hit["pattern_id"], "a")

    def test_match_searches_anywhere(self):
        ps = PatternSet()
        ps.compile("p", "INFO {m}")
        hit = ps.match("xx INFO hello yy")
        self.assertEqual(hit["start"], 3)
        self.assertEqual(hit["fields"], {"m": "hello"})

    def test_match_none(self):
        ps = make_ps()
        self.assertIsNone(ps.match("nothing here"))

    def test_match_all_sorted_by_pattern_id(self):
        ps = PatternSet()
        ps.compile("b", "hello")
        ps.compile("a", "{w:*}")
        ps.compile("c", "zzz")
        hits = ps.match_all("say hello")
        self.assertEqual([h["pattern_id"] for h in hits], ["a", "b"])

    def test_match_all_empty(self):
        ps = make_ps()
        self.assertEqual(ps.match_all("???"), [])


class TestExplain(unittest.TestCase):
    """失败定位。"""

    def test_literal_mismatch_position(self):
        ps = make_ps()
        ex = ps.explain("WARN something", "log")
        self.assertFalse(ex["matched"])
        # {ts} 吃掉 WARN 后期望空格... 实际 ts=WARN, 然后 level=something, 然后缺 msg
        self.assertIn("position", ex)
        self.assertIn("reason", ex)

    def test_literal_mismatch_at_zero(self):
        ps = PatternSet()
        ps.compile("p", "INFO {m}")
        ex = ps.explain("WARN x", "p")
        self.assertEqual(ex["position"], 0)
        self.assertEqual(ex["found"], "W")
        self.assertIn("'I'", ex["expected"])

    def test_type_mismatch_explained(self):
        ps = make_ps()
        ex = ps.explain("user=bob id=xy", "kv")
        self.assertFalse(ex["matched"])
        self.assertEqual(ex["position"], len("user=bob id="))
        self.assertTrue(any("digit" in e for e in ex["expected"]))

    def test_trailing_text(self):
        ps = PatternSet()
        ps.compile("p", "ab")
        ex = ps.explain("abc", "p")
        self.assertFalse(ex["matched"])
        self.assertEqual(ex["position"], 2)
        self.assertIn("trailing", ex["reason"])

    def test_incomplete_text(self):
        ps = PatternSet()
        ps.compile("p", "abcdef")
        ex = ps.explain("abc", "p")
        self.assertFalse(ex["matched"])
        self.assertEqual(ex["position"], 3)
        self.assertIsNone(ex["found"])

    def test_matched(self):
        ps = make_ps()
        ex = ps.explain("user=bob id=1", "kv")
        self.assertTrue(ex["matched"])
        self.assertEqual(ex["fields"]["uid"], "1")


class TestStreaming(unittest.TestCase):
    """流式抽取与一次性抽取的一致性。"""

    def _run_stream(self, ps, pid, text, chunks):
        se = StreamExtractor(ps, pid)
        committed = {}
        pos = 0
        for size in chunks:
            r = se.feed(text[pos:pos + size])
            pos += size
            if r["status"] == "failed":
                break
            committed.update(r["committed"])
        fin = se.finish()
        return committed, fin

    def test_cross_chunk_placeholder(self):
        ps = make_ps()
        text = "2026-09-11 INFO hello world"
        committed, fin = self._run_stream(ps, "log", text, [5, 5, 5, 5, 7])
        self.assertEqual(fin["status"], "ok")
        self.assertEqual(fin["all_fields"], ps.extract(text, "log"))
        merged = dict(committed)
        merged.update(fin["fields"])
        self.assertEqual(merged, fin["all_fields"])

    def test_empty_chunks_are_noop(self):
        ps = make_ps()
        se = StreamExtractor(ps, "kv")
        r = se.feed("")
        self.assertEqual(r["status"], "pending")
        se.feed("user=bob ")
        se.feed("")
        se.feed("id=3")
        fin = se.finish()
        self.assertEqual(fin["all_fields"], {"user": "bob", "uid": "3"})

    def test_incremental_commit(self):
        ps = make_ps()
        se = StreamExtractor(ps, "log")
        r = se.feed("2026-09-11 INFO he")
        self.assertEqual(
            r["committed"], {"ts": "2026-09-11", "level": "INFO"}
        )
        fin = se.finish()
        self.assertEqual(fin["fields"], {"msg": "he"})
        self.assertEqual(
            fin["all_fields"], {"ts": "2026-09-11", "level": "INFO", "msg": "he"}
        )

    def test_early_failure_detected(self):
        ps = PatternSet()
        ps.compile("p", "INFO {m}")
        se = StreamExtractor(ps, "p")
        r = se.feed("WXYZ")
        self.assertEqual(r["status"], "failed")
        fin = se.finish()
        self.assertEqual(fin["status"], "no_match")

    def test_feed_after_finish_raises(self):
        ps = make_ps()
        se = StreamExtractor(ps, "kv")
        se.feed("user=a id=1")
        se.finish()
        with self.assertRaises(StreamStateError):
            se.feed("more")

    def test_finish_twice_raises(self):
        ps = make_ps()
        se = StreamExtractor(ps, "kv")
        se.finish()
        with self.assertRaises(StreamStateError):
            se.finish()

    def test_random_chunking_consistency(self):
        """随机分片流式结果必须与一次性 extract 完全一致。"""
        rng = random.Random(20260911)
        patterns = {
            "log": "{ts} {level} {msg:*}",
            "kv": "user={user} id={uid:int}",
            "adj": "{a}{b}",
            "greedy": "<{body:*}>",
            "wild": "x?y {z}",
            "only": "{everything:*}",
        }
        texts = [
            "2026-09-11 INFO hello world",
            "2026-09-11 ERROR ",
            "user=alice id=123",
            "user=bob id=-45",
            "user=carol id=12x",
            "abcdef",
            "ab",
            "<some body text>",
            "<>",
            "xay hello",
            "xy hello",
            "anything at all",
            "",
            "no match here at all!!!",
        ]
        ps = PatternSet()
        for pid, ptext in patterns.items():
            ps.compile(pid, ptext)
        for text in texts:
            for pid in patterns:
                oneshot = ps.extract(text, pid)
                for _ in range(4):
                    # 随机分片（允许空块）
                    cuts = sorted(rng.randint(0, len(text)) for _ in range(5))
                    chunks = [b - a for a, b in zip([0] + cuts, cuts + [len(text)])]
                    committed, fin = self._run_stream(ps, pid, text, chunks)
                    if oneshot is None:
                        self.assertEqual(
                            fin["status"], "no_match",
                            f"{pid=} {text=!r} {chunks=}",
                        )
                    else:
                        self.assertEqual(fin["status"], "ok", f"{pid=} {text=!r} {chunks=}")
                        self.assertEqual(fin["all_fields"], oneshot, f"{pid=} {text=!r} {chunks=}")
                        merged = dict(committed)
                        merged.update(fin["fields"])
                        self.assertEqual(merged, oneshot, f"{pid=} {text=!r} {chunks=}")


class TestMaxBuffer(unittest.TestCase):
    """内存上限策略。"""

    def test_buffer_limit_exceeded(self):
        ps = PatternSet()
        ps.compile("p", "{a:*} END")
        se = StreamExtractor(ps, "p", max_buffer=8)
        with self.assertRaises(BufferLimitExceeded) as ctx:
            se.feed("x" * 20)  # 终止片段 END 一直不出现 -> 缓冲无界增长
        self.assertIn("unbounded", str(ctx.exception))

    def test_exact_mode_unbounded(self):
        ps = PatternSet()
        ps.compile("p", "{a:*} END")
        se = StreamExtractor(ps, "p", max_buffer=None)  # 精确模式：无上限
        se.feed("x" * 100)
        se.feed(" END")
        fin = se.finish()
        self.assertEqual(fin["status"], "ok")
        self.assertEqual(fin["all_fields"], {"a": "x" * 100})

    def test_limit_not_hit_when_delimiter_arrives(self):
        ps = PatternSet()
        ps.compile("p", "{a:*} END")
        se = StreamExtractor(ps, "p", max_buffer=64)
        se.feed("hi END")
        self.assertEqual(se.finish()["all_fields"], {"a": "hi"})

    def test_buffer_released_after_commit(self):
        ps = make_ps()
        se = StreamExtractor(ps, "log", max_buffer=64)
        se.feed("2026-09-11 INFO x")
        # ts/level 已提交，缓冲只保留待定部分
        self.assertLessEqual(se.buffered, 16)

    def test_negative_max_buffer_rejected(self):
        ps = make_ps()
        with self.assertRaises(ValueError):
            StreamExtractor(ps, "log", max_buffer=-1)


class TestStats(unittest.TestCase):
    """统计。"""

    def test_counters(self):
        ps = make_ps()
        ps.extract("user=b id=1", "kv")       # hit
        ps.extract("user=b id=x", "kv")       # miss
        ps.match("user=b id=1")               # hit
        ps.match_all("nothing")               # miss
        s = ps.stats()
        self.assertEqual(s["patterns_compiled"], 2)
        self.assertEqual(s["texts_processed"], 4)
        self.assertEqual(s["hits"], 2)
        self.assertEqual(s["misses"], 2)
        self.assertGreaterEqual(s["avg_match_seconds"], 0.0)

    def test_stream_buffer_bytes(self):
        ps = make_ps()
        se = StreamExtractor(ps, "log")
        se.feed("2026-09-11 INFO hello")
        self.assertGreater(ps.stats()["stream_pending_buffer_bytes"], 0)
        se.finish()
        self.assertEqual(ps.stats()["stream_pending_buffer_bytes"], 0)


class TestPersistence(unittest.TestCase):
    """快照保存/加载。"""

    def test_roundtrip(self):
        ps = make_ps()
        ps.extract("user=b id=1", "kv")
        ps.match("nope")
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "snap.json")
            ps.save(path)
            ps2 = PatternSet()
            ps2.load(path)
        # 统计一致
        s1, s2 = ps.stats(), ps2.stats()
        for key in ("patterns_compiled", "texts_processed", "hits", "misses"):
            self.assertEqual(s1[key], s2[key])
        # 加载后继续匹配结果一致
        text = "2026-09-11 INFO hello"
        self.assertEqual(ps.extract(text, "log"), ps2.extract(text, "log"))
        self.assertEqual(ps.match_all(text), ps2.match_all(text))
        self.assertEqual(ps.dump()["patterns"], ps2.dump()["patterns"])

    def test_load_missing_file(self):
        ps = PatternSet()
        with self.assertRaises(SnapshotError):
            ps.load("no-such-file.json")

    def _write(self, obj):
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            if isinstance(obj, str):
                fh.write(obj)
            else:
                json.dump(obj, fh)
        self.addCleanup(os.unlink, path)
        return path

    def test_corrupted_json(self):
        ps = PatternSet()
        with self.assertRaises(SnapshotError):
            ps.load(self._write("{not json"))

    def test_wrong_format(self):
        ps = PatternSet()
        with self.assertRaises(SnapshotError):
            ps.load(self._write({"format": "other", "version": 1,
                                 "patterns": [], "stats": {}}))

    def test_duplicate_ids_rejected(self):
        ps = PatternSet()
        path = self._write({
            "format": "pattern-kernel-snapshot", "version": 1,
            "patterns": [
                {"pattern_id": "a", "pattern_text": "x"},
                {"pattern_id": "a", "pattern_text": "y"},
            ],
            "stats": {"texts_processed": 0, "hits": 0, "misses": 0,
                      "total_match_seconds": 0.0},
        })
        with self.assertRaises(SnapshotError):
            ps.load(path)

    def test_empty_pattern_text_rejected(self):
        ps = PatternSet()
        path = self._write({
            "format": "pattern-kernel-snapshot", "version": 1,
            "patterns": [{"pattern_id": "a", "pattern_text": ""}],
            "stats": {"texts_processed": 0, "hits": 0, "misses": 0,
                      "total_match_seconds": 0.0},
        })
        with self.assertRaises(SnapshotError):
            ps.load(path)

    def test_negative_stats_rejected(self):
        ps = PatternSet()
        path = self._write({
            "format": "pattern-kernel-snapshot", "version": 1,
            "patterns": [],
            "stats": {"texts_processed": -1, "hits": 0, "misses": 0,
                      "total_match_seconds": 0.0},
        })
        with self.assertRaises(SnapshotError):
            ps.load(path)

    def test_missing_stats_field_rejected(self):
        ps = PatternSet()
        path = self._write({
            "format": "pattern-kernel-snapshot", "version": 1,
            "patterns": [],
            "stats": {"hits": 0},
        })
        with self.assertRaises(SnapshotError):
            ps.load(path)

    def test_failed_load_preserves_state(self):
        ps = make_ps()
        before = ps.dump()
        with self.assertRaises(SnapshotError):
            ps.load(self._write("{broken"))
        self.assertEqual(ps.dump(), before)


class TestCLI(unittest.TestCase):
    """命令行入口。"""

    def run_cli(self, commands):
        proc = subprocess.run(
            [sys.executable, os.path.join(HERE, "main.py")],
            input="\n".join(json.dumps(c) for c in commands),
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return [json.loads(line) for line in proc.stdout.strip().splitlines()]

    def test_basic_flow(self):
        outs = self.run_cli([
            {"cmd": "compile", "pattern_id": "p1", "pattern_text": "INFO {msg:*}"},
            {"cmd": "extract", "pattern_id": "p1", "text": "INFO hello world"},
            {"cmd": "explain", "pattern_id": "p1", "text": "WARN x"},
            {"cmd": "stats"},
        ])
        self.assertTrue(outs[0]["ok"])
        self.assertGreater(outs[0]["report"]["states"], 0)
        self.assertEqual(outs[1]["fields"], {"msg": "hello world"})
        self.assertFalse(outs[2]["explanation"]["matched"])
        self.assertEqual(outs[3]["stats"]["texts_processed"], 1)  # explain 不计入

    def test_stream_flow(self):
        outs = self.run_cli([
            {"cmd": "compile", "pattern_id": "p1", "pattern_text": "{a} {b:*}"},
            {"cmd": "stream_feed", "pattern_id": "p1", "chunk": "hello "},
            {"cmd": "stream_feed", "chunk": "wor"},
            {"cmd": "stream_feed", "chunk": "ld"},
            {"cmd": "stream_finish"},
        ])
        self.assertEqual(outs[1]["stream"]["status"], "pending")
        fin = outs[4]["stream"]
        self.assertEqual(fin["status"], "ok")
        self.assertEqual(fin["all_fields"], {"a": "hello", "b": "world"})

    def test_error_json(self):
        outs = self.run_cli([
            {"cmd": "compile", "pattern_id": "p", "pattern_text": "{a} {a}"},
            {"cmd": "compile", "pattern_id": "q", "pattern_text": "x"},
            {"cmd": "compile", "pattern_id": "q", "pattern_text": "y"},
            {"cmd": "bogus"},
            {"cmd": "extract", "pattern_id": "nope", "text": "x"},
        ])
        self.assertFalse(outs[0]["ok"])
        self.assertIn("error", outs[0])
        self.assertFalse(outs[2]["ok"])
        self.assertEqual(outs[2]["conflict_id"], "q")
        self.assertFalse(outs[3]["ok"])
        self.assertEqual(outs[4]["error_type"], "UnknownPatternError")

    def test_save_load_via_cli(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "s.json")
            outs = self.run_cli([
                {"cmd": "compile", "pattern_id": "p", "pattern_text": "v={v:int}"},
                {"cmd": "extract", "pattern_id": "p", "text": "v=9"},
                {"cmd": "save", "path": path},
                {"cmd": "load", "path": path},
                {"cmd": "extract", "pattern_id": "p", "text": "v=10"},
                {"cmd": "stats"},
            ])
            self.assertTrue(all(o["ok"] for o in outs))
            self.assertEqual(outs[4]["fields"], {"v": "10"})
            self.assertEqual(outs[5]["stats"]["texts_processed"], 2)


if __name__ == "__main__":
    unittest.main()
