"""两份内容的相似度与差异报告。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .chunking import ChunkConfig
from .delta import Add, Copy, Delta, diff


@dataclass(frozen=True)
class DiffReport:
    """差异报告。

    各字段含义：

    - ``common_bytes``：新内容中通过 ``COPY`` 从旧内容复用的字节数；
    - ``added_bytes``：新内容中通过 ``ADD`` 引入的字面字节数，
      恒满足 ``common_bytes + added_bytes == len(new)``；
    - ``deleted_bytes``：旧内容中未被复用的字节数，
      即 ``len(old) - common_bytes``；
    - ``similarity``：相似度，见 :func:`compare`；
    - ``changed_chunks``：内容定义分块后，仅出现在一侧的块数
      （新块摘要不在旧块集合中的数量，加上旧块摘要不在新块集合中
      的数量）；
    - ``old_size`` / ``new_size``：两侧内容大小。
    """

    common_bytes: int
    added_bytes: int
    deleted_bytes: int
    similarity: float
    changed_chunks: int
    old_size: int
    new_size: int

    def to_dict(self) -> dict:
        """序列化为 JSON 友好的字典。"""
        return {
            "common_bytes": self.common_bytes,
            "added_bytes": self.added_bytes,
            "deleted_bytes": self.deleted_bytes,
            "similarity": self.similarity,
            "changed_chunks": self.changed_chunks,
            "old_size": self.old_size,
            "new_size": self.new_size,
        }


def compare(
    old: bytes,
    new: bytes,
    config: Optional[ChunkConfig] = None,
    *,
    _delta: Optional[Delta] = None,
) -> DiffReport:
    """比较两份内容，返回 :class:`DiffReport`。

    相似度定义（Sørensen–Dice 系数，按复用字节计）：

    .. code-block:: text

        similarity = 2 * common_bytes / (len(old) + len(new))

    取值范围为 ``[0.0, 1.0]``：

    - 完全相同：``common_bytes == len(old) == len(new)``，相似度为 ``1.0``；
    - 完全不同（没有任何可复用块）：``common_bytes == 0``，相似度为 ``0.0``；
    - 两份空内容约定相似度为 ``1.0``。

    ``common_bytes`` 直接取自 :func:`cdiff.diff` 生成补丁中的 ``COPY``
    总量，因此报告与实际补丁复用情况严格一致。
    """
    cfg = config or ChunkConfig()
    delta = _delta if _delta is not None else diff(old, new, cfg)

    common = sum(
        op.length for op in delta.ops if isinstance(op, Copy)
    )
    added = sum(len(op.data) for op in delta.ops if isinstance(op, Add))
    old_size = delta.old_fingerprint.size
    new_size = delta.new_fingerprint.size

    # 理论不变量：COPY 总量不超过旧内容大小，COPY+ADD 恰好等于新内容大小。
    deleted = old_size - common
    total = old_size + new_size
    # 固定约定：两份空内容视为完全相同，相似度为 1.0（0/0 没有数学
    # 定义，这里显式钉死以避免行为漂移；由测试 test_both_empty_is_one 锁定）。
    similarity = 1.0 if total == 0 else (2.0 * common) / total
    # 浮点兜底，夹到 [0, 1]。
    similarity = max(0.0, min(1.0, similarity))

    old_digests = {c.digest for c in delta.old_fingerprint.chunks}
    new_digests = {c.digest for c in delta.new_fingerprint.chunks}
    changed_chunks = sum(
        1 for c in delta.new_fingerprint.chunks if c.digest not in old_digests
    ) + sum(
        1 for c in delta.old_fingerprint.chunks if c.digest not in new_digests
    )

    return DiffReport(
        common_bytes=common,
        added_bytes=added,
        deleted_bytes=deleted,
        similarity=similarity,
        changed_chunks=changed_chunks,
        old_size=old_size,
        new_size=new_size,
    )
