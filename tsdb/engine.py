"""列式时序存储内核 :class:`ColumnarTSDB`。

存储层次::

    shard（按 shard_span 固定时间分片）
      └─ series（metric + 排序 tags 的稳定哈希）
           └─ field（字段列）
                └─ ColumnBlock 列表（追加/乱序回填产生多个列块）

关键语义（README 有完整说明）：

* **乱序回填**：新数据永不插入旧列块，而是按 (shard, series, field)
  追加新列块；查询时把列块列表合并成时间有序序列。
* **后写覆盖（LWW）**：列块带单调递增的 ``seq``，同一 ts 出现在多个
  列块时，``seq`` 大的（后写入的）值生效。
* **删除**：``delete_series`` / ``delete_range`` 先把列块标记为
  tombstone，并记录带 ``seq`` 的范围删除标记；只影响删除时刻已存在的
  数据，删除后重新写入的同时间戳点仍然可见。:meth:`compact` 做物理清理。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .block import ColumnBlock
from .errors import BlockFormatError, CorruptionError, ValidationError
from .model import (
    Point,
    QueryResult,
    compute_series_id,
    normalize_fields_selection,
    tags_match,
)

MANIFEST_NAME = "manifest.json"
BLOCKS_DIR = "blocks"
_FORMAT = "columnar-tsdb"
_FORMAT_VERSION = 1

_AGGS = {"none", "sum", "avg", "min", "max", "count"}


@dataclass
class _SeriesMeta:
    series_id: str
    metric: str
    tags: Dict[str, str]
    deleted: bool = False


@dataclass
class _BlockEntry:
    """列块在内存中的包装：列块本身 + 身份/顺序/删除标记。"""

    block: ColumnBlock
    entry_id: int
    seq: int
    deleted: bool = False

    @property
    def file_name(self) -> str:
        return f"b{self.entry_id}.blk"


def _shard_of(ts: int, span: int) -> int:
    """时间戳 -> shard 下标（地板除，负时间也成立）。"""
    return ts // span


class ColumnarTSDB:
    """可嵌入的列式时序存储引擎。

    :param shard_span: 每个 shard 的时间跨度（逻辑时间单位，必须为正整数）。
    :param block_size: 单个列块最多容纳的点数（必须为正整数）。
    """

    def __init__(self, shard_span: int = 3600, block_size: int = 1024) -> None:
        if not isinstance(shard_span, int) or isinstance(shard_span, bool) or shard_span <= 0:
            raise ValidationError("shard_span 必须是正整数")
        if not isinstance(block_size, int) or isinstance(block_size, bool) or block_size <= 0:
            raise ValidationError("block_size 必须是正整数")
        self.shard_span = shard_span
        self.block_size = block_size

        self._series: Dict[str, _SeriesMeta] = {}
        # shard -> sid -> field -> [_BlockEntry]（按 seq/写入顺序排列）
        self._data: Dict[int, Dict[str, Dict[str, List[_BlockEntry]]]] = {}
        # shard -> set(sid)，查询时做 shard 裁剪
        self._shard_series: Dict[int, set[str]] = {}
        # metric -> set(sid)，查询时先按 metric 裁剪
        self._metric_series: Dict[str, set[str]] = {}
        # shard -> sid -> [[start, end, seq], ...] 范围删除标记
        self._tombstones: Dict[int, Dict[str, List[List[int]]]] = {}
        self._next_block_id = 1
        self._next_seq = 1

    # ---------------------------------------------------------------- 写入

    def append(self, points: Sequence[Point | Mapping[str, Any]]) -> int:
        """追加写入一批测点，支持乱序回填。

        点可以是 :class:`~tsdb.model.Point`，也可以是等价的 dict
        （CLI/JSON 路径使用）。同一批次内相同 ``(series, ts, field)``
        以批次内靠后的点为准。返回写入的点数。

        空批次为合法 no-op，返回 0。
        """
        if not isinstance(points, (list, tuple)):
            raise ValidationError("points 必须是一个列表")

        # 1. 校验并归一化，按 (shard, sid, field) 收集成本批写入映射。
        #    batched[shard][sid][field] = {ts: value}；dict 保留覆盖顺序，
        #    同一 ts 后出现的值天然覆盖先出现的。
        batched: Dict[int, Dict[str, Dict[str, Dict[int, float]]]] = {}
        sids_in_batch: set[str] = set()
        count = 0
        for raw in points:
            point = raw if isinstance(raw, Point) else Point.from_dict(raw)
            sid = point.series_id
            sids_in_batch.add(sid)
            meta = self._series.get(sid)
            if meta is None:
                self._series[sid] = _SeriesMeta(sid, point.metric, dict(point.tags))
                self._metric_series.setdefault(point.metric, set()).add(sid)
            else:
                # 哈希碰撞防御：相同 id 必须是同一个 series 身份。
                if meta.metric != point.metric or meta.tags != dict(point.tags):
                    raise ValidationError(
                        "series_id 冲突：metric/tags 不同却算出了相同哈希"
                    )
                meta.deleted = False  # 删除后重新写入 => series 复活
            for fts, fvalue in point.fields.items():
                shard = _shard_of(point.ts, self.shard_span)
                batched.setdefault(shard, {}).setdefault(sid, {}) \
                    .setdefault(fts, {})[point.ts] = float(fvalue)
            count += 1

        # 2. 每个 (shard, sid, field) 排序、按 block_size 切块、追加新列块。
        for shard, by_series in batched.items():
            shard_bucket = self._data.setdefault(shard, {})
            shard_series = self._shard_series.setdefault(shard, set())
            for sid, by_field in by_series.items():
                shard_bucket.setdefault(sid, {})
                shard_series.add(sid)
                for field_name, ts_to_value in by_field.items():
                    timestamps = sorted(ts_to_value)
                    entries = shard_bucket[sid].setdefault(field_name, [])
                    for i in range(0, len(timestamps), self.block_size):
                        chunk_ts = timestamps[i : i + self.block_size]
                        chunk_vals = [ts_to_value[t] for t in chunk_ts]
                        block = ColumnBlock.from_points(
                            sid, field_name, chunk_ts, chunk_vals
                        )
                        entries.append(_BlockEntry(
                            block=block,
                            entry_id=self._next_block_id,
                            seq=self._next_seq,
                        ))
                        self._next_block_id += 1
                        self._next_seq += 1
        return count

    # ---------------------------------------------------------------- 查询

    def query(
        self,
        metric: str,
        tags_filter: Mapping[str, str],
        start: int,
        end: int,
        fields: Optional[Sequence[str]] = None,
        agg: str = "none",
        step: Optional[int] = None,
    ) -> List[QueryResult]:
        """范围扫描 + 标签过滤 + 聚合。

        :param metric: 精确匹配的测点名称。
        :param tags_filter: 标签过滤；值为 ``"*"`` 表示该标签存在即可。
        :param start: 起始时间（含）。
        :param end: 结束时间（不含）。``start >= end`` 时返回空列表。
        :param fields: 要读的字段；``None`` 表示该 series 的全部字段。
            请求了但不存在的字段被忽略；若一个字段都不存在，结果为空。
        :param agg: ``none/sum/avg/min/max/count``。
        :param step: 区间聚合步长；仅在 ``agg != "none"`` 时可给，
            按 ``[start + k*step, start + (k+1)*step)`` 输出。
        """
        self._validate_query_args(metric, tags_filter, start, end, fields, agg, step)
        if start >= end:
            return []

        shard_ids = self._candidate_shards(start, end)
        candidate_sids = self._candidate_series(metric, tags_filter, shard_ids)

        results: List[QueryResult] = []
        for sid in sorted(candidate_sids):
            meta = self._series[sid]
            # 每个字段独立合并（不同批次写入的字段集合可能不同）。
            per_field: Dict[str, Dict[int, float]] = {}
            available: set[str] = set()
            for shard in shard_ids:
                shard_fields = self._data.get(shard, {}).get(sid)
                if not shard_fields:
                    continue
                tombstones = self._tombstones.get(shard, {}).get(sid, [])
                for field_name, entries in shard_fields.items():
                    available.add(field_name)
                    selected = fields
                    if selected is not None and field_name not in selected:
                        continue
                    alive = [e for e in entries if not e.deleted]
                    if not alive:
                        continue
                    points = self._read_field(alive, start, end, tombstones)
                    if points:
                        per_field.setdefault(field_name, {}).update(points)

            selected_fields = normalize_fields_selection(fields, list(available))
            # 去掉实际无数据的字段后若一个都不剩，该 series 不输出。
            selected_fields = [f for f in selected_fields if per_field.get(f)]
            if not selected_fields:
                continue

            result = QueryResult(
                series_id=sid,
                metric=meta.metric,
                tags=dict(meta.tags),
                agg=agg,
                step=step,
            )
            if agg == "none":
                self._fill_raw(result, selected_fields, per_field)
            elif step is None:
                self._fill_whole_agg(result, selected_fields, per_field, start)
            else:
                self._fill_step_agg(
                    result, selected_fields, per_field, start, end, step, agg
                )
            results.append(result)
        return results

    @staticmethod
    def _validate_query_args(
        metric: Any,
        tags_filter: Any,
        start: Any,
        end: Any,
        fields: Any,
        agg: Any,
        step: Any,
    ) -> None:
        if not isinstance(metric, str) or metric == "":
            raise ValidationError("metric 必须是非空字符串")
        if not isinstance(tags_filter, Mapping):
            raise ValidationError("tags_filter 必须是字典")
        for key, value in tags_filter.items():
            if not isinstance(key, str) or key == "":
                raise ValidationError("tags_filter 的键必须是非空字符串")
            if not isinstance(value, str) or value == "":
                raise ValidationError(f"标签 {key!r} 的过滤值必须是非空字符串（'*' 表示存在）")
        if isinstance(start, bool) or not isinstance(start, int):
            raise ValidationError("start 必须是整数")
        if isinstance(end, bool) or not isinstance(end, int):
            raise ValidationError("end 必须是整数")
        if agg not in _AGGS:
            raise ValidationError(f"agg 必须是 {sorted(_AGGS)} 之一，收到 {agg!r}")
        if fields is not None:
            if not isinstance(fields, (list, tuple)):
                raise ValidationError("fields 必须是字符串列表或 None")
            for name in fields:
                if not isinstance(name, str) or name == "":
                    raise ValidationError("fields 中的字段名必须是非空字符串")
        if step is not None:
            if agg == "none":
                raise ValidationError("step 只能与聚合（agg != 'none'）一起使用")
            if isinstance(step, bool) or not isinstance(step, int) or step <= 0:
                raise ValidationError("step 必须是正整数")

    def _candidate_shards(self, start: int, end: int) -> List[int]:
        """与 [start, end) 相交、且实际存在的 shard，升序。"""
        first = _shard_of(start, self.shard_span)
        last = _shard_of(end - 1, self.shard_span)
        return [s for s in range(first, last + 1) if s in self._data]

    def _candidate_series(
        self,
        metric: str,
        tags_filter: Mapping[str, str],
        shard_ids: Sequence[int],
    ) -> List[str]:
        """先 metric 裁剪，再要求落在候选 shard 中，最后按 tags 过滤。"""
        metric_sids = self._metric_series.get(metric)
        if not metric_sids:
            return []
        in_shards: set[str] = set()
        for shard in shard_ids:
            in_shards.update(self._shard_series.get(shard, ()))
        return [
            sid for sid in metric_sids
            if sid in in_shards
            and not self._series[sid].deleted
            and tags_match(self._series[sid].tags, tags_filter)
        ]

    @staticmethod
    def _read_field(
        entries: Sequence[_BlockEntry],
        start: int,
        end: int,
        tombstones: Sequence[Sequence[int]],
    ) -> Dict[int, float]:
        """合并一个字段在一个 shard 内的多个列块并应用范围删除。

        :returns: ``{ts: value}``，已裁剪到 ``[start, end)``。
        """
        # LWW：按 seq 升序遍历，晚到列块的同 ts 值覆盖早到的。
        winners: Dict[int, Tuple[float, int]] = {}
        for entry in entries:  # 列表即写入顺序
            block = entry.block
            if not block.overlaps(start, end):
                continue
            ts_slice, val_slice = block.read_range(start, end)
            for ts, value in zip(ts_slice, val_slice):
                winners[ts] = (value, entry.seq)
        # 范围删除只删除“删除时刻之前”写入的点（tombstone.seq > 点的 seq）。
        if tombstones:
            alive: Dict[int, float] = {}
            for ts, (value, seq) in winners.items():
                deleted = any(
                    rstart <= ts < rend and del_seq > seq
                    for rstart, rend, del_seq in tombstones
                )
                if not deleted:
                    alive[ts] = value
            return alive
        return {ts: value for ts, (value, _seq) in winners.items()}

    @staticmethod
    def _fill_raw(
        result: QueryResult,
        selected_fields: Sequence[str],
        per_field: Mapping[str, Dict[int, float]],
    ) -> None:
        union_ts = sorted(set().union(*(per_field[f].keys() for f in selected_fields)))
        result.timestamps = union_ts
        result.columns = {
            fname: [per_field[fname].get(ts) for ts in union_ts]
            for fname in selected_fields
        }

    @staticmethod
    def _aggregate(values: Sequence[float], agg: str) -> Optional[float]:
        if not values:
            return None
        if agg == "sum":
            return sum(values)
        if agg == "avg":
            return sum(values) / len(values)
        if agg == "min":
            return min(values)
        if agg == "max":
            return max(values)
        if agg == "count":
            return len(values)
        raise ValidationError(f"未知聚合: {agg}")  # 已在参数校验拦截

    def _fill_whole_agg(
        self,
        result: QueryResult,
        selected_fields: Sequence[str],
        per_field: Mapping[str, Dict[int, float]],
        start: int,
    ) -> None:
        result.timestamps = [start]
        result.step = None
        columns: Dict[str, List[Optional[float]]] = {}
        for fname in selected_fields:
            values = [v for _ts, v in sorted(per_field[fname].items())]
            columns[fname] = [self._aggregate(values, result.agg)]
        result.columns = columns

    def _fill_step_agg(
        self,
        result: QueryResult,
        selected_fields: Sequence[str],
        per_field: Mapping[str, Dict[int, float]],
        start: int,
        end: int,
        step: int,
        agg: str,
    ) -> None:
        # 先求所有字段里出现过数据的桶下标，保证多字段列对齐；空桶不输出。
        buckets: Dict[int, Dict[str, List[float]]] = {}
        for fname in selected_fields:
            for ts, value in per_field[fname].items():
                idx = (ts - start) // step
                if idx < 0:
                    continue
                bucket_start = start + idx * step
                if bucket_start >= end:
                    continue
                buckets.setdefault(idx, {}).setdefault(fname, []).append(value)
        ordered_idx = sorted(buckets)
        result.timestamps = [start + idx * step for idx in ordered_idx]
        result.columns = {
            fname: [
                self._aggregate(buckets[idx].get(fname, ()), agg)
                for idx in ordered_idx
            ]
            for fname in selected_fields
        }

    # ---------------------------------------------------------------- 删除

    def delete_series(self, metric: str, tags: Mapping[str, str]) -> bool:
        """删除一个 series 的全部数据（所有 shard）。

        列块先标记删除、由 :meth:`compact` 物理清理。删除不存在的
        series 时无效果，返回 ``False``。删除后重新 append 同身份数据，
        series 会“复活”（新数据正常可见）。
        """
        sid = self._resolve_series(metric, tags)
        if sid is None:
            return False
        meta = self._series[sid]
        if meta.deleted and not self._has_alive_entries(sid):
            return False
        meta.deleted = True
        for shard_fields in self._data.values():
            by_field = shard_fields.get(sid)
            if not by_field:
                continue
            for entries in by_field.values():
                for entry in entries:
                    entry.deleted = True
        return True

    def delete_range(
        self, metric: str, tags: Mapping[str, str], start: int, end: int
    ) -> bool:
        """删除某 series 在 ``[start, end)`` 内的数据。

        记录范围删除标记（带 seq），被范围完全覆盖的现有列块直接标记
        删除；部分覆盖的列块保留，读取时过滤，等待 :meth:`compact` 重写。
        ``start >= end`` 为 no-op。series 不存在时无效果。
        """
        if isinstance(start, bool) or not isinstance(start, int):
            raise ValidationError("start 必须是整数")
        if isinstance(end, bool) or not isinstance(end, int):
            raise ValidationError("end 必须是整数")
        sid = self._resolve_series(metric, tags)
        if sid is None or start >= end:
            return False

        del_seq = self._next_seq
        self._next_seq += 1
        changed = False
        first_shard = _shard_of(start, self.shard_span)
        last_shard = _shard_of(end - 1, self.shard_span)
        for shard in range(first_shard, last_shard + 1):
            shard_fields = self._data.get(shard, {}).get(sid)
            if not shard_fields:
                continue
            # 删除标记按 shard 裁剪后保存。
            shard_lo = shard * self.shard_span
            shard_hi = shard_lo + self.shard_span
            clipped_start = max(start, shard_lo)
            clipped_end = min(end, shard_hi)
            shard_tomb = self._tombstones.setdefault(shard, {}).setdefault(sid, [])
            self._add_tombstone(shard_tomb, clipped_start, clipped_end, del_seq)
            for entries in shard_fields.values():
                for entry in entries:
                    if entry.deleted:
                        continue
                    if entry.block.min_ts >= clipped_start and entry.block.max_ts < clipped_end:
                        entry.deleted = True
                        changed = True
            changed = True
        return changed

    @staticmethod
    def _add_tombstone(
        ranges: List[List[int]], start: int, end: int, seq: int
    ) -> None:
        """加入一条范围删除标记并合并重叠/相邻区间（seq 取较大者）。"""
        ranges.append([start, end, seq])
        ranges.sort(key=lambda r: (r[0], r[1]))
        merged: List[List[int]] = []
        for r in ranges:
            if merged and r[0] <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], r[1])
                merged[-1][2] = max(merged[-1][2], r[2])
            else:
                merged.append(list(r))
        ranges[:] = merged

    def _resolve_series(
        self, metric: Any, tags: Any
    ) -> Optional[str]:
        """校验 metric/tags 参数并解析 sid；不存在返回 None。"""
        if not isinstance(metric, str) or metric == "":
            raise ValidationError("metric 必须是非空字符串")
        if not isinstance(tags, Mapping):
            raise ValidationError("tags 必须是字符串到字符串的字典")
        clean_tags: Dict[str, str] = {}
        for key, value in tags.items():
            if not isinstance(key, str) or key == "":
                raise ValidationError("tags 的键必须是非空字符串")
            if not isinstance(value, str) or value == "":
                raise ValidationError(f"标签 {key!r} 的值必须是非空字符串")
            clean_tags[key] = value
        sid = compute_series_id(metric, clean_tags)
        if sid not in self._series:
            return None
        return sid

    def _has_alive_entries(self, sid: str) -> bool:
        for shard_fields in self._data.values():
            by_field = shard_fields.get(sid)
            if by_field and any(
                not e.deleted for entries in by_field.values() for e in entries
            ):
                return True
        return False

    # ---------------------------------------------------------------- compact

    def compact(self) -> Dict[str, int]:
        """物理清理：重写所有存活列块，应用 LWW 与删除标记，回收空间。

        * 被删 series / 被删列块 / 被删时间点真正从新列块中消失；
        * 同一 (shard, series, field) 的多个列块（乱序回填产物）合并，
          超过 ``block_size`` 时重新切块；
        * 清理空 shard、空索引；重写后范围删除标记被物化并清除。

        返回一个小统计：重写了多少列块、释放了多少字节。
        """
        rewritten = 0
        bytes_before = self.stats()["compressed_bytes"]

        dead_sids = [sid for sid, meta in self._series.items() if meta.deleted]
        for sid in dead_sids:
            self._remove_series_everywhere(sid)

        for shard in list(self._data.keys()):
            for sid in list(self._data[shard].keys()):
                for field_name, entries in list(self._data[shard][sid].items()):
                    new_entries = self._rewrite_entries(shard, sid, field_name, entries)
                    if new_entries:
                        self._data[shard][sid][field_name] = new_entries
                        rewritten += len(new_entries)
                    else:
                        del self._data[shard][sid][field_name]
                if not self._data[shard][sid]:
                    del self._data[shard][sid]
                    self._shard_series[shard].discard(sid)
                    self._tombstones.get(shard, {}).pop(sid, None)
            if not self._data[shard]:
                del self._data[shard]
                self._shard_series.pop(shard, None)
                self._tombstones.pop(shard, None)
            elif shard in self._tombstones:
                # 存活 series 的删除效果已物化到新列块，标记不再需要。
                for sid in list(self._tombstones[shard].keys()):
                    if sid in self._data[shard]:
                        del self._tombstones[shard][sid]
                if not self._tombstones[shard]:
                    del self._tombstones[shard]

        bytes_after = self.stats()["compressed_bytes"]
        return {
            "rewritten_blocks": rewritten,
            "reclaimed_bytes": max(0, bytes_before - bytes_after),
        }

    def _remove_series_everywhere(self, sid: str) -> None:
        meta = self._series.pop(sid)
        self._metric_series.get(meta.metric, set()).discard(sid)
        if meta.metric in self._metric_series and not self._metric_series[meta.metric]:
            del self._metric_series[meta.metric]
        for shard, shard_series in list(self._shard_series.items()):
            shard_series.discard(sid)
        for shard in list(self._data.keys()):
            self._data[shard].pop(sid, None)
            self._tombstones.get(shard, {}).pop(sid, None)

    def _rewrite_entries(
        self,
        shard: int,
        sid: str,
        field_name: str,
        entries: Sequence[_BlockEntry],
    ) -> List[_BlockEntry]:
        """把一个字段的列块列表重写成 0..N 个新列块。"""
        alive = [e for e in entries if not e.deleted]
        if not alive:
            return []
        alive.sort(key=lambda e: e.seq)
        tombstones = self._tombstones.get(shard, {}).get(sid, [])
        shard_lo = shard * self.shard_span
        shard_hi = shard_lo + self.shard_span

        winners: Dict[int, Tuple[float, int]] = {}
        for entry in alive:
            ts_list, val_list = entry.block.read_range(shard_lo, shard_hi)
            for ts, value in zip(ts_list, val_list):
                winners[ts] = (value, entry.seq)
        points: Dict[int, float] = {}
        for ts, (value, seq) in winners.items():
            deleted = any(
                rstart <= ts < rend and del_seq > seq
                for rstart, rend, del_seq in tombstones
            )
            if not deleted:
                points[ts] = value
        if not points:
            return []

        timestamps = sorted(points)
        new_entries: List[_BlockEntry] = []
        for i in range(0, len(timestamps), self.block_size):
            chunk_ts = timestamps[i : i + self.block_size]
            chunk_vals = [points[t] for t in chunk_ts]
            block = ColumnBlock.from_points(sid, field_name, chunk_ts, chunk_vals)
            new_entries.append(_BlockEntry(
                block=block,
                entry_id=self._next_block_id,
                seq=self._next_seq,
            ))
            self._next_block_id += 1
            self._next_seq += 1
        return new_entries

    # ---------------------------------------------------------------- 统计

    def stats(self) -> Dict[str, int]:
        """返回存储统计。

        键：``shards``（shard 数）、``series``（存活 series 数）、
        ``blocks``（存活列块数）、``total_points``（存活点数）、
        ``compressed_bytes``（存活列块字节数）、``dead_series``、
        ``dead_blocks``、``dead_bytes``、``range_tombstones``。
        """
        blocks = 0
        points_total = 0
        bytes_total = 0
        dead_blocks = 0
        dead_bytes = 0
        for shard_fields in self._data.values():
            for by_field in shard_fields.values():
                for entries in by_field.values():
                    for entry in entries:
                        if entry.deleted:
                            dead_blocks += 1
                            dead_bytes += entry.block.size_bytes()
                        else:
                            blocks += 1
                            points_total += entry.block.count
                            bytes_total += entry.block.size_bytes()
        tombs = sum(len(v) for by_sid in self._tombstones.values() for v in by_sid.values())
        return {
            "shards": len(self._data),
            "series": sum(1 for meta in self._series.values() if not meta.deleted),
            "blocks": blocks,
            "total_points": points_total,
            "compressed_bytes": bytes_total,
            "dead_series": sum(1 for meta in self._series.values() if meta.deleted),
            "dead_blocks": dead_blocks,
            "dead_bytes": dead_bytes,
            "range_tombstones": tombs,
        }

    # ---------------------------------------------------------------- 快照

    def save(self, dir_path: str) -> None:
        """把元信息、列块、删除标记写入目录（清单 + blocks/ 列块文件）。

        目录不存在会创建；已存在则增量覆盖。写入成功后会清理目录中
        不再被清单引用的旧 ``blocks/*.blk`` 文件。
        """
        if not isinstance(dir_path, str) or dir_path == "":
            raise ValidationError("dir_path 必须是非空字符串")
        os.makedirs(os.path.join(dir_path, BLOCKS_DIR), exist_ok=True)

        manifest = self._build_manifest()
        referenced: set[str] = set()
        for shard_entry in manifest["shards"].values():
            for by_field in shard_entry.values():
                for entries in by_field.values():
                    for e in entries:
                        referenced.add(e["file"])
                        target = os.path.join(dir_path, e["file"])
                        tmp = target + ".tmp"
                        with open(tmp, "wb") as f:
                            f.write(e.pop("_payload"))
                        os.replace(tmp, target)

        manifest_path = os.path.join(dir_path, MANIFEST_NAME)
        tmp_manifest = manifest_path + ".tmp"
        with open(tmp_manifest, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2, sort_keys=True)
        os.replace(tmp_manifest, manifest_path)

        blocks_dir = os.path.join(dir_path, BLOCKS_DIR)
        for name in os.listdir(blocks_dir):
            if name.endswith(".blk") and f"{BLOCKS_DIR}/{name}" not in referenced:
                os.remove(os.path.join(blocks_dir, name))

    def _build_manifest(self) -> Dict[str, Any]:
        shards_manifest: Dict[str, Any] = {}
        for shard, shard_fields in self._data.items():
            sm: Dict[str, Any] = {}
            for sid, by_field in shard_fields.items():
                fm: Dict[str, Any] = {}
                for field_name, entries in by_field.items():
                    entry_list = []
                    for entry in entries:
                        b = entry.block
                        entry_list.append({
                            "id": entry.entry_id,
                            "seq": entry.seq,
                            "deleted": entry.deleted,
                            "file": f"{BLOCKS_DIR}/{entry.file_name}",
                            "enc_ts": b.enc_ts,
                            "enc_value": b.enc_value,
                            "min_ts": b.min_ts,
                            "max_ts": b.max_ts,
                            "count": b.count,
                            "size": b.size_bytes(),
                            "_payload": b.to_bytes(),
                        })
                    fm[field_name] = entry_list
                sm[sid] = fm
            shards_manifest[str(shard)] = sm

        tombs_manifest = {
            str(shard): {sid: [list(r) for r in ranges]
                         for sid, ranges in by_sid.items()}
            for shard, by_sid in self._tombstones.items()
        }
        return {
            "format": _FORMAT,
            "version": _FORMAT_VERSION,
            "shard_span": self.shard_span,
            "block_size": self.block_size,
            "next_block_id": self._next_block_id,
            "next_seq": self._next_seq,
            "series": [
                {
                    "series_id": meta.series_id,
                    "metric": meta.metric,
                    "tags": meta.tags,
                    "deleted": meta.deleted,
                }
                for meta in sorted(self._series.values(), key=lambda m: m.series_id)
            ],
            "shard_series": {
                str(shard): sorted(sids)
                for shard, sids in self._shard_series.items()
            },
            "shards": shards_manifest,
            "tombstones": tombs_manifest,
        }

    def load(self, dir_path: str) -> None:
        """从目录重建内存状态，并做严格一致性校验。

        任何文件缺失、JSON 损坏、引用失效、哈希不符、min/max 矛盾、
        编码未知、CRC 失败都会抛 :class:`~tsdb.errors.CorruptionError`。
        """
        if not isinstance(dir_path, str) or dir_path == "":
            raise ValidationError("dir_path 必须是非空字符串")
        manifest_path = os.path.join(dir_path, MANIFEST_NAME)
        if not os.path.isfile(manifest_path):
            raise CorruptionError(f"清单文件不存在: {manifest_path}")
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except json.JSONDecodeError as exc:
            raise CorruptionError(f"清单不是合法 JSON: {exc}") from None
        except OSError as exc:
            raise CorruptionError(f"清单读取失败: {exc}") from exc

        fresh = ColumnarTSDB.__new__(ColumnarTSDB)
        try:
            fresh._load_manifest(manifest, dir_path)
        except CorruptionError:
            raise
        except BlockFormatError as exc:
            # 列块自身的魔数/版本/CRC/长度问题在快照场景下一律视为存储损坏。
            raise CorruptionError(f"列块损坏: {exc}") from exc
        except (KeyError, TypeError, ValueError) as exc:
            raise CorruptionError(f"清单字段缺失或类型错误: {exc}") from exc
        # 加载成功才替换当前实例状态。
        self.__dict__.update(fresh.__dict__)

    def _load_manifest(self, manifest: Any, dir_path: str) -> None:
        if not isinstance(manifest, dict):
            raise CorruptionError("清单根节点必须是 JSON 对象")
        for key in ("format", "version", "shard_span", "block_size",
                    "next_block_id", "next_seq", "series", "shards",
                    "tombstones", "shard_series"):
            if key not in manifest:
                raise CorruptionError(f"清单缺少必需字段: {key!r}")
        if manifest["format"] != _FORMAT:
            raise CorruptionError(f"清单格式标识错误: {manifest['format']!r}")
        if manifest["version"] != _FORMAT_VERSION:
            raise CorruptionError(f"不支持的清单版本: {manifest['version']!r}")
        span = manifest["shard_span"]
        block_size = manifest["block_size"]
        if not isinstance(span, int) or isinstance(span, bool) or span <= 0:
            raise CorruptionError("清单中 shard_span 非法")
        if not isinstance(block_size, int) or isinstance(block_size, bool) or block_size <= 0:
            raise CorruptionError("清单中 block_size 非法")

        self.shard_span = span
        self.block_size = block_size
        self._series = {}
        self._data = {}
        self._shard_series = {}
        self._metric_series = {}
        self._tombstones = {}
        self._next_block_id = manifest["next_block_id"]
        self._next_seq = manifest["next_seq"]
        if not isinstance(self._next_block_id, int) or not isinstance(self._next_seq, int):
            raise CorruptionError("清单中 id/seq 计数器非法")
        if self._next_block_id < 1 or self._next_seq < 1:
            raise CorruptionError("清单中 id/seq 计数器必须为正整数")

        # ---- series 元信息：series_id 必须可由 metric/tags 重新算出 ----
        if not isinstance(manifest["series"], list):
            raise CorruptionError("清单 series 段必须是列表")
        for item in manifest["series"]:
            for key in ("series_id", "metric", "tags", "deleted"):
                if key not in item:
                    raise CorruptionError(f"series 记录缺少字段 {key!r}")
            metric, tags, sid = item["metric"], item["tags"], item["series_id"]
            if not isinstance(sid, str) or sid == "":
                raise CorruptionError("series_id 必须是非空字符串")
            if sid in self._series:
                raise CorruptionError(f"series_id 在清单中重复出现: {sid}")
            if not isinstance(metric, str) or metric == "":
                raise CorruptionError(f"series {sid}: metric 非法")
            if not isinstance(tags, dict) or any(
                not isinstance(k, str) or not isinstance(v, str) or not k or not v
                for k, v in tags.items()
            ):
                raise CorruptionError(f"series {sid}: tags 非法")
            recomputed = compute_series_id(metric, tags)
            if recomputed != sid:
                raise CorruptionError(
                    f"series {sid}: series_id 与 metric/tags 重新计算的结果 {recomputed} 不一致"
                )
            if not isinstance(item["deleted"], bool):
                raise CorruptionError(f"series {sid}: deleted 标记必须是布尔值")
            meta = _SeriesMeta(sid, metric, dict(tags), item["deleted"])
            self._series[sid] = meta
            if not meta.deleted:
                self._metric_series.setdefault(metric, set()).add(sid)

        # ---- 列块：文件必须存在、CRC/头部通过、与清单记录一致 ----
        if not isinstance(manifest["shards"], dict):
            raise CorruptionError("清单 shards 段必须是对象")
        seen_block_ids: set[int] = set()
        for shard_key, shard_entry in manifest["shards"].items():
            try:
                shard = int(shard_key)
            except ValueError:
                raise CorruptionError(f"shard 下标非法: {shard_key!r}") from None
            if not isinstance(shard_entry, dict):
                raise CorruptionError(f"shard {shard}: 内容必须是对象")
            shard_bucket = self._data.setdefault(shard, {})
            for sid, by_field in shard_entry.items():
                if sid not in self._series:
                    raise CorruptionError(f"shard {shard}: 列块引用了未登记的 series {sid}")
                if not isinstance(by_field, dict):
                    raise CorruptionError(f"shard {shard} series {sid}: 字段段必须是对象")
                field_bucket = shard_bucket.setdefault(sid, {})
                for field_name, entry_list in by_field.items():
                    if not isinstance(field_name, str) or field_name == "":
                        raise CorruptionError("字段名必须是非空字符串")
                    if not isinstance(entry_list, list):
                        raise CorruptionError(
                            f"shard {shard} series {sid} field {field_name}: 列块列表非法"
                        )
                    entries: List[_BlockEntry] = []
                    for record in entry_list:
                        entry = self._load_block_record(
                            record, dir_path, shard, sid, field_name
                        )
                        if entry.entry_id in seen_block_ids:
                            raise CorruptionError(
                                f"列块 id {entry.entry_id} 在清单中重复出现"
                            )
                        seen_block_ids.add(entry.entry_id)
                        entries.append(entry)
                    entries.sort(key=lambda e: e.seq)
                    field_bucket[field_name] = entries

        # shard_series 索引：以清单为准，但校验与实际列块一致。
        if not isinstance(manifest["shard_series"], dict):
            raise CorruptionError("清单 shard_series 段必须是对象")
        for shard_key, sids in manifest["shard_series"].items():
            try:
                shard = int(shard_key)
            except ValueError:
                raise CorruptionError(f"shard_series 下标非法: {shard_key!r}") from None
            if not isinstance(sids, list):
                raise CorruptionError(f"shard_series {shard}: 必须是 sid 列表")
            for sid in sids:
                if sid not in self._series:
                    raise CorruptionError(
                        f"shard_series {shard}: 引用了未登记的 series {sid}"
                    )
            self._shard_series[shard] = set(sids)
        for shard, shard_bucket in self._data.items():
            actual = set(shard_bucket.keys())
            indexed = self._shard_series.get(shard, set())
            if actual != indexed:
                raise CorruptionError(
                    f"shard {shard}: shard_series 索引与实际列块不一致 "
                    f"(差集: {actual.symmetric_difference(indexed)})"
                )

        # ---- 范围删除标记 ----
        if not isinstance(manifest["tombstones"], dict):
            raise CorruptionError("清单 tombstones 段必须是对象")
        for shard_key, by_sid in manifest["tombstones"].items():
            try:
                shard = int(shard_key)
            except ValueError:
                raise CorruptionError(f"tombstone shard 下标非法: {shard_key!r}") from None
            if not isinstance(by_sid, dict):
                raise CorruptionError(f"tombstone shard {shard}: 内容必须是对象")
            bucket = self._tombstones.setdefault(shard, {})
            for sid, ranges in by_sid.items():
                if sid not in self._series:
                    raise CorruptionError(f"tombstone 引用了未登记的 series {sid}")
                clean: List[List[int]] = []
                for r in ranges:
                    if (not isinstance(r, list) or len(r) != 3
                            or any(not isinstance(x, int) or isinstance(x, bool) for x in r)):
                        raise CorruptionError(f"tombstone 记录非法: {r!r}")
                    if r[0] >= r[1]:
                        raise CorruptionError(f"tombstone 区间非正: {r!r}")
                    clean.append([r[0], r[1], r[2]])
                bucket[sid] = clean

    def _load_block_record(
        self, record: Any, dir_path: str, shard: int, sid: str, field_name: str
    ) -> _BlockEntry:
        if not isinstance(record, dict):
            raise CorruptionError("列块清单记录必须是对象")
        for key in ("id", "seq", "deleted", "file", "enc_ts", "enc_value",
                    "min_ts", "max_ts", "count", "size"):
            if key not in record:
                raise CorruptionError(f"列块记录缺少字段 {key!r}")
        file_rel = record["file"]
        block_path = os.path.join(dir_path, file_rel)
        if not os.path.isfile(block_path):
            raise CorruptionError(f"清单引用的列块文件不存在: {file_rel}")
        try:
            with open(block_path, "rb") as f:
                raw = f.read()
        except OSError as exc:
            raise CorruptionError(f"列块文件读取失败 {file_rel}: {exc}") from exc
        block = ColumnBlock.from_bytes(sid, field_name, raw)  # CRC/魔数/版本/长度校验
        if block.enc_ts != record["enc_ts"] or block.enc_value != record["enc_value"]:
            raise CorruptionError(f"{file_rel}: 编码方式与清单记录不一致")
        if block.min_ts != record["min_ts"] or block.max_ts != record["max_ts"]:
            raise CorruptionError(f"{file_rel}: min_ts/max_ts 与清单记录不一致")
        if block.count != record["count"]:
            raise CorruptionError(f"{file_rel}: 点数与清单记录不一致")
        if block.size_bytes() != record["size"] or block.size_bytes() != len(raw):
            raise CorruptionError(f"{file_rel}: 字节数与清单记录不一致")
        if block.min_ts > block.max_ts:  # 双保险，block 解析时已查一次
            raise CorruptionError(f"{file_rel}: min_ts > max_ts")
        shard_lo = shard * self.shard_span
        shard_hi = shard_lo + self.shard_span
        if not (shard_lo <= block.min_ts <= block.max_ts < shard_hi):
            raise CorruptionError(
                f"{file_rel}: 时间范围 [{block.min_ts}, {block.max_ts}] 不属于 shard {shard}"
            )
        entry_id, seq = record["id"], record["seq"]
        if (not isinstance(entry_id, int) or isinstance(entry_id, bool)
                or not isinstance(seq, int) or isinstance(seq, bool)):
            raise CorruptionError(f"{file_rel}: id/seq 必须是整数")
        if entry_id < 1 or seq < 1:
            raise CorruptionError(f"{file_rel}: id/seq 必须为正整数")
        if not isinstance(record["deleted"], bool):
            raise CorruptionError(f"{file_rel}: deleted 必须是布尔值")
        return _BlockEntry(block, entry_id, seq, record["deleted"])

    # ---------------------------------------------------------------- 调试

    def dump(self) -> Dict[str, Any]:
        """输出内存布局的机器可读摘要（CLI ``dump`` 命令使用）。"""
        manifest = self._build_manifest()
        for shard_entry in manifest["shards"].values():
            for by_field in shard_entry.values():
                for entries in by_field.values():
                    for e in entries:
                        e.pop("_payload", None)
        return manifest
