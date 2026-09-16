"""编排模块的异常体系。

所有异常都尽量携带结构化的定位信息（哪个素材 / 哪个目标 / 哪个槽位 /
哪个来源 / 哪条依赖），以便上层工具直接展示给编剧，而不必解析错误文本。
"""


class ComposerError(Exception):
    """所有编排相关错误的基类。"""


class ValidationError(ComposerError):
    """非法配置（素材或叙事目标的定义本身不合法）。"""

    def __init__(self, message, *, where=None, unit_id=None, goal_id=None,
                 slot_id=None, source=None, dependency=None):
        super().__init__(message)
        self.message = message
        # where 是人类可读的位置说明，例如 "material 'A' 的前置依赖[1]"
        self.where = where
        self.unit_id = unit_id
        self.goal_id = goal_id
        self.slot_id = slot_id
        self.source = source
        self.dependency = dependency

    def __str__(self):
        if self.where:
            return f"{self.message}（位置：{self.where}）"
        return self.message


class DuplicateIdError(ValidationError):
    """唯一标识重复。"""


class DanglingReferenceError(ValidationError):
    """引用了不存在的素材单元。"""


class CyclicDependencyError(ValidationError):
    """素材之间的前置依赖构成了环。"""

    def __init__(self, message, *, cycle, where=None, unit_id=None):
        super().__init__(message, where=where, unit_id=unit_id)
        # cycle 形如 ["A", "B", "C", "A"]
        self.cycle = cycle

    def __str__(self):
        path = " -> ".join(self.cycle)
        if self.where:
            return f"{self.message}：环为 {path}（位置：{self.where}）"
        return f"{self.message}：环为 {path}"


class SlotFillError(ComposerError):
    """向槽位填入素材时校验失败（类型不匹配 / 前置依赖未满足等）。"""

    def __init__(self, message, *, goal_id, slot_id, source=None,
                 unit_id=None, missing_dependency=None):
        super().__init__(message)
        self.message = message
        self.goal_id = goal_id
        self.slot_id = slot_id
        self.source = source
        self.unit_id = unit_id
        # 未被满足的前置依赖（素材单元 id）；类型不匹配时为 None
        self.missing_dependency = missing_dependency

    def __str__(self):
        loc = f"目标 '{self.goal_id}' 槽位 '{self.slot_id}'"
        if self.source is not None:
            loc += f"（来源 '{self.source}'）"
        detail = ""
        if self.missing_dependency is not None:
            detail = f"，未满足的前置依赖：'{self.missing_dependency}'"
        return f"{loc}：{self.message}{detail}"


class SlotConflictError(ComposerError):
    """同一槽位被同一来源重复填入不同素材 —— 属于必须拒绝的硬冲突。"""

    def __init__(self, message, *, goal_id, slot_id, source,
                 existing_unit_id, incoming_unit_id):
        super().__init__(message)
        self.goal_id = goal_id
        self.slot_id = slot_id
        self.source = source
        self.existing_unit_id = existing_unit_id
        self.incoming_unit_id = incoming_unit_id

    def __str__(self):
        return (
            f"目标 '{self.goal_id}' 槽位 '{self.slot_id}' 被来源 "
            f"'{self.source}' 重复填入不同素材：已有 "
            f"'{self.existing_unit_id}'，新到 '{self.incoming_unit_id}'"
        )


class UnknownGoalError(ComposerError):
    """查询 / 操作了不存在的叙事目标。"""


class UnknownUnitError(ComposerError):
    """查询 / 操作了不存在的素材单元。"""
