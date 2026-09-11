"""可嵌入的流式集合成员判定与集合运算内核。

核心是一个 *分片式布隆过滤器*：每个 ``tag``（来源分片）拥有独立的
位数组（``bytearray``）与哈希配置，互相隔离、便于排查。哈希由
:func:`hashlib.sha256` 以双散列增强（Kirsch-Mitzenmacher 技巧）派生，
全程只依赖 Python 标准库，结果可离线复现。

典型用法::

    kernel = BloomKernel(default_m=1 << 20, default_k=7, max_bits=4 << 20)
    kernel.insert(Item(key="user-42", tag="shard-a", seq=1))
    assert kernel.contains("shard-a", "user-42")
    print(kernel.stats()["shard-a"])
    kernel.save("state.json")

另提供 :class:`ExactKernel`，用 ``set`` 保存全部 key，语义完全精确，
适合小规模对照测试。两者实现同一接口（鸭子类型即可互换）。
"""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Dict, Iterable, List, Optional, Union

__all__ = [
    "Item",
    "BloomKernel",
    "ExactKernel",
    "KernelError",
    "ValidationError",
    "CapacityError",
    "PersistenceError",
    "TAG_PATTERN",
    "MAX_KEY_BYTES",
    "DEFAULT_M",
    "DEFAULT_K",
]

#: key 的 UTF-8 编码长度上限（字节）。
MAX_KEY_BYTES = 256

#: 默认位数组长度（位），2^20 ≈ 128 KiB/tag。
DEFAULT_M = 1 << 20

#: 默认哈希函数个数。
DEFAULT_K = 7

# tag 只允许字母数字、下划线、连字符、点、斜杠，避免持久化/命令行里
# 出现奇怪的键名；纯空串当然也被拒绝。
TAG_PATTERN = re.compile(r"[A-Za-z0-9_./-]+")

# JSON 快照格式版本，load 时校验，方便以后演进。
_FORMAT_VERSION = 1


class KernelError(Exception):
    """内核相关错误的基类。"""


class ValidationError(KernelError, ValueError):
    """输入不合法（空 key/tag、seq<1、字节超长、配置非法等）。"""


class CapacityError(KernelError):
    """插入会突破 ``max_bits`` 上限时抛出；本次插入被整体拒绝。"""


class PersistenceError(KernelError):
    """快照文件损坏、字段缺失或一致性校验失败。"""


@dataclass(frozen=True)
class Item:
    """一条上游推来的标识记录。

    :param key: 非空字符串，UTF-8 编码后不超过 :data:`MAX_KEY_BYTES` 字节。
    :param tag: 非空字符串，来源分片名；建议只用 ``[A-Za-z0-9_./-]``。
    :param seq: 同一 tag 内从 1 开始单调递增的整数。

    三个字段在创建时即做校验，不合法抛 :class:`ValidationError`。
    ``frozen=True`` 保证记录可哈希、不可被意外篡改。
    """

    key: str
    tag: str
    seq: int

    def __post_init__(self) -> None:
        # 注意 bool 是 int 的子类，显式挡掉 True/False 这种“整数”。
        if not isinstance(self.key, str):
            raise ValidationError(f"key 必须是字符串，实际类型: {type(self.key).__name__}")
        if not self.key:
            raise ValidationError("key 不能为空字符串")
        key_len = len(self.key.encode("utf-8"))
        if key_len > MAX_KEY_BYTES:
            raise ValidationError(
                f"key 的 UTF-8 编码为 {key_len} 字节，超过上限 {MAX_KEY_BYTES} 字节"
            )

        if not isinstance(self.tag, str):
            raise ValidationError(f"tag 必须是字符串，实际类型: {type(self.tag).__name__}")
        if not self.tag:
            raise ValidationError("tag 不能为空字符串")
        if not TAG_PATTERN.fullmatch(self.tag):
            raise ValidationError(
                f"tag 只能包含字母数字与 _ . / -，实际为: {self.tag!r}"
            )

        if isinstance(self.seq, bool) or not isinstance(self.seq, int):
            raise ValidationError(f"seq 必须是整数，实际类型: {type(self.seq).__name__}")
        if self.seq < 1:
            raise ValidationError(f"seq 必须 >= 1，实际为: {self.seq}")


def _bit_indices(key: str, m: int, k: int) -> List[int]:
    """计算 ``key`` 在长度 ``m`` 的位数组上的 ``k`` 个散列位置。

    用一次 ``sha256`` 得到两个 64 比特散列值 h1、h2，再用
    Kirsch-Mitzenmacher 双散列公式 ``h_i = h1 + i*h2 (mod m)``
    派生出 k 个位置。对任意 ``m >= 1``、``k >= 1`` 均成立；
    相同输入永远得到相同位置（离线可复现）。
    """

    raw = key.encode("utf-8")
    digest = sha256(raw).digest()
    h1 = int.from_bytes(digest[:8], "big")
    h2 = int.from_bytes(digest[8:16], "big")
    # h2 若为 0，k 个位置会全部相同，退化而影响精度；用摘要后半段兜底。
    if h2 == 0:
        h2 = int.from_bytes(digest[16:24], "big") or 1
    return [(h1 + i * h2) % m for i in range(k)]


