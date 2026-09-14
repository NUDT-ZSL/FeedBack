"""GF(256) 运算与 Reed-Solomon 编解码测试。"""

from __future__ import annotations

import itertools
import random
import unittest

from storage_repair import coding


class GF256ArithmeticTests(unittest.TestCase):
    """GF(256) 域运算性质。"""

    def test_log_table_is_permutation(self) -> None:
        self.assertEqual(sorted(coding._LOG[1:]), list(range(255)))

    def test_zero_and_identity(self) -> None:
        for value in range(256):
            self.assertEqual(coding.gf_mul(value, 0), 0)
            self.assertEqual(coding.gf_mul(value, 1), value)
            self.assertEqual(coding.gf_add(value, 0), value)
            self.assertEqual(coding.gf_add(value, value), 0)

    def test_division_inverts_multiplication(self) -> None:
        for a in range(1, 256):
            for b in (1, 3, 55, 200, 255):
                product = coding.gf_mul(a, b)
                self.assertEqual(coding.gf_div(product, b), a)

    def test_inverse(self) -> None:
        for value in range(1, 256):
            inv = coding.gf_inverse(value)
            self.assertEqual(coding.gf_mul(value, inv), 1)
        with self.assertRaises(ZeroDivisionError):
            coding.gf_inverse(0)

    def test_commutativity_and_associativity(self) -> None:
        for a, b, c in [(3, 91, 17), (255, 255, 1), (100, 5, 60)]:
            self.assertEqual(coding.gf_mul(a, b), coding.gf_mul(b, a))
            self.assertEqual(
                coding.gf_mul(coding.gf_mul(a, b), c),
                coding.gf_mul(a, coding.gf_mul(b, c)),
            )


class ParityMatrixTests(unittest.TestCase):
    """Cauchy 校验矩阵形状与参数校验。"""

    def test_shape_and_nonzero(self) -> None:
        matrix = coding.cauchy_parity_matrix(3, 2)
        self.assertEqual(len(matrix), 3)
        self.assertEqual({len(row) for row in matrix}, {2})
        for row in matrix:
            self.assertTrue(all(value != 0 for value in row))

    def test_invalid_parameters(self) -> None:
        with self.assertRaises(ValueError):
            coding.ReedSolomonCodec(0, 1)
        with self.assertRaises(ValueError):
            coding.ReedSolomonCodec(256, 0)
        with self.assertRaises(ValueError):
            coding.ReedSolomonCodec(200, 100)
        with self.assertRaises(TypeError):
            coding.ReedSolomonCodec(3.0, 2)  # type: ignore[arg-type]


class EncodeDecodeTests(unittest.TestCase):
    """编码与任意 k 块重建（MDS 性质）。"""

    def setUp(self) -> None:
        random.seed(1234)

    def _random_data(self, k: int, length: int) -> list[bytes]:
        return [bytes(random.randrange(256) for _ in range(length)) for _ in range(k)]

    def test_encode_lengths(self) -> None:
        codec = coding.ReedSolomonCodec(3, 2)
        data = self._random_data(3, 8)
        parity = codec.encode_parity(data)
        self.assertEqual(len(parity), 2)
        self.assertEqual({len(block) for block in parity}, {8})

    def test_unequal_data_lengths_rejected(self) -> None:
        codec = coding.ReedSolomonCodec(3, 2)
        with self.assertRaises(ValueError):
            codec.encode_parity([b"a", b"bb", b"ccc"])
        with self.assertRaises(ValueError):
            codec.encode_parity(self._random_data(2, 4))

    def test_all_loss_patterns_reconstruct_exactly(self) -> None:
        """穷举：丢失 0..m 个位置的任意组合都能逐字节重建。"""
        for k, m, length in [(1, 1, 1), (1, 3, 5), (3, 2, 9), (4, 3, 7)]:
            with self.subTest(k=k, m=m):
                codec = coding.ReedSolomonCodec(k, m)
                blocks = self._random_data(k, length) + codec.encode_parity(
                    self._random_data(k, length)
                )
                # 重新生成，确保 parity 与 data 配对。
                data = self._random_data(k, length)
                blocks = data + codec.encode_parity(data)
                for size in range(m + 1):
                    for missing in itertools.combinations(range(k + m), size):
                        available = [
                            (pos, block)
                            for pos, block in enumerate(blocks)
                            if pos not in missing
                        ]
                        recovered, used = codec.reconstruct_positions(
                            available, list(missing)
                        )
                        for pos, content in zip(missing, recovered):
                            self.assertEqual(content, blocks[pos])
                        # 依据位置确定：可用位置中编号最小的 k 个。
                        expect_used = sorted(pos for pos, _ in available)[:k]
                        self.assertEqual(used, expect_used)

    def test_single_block_stripe(self) -> None:
        codec = coding.ReedSolomonCodec(1, 1)
        symbol = b"\xAB"
        parity = codec.encode_parity([symbol])
        expected = bytes([coding.gf_mul(0xAB, codec.parity[0][0])])
        self.assertEqual(parity, [expected])
        recovered, used = codec.reconstruct_positions([(1, parity[0])], [0])
        self.assertEqual(recovered, [symbol])
        self.assertEqual(used, [1])
        # 反向：由数据块重建校验块。
        recovered_parity, _ = codec.reconstruct_positions([(0, symbol)], [1])
        self.assertEqual(recovered_parity, [expected])

    def test_no_parity_stripe_rejects_reconstruction(self) -> None:
        codec = coding.ReedSolomonCodec(3, 0)
        data = self._random_data(3, 4)
        self.assertEqual(codec.encode_parity(data), [])
        with self.assertRaises(ValueError):
            codec.reconstruct_positions([(0, data[0]), (1, data[1])], [2])

    def test_bad_available_inputs(self) -> None:
        codec = coding.ReedSolomonCodec(3, 2)
        with self.assertRaises(ValueError):
            codec.reconstruct_positions([(0, b"aaaa"), (1, b"aaaa")], [2])
        with self.assertRaises(ValueError):
            codec.reconstruct_positions([(9, b"aaaa")] * 3, [0])
        with self.assertRaises(ValueError):
            codec.reconstruct_positions(
                [(0, b"a"), (1, b"aa"), (2, b"aaa")], [3]
            )
        with self.assertRaises(TypeError):
            codec.reconstruct_positions(
                [(0, "aaaa"), (1, "bbbb"), (2, "cccc")],  # type: ignore[list-item]
                [3],
            )


if __name__ == "__main__":
    unittest.main()
