"""Unit tests for the hotspot kernel and its CLI. Run: python -m unittest -v"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from hotspot import Access, HotspotKernel, MaxKeysExceededError

MAIN = Path(__file__).resolve().parent / "main.py"


class AccessValidationTests(unittest.TestCase):
    def test_defaults(self):
        a = Access(key="k")
        self.assertEqual(a.weight, 1)
        self.assertEqual(a.ts, 0)

    def test_empty_key_rejected(self):
        with self.assertRaisesRegex(ValueError, "non-empty string"):
            Access(key="")
        with self.assertRaisesRegex(ValueError, "non-empty string"):
            Access(key=123)

    def test_bad_weight_rejected(self):
        with self.assertRaisesRegex(ValueError, ">= 1"):
            Access(key="k", weight=0)
        with self.assertRaisesRegex(ValueError, ">= 1"):
            Access(key="k", weight=-3)
        with self.assertRaisesRegex(ValueError, "integer"):
            Access(key="k", weight=1.5)
        with self.assertRaisesRegex(ValueError, "integer"):
            Access(key="k", weight=True)

    def test_negative_ts_rejected(self):
        with self.assertRaisesRegex(ValueError, ">= 0"):
            Access(key="k", ts=-1)
        with self.assertRaisesRegex(ValueError, "integer"):
            Access(key="k", ts=1.5)


class ConfigValidationTests(unittest.TestCase):
    def test_decay_bounds(self):
        HotspotKernel(decay=1.0)  # upper bound allowed
        HotspotKernel(decay=0.001)
        for bad in (0.0, -0.1, 1.5, 2):
            with self.assertRaisesRegex(ValueError, r"\(0, 1\]"):
                HotspotKernel(decay=bad)

    def test_other_config_validation(self):
        with self.assertRaisesRegex(ValueError, "min_score"):
            HotspotKernel(min_score=-1)
        with self.assertRaisesRegex(ValueError, "capacity"):
            HotspotKernel(capacity=0)
        with self.assertRaisesRegex(ValueError, "max_keys"):
            HotspotKernel(max_keys=0)
        with self.assertRaisesRegex(ValueError, "window"):
            HotspotKernel(window=0)
        with self.assertRaisesRegex(ValueError, "burst_factor"):
            HotspotKernel(burst_factor=0)
        with self.assertRaisesRegex(ValueError, "overflow"):
            HotspotKernel(overflow="bogus")


class DecayTests(unittest.TestCase):
    def test_decay_math(self):
        k = HotspotKernel(decay=0.9)
        k.add(Access(key="a", weight=10, ts=0))
        s = k.add(Access(key="a", weight=5, ts=1))
        self.assertAlmostEqual(s, 10 * 0.9 + 5)
        self.assertAlmostEqual(k.score("a", now=2), (10 * 0.9 + 5) * 0.9)
        self.assertAlmostEqual(k.score("a", now=12), 14 * 0.9 ** 11)

    def test_decay_one_means_no_decay(self):
        k = HotspotKernel(decay=1.0)
        k.add(Access(key="a", weight=2, ts=0))
        k.add(Access(key="a", weight=3, ts=100))
        self.assertEqual(k.score("a", now=10_000), 5.0)

    def test_weight_accumulates(self):
        k = HotspotKernel()
        k.add(Access(key="a", weight=4, ts=5))
        self.assertAlmostEqual(k.score("a", now=5), 4.0)

    def test_unknown_key_scores_zero(self):
        self.assertEqual(HotspotKernel().score("nope", now=5), 0.0)

    def test_out_of_order_rejected(self):
        k = HotspotKernel()
        k.add(Access(key="a", ts=10))
        with self.assertRaisesRegex(ValueError, "out-of-order"):
            k.add(Access(key="a", ts=9))
        # other keys are unaffected
        k.add(Access(key="b", ts=1))

    def test_query_with_earlier_now_does_not_fail(self):
        k = HotspotKernel()
        k.add(Access(key="a", weight=7, ts=100))
        self.assertEqual(k.score("a", now=50), 7.0)


class EvictTests(unittest.TestCase):
    def test_order_score_then_key(self):
        k = HotspotKernel(decay=1.0)
        k.add(Access(key="b", weight=2, ts=0))
        k.add(Access(key="a", weight=2, ts=0))  # tie with b -> key asc
        k.add(Access(key="c", weight=1, ts=0))
        k.add(Access(key="d", weight=9, ts=0))
        self.assertEqual(k.evict_candidates(3), ["c", "a", "b"])
        self.assertEqual(k.evict_candidates(1), ["c"])

    def test_stable_order_across_calls(self):
        k = HotspotKernel(decay=1.0)
        for key in ("x", "y", "z"):
            k.add(Access(key=key, ts=0))
        self.assertEqual(k.evict_candidates(3), k.evict_candidates(3))

    def test_min_score_keys_always_included(self):
        k = HotspotKernel(decay=1.0, min_score=1.0)
        k.add(Access(key="cold1", weight=0 + 1, ts=0))  # score 1.0 -> not below
        k._scores["cold1"] = [0.5, 0]  # below min_score
        k._scores["cold2"] = [0.1, 0]  # below min_score
        k.add(Access(key="hot", weight=100, ts=0))
        # n=1 but two keys are below min_score -> both appear, list exceeds n
        self.assertEqual(k.evict_candidates(1), ["cold2", "cold1"])
        # n=0 returns exactly the below-min_score keys
        self.assertEqual(k.evict_candidates(0), ["cold2", "cold1"])

    def test_bad_n_rejected(self):
        with self.assertRaisesRegex(ValueError, "n must be"):
            HotspotKernel().evict_candidates(-1)


class AdmitTests(unittest.TestCase):
    def test_admit_until_full(self):
        k = HotspotKernel(decay=1.0, capacity=2)
        self.assertTrue(k.admit("a"))
        self.assertTrue(k.admit("b"))
        self.assertEqual(k.cache, ["a", "b"])

    def test_full_cache_rejects_colder_key(self):
        k = HotspotKernel(decay=1.0, capacity=1)
        k.add(Access(key="hot", weight=10, ts=0))
        k.admit("hot")
        self.assertFalse(k.admit("nobody"))  # score 0.0 < 10
        self.assertEqual(k.cache, ["hot"])

    def test_full_cache_evicts_coldest(self):
        k = HotspotKernel(decay=1.0, capacity=2)
        k.add(Access(key="cold", weight=1, ts=0))
        k.add(Access(key="warm", weight=5, ts=0))
        k.add(Access(key="hot", weight=9, ts=0))
        k.admit("cold")
        k.admit("warm")
        self.assertTrue(k.admit("hot"))
        self.assertEqual(k.cache, ["hot", "warm"])

    def test_tie_is_admitted(self):
        k = HotspotKernel(decay=1.0, capacity=1)
        k.add(Access(key="b", weight=3, ts=0))
        k.add(Access(key="a", weight=3, ts=0))
        k.admit("b")
        self.assertTrue(k.admit("a"))  # equal score -> admitted, victim is "b"
        self.assertEqual(k.cache, ["a"])

    def test_already_cached_is_true(self):
        k = HotspotKernel(capacity=1)
        k.admit("a")
        self.assertTrue(k.admit("a"))


class BurstTests(unittest.TestCase):
    def test_previous_window_zero_rule(self):
        k = HotspotKernel(window=10)
        k.add(Access(key="a", ts=15))  # window 1, previous window 0 count = 0
        self.assertTrue(k.is_burst("a", now=15))
        self.assertEqual(k.window_counts("a", now=15), (1, 0))

    def test_quiet_key_is_not_burst(self):
        k = HotspotKernel(window=10)
        k.add(Access(key="a", ts=1))
        self.assertFalse(k.is_burst("a", now=11))  # cur=0, prev=1

    def test_burst_factor(self):
        k = HotspotKernel(window=10, burst_factor=2.0)
        for ts in (1, 2):
            k.add(Access(key="a", ts=ts))  # prev window count = 2
        for ts in (10, 11, 12, 13):
            k.add(Access(key="a", ts=ts))  # cur = 4, not > 2*2
        self.assertFalse(k.is_burst("a", now=15))
        k.add(Access(key="a", ts=14))  # cur = 5 > 4
        self.assertTrue(k.is_burst("a", now=15))

    def test_weight_counts_toward_burst(self):
        k = HotspotKernel(window=10)
        k.add(Access(key="a", weight=3, ts=21))
        self.assertEqual(k.window_counts("a", now=25), (3, 0))
        self.assertTrue(k.is_burst("a", now=25))

    def test_burst_keys_sorted(self):
        k = HotspotKernel(window=10)
        k.add(Access(key="b", ts=10))
        k.add(Access(key="a", ts=11))
        self.assertEqual(k.burst_keys(now=12), ["a", "b"])

    def test_old_windows_pruned(self):
        k = HotspotKernel(window=10)
        k.add(Access(key="a", ts=0))
        k.add(Access(key="a", ts=100))  # window 10; windows 0..8 pruned
        self.assertEqual(k.window_counts("a", now=100), (1, 0))


class MaxKeysTests(unittest.TestCase):
    def test_exact_mode_has_no_limit(self):
        k = HotspotKernel()  # max_keys=None
        for i in range(5000):
            k.add(Access(key=f"k{i}", ts=0))
        self.assertEqual(len(k), 5000)

    def test_error_policy(self):
        k = HotspotKernel(max_keys=2)  # overflow="error" by default
        k.add(Access(key="a", ts=0))
        k.add(Access(key="b", ts=0))
        with self.assertRaisesRegex(MaxKeysExceededError, "max_keys=2"):
            k.add(Access(key="c", ts=0))
        self.assertEqual(k.keys(), ["a", "b"])  # state unchanged
        # existing keys still update fine
        k.add(Access(key="a", ts=1))

    def test_evict_lowest_policy(self):
        k = HotspotKernel(decay=1.0, max_keys=2, overflow="evict_lowest")
        k.add(Access(key="cold", weight=1, ts=0))
        k.add(Access(key="hot", weight=10, ts=0))
        k.add(Access(key="new", weight=5, ts=0))
        self.assertEqual(k.keys(), ["hot", "new"])


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "state.json"

    def tearDown(self):
        self.tmp.cleanup()

    def build_kernel(self):
        k = HotspotKernel(decay=0.8, min_score=0.5, capacity=2, window=5,
                          burst_factor=1.5)
        k.add(Access(key="a", weight=3, ts=1))
        k.add(Access(key="a", weight=2, ts=7))
        k.add(Access(key="b", weight=1, ts=3))
        k.add(Access(key="c", weight=9, ts=8))
        k.admit("a")
        k.admit("c")
        return k

    def test_round_trip_state_identical(self):
        k = self.build_kernel()
        k.save(self.path)
        loaded = HotspotKernel.load(self.path)
        self.assertEqual(loaded.config(), k.config())
        self.assertEqual(loaded.cache, k.cache)
        self.assertEqual(loaded.now, k.now)
        for key in k.keys():
            self.assertEqual(loaded.score(key, now=50), k.score(key, now=50))
            self.assertEqual(loaded.window_counts(key, now=50),
                             k.window_counts(key, now=50))
        self.assertEqual(loaded.evict_candidates(3, now=50),
                         k.evict_candidates(3, now=50))

    def test_continue_add_after_load_matches(self):
        k = self.build_kernel()
        k.save(self.path)
        loaded = HotspotKernel.load(self.path)
        for ts in range(10, 20):
            k.add(Access(key="a", ts=ts))
            loaded.add(Access(key="a", ts=ts))
            k.add(Access(key="d", ts=ts))
            loaded.add(Access(key="d", ts=ts))
        for key in ("a", "b", "c", "d"):
            self.assertAlmostEqual(loaded.score(key, now=30),
                                   k.score(key, now=30))
        self.assertEqual(loaded.burst_keys(now=15), k.burst_keys(now=15))

    def test_missing_file(self):
        with self.assertRaisesRegex(ValueError, "cannot read state file"):
            HotspotKernel.load(self.path)

    def test_invalid_json(self):
        self.path.write_text("{not json", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "invalid JSON"):
            HotspotKernel.load(self.path)

    def test_missing_field(self):
        self.path.write_text(json.dumps({"version": 1, "config": {}}),
                             encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "missing field 'scores'"):
            HotspotKernel.load(self.path)

    def test_bad_config_rejected(self):
        k = self.build_kernel()
        k.save(self.path)
        data = json.loads(self.path.read_text(encoding="utf-8"))
        data["config"]["decay"] = 1.5
        self.path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, r"\(0, 1\]"):
            HotspotKernel.load(self.path)

    def test_bad_score_entry_rejected(self):
        k = self.build_kernel()
        k.save(self.path)
        data = json.loads(self.path.read_text(encoding="utf-8"))
        data["scores"]["a"] = ["oops", 1]
        self.path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "bad score entry"):
            HotspotKernel.load(self.path)


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = str(Path(self.tmp.name) / "state.json")

    def tearDown(self):
        self.tmp.cleanup()

    def cli(self, *args):
        proc = subprocess.run(
            [sys.executable, str(MAIN), "--state", self.state, *args],
            capture_output=True, text=True,
        )
        lines = [l for l in proc.stdout.strip().splitlines() if l.strip()]
        self.assertEqual(len(lines), 1, f"expected one JSON line, got {proc.stdout!r}")
        return proc, json.loads(lines[0])

    def test_full_flow(self):
        proc, out = self.cli("init", "--decay", "0.9", "--capacity", "2",
                             "--window", "10")
        self.assertEqual(proc.returncode, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["config"]["decay"], 0.9)

        _, out = self.cli("add", "alpha", "--weight", "2", "--ts", "0")
        self.assertAlmostEqual(out["score"], 2.0)
        self.cli("add", "beta", "--ts", "1")
        self.cli("add", "gamma", "--weight", "5", "--ts", "2")

        _, out = self.cli("score", "alpha", "--now", "1")
        self.assertAlmostEqual(out["score"], 2 * 0.9)

        _, out = self.cli("evict", "--n", "2", "--now", "2")
        names = [c["key"] for c in out["candidates"]]
        # beta=1*0.9=0.9 < alpha=2*0.9^2=1.62 < gamma=5
        self.assertEqual(names, ["beta", "alpha"])

        _, out = self.cli("admit", "gamma", "--now", "2")
        self.assertTrue(out["admitted"])
        _, out = self.cli("admit", "beta", "--now", "2")
        self.assertTrue(out["admitted"])  # cache not full yet
        _, out = self.cli("admit", "alpha", "--now", "2")
        self.assertTrue(out["admitted"])  # 1.62 >= beta's 0.9 -> evicts beta
        self.assertEqual(out["cache"], ["alpha", "gamma"])

        _, out = self.cli("burst", "gamma", "--now", "2")
        self.assertTrue(out["burst"])  # prev window 0, cur > 0
        _, out = self.cli("bursts", "--now", "2")
        self.assertIn("gamma", out["bursts"])

        _, out = self.cli("status")
        self.assertEqual(out["keys"], 3)
        self.assertEqual(out["now"], 2)

        backup = str(Path(self.tmp.name) / "backup.json")
        _, out = self.cli("save", "--path", backup)
        self.assertTrue(out["ok"])
        _, out = self.cli("load", "--path", backup)
        self.assertTrue(out["ok"])
        _, out = self.cli("score", "alpha", "--now", "1")
        self.assertAlmostEqual(out["score"], 2 * 0.9)

    def test_errors_are_json(self):
        proc, out = self.cli("score", "x")  # no state yet
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("error", out)
        self.assertIn("init", out["error"])

        self.cli("init")
        proc, out = self.cli("add", "k", "--weight", "0", "--ts", "1")
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("error", out)

        proc, out = self.cli("init", "--decay", "1.5")
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("error", out)

        proc, out = self.cli("nonsense")
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("error", out)

    def test_max_keys_error_via_cli(self):
        self.cli("init", "--max-keys", "1")
        self.cli("add", "a", "--ts", "0")
        proc, out = self.cli("add", "b", "--ts", "0")
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("max_keys=1", out["error"])


if __name__ == "__main__":
    unittest.main()
