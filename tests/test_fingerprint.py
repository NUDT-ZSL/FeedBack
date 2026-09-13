"""指纹计算的单元测试：稳定性、局部性、空内容与序列化校验。"""

from __future__ import annotations

import hashlib
import random
import unittest

from cdiff import ChunkConfig, fingerprint
from cdiff.fingerprint import (
    FINGERPRINT_VERSION,
    ChunkFingerprint,
    Fingerprint,
    merge_chunk_digests,
)


def _pseudo_bytes(seed: int, n: int) -> bytes:
    rng = random.Random(seed)
    return bytes(rng.randrange(256) for _ in range(n))


class FingerprintBasicTests(unittest.TestCase):
    """基本性质。"""

    def test_empty_content_is_stable_and_nonempty_digest(self) -> None:
        f1 = fingerprint(b"")
        f2 = fingerprint(b"")
        self.assertEqual(f1.digest, f2.digest)
        self.assertEqual(len(f1.digest), 64)
        self.assertEqual(f1.size, 0)
        self.assertEqual(f1.chunk_count, 0)
        self.assertEqual(f1.chunk_sizes, [])
        # 空内容摘要与“对空字节直接做 sha256”不同（带块数/长度后缀），
        # 但必须是确定值。
        self.assertEqual(f1.digest, merge_chunk_digests([], 0))

    def test_single_byte(self) -> None:
        f = fingerprint(b"q")
        self.assertEqual(f.size, 1)
        self.assertEqual(f.chunk_count, 1)
        self.assertEqual(f.chunk_sizes, [1])
        self.assertEqual(f.chunks[0].digest, hashlib.sha256(b"q").hexdigest())

    def test_stability_same_input_same_fingerprint(self) -> None:
        data = _pseudo_bytes(11, 70000)
        cfg = ChunkConfig(avg_size=512, min_size=128, max_size=2048)
        f1 = fingerprint(data, cfg)
        f2 = fingerprint(data, cfg)
        self.assertEqual(f1, f2)
        self.assertEqual(f1.digest, f2.digest)
        self.assertEqual(f1.chunk_sizes, f2.chunk_sizes)
        self.assertEqual(
            [c.digest for c in f1.chunks], [c.digest for c in f2.chunks]
        )

    def test_chunk_digests_are_real_sha256(self) -> None:
        data = _pseudo_bytes(12, 20000)
        f = fingerprint(data)
        pos = 0
        for cf in f.chunks:
            self.assertEqual(cf.offset, pos)
            self.assertEqual(
                cf.digest, hashlib.sha256(data[pos : pos + cf.length]).hexdigest()
            )
            pos += cf.length
        self.assertEqual(pos, len(data))

    def test_total_size_matches(self) -> None:
        data = _pseudo_bytes(13, 12345)
        f = fingerprint(data, ChunkConfig(avg_size=256, min_size=64, max_size=1024))
        self.assertEqual(sum(f.chunk_sizes), f.size)

    def test_different_content_differs(self) -> None:
        f1 = fingerprint(_pseudo_bytes(14, 30000))
        f2 = fingerprint(_pseudo_bytes(15, 30000))
        self.assertNotEqual(f1.digest, f2.digest)

    def test_config_changes_can_change_chunking(self) -> None:
        data = _pseudo_bytes(16, 30000)
        coarse = fingerprint(data, ChunkConfig(avg_size=2048, min_size=512, max_size=8192))
        fine = fingerprint(data, ChunkConfig(avg_size=128, min_size=32, max_size=512))
        self.assertLess(coarse.chunk_count, fine.chunk_count)


