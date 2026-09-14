"""GF(256) 有限域与 Reed-Solomon 条带编解码内核。

校验关系（文档约定，全局唯一且在条带创建后不可更改）
=====================================================

* 字节域为 GF(256)，使用 AES 本原多项式

  ``x^8 + x^4 + x^3 + x + 1`` （十进制 ``0x11B``），

  乘法以本原元 ``3`` 的对数/反对数表实现。
* 一条带含 ``k`` 个数据块（位置 ``0..k-1``）与 ``m`` 个校验块
  （位置 ``k..k+m-1``），所有块等长，字节对齐；短块在写入时右侧补
  零，补零长度一并记录（见 :mod:`storage_repair.models`）。
* 编码采用 Cauchy 矩阵构造的系统型生成矩阵 ``G = [ I_k | P ]``：

  ``P[i][j] = 1 / (X[i] xor Y[j])``，

  其中 ``X[i] = i``（数据行坐标，取 ``0..k-1``）、
  ``Y[j] = 255 - j``（校验列坐标）。Cauchy 矩阵的任意行列子集均
  非奇异，因此 ``G`` 的**任意 k 列都线性无关**，构成 MDS 码：
  任意 ``k`` 个完好块即可逐字节唯一重建全部块，最多可容忍 ``m``
  个块丢失。
* 重建某位置 ``p`` 的内容时，选取 ``p`` 之外编号最小的 ``k`` 个
  完好块作为依据（确定性），解 GF(256) 线性方程组得到数据向量
  ``d``，再由 ``d`` 计算目标位置；数据位置取 ``d[p]``，校验位置
  取 ``sum_i d[i] * P[i][j]``。

整个模块只使用 Python 标准库。
"""

from __future__ import annotations

from typing import List, Sequence, Tuple

# --- GF(256) 基础运算 -------------------------------------------------------

#: AES 本原多项式 x^8 + x^4 + x^3 + x + 1（去掉最高位后的低 8 位系数）
GF_POLY = 0x11B
#: 本原元
GF_GENERATOR = 3
#: 域大小
GF_SIZE = 256


def _build_tables() -> Tuple[List[int], List[int]]:
    """构造 GF(256) 的指数表与对数表（本原元 3，多项式 0x11B）。

    :return: ``(exp_table, log_table)``，``exp_table`` 长度为 512，
        便于不带模地做一次指数相加；``log_table[0]`` 占位为 0。
    """
    exp_table = [0] * (GF_SIZE * 2)
    log_table = [0] * GF_SIZE
    value = 1
    for exponent in range(GF_SIZE - 1):
        exp_table[exponent] = value
        log_table[value] = exponent
        # 乘以本原元 3：先乘 2（左移并按 0x11B 约减），再异或原值（*3 = *2 ^ *1）
        previous = value
        value <<= 1
        if value >= GF_SIZE:
            value ^= GF_POLY
        value = (value & 0xFF) ^ previous
    # 周期 255，复制一份避免乘法时取模
    for exponent in range(GF_SIZE - 1, 2 * GF_SIZE - 2):
        exp_table[exponent] = exp_table[exponent - (GF_SIZE - 1)]
    exp_table[2 * GF_SIZE - 2] = 1
    return exp_table, log_table


_EXP, _LOG = _build_tables()


def gf_add(a: int, b: int) -> int:
    """GF(256) 加法（异或）。"""
    return a ^ b


def gf_mul(a: int, b: int) -> int:
    """GF(256) 乘法（对数表实现）。"""
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def gf_div(a: int, b: int) -> int:
    """GF(256) 除法；``b`` 为 0 时抛出 :class:`ZeroDivisionError`。"""
    if b == 0:
        raise ZeroDivisionError("GF(256) division by zero")
    if a == 0:
        return 0
    return _EXP[(_LOG[a] - _LOG[b]) % (GF_SIZE - 1)]


