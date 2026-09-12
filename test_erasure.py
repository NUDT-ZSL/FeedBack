"""erasure.ErasureCodec 的 unittest 测试。

固定随机种子（SEED=20260912），全部用例可离线复现，仅依赖标准库。
"""

import itertools
import random
import time
import unittest

from erasure import ErasureCodec, _EXP, _LOG, _gf_div, _gf_inv, _gf_mul

SEED = 20260912


def _lose(shards, indices):
    out = list(shards)
    for i in indices:
        out[i] = None
    return out


class GaloisFieldTests(unittest.TestCase):
    """GF(2^8) 表与查表运算本身的正确性。"""

    def test_generator_has_full_order(self):
        # 生成元 2 的阶必须为 255（本原元），且绕回 1。
        self.assertEqual(_EXP[255], 1)
        self.assertNotEqual(_EXP[254], 1)
        self.assertEqual(len(_EXP), 512)

    def test_tables_match_0x11d_reference(self):
        # 用独立的“移位 + 0x11d 归约”参考实现逐对校验查表乘法。
        def ref_mul(a, b):
            result = 0
            for _ in range(8):
                if b & 1:
                    result ^= a
                b >>= 1
                a <<= 1
                if a & 0x100:
                    a ^= 0x11d
            return result

        for a in range(256):
            for b in range(256):
                self.assertEqual(_gf_mul(a, b), ref_mul(a, b))

    def test_mul_div_inv_identities(self):
        for a in range(1, 256):
            self.assertEqual(_gf_mul(_gf_inv(a), a), 1)
            for b in range(1, 256):
                self.assertEqual(_gf_div(_gf_mul(a, b), b), a)
        self.assertEqual(_gf_mul(0, 37), 0)
        self.assertEqual(_gf_div(0, 37), 0)
        self.assertEqual(_LOG[1], 0)
        with self.assertRaises(ZeroDivisionError):
            _gf_div(1, 0)
        with self.assertRaises(ZeroDivisionError):
            _gf_inv(0)


class ParameterValidationTests(unittest.TestCase):
    def test_invalid_params(self):
        cases = [
            (0, 1, "data_shards"),
            (256, 1, "data_shards"),
            (-1, 1, "data_shards"),
            (1, -1, "parity_shards"),
            (1, 256, "parity_shards"),
            (200, 57, "256"),       # 和超过 256
            (255, 2, "256"),
        ]
        for d, p, hint in cases:
            with self.subTest(d=d, p=p):
                with self.assertRaises(ValueError) as ctx:
                    ErasureCodec(d, p)
                self.assertIn(hint, str(ctx.exception))

    def test_non_int_rejected(self):
        with self.assertRaises(ValueError):
            ErasureCodec(1.5, 1)
        with self.assertRaises(ValueError):
            ErasureCodec(True, 1)  # bool 不得冒充 int
        with self.assertRaises(ValueError):
            ErasureCodec(2, "1")

    def test_boundary_params_accepted(self):
        ErasureCodec(1, 0)
        ErasureCodec(1, 255)
        ErasureCodec(255, 1)


class RoundTripTests(unittest.TestCase):
    def test_systematic_first_shards_are_raw_data(self):
        codec = ErasureCodec(4, 3)
        data = b"0123456789ab"  # 恰好整除，每块 3 字节
        shards = codec.encode(data)
        self.assertEqual(shards[:4], [b"012", b"345", b"678", b"9ab"])
        self.assertEqual(len(shards), 7)
        self.assertTrue(all(len(s) == 3 for s in shards))

    def test_padding_non_multiple_length(self):
        codec = ErasureCodec(4, 2)
        data = b"hello world"  # 11 字节，每块 3，补 1 字节零
        shards = codec.encode(data)
        self.assertTrue(all(len(s) == 3 for s in shards))
        # decode 去掉补零后长度必须与 original_len 一致
        self.assertEqual(codec.decode(shards, 3, len(data)), data)

    def test_empty_input(self):
        codec = ErasureCodec(3, 2)
        shards = codec.encode(b"")
        self.assertEqual(len(shards), 5)
        self.assertTrue(all(s == b"\x00" for s in shards))
        self.assertEqual(codec.decode(shards, 1, 0), b"")
        # 空输入下任意 <= parity 个块丢失仍可恢复
        for missing in itertools.combinations(range(5), 2):
            with self.subTest(missing=missing):
                got = codec.decode(_lose(shards, missing), 1, 0)
                self.assertEqual(got, b"")

    def test_single_shard_data_parity_zero(self):
        codec = ErasureCodec(1, 0)
        shards = codec.encode(b"abc")
        self.assertEqual(shards, [b"abc"])
        self.assertEqual(codec.decode(shards, 3, 3), b"abc")
        # 唯一一块丢失，无法恢复且报错要说明缺几块
        with self.assertRaises(ValueError) as ctx:
            codec.decode([None], 3, 3)
        self.assertIn("还缺 1", str(ctx.exception))

    def test_single_byte_with_parity(self):
        codec = ErasureCodec(1, 3)
        shards = codec.encode(b"\xab")
        self.assertEqual(len(shards), 4)
        for missing in range(4):
            with self.subTest(missing=missing):
                got = codec.decode(_lose(shards, [missing]), 1, 1)
                self.assertEqual(got, b"\xab")