class FingerprintLocalityTests(unittest.TestCase):
    """改一个字节只影响局部。"""

    def test_one_byte_flip_changes_one_chunk_fingerprint(self) -> None:
        data = _pseudo_bytes(17, 80000)
        cfg = ChunkConfig(avg_size=1024, min_size=256, max_size=4096)
        before = fingerprint(data, cfg)
        mutated = bytearray(data)
        mutated[40000] ^= 0x01
        after = fingerprint(bytes(mutated), cfg)

        d_before = [c.digest for c in before.chunks]
        d_after = [c.digest for c in after.chunks]
        # 大小不变 -> 块边界不整体平移，最多一个块内容变化。
        self.assertIn(abs(len(d_before) - len(d_after)), (0, 1))
        changed = sum(1 for a, b in zip(d_before, d_after) if a != b)
        self.assertLessEqual(changed, 1)
        # 整文件指纹必然变化。
        self.assertNotEqual(before.digest, after.digest)

    def test_prefix_blocks_stay_identical_after_append(self) -> None:
        data = _pseudo_bytes(18, 80000)
        cfg = ChunkConfig(avg_size=512, min_size=128, max_size=2048)
        before = fingerprint(data, cfg)
        appended = data + b"TAIL-BYTES" * 10
        after = fingerprint(appended, cfg)
        # 追加内容不应改变原有块的任何指纹。
        common = [
            (a, b)
            for a, b in zip(before.chunks, after.chunks)
            if a.digest == b.digest and a.length == b.length
        ]
        self.assertGreaterEqual(len(common), before.chunk_count - 1)


class FingerprintSerializationTests(unittest.TestCase):
    """to_dict/from_dict 与格式校验。"""

    def test_roundtrip(self) -> None:
        f = fingerprint(_pseudo_bytes(19, 30000))
        rebuilt = type(f).from_dict(f.to_dict())
        self.assertEqual(f, rebuilt)
        self.assertEqual(f.chunks, rebuilt.chunks)
        self.assertEqual(f.config, rebuilt.config)
        self.assertEqual(rebuilt.to_dict(), f.to_dict())

    def test_version_field(self) -> None:
        doc = fingerprint(b"abc").to_dict()
        self.assertEqual(doc["version"], FINGERPRINT_VERSION)
        self.assertEqual(doc["algorithm"], "sha256")

    def test_bad_digest_rejected(self) -> None:
        doc = fingerprint(b"abc").to_dict()
        doc["digest"] = "z" * 64
        with self.assertRaises(ValueError):
            Fingerprint.from_dict(doc)
        doc2 = fingerprint(b"abc").to_dict()
        doc2["digest"] = "abc"
        with self.assertRaises(ValueError):
            Fingerprint.from_dict(doc2)

    def test_tampered_digest_rejected_and_names_both_digests(self) -> None:
        """整文件指纹必须由块指纹重算合并得到；伪造一个语法合法的
        摘要无法通过校验，错误信息同时给出记录值与重算值。"""
        f = fingerprint(_pseudo_bytes(24, 30000))
        doc = f.to_dict()
        genuine = f.digest
        forged = ("f" if genuine[0] != "f" else "0") + genuine[1:]
        self.assertNotEqual(forged, genuine)
        doc["digest"] = forged
        with self.assertRaises(ValueError) as ctx:
            Fingerprint.from_dict(doc)
        message = str(ctx.exception)
        self.assertIn(forged, message)
        self.assertIn(genuine, message)
        self.assertIn("recomputed", message)

    def test_empty_content_tampered_digest_rejected(self) -> None:
        # 空内容没有块，伪造摘要同样必须被重算合并校验拦下。
        doc = fingerprint(b"").to_dict()
        doc["digest"] = "0" * 64
        with self.assertRaises(ValueError):
            Fingerprint.from_dict(doc)

    def test_size_mismatch_rejected(self) -> None:
        doc = fingerprint(_pseudo_bytes(20, 5000)).to_dict()
        doc["size"] += 1
        with self.assertRaises(ValueError):
            Fingerprint.from_dict(doc)

    def test_chunk_count_mismatch_rejected(self) -> None:
        doc = fingerprint(_pseudo_bytes(21, 5000)).to_dict()
        doc["chunk_count"] += 2
        with self.assertRaises(ValueError):
            Fingerprint.from_dict(doc)

    def test_bad_chunk_entry_rejected(self) -> None:
        doc = fingerprint(_pseudo_bytes(22, 5000)).to_dict()
        doc["chunks"][0]["offset"] = -1
        with self.assertRaises(ValueError):
            Fingerprint.from_dict(doc)
        doc2 = fingerprint(_pseudo_bytes(23, 5000)).to_dict()
        doc2["chunks"][0]["digest"] = "xx"
        with self.assertRaises(ValueError):
            Fingerprint.from_dict(doc2)

    def test_chunk_fingerprint_validates_fields(self) -> None:
        with self.assertRaises(ValueError):
            ChunkFingerprint.from_dict({"offset": 0, "length": 1, "digest": 1})
        with self.assertRaises(ValueError):
            ChunkFingerprint.from_dict("nope")  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