def _validate_m(m: int, name: str = "m") -> int:
    if isinstance(m, bool) or not isinstance(m, int):
        raise ValidationError(f"{name} 必须是正整数，实际类型: {type(m).__name__}")
    if m < 1:
        raise ValidationError(f"{name} 必须 >= 1（位数组至少 1 位），实际为: {m}")
    return m


def _validate_k(k: int) -> int:
    if isinstance(k, bool) or not isinstance(k, int):
        raise ValidationError(f"k 必须是正整数，实际类型: {type(k).__name__}")
    if k < 1:
        raise ValidationError(f"k 必须 >= 1（至少 1 个哈希），实际为: {k}")
    return k


def _validate_max_bits(max_bits: int) -> int:
    if isinstance(max_bits, bool) or not isinstance(max_bits, int):
        raise ValidationError(
            f"max_bits 必须是非负整数，实际类型: {type(max_bits).__name__}"
        )
    if max_bits < 0:
        raise ValidationError(f"max_bits 必须 >= 0，实际为: {max_bits}")
    return max_bits


@dataclass
class _Shard:
    """单个 tag 的内部状态：位数组 + 配置 + 计数。"""

    bits: bytearray
    m: int
    k: int
    inserted: int  # 插入尝试次数（含重复 key）
    distinct: int  # 去重后的不同 key 数（布隆结构无法自证，按新增计数）
    keys: Optional[set] = None  # 仅 track_keys=True 时存在：精确 key 集合

    @property
    def nbytes(self) -> int:
        return len(self.bits)


