"""通用 Treap（树堆）有序结构。

内核中它承担两个职责：

* 全量行按当前排序规则排序后的有序集合；
* 通过筛选的可见行有序集合。

采用最小堆：优先级数值越小越靠近根。键不直接做大小比较，而是由
构造时传入的 ``less(a, b)`` 判定，因此同一套结构既能按升序也能按
降序键工作。

节点用并行数组（下标 0 为空节点哨兵）存储，删除的节点不回收——
本内核面向「排序/筛选频繁变更、行集合相对稳定」的场景，每次规则
变更都会整体重建，因此不做自由节点复用。
"""

from __future__ import annotations

import random
from typing import Any, Callable, Iterator

LessFn = Callable[[Any, Any], bool]

# 空节点哨兵
_NIL = 0


class DuplicateKeyError(KeyError):
    """插入了已存在的键。"""


class Treap:
    """按键有序、按优先级堆有序的二叉搜索树。"""

    __slots__ = ("less", "_rng", "root", "left", "right", "prio",
                 "size", "keys", "payloads")

    def __init__(self, less: LessFn, seed: int = 0):
        if seed is None:
            self._rng = random.Random()
        else:
            self._rng = random.Random(seed)
        self.less = less
        self.root = _NIL
        # 下标 0 占空哨兵
        self.left: list[int] = [0]
        self.right: list[int] = [0]
        self.prio: list[int] = [0]
        self.size: list[int] = [0]
        self.keys: list[Any] = [None]
        self.payloads: list[Any] = [None]

    # ------------------------------------------------------------------
    # 基础工具
    # ------------------------------------------------------------------

    def __len__(self) -> int:
        return self.size[self.root]

    def _pull(self, t: int) -> None:
        self.size[t] = 1 + self.size[self.left[t]] + self.size[self.right[t]]

    def _new_node(self, key: Any, payload: Any) -> int:
        idx = len(self.size)
        self.left.append(0)
        self.right.append(0)
        # 64 位正整数优先级
        self.prio.append(self._rng.getrandbits(64) + 1)
        self.size.append(1)
        self.keys.append(key)
        self.payloads.append(payload)
        return idx

    def _rot_right(self, t: int) -> int:
        x = self.left[t]
        self.left[t] = self.right[x]
        self.right[x] = t
        self._pull(t)
        self._pull(x)
        return x

    def _rot_left(self, t: int) -> int:
        x = self.right[t]
        self.right[t] = self.left[x]
        self.left[x] = t
        self._pull(t)
        self._pull(x)
        return x

    # ------------------------------------------------------------------
    # 单点增删查
    # ------------------------------------------------------------------

    def insert(self, key: Any, payload: Any) -> None:
        """插入一个新键；键已存在时抛 DuplicateKeyError。"""
        if self._find(self.root, key) != _NIL:
            raise DuplicateKeyError(repr(key))
        node = self._new_node(key, payload)

        def ins(t: int) -> int:
            if t == _NIL:
                return node
            if self.less(key, self.keys[t]):
                self.left[t] = ins(self.left[t])
                if self.prio[self.left[t]] < self.prio[t]:
                    t = self._rot_right(t)
            else:
                self.right[t] = ins(self.right[t])
                if self.prio[self.right[t]] < self.prio[t]:
                    t = self._rot_left(t)
            self._pull(t)
            return t

        self.root = ins(self.root)

    def remove(self, key: Any) -> None:
        """按键删除；键不存在时抛 KeyError。"""
        def erase(t: int) -> int:
            if t == _NIL:
                raise KeyError(repr(key))
            if self.less(key, self.keys[t]):
                self.left[t] = erase(self.left[t])
            elif self.less(self.keys[t], key):
                self.right[t] = erase(self.right[t])
            else:
                l, r = self.left[t], self.right[t]
                if l == _NIL:
                    return r
                if r == _NIL:
                    return l
                # 双孩子：把堆优先级更小的孩子旋转上来，目标键随之下沉，
                # 递归删除时它至多只有一个孩子。
                if self.prio[l] < self.prio[r]:
                    t = self._rot_right(t)
                    self.right[t] = erase(self.right[t])
                else:
                    t = self._rot_left(t)
                    self.left[t] = erase(self.left[t])
            self._pull(t)
            return t

        self.root = erase(self.root)

    def _find(self, t: int, key: Any) -> int:
        while t != _NIL:
            if self.less(key, self.keys[t]):
                t = self.left[t]
            elif self.less(self.keys[t], key):
                t = self.right[t]
            else:
                return t
        return _NIL

    def contains(self, key: Any) -> bool:
        return self._find(self.root, key) != _NIL

    def get_payload(self, key: Any) -> Any:
        t = self._find(self.root, key)
        if t == _NIL:
            raise KeyError(repr(key))
        return self.payloads[t]

    # ------------------------------------------------------------------
    # 排名 / 按排名访问
    # ------------------------------------------------------------------

    def count_less(self, key: Any) -> int:
        """严格小于 key 的键的个数。"""
        t = self.root
        total = 0
        while t != _NIL:
            if self.less(self.keys[t], key):
                total += self.size[self.left[t]] + 1
                t = self.right[t]
            else:
                t = self.left[t]
        return total

    def rank_of(self, key: Any) -> int:
        """键的 0 基排名；不存在时抛 KeyError。"""
        t = self.root
        total = 0
        while t != _NIL:
            if self.less(key, self.keys[t]):
                t = self.left[t]
            elif self.less(self.keys[t], key):
                total += self.size[self.left[t]] + 1
                t = self.right[t]
            else:
                return total + self.size[self.left[t]]
        raise KeyError(repr(key))

    def kth_payload(self, rank: int) -> Any:
        """取第 rank（0 基）个键对应的载荷；越界抛 IndexError。"""
        if rank < 0 or rank >= len(self):
            raise IndexError(f"排名越界: {rank}（共 {len(self)} 个）")
        t = self.root
        while t != _NIL:
            ls = self.size[self.left[t]]
            if rank < ls:
                t = self.left[t]
            elif rank > ls:
                rank -= ls + 1
                t = self.right[t]
            else:
                return self.payloads[t]
        raise IndexError(rank)  # 理论不可达

    def first_payload(self) -> Any:
        """最小键的载荷；空树抛 IndexError。"""
        if self.root == _NIL:
            raise IndexError("空树")
        t = self.root
        while self.left[t] != _NIL:
            t = self.left[t]
        return self.payloads[t]

    # ------------------------------------------------------------------
    # 区间遍历
    # ------------------------------------------------------------------

    def slice_payloads(self, lo: int, hi: int) -> list[Any]:
        """取排名区间 [lo, hi) 的载荷，复杂度 O(log n + (hi-lo))。"""
        n = len(self)
        if lo < 0 or hi > n or lo > hi:
            raise IndexError(f"区间非法: [{lo}, {hi})，总数 {n}")
        out: list[Any] = []
        left, right, size = self.left, self.right, self.size

        def walk(t: int, base: int) -> None:
            # base 为本子树第一个键的全局排名
            if t == _NIL:
                return
            if base + size[t] <= lo or base >= hi:
                return
            ls = size[left[t]]
            walk(left[t], base)
            pos = base + ls
            if lo <= pos < hi:
                out.append(self.payloads[t])
            walk(right[t], pos + 1)

        walk(self.root, 0)
        return out

    def iter_payloads(self) -> Iterator[Any]:
        """按键升序产出全部载荷。"""
        stack: list[int] = []
        t = self.root
        left, right = self.left, self.right
        while stack or t != _NIL:
            while t != _NIL:
                stack.append(t)
                t = left[t]
            t = stack.pop()
            yield self.payloads[t]
            t = right[t]

    # ------------------------------------------------------------------
    # 线性批量构建
    # ------------------------------------------------------------------

    def build_sorted(self, pairs: list[tuple[Any, Any]]) -> None:
        """用已按键升序排列的 (key, payload) 列表整体重建，O(n)。

        算法：对随机优先级序列构造最小堆笛卡尔树（单调右脊栈），
        再按后序一次性回填子树大小。
        """
        # 重置（保留哨兵）
        self.root = _NIL
        self.left = [0]
        self.right = [0]
        self.prio = [0]
        self.size = [0]
        self.keys = [None]
        self.payloads = [None]

        n = len(pairs)
        if n == 0:
            return

        left = self.left
        right = self.right
        prio = self.prio
        size = self.size
        keys = self.keys
        payloads = self.payloads

        for key, payload in pairs:
            idx = len(size)
            left.append(0)
            right.append(0)
            prio.append(self._rng.getrandbits(64) + 1)
            size.append(1)
            keys.append(key)
            payloads.append(payload)

        # 单调栈构造笛卡尔树：节点下标即中序位置（1..n）
        spine: list[int] = []
        for i in range(1, n + 1):
            last = _NIL
            while spine and prio[spine[-1]] > prio[i]:
                last = spine.pop()
            left[i] = last
            if spine:
                right[spine[-1]] = i
            spine.append(i)
        self.root = spine[0]

        # 后序回填 size：先做一次前序收集再逆序处理，
        # 访问节点数严格 O(n)。
        order: list[int] = []
        stack = [self.root]
        while stack:
            t = stack.pop()
            order.append(t)
            if left[t] != _NIL:
                stack.append(left[t])
            if right[t] != _NIL:
                stack.append(right[t])
        for t in reversed(order):
            size[t] = 1 + size[left[t]] + size[right[t]]

    # ------------------------------------------------------------------
    # 调试用不变量校验
    # ------------------------------------------------------------------

    def verify(self) -> None:
        """全量校验 BST 序、堆性质与子树大小；不满足时抛 AssertionError。"""
        if self.size[self.root] != self._count(self.root):
            raise AssertionError("根节点大小与实际不符")

        # 中序遍历必须严格按 less 递增
        prev: Any = None
        have_prev = False
        stack: list[int] = []
        t = self.root
        while stack or t != _NIL:
            while t != _NIL:
                stack.append(t)
                t = self.left[t]
            t = stack.pop()
            if have_prev and not self.less(prev, self.keys[t]):
                raise AssertionError("中序序列非严格递增（BST 性质被破坏）")
            prev = self.keys[t]
            have_prev = True
            t = self.right[t]

        def check_heap(t: int) -> None:
            # 递归深度为树高（O(log n)），仅用于测试/验收
            if t == _NIL:
                return
            l, r = self.left[t], self.right[t]
            if l != _NIL and self.prio[l] < self.prio[t]:
                raise AssertionError("最小堆性质被破坏（左孩子）")
            if r != _NIL and self.prio[r] < self.prio[t]:
                raise AssertionError("最小堆性质被破坏（右孩子）")
            if self.size[t] != 1 + self.size[l] + self.size[r]:
                raise AssertionError(f"节点 {t} 子树大小错误")
            check_heap(l)
            check_heap(r)

        check_heap(self.root)

    def _count(self, t: int) -> int:
        if t == _NIL:
            return 0
        return 1 + self._count(self.left[t]) + self._count(self.right[t])
