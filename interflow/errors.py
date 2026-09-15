"""interflow 的全部异常类型。

所有异常都继承自 InterflowError，验收脚本只需捕获这一个基类即可区分
「业务拒绝 / 定义非法 / 文件损坏」与其它意外错误。
"""


class InterflowError(Exception):
    """interflow 所有错误的基类。"""


class DefinitionError(InterflowError):
    """页面 / 状态 / 元素 / 动作的定义不合法（唯一性、目标存在性等）。"""


class DuplicateIdError(DefinitionError):
    """标识在其作用域内重复。"""


class TargetNotFoundError(DefinitionError):
    """动作引用的目标页面或目标状态不存在。"""


class ConditionError(DefinitionError):
    """条件分支不互斥、未覆盖全部取值或结构非法。"""


class MissingVariablesError(InterflowError):
    """条件无法判定或提交缺少输入变量。

    ``missing`` 属性按稳定顺序列出所有缺失的变量名。
    """

    def __init__(self, missing, reason="条件无法判定"):
        self.missing = list(missing)
        self.reason = reason
        message = f"{reason}：缺失变量 {self.missing}"
        super().__init__(message)


class BackRejectedError(InterflowError):
    """历史栈为空时请求返回。"""


class TriggerError(InterflowError):
    """单个动作在推进时被拒绝（元素不存在、目标状态不存在等）。"""


class BatchAbortedError(InterflowError):
    """批量触发中某一步失败，整批已回滚。

    Attributes:
        index: 失败步骤在批次中的下标（按稳定顺序排序后的下标）。
        reason: 原始异常。
        completed: 失败前已成功尝试应用的步数（回滚后这些迁移均不存在）。
    """

    def __init__(self, index, reason, completed=0):
        self.index = index
        self.reason = reason
        self.completed = completed
        super().__init__(
            f"批次在第 {index} 步失败，已回滚全部 {completed} 步：{reason}"
        )


class PersistenceError(InterflowError):
    """文件损坏、字段缺失、校验失败或 IO 错误。"""
