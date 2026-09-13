"""补丁 JSON 持久化的单元测试：往返、保存后可应用、坏文件清晰报错。"""

from __future__ import annotations

import json
import os
import random
import tempfile
import unittest

from cdiff import CorruptPatchError, diff, patch, patch_size
from cdiff.persistence import (
    DOC_FORMAT,
    delta_from_dict,
    load_delta,
    save_delta,
)


def _pseudo_bytes(seed: int, n: int) -> bytes:
    rng = random.Random(seed)
    return bytes(rng.randrange(256) for _ in range(n))


class PersistenceRoundtripTests(unittest.TestCase):
    """save -> load 往返。"""

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="cdiff-test-")

    def tearDown(self) -> None:
        for name in os.listdir(self.tmp):
            os.remove(os.path.join(self.tmp, name))
        os.rmdir(self.tmp)

    def _path(self, name: str) -> str:
        return os.path.join(self.tmp, name)

    def test_save_load_roundtrip_and_applies(self) -> None:
        old = _pseudo_bytes(70, 200000)
        new = old[:80000] + b"CHANGED-BLOCK" * 10 + old[80000:]
        delta = diff(old, new)
        path = self._path("p1.json")
        save_delta(path, delta)

        loaded = load_delta(path)
        self.assertEqual(patch(old, loaded), new)
        self.assertEqual(patch_size(loaded), patch_size(delta))
        self.assertEqual(loaded.old_fingerprint.digest, delta.old_fingerprint.digest)
        self.assertEqual(loaded.new_fingerprint.digest, delta.new_fingerprint.digest)

    def test_saved_file_is_utf8_json(self) -> None:
        delta = diff(b"a" * 4000, b"a" * 4000 + b"b")
        path = self._path("p2.json")
        save_delta(path, delta)
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertEqual(doc["format"], DOC_FORMAT)
        self.assertEqual(doc["version"], 1)
        for key in ("ops", "old_fingerprint", "new_fingerprint", "config", "stats"):
            self.assertIn(key, doc)
        self.assertEqual(doc["stats"]["patch_size"], patch_size(delta))

    def test_dict_roundtrip(self) -> None:
        from cdiff.persistence import delta_to_dict

        delta = diff(_pseudo_bytes(71, 30000), _pseudo_bytes(72, 30000))
        doc = json.loads(json.dumps(delta_to_dict(delta)))
        rebuilt = delta_from_dict(doc)
        self.assertEqual(rebuilt.ops, delta.ops)
        self.assertEqual(rebuilt.old_fingerprint, delta.old_fingerprint)
        self.assertEqual(rebuilt.new_fingerprint, delta.new_fingerprint)

    def test_loaded_patch_rejects_wrong_old(self) -> None:
        old = _pseudo_bytes(73, 60000)
        new = old + b"tail"
        path = self._path("p3.json")
        save_delta(path, diff(old, new))
        loaded = load_delta(path)
        from cdiff import FingerprintMismatchError

        with self.assertRaises(FingerprintMismatchError):
            patch(b"?" + old[1:], loaded)


class CorruptFileTests(unittest.TestCase):
    """坏文件 / 缺字段 / 被截断必须清楚报错。"""

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="cdiff-bad-")
        self.good_path = os.path.join(self.tmp, "good.json")
        old = _pseudo_bytes(80, 60000)
        save_delta(self.good_path, diff(old, old + b"new-bytes"))
        with open(self.good_path, "r", encoding="utf-8") as fh:
            self.good_doc = json.load(fh)

    def tearDown(self) -> None:
        for name in os.listdir(self.tmp):
            os.remove(os.path.join(self.tmp, name))
        os.rmdir(self.tmp)

    def _load_doc(self, doc: object) -> None:
        path = os.path.join(self.tmp, "case.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh)
        load_delta(path)

    def test_file_not_found(self) -> None:
        with self.assertRaises(CorruptPatchError) as ctx:
            load_delta(os.path.join(self.tmp, "missing.json"))
        self.assertIn("cannot read", str(ctx.exception))

    def test_not_json(self) -> None:
        path = os.path.join(self.tmp, "garbage.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{ this is : not json ,,")
        with self.assertRaises(CorruptPatchError) as ctx:
            load_delta(path)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_truncated_json_file(self) -> None:
        path = os.path.join(self.tmp, "trunc.json")
        with open(self.good_path, "r", encoding="utf-8") as fh:
            text = fh.read()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text[: len(text) // 2])
        with self.assertRaises(CorruptPatchError):
            load_delta(path)

    def test_wrong_format(self) -> None:
        doc = dict(self.good_doc)
        doc["format"] = "something-else"
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_unsupported_version(self) -> None:
        doc = dict(self.good_doc)
        doc["version"] = 99
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_missing_top_level_fields(self) -> None:
        for key in ("ops", "old_fingerprint", "new_fingerprint", "config"):
            doc = dict(self.good_doc)
            del doc[key]
            with self.assertRaises(CorruptPatchError):
                self._load_doc(doc)

    def test_bad_op_type(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["ops"][0] = {"op": "RENAME"}
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_negative_copy(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["ops"] = [{"op": "COPY", "offset": -5, "length": 4}]
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_copy_out_of_range(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["ops"] = [{"op": "COPY", "offset": 0, "length": 10**9}]
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_add_undecodable_base64(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["ops"] = [{"op": "ADD", "data_b64": "@@@"}]
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_bad_fingerprint_format(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["old_fingerprint"]["digest"] = "not-hex!!"
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_missing_fingerprint_field(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        del doc["new_fingerprint"]["chunks"]
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_snapshot_truncated_detected(self) -> None:
        import base64

        doc = json.loads(json.dumps(self.good_doc))
        blob = base64.b64decode(doc["ops_binary_b64"])
        doc["ops_binary_b64"] = base64.b64encode(blob[:-3]).decode()
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_snapshot_tampered_detected(self) -> None:
        import base64

        doc = json.loads(json.dumps(self.good_doc))
        blob = bytearray(base64.b64decode(doc["ops_binary_b64"]))
        # 翻转第一条 COPY 指令 length 字段中的一个字节（魔数 4 字节之后）。
        blob[10] ^= 0x01
        doc["ops_binary_b64"] = base64.b64encode(bytes(blob)).decode()
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_snapshot_bad_base64_detected(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["ops_binary_b64"] = "~~~"
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_stats_patch_size_tampered_detected(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["stats"]["patch_size"] += 1
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)


if __name__ == "__main__":
    unittest.main()