class LossRecoveryTests(unittest.TestCase):
    def test_every_single_shard_loss_10_4(self):
        rng = random.Random(SEED)
        codec = ErasureCodec(10, 4)
        data = bytes(rng.randrange(256) for _ in range(10 * 137 + 7))
        shards = codec.encode(data)
        shard_len = len(shards[0])
        for missing in range(14):
            with self.subTest(missing=missing):
                got = codec.decode(
                    _lose(shards, [missing]), shard_len, len(data))
                self.assertEqual(got, data)

    def test_every_pair_loss_6_3(self):
        rng = random.Random(SEED + 1)
        codec = ErasureCodec(6, 3)
        data = bytes(rng.randrange(256) for _ in range(6 * 257 + 4))
        shards = codec.encode(data)
        shard_len = len(shards[0])
        for pair in itertools.combinations(range(9), 2):
            with self.subTest(pair=pair):
                got = codec.decode(_lose(shards, pair), shard_len, len(data))
                self.assertEqual(got, data)

    def test_all_data_shards_lost(self):
        # d=4,p=2：丢掉 2 个数据块，靠存活的 2 数据 + 2 校验恢复
        codec = ErasureCodec(4, 2)
        data = bytes(range(40))
        shards = codec.encode(data)
        got = codec.decode(_lose(shards, [0, 3]), 10, len(data))
        self.assertEqual(got, data)

    def test_random_losses_up_to_parity_10_4(self):
        rng = random.Random(SEED + 2)
        codec = ErasureCodec(10, 4)
        for trial in range(100):
            n = rng.randrange(4 * 100 + 1)
            data = bytes(rng.randrange(256) for _ in range(n))
            shards = codec.encode(data)
            shard_len = len(shards[0])
            k = rng.randint(1, 4)
            missing = rng.sample(range(14), k)
            with self.subTest(trial=trial, n=n, missing=sorted(missing)):
                got = codec.decode(
                    _lose(shards, missing), shard_len, len(data))
                self.assertEqual(got, data)

    def test_too_few_alive_reports_shortage(self):
        codec = ErasureCodec(3, 2)
        data = b"abcdefghi"
        shards = codec.encode(data)
        # 丢 3 块 -> 存活 2 < 3，还缺 1
        broken = _lose(shards, [0, 2, 4])
        with self.assertRaises(ValueError) as ctx:
            codec.decode(broken, 3, len(data))
        self.assertIn("还缺 1", str(ctx.exception))
        # 丢 4 块 -> 只活 1 个，还缺 2
        broken = _lose(shards, [0, 1, 2, 4])
        with self.assertRaises(ValueError) as ctx:
            codec.decode(broken, 3, len(data))
        self.assertIn("还缺 2", str(ctx.exception))

    def test_repair_fills_every_missing_slot(self):
        rng = random.Random(SEED + 3)
        codec = ErasureCodec(5, 3)
        data = bytes(rng.randrange(256) for _ in range(5 * 64 + 11))
        shards = codec.encode(data)
        shard_len = len(shards[0])
        missing = [1, 4, 7]  # 数据块与校验块同时缺失
        repaired = codec.repair(
            _lose(shards, missing), shard_len, len(data))
        self.assertEqual(len(repaired), 8)
        self.assertNotIn(None, repaired)
        # 补回的块必须与原始编码结果逐字节一致
        for i in range(8):
            with self.subTest(i=i):
                self.assertEqual(repaired[i], shards[i])
        # repair 后 decode 同样正确
        self.assertEqual(
            codec.decode(repaired, shard_len, len(data)), data)

    def test_repair_rejects_mismatched_shard_len(self):
        codec = ErasureCodec(4, 2)
        shards = codec.encode(b"hello world")  # shard_len=3
        with self.assertRaises(ValueError):
            codec.repair(_lose(shards, [0]), shard_len=4, original_len=11)
        with self.assertRaises(ValueError):
            codec.repair(shards, shard_len=3, original_len=13)  # 容量仅 12


