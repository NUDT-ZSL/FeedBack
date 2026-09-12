"""Reed-Solomon erasure coding over GF(2^8) for local object-storage protection.

纯标准库实现。有限域为 GF(2^8)，本原多项式 0x11d
(x^8 + x^4 + x^3 + x^2 + 1)，生成元取 2。

编码侧使用范德蒙德矩阵，经高斯消元转换为系统码：前 data_shards
个块即原始数据，后 parity_shards 个块为校验块。解码时从存活块
对应行组成方阵求逆，再恢复缺失的数据块。

所有 GF 运算（乘 / 除 / 求逆）均通过预计算的指数表 / 对数表完成，
不使用大整数模拟多项式除法。字节级运算借助 bytes.translate 查表，
在 CPython 上 1 MiB、10+4 配置可在秒级内完成往返。
"""

__all__ = ["ErasureCodec"]

# ---------------------------------------------------------------------------
# GF(2^8) 域表（本原多项式 0x11d，生成元 2）
# ---------------------------------------------------------------------------

_EXP = [0] * 512          # 扩展到 512，乘法时无需对下标取模
_LOG = [0] * 256


def _build_tables():
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11d
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]
    # 0 没有对数；_LOG[0] 保持 0，调用方需保证入参非零。


_build_tables()


def _gf_add(a, b):
    return a ^ b


def _gf_mul(a, b):
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _gf_div(a, b):
    if b == 0:
        raise ZeroDivisionError("division by zero in GF(2^8)")
    if a == 0:
        return 0
    return _EXP[(_LOG[a] - _LOG[b]) % 255]


def _gf_inv(a):
    if a == 0:
        raise ZeroDivisionError("zero has no inverse in GF(2^8)")
    return _EXP[255 - _LOG[a]]


# 256 张 256 字节乘法表：_MUL_TABLES[c][v] == c * v（域乘法）。
# bytes.translate 用它把一整块的逐字节乘法变成一次 C 调用。
_MUL_TABLES = [None] * 256
for _c in range(256):
    _MUL_TABLES[_c] = bytes(_gf_mul(_c, _v) for _v in range(256))


# ---------------------------------------------------------------------------
# 矩阵工具（GF(2^8) 上的行矩阵，元素为 0..255 的 int）
# ---------------------------------------------------------------------------

def _identity(n):
    return [[1 if i == j else 0 for j in range(n)] for i in range(n)]


def _invert_matrix(matrix):
    """对 GF(2^8) 上的方阵做高斯-若尔当消元求逆。

    矩阵奇异（行线性相关）时抛 ValueError。
    """
    n = len(matrix)
    for row in matrix:
        if len(row) != n:
            raise ValueError("matrix is not square")
    work = [list(matrix[i]) + _identity(n)[i] for i in range(n)]

    row = 0
    for col in range(n):
        pivot = row
        while pivot < n and work[pivot][col] == 0:
            pivot += 1
        if pivot == n:
            raise ValueError("matrix is singular and cannot be inverted")
        work[row], work[pivot] = work[pivot], work[row]

        pivot_val = work[row][col]
        if pivot_val != 1:
            inv = _gf_inv(pivot_val)
            work[row] = [_gf_mul(v, inv) for v in work[row]]

        for r in range(n):
            if r != row and work[r][col] != 0:
                factor = work[r][col]
                work[r] = [
                    v ^ _gf_mul(factor, work[row][c])
                    for c, v in enumerate(work[r])
                ]
        row += 1

    return [r[n:] for r in work]


# ---------------------------------------------------------------------------
# ErasureCodec
# ---------------------------------------------------------------------------

