# -*- coding: utf-8 -*-
import unittest

from depsim.engine import Analysis
from depsim.impact import compute_impact
from depsim.model import Change, Manifest, apply_changes


def make_manifest(spec):
    return Manifest.from_dict({"modules": [
        {"id": mid, "fingerprint": fp, "deps": list(deps)}
        for mid, (fp, deps) in spec.items()
    ]})


def bake_cache(manifest):
    analysis = Analysis(manifest)
    for mid, sig in analysis.signatures.items():
        manifest.modules[mid].cache = {"signature": sig}


def base_spec():
    return {
        "core": ("v1", []),
        "util": ("v1", ["core"]),
        "net": ("v1", ["core"]),
        "web": ("v1", ["util", "net"]),
        "app": ("v1", ["web"]),
    }


def impact_after(changes):
    """在已烘焙缓存的基线上应用改动并推演。"""
    before = make_manifest(base_spec())
    bake_cache(before)
    after = before.clone()
    apply_changes(after, changes)
    return compute_impact(before, after)


class TestImpact(unittest.TestCase):
    def test_fingerprint_change_propagates_with_chain(self):
        imp = impact_after([Change("fingerprint", "core", value="v2")])
        self.assertEqual(set(imp.rebuild), {"core", "util", "net", "web", "app"})
        self.assertEqual(imp.rebuild["core"], "内容指纹变化")
        self.assertEqual(imp.chains["app"], ["core", "net", "web", "app"])
        self.assertIn("core -> util", imp.rebuild["util"])
        self.assertEqual(imp.reused, [])

    def test_add_dep_forces_rebuild_of_module_and_dependents(self):
        imp = impact_after([Change("add_dep", "app", target="net")])
        self.assertEqual(set(imp.rebuild), {"app"})
        self.assertIn("新增依赖 net", imp.rebuild["app"])
        self.assertEqual(set(imp.reused), {"core", "util", "net", "web"})

    def test_reorder_only_keeps_cache(self):
        imp = impact_after([
            Change("remove_dep", "web", target="util"),
            Change("add_dep", "web", target="util"),
        ])
        self.assertEqual(imp.rebuild, {})
        self.assertEqual(imp.reorder_only, ["web"])
        self.assertEqual(set(imp.reused), {"core", "util", "net", "web", "app"})

    def test_remove_dep_forces_rebuild(self):
        imp = impact_after([Change("remove_dep", "web", target="net")])
        self.assertEqual(set(imp.rebuild), {"web", "app"})
        self.assertIn("移除依赖 net", imp.rebuild["web"])
        self.assertEqual(imp.chains["app"], ["web", "app"])

    def test_add_missing_dep_marks_untrusted_downstream(self):
        imp = impact_after([Change("add_dep", "web", target="ghost")])
        self.assertIn("ghost", imp.after.missing["web"])
        self.assertEqual(imp.after.untrusted, {"web", "app"})

    def test_consecutive_changes_match_full_recompute(self):
        # 连续改动（每次基于上次结果）与一次性全量重算必须一致
        stepwise = make_manifest(base_spec())
        bake_cache(stepwise)
        seq = [
            [Change("fingerprint", "core", value="v2")],
            [Change("add_dep", "app", target="net")],
            [Change("remove_dep", "web", target="util")],
            [Change("fingerprint", "net", value="v9")],
        ]
        for changes in seq:
            before = stepwise
            stepwise = before.clone()
            apply_changes(stepwise, changes)
            imp = compute_impact(before, stepwise)
            # 每一步的签名都来自完整重算
            self.assertEqual(imp.after.signatures, Analysis(stepwise).signatures)
        oneshot = make_manifest(base_spec())
        apply_changes(oneshot, [c for group in seq for c in group])
        self.assertEqual(Analysis(stepwise).signatures, Analysis(oneshot).signatures)

    def test_impact_reflects_existing_cache_state(self):
        imp = impact_after([Change("fingerprint", "net", value="v2")])
        self.assertEqual(set(imp.rebuild), {"net", "web", "app"})
        self.assertEqual(set(imp.reused), {"core", "util"})


if __name__ == "__main__":
    unittest.main()
