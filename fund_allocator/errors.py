"""错误类型。

所有业务错误都继承 AllocationError，并尽量携带“位置”信息
（如 projects[id].phases[2]），便于定位非法配置。
"""

from typing import List, Optional, Sequence


class AllocationError(Exception):
    """引擎所有业务异常的基类。"""


class ValidationError(AllocationError):
    """数据非法：字段缺失、金额非法、阶段之和不守恒等。

    :param message: 人类可读的错误说明
    :param location: 出错位置（点路径形式），如 "projects[P2].phases"
    :param field: 可选的字段名
    """

    def __init__(
        self,
        message: str,
        location: Optional[str] = None,
        field: Optional[str] = None,
    ) -> None:
        self.message = message
        self.location = location
        self.field = field
        prefix = f"{location}: " if location else ""
        super().__init__(f"{prefix}{message}")


class DependencyError(AllocationError):
    """依赖非法：引用不存在的项目或依赖成环。

    :param message: 错误说明
    :param chain: 涉及的项目链条，如 ["A", "B", "C", "A"]（首尾相同表示环）
    """

    def __init__(self, message: str, chain: Optional[Sequence[str]] = None) -> None:
        self.message = message
        self.chain: List[str] = list(chain) if chain else []
        shown = " -> ".join(self.chain) if self.chain else ""
        super().__init__(f"{message} 涉及链条: {shown}" if shown else message)


class PlanError(AllocationError):
    """方案约束不满足（如已批金额合计超过资金上限）。"""


class PersistenceError(AllocationError):
    """文件保存/载入失败：JSON 损坏、字段缺失、校验失败等。

    载入校验失败时引擎保证调用方原有状态不变（见 persistence.load_to）。
    """
