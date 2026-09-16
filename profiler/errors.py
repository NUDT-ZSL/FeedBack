"""错误类型：帧结构错误与采样校验错误。"""

from __future__ import annotations


class ProfilerError(Exception):
    """剖析模块所有错误的基类。"""


class FrameError(ProfilerError):
    """帧结构非法：标识重复、父帧不存在、成环、帧不存在等。"""


class GapError(ProfilerError):
    """缺失区间非法：起止颠倒或线程不存在等。"""
