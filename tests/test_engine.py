# -*- coding: utf-8 -*-
import unittest

from depsim.engine import Analysis
from depsim.model import Manifest


def make_manifest(spec):
    """spec: {id: (指纹, [依赖...])}"""
    return Manifest.from_dict({"modules": [
        {"id": mid, "fingerprint": fp, "deps": list(deps)}
        for mid, (fp, deps) in spec.items()
    ]})


def bake_cache(manifest):
    """模拟一次全量构建：按当前签名写入缓存标记。"""
    analysis = Analysis(manifest)
    for mid, sig in analysis.signatures.items():
        manifest.modules[mid].cache = {"signature": sig}
    return analysis


class TestGraphAnalysis(unittest.TestCase):
    def test_build_order_respects_dependencies(self):
        m = make_manifest({
            "app": ("v1", ["web"]),
            "web": ("v1", ["util", "net"]),
            "util": ("v1", ["core"]),
            "net": ("v1", ["core"]),
            "core": ("v1", []),
        })
        order = Analysis(m).order
        pos = {mid: i for i, mid in enumerate(order)}
        self.assertLess(pos["core"], pos["util"])
        self.assertLess(pos["core"], pos["net"])
        self.assertLess(pos["util"], pos["web"])
        self.assertLess(pos["net"], pos["web"])
        self.assertLess(pos["web"], pos["app"])

    def test_cycle_group_detected_and_named(self):
        m = make_manifest({
            "a": ("v1", ["b"]),
            "b": ("v1", ["c"]),
            "c": ("v1", ["a"]),
            "d": ("v1", ["a"]),
        })
        an = Analysis(m)
        self.assertEqual(an.cycle_groups, [["a", "b", "c"]])
        for mid in ("a", "b", "c"):
            self.assertTrue(an.statuses[mid].in_cycle)
            self.assertEqual(an.statuses[mid].cycle_members, ["a", "b", "c"])
        self.assertFalse(an.statuses["d"].in_cycle)

    def test_self_loop_is_cycle(self):
        m = make_manifest({"a": ("v1", ["a"]), "b": ("v1", [])})
        an = Analysis(m)
        self.assertEqual(an.cycle_groups, [["a"]])

    def test_cycle_member_change_rebuilds_whole_group(self):
        spec = {"a": ("v1", ["b"]), "b": ("v1", ["a"]), "c": ("v1", ["b"])}
        m1 = make_manifest(spec)
        sigs1 = Analysis(m1).signatures
        spec["a"] = ("v2", ["b"])
        sigs2 = Analysis(make_manifest(spec)).signatures
        self.assertNotEqual(sigs1["a"], sigs2["a"])
        self.assertNotEqual(sigs1["b"], sigs2["b"])
        self.assertNotEqual(sigs1["c"], sigs2["c"])

    def test_missing_dep_kept_and_downstream_untrusted(self):
        m = make_manifest({
            "core": ("v1", []),
            "web": ("v1", ["core", "ghost"]),
            "app": ("v1", ["web"]),
        })
        an = Analysis(m)
        self.assertIn("web", an.order)  # 模块保留
        self.assertEqual(an.missing, {"web": ["ghost"]})
        self.assertEqual(an.untrusted, {"web", "app"})
        self.assertFalse(an.statuses["core"].untrusted)

    def test_cache_reuse_only_when_signature_matches(self):
        m = make_manifest({"a": ("v1", []), "b": ("v1", ["a"])})
        an = Analysis(m)
        self.assertFalse(an.statuses["a"].reusable)  # 无缓存
        bake_cache(m)
        an2 = Analysis(m)
        self.assertTrue(an2.statuses["a"].reusable)
        self.assertTrue(an2.statuses["b"].reusable)
        m.modules["a"].fingerprint = "v2"
        an3 = Analysis(m)
        self.assertFalse(an3.statuses["a"].reusable)
        self.assertFalse(an3.statuses["b"].reusable)  # 上游变化传导


if __name__ == "__main__":
    unittest.main()
