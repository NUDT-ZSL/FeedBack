"""离线键盘焦点顺序引擎（无第三方依赖）。

快速上手::

    from focus_order import FocusEngine, FocusError

    engine = FocusEngine()
    engine.configure(
        elements=[
            {"id": "a", "container": "form"},
            {"id": "b", "container": "form"},
            {"id": "c", "container": "form", "disabled": True},
        ],
        relations=[("a", "right", "b"), ("b", "right", "c")],
    )
    engine.set_focus("a")
    print(engine.advance("right").target)   # b
    result = engine.advance("right")        # c 已禁用 -> 拒绝
    print(result.accepted, result.code)     # False target-disabled

见 README.md 与 tests/ 下的验收测试。
"""

from .engine import (
    DEFAULT_DIRECTIONS,
    Cycle,
    Element,
    ErrorCode,
    FocusEngine,
    FocusError,
    HistoryEntry,
    MoveResult,
    RejectCode,
    Rejection,
)

__all__ = [
    "DEFAULT_DIRECTIONS",
    "Cycle",
    "Element",
    "ErrorCode",
    "FocusEngine",
    "FocusError",
    "HistoryEntry",
    "MoveResult",
    "RejectCode",
    "Rejection",
]

__version__ = "1.0.0"
