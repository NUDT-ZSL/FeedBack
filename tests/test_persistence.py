"""需求 8：单文件保存/载入，唯一性/顺序/守恒校验，损坏清晰报错且状态不变。"""

import json
import os
import tempfile
import unittest

from detexp.errors import IntegrityError
from detexp.models import Experiment, Slice, Step
from detexp.persistence import (
    COVERED_SECTIONS,
    bundle_checksum,
    load_bundle_bytes,
)
from detexp.registry import ExperimentSystem
from detexp.steps import StepContext, register_step_fn

from .factories import make_normal_mean, make_pi, make_walk


class _TempBundle:
    def __init__(self):
        fd, self.path = tempfile.mkstemp(suffix=".json")
        os.close(fd)

    def cleanup(self):
        if os.path.exists(self.path):
            os.unlink(self.path)


def _populated_system():
    sys = ExperimentSystem()
    sys.register_experiment(make_pi(n=300))
    sys.batch_run("pi", seeds=[1, 2, 3, 4])
    sys.run("pi", seed=5, scheduling="parallel")
    return sys


class TestRoundTrip(unittest.TestCase):
    def setUp(self):
        self.tmp = _TempBundle()

    def tearDown(self):
        self.tmp.cleanup()

    def test_round_trip_preserves_results_and_layout(self):
        sys = _populated_system()
        sys.save(self.tmp.path)
        loaded = ExperimentSystem.load(self.tmp.path)
        for seed in [1, 2, 3, 4, 5]:
            before = sys.get_result("pi", seed)["runs"][0]
            after = loaded.get_result("pi", seed)["runs"][0]
            self.assertEqual(before["estimate"], after["estimate"])
            self.assertEqual(before["status"], after["status"])
        self.assertEqual(loaded.get_seeds("pi"), [1, 2, 3, 4, 5])
        u1 = loaded.get_stream_usage("pi", seed=1)
        self.assertTrue(u1["seeds"][0]["conserved"])
        self.assertEqual(u1["total_declared"], 600)

    def test_round_trip_preserves_conflicts_and_resolution(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=50), source="a")
        sys.register_experiment(make_normal_mean(n=20), source="b")
        cid = sys.list_conflicts(kind="config")[0].conflict_id
        sys.resolve_conflict(cid, "a")
        sys.run("nm", seed=1)
        sys.submit_result("nm", seed=1, source="ext", estimate=3.14)
        sys.save(self.tmp.path)
        loaded = ExperimentSystem.load(self.tmp.path)
        cs = loaded.list_conflicts()
        self.assertEqual(len(cs), 2)
        cfg = [c for c in cs if c.kind == "config"][0]
        self.assertEqual(cfg.status, "resolved_a")
        # 裁决后能正常执行且用的是 a 配置
        rec = loaded.run("nm", seed=2)
        self.assertEqual(rec.step_records[0].result["n"], 50)

    def test_round_trip_preserves_batch_summary_and_outlier_reason(self):
        def responder(ctx: StepContext, params):
            w = ctx.window(0)
            w.draw_many(w.count)
            return {"estimate": 9.0 if ctx.seed == 3 else 1.0}

        register_step_fn("resp_persist", responder)
        exp = Experiment(
            experiment_id="rp", param_specs=[],
            steps=[Step("r", "resp_persist",
                        slices=[Slice("uniform", 1)])])
        sys = ExperimentSystem()
        sys.register_experiment(exp)
        sys.batch_run("rp", seeds=[1, 2, 3, 4, 5])
        reason = sys.get_outlier_reason("rp", 3)
        sys.save(self.tmp.path)
        loaded = ExperimentSystem.load(self.tmp.path)
        self.assertEqual(loaded.get_outlier_reason("rp", 3), reason)
        ci = loaded.get_confidence_interval("rp")
        self.assertIsNotNone(ci)

    def test_walk_round_trip(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_walk(n=25))
        sys.run("walk", seed=42)
        sys.save(self.tmp.path)
        loaded = ExperimentSystem.load(self.tmp.path)
        a = sys.get_result("walk", 42)["runs"][0]
        b = loaded.get_result("walk", 42)["runs"][0]
        self.assertEqual(
            a["steps"][0]["result"]["final"],
            b["steps"][0]["result"]["final"])

    def test_file_is_single_json_document(self):
        sys = _populated_system()
        sys.save(self.tmp.path)
        with open(self.tmp.path, "rb") as f:
            doc = json.loads(f.read().decode("utf-8"))
        self.assertEqual(doc["format"], "detexp-bundle")
        self.assertIn("checksum", doc)
        for section in COVERED_SECTIONS:
            self.assertIn(section, doc)


