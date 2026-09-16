"""环境矩阵：维度定义、取值校验与笛卡尔积生成（需求 1）。

矩阵是不可变值对象：维度定义的任何“修改/新增取值”都会生成新矩阵，
由 runner 负责把旧矩阵上的结果按组合签名迁移到新矩阵（见 runner.py）。
"""
from __future__ import annotations

import itertools
from typing import Iterable, Mapping, Sequence, Union

from .errors import DefinitionError, DuplicateCombinationError
from .models import Combination, Dimension

DimensionLike = Union[Dimension, Mapping[str, object], Sequence[object]]


class Matrix:
    """由若干维度取值做笛卡尔积得到的环境组合矩阵。"""

    def __init__(self, dimensions: Iterable[DimensionLike]):
        dims = [self._coerce(d, i) for i, d in enumerate(dimensions)]
        if not dims:
            raise DefinitionError("至少需要定义一个环境维度", location="dimensions")

        # 维度名唯一性（带位置）。
        name_positions: dict[str, int] = {}
        for i, dim in enumerate(dims):
            loc = f"dimensions[{i}].name"
            if dim.name in name_positions:
                raise DefinitionError(
                    f"维度名 {dim.name!r} 重复：与 dimensions[{name_positions[dim.name]}] 冲突",
                    location=loc,
                    structured={"field": "dimension.name", "index": i,
                                "first_index": name_positions[dim.name]},
                )
            name_positions[dim.name] = i

        combos = tuple(
            Combination.create(tuple(coords))
            for coords in itertools.product(*(d.values for d in dims))
        )

        # 笛卡尔积理应唯一（Dimension 已拒绝重复取值）；这里再做一次带位置的防线。
        seen: dict[str, int] = {}
        for idx, combo in enumerate(combos):
            if combo.signature in seen:
                raise DuplicateCombinationError(
                    combo.coords,
                    reason="维度取值组合在笛卡尔积中重复",
                    location=f"cartesian[{idx}] 与 cartesian[{seen[combo.signature]}]",
                )
            seen[combo.signature] = idx

        self._dimensions: tuple[Dimension, ...] = tuple(dims)
        self._combinations: tuple[Combination, ...] = combos
        self._index: dict[str, Combination] = {c.signature: c for c in combos}

    @staticmethod
    def _coerce(raw: DimensionLike, index: int) -> Dimension:
        """接受 Dimension / {'name','values'} / (name, values)，错误统一带位置。"""
        if isinstance(raw, Dimension):
            return raw
        loc = f"dimensions[{index}]"
        try:
            if isinstance(raw, Mapping):
                name = raw.get("name")
                values = raw.get("values", ())
            elif isinstance(raw, (tuple, list)) and len(raw) == 2:
                name, values = raw
            else:
                raise DefinitionError(
                    f"维度定义必须是 Dimension、{{'name','values'}} 或 (name, values)，"
                    f"实际为 {type(raw).__name__}",
                    location=loc,
                )
            return Dimension(name=name, values=tuple(values))  # type: ignore[arg-type]
        except ValueError as exc:
            raise DefinitionError(str(exc), location=f"{loc}.values") from None

    @property
    def dimensions(self) -> tuple[Dimension, ...]:
        return self._dimensions

    @property
    def dimension_names(self) -> tuple[str, ...]:
        return tuple(d.name for d in self._dimensions)

    @property
    def combinations(self) -> tuple[Combination, ...]:
        return self._combinations

    @property
    def signatures(self) -> frozenset[str]:
        return frozenset(self._index)

    def dimension(self, name: str) -> Dimension:
        for d in self._dimensions:
            if d.name == name:
                return d
        raise KeyError(name)

    def dimension_index(self, name: str) -> int:
        for i, d in enumerate(self._dimensions):
            if d.name == name:
                return i
        raise KeyError(name)

    def resolve(self, coords: Iterable[str]) -> Combination:
        """把外部传入的坐标序列解析为矩阵中的组合，非法长度/未知取值直接报错。"""
        coords_t = tuple(coords)
        if len(coords_t) != len(self._dimensions):
            raise DefinitionError(
                f"组合坐标维度数为 {len(coords_t)}，矩阵要求 {len(self._dimensions)}"
                f"（维度顺序: {self.dimension_names}）",
                location="combination",
            )
        for i, (dim, value) in enumerate(zip(self._dimensions, coords_t)):
            if value not in dim.values:
                raise DefinitionError(
                    f"组合坐标第 {i} 维 {dim.name!r} 的取值 {value!r} 不在其取值集合 "
                    f"{tuple(dim.values)} 中",
                    location=f"combination[{i}] ({dim.name})",
                )
        sig = Combination.make_signature(coords_t)
        return self._index[sig]

    def contains(self, coords: Iterable[str]) -> bool:
        try:
            self.resolve(coords)
            return True
        except (DefinitionError, KeyError):
            return False

    def combinations_with(self, dim_name: str, value: str) -> tuple[Combination, ...]:
        """所有在指定维度上取指定值的组合。"""
        i = self.dimension_index(dim_name)
        return tuple(c for c in self._combinations if c.coords[i] == value)

    def render_combination(self, combo: Combination) -> str:
        return ", ".join(f"{n}={v}" for n, v in zip(self.dimension_names, combo.coords))
