"""依赖图增量构建引擎。

对外暴露 :class:`DependencyGraph` 以及一组语义化异常。

状态模型
--------

每个节点保存两个指纹：

``current_fingerprint``
    节点内容的当前指纹，由调用方算好后通过 :meth:`DependencyGraph.add_node`
    或 :meth:`DependencyGraph.update_fingerprint` 传入。

``confirmed_fingerprint``
    上一次 :meth:`DependencyGraph.mark_clean` 时确认过的指纹。

节点状态由两个指纹推导，不单独落库：

``clean``   已确认干净：``current == confirmed``
``dirty``   自身指纹变了：``current != confirmed``
``pending`` 自身指纹没变，但（传递依赖中的）某个上游当前是 dirty。

pending 完全由图上可达的 dirty 推导，因此菱形依赖只会把同一节点算成一次
pending，传播结果与更新顺序无关。
"""

from .engine import (
    CyclicDependencyError,
    DependencyGraph,
    DuplicateNodeError,
    GraphError,
    InvalidSnapshotError,
    NodeNotFoundError,
    ValidationError,
)

__all__ = [
    "DependencyGraph",
    "GraphError",
    "NodeNotFoundError",
    "DuplicateNodeError",
    "ValidationError",
    "CyclicDependencyError",
    "InvalidSnapshotError",
]
