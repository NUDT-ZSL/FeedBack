"""不可变数据模型:物品与配方。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class Item:
    """物品:唯一标识 + 基础库存(非负整数,>0 表示可直接获得)。"""

    id: str
    stock: int = 0


@dataclass(frozen=True)
class Recipe:
    """配方:唯一标识 + 输入/输出 (物品标识, 数量) 对,数量均为正整数。"""

    id: str
    inputs: Tuple[Tuple[str, int], ...]
    outputs: Tuple[Tuple[str, int], ...]

    def output_qty(self, item_id: str) -> int:
        for iid, q in self.outputs:
            if iid == item_id:
                return q
        raise KeyError(item_id)
