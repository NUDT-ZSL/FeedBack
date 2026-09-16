"""单文件持久化与载入校验测试（需求 8）。"""
import copy
import json
import os
import tempfile
import unittest

from rng_core import Registry, parse_experiment, save, load, StoreCorruptError


def build_registry(with_conflicts=False, with_retry=False):
    reg = Registry()
    wire = {
        "id": "pi",
        "source": "local",
        "seed_policy": {"mode": "list", "seeds": [2, 5, 9, 14, 21, 33]},
        "params": [
            {"name": "n", "type": "int", "default": 1500, "min": 1,
             "max": 100000},
        ],
        "steps": [
            {"id": "cnt", "handler": "bernoulli_count",
             "draws": [{"id": "trials", "type": "bernoulli",
                        "count": "$params.n", "params": {"p": 0.5}}]},
        ],
    }
    if with_retry:
        wire["steps"].append({
            "id": "flaky", "handler": "flaky_overflow",
            "params": {"fail_first_n": 2},
            "draws": [{"id": "samples", "type": "uniform",
                       "count": 64, "params": {"low": 0, "high": 1}}],
            "retry": {"max_attempts": 3, "retry_on": ["overflow"]},
        })
    reg.register_experiment(parse_experiment(wire))
    reg.run_batch("pi", [("phat", "cnt", "p_hat")], source="local",
                  parallel_seeds=True)
    if with_retry:
        reg.run_policy("pi", source="local", parallel=True)
    if with_conflicts:
        w2 = copy.deepcopy(wire)
        w2["source"] = "teamB"
        w2["params"][0]["default"] = 900
        reg.register_experiment(parse_experiment(w2))
        other = reg.engine.run(reg.get_experiment("pi", "local"), 5,
                               {"n": 123})
        reg.store_result(other, "external-lab")
    return reg


class TestRoundTrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "store.json")

    def test_roundtrip_preserves_everything(self):
        reg = build_registry(with_conflicts=True, with_retry=True)
        save(reg, self.path)
        reg2 = load(self.path)

        self.assertEqual(reg2.experiment_ids(), reg.experiment_ids())
        self.assertEqual(reg2.sources_for("pi"), reg.sources_for("pi"))
        for seed in (2, 5, 9, 14, 21, 33):
            a = reg.get_result("pi", seed, source="local")
            b = reg2.get_result("pi", seed, source="local")
            self.assertEqual(a.fingerprint, b.fingerprint)
            self.assertEqual(a.to_dict()["steps"], b.to_dict()["steps"])

        # 重试记录往返：重放次数、尝试序列保留
        run = reg2.get_result("pi", 2, source="local")
        flaky = next(s for s in run.steps if s.sid == "flaky")
        self.assertEqual(flaky.replayed_attempts, 2)
        self.assertEqual([a.status for a in flaky.attempts],
                         ["failed", "failed", "success"])

        # 冲突记录往返且仍生效
        self.assertEqual(len(reg2.conflicts("pi")), len(reg.conflicts("pi")))
        kinds = sorted(c.kind for c in reg2.conflicts("pi"))
        self.assertIn("config", kinds)
        self.assertIn("result", kinds)
        from rng_core import AmbiguousReferenceError
        with self.assertRaises(AmbiguousReferenceError):
            reg2.get_experiment("pi")
        with self.assertRaises(AmbiguousReferenceError):
            reg2.get_result("pi", 5)

        # 统计查询往返一致
        ci1 = reg.confidence_interval("pi", "phat")
        ci2 = reg2.confidence_interval("pi", "phat")
        for k in ("mean", "variance", "ci_low", "ci_high", "n"):
            self.assertAlmostEqual(ci1[k], ci2[k], places=12)
        self.assertEqual(reg2.list_seeds("pi"), reg.list_seeds("pi"))

    def test_save_is_single_atomic_json_file(self):
        reg = build_registry()
        save(reg, self.path)
        self.assertTrue(os.path.isfile(self.path))
        self.assertEqual([f for f in os.listdir(self.tmp)
                          if f.startswith(".rngstore-")], [])
        with open(self.path, encoding="utf-8") as f:
            json.load(f)  # 必须是合法 JSON

    def test_save_load_deterministic_bytes(self):
        reg = build_registry()
        save(reg, self.path)
        with open(self.path, "rb") as f:
            first = f.read()
        path2 = os.path.join(self.tmp, "store2.json")
        save(load(self.path), path2)
        with open(path2, "rb") as f:
            second = f.read()
        self.assertEqual(first, second)


