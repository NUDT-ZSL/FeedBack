"""候选裁决与静默矛盾诊断测试。"""

from __future__ import annotations

import itertools
import unittest

from storage_repair import coding
from storage_repair.diagnosis import (
    DiagnosisLimitReached,
    diagnose,
    resolve_candidates,
)


def make_codeword(k: int, m: int, blocks: list[bytes]):
    """返回 ``(codec, parity)``，blocks 为 k 个数据块。"""
    codec = coding.ReedSolomonCodec(k, m)
    parity = codec.encode_parity(blocks)
    return codec, parity


class CandidateResolutionTests(unittest.TestCase):
    """候选信任规则（严格多数、顺序无关）。"""

    def test_unanimous_single(self) -> None:
        decision = resolve_candidates([("r1", b"x")])
        self.assertEqual(decision.outcome, "unanimous")
        self.assertEqual(decision.content, b"x")
        self.assertEqual(decision.source, "r1")

    def test_all_identical_is_unanimous(self) -> None:
        decision = resolve_candidates([("a", b"x"), ("b", x := b"x"), ("c", b"x")])
        self.assertEqual(decision.outcome, "unanimous")
        self.assertEqual(decision.content, b"x")
        # 代表来源字典序最小。
        self.assertEqual(decision.source, "a")

    def test_strict_majority(self) -> None:
        decision = resolve_candidates(
            [("a", b"good"), ("b", b"good"), ("c", b"bad")]
        )
        self.assertEqual(decision.outcome, "majority")
        self.assertEqual(decision.content, b"good")
        self.assertEqual(decision.source, "a")

    def test_tie_is_conflict(self) -> None:
        decision = resolve_candidates([("a", b"x"), ("b", b"y")])
        self.assertEqual(decision.outcome, "conflict")
        self.assertIsNone(decision.content)
        self.assertIsNone(decision.source)
        self.assertEqual(len(decision.groups), 2)

    def test_plurality_without_majority_is_conflict(self) -> None:
        decision = resolve_candidates(
            [("a", b"x"), ("b", b"x"), ("c", b"y"), ("d", b"z")]
        )
        self.assertEqual(decision.outcome, "conflict")

    def test_order_independence(self) -> None:
        candidates = [
            ("a", b"x"), ("b", b"y"), ("c", b"x"),
            ("d", b"x"), ("e", b"z"),
        ]
        reference = None
        for perm in itertools.islice(itertools.permutations(range(5)), 0, 20):
            ordered = [candidates[i] for i in perm]
            decision = resolve_candidates(ordered)
            signature = (
                decision.outcome,
                decision.content,
                decision.source,
                [(g.count, g.fingerprint) for g in decision.groups],
            )
            if reference is None:
                reference = signature
            self.assertEqual(signature, reference)

    def test_empty_rejected(self) -> None:
        with self.assertRaises(ValueError):
            resolve_candidates([])


