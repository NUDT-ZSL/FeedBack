"""领域模型：货物、车厢、放置记录、装载方案。

尺寸约定：三维均为正数，坐标轴 x=长、y=宽、z=高。
朝向用 (0,1,2) 的一个排列表示，表示货物原始尺寸 (长,宽,高)
分别映射到车厢的哪根轴；允许六个轴对齐朝向（重复尺寸自动去重）。
"""

from dataclasses import dataclass, field
from itertools import permutations
from numbers import Real

from .errors import ValidationError
from .geometry import Box

# 固定顺序的六种轴对齐朝向；恒等朝向排第一，保证选择确定性。
ORIENTATIONS = list(dict.fromkeys(permutations((0, 1, 2))))


def _is_number(value):
    return isinstance(value, Real) and not isinstance(value, bool)


def _check_positive(value, name, location):
    if not _is_number(value):
        raise ValidationError(f"{name}必须是数字，实际为 {value!r}", location)
    if value != value or value in (float("inf"), float("-inf")):
        raise ValidationError(f"{name}必须是有限的正数", location)
    if value <= 0:
        raise ValidationError(f"{name}必须为正数，实际为 {value}", location)
    return value


def _check_id(value, location):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError("标识必须是非空字符串", location)
    return value


def oriented_dims(dims, orientation):
    return tuple(dims[i] for i in orientation)


@dataclass(frozen=True)
class Cargo:
    """一件货物。

    stack_limit 表示该货物【上方】允许堆叠的最大层数：
    1 表示上方最多再压 1 层；易碎货物恒为 0（上方不得有任何货物）。
    """

    id: str
    length: float
    width: float
    height: float
    weight: float
    stack_limit: int = 1
    fragile: bool = False

    def __post_init__(self):
        loc = f"cargo[{self.id!r}]" if isinstance(self.id, str) and self.id else "cargo"
        _check_id(self.id, f"{loc}.id")
        _check_positive(self.length, "长度", f"{loc}.length")
        _check_positive(self.width, "宽度", f"{loc}.width")
        _check_positive(self.height, "高度", f"{loc}.height")
        _check_positive(self.weight, "重量", f"{loc}.weight")
        if isinstance(self.stack_limit, bool) or not isinstance(self.stack_limit, int):
            raise ValidationError(
                f"可堆叠层数必须是非负整数，实际为 {self.stack_limit!r}",
                f"{loc}.stack_limit",
            )
        if self.stack_limit < 0:
            raise ValidationError(
                f"可堆叠层数必须是非负整数，实际为 {self.stack_limit}",
                f"{loc}.stack_limit",
            )
        if not isinstance(self.fragile, bool):
            raise ValidationError("易碎标记必须是布尔值", f"{loc}.fragile")
        # 易碎货物上方不得压货，语义上其上方允许层数恒为 0。
        if self.fragile:
            object.__setattr__(self, "stack_limit", 0)

    @property
    def dims(self):
        return (self.length, self.width, self.height)

    @property
    def volume(self):
        return self.length * self.width * self.height

    def to_dict(self):
        return {
            "id": self.id,
            "length": self.length,
            "width": self.width,
            "height": self.height,
            "weight": self.weight,
            "stack_limit": self.stack_limit,
            "fragile": self.fragile,
        }

    @classmethod
    def from_dict(cls, data, prefix="cargo"):
        if not isinstance(data, dict):
            raise ValidationError("货物必须是 JSON 对象", prefix)
        try:
            return cls(
                id=data["id"],
                length=data["length"],
                width=data["width"],
                height=data["height"],
                weight=data["weight"],
                stack_limit=data.get("stack_limit", 1),
                fragile=data.get("fragile", False),
            )
        except KeyError as exc:
            raise ValidationError(f"缺少必填字段 {exc.args[0]}", f"{prefix}.{exc.args[0]}")


