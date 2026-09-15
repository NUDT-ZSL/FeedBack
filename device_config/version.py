"""可比较的点分数字版本号。

版本号形如 ``1``、``1.2``、``1.2.10``：由一个或多个非负整数段以 ``.`` 连接。

规则：

* 每段只允许十进制数字，不能为空，不能带正负号、前导空格、字母；
* 段的数值按整数比较（``10 > 9``），段数不同时右侧补 0
  （故 ``1.2 == 1.2.0``）；
* 出错时抛出 :class:`~device_config.errors.VersionError`，
  同时给出首错字符位置与段序号，便于上层定位。
"""

from __future__ import annotations

from .errors import VersionError

_DIGITS = frozenset("0123456789")


class Version:
    """解析后的不可变版本号。"""

    __slots__ = ("_parts", "_text")

    def __init__(self, parts, text=None):
        self._parts = tuple(int(p) for p in parts)
        self._text = text if text is not None else ".".join(str(p) for p in self._parts)

    @property
    def parts(self):
        """版本各段组成的元组，如 ``(1, 2, 10)``。"""
        return self._parts

    def _key(self):
        # 比较时以最长版本为准补 0
        return self._parts

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        a, b = self._parts, other._parts
        n = max(len(a), len(b))
        return a + (0,) * (n - len(a)) < b + (0,) * (n - len(b))

    def __le__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self == other or self < other

    def __gt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return other < self

    def __ge__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self == other or other < self

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        a, b = self._parts, other._parts
        n = max(len(a), len(b))
        return a + (0,) * (n - len(a)) == b + (0,) * (n - len(b))

    def __hash__(self):
        # 去掉右侧的 0，保证相等版本哈希一致：1.2 与 1.2.0
        parts = list(self._parts)
        while len(parts) > 1 and parts[-1] == 0:
            parts.pop()
        return hash(tuple(parts))

    def __repr__(self):
        return f"Version({self._text!r})"

    def __str__(self):
        return self._text


def parse_version(text) -> Version:
    """把版本字符串解析为 :class:`Version`。

    传入已经解析好的 :class:`Version` 时原样返回，因此该函数是幂等的，
    内核内部可以无条件调用它规范化版本入参。

    :raises VersionError: 版本号非法，错误中包含首错位置（0 起）与段序号。
    """
    if isinstance(text, Version):
        return text
    if not isinstance(text, str):
        raise VersionError(repr(text), "版本号必须是字符串", position=None)
    if text == "":
        raise VersionError(text, "版本号不能为空字符串", position=0)

    segments = []
    pos = 0
    for seg_index, raw_seg in enumerate(text.split(".")):
        if raw_seg == "":
            # 空段：起始/结尾多余的点或连续的点，位置落在点处
            dot_pos = pos if pos < len(text) else pos - 1
            raise VersionError(
                text, f"第 {seg_index} 段为空", position=max(dot_pos, 0), segment=seg_index
            )
        for off, ch in enumerate(raw_seg):
            if ch not in _DIGITS:
                raise VersionError(
                    text,
                    f"第 {seg_index} 段含非数字字符 {ch!r}，每段只能是十进制数字",
                    position=pos + off,
                    segment=seg_index,
                )
        segments.append(int(raw_seg))
        pos += len(raw_seg) + 1  # 跳过段内容与分隔点

    return Version(segments, text=text)


def canonical_version(version) -> str:
    """返回版本的规范字符串：右侧补 0 的段去掉，至少保留一段。

    例如 ``2.0.0`` 与 ``2.0`` 都规范化为 ``"2"``，``1.10.0`` 为 ``"1.10"``。
    用于迁移路径等需要跨写法保持确定性的输出。
    """
    v = parse_version(version)
    parts = list(v.parts)
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return ".".join(str(p) for p in parts)
