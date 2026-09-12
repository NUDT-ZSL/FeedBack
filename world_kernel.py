"""游戏世界状态内核：实体生命周期、组件存储、查询缓存、确定性快照与回滚。

仅依赖 Python 标准库，不依赖渲染/网络，可离线运行与测试。
"""

from __future__ import annotations

import pickle
from typing import Any, Callable, Dict, List, Tuple

__all__ = ["World", "EntityNotFound", "SnapshotError"]

# 快照字节流的魔数头，用于快速识别损坏/非本格式数据
_SNAPSHOT_MAGIC = b"WSK1"
# 固定 pickle 协议版本，保证同一份状态序列化结果稳定
_PICKLE_PROTOCOL = 4


class EntityNotFound(KeyError):
    """对已销毁/不存在的实体执行 set/get/remove 时抛出，携带 eid。"""

    def __init__(self, eid: int):
        self.eid = eid
        super().__init__(f"entity not found: {eid}")


class SnapshotError(Exception):
    """快照数据损坏或格式非法时抛出。"""


class World:
    """ECS 风格的世界状态内核。

    - 实体为单调递增、永不复用的整数 id；
    - 组件按类型字符串注册，值可以是任意可 pickle 的 Python 对象；
    - 存储按组件类型组合（archetype）分组，查询结果带定向失效的缓存；
    - snapshot/restore 字节确定；run 前自动打检查点，rollback 逐级回退。
    """

    def __init__(self) -> None:
        self._next_eid: int = 1
        self._alive: set[int] = set()
        # 实体 -> 其组件类型组合（frozenset），archetype 分组的核心索引
        self._entity_arch: Dict[int, frozenset] = {}
        # archetype -> 该组内的实体集合
        self._arch_entities: Dict[frozenset, set[int]] = {}
        # 组件类型 -> {eid: value}
        self._components: Dict[str, Dict[int, Any]] = {}
        self._registered: set[str] = set()
        # 查询缓存：排序后的组件类型元组 -> 升序实体 id 列表
        self._query_cache: Dict[Tuple[str, ...], List[int]] = {}
        self._cache_hits: int = 0
        self._cache_invalidations: int = 0
        # 系统表：(phase, 注册序号, name, fn)
        self._systems: List[Tuple[float, int, str, Callable]] = []
        self._system_seq: int = 0
        # 回滚检查点栈，元素为 snapshot 字节
        self._checkpoints: List[bytes] = []

    # ------------------------------------------------------------------
    # 实体生命周期
    # ------------------------------------------------------------------

    def create(self) -> int:
        """创建实体，返回单调递增且永不复用的整数 id。"""
        eid = self._next_eid
        self._next_eid += 1
        self._alive.add(eid)
        arch = frozenset()
        self._entity_arch[eid] = arch
        self._arch_entities.setdefault(arch, set()).add(eid)
        # 空类型查询（匹配全部实体）的缓存需要失效
        self._invalidate_key(())
        return eid

    def destroy(self, eid: int) -> bool:
        """销毁实体，其所有组件立即不可见；重复销毁返回 False。"""
        if eid not in self._alive:
            return False
        arch = self._entity_arch.pop(eid)
        self._arch_entities[arch].discard(eid)
        for comp_type in arch:
            del self._components[comp_type][eid]
            self._invalidate_type(comp_type)
        self._alive.discard(eid)
        self._invalidate_key(())
        return True

    def is_alive(self, eid: int) -> bool:
        return eid in self._alive

    def _require_alive(self, eid: int) -> None:
        if eid not in self._alive:
            raise EntityNotFound(eid)

    # ------------------------------------------------------------------
    # 组件
    # ------------------------------------------------------------------

    def register_component(self, comp_type: str) -> None:
        """注册组件类型（幂等）；set 时未注册的类型会自动注册。"""
        self._registered.add(comp_type)
        self._components.setdefault(comp_type, {})

    def set(self, eid: int, comp_type: str, value: Any) -> None:
        """设置组件，覆盖旧值；实体不存在时抛 EntityNotFound。"""
        self._require_alive(eid)
        if comp_type not in self._registered:
            self.register_component(comp_type)
        old_arch = self._entity_arch[eid]
        self._components[comp_type][eid] = value
        if comp_type in old_arch:
            # 仅覆盖值，实体所属分组不变，无需失效任何查询缓存
            return
        new_arch = old_arch | {comp_type}
        self._move_archetype(eid, old_arch, new_arch)
        self._invalidate_type(comp_type)

    def get(self, eid: int, comp_type: str, default: Any = None) -> Any:
        """读取组件，不存在时返回 default；实体不存在时抛 EntityNotFound。"""
        self._require_alive(eid)
        store = self._components.get(comp_type)
        if store is None:
            return default
        return store.get(eid, default)

    def remove(self, eid: int, comp_type: str) -> bool:
        """移除组件，返回是否真的删掉了；实体不存在时抛 EntityNotFound。"""
        self._require_alive(eid)
        old_arch = self._entity_arch[eid]
        if comp_type not in old_arch:
            return False
        del self._components[comp_type][eid]
        new_arch = old_arch - {comp_type}
        self._move_archetype(eid, old_arch, new_arch)
        self._invalidate_type(comp_type)
        return True

    def _move_archetype(self, eid: int, old: frozenset, new: frozenset) -> None:
        self._arch_entities[old].discard(eid)
        self._arch_entities.setdefault(new, set()).add(eid)
        self._entity_arch[eid] = new

    # ------------------------------------------------------------------
    # 查询与缓存
    # ------------------------------------------------------------------

    def query(self, *comp_types: str) -> List[int]:
        """返回同时拥有全部指定组件的实体 id 列表（升序）。

        不带参数时返回全部存活实体。重复查询命中缓存。
        """
        key = tuple(sorted(set(comp_types)))
        cached = self._query_cache.get(key)
        if cached is not None:
            self._cache_hits += 1
            return list(cached)
        wanted = frozenset(key)
        result: set[int] = set()
        # 按 archetype 分组扫描：组内实体组件组合相同，整组命中或整组跳过
        for arch, entities in self._arch_entities.items():
            if wanted <= arch:
                result.update(entities)
        ordered = sorted(result)
        self._query_cache[key] = ordered
        return list(ordered)

    def _invalidate_type(self, comp_type: str) -> None:
        """只失效包含该组件类型的缓存项（定向失效，不整体清空）。"""
        for key in [k for k in self._query_cache if comp_type in k]:
            del self._query_cache[key]
            self._cache_invalidations += 1

    def _invalidate_key(self, key: Tuple[str, ...]) -> None:
        if key in self._query_cache:
            del self._query_cache[key]
            self._cache_invalidations += 1

    def stats(self) -> Dict[str, int]:
        """缓存统计：命中数、失效数、当前缓存条目数。"""
        return {
            "hits": self._cache_hits,
            "invalidations": self._cache_invalidations,
            "entries": len(self._query_cache),
        }

    # ------------------------------------------------------------------
    # 快照与恢复
    # ------------------------------------------------------------------

    def snapshot(self) -> bytes:
        """导出确定性快照字节：同样状态两次调用结果完全相同。"""
        state = {
            "next_eid": self._next_eid,
            "registered": sorted(self._registered),
            "entities": sorted(self._alive),
            # 组件表按类型名、实体 id 排序后重建，保证 pickle 字节稳定
            "components": {
                comp_type: {eid: store[eid] for eid in sorted(store)}
                for comp_type, store in sorted(self._components.items())
            },
            "cache_hits": self._cache_hits,
            "cache_invalidations": self._cache_invalidations,
        }
        return _SNAPSHOT_MAGIC + pickle.dumps(state, protocol=_PICKLE_PROTOCOL)

    def restore(self, data: bytes) -> None:
        """从快照字节恢复世界；数据损坏时抛 SnapshotError 且当前世界不变。"""
        state = self._parse_snapshot(data)
        self._apply_state(state)
        # 旧检查点属于另一条世界线，恢复后作废
        self._checkpoints.clear()

    @staticmethod
    def _parse_snapshot(data: bytes) -> dict:
        try:
            if not isinstance(data, (bytes, bytearray)):
                raise SnapshotError("snapshot must be bytes")
            if not bytes(data).startswith(_SNAPSHOT_MAGIC):
                raise SnapshotError("bad snapshot magic")
            state = pickle.loads(bytes(data)[len(_SNAPSHOT_MAGIC):])
        except SnapshotError:
            raise
        except Exception as exc:  # pickle 反序列化的任意失败都归为快照损坏
            raise SnapshotError(f"corrupt snapshot: {exc}") from exc
        # 结构校验：任何字段缺失/类型不符都拒绝，且尚未触碰当前世界
        try:
            assert isinstance(state, dict)
            next_eid = state["next_eid"]
            registered = state["registered"]
            entities = state["entities"]
            components = state["components"]
            hits = state["cache_hits"]
            invalidations = state["cache_invalidations"]
            assert isinstance(next_eid, int) and next_eid >= 1
            assert isinstance(registered, list)
            assert all(isinstance(t, str) for t in registered)
            assert isinstance(entities, list)
            assert all(isinstance(e, int) for e in entities)
            assert isinstance(components, dict)
            for comp_type, store in components.items():
                assert isinstance(comp_type, str) and isinstance(store, dict)
                assert all(isinstance(e, int) for e in store)
                assert all(e in entities for e in store)
            assert isinstance(hits, int) and isinstance(invalidations, int)
        except (KeyError, AssertionError) as exc:
            raise SnapshotError(f"invalid snapshot structure: {exc}") from exc
        return state

    def _apply_state(self, state: dict) -> None:
        """把校验过的快照状态整体换入（先构建再替换，保证不留半成品）。"""
        components: Dict[str, Dict[int, Any]] = {
            comp_type: dict(store) for comp_type, store in state["components"].items()
        }
        alive = set(state["entities"])
        entity_arch: Dict[int, frozenset] = {eid: frozenset() for eid in alive}
        for comp_type, store in components.items():
            for eid in store:
                entity_arch[eid] = entity_arch[eid] | {comp_type}
        arch_entities: Dict[frozenset, set[int]] = {}
        for eid, arch in entity_arch.items():
            arch_entities.setdefault(arch, set()).add(eid)

        self._next_eid = state["next_eid"]
        self._alive = alive
        self._entity_arch = entity_arch
        self._arch_entities = arch_entities
        self._components = components
        self._registered = set(state["registered"])
        # 缓存条目是可重建的派生数据，清空即可；计数器恢复到快照时刻
        self._query_cache = {}
        self._cache_hits = state["cache_hits"]
        self._cache_invalidations = state["cache_invalidations"]

    # ------------------------------------------------------------------
    # 系统调度与回滚
    # ------------------------------------------------------------------

    def register_system(self, name: str, fn: Callable[["World", float], None],
                        phase: float = 0) -> None:
        """注册系统；run 时按 phase 升序、同 phase 按注册顺序执行。"""
        self._systems.append((phase, self._system_seq, name, fn))
        self._system_seq += 1

    def run(self, dt: float) -> None:
        """执行一轮系统调度。运行前自动打隐式检查点供 rollback 使用。

        某个系统抛异常时中断本轮 run 并原样抛出；单次组件写是原子的，
        世界停留在上一个系统完成后的可查询一致状态。
        """
        self._checkpoints.append(self.snapshot())
        for _phase, _seq, _name, fn in sorted(self._systems):
            fn(self, dt)

    def rollback(self) -> bool:
        """回滚到最近一次 run 之前的状态；连续调用逐级回退。

        检查点为空时返回 False。id 分配器随状态一起回退，
        重放同一批输入会得到相同的实体 id。
        """
        if not self._checkpoints:
            return False
        data = self._checkpoints.pop()
        state = self._parse_snapshot(data)  # 自己产出的字节，正常不会失败
        self._apply_state(state)  # 不动检查点栈，剩余检查点仍可继续回退
        return True
