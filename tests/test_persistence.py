"""补丁 JSON 持久化的单元测试：往返、保存后可应用、坏文件清晰报错。"""

from __future__ import annotations

import json
import os
import random
import tempfile
import unittest

from cdiff import ChunkConfig, CorruptPatchError, diff, patch, patch_size
from cdiff.delta import Delta
from cdiff.persistence import (
    DOC_FORMAT,
    delta_from_dict,
    delta_to_dict,
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

    def test_every_saved_field_roundtrips_exactly(self) -> None:
        """save 写出的每个字段在 load 后都必须原样取回。

        覆盖：分块配置三项、统计信息全部字段、旧/新指纹全字段、
        指令列表逐条一致；并验证用同样配置重新 diff 得到相同补丁，
        即配置不可能被默认值悄悄顶替。
        """
        cfg = ChunkConfig(avg_size=777, min_size=200, max_size=3000)
        old = _pseudo_bytes(74, 200000)
        new = old[:90000] + b"NEW-SEGMENT" * 20 + old[90100:] + b"T"
        delta = diff(old, new, cfg)
        path = self._path("full.json")
        save_delta(path, delta)

        # 1) 落盘 JSON 文档层面逐字段比对。
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertEqual(doc["config"], cfg.to_dict())
        self.assertEqual(doc["config"], {
            "avg_size": 777,
            "min_size": 200,
            "max_size": 3000,
        })
        self.assertEqual(doc["old_fingerprint"], delta.old_fingerprint.to_dict())
        self.assertEqual(doc["new_fingerprint"], delta.new_fingerprint.to_dict())
        self.assertEqual(doc["ops"], [op.to_dict() for op in delta.ops])
        self.assertEqual(doc["stats"], delta.stats())

        # 2) load 重建后的对象层面逐字段比对。
        loaded = load_delta(path)
        self.assertIsInstance(loaded, Delta)
        self.assertEqual(loaded.config, cfg)
        self.assertEqual(loaded.old_fingerprint, delta.old_fingerprint)
        self.assertEqual(loaded.new_fingerprint, delta.new_fingerprint)
        self.assertEqual(loaded.old_fingerprint.digest, delta.old_fingerprint.digest)
        self.assertEqual(loaded.new_fingerprint.digest, delta.new_fingerprint.digest)
        self.assertEqual(loaded.ops, delta.ops)
        self.assertEqual(len(loaded.ops), len(delta.ops))
        for a, b in zip(loaded.ops, delta.ops):
            self.assertEqual(type(a), type(b))
            self.assertEqual(a, b)
        self.assertEqual(loaded.stats(), delta.stats())
        self.assertEqual(patch_size(loaded), patch_size(delta))

        # 3) 配置保真：用取回的配置对同一对内容重新 diff，补丁必须一致。
        re_diffed = diff(old, new, loaded.config)
        self.assertEqual(re_diffed.ops, delta.ops)
        self.assertEqual(patch_size(re_diffed), patch_size(delta))
        self.assertEqual(
            re_diffed.new_fingerprint.digest, delta.new_fingerprint.digest
        )

        # 4) 取回的补丁仍可正常应用。
        self.assertEqual(patch(old, loaded), new)


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

    def test_tampered_old_file_digest_rejected_with_both_digests(self) -> None:
        """语法合法但被篡改的整文件指纹必须在重建阶段被拒绝，
        且错误信息同时给出记录值与重算值两个指纹。"""
        doc = json.loads(json.dumps(self.good_doc))
        recorded = doc["old_fingerprint"]["digest"]
        tampered = ("f" if recorded[0] != "f" else "0") + recorded[1:]
        self.assertNotEqual(tampered, recorded)
        doc["old_fingerprint"]["digest"] = tampered
        with self.assertRaises(CorruptPatchError) as ctx:
            self._load_doc(doc)
        message = str(ctx.exception)
        self.assertIn(tampered, message)      # 记录的（伪造）指纹
        self.assertIn(recorded, message)      # 由块指纹重算出的真实指纹
        self.assertIn("recomputed", message)

    def test_tampered_new_file_digest_rejected(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        recorded = doc["new_fingerprint"]["digest"]
        doc["new_fingerprint"]["digest"] = "0" * 64
        with self.assertRaises(CorruptPatchError) as ctx:
            self._load_doc(doc)
        message = str(ctx.exception)
        self.assertIn("0" * 64, message)
        self.assertIn(recorded, message)

    def test_tampered_chunk_digest_breaks_merge_check(self) -> None:
        """篡改任一块指纹也会让重算合并结果对不上整文件指纹。"""
        doc = json.loads(json.dumps(self.good_doc))
        entry = doc["old_fingerprint"]["chunks"][0]
        entry["digest"] = ("0" if entry["digest"][0] != "0" else "1") + entry["digest"][1:]
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_illegal_top_level_config_rejected_at_load(self) -> None:
        """最小大于最大 / 平均块大小为 0：重建阶段就必须拒绝。"""
        for bad_config in (
            {"avg_size": 0, "min_size": 1, "max_size": 2},
            {"avg_size": 16, "min_size": 64, "max_size": 32},
            {"avg_size": -4, "min_size": 0, "max_size": 8},
        ):
            doc = json.loads(json.dumps(self.good_doc))
            doc["config"] = bad_config
            with self.assertRaises(CorruptPatchError) as ctx:
                self._load_doc(doc)
            self.assertIn("config", str(ctx.exception))

    def test_illegal_config_inside_fingerprint_rejected_at_load(self) -> None:
        """非法配置藏在指纹对象里同样要在重建阶段被拒绝。"""
        doc = json.loads(json.dumps(self.good_doc))
        doc["old_fingerprint"]["config"] = {
            "avg_size": 0,
            "min_size": 0,
            "max_size": 0,
        }
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_config_mismatching_fingerprint_rejected(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["config"]["avg_size"] = doc["config"]["avg_size"] * 2 + 1
        with self.assertRaises(CorruptPatchError) as ctx:
            self._load_doc(doc)
        self.assertIn("config", str(ctx.exception))

    def test_missing_fingerprint_field(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        del doc["new_fingerprint"]["chunks"]
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_missing_stats_rejected(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        del doc["stats"]
        with self.assertRaises(CorruptPatchError) as ctx:
            self._load_doc(doc)
        self.assertIn("stats", str(ctx.exception))

    def test_stats_not_object_rejected(self) -> None:
        doc = json.loads(json.dumps(self.good_doc))
        doc["stats"] = [1, 2, 3]
        with self.assertRaises(CorruptPatchError):
            self._load_doc(doc)

    def test_any_stats_field_tampered_rejected(self) -> None:
        for key in ("copied_bytes", "added_bytes", "copy_ops", "add_ops",
                    "old_size", "new_size"):
            doc = json.loads(json.dumps(self.good_doc))
            original = doc["stats"][key]
            doc["stats"][key] = original + 1
            with self.assertRaises(CorruptPatchError) as ctx:
                self._load_doc(doc)
            self.assertIn(key, str(ctx.exception))

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
