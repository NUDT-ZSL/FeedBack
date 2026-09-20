# -*- coding: utf-8 -*-
import json
import unittest

from depviz import model
from depviz.engine import Analysis


def make(mods):
    return model.parse_manifest({"modules": mods})


class EngineTest(unittest.TestCase):
    def test_topo_order(self):
        m = make([
            {"id": "c", "fingerprint": "f3", "deps": ["b"]},
            {"id": "a", "fingerprint": "f1"},
            {"id": "b", "fingerprint": "f2", "deps": ["a"]},
        ])
        ana = Analysis(m)
        self.assertEqual(ana.order, ["a", "b", "c"])
        self.assertEqual(ana.cycles, [])

    def test_cycle_members_marked(self):
        m = make([
            {"id": "a", "fingerprint": "1", "deps": ["c"]},
            {"id": "b", "fingerprint": "2", "deps": ["a"]},
            {"id": "c", "fingerprint": "3", "deps": ["b"]},
            {"id": "d", "fingerprint": "4"},
        ])
        ana = Analysis(m)
        self.assertEqual(ana.cycles, [["a", "b", "c"]])
        self.assertEqual(ana.order, ["d"])
        for x in ("a", "b", "c"):
            self.assertEqual(ana.verdicts[x][0], "cyclic")
        self.assertEqual(ana.verdicts["d"][0], "rebuild")  # 无缓存

    def test_content_change_impact_chains(self):
        m = make([
            {"id": "core", "fingerprint": "1"},
            {"id": "net", "fingerprint": "1", "deps": ["core"]},
            {"id": "app", "fingerprint": "1", "deps": ["net"]},
            {"id": "docs", "fingerprint": "1"},
        ])
        ana = Analysis(m)
        chains = ana.impact_of("core")
        self.assertEqual(set(chains), {"net", "app"})
        self.assertEqual(chains["app"], ["core", "net", "app"])

    def test_signature_and_cache_verdict(self):
        m = make([
            {"id": "a", "fingerprint": "1"},
            {"id": "b", "fingerprint": "1", "deps": ["a"]},
        ])
        ana = Analysis(m)
        self.assertEqual(ana.verdicts["a"][0], "rebuild")  # 无缓存
        m["a"].cache = ana.signatures["a"]
        m["b"].cache = ana.signatures["b"]
        ana = Analysis(m)
        self.assertEqual(ana.verdicts["a"][0], "reuse")
        self.assertEqual(ana.verdicts["b"][0], "reuse")
        m["a"].fingerprint = "2"  # 内容变化沿依赖传导
        ana = Analysis(m)
        self.assertEqual(ana.verdicts["a"][0], "rebuild")
        self.assertEqual(ana.verdicts["b"][0], "rebuild")

    def test_dep_change_rebuild_vs_order_only(self):
        # 移除冗余依赖：传递依赖集合不变 -> 仅顺序调整，缓存可复用
        m = make([
            {"id": "a", "fingerprint": "1"},
            {"id": "b", "fingerprint": "1", "deps": ["a"]},
            {"id": "c", "fingerprint": "1", "deps": ["a", "b"]},
        ])
        ana = Analysis(m)
        for x in ("a", "b", "c"):
            m[x].cache = ana.signatures[x]
        m["c"].deps.remove("a")  # c 经 b 已传递依赖 a
        ana = Analysis(m)
        self.assertEqual(ana.verdicts["c"][0], "reuse")
        # 新增真实依赖：输入签名变化 -> 必须重编
        m2 = make([
            {"id": "a", "fingerprint": "1"},
            {"id": "b", "fingerprint": "1", "deps": ["a"]},
            {"id": "c", "fingerprint": "1", "deps": ["b"]},
            {"id": "d", "fingerprint": "1"},
        ])
        ana2 = Analysis(m2)
        for x in ("a", "b", "c", "d"):
            m2[x].cache = ana2.signatures[x]
        m2["c"].deps.append("d")
        ana2 = Analysis(m2)
        self.assertEqual(ana2.verdicts["c"][0], "rebuild")
        self.assertEqual(ana2.verdicts["a"][0], "reuse")
        self.assertEqual(ana2.verdicts["d"][0], "reuse")

    def test_missing_dep_untrustworthy(self):
        m = make([
            {"id": "a", "fingerprint": "1", "deps": ["ghost"]},
            {"id": "b", "fingerprint": "1", "deps": ["a"]},
            {"id": "c", "fingerprint": "1"},
        ])
        ana = Analysis(m)
        self.assertEqual(ana.missing, {"a": ["ghost"]})
        self.assertEqual(ana.untrustworthy, {"a", "b"})
        self.assertEqual(ana.verdicts["a"][0], "untrustworthy")
        self.assertEqual(ana.verdicts["b"][0], "untrustworthy")
        self.assertEqual(ana.verdicts["c"][0], "rebuild")  # 结论仍可信
        self.assertIn("a", ana.order)  # 模块保留在清单与构建顺序中

    def test_incremental_matches_full_recompute(self):
        # 连续多次改动后的分析，应与对最终清单从零分析完全一致
        mods = make([
            {"id": "a", "fingerprint": "1"},
            {"id": "b", "fingerprint": "1", "deps": ["a"]},
            {"id": "c", "fingerprint": "1", "deps": ["b"]},
        ])
        mods["a"].fingerprint = "2"
        mods["c"].deps.append("a")
        mods["b"].fingerprint = "3"
        ana = Analysis(mods)
        raw = json.loads(json.dumps(model.dump_manifest(mods)))
        fresh = Analysis(model.parse_manifest(raw))
        self.assertEqual(ana.verdicts, fresh.verdicts)
        self.assertEqual(ana.order, fresh.order)
        self.assertEqual(ana.signatures, fresh.signatures)


if __name__ == "__main__":
    unittest.main()