class DiagnosisTests(unittest.TestCase):
    """静默矛盾诊断（unique / ambiguous / underdetermined）。"""

    def setUp(self) -> None:
        self.k, self.m = 3, 2
        self.data = [b"\x01\x02", b"\x03\x04", b"\x05\x06"]
        self.codec, parity = make_codeword(self.k, self.m, self.data)
        self.codeword = self.data + parity

    def _contents(self, *positions: int) -> dict[int, bytes]:
        return {pos: self.codeword[pos] for pos in positions}

    def test_consistent_is_ok(self) -> None:
        result = diagnose(self.codec, self._contents(0, 1, 2, 3, 4))
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.sets, ())

    def test_exactly_k_positions_is_ok(self) -> None:
        # 任意 k 个块平凡一致，无法也无需定位错误。
        result = diagnose(self.codec, self._contents(0, 2, 4))
        self.assertEqual(result.status, "ok")

    def test_single_silent_parity_error_unique(self) -> None:
        contents = self._contents(0, 1, 2, 3, 4)
        bad = bytearray(contents[3])
        bad[0] ^= 0x01
        contents[3] = bytes(bad)
        result = diagnose(self.codec, contents)
        self.assertEqual(result.status, "unique")
        self.assertEqual(result.sets, ((3,),))
        self.assertTrue(result.verified)

    def test_single_silent_data_error_unique(self) -> None:
        contents = self._contents(0, 1, 2, 3, 4)
        bad = bytearray(contents[1])
        bad[1] ^= 0xFF
        contents[1] = bytes(bad)
        result = diagnose(self.codec, contents)
        self.assertEqual(result.status, "unique")
        self.assertEqual(result.sets, ((1,),))

    def test_two_silent_errors_underdetermined(self) -> None:
        # m=2：超过 floor(m/2)=1 个静默错误，无法唯一定位。
        contents = self._contents(0, 1, 2, 3, 4)
        for pos in (1, 3):
            bad = bytearray(contents[pos])
            bad[0] ^= 0xFF
            contents[pos] = bytes(bad)
        result = diagnose(self.codec, contents)
        self.assertEqual(result.status, "underdetermined")
        self.assertFalse(result.verified)
        # 所有 C(5,2)=10 个二元解释，按组合字典序。
        self.assertEqual(len(result.sets), 10)
        self.assertEqual(result.sets, tuple(itertools.combinations(range(5), 2)))

    def test_ambiguous_when_multiple_verified_explanations(self) -> None:
        # k=2,m=3（码距 4）：构造接收字，使删除 {0,1} 后与码字 A 一致、
        # 删除 {2,3} 后与另一码字 B 一致，且 A、B 在位置 4 重合。
        codec = coding.ReedSolomonCodec(2, 3)
        a = [b"aaaa", b"bbbb"]
        word_a = a + codec.encode_parity(a)

        # 求非零数据增量 delta，使第 2 个校验符号（位置 4）不变：
        # delta0*P[0][2] ^ delta1*P[1][2] == 0。
        p02 = codec.parity[0][2]
        p12 = codec.parity[1][2]
        delta0 = 1
        delta1 = coding.gf_div(p02, p12)
        b0 = bytes(symbol ^ delta0 for symbol in word_a[0])
        b1 = bytes(symbol ^ delta1 for symbol in word_a[1])
        word_b = [b0, b1] + codec.encode_parity([b0, b1])
        self.assertNotEqual(word_a[:2], word_b[:2])
        self.assertEqual(word_a[4], word_b[4])

        # 位置 0,1 取 B；2,3,4 取 A（4 上二者相同）。
        contents = {0: word_b[0], 1: word_b[1], 2: word_a[2],
                    3: word_a[3], 4: word_a[4]}
        result = diagnose(codec, contents)
        self.assertEqual(result.status, "ambiguous")
        self.assertGreaterEqual(len(result.sets), 2)
        sets_as_lists = [list(combo) for combo in result.sets]
        self.assertIn([0, 1], sets_as_lists)
        self.assertIn([2, 3], sets_as_lists)

    def test_deterministic_set_order(self) -> None:
        contents = self._contents(0, 1, 2, 3, 4)
        buf = bytearray(contents[1])
        buf[0] ^= 0xFF
        contents[1] = bytes(buf)
        first = diagnose(self.codec, contents)
        second = diagnose(self.codec, dict(contents))
        self.assertEqual(first.sets, second.sets)

    def test_cap_breach_raises(self) -> None:
        contents = self._contents(0, 1, 2, 3, 4)
        for pos in (1, 3):
            buf = bytearray(contents[pos])
            buf[0] ^= 0xFF
            contents[pos] = bytes(buf)
        with self.assertRaises(DiagnosisLimitReached):
            diagnose(self.codec, contents, cap=0)


class CorrectionRadiusPropertyTests(unittest.TestCase):
    """随机化验证：错误数不超过 floor(m/2) 时唯一最近码字译码必中。"""

    def test_within_radius_always_unique_and_correct(self) -> None:
        import random

        rng = random.Random(99)
        for k, m in [(3, 2), (4, 3), (5, 4), (6, 2), (2, 4)]:
            codec = coding.ReedSolomonCodec(k, m)
            data = [rng.randbytes(8) for _ in range(k)]
            codeword = data + codec.encode_parity(data)
            radius = m // 2
            for _ in range(40):
                # 随机选不超过半径的位置，各自翻转随机字节。
                count = rng.randint(1, max(1, radius))
                bad_positions = rng.sample(range(k + m), count)
                received = {pos: codeword[pos] for pos in range(k + m)}
                for pos in bad_positions:
                    buf = bytearray(codeword[pos])
                    buf[rng.randrange(len(buf))] ^= rng.randrange(1, 256)
                    received[pos] = bytes(buf)
                result = diagnose(codec, received)
                self.assertEqual(
                    result.status, "unique",
                    msg=f"k={k},m={m},bad={bad_positions},sets={result.sets}",
                )
                self.assertEqual(set(result.sets[0]), set(bad_positions))
                self.assertTrue(result.verified)


if __name__ == "__main__":
    unittest.main()
