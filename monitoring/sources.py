"""可替换的事件源接口与离线实现。

真实部署时新增一个子类（如 ``KafkaEventSource``、``RabbitMQEventSource``）
实现 :meth:`EventSource.events` 即可接入消息队列，引擎其余部分无需改动。
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Callable, Iterable, TextIO

from .models import MetricEvent

# 错误回调：(行号或来源标识, 原始文本(可能为 None), 错误信息)
ErrorCallback = Callable[[str, str | None, str], None]


class EventSource:
    """事件源抽象基类。子类只需实现 :meth:`events`。"""

    def events(self) -> Iterator[MetricEvent]:
        """按到达顺序产出指标事件（允许乱序）。"""
        raise NotImplementedError

    # 复用的解析逻辑 ----------------------------------------------------- #
    @staticmethod
    def parse_line(raw: str) -> MetricEvent:
        """解析单行 JSON 为 :class:`MetricEvent`，非法输入抛 :class:`ValueError`。"""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"不是合法 JSON: {exc}") from exc
        return MetricEvent.from_dict(data)


class FileEventSource(EventSource):
    """从 JSON Lines 文件读取事件（每行一个 JSON 事件，允许乱序排列）。

    空行与 ``#`` 开头的注释行会被跳过；非法行会回调 ``on_error`` 后继续，
    不影响后续事件处理。
    """

    def __init__(
        self,
        path: str | Path,
        on_error: ErrorCallback | None = None,
        encoding: str = "utf-8",
    ) -> None:
        self.path = Path(path)
        self.on_error = on_error
        self.encoding = encoding

    def events(self) -> Iterator[MetricEvent]:
        if not self.path.exists():
            raise FileNotFoundError(f"事件文件不存在: {self.path}")
        with self.path.open("r", encoding=self.encoding) as handle:
            yield from _iter_stream(handle, str(self.path), self.on_error)


class StdinEventSource(EventSource):
    """从标准输入（或任意文本流）逐行读取事件，用于交互/管道输入。

    与 :class:`FileEventSource` 的区别仅在于来源是流而非文件，EOF 即结束；
    非法行打印提示后继续等待下一行。
    """

    def __init__(
        self,
        stream: TextIO | None = None,
        on_error: ErrorCallback | None = None,
        source_name: str = "<stdin>",
    ) -> None:
        self.stream = stream if stream is not None else sys.stdin
        self.on_error = on_error
        self.source_name = source_name

    def events(self) -> Iterator[MetricEvent]:
        yield from _iter_stream(self.stream, self.source_name, self.on_error)


class IterableEventSource(EventSource):
    """把内存中的事件/dict/JSON 字符串序列包装成事件源（测试与 MQ 适配用）。

    适配真实消息队列时也可参考它：poll 到一条消息就产出一个事件。
    """

    def __init__(
        self,
        items: Iterable[MetricEvent | dict[str, Any] | str],
        on_error: ErrorCallback | None = None,
    ) -> None:
        self.items = list(items)
        self.on_error = on_error

    def events(self) -> Iterator[MetricEvent]:
        for index, item in enumerate(self.items):
            try:
                if isinstance(item, MetricEvent):
                    yield item
                elif isinstance(item, dict):
                    yield MetricEvent.from_dict(item)
                elif isinstance(item, str):
                    yield self.parse_line(item)
                else:
                    raise ValueError(f"不支持的事件类型: {type(item).__name__}")
            except ValueError as exc:
                if self.on_error is not None:
                    self.on_error(f"item#{index}", str(item)[:200], str(exc))
                continue


def _iter_stream(
    handle: TextIO, source: str, on_error: ErrorCallback | None
) -> Iterator[MetricEvent]:
    for line_no, raw in enumerate(handle, start=1):
        text = raw.strip()
        if not text or text.startswith("#"):
            continue
        try:
            yield EventSource.parse_line(text)
        except ValueError as exc:
            if on_error is not None:
                on_error(f"{source}:{line_no}", text[:200], str(exc))
            continue