class ErasureCodec:
    """Reed-Solomon 系统纠删码。

    参数:
        data_shards:   数据块数，1..255
        parity_shards: 校验块数，0..255
        两者之和不得超过 256。
    """

    def __init__(self, data_shards, parity_shards):
        if not isinstance(data_shards, int) or isinstance(data_shards, bool):
            raise ValueError("data_shards 必须为整数")
        if not isinstance(parity_shards, int) or isinstance(parity_shards, bool):
            raise ValueError("parity_shards 必须为整数")
        if not 1 <= data_shards <= 255:
            raise ValueError(
                f"data_shards 必须在 [1, 255] 内，实际为 {data_shards}")
        if not 0 <= parity_shards <= 255:
            raise ValueError(
                f"parity_shards 必须在 [0, 255] 内，实际为 {parity_shards}")
        if data_shards + parity_shards > 256:
            raise ValueError(
                "data_shards + parity_shards 不能超过 256（GF(2^8) 下最多 256 "
                f"个互不相同的评估点），实际为 {data_shards + parity_shards}")

        self.data_shards = data_shards
        self.parity_shards = parity_shards
        self.total_shards = data_shards + parity_shards
        # 系统码生成矩阵（total × data）。前 data 行为单位阵。
        self.matrix = self._build_systematic_matrix()

    # -- 矩阵构造 ---------------------------------------------------------

    def _vandermonde(self):
        """构造 (data+parity) × data 的范德蒙德矩阵。

        第 i 行第 j 列为 x_i^j（GF(2^8) 幂运算），评估点 x_i 取
        0, 1, ..., total-1。任意 data_shards 个不同评估点构成的方阵
        行列式为 ∏(x_j - x_i)，点互异时非零，故任意 data_shards 行
        都满秩 —— 这是解码时可以任选存活块子集的根据。
        """
        d, t = self.data_shards, self.total_shards
        m = [[0] * d for _ in range(t)]
        for i in range(t):
            row = m[i]
            row[0] = 1
            for j in range(1, d):
                row[j] = _gf_mul(row[j - 1], i)
        return m

    @staticmethod
    def _mat_mul(a, b):
        """GF(2^8) 矩阵乘法 a × b。"""
        rows, inner, cols = len(a), len(b), len(b[0])
        out = [[0] * cols for _ in range(rows)]
        for i in range(rows):
            ra = a[i]
            ro = out[i]
            for k in range(inner):
                aik = ra[k]
                if aik:
                    rb = b[k]
                    for j in range(cols):
                        if rb[j]:
                            ro[j] ^= _gf_mul(aik, rb[j])
        return out

    def _build_systematic_matrix(self):
        """范德蒙德矩阵转系统码形式 G = V · V_top^{-1}。

        V_top 为 V 的前 data 行（范德蒙德方阵，可逆）。右乘其逆后：
          - 前 data 行为 V_top · V_top^{-1} = I，即数据块原样输出；
          - 校验行为 V_bot · V_top^{-1}；
          - 任选 data 行得到 V_S · V_top^{-1}，两个可逆矩阵之积仍可逆，
            解码性质得以保持。
        V_top^{-1} 由高斯-若尔当消元（_invert_matrix）求出。
        """
        d = self.data_shards
        v = self._vandermonde()
        v_top = v[:d]
        top_inv = _invert_matrix(v_top)  # 真正的高斯消元求逆
        v_bot = v[d:]
        parity_part = self._mat_mul(v_bot, top_inv) if v_bot else []

        g = _identity(d)
        g.extend(parity_part)
        return g

    # -- 分片级 GF 线性组合 ----------------------------------------------

    @staticmethod
    def _gal_linear_combo(shards, coefficients, length):
        """计算 sum(coeffs[i] * shards[i])（GF 加即 XOR）。

        系数为 0 的分片直接跳过。使用 bytes.translate 逐字节域乘。
        """
        result = None
        for coeff, shard in zip(coefficients, shards):
            if coeff == 0:
                continue
            term = shard.translate(_MUL_TABLES[coeff])
            result = term if result is None else (
                # int XOR 是 CPython 上大块字节逐位异或的最快路径
                (int.from_bytes(result, "little")
                 ^ int.from_bytes(term, "little")).to_bytes(length, "little")
            )
        if result is None:
            return b"\x00" * length
        return result

    # -- 公有接口 ---------------------------------------------------------

    def encode(self, data: bytes):
        """把 data 切成 data_shards 个等长块（不足补零）并生成校验块。

        返回长度 data_shards + parity_shards 的块列表，每块长度相同。
        """
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError("data 必须是 bytes-like 对象")
        data = bytes(data)

        d = self.data_shards
        shard_len = (len(data) + d - 1) // d
        if shard_len == 0:
            shard_len = 1  # 空输入也产生确定长度（1 字节）的块

        shards = [b""] * self.total_shards
        for i in range(d):
            chunk = data[i * shard_len:(i + 1) * shard_len]
            shards[i] = chunk.ljust(shard_len, b"\x00")

        for r in range(d, self.total_shards):
            shards[r] = self._gal_linear_combo(
                shards[:d], self.matrix[r], shard_len)
        return shards

    def _validate_shards(self, shards, shard_len):
        if len(shards) != self.total_shards:
            raise ValueError(
                f"shards 长度应为 {self.total_shards}，实际为 {len(shards)}")
        if not isinstance(shard_len, int) or shard_len <= 0:
            raise ValueError("shard_len 必须为正整数")
        present = 0
        for idx, s in enumerate(shards):
            if s is None:
                continue
            present += 1
            if not isinstance(s, (bytes, bytearray)):
                raise TypeError(f"shards[{idx}] 必须是 bytes 或 None")
            if len(s) != shard_len:
                raise ValueError(
                    f"shards[{idx}] 长度为 {len(s)}，与 shard_len="
                    f"{shard_len} 不一致")
        return present

    def _reconstruct(self, shards, shard_len):
        """用存活块重建全部缺失块，返回 (完整块列表, 存活下标列表)。"""
        present = self._validate_shards(shards, shard_len)
        d = self.data_shards
        if present < d:
            raise ValueError(
                f"存活块不足：需要至少 {d} 个，当前只有 {present} 个，"
                f"还缺 {d - present} 个块")

        alive = [i for i, s in enumerate(shards) if s is not None]
        chosen = alive[:d]  # 取任意 d 个存活块；任意 d 行均满秩
        sub = [[self.matrix[r][c] for c in range(d)] for r in chosen]
        inv = _invert_matrix(sub)  # inv[c][k]：第 c 个原数据块对第 k 个存活块的系数

        rebuilt = list(shards)
        chosen_shards = [shards[i] for i in chosen]
        for c in range(d):
            target = c
            if rebuilt[target] is not None:
                continue
            rebuilt[target] = self._gal_linear_combo(
                chosen_shards, [inv[c][k] for k in range(d)], shard_len)

        # 缺失的若是校验块，数据块齐了之后直接重算即可。
        if any(s is None for s in rebuilt):
            for r in range(d, self.total_shards):
                if rebuilt[r] is None:
                    rebuilt[r] = self._gal_linear_combo(
                        rebuilt[:d], self.matrix[r], shard_len)
        return rebuilt, alive

    def decode(self, shards, shard_len, original_len):
        """从可能含 None 的块列表还原原始数据（去掉编码时的补零）。

        存活块少于 data_shards 时抛 ValueError 并说明还缺几块。
        """
        if not isinstance(original_len, int) or original_len < 0:
            raise ValueError("original_len 必须为非负整数")
        rebuilt, _ = self._reconstruct(list(shards), shard_len)
        data = b"".join(rebuilt[:self.data_shards])
        if len(data) < original_len:
            raise ValueError(
                f"original_len={original_len} 超过原始数据总容量 "
                f"{len(data)}（{self.data_shards} 块 × {shard_len} 字节）")
        return data[:original_len]

    def repair(self, shards, shard_len, original_len):
        """补全所有 None 位置，返回完整的 data+parity 块列表。

        original_len 用于确定编码时的补零布局：空输入对应 shard_len=1，
        否则 shard_len 必须等于 ceil(original_len / data_shards)。
        不一致（容量装不下或对不上补零布局）时抛 ValueError，绝不静默
        返回错误结果。原始长度不是 data_shards 整数倍时，末尾补零保留
        在块中，由 decode 按 original_len 截掉。
        """
        if not isinstance(original_len, int) or original_len < 0:
            raise ValueError("original_len 必须为非负整数")
        d = self.data_shards
        expected_shard_len = max(1, (original_len + d - 1) // d)
        if shard_len != expected_shard_len:
            raise ValueError(
                f"shard_len={shard_len} 与 original_len={original_len} 不匹配"
                f"（应为 {expected_shard_len}）")
        rebuilt, _ = self._reconstruct(list(shards), shard_len)
        return rebuilt

    def verify(self, shards, shard_len):
        """块齐全时重算校验块并逐字节比对。

        返回第一个不一致块的下标；数据块被篡改会导致后续校验块对不上，
        返回第一个失配的校验块下标。全部一致返回 -1。
        存在 None 或长度不符时抛 ValueError。
        """
        self._validate_shards(shards, shard_len)
        d = self.data_shards
        for i, s in enumerate(shards):
            if s is None:
                raise ValueError(f"shards[{i}] 缺失（None），verify 需要块齐全")

        for r in range(d, self.total_shards):
            expected = self._gal_linear_combo(
                shards[:d], self.matrix[r], shard_len)
            actual = shards[r]
            # 逐字节比对，不使用整块哈希。
            for offset in range(shard_len):
                if expected[offset] != actual[offset]:
                    return r
        return -1
