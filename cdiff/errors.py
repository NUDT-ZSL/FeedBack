"""引擎内部使用的异常类型。"""

from __future__ import annotations


class CdiffError(Exception):
    """所有 cdiff 错误的基类。"""


class InvalidConfigError(CdiffError):
    """分块配置非法（如最小块大于最大块、平均块大小为 0）。"""


class FingerprintMismatchError(CdiffError):
    """补丁记录的旧文件指纹与实际传入的旧内容指纹不一致。

    :param expected: 补丁记录的旧指纹（十六进制字符串）。
    :param actual: 实际算出的旧指纹（十六进制字符串）。
    """

    def __init__(self, expected: str, actual: str) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            "old fingerprint mismatch: patch expects %s but old data has %s"
            % (expected, actual)
        )


class CorruptPatchError(CdiffError):
    """补丁结构非法或被截断（指令非法、范围越界、字段缺失等）。"""
