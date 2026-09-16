"""确定性随机流：SHA-256 计数器模式。

设计目标
--------
同一份 (实验ID, 种子, 步骤, 抽签, 类型) 永远产生同一段随机字节，
与执行时间、线程调度、执行顺序无关。因此：

* 每个步骤拥有独立的、由其声明位置派生的随机流，步骤间互不干扰；
* 步骤可以按依赖图并行调度，各自取数的结果与顺序执行完全一致；
* 步骤重试时把流"倒回起点"重播，复用的是该步骤自己原来的随机量，
  不会推进、也不会借用后续步骤的流。

流的层次
--------
experiment + seed 派生命名空间，再按 (步骤序号, 抽签id, 随机类型, 块序号)
取 SHA-256 输出。同一步骤声明多种随机类型时（如 3 个 uniform 与 2 个 gaussian），
类型之间使用彼此独立的计数器，保证"各消耗各的、严格守恒"，
也使流记录可按类型核对守恒关系。

这不是密码学用途，但 SHA-256 是标准库中跨平台、跨 Python 版本结果最稳定的
伪随机来源（哈希字节序有严格规范），且不依赖全局随机状态。
"""

from __future__ import annotations

import hashlib
import math
import struct
from typing import Dict, List, Optional

SUPPORTED_TYPES = ("uniform", "integer", "bernoulli", "gaussian")
_TYPE_ALIASES = {"float": "uniform", "bool": "bernoulli", "normal": "gaussian"}
SCHEMA_VERSION = 1


class DeterministicRandomError(Exception):
    """随机流层面的错误。"""


def normalize_type(rtype: str) -> str:
    if not isinstance(rtype, str):
        raise DeterministicRandomError(f"随机类型必须是字符串，得到 {type(rtype).__name__}")
    key = rtype.strip().lower()
    key = _TYPE_ALIASES.get(key, key)
    if key not in SUPPORTED_TYPES:
        raise DeterministicRandomError(
            f"不支持的随机类型 {rtype!r}，支持：{', '.join(SUPPORTED_TYPES)}"
        )
    return key


def _block(key: bytes) -> bytes:
    return hashlib.sha256(key).digest()


