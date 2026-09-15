"""长线叙事游戏的世界状态与存档管理模块。

离线可验收：
    python -m unittest discover -s tests -v   # 全部单元测试
    python demo.py                            # 七项需求的端到端验收演示
"""
from .conditions import And, Compare, Condition, ConditionError, Const, Not, Or
from .engine import Engine, EntryError, SAVE_FORMAT_VERSION
from .merge import Conflict, compute_confluence, merge_logs
from .migration import migrate_save, register
from .model import (ChangeError, Edge, Graph, Node, Schema, SchemaError,
                    StateChange, ValidationError, VariableDef)

__all__ = [
    "And", "Compare", "Condition", "ConditionError", "Const", "Not", "Or",
    "Engine", "EntryError", "SAVE_FORMAT_VERSION",
    "Conflict", "compute_confluence", "merge_logs",
    "migrate_save", "register",
    "ChangeError", "Edge", "Graph", "Node", "Schema", "SchemaError",
    "StateChange", "ValidationError", "VariableDef",
]