class BloomKernel:
    """分片式布隆过滤器内核。

    :param default_m: 新 tag 自动建片时使用的位数组长度（位），默认 2^20。
    :param default_k: 哈希函数个数，默认 7。
    :param max_bits: 所有 tag 位数组总位数的硬上限（位）；``None`` 表示
        不限，``0`` 表示不允许任何插入。新 tag 的首次插入若需要的位数组
        会使总量超过上限，整次插入被拒绝并抛 :class:`CapacityError`，
        内核状态保持不变（不会建出半个分片，也不会静默丢弃）。
    :param track_keys: 是否在位数组之外额外用 ``set`` 精确保存每个 key。
        开启后：插入的新增判定、``distinct`` 计数与基数估算变为精确；
        若参与集合运算的 **两个内核都开启** 跟踪，``union`` /
        ``intersect`` / ``difference`` 的结果也基于精确集合重新散列，
        交集/差集零假阳性、零假阴性。代价是内存随不同 key 数线性增长，
        快照中也会包含全部 key。默认关闭（纯布隆模式）。
    """

    def __init__(
        self,
        default_m: int = DEFAULT_M,
        default_k: int = DEFAULT_K,
        max_bits: Optional[int] = None,
        track_keys: bool = False,
    ) -> None:
        self._default_m = _validate_m(default_m, "default_m")
        self._default_k = _validate_k(default_k)
        self._max_bits: Optional[int] = (
            None if max_bits is None else _validate_max_bits(max_bits)
        )
        self._track_keys = bool(track_keys)
        self._shards: Dict[str, _Shard] = {}

    # ------------------------------------------------------------------ #
    # 基础属性
    # ------------------------------------------------------------------ #

    @property
    def default_m(self) -> int:
        return self._default_m

    @property
    def default_k(self) -> int:
        return self._default_k

    @property
    def max_bits(self) -> Optional[int]:
        return self._max_bits

    @property
    def track_keys(self) -> bool:
        return self._track_keys

    @property
    def total_bits(self) -> int:
        """所有已建分片的位数组位数之和。"""
        return sum(s.m for s in self._shards.values())

    def tags(self) -> List[str]:
        """当前存在的 tag 列表（按首次出现顺序）。"""
        return list(self._shards.keys())

    # ------------------------------------------------------------------ #
    # 插入与成员判定
    # ------------------------------------------------------------------ #

    def insert(self, item: Item) -> bool:
        """插入一条记录。

        :returns: ``True`` 表示该 key 在此 tag 下首次出现（至少有一个
            新位被置 1）；``False`` 表示重复插入，幂等无副作用。
        :raises CapacityError: 新分片会突破 ``max_bits``。
        """

        if not isinstance(item, Item):
            raise ValidationError(
                f"insert 需要 Item 实例，实际类型: {type(item).__name__}"
            )
        shard = self._shards.get(item.tag)
        if shard is None:
            # 先做容量判定再建分片：失败时内核完全不变。
            if self._max_bits is not None:
                if self.total_bits + self._default_m > self._max_bits:
                    raise CapacityError(
                        f"拒绝插入: 为 tag {item.tag!r} 新建 {self._default_m} 位的分片"
                        f"会使总位数 {self.total_bits + self._default_m} 超过上限 "
                        f"{self._max_bits}（当前已用 {self.total_bits} 位）"
                    )
            shard = _Shard(
                bits=bytearray((self._default_m + 7) // 8),
                m=self._default_m,
                k=self._default_k,
                inserted=0,
                distinct=0,
                keys=set() if self._track_keys else None,
            )
            self._shards[item.tag] = shard

        # 精确跟踪模式下用 set 判定新增，杜绝“位全部被别人覆盖”导致的
        # 假重复；纯布隆模式退回位级判定。
        if shard.keys is not None:
            newly_set = item.key not in shard.keys
            if newly_set:
                shard.keys.add(item.key)
        else:
            newly_set = False

        for idx in _bit_indices(item.key, shard.m, shard.k):
            byte, bit = divmod(idx, 8)
            mask = 1 << bit
            if not (shard.bits[byte] & mask):
                shard.bits[byte] |= mask
                newly_set = True
        shard.inserted += 1
        if newly_set:
            shard.distinct += 1
        return newly_set

    def insert_many(self, items: Iterable[Item]) -> int:
        """批量插入，返回首次出现（产生新置位）的记录条数。"""
        return sum(1 for item in items if self.insert(item))

    def contains(self, tag: str, key: str) -> bool:
        """判定 ``key`` 是否 *可能* 在 ``tag`` 下出现过。

        布隆过滤器语义：不存在假阴性（插过必返回 ``True``），
        可能有假阳性（没插过也可能返回 ``True``）。
        未知 tag 一律返回 ``False``（空过滤器不含任何元素）。
        """

        shard = self._shards.get(tag)
        if shard is None:
            return False
        for idx in _bit_indices(key, shard.m, shard.k):
            byte, bit = divmod(idx, 8)
            if not (shard.bits[byte] & (1 << bit)):
                return False
        return True

    def __contains__(self, item: Item) -> bool:
        return self.contains(item.tag, item.key)

    # ------------------------------------------------------------------ #
    # 精度指标
    # ------------------------------------------------------------------ #

    def set_bits(self, tag: str) -> int:
        """返回指定 tag 已置 1 的位数；未知 tag 抛 :class:`ValidationError`。"""
        return self._set_bits(self._require_shard(tag))

    def fill_ratio(self, tag: str) -> float:
        """填充率（已置位数 / 位数组长度），区间 [0, 1]。"""
        shard = self._require_shard(tag)
        return self._set_bits(shard) / shard.m

    def false_positive_rate(self, tag: str) -> float:
        """当前填充率下的理论假阳性率估算：``fill_ratio ** k``。

        这是基于“k 个散列位置近似独立、当前置位比例即单点为 1 的
        概率”的估计；与经典公式 ``(1-e^{-kn/m})^k`` 一致（用实际
        填充率替换期望值）。
        """

        shard = self._require_shard(tag)
        return (self._set_bits(shard) / shard.m) ** shard.k

    def estimate_cardinality(self, tag: str) -> int:
        """用填充率反推不同 key 数量的极大似然估计，四舍五入为非负整数。

        公式：``n ≈ -m/k * ln(1 - X/m)``，其中 X 为已置位数。
        全满（X=m）时无法反推，返回 ``distinct`` 计数作为下界兜底。
        """

        shard = self._require_shard(tag)
        if shard.keys is not None:
            return len(shard.keys)  # 精确跟踪模式：没有估算误差
        x = self._set_bits(shard)
        if x == 0:
            return 0
        if x >= shard.m:
            return shard.distinct
        est = -(shard.m / shard.k) * math.log1p(-x / shard.m)
        return max(0, int(round(est)))

    def inserted_count(self, tag: str) -> int:
        """该 tag 的插入尝试总次数（含重复 key）。"""
        return self._require_shard(tag).inserted

    def stats(self) -> Dict[str, Dict[str, Any]]:
        """返回每个 tag 的可观测指标。

        字段：``m``（位数组长度）、``k``（哈希个数）、``set_bits``、
        ``fill_ratio``、``false_positive_rate``、``inserted``（插入次数）、
        ``distinct``（去重计数）、``estimated_cardinality``、
        ``memory_bytes``（位数组裸内存估算，按字节取整）。
        """

        result: Dict[str, Dict[str, Any]] = {}
        for tag, shard in self._shards.items():
            x = self._set_bits(shard)
            fill = x / shard.m
            result[tag] = {
                "m": shard.m,
                "k": shard.k,
                "set_bits": x,
                "fill_ratio": fill,
                "false_positive_rate": fill ** shard.k,
                "inserted": shard.inserted,
                "distinct": shard.distinct,
                "estimated_cardinality": self.estimate_cardinality(tag),
                "memory_bytes": shard.nbytes,
                # track_keys 开启时给出精确 key 数（等于 distinct），否则 null
                "tracked_keys": len(shard.keys) if shard.keys is not None else None,
            }
        return result

    # ------------------------------------------------------------------ #
    # 集合运算（基于位数组，不修改原内核）
    # ------------------------------------------------------------------ #

    def _combine(self, other: "BloomKernel", op: str) -> "BloomKernel":
        """按位/按集合运算的公共实现。

        * 两个内核都开启 ``track_keys`` 时走 **精确路径**：结果集合由
          精确 key 集合运算得到，再重新散列入新位图，交集/差集对真实
          成员零假阴性、且不引入新假阳性（满足验收的强语义）。
        * 否则走 **位图路径**：直接 ``|`` / ``&`` / ``& ~``。并集与
          交集对真实成员保证无假阴性；注意朴素位图差集 ``A & ~B``
          对“仅在 A 中”的成员可能产生假阴性（其散列位恰好被 B 的其他
          成员全部覆盖），这是布隆位图运算的固有局限，需要强保证时请
          使用 ``track_keys=True`` 或 :class:`ExactKernel` 对照。

        结果覆盖两个内核 tag 的并集；某 tag 只存在于一侧时缺失侧按空
        集合处理。两侧对同一 tag 的 m、k 配置必须一致，否则抛
        :class:`ValidationError`。运算不修改两个原内核；结果内核的
        ``max_bits`` 为 ``None``。
        """

        if not isinstance(other, BloomKernel):
            raise ValidationError(
                "集合运算要求另一个操作数也是 BloomKernel，"
                f"实际类型: {type(other).__name__}"
            )
        if op not in ("or", "and", "and_not"):
            raise ValidationError(f"未知位运算: {op}")
        if self._track_keys and other._track_keys:
            return self._combine_exact(other, op)
        return self._combine_bits(other, op)

    def _combine_exact(self, other: "BloomKernel", op: str) -> "BloomKernel":
        """两个精确跟踪内核之间的精确集合运算（结果重新散列）。"""
        result = BloomKernel(
            default_m=self._default_m,
            default_k=self._default_k,
            max_bits=None,
            track_keys=True,
        )
        all_tags: List[str] = list(self._shards.keys())
        for t in other._shards:
            if t not in self._shards:
                all_tags.append(t)
        for tag in all_tags:
            left = self._shards.get(tag)
            right = other._shards.get(tag)
            ref = left or right
            assert ref is not None and ref.keys is not None
            lk = left.keys if left is not None else set()
            rk = right.keys if right is not None else set()
            if left is not None and right is not None:
                if left.m != right.m or left.k != right.k:
                    raise ValidationError(
                        f"tag {tag!r} 的配置不一致: 左 (m={left.m}, k={left.k})，"
                        f"右 (m={right.m}, k={right.k})，无法做集合运算"
                    )
            if op == "or":
                keys = lk | rk
            elif op == "and":
                keys = lk & rk
            else:
                keys = lk - rk
            shard = _Shard(
                bits=bytearray((ref.m + 7) // 8),
                m=ref.m,
                k=ref.k,
                inserted=0,
                distinct=len(keys),
                keys=set(keys),
            )
            for key in keys:
                for idx in _bit_indices(key, ref.m, ref.k):
                    byte, bit = divmod(idx, 8)
                    shard.bits[byte] |= 1 << bit
            result._shards[tag] = shard
        return result

    def _combine_bits(self, other: "BloomKernel", op: str) -> "BloomKernel":
        """纯位图运算路径（见 :meth:`_combine` 的语义说明）。"""
        result = BloomKernel(
            default_m=self._default_m,
            default_k=self._default_k,
            max_bits=None,
            track_keys=False,
        )
        all_tags: List[str] = list(self._shards.keys())
        for t in other._shards:
            if t not in self._shards:
                all_tags.append(t)

        for tag in all_tags:
            left = self._shards.get(tag)
            right = other._shards.get(tag)
            ref = left or right
            assert ref is not None
            if left is not None and right is not None:
                if left.m != right.m or left.k != right.k:
                    raise ValidationError(
                        f"tag {tag!r} 的配置不一致: 左 (m={left.m}, k={left.k})，"
                        f"右 (m={right.m}, k={right.k})，无法按位运算"
                    )
            size = ref.nbytes
            out = bytearray(size)
            lb = left.bits if left is not None else bytearray(size)
            rb = right.bits if right is not None else bytearray(size)
            for i in range(size):
                if op == "or":
                    out[i] = lb[i] | rb[i]
                elif op == "and":
                    out[i] = lb[i] & rb[i]
                else:  # and_not: 左 AND (非右)
                    out[i] = lb[i] & (~rb[i] & 0xFF)
            # 位图路径无法从结果位图反推集合大小：计数置 0，基数请用
            # estimate_cardinality() 反推。
            result._shards[tag] = _Shard(
                bits=out, m=ref.m, k=ref.k, inserted=0, distinct=0, keys=None
            )
        return result

    def union(self, other: "BloomKernel") -> "BloomKernel":
        """返回两内核逐 tag 按位或后的 **新内核**（A ∪ B）。"""
        return self._combine(other, "or")

    def intersect(self, other: "BloomKernel") -> "BloomKernel":
        """返回两内核逐 tag 按位与后的 **新内核**（A ∩ B）。

        交集的位只会变少，故其假阳性率不高于任一原集合。
        """
        return self._combine(other, "and")

    def difference(self, other: "BloomKernel") -> "BloomKernel":
        """返回逐 tag 按位与非后的 **新内核**（A - B，即 A & ~B）。"""
        return self._combine(other, "and_not")

    # ------------------------------------------------------------------ #
    # 持久化
    # ------------------------------------------------------------------ #

    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的纯数据字典。"""
        shards: Dict[str, Any] = {}
        for tag, shard in self._shards.items():
            fill = self._set_bits(shard) / shard.m
            shards[tag] = {
                "m": shard.m,
                "k": shard.k,
                "inserted": shard.inserted,
                "distinct": shard.distinct,
                "fill_ratio": fill,
                # base64 可读性差，这里用 hex：每个字节两位十六进制，
                # JSON 里仍是普通字符串，损坏时也能给出清楚的报错。
                "bits_hex": shard.bits.hex(),
                # 精确跟踪模式下额外落盘全部 key；纯布隆模式为 null。
                "keys": sorted(shard.keys) if shard.keys is not None else None,
            }
        return {
            "format": "bloom-kernel",
            "version": _FORMAT_VERSION,
            "default_m": self._default_m,
            "default_k": self._default_k,
            "max_bits": self._max_bits,
            "track_keys": self._track_keys,
            "shards": shards,
        }

    @classmethod
    def from_dict(cls, data: Any) -> "BloomKernel":
        """从纯数据字典重建内核并做完整一致性校验。

        任何字段缺失、类型错误、逻辑矛盾都抛 :class:`PersistenceError`。
        """

        if not isinstance(data, dict):
            raise PersistenceError("快照顶层必须是 JSON 对象")
        if data.get("format") != "bloom-kernel":
            raise PersistenceError("缺少 format 字段或其值不是 'bloom-kernel'")
        version = data.get("version")
        if not isinstance(version, int) or isinstance(version, bool):
            raise PersistenceError("version 字段缺失或不是整数")
        if version != _FORMAT_VERSION:
            raise PersistenceError(
                f"不支持的快照版本: {version}，当前支持版本: {_FORMAT_VERSION}"
            )

        try:
            default_m = _require_positive_int(data, "default_m")
            default_k = _require_positive_int(data, "default_k")
        except PersistenceError:
            raise
        max_bits_raw = data.get("max_bits", None)
        if max_bits_raw is not None and (
            not isinstance(max_bits_raw, int)
            or isinstance(max_bits_raw, bool)
            or max_bits_raw < 0
        ):
            raise PersistenceError("max_bits 必须为 null 或非负整数")
        track_keys = data.get("track_keys", False)
        if not isinstance(track_keys, bool):
            raise PersistenceError("track_keys 必须是布尔值")

        shards_raw = data.get("shards")
        if not isinstance(shards_raw, dict):
            raise PersistenceError("shards 字段缺失或不是对象")

        kernel = cls(
            default_m=default_m,
            default_k=default_k,
            max_bits=max_bits_raw,
            track_keys=track_keys,
        )
        total = 0
        for tag, shard_raw in shards_raw.items():
            if not isinstance(tag, str) or not tag:
                raise PersistenceError(f"非法 tag 名: {tag!r}")
            if not isinstance(shard_raw, dict):
                raise PersistenceError(f"分片 {tag!r} 的内容必须是对象")
            try:
                m = _require_positive_int(shard_raw, "m", where=f"分片 {tag!r}")
                k = _require_positive_int(shard_raw, "k", where=f"分片 {tag!r}")
            except PersistenceError:
                raise
            inserted = shard_raw.get("inserted")
            distinct = shard_raw.get("distinct")
            for name, val in (("inserted", inserted), ("distinct", distinct)):
                if not isinstance(val, int) or isinstance(val, bool) or val < 0:
                    raise PersistenceError(
                        f"分片 {tag!r} 的 {name} 必须是非负整数，实际为: {val!r}"
                    )
            if distinct > inserted:
                raise PersistenceError(
                    f"分片 {tag!r} 的 distinct({distinct}) 不能大于 inserted({inserted})"
                )
            bits_hex = shard_raw.get("bits_hex")
            if not isinstance(bits_hex, str):
                raise PersistenceError(f"分片 {tag!r} 缺少 bits_hex 字符串")
            try:
                bits = bytearray(bytes.fromhex(bits_hex))
            except ValueError as exc:
                raise PersistenceError(
                    f"分片 {tag!r} 的 bits_hex 不是合法十六进制: {exc}"
                ) from None
            expected_len = (m + 7) // 8
            if len(bits) != expected_len:
                raise PersistenceError(
                    f"分片 {tag!r} 的位数组长度与配置不匹配: m={m} 要求 "
                    f"{expected_len} 字节，实际 {len(bits)} 字节"
                )
            # 最后一个字节中超出 m 的“衬底位”必须为 0，否则说明数据被污染。
            padding = len(bits) * 8 - m
            if padding and bits[-1] >> (8 - padding) != 0:
                raise PersistenceError(
                    f"分片 {tag!r} 位数组的 {padding} 个衬底位非零，数据已损坏"
                )
            x = sum(bin(b).count("1") for b in bits)
            fill = x / m
            if not (0.0 <= fill <= 1.0):
                # 理论上不可达（前面已挡衬底位），保留作为防御性校验。
                raise PersistenceError(
                    f"分片 {tag!r} 的填充率 {fill} 超出 [0, 1]"
                )
            saved_fill = shard_raw.get("fill_ratio")
            if not isinstance(saved_fill, (int, float)) or isinstance(saved_fill, bool):
                raise PersistenceError(
                    f"分片 {tag!r} 的 fill_ratio 必须是数字，实际为: {saved_fill!r}"
                )
            if not (0.0 <= float(saved_fill) <= 1.0):
                raise PersistenceError(
                    f"分片 {tag!r} 记录的 fill_ratio={saved_fill} 超出 [0, 1]"
                )
            # 记录值与重算值允许浮点误差，容差 1e-9。
            if abs(float(saved_fill) - fill) > 1e-9:
                raise PersistenceError(
                    f"分片 {tag!r} 的 fill_ratio 与位数组不一致: "
                    f"记录 {saved_fill}，实算 {fill}"
                )

            # 精确 key 集合（仅 track_keys 快照存在）
            keys_raw = shard_raw.get("keys", None)
            keys_set: Optional[set] = None
            if track_keys:
                if not isinstance(keys_raw, list) or not all(
                    isinstance(x, str) for x in keys_raw
                ):
                    raise PersistenceError(
                        f"分片 {tag!r} 的 keys 必须是字符串列表（track_keys 已开启）"
                    )
                keys_set = set(keys_raw)
                if len(keys_set) != len(keys_raw):
                    raise PersistenceError(f"分片 {tag!r} 的 keys 存在重复")
                for key in keys_set:
                    if not key or len(key.encode("utf-8")) > MAX_KEY_BYTES:
                        raise PersistenceError(
                            f"分片 {tag!r} 含非法 key: {key[:32]!r}"
                        )
                if distinct != len(keys_set):
                    raise PersistenceError(
                        f"分片 {tag!r} 的 distinct={distinct} 与 keys 数 "
                        f"{len(keys_set)} 不一致"
                    )
                # 强一致性：位图必须恰好等于全部 key 重散列的结果。
                rebuilt = bytearray(expected_len)
                for key in keys_set:
                    for idx in _bit_indices(key, m, k):
                        byte, bit = divmod(idx, 8)
                        rebuilt[byte] |= 1 << bit
                if rebuilt != bits:
                    raise PersistenceError(
                        f"分片 {tag!r} 的位数组与 keys 重散列结果不一致，数据已损坏"
                    )
            elif keys_raw is not None:
                raise PersistenceError(
                    f"分片 {tag!r} 含 keys 但快照 track_keys=false"
                )

            total += m
            if max_bits_raw is not None and total > max_bits_raw:
                raise PersistenceError(
                    f"快照中各分片位数总和 {total} 超过记录的 max_bits={max_bits_raw}"
                )
            kernel._shards[tag] = _Shard(
                bits=bits, m=m, k=k, inserted=inserted,
                distinct=distinct, keys=keys_set,
            )
        return kernel

    def save(self, path: Union[str, os.PathLike[str]]) -> None:
        """把状态原子写入 JSON 文件（先写临时文件再替换，避免写一半损坏）。"""
        directory = os.path.dirname(os.path.abspath(path))
        tmp_path = f"{path}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as fh:
                json.dump(self.to_dict(), fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp_path, path)
        except OSError as exc:
            raise PersistenceError(f"写入快照失败: {path}: {exc}") from exc

    @classmethod
    def load(cls, path: Union[str, os.PathLike[str]]) -> "BloomKernel":
        """从 JSON 文件读取并校验重建；文件缺失/损坏一律抛
        :class:`PersistenceError`，不会静默返回空内核。
        """

        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            raise PersistenceError(f"快照文件不存在: {path}") from None
        except json.JSONDecodeError as exc:
            raise PersistenceError(
                f"快照文件不是合法 JSON: {path}: 第 {exc.lineno} 行第 {exc.colno} 列: "
                f"{exc.msg}"
            ) from None
        except OSError as exc:
            raise PersistenceError(f"读取快照失败: {path}: {exc}") from None
        return cls.from_dict(data)

    # ------------------------------------------------------------------ #
    # 内部辅助
    # ------------------------------------------------------------------ #

    def _require_shard(self, tag: str) -> _Shard:
        shard = self._shards.get(tag)
        if shard is None:
            raise ValidationError(f"未知 tag: {tag!r}（尚未插入过任何 key）")
        return shard

    @staticmethod
    def _set_bits(shard: _Shard) -> int:
        return sum(bin(b).count("1") for b in shard.bits)


def _require_positive_int(
    obj: Dict[str, Any], name: str, where: str = "快照"
) -> int:
    val = obj.get(name)
    if not isinstance(val, int) or isinstance(val, bool) or val < 1:
        raise PersistenceError(
            f"{where}的 {name} 必须是正整数，实际为: {val!r}"
        )
    return val


class ExactKernel:
    """精确对照内核：用 ``set`` 保存每个 tag 的全部 key。

    接口刻意与 :class:`BloomKernel` 对齐（insert/contains/统计/集合运算/
    持久化），但不含假阳性，内存随不同 key 数线性增长——只建议小规模
    测试使用。持久化直接保存 key 列表，格式与布隆快照不同
    （``"format": "exact-kernel"``）。
    """

    def __init__(self, max_keys: Optional[int] = None) -> None:
        if max_keys is not None:
            if isinstance(max_keys, bool) or not isinstance(max_keys, int) or max_keys < 0:
                raise ValidationError("max_keys 必须为非负整数或 None")
        self._max_keys = max_keys
        self._sets: Dict[str, set[str]] = {}
        self._inserted: Dict[str, int] = {}

    @property
    def max_keys(self) -> Optional[int]:
        return self._max_keys

    @property
    def total_bits(self) -> int:
        """与布隆内核对齐的“容量占用”口径：这里按不同 key 数计。"""
        return sum(len(s) for s in self._sets.values())

    def tags(self) -> List[str]:
        return list(self._sets.keys())

    def insert(self, item: Item) -> bool:
        if not isinstance(item, Item):
            raise ValidationError(
                f"insert 需要 Item 实例，实际类型: {type(item).__name__}"
            )
        bucket = self._sets.get(item.tag)
        if bucket is None:
            if self._max_keys is not None and self.total_keys + 1 > self._max_keys:
                raise CapacityError(
                    f"拒绝插入: key 总数将超过 max_keys={self._max_keys}"
                )
            bucket = set()
            self._sets[item.tag] = bucket
            self._inserted[item.tag] = 0
        elif self._max_keys is not None and item.key not in bucket:
            if self.total_keys + 1 > self._max_keys:
                raise CapacityError(
                    f"拒绝插入: key 总数将超过 max_keys={self._max_keys}"
                )
        is_new = item.key not in bucket
        bucket.add(item.key)
        self._inserted[item.tag] += 1
        return is_new

    def insert_many(self, items: Iterable[Item]) -> int:
        return sum(1 for item in items if self.insert(item))

    def contains(self, tag: str, key: str) -> bool:
        return key in self._sets.get(tag, ())

    def __contains__(self, item: Item) -> bool:
        return self.contains(item.tag, item.key)

    @property
    def total_keys(self) -> int:
        return sum(len(s) for s in self._sets.values())

    def fill_ratio(self, tag: str) -> float:
        self._require(tag)
        return 0.0  # 精确结构没有“填充率”概念，给 0 保持接口可用

    def false_positive_rate(self, tag: str) -> float:
        self._require(tag)
        return 0.0  # 精确集合永不假阳性

    def estimate_cardinality(self, tag: str) -> int:
        return len(self._require(tag))

    def inserted_count(self, tag: str) -> int:
        return self._inserted[tag] if tag in self._inserted else 0

    def set_bits(self, tag: str) -> int:
        return len(self._require(tag))

    def stats(self) -> Dict[str, Dict[str, Any]]:
        result: Dict[str, Dict[str, Any]] = {}
        for tag, bucket in self._sets.items():
            n = len(bucket)
            result[tag] = {
                "m": None,
                "k": None,
                "set_bits": n,
                "fill_ratio": 0.0,
                "false_positive_rate": 0.0,
                "inserted": self._inserted[tag],
                "distinct": n,
                "estimated_cardinality": n,
                "memory_bytes": None,
            }
        return result

    def _combine_sets(self, other: "ExactKernel", op: str) -> "ExactKernel":
        if not isinstance(other, ExactKernel):
            raise ValidationError("集合运算要求另一个操作数也是 ExactKernel")
        result = ExactKernel(max_keys=None)
        for tag in set(self._sets) | set(other._sets):
            left = self._sets.get(tag, set())
            right = other._sets.get(tag, set())
            if op == "or":
                merged = left | right
            elif op == "and":
                merged = left & right
            else:
                merged = left - right
            result._sets[tag] = set(merged)
            result._inserted[tag] = len(merged)
        return result

    def union(self, other: "ExactKernel") -> "ExactKernel":
        return self._combine_sets(other, "or")

    def intersect(self, other: "ExactKernel") -> "ExactKernel":
        return self._combine_sets(other, "and")

    def difference(self, other: "ExactKernel") -> "ExactKernel":
        return self._combine_sets(other, "and_not")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "format": "exact-kernel",
            "version": _FORMAT_VERSION,
            "max_keys": self._max_keys,
            "shards": {
                tag: {
                    "keys": sorted(bucket),
                    "inserted": self._inserted[tag],
                }
                for tag, bucket in self._sets.items()
            },
        }

    @classmethod
    def from_dict(cls, data: Any) -> "ExactKernel":
        if not isinstance(data, dict) or data.get("format") != "exact-kernel":
            raise PersistenceError("不是 exact-kernel 快照")
        version = data.get("version")
        if not isinstance(version, int) or isinstance(version, bool):
            raise PersistenceError("version 字段缺失或不是整数")
        if version != _FORMAT_VERSION:
            raise PersistenceError(
                f"不支持的快照版本: {version}，当前支持: {_FORMAT_VERSION}"
            )
        max_keys = data.get("max_keys")
        if max_keys is not None and (
            not isinstance(max_keys, int) or isinstance(max_keys, bool) or max_keys < 0
        ):
            raise PersistenceError("max_keys 必须为 null 或非负整数")
        shards = data.get("shards")
        if not isinstance(shards, dict):
            raise PersistenceError("shards 字段缺失或不是对象")
        kernel = cls(max_keys=max_keys)
        total = 0
        for tag, raw in shards.items():
            if not isinstance(tag, str) or not tag or not isinstance(raw, dict):
                raise PersistenceError(f"非法分片: {tag!r}")
            keys = raw.get("keys")
            inserted = raw.get("inserted")
            if not isinstance(keys, list) or not all(isinstance(x, str) for x in keys):
                raise PersistenceError(f"分片 {tag!r} 的 keys 必须是字符串列表")
            if (
                not isinstance(inserted, int)
                or isinstance(inserted, bool)
                or inserted < 0
            ):
                raise PersistenceError(f"分片 {tag!r} 的 inserted 必须是非负整数")
            if len(keys) > inserted or len(set(keys)) != len(keys):
                raise PersistenceError(f"分片 {tag!r} 的 keys/inserted 不一致")
            for key in keys:
                if not key or len(key.encode("utf-8")) > MAX_KEY_BYTES:
                    raise PersistenceError(f"分片 {tag!r} 含非法 key: {key!r}")
            total += len(keys)
            if max_keys is not None and total > max_keys:
                raise PersistenceError("快照 key 总数超过 max_keys")
            kernel._sets[tag] = set(keys)
            kernel._inserted[tag] = inserted
        return kernel

    def save(self, path: Union[str, os.PathLike[str]]) -> None:
        tmp_path = f"{path}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as fh:
                json.dump(self.to_dict(), fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp_path, path)
        except OSError as exc:
            raise PersistenceError(f"写入快照失败: {path}: {exc}") from exc

    @classmethod
    def load(cls, path: Union[str, os.PathLike[str]]) -> "ExactKernel":
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            raise PersistenceError(f"快照文件不存在: {path}") from None
        except json.JSONDecodeError as exc:
            raise PersistenceError(f"快照不是合法 JSON: {exc.msg}") from None
        except OSError as exc:
            raise PersistenceError(f"读取快照失败: {exc}") from None
        return cls.from_dict(data)

    def _require(self, tag: str) -> set:
        if tag not in self._sets:
            raise ValidationError(f"未知 tag: {tag!r}")
        return self._sets[tag]