class TestCorruptionDetection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "store.json")
        self.reg = build_registry(with_retry=True)
        save(self.reg, self.path)

    def _reload_doc(self):
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    def _rewrite(self, doc, recompute_hash=False):
        if recompute_hash:
            from rng_core.engine import canonical_json
            import hashlib
            keys = ("format_version", "experiments", "results", "reports",
                    "conflicts", "param_values")
            doc["content_hash"] = hashlib.sha256(
                canonical_json({k: doc.get(k, []) for k in keys}
                               ).encode()).hexdigest()
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(doc, f)

    def test_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            load(os.path.join(self.tmp, "nope.json"))

    def test_broken_json(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{not json")
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertIn("JSON", str(cm.exception))

    def test_missing_top_level_field(self):
        doc = self._reload_doc()
        del doc["results"]
        self._rewrite(doc)
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertIn("results", str(cm.exception))

    def test_bad_format_version(self):
        doc = self._reload_doc()
        doc["format_version"] = 99
        self._rewrite(doc)
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertIn("format_version", str(cm.exception))

    def test_tampered_result_output_detected(self):
        doc = self._reload_doc()
        doc["results"][0]["result"]["steps"][0]["output"]["successes"] += 1
        self._rewrite(doc, recompute_hash=True)  # 越过外壳哈希，查内部指纹
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertIn("指纹", str(cm.exception))

    def test_tampered_declared_count_breaks_conservation(self):
        doc = self._reload_doc()
        step = doc["results"][0]["result"]["steps"][0]
        step["declared_draws"]["bernoulli"] += 1
        self._rewrite(doc, recompute_hash=True)
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertIn("守恒", str(cm.exception))

    def test_tampered_stream_key_detected(self):
        doc = self._reload_doc()
        step = doc["results"][0]["result"]["steps"][0]
        step["stream_keys"][0] = step["stream_keys"][0].replace("step=0",
                                                                "step=9")
        self._rewrite(doc, recompute_hash=True)
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertTrue("流键" in str(cm.exception)
                        or "指纹" in str(cm.exception))

    def test_step_sequence_mismatch_detected(self):
        doc = self._reload_doc()
        steps = doc["results"][0]["result"]["steps"]
        if len(steps) > 1:
            steps[0]["id"], steps[1]["id"] = steps[1]["id"], steps[0]["id"]
            self._rewrite(doc, recompute_hash=True)
            with self.assertRaises(StoreCorruptError):
                load(self.path)

    def test_duplicate_experiment_source_detected(self):
        doc = self._reload_doc()
        doc["experiments"].append(copy.deepcopy(doc["experiments"][0]))
        self._rewrite(doc, recompute_hash=True)
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertIn("唯一", str(cm.exception))

    def test_invalid_param_in_spec_detected(self):
        doc = self._reload_doc()
        doc["experiments"][0]["spec"]["params"][0]["max"] = 0
        # spec_digest 也会变；先看 digest 报错是否同样清晰
        self._rewrite(doc, recompute_hash=True)
        with self.assertRaises(StoreCorruptError):
            load(self.path)

    def test_report_statistics_recomputed(self):
        doc = self._reload_doc()
        summ = doc["reports"][0]["report"]["summaries"][0]
        summ["mean"] += 0.01
        self._rewrite(doc, recompute_hash=True)
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertIn("mean", str(cm.exception))

    def test_missing_conflict_record_detected(self):
        # 结果里确有矛盾，却删掉冲突记录 -> 必须报"漏报"
        reg = build_registry(with_conflicts=True)
        save(reg, self.path)
        doc = self._reload_doc()
        doc["conflicts"] = [c for c in doc["conflicts"]
                            if c["kind"] != "result"]
        self._rewrite(doc, recompute_hash=True)
        with self.assertRaises(StoreCorruptError) as cm:
            load(self.path)
        self.assertIn("冲突", str(cm.exception))

    def test_failure_leaves_existing_state_unchanged(self):
        good = load(self.path)            # 已知良好实例
        fp_before = good.get_result("pi", 2, source="local").fingerprint
        n_results_before = len(good.list_results("pi"))

        doc = self._reload_doc()
        doc["results"][0]["result"]["steps"][0]["output"]["successes"] += 1
        self._rewrite(doc, recompute_hash=True)
        with self.assertRaises(StoreCorruptError):
            load(self.path)  # 返回的是新实例；good 本身不可能被改变
        self.assertEqual(
            good.get_result("pi", 2, source="local").fingerprint, fp_before)
        self.assertEqual(len(good.list_results("pi")), n_results_before)


if __name__ == "__main__":
    unittest.main()
