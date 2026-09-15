"""履约协同模块的异常体系。

所有业务异常都继承自 FulfillmentError，便于调用方统一捕获；
持久化相关的错误单独使用 PersistenceError，与运行时业务错误区分。
"""


class FulfillmentError(Exception):
    """模块内所有业务异常的基类。"""


class ValidationError(FulfillmentError):
    """输入参数或拆分方案不合法（数量非正、标识重复、前置缺失、存在环等）。"""


class NotFoundError(FulfillmentError):
    """引用的需求、批次或节点不存在。"""


class CapacityError(FulfillmentError):
    """节点容量不足，无法承接批次。

    携带 node_id 与 remaining（剩余可承接量），方便调用方做改派决策。
    """

    def __init__(self, message, node_id=None, remaining=None):
        super().__init__(message)
        self.node_id = node_id
        self.remaining = remaining


class StateError(FulfillmentError):
    """当前状态不允许该操作（前置未完成、节点已下线、批次已完成等）。"""


class PersistenceError(FulfillmentError):
    """持久化文件损坏、字段缺失或校验失败。"""
