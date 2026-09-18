"""离线属性验证工具：在大批量生成输入上检查声明的不变量。

纯标准库实现，不访问任何外部服务。所有随机性均由显式种子派生，
保证同一配置下结论完全可复现，且与生成顺序无关。
"""

from .errors import SpecError
from .registry import Registry
from .gencfg import GenConfig
from .runner import Runner
from .verdicts import Verdict, VerdictStore, ConflictRecord

__all__ = [
    "SpecError",
    "Registry",
    "GenConfig",
    "Runner",
    "Verdict",
    "VerdictStore",
    "ConflictRecord",
]

__version__ = "0.1.0"