@dataclass(frozen=True)
class Vehicle:
    """一节车厢：内部尺寸、最大载重与不可用区域（轴对齐盒列表）。"""

    id: str
    length: float
    width: float
    height: float
    max_weight: float
    blocked: tuple = field(default_factory=tuple)

    def __post_init__(self):
        loc = f"vehicle[{self.id!r}]" if isinstance(self.id, str) and self.id else "vehicle"
        _check_id(self.id, f"{loc}.id")
        _check_positive(self.length, "内部长度", f"{loc}.length")
        _check_positive(self.width, "内部宽度", f"{loc}.width")
        _check_positive(self.height, "内部高度", f"{loc}.height")
        _check_positive(self.max_weight, "最大载重", f"{loc}.max_weight")

        zones = []
        raw = self.blocked if isinstance(self.blocked, (list, tuple)) else [self.blocked]
        for i, z in enumerate(raw):
            box = _validate_box(z, f"{loc}.blocked[{i}]", interior=self)
            zones.append(box)
        # 不可用区域之间也不得互相重叠。
        for i in range(len(zones)):
            for j in range(i + 1, len(zones)):
                from .geometry import overlap

                if overlap(zones[i], zones[j]):
                    raise ValidationError(
                        f"不可用区域 {i} 与 {j} 互相重叠",
                        f"{loc}.blocked[{j}]",
                    )
        object.__setattr__(self, "blocked", tuple(zones))

    @property
    def dims(self):
        return (self.length, self.width, self.height)

    @property
    def interior_volume(self):
        return self.length * self.width * self.height

    @property
    def usable_volume(self):
        return self.interior_volume - sum(b.dx * b.dy * b.dz for b in self.blocked)

    def to_dict(self):
        return {
            "id": self.id,
            "length": self.length,
            "width": self.width,
            "height": self.height,
            "max_weight": self.max_weight,
            "blocked": [
                {"x": b.x, "y": b.y, "z": b.z, "dx": b.dx, "dy": b.dy, "dz": b.dz}
                for b in self.blocked
            ],
        }

    @classmethod
    def from_dict(cls, data, prefix="vehicle"):
        if not isinstance(data, dict):
            raise ValidationError("车厢必须是 JSON 对象", prefix)
        vp = f"{prefix}[{data.get('id')!r}]"
        for f in ("id", "length", "width", "height", "max_weight"):
            if f not in data:
                raise ValidationError(f"缺少必填字段 {f}", f"{vp}.{f}")
        blocked_raw = data.get("blocked", [])
        if not isinstance(blocked_raw, list):
            raise ValidationError("blocked 必须是数组", f"{vp}.blocked")
        boxes = []
        for i, z in enumerate(blocked_raw):
            boxes.append(_validate_box(z, f"{vp}.blocked[{i}]"))
        return cls(
            id=data["id"],
            length=data["length"],
            width=data["width"],
            height=data["height"],
            max_weight=data["max_weight"],
            blocked=tuple(boxes),
        )


def _validate_box(data, location, interior=None):
    """校验并构造一个盒；interior 给定时要求盒完全位于车厢内部且坐标非负。"""
    if not isinstance(data, (Box, dict)):
        raise ValidationError("区域必须是对象或 Box", location)
    if isinstance(data, Box):
        box = data
    else:
        try:
            box = Box(
                data["x"], data["y"], data["z"], data["dx"], data["dy"], data["dz"]
            )
        except KeyError as exc:
            raise ValidationError(
                f"缺少必填字段 {exc.args[0]}", f"{location}.{exc.args[0]}"
            )
    for n, v in (("x", box.x), ("y", box.y), ("z", box.z)):
        if not _is_number(v):
            raise ValidationError(f"坐标 {n} 必须是数字", f"{location}.{n}")
        if v < 0:
            raise ValidationError(f"坐标 {n} 不能为负，实际为 {v}", f"{location}.{n}")
    for n, v in (("dx", box.dx), ("dy", box.dy), ("dz", box.dz)):
        if not _is_number(v) or v <= 0:
            raise ValidationError(f"尺寸 {n} 必须为正数，实际为 {v}", f"{location}.{n}")
    if interior is not None:
        if box.x + box.dx > interior.length or box.y + box.dy > interior.width \
                or box.z + box.dz > interior.height:
            raise ValidationError(
                "区域超出车厢内部范围",
                location,
            )
    return box


@dataclass(frozen=True)
class Placement:
    """一件货物在某节车厢中的一次放置。

    level 为货物所在层（贴地板/不可用区域顶为第 1 层，向上递增）。
    """

    cargo_id: str
    vehicle_id: str
    x: float
    y: float
    z: float
    dx: float
    dy: float
    dz: float
    orientation: tuple  # (i,j,k)，货物尺寸轴到车厢轴的映射
    level: int = 1

    @property
    def box(self):
        return Box(self.x, self.y, self.z, self.dx, self.dy, self.dz)

    def to_dict(self):
        return {
            "cargo": self.cargo_id,
            "vehicle": self.vehicle_id,
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "orientation": list(self.orientation),
        }


@dataclass
class LoadPlan:
    """整套装载方案：vehicle_id -> 该车厢内的 Placement 列表。"""

    placements: dict = field(default_factory=dict)

    def for_vehicle(self, vehicle_id):
        return tuple(self.placements.get(vehicle_id, ()))

    def all_placements(self):
        result = []
        for vid in sorted(self.placements):
            result.extend(self.placements[vid])
        return result

    def cargo_index(self):
        index = {}
        for plist in self.placements.values():
            for p in plist:
                index[p.cargo_id] = p
        return index
