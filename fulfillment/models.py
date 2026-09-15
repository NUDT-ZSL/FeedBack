"""核心数据模型：需求、批次、履约节点。

批次的归属（被哪个节点承接）以 batch.node_id 为唯一事实来源，
从结构上保证"同一批次任意时刻只属于一个节点"；节点的已承接量
是节点自己维护的累计计数器（只增不减），两者互不推导、不会失真。
"""

from dataclasses import dataclass

# 批次状态机：
#   pending     —— 有前置批次未完成，阻塞中
#   ready       —— 前置全部完成（或没有前置），可以开始
#   in_progress —— 已开工
#   completed   —— 已完成，会触发直接后继的推进检查
STATUS_PENDING = "pending"
STATUS_READY = "ready"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED = "completed"
STATUSES = (STATUS_PENDING, STATUS_READY, STATUS_IN_PROGRESS, STATUS_COMPLETED)


@dataclass
class Demand:
    """一项客户需求。total_quantity 必须为正整数。"""

    id: str
    total_quantity: int


@dataclass
class Batch:
    """一个履约批次。

    prerequisites 为同一需求内前置批次标识的有序元组（按标识排序存储，
    保证序列化与比较结果稳定）。node_id 为 None 表示尚未被承接。
    """

    id: str
    demand_id: str
    quantity: int
    prerequisites: tuple = ()
    node_id: str = None
    status: str = STATUS_PENDING


@dataclass
class Node:
    """一个履约节点。

    capacity 为可承接的批次数量上限（正整数）。
    accepted 为累计已承接量：每次成功承接 +1，只增不减；
    批次完成或改派到其他节点都不扣减。
    """

    id: str
    capacity: int
    online: bool = True
    accepted: int = 0