class RandomStream:
    """单个 (实验, 种子, 步骤, 抽签) 的独立确定性随机流。

    每个随机类型各有一个块计数器。``rewind`` 把所有计数器清零，
    于是重试拿到的数字序列与首次完全一致——重播而非新抽样。
    """

    def __init__(self, experiment_id: str, seed: int, step_index: int,
                 draw_id: str = "main"):
        self.experiment_id = experiment_id
        self.seed = int(seed)
        self.step_index = int(step_index)
        self.draw_id = draw_id
        # 每种类型：[下一块序号, 块内已消费的 32 位字数, 已消费的随机单位数]
        self._state: Dict[str, List[int]] = {
            t: [0, 0, 0] for t in SUPPORTED_TYPES
        }
        self._block_cache: Dict[str, bytes] = {}

    # ---- 内部取数 -------------------------------------------------------

    def _prefix(self, rtype: str) -> bytes:
        return (
            f"rng-core/v{SCHEMA_VERSION}|exp={self.experiment_id}"
            f"|seed={self.seed}|step={self.step_index}"
            f"|draw={self.draw_id}|type={rtype}|block="
        ).encode("utf-8")

    def _next_uint32(self, rtype: str) -> int:
        st = self._state[rtype]
        cached = self._block_cache.get(rtype)
        if cached is None or st[1] >= 8:
            cached = _block(self._prefix(rtype) + str(st[0]).encode("ascii"))
            self._block_cache[rtype] = cached
            st[0] += 1
            st[1] = 0
        word = struct.unpack_from("<I", cached, st[1] * 4)[0]
        st[1] += 1
        return word

    def _uniform_unit(self, rtype: str) -> float:
        """返回 [0, 1) 上的双精度均匀数（53 位尾数，等概率网格）。"""
        hi = self._next_uint32(rtype)
        lo = self._next_uint32(rtype)
        return ((hi * (1 << 21)) + (lo >> 11)) * 2.0 ** -53

    # ---- 对外抽样 API ---------------------------------------------------

    def uniform(self, low: float = 0.0, high: float = 1.0, n: int = 1) -> List[float]:
        if n < 0:
            raise DeterministicRandomError("抽取数量不能为负")
        if high < low:
            raise DeterministicRandomError(f"uniform 上界 {high} 小于下界 {low}")
        out = []
        for _ in range(n):
            u = self._uniform_unit("uniform")
            if high == low:
                out.append(float(low))
            else:
                out.append(low + (high - low) * u)
        self._state["uniform"][2] += n
        return out

    def integer(self, low: int, high: int, n: int = 1) -> List[int]:
        """闭区间 [low, high] 上的均匀整数（拒绝采样，无模偏差）。"""
        if n < 0:
            raise DeterministicRandomError("抽取数量不能为负")
        low, high = int(low), int(high)
        if high < low:
            raise DeterministicRandomError(f"integer 上界 {high} 小于下界 {low}")
        span = high - low + 1
        limit = (1 << 32) - ((1 << 32) % span)  # 拒绝域之外的上界
        out = []
        produced = 0
        while produced < n:
            x = self._next_uint32("integer")
            if x < limit:
                out.append(low + (x % span))
                produced += 1
        self._state["integer"][2] += n
        return out

    def bernoulli(self, p: float, n: int = 1) -> List[int]:
        if n < 0:
            raise DeterministicRandomError("抽取数量不能为负")
        if not 0.0 <= float(p) <= 1.0:
            raise DeterministicRandomError(f"bernoulli 概率必须在 [0,1]，得到 {p}")
        out = []
        for _ in range(n):
            u = self._uniform_unit("bernoulli")
            out.append(1 if u < float(p) else 0)
        self._state["bernoulli"][2] += n
        return out

    def gaussian(self, mu: float = 0.0, sigma: float = 1.0, n: int = 1) -> List[float]:
        """Box-Muller（余弦支）。成对 u1/u2 取自同一类型计数器，确定且守恒。"""
        if n < 0:
            raise DeterministicRandomError("抽取数量不能为负")
        if sigma < 0:
            raise DeterministicRandomError(f"gaussian 标准差不能为负，得到 {sigma}")
        if sigma == 0:
            self._state["gaussian"][2] += n
            return [float(mu)] * n
        out = []
        for _ in range(n):
            u1 = self._uniform_unit("gaussian")
            u2 = self._uniform_unit("gaussian")
            # 把 u1=0 换成最小正网格值，避免 log(0) 产生 inf（仍完全确定）。
            if u1 == 0.0:
                u1 = 2.0 ** -53
            z = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
            out.append(mu + sigma * z)
        self._state["gaussian"][2] += n
        return out

    def draw(self, rtype: str, n: int, params: Optional[dict] = None) -> List[float]:
        """按类型名统一入口（供执行引擎按声明驱动）。"""
        t = normalize_type(rtype)
        p = params or {}
        if t == "uniform":
            return self.uniform(float(p.get("low", 0.0)), float(p.get("high", 1.0)), n)
        if t == "integer":
            return [float(v) for v in self.integer(int(p["low"]), int(p["high"]), n)]
        if t == "bernoulli":
            return [float(v) for v in self.bernoulli(float(p.get("p", 0.5)), n)]
        return self.gaussian(float(p.get("mu", 0.0)), float(p.get("sigma", 1.0)), n)

    # ---- 重播与计量 -----------------------------------------------------

    def rewind(self) -> None:
        """倒回起点：重试时复用原有随机流。"""
        for st in self._state.values():
            st[0], st[1], st[2] = 0, 0, 0
        self._block_cache.clear()

    def consumed(self) -> Dict[str, int]:
        """每种类型已交付给处理器的随机单位数。"""
        return {t: self._state[t][2] for t in SUPPORTED_TYPES if self._state[t][2] > 0}

    def blocks_read(self) -> Dict[str, int]:
        """每种类型实际读取的 SHA-256 块数（含拒绝采样浪费的字）。"""
        return {t: self._state[t][0] for t in SUPPORTED_TYPES if self._state[t][0] > 0}

    def conservation_digest(self) -> str:
        """流状态指纹：用于持久化后校验随机流是否被改动。"""
        mat = "|".join(
            f"{t}:{self._state[t][0]}/{self._state[t][1]}/{self._state[t][2]}"
            for t in SUPPORTED_TYPES
        )
        h = hashlib.sha256(f"digest|{self.identity_key()}|{mat}".encode("utf-8"))
        return h.hexdigest()[:16]

    def identity_key(self) -> str:
        return f"{self.experiment_id}|{self.seed}|{self.step_index}|{self.draw_id}"
