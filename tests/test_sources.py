"""事件源测试：文件、标准输入/文本流、内存迭代，以及坏行容错。"""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path

from monitoring.models import MetricEvent
from monitoring.sources import (
    EventSource,
    FileEventSource,
    IterableEventSource,
    StdinEventSource,
)

HEADER = '{"metric_name": "cpu", "value": 1, "timestamp": "2026-09-09T10:00:00Z", "tags": {"service": "a"}}'


class ParseLineTests(unittest.TestCase):
    def test_valid(self) -> None:
        e = EventSource.parse_line(HEADER)
        self.assertIsInstance(e, MetricEvent)
        self.assertEqual(e.metric_name, "cpu")

    def test_invalid_json(self) -> None:
        with self.assertRaises(ValueError):
            EventSource.parse_line("not json")

    def test_invalid_event(self) -> None:
        with self.assertRaises(ValueError):
            EventSource.parse_line(json.dumps({"metric_name": "cpu", "value": 1}))


class StreamSourceTests(unittest.TestCase):
    def _collect(self, text, errors=None):
        stream = io.StringIO(text)
        if errors is None:
            errors = []
        src = StdinEventSource(stream, on_error=lambda loc, raw, msg: errors.append((loc, msg)))
        return list(src.events()), errors

    def test_comments_blank_lines(self) -> None:
        text = f"# comment\n\n{HEADER}\n  \n{HEADER}\n"
        events, _ = self._collect(text)
        self.assertEqual(len(events), 2)

    def test_bad_lines_skipped_and_reported(self) -> None:
        errors: list[tuple[str, str]] = []
        text = f"garbage\n{HEADER}\n{{bad\n"
        events, errors = self._collect(text, errors)
        self.assertEqual(len(events), 1)
        self.assertEqual(len(errors), 2)
        self.assertTrue(all("<stdin>:" in loc for loc, _ in errors))

    def test_iterable_source_mixed_types(self) -> None:
        errors: list[tuple[str, str]] = []
        items = [
            MetricEvent.from_dict(json.loads(HEADER)),
            json.loads(HEADER),
            HEADER,
            "bad",
            123,
        ]
        src = IterableEventSource(items, on_error=lambda loc, raw, msg: errors.append((loc, msg)))
        events = list(src.events())
        self.assertEqual(len(events), 3)
        self.assertEqual(len(errors), 2)


class FileSourceTests(unittest.TestCase):
    def test_reads_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            path.write_text(f"# header\n{HEADER}\n{HEADER}\n", encoding="utf-8")
            errors: list[tuple[str, str]] = []
            src = FileEventSource(path, on_error=lambda *a: errors.append(a))
            events = list(src.events())
            self.assertEqual(len(events), 2)
            self.assertEqual(errors, [])
            # 文件名出现在错误定位中。
            path2 = Path(tmp) / "bad.jsonl"
            path2.write_text("nope\n", encoding="utf-8")
            errs2: list[tuple] = []
            list(FileEventSource(path2, on_error=lambda *a: errs2.append(a)).events())
            self.assertEqual(len(errs2), 1)
            self.assertIn("bad.jsonl", errs2[0][0])

    def test_missing_file_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            list(FileEventSource("does-not-exist.jsonl").events())


if __name__ == "__main__":
    unittest.main()
