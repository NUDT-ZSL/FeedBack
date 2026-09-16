"""确定性、可随机访问的随机流。

设计要点
--------
* 每个实验随机流由 ``(seed, experiment_id)`` 唯一确定；第 i 个随机量
  ``X_i = splitmix64(key + i * GOLDEN)``，任意位置都能 O(1) 直接取，
  不依赖“之前取过多少个”，因此步骤切片、乱序/并行执行、失败重试
  拿到的随机数完全一致。
* 一个逻辑随机量固定消耗一个 64 位字，类型（均匀/正态/整数/伯努利）
  只决定如何解释这个字，切片偏移量因此严格守恒。
* 浮点路径只使用 IEEE-754 四则运算与 ``math.sqrt``（所有主流平台
  硬件开方，结果按位正确舍入）；正态分布用 Acklam 有理逆 CDF，
  尾部所需的 log 使用本模块内确定性实现（不调用平台 libm log），
  因此 Windows / Linux / macOS 上结果按位一致。
"""

from __future__ import annotations

import math
import struct
from typing import Any, Dict, List, Optional, Tuple

from .errors import StreamExhaustedError

MASK64 = (1 << 64) - 1
GOLDEN = 0x9E3779B97F4A7C15
_TWO53 = 1.0 / 9007199254740992.0  # 2^-53

VALID_KINDS = ("uniform", "normal", "integer", "bernoulli")


def splitmix64(x: int) -> int:
    """SplitMix64 混合函数，输入输出均为 64 位无符号整数。"""
    x = (x + GOLDEN) & MASK64
    x = ((x ^ (x >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
    x = ((x ^ (x >> 27)) * 0x94D049BB133111EB) & MASK64
    return x ^ (x >> 31)


def fnv1a_64(data: bytes) -> int:
    h = 0xCBF29CE484222325
    for b in data:
        h ^= b
        h = (h * 0x100000001B3) & MASK64
    return h


def normalize_seed(seed: Any) -> int:
    """把 int / str / bytes 种子规范化为 64 位非负整数。"""
    if isinstance(seed, bool):  # bool 是 int 的子类，显式拒绝歧义
        raise ValueError("种子不能是布尔值")
    if isinstance(seed, int):
        if seed < 0:
            raise ValueError(f"种子必须是非负整数，收到 {seed}")
        return seed & MASK64
    if isinstance(seed, str):
        return fnv1a_64(seed.encode("utf-8"))
    if isinstance(seed, (bytes, bytearray)):
        return fnv1a_64(bytes(seed))
    raise TypeError(f"不支持的种子类型: {type(seed).__name__}")


# ---------------------------------------------------------------------------
# 确定性 log(x)：frexp 风格取指数 + atanh 级数，纯 IEEE 四则运算。
# 对正态逆 CDF 的尾部（|z|>~2）而言精度绰绰有余；测试中与 math.log
# 在大量随机点上比对，相对误差 < 3e-16。
# ---------------------------------------------------------------------------

_LN2 = 0.6931471805599453  # 0x3FE62E42FEFA39EF
_LOG_TERMS = 28


def det_log(x: float) -> float:
    if x != x:  # NaN
        return x
    if x < 0.0:
        return math.nan
    if x == 0.0:
        return -math.inf
    if math.isinf(x):
        return math.inf
    bits = struct.unpack("<Q", struct.pack("<d", x))[0]
    exp_field = (bits >> 52) & 0x7FF
    mant_bits = bits & 0xFFFFFFFFFFFFF
    k = exp_field - 1023
    if exp_field == 0:
        # 次正规数：放大 2^54 后重新取指数
        x = x * 18014398509481984.0  # 2^54
        bits = struct.unpack("<Q", struct.pack("<d", x))[0]
        exp_field = (bits >> 52) & 0x7FF
        k = exp_field - 1023 - 54
        mant_bits = bits & 0xFFFFFFFFFFFFF
    # 尾数 m ∈ [1, 2)；若超过 sqrt(2) 则除 2，使 m ∈ [sqrt(2)/2, sqrt(2))
    m = struct.unpack(
        "<d", struct.pack("<Q", 0x3FF0000000000000 | mant_bits)
    )[0]
    if m >= 1.4142135623730951:
        m = m * 0.5
        k += 1
    s = (m - 1.0) / (m + 1.0)
    z = s * s
    # 2s * (1 + z/3 + z^2/5 + ... + z^N/(2N+1))，Horner 求值
    p = 1.0 / (2 * _LOG_TERMS + 1)
    for n in range(_LOG_TERMS - 1, -1, -1):
        p = p * z + 1.0 / (2 * n + 1)
    return k * _LN2 + 2.0 * s * p


# ---------------------------------------------------------------------------
# Acklam 逆标准正态 CDF（不含 Newton 精修步：精修需要 erfc，反而引入
# 平台依赖；当前有理逼近的相对精度约 1.2e-9）。
# ---------------------------------------------------------------------------

_A = (-39.69683028665376, 220.9460984245205, -275.9285104469687,
      138.3577518672690, -30.66479806614716, 2.506628277459239)
_B = (-54.47609879822406, 161.5858368580409, -155.6989798598866,
      66.80131188771972, -13.28068155288572)
_C = (-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783)
_D = (0.007784695709041462, 0.3224671290700398, 2.445134137142996,
      3.754408661907416)
_P_LOW = 0.02425
_P_HIGH = 1.0 - _P_LOW
_U_MIN = _TWO53  # 把 u=0 夹到最小正 53 位值，避免 ±inf


def inverse_normal(u: float) -> float:
    if u < _U_MIN:
        u = _U_MIN
    if u < _P_LOW:
        q = math.sqrt(-2.0 * det_log(u))
        num = (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q
                + _C[4]) * q + _C[5])
        den = ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0)
        return num / den
    if u <= _P_HIGH:
        q = u - 0.5
        r = q * q
        num = (((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r
                + _A[4]) * r + _A[5]) * q
        den = (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r
                + _B[4]) * r + 1.0)
        return num / den
    q = math.sqrt(-2.0 * det_log(1.0 - u))
    num = (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q
            + _C[4]) * q + _C[5])
    den = ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0)
    # 上尾：C/D 逼近式给的是 -z（对 1-p 的下尾），需取负
    return -num / den