def gf_inverse(a: int) -> int:
    """求 GF(256) 乘法逆元；``a`` 为 0 时抛出 :class:`ZeroDivisionError`。"""
    if a == 0:
        raise ZeroDivisionError("GF(256) inverse of zero")
    return _EXP[(GF_SIZE - 1 - _LOG[a]) % (GF_SIZE - 1)]


# --- Cauchy 系统型生成矩阵 ---------------------------------------------------


def cauchy_parity_matrix(k: int, m: int) -> List[List[int]]:
    """返回 ``k x m`` 的 Cauchy 校验系数矩阵 ``P``。

    ``P[i][j] = 1 / (X[i] xor Y[j])``，其中 ``X[i]=i``、
    ``Y[j]=255-j``。任意 ``k <= 255``、``m <= 255-k`` 下，生成矩阵
    ``[I|P]`` 的任意 k 列均线性无关（Cauchy 矩阵的 MDS 性质）。
    """
    matrix = [[0] * m for _ in range(k)]
    for i in range(k):
        x_i = i
        for j in range(m):
            y_j = GF_SIZE - 1 - j
            matrix[i][j] = gf_inverse(x_i ^ y_j)
    return matrix


def _solve_linear_system(matrix: List[List[int]], vector: List[int]) -> List[int]:
    """在 GF(256) 上用高斯-约当消元解 ``A x = vector``。

    :param matrix: ``n x n`` 可逆矩阵（调用方负责保证可逆）。
    :param vector: 长度 n 的右端向量。
    :return: 解向量（长度 n 的新列表）。
    :raises ValueError: 矩阵奇异（理论上 Cauchy 选取不会发生）。
    """
    n = len(matrix)
    aug = [row[:] + [vector[idx]] for idx, row in enumerate(matrix)]
    for col in range(n):
        pivot = next((r for r in range(col, n) if aug[r][col] != 0), -1)
        if pivot < 0:
            raise ValueError("singular matrix while solving GF(256) system")
        if pivot != col:
            aug[col], aug[pivot] = aug[pivot], aug[col]
        inv_pivot = gf_inverse(aug[col][col])
        aug[col] = [gf_mul(v, inv_pivot) for v in aug[col]]
        for row in range(n):
            if row != col and aug[row][col] != 0:
                factor = aug[row][col]
                aug[row] = [
                    gf_add(v, gf_mul(factor, aug[col][c])) for c, v in enumerate(aug[row])
                ]
    return [row[n] for row in aug]