class VerifyTests(unittest.TestCase):
    def test_verify_clean(self):
        codec = ErasureCodec(6, 4)
        data = bytes(range(6 * 20))
        shards = codec.encode(data)
        self.assertEqual(codec.verify(shards, 20), -1)

    def test_verify_detects_tampered_parity(self):
        codec = ErasureCodec(6, 4)
        data = bytes(range(6 * 20))
        shards = codec.encode(data)
        tampered = bytearray(shards[8])
        tampered[7] ^= 0xFF
        shards[8] = bytes(tampered)
        # 第一个失配的就是被篡改的校验块下标
        self.assertEqual(codec.verify(shards, 20), 8)

    def test_verify_detects_tampered_data(self):
        codec = ErasureCodec(6, 4)
        data = bytes(range(6 * 20))
        shards = codec.encode(data)
        tampered = bytearray(shards[2])
        tampered[13] ^= 0x01
        shards[2] = bytes(tampered)
        idx = codec.verify(shards, 20)
        # 数据被改 -> 至少一个重算校验块对不上，返回首个失配校验下标
        self.assertGreaterEqual(idx, 6)
        self.assertLess(idx, 10)

    def test_verify_is_bytewise_first_mismatch(self):
        # 两个校验块都被改时，必须返回下标更小的那个（逐字节比对语义）
        codec = ErasureCodec(4, 3)
        shards = codec.encode(b"x" * 40)
        shards[6] = b"\x00" * 10
        shards[5] = b"\x00" * 10
        self.assertEqual(codec.verify(shards, 10), 5)

    def test_verify_rejects_missing_or_bad_length(self):
        codec = ErasureCodec(3, 2)
        shards = codec.encode(b"abcdef")
        with self.assertRaises(ValueError):
            codec.verify(_lose(shards, [1]), 2)
        with self.assertRaises(ValueError):
            codec.verify(shards, shard_len=3)


class DecodeValidationTests(unittest.TestCase):
    def test_wrong_list_length(self):
        codec = ErasureCodec(3, 2)
        with self.assertRaises(ValueError):
            codec.decode([b"ab", b"ab"], 2, 4)

    def test_bad_shard_len(self):
        codec = ErasureCodec(3, 2)
        shards = codec.encode(b"abcdef")
        shards[1] = b"abc"  # 长度与声明不符
        with self.assertRaises(ValueError):
            codec.decode(shards, 2, 6)

    def test_original_len_too_large(self):
        codec = ErasureCodec(3, 2)
        shards = codec.encode(b"abcdef")
        with self.assertRaises(ValueError):
            codec.decode(shards, 2, 7)

    def test_negative_original_len(self):
        codec = ErasureCodec(3, 2)
        shards = codec.encode(b"abcdef")
        with self.assertRaises(ValueError):
            codec.decode(shards, 2, -1)


class PerformanceTests(unittest.TestCase):
    def test_one_megabyte_10_4_seconds_level(self):
        rng = random.Random(SEED + 4)
        codec = ErasureCodec(10, 4)
        data = bytes(rng.randrange(256) for _ in range(1024 * 1024))
        t0 = time.perf_counter()
        shards = codec.encode(data)
        enc_dt = time.perf_counter() - t0

        shard_len = len(shards[0])
        broken = _lose(shards, [2, 7, 11, 13])  # 4 块全丢（达到容错上限）
        t0 = time.perf_counter()
        recovered = codec.decode(broken, shard_len, len(data))
        dec_dt = time.perf_counter() - t0

        self.assertEqual(recovered, data)
        total = enc_dt + dec_dt
        print(f"\n[perf] 1MiB data=10 parity=4  "
              f"encode={enc_dt:.3f}s decode={dec_dt:.3f}s total={total:.3f}s")
        # 秒级要求；留足余量避免慢速环境抖动
        self.assertLess(total, 10.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