class TestCorruption(unittest.TestCase):
    def setUp(self):
        self.tmp = _TempBundle()
        sys = _populated_system()
        sys.save(self.tmp.path)
        with open(self.tmp.path, "rb") as f:
            self.good_doc = json.loads(f.read().decode("utf-8"))

    def tearDown(self):
        self.tmp.cleanup()

    def _rechecksum(self, doc) -> bytes:
        body = {k: doc.get(k, [] if k != "variants" else {})
                for k in COVERED_SECTIONS}
        doc["checksum"]["value"] = bundle_checksum(body)
        return json.dumps(doc).encode("utf-8")

    def _expect(self, payload: bytes, needle: str = ""):
        with self.assertRaises(IntegrityError) as cm:
            load_bundle_bytes(payload, "<mem>")
        if needle:
            self.assertIn(needle, str(cm.exception))

    def test_truncated_file(self):
        raw = json.dumps(self.good_doc).encode()
        self._expect(raw[: len(raw) // 2])

    def test_not_json(self):
        self._expect(b"<<<not json>>>")

    def test_wrong_format_and_version(self):
        d = json.loads(json.dumps(self.good_doc))
        d["format"] = "else"
        self._expect(json.dumps(d).encode(), "format")
        d = json.loads(json.dumps(self.good_doc))
        d["version"] = 99
        self._expect(json.dumps(d).encode(), "version")

    def test_checksum_mismatch_on_tamper(self):
        d = json.loads(json.dumps(self.good_doc))
        d["runs"][0]["estimate"] = 12345.0
        self._expect(json.dumps(d).encode(), "校验和不匹配")

    def test_missing_section_field(self):
        d = json.loads(json.dumps(self.good_doc))
        del d["experiments"]
        self._expect(json.dumps(d).encode(), "校验和")

    def test_forged_draw_violates_conservation(self):
        d = json.loads(json.dumps(self.good_doc))
        d["runs"][0]["step_records"][0]["slices"][0][
            "sample_draws"][0][1] = 0.123456
        self._expect(self._rechecksum(d), "随机流不守恒")

    def test_duplicate_experiment_id(self):
        d = json.loads(json.dumps(self.good_doc))
        d["experiments"].append(json.loads(json.dumps(d["experiments"][0])))
        self._expect(self._rechecksum(d), "不唯一")

    def test_duplicate_run_seed(self):
        d = json.loads(json.dumps(self.good_doc))
        d["runs"].append(json.loads(json.dumps(d["runs"][0])))
        self._expect(self._rechecksum(d), "多条本地运行记录")

    def test_overconsumption_outside_window(self):
        d = json.loads(json.dumps(self.good_doc))
        d["runs"][0]["step_records"][0]["slices"][0]["consumed"] = 10**9
        self._expect(self._rechecksum(d), "越界")

    def test_dangling_param_reference_in_bundle(self):
        d = json.loads(json.dumps(self.good_doc))
        d["experiments"][0]["steps"][0]["params"] = {"x": {"$param": "nope"}}
        self._expect(self._rechecksum(d), "不存在的参数")

    def test_wrong_step_order(self):
        d = json.loads(json.dumps(self.good_doc))
        # 把一个运行记录的步骤标识改成配置里不存在的顺序
        d["runs"][0]["step_records"][0]["step_id"] = "ghost_step"
        self._expect(self._rechecksum(d), "步骤顺序")

    def test_fabricated_summary(self):
        d = json.loads(json.dumps(self.good_doc))
        # 当前没有 summary；直接构造一个统计与估计不符的
        d["batch_summaries"] = [self._fake_summary()]
        self._expect(self._rechecksum(d))

    @staticmethod
    def _fake_summary():
        return {
            "experiment_id": "pi", "ci_level": 0.95,
            "seeds": [1, 2, 3, 4],
            "estimates": {"1": 3.1, "2": 3.2, "3": 3.0, "4": 3.15},
            "mean": 99.0, "variance": 0.01, "std": 0.1,
            "ci_low": 98.0, "ci_high": 100.0, "outliers": [],
            "method": "mean+t(loo-z@2.5)"}

    def test_unknown_experiment_reference(self):
        d = json.loads(json.dumps(self.good_doc))
        d["runs"][0]["experiment_id"] = "ghost"
        self._expect(self._rechecksum(d), "未知实验")

    def test_bad_utf8(self):
        self._expect(b"\xff\xfe\x00bad")


class TestStateUnchanged(unittest.TestCase):
    def setUp(self):
        self.tmp = _TempBundle()

    def tearDown(self):
        self.tmp.cleanup()

    def test_failed_load_into_leaves_state_intact(self):
        sys = _populated_system()
        ids_before = sys.list_experiment_ids()
        seeds_before = sys.get_seeds("pi")
        with open(self.tmp.path, "wb") as f:
            f.write(b"{broken")
        with self.assertRaises(IntegrityError):
            sys.load_into(self.tmp.path)
        self.assertEqual(sys.list_experiment_ids(), ids_before)
        self.assertEqual(sys.get_seeds("pi"), seeds_before)

    def test_missing_file_raises_integrity_error(self):
        with self.assertRaises(IntegrityError):
            ExperimentSystem.load(os.path.join(self.tmp.path, "nope.json"))

    def test_save_is_atomic_no_partial_file_on_serialization_error(self):
        sys = _populated_system()

        class Bad:
            pass

        # 强行注入不可序列化对象到 claims
        sys._claims[("pi", 1, "ext")] = {
            "experiment_id": "pi", "seed": 1, "source": "ext",
            "status": "ok", "estimate": Bad(), "detail": None}
        os.unlink(self.tmp.path)
        with self.assertRaises(TypeError):
            sys.save(self.tmp.path)
        # 失败时只清理自己的临时文件，绝不 os.replace：目标路径不存在
        self.assertFalse(os.path.exists(self.tmp.path))
        # 已有旧文件时也不能被破坏
        sys2 = _populated_system()
        sys2.save(self.tmp.path)
        with open(self.tmp.path, "rb") as f:
            good_bytes = f.read()
        with self.assertRaises(TypeError):
            sys.save(self.tmp.path)
        with open(self.tmp.path, "rb") as f:
            self.assertEqual(f.read(), good_bytes)


if __name__ == "__main__":
    unittest.main()