class ReedSolomonCodec:
    """固定 ``(k, m)`` 参数的 Reed-Solomon 编解码器。

    :param k: 数据块数量，``1 <= k <= 255``。
    :param m: 校验块数量，``0 <= m`` 且 ``k + m <= 256``。
    """

    def __init__(self, k: int, m: int) -> None:
        if not isinstance(k, int) or not isinstance(m, int):
            raise TypeError("k and m must be integers")
        if k < 1 or k > GF_SIZE - 1:
            raise ValueError("k must satisfy 1 <= k <= 255")
        if m < 0 or k + m > GF_SIZE:
            raise ValueError("m must satisfy 0 <= m and k + m <= 256")
        self.k = k
        self.m = m
        self.total = k + m
        self.parity = cauchy_parity_matrix(k, m)

    # -- 编码 ---------------------------------------------------------------

    def encode_parity(self, data_blocks: Sequence[bytes]) -> List[bytes]:
        """由 ``k`` 个数据块计算全部 ``m`` 个校验块。

        :param data_blocks: 恰好 k 个等长 bytes 对象。
        :return: m 个校验块（新列表）。
        """
        if len(data_blocks) != self.k:
            raise ValueError(f"expected {self.k} data blocks, got {len(data_blocks)}")
        length = len(data_blocks[0])
        for idx, block in enumerate(data_blocks):
            if not isinstance(block, bytes):
                raise TypeError(f"data block {idx} must be bytes")
            if len(block) != length:
                raise ValueError("data blocks must have equal length")
        result: List[bytearray] = [bytearray(length) for _ in range(self.m)]
        for i in range(self.k):
            row = data_blocks[i]
            coeffs = self.parity[i]
            for offset, symbol in enumerate(row):
                if symbol:
                    for j in range(self.m):
                        result[j][offset] ^= gf_mul(symbol, coeffs[j])
        return [bytes(buf) for buf in result]

    # -- 重建 ---------------------------------------------------------------

    def reconstruct_positions(
        self,
        available: Sequence[Tuple[int, bytes]],
        targets: Sequence[int],
    ) -> Tuple[List[bytes], List[int]]:
        """由任意 k 个完好块重建若干目标位置的内容。

        依据位置的选取是确定性的：``available`` 会按位置编号升序
        排序后取前 k 个，报告中也以升序返回。

        :param available: ``(位置, 内容)`` 对，至少 k 个，内容等长。
        :param targets: 需要输出内容的位置编号（必须不在 available 中）。
        :return: ``(targets_contents, used_positions)``，前者与
            ``targets`` 同序，后者为实际使用的依据位置（升序）。
        :raises ValueError: 依据块不足 k 个、位置非法/重复，或目标位置非法。
        """
        indexed = sorted(available, key=lambda pair: pair[0])
        if len(indexed) < self.k:
            raise ValueError(
                f"need at least {self.k} available blocks, got {len(indexed)}"
            )
        chosen = indexed[: self.k]
        positions = [pos for pos, _ in chosen]
        if len(set(positions)) != len(positions):
            raise ValueError("duplicate positions in available blocks")
        for pos in positions:
            self._check_position(pos)
        target_list = list(targets)
        for pos in target_list:
            self._check_position(pos)
            if pos in positions:
                raise ValueError(f"target position {pos} is also an available block")
        length = len(chosen[0][1])
        for pos, content in chosen:
            if not isinstance(content, bytes):
                raise TypeError(f"block at position {pos} must be bytes")
            if len(content) != length:
                raise ValueError(
                    f"block at position {pos} has length {len(content)}, "
                    f"expected {length}"
                )

        # A[r][c]：依据块 r 对应数据列 c 的生成矩阵系数。
        matrix = [[0] * self.k for _ in range(self.k)]
        for row, pos in enumerate(positions):
            if pos < self.k:
                matrix[row][pos] = 1
            else:
                parity_col = pos - self.k
                for c in range(self.k):
                    matrix[row][c] = self.parity[c][parity_col]

        decoded: List[bytes] = [b""] * self.k
        # 逐字节（符号）解线性方程组；先把每个依据块的列字节取出。
        columns = [content for _, content in chosen]
        data_vecs = [bytearray(length) for _ in range(self.k)]
        for offset in range(length):
            rhs = [block[offset] for block in columns]
            solution = _solve_linear_system(matrix, rhs)
            for c in range(self.k):
                data_vecs[c][offset] = solution[c]
        decoded = [bytes(buf) for buf in data_vecs]

        outputs: List[bytes] = []
        for pos in target_list:
            if pos < self.k:
                outputs.append(decoded[pos])
            else:
                parity_col = pos - self.k
                buf = bytearray(length)
                for i in range(self.k):
                    coeff = self.parity[i][parity_col]
                    for offset, symbol in enumerate(decoded[i]):
                        if symbol:
                            buf[offset] ^= gf_mul(symbol, coeff)
                outputs.append(bytes(buf))
        return outputs, positions

    def expected_parity(self, position: int, data_blocks: Sequence[bytes]) -> bytes:
        """计算单个校验位置在给定数据块下应有的内容。"""
        if not self.k <= position < self.total:
            raise ValueError(f"position {position} is not a parity position")
        return self.encode_parity(data_blocks)[position - self.k]

    def _check_position(self, pos: int) -> None:
        if not isinstance(pos, int) or not 0 <= pos < self.total:
            raise ValueError(f"position must be an integer in [0, {self.total})")