class DeterministicStream:
    """``(seed, stream_id)`` 确定的可随机访问 64 位字流。

    第 i 个字 = splitmix64(splitmix64(key ^ i-mix) ...)；
    这里取 ``word_at(i) = splitmix64(key + i*GOLDEN)``，
    等价于以 key 为初始状态的 SplitMix64 序列第 i 项。
    """

    __slots__ = ("seed", "stream_id", "_key")

    def __init__(self, seed: Any, stream_id: Any = 0):
        self.seed = normalize_seed(seed)
        sid = stream_id if isinstance(stream_id, int) else fnv1a_64(
            str(stream_id).encode("utf-8"))
        self.stream_id = sid & MASK64
        self._key = splitmix64(self.seed ^ splitmix64(self.stream_id))

    def word_at(self, index: int) -> int:
        return splitmix64((self._key + index * GOLDEN) & MASK64)

    def uniform01_at(self, index: int) -> float:
        return (self.word_at(index) >> 11) * _TWO53

    def draw_at(self, index: int, kind: str, params: Optional[Dict[str, Any]]
                ) -> Any:
        """按类型解释第 index 个字，值仅依赖 ``(index, kind, params)``。"""
        params = params or {}
        w = self.word_at(index)
        if kind == "integer":
            low = int(params.get("low", 0))
            high = int(params.get("high", 2**31 - 1))
            if high <= low:
                raise ValueError(f"integer 需要 high>low，收到 [{low},{high})")
            n = high - low
            # 定点乘取整：无拒绝采样，固定消耗一个字，偏差 < n/2^64
            return low + ((w * n) >> 64)
        u = (w >> 11) * _TWO53
        if kind == "uniform":
            low = float(params.get("low", 0.0))
            high = float(params.get("high", 1.0))
            if not high > low:
                raise ValueError(
                    f"uniform 需要 high>low，收到 [{low},{high}]")
            return low + (high - low) * u
        if kind == "normal":
            mean = float(params.get("mean", 0.0))
            std = float(params.get("std", 1.0))
            if not (std > 0.0) or math.isinf(std):
                raise ValueError(f"normal 需要有限正数 std，收到 {std}")
            return mean + std * inverse_normal(u)
        if kind == "bernoulli":
            p = float(params.get("p", 0.5))
            if not 0.0 <= p <= 1.0:
                raise ValueError(f"bernoulli 需要 0<=p<=1，收到 {p}")
            return 1 if u < p else 0
        raise ValueError(f"未知随机量类型 {kind!r}")


class RandomWindow:
    """步骤某次尝试拿到的随机切片：只能读 ``[offset, offset+count)``。

    越界读取会抛 :class:`StreamExhaustedError`，从而保证步骤无法偷取
    后续步骤的随机量。每次取值都会记入 ``draws``（值与位置），
    用于运行记录与载入时的随机流守恒复核。
    """

    __slots__ = ("stream", "offset", "count", "kind", "params", "step_id",
                 "slice_index", "pos", "draws", "closed")

    def __init__(self, stream: DeterministicStream, offset: int, count: int,
                 kind: str, params: Optional[Dict[str, Any]], step_id: str,
                 slice_index: int = 0):
        self.stream = stream
        self.offset = offset
        self.count = count
        self.kind = kind
        self.params = dict(params or {})
        self.step_id = step_id
        self.slice_index = slice_index
        self.pos = 0
        self.draws: List[Tuple[int, Any]] = []
        self.closed = False

    @property
    def remaining(self) -> int:
        return self.count - self.pos

    @property
    def consumed(self) -> int:
        return self.pos

    def draw(self) -> Any:
        """取下一个随机量。

        分布类型与参数（区间、均值方差、p 等）完全由切片声明决定，
        步骤不能在取值时临时修改——这保证了“声明即布局”，也使
        持久化后可以仅凭配置重算出同样的随机值。
        """
        if self.closed:
            raise StreamExhaustedError(
                f"步骤 {self.step_id!r} 的随机切片已关闭，不能再取值")
        if self.pos >= self.count:
            raise StreamExhaustedError(
                f"步骤 {self.step_id!r} 随机量耗尽：声明 {self.count} 个 "
                f"{self.kind}，第 {self.pos + 1} 个越界（offset={self.offset}，"
                f"后续步骤的随机量不受影响）")
        index = self.offset + self.pos
        value = self.stream.draw_at(index, self.kind, self.params)
        self.draws.append((index, value))
        self.pos += 1
        return value

    def draw_many(self, n: int) -> List[Any]:
        return [self.draw() for _ in range(n)]

    def replay_values(self) -> List[Any]:
        """不移动游标，重放该切片已消耗的随机值（重试时验证用）。"""
        return [self.stream.draw_at(idx, self.kind, self.params)
                for idx, _ in self.draws]

    def close(self) -> None:
        self.closed = True
