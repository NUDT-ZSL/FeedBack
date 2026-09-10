"""数据模型、输入校验与 series 身份（series_id）计算。

series 由 ``(metric, tags)`` 唯一确定。为了让 series_id 与字典插入顺序
无关、且在不同进程/语言间可复现，规范化键使用 ``metric + 排序后的
``k=v`` 列表`` 做 SHA-256，取前 16 字节十六进制表示（128 bit，碰撞概率
可忽略）。
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Sequence

from .errors import ValidationError

#: series_id 的十六进制长度（SHA-256 前 16 字节）
SERIES_ID_BYTES = 16


def _is_nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def _validate_tags(tags: Any) -> Dict[str, str]:
    """校验 tags：必须是 ``str -> str`` 的映射，键值都不能为空。"""
    if not isinstance(tags, Mapping):
        raise ValidationError("tags 必须是字符串到字符串的字典")
    result: Dict[str, str] = {}
    for key, value in tags.items():
        if not _is_nonempty_str(key):
            raise ValidationError("tags 的键必须是非空字符串")
        if not _is_nonempty_str(value):
            raise ValidationError(f"标签 {key!r} 的值必须是非空字符串")
        result[key] = value
    return result


def _validate_fields(fields: Any) -> Dict[str, float]:
    """校验 fields：至少一个字段，键非空，值必须是有限浮点数（或可转 float 的 int）。"""
    if not isinstance(fields, Mapping):
        raise ValidationError("fields 必须是字符串到数值的字典")
    if len(fields) == 0:
        raise ValidationError("fields 至少要包含一个字段")
    result: Dict[str, float] = {}
    for key, value in fields.items():
        if not _is_nonempty_str(key):
            raise ValidationError("fields 的键必须是非空字符串")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError(f"字段 {key!r} 的值必须是数值")
        fvalue = float(value)
        if not math.isfinite(fvalue):
            raise ValidationError(f"字段 {key!r} 的值必须是有限浮点数，收到 {value!r}")
        result[key] = fvalue
    return result


def compute_series_id(metric: str, tags: Mapping[str, str]) -> str:
    """根据 metric 和排序后的 tags 计算稳定的 series_id。

    调用方需保证 metric/tags 已校验。规范化形式是带长度前缀的
    ``metric`` 与按 key 排序的 ``(key, value)`` 列表，SHA-256 后截取
    前 :data:`SERIES_ID_BYTES` 字节。
    """
    parts: List[str] = [metric]
    for key in sorted(tags):
        parts.append(f"{key}={tags[key]}")
    # 用换行分隔；标签语法上允许 '='，但 metric 单独成段且整串带长度信息，
    # 不同 (metric, tags) 组合不会产生相同规范化串。
    canonical = "\x1f".join(parts)
    digest = hashlib.sha256(canonical.encode("utf-8")).digest()
    return digest[:SERIES_ID_BYTES].hex()


@dataclass(frozen=True)
class Point:
    """一个测点。

    :param metric: 测点名称，非空字符串。
    :param tags: 标签字典，键值均为非空字符串；可为空（无标签 series）。
    :param ts: 整数逻辑时间戳。
    :param fields: 字段字典，至少一个，值为有限浮点数。
    """

    metric: str
    tags: Dict[str, str]
    ts: int
    fields: Dict[str, float]

    def __post_init__(self) -> None:
        if not _is_nonempty_str(self.metric):
            raise ValidationError("metric 必须是非空字符串")
        # frozen dataclass 里做归一化校验需要 object.__setattr__
        object.__setattr__(self, "tags", _validate_tags(self.tags))
        if isinstance(self.ts, bool) or not isinstance(self.ts, int):
            raise ValidationError("ts 必须是整数")
        object.__setattr__(self, "fields", _validate_fields(self.fields))

    @property
    def series_id(self) -> str:
        """该测点所属 series 的稳定 ID。"""
        return compute_series_id(self.metric, self.tags)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric": self.metric,
            "tags": dict(self.tags),
            "ts": self.ts,
            "fields": dict(self.fields),
        }

    @classmethod
    def from_dict(cls, data: Any) -> "Point":
        """从普通 dict 构造 Point，缺字段/类型错都抛 :class:`ValidationError`。"""
        if not isinstance(data, Mapping):
            raise ValidationError("点必须是 JSON 对象")
        try:
            metric = data["metric"]
            tags = data["tags"]
            ts = data["ts"]
            fields = data["fields"]
        except (KeyError, TypeError) as exc:
            raise ValidationError(f"点缺少字段: {exc.args[0]!r}") from None
        return cls(metric=metric, tags=tags, ts=ts, fields=fields)


@dataclass
class QueryResult:
    """单条查询结果（一个 series 一个结果对象）。

    :param series_id: series 稳定哈希。
    :param metric: 测点名称。
    :param tags: 该 series 的完整标签。
    :param timestamps: 结果时间戳序列；区间聚合时为每个区间的起始时间。
    :param columns: 字段名到值序列的映射。

        * ``agg="none"``：与 ``timestamps`` 等长的原始值序列
         （按 ts 升序、同 ts 已应用“后写覆盖”语义）；
        * 聚合（``sum/avg/min/max/count``）：每个区间一个值，
          与区间边界对齐；无数据的区间不输出。

    :param agg: 实际使用的聚合方式。
    :param step: 区间聚合步长；``None`` 表示对整个 ``[start, end)`` 聚合成一个值。
    """

    series_id: str
    metric: str
    tags: Dict[str, str]
    timestamps: List[int] = field(default_factory=list)
    columns: Dict[str, List[float]] = field(default_factory=dict)
    agg: str = "none"
    step: int | None = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "series_id": self.series_id,
            "metric": self.metric,
            "tags": dict(self.tags),
            "timestamps": list(self.timestamps),
            "columns": {name: list(values) for name, values in self.columns.items()},
            "agg": self.agg,
            "step": self.step,
        }


def tags_match(tags: Mapping[str, str], tags_filter: Mapping[str, str]) -> bool:
    """判断 series 的 tags 是否满足过滤条件。

    * 普通值：精确匹配；
    * ``"*"``：该标签键存在即可（不限制值）。
    """
    for key, expected in tags_filter.items():
        if key not in tags:
            return False
        if expected != "*" and tags[key] != expected:
            return False
    return True


def normalize_fields_selection(
    fields: Sequence[str] | None, available: Sequence[str]
) -> List[str]:
    """把 fields 查询参数归一化为“实际存在、保持请求顺序、去重”的列表。

    任何被请求但该 series 没有的字段直接丢弃（字段不存在返回空列，
    而不是报错）；``None`` 表示读全部（按名字排序，保证稳定）。
    """
    if fields is None:
        return sorted(available)
    seen: set[str] = set()
    selected: List[str] = []
    available_set = set(available)
    for name in fields:
        if name in seen:
            continue
        seen.add(name)
        if name in available_set:
            selected.append(name)
    return selected
