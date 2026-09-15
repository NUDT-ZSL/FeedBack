"""领域记录：改版（Revision）与用户分群（Segment）。

分群的构成按“纪元（epoch）”维护：每个纪元是 ``(时刻, 用户集合)``，表示
该分群自该时刻起的成员构成。第一个纪元的时刻即“进入时刻”；之后可以在
严格递增的时刻登记新的纪元，从而表达“同一分群在改版前后构成明显不同”。

记录本身不可变，跨分群的归属唯一性由引擎在登记纪元时裁决。
"""

from dataclasses import dataclass, field
from typing import FrozenSet, Sequence, Tuple

from .errors import require


@dataclass(frozen=True)
class Revision:
    """一次改版。

    :param id:    唯一标识（非空字符串）。
    :param time:  生效时刻（逻辑时钟刻度，int）。
    :param items: 被调整的体验项名称（非空、不重复）。
    """

    id: str
    time: int
    items: Tuple[str, ...]

    def __init__(self, id: str, time: int, items: Sequence[str]):
        require(isinstance(id, str) and id.strip(),
                "改版 id 必须是非空字符串", "id")
        require(isinstance(time, int) and not isinstance(time, bool),
                "改版生效时刻必须是 int", "time")
        cleaned = []
        seen = set()
        for i, raw in enumerate(items):
            require(isinstance(raw, str), "体验项名称必须是字符串",
                    f"items[{i}]")
            name = raw.strip()
            require(name, "体验项名称不允许为空", f"items[{i}]")
            require(name not in seen,
                    f"体验项 {name!r} 在同一改版内重复", f"items[{i}]")
            seen.add(name)
            cleaned.append(name)
        require(cleaned, "改版至少要调整一个体验项", "items")
        object.__setattr__(self, "id", id)
        object.__setattr__(self, "time", time)
        object.__setattr__(self, "items", tuple(cleaned))

    @property
    def item_set(self) -> FrozenSet[str]:
        return frozenset(self.items)


@dataclass(frozen=True)
class Epoch:
    """分群成员构成的一个纪元：自 ``time`` 起成员为 ``users``。"""

    time: int
    users: Tuple[str, ...]

    def __init__(self, time: int, users: Sequence[str]):
        require(isinstance(time, int) and not isinstance(time, bool),
                "纪元时刻必须是 int", "time")
        seen = set()
        for i, raw in enumerate(users):
            require(isinstance(raw, str), "用户 id 必须是字符串",
                    f"users[{i}]")
            uid = raw.strip()
            require(uid, "用户 id 不允许为空", f"users[{i}]")
            seen.add(uid)
        require(seen, "纪元至少包含一个用户", "users")
        object.__setattr__(self, "time", time)
        object.__setattr__(self, "users", tuple(sorted(seen)))

    @property
    def user_set(self) -> FrozenSet[str]:
        return frozenset(self.users)


@dataclass(frozen=True)
class Segment:
    """一个用户分群：唯一 id + 一条严格递增的构成纪元链。"""

    id: str
    epochs: Tuple[Epoch, ...] = field(default=())

    def __init__(self, id: str, epochs: Sequence[Epoch]):
        require(isinstance(id, str) and id.strip(),
                "分群 id 必须是非空字符串", "id")
        require(epochs and all(isinstance(e, Epoch) for e in epochs),
                "分群至少需要一个构成纪元，且都必须是 Epoch", "epochs")
        last = None
        for i, e in enumerate(epochs):
            if last is not None:
                require(e.time > last,
                        f"纪元时刻必须严格递增：第 {i} 个纪元时刻 "
                        f"{e.time} 不晚于前一时刻 {last}",
                        f"epochs[{i}].time")
            last = e.time
        object.__setattr__(self, "id", id)
        object.__setattr__(self, "epochs", tuple(epochs))

    @property
    def entry_time(self) -> int:
        """进入时刻（第一个纪元的时刻）。"""
        return self.epochs[0].time

    @property
    def users(self) -> Tuple[str, ...]:
        """首个纪元的成员（登记时的初始构成）。"""
        return self.epochs[0].users

    @property
    def user_set(self) -> FrozenSet[str]:
        return self.epochs[0].user_set

    def members_at(self, time: int) -> Tuple[str, ...]:
        """该分群在 ``time`` 生效的纪元成员；尚未进入时为空。"""
        current: Tuple[str, ...] = ()
        for e in self.epochs:
            if e.time <= time:
                current = e.users
            else:
                break
        return current
