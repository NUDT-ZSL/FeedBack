"""固件版本值对象。

版本号采用点分十进制整数（``MAJOR.MINOR.PATCH``，段数 2~3 段均可），
内部以整数元组保存，比较与排序稳定且与字符串无关。
"""

from __future__ import annotations

from typing import Any, Iterator, Tuple

from .errors import RegistrationError


class Version:
    """不可变固件版本，如 ``Version("2.0.0")``。"""

    __slots__ = ("_parts",)

    def __init__(self, value: "str | Version | Tuple[int, ...]") -> None:
        if isinstance(value, Version):
            parts: Tuple[int, ...] = value._parts
        elif isinstance(value, tuple):
            parts = value
        else:
            if not isinstance(value, str):
                raise RegistrationError(
                    f"版本号必须是字符串，实际为 {type(value).__name__}: {value!r}"
                )
            text = value.strip()
            if not text or text != text.strip():
                raise RegistrationError(f"版本号非法（空或带空白）: {value!r}")
            segments = text.split(".")
            if len(segments) not in (2, 3):
                raise RegistrationError(
                    f"版本号 {text!r} 必须是 2~3 段点分数字，如 '1.2.0'"
                )
            try:
                parts = tuple(int(seg) for seg in segments)
            except ValueError:
                raise RegistrationError(
                    f"版本号 {text!r} 的每一段都必须是非负整数"
                ) from None
        if len(parts) not in (2, 3) or any(
            not isinstance(p, int) or isinstance(p, bool) or p < 0 for p in parts
        ):
            raise RegistrationError(
                f"版本号各段必须是 2~3 个非负整数，实际为 {parts!r}"
            )
        # 统一按三段保存，保证 '1.2' 与 '1.2.0' 等价
        if len(parts) == 2:
            parts = (parts[0], parts[1], 0)
        self._parts: Tuple[int, ...] = parts

    @property
    def parts(self) -> Tuple[int, int, int]:
        return self._parts  # type: ignore[return-value]

    def __str__(self) -> str:
        return ".".join(str(p) for p in self._parts)

    def __repr__(self) -> str:
        return f"Version('{self}')"

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Version):
            return self._parts == other._parts
        if isinstance(other, str):
            try:
                return self._parts == Version(other)._parts
            except RegistrationError:
                return NotImplemented
        return NotImplemented

    def __lt__(self, other: "Version") -> bool:
        self._check(other)
        return self._parts < other._parts

    def __le__(self, other: "Version") -> bool:
        self._check(other)
        return self._parts <= other._parts

    def __gt__(self, other: "Version") -> bool:
        self._check(other)
        return self._parts > other._parts

    def __ge__(self, other: "Version") -> bool:
        self._check(other)
        return self._parts >= other._parts

    def __hash__(self) -> int:
        return hash(self._parts)

    def __iter__(self) -> Iterator[int]:
        return iter(self._parts)

    @staticmethod
    def _check(other: Any) -> None:
        if not isinstance(other, Version):
            raise TypeError(f"Version 只能与 Version 比较，实际为 {type(other).__name__}")

    def to_json(self) -> str:
        return str(self)
