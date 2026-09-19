"""Verification for the six requirements. Run: python run_tests.py"""
import os
import tempfile

from store import Store
from view import build_state

SAMPLES = [
    ("客服", "登录页面经常闪退，根本进不去系统"),
    ("问卷", "登录时老是闪退，无法进入系统"),
    ("App评价", "登录界面崩溃闪退"),
    ("客服", "希望增加深色模式，晚上看太刺眼"),
    ("问卷", "建议增加夜间深色模式"),
    ("App评价", "导出报表速度太慢，要等好几分钟"),
    ("客服", "报表导出非常慢，严重影响使用"),
]


def fresh_store():
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    os.remove(path)
    return Store(path), path


def grouping_signature(state):
    return sorted(tuple(sorted(m["id"] for m in g["members"]))
                  for g in state["groups"])


def main():
    store, path = fresh_store()
    try:
        # Req 1: accept feedback with source/time/text/tags; editable
        ids = []
        for i, (src, text) in enumerate(SAMPLES):
            item = store.add_feedback(src, text, tags=["t%d" % i],
                                      ts="2026-09-20 10:0%d" % i)
            ids.append(item["id"])
        store.update_feedback(ids[0], {"text": "登录页面经常闪退，进不去系统"})
        assert store.items[ids[0]]["text"].endswith("进不去系统")

        # Req 2: auto clustering + representative description
        state = build_state(store)
        assert len(state["groups"]) == 3, \
            "expected 3 clusters, got %d" % len(state["groups"])
        for g in state["groups"]:
            assert g["representative"] and g["keywords"]
        sizes = sorted(len(g["members"]) for g in state["groups"])
        assert sizes == [2, 2, 3], sizes

        # Req 6: each cluster expandable -> members + evidence
        for g in state["groups"]:
            assert g["members"] and "evidence" in g
            assert "top_pairs" in g["evidence"]

        # Req 3: near-boundary pairs keep their merge rationale
        store.set_threshold(0.25)  # raises threshold so some pairs sit
        state3 = build_state(store)  # just below it, inside the band
        assert state3["boundary_pairs"], "boundary evidence missing"
        bp = state3["boundary_pairs"][0]
        assert bp["evidence"] and bp["similarity"] < bp["threshold"]
        store.set_threshold(0.20)

        # Req 4: move / split / merge update grouping immediately
        state = build_state(store)
        gids = {tuple(sorted(m["id"] for m in g["members"])): n
                for n, g in enumerate(state["groups"])}
        login_cluster = next(g for g in state["groups"]
                             if len(g["members"]) == 3)
        dark_cluster = next(g for g in state["groups"]
                            if "深色" in g["representative"]
                            or any("深色" in m["text"]
                                   for m in g["members"]))
        moved = login_cluster["members"][0]["id"]
        remaining_src = [m["id"] for m in login_cluster["members"]
                         if m["id"] != moved]
        store.move_item(moved, remaining_src,
                        [m["id"] for m in dark_cluster["members"]])
        state = build_state(store)
        target = next(g for g in state["groups"]
                      if moved in [m["id"] for m in g["members"]])
        assert any("深色" in m["text"] for m in target["members"])

        # split it back out
        store.split_group(
            [m["id"] for m in target["members"] if m["id"] != moved],
            [moved])
        state = build_state(store)
        assert any(g["members"][0]["id"] == moved
                   and len(g["members"]) == 1 for g in state["groups"])

        # merge two clusters
        singleton = next(g for g in state["groups"]
                         if len(g["members"]) == 1)
        login2 = next(g for g in state["groups"]
                      if len(g["members"]) >= 2
                      and any("闪退" in m["text"] for m in g["members"]))
        store.merge_groups([m["id"] for m in singleton["members"]],
                           [m["id"] for m in login2["members"]])
        state = build_state(store)
        merged = next(g for g in state["groups"]
                      if moved in [m["id"] for m in g["members"]])
        assert len(merged["members"]) == 3

        # Req 5: final grouping == from-scratch recompute, and the
        # same (items, pins) always produce the same grouping.
        sig_a = grouping_signature(build_state(store))
        store2 = Store(store.path)          # reload from disk
        sig_b = grouping_signature(build_state(store2))
        assert sig_a == sig_b, "reload changed grouping"
        # recompute is a pure function: repeated calls identical
        assert sig_a == grouping_signature(build_state(store))
        # insertion order of items must not affect grouping
        store3, path3 = fresh_store()
        try:
            for iid in sorted(store.items, reverse=True):
                it = store.items[iid]
                store3.items[iid] = dict(it)
            store3.pins = dict(store.pins)
            store3.threshold = store.threshold
            sig_c = grouping_signature(build_state(store3))
            assert sig_a == sig_c, "insertion order changed grouping"
        finally:
            if os.path.exists(store3.path):
                os.remove(store3.path)

        # reset restores pure auto clustering
        store.reset_adjustments()
        state = build_state(store)
        assert len(state["groups"]) == 3

        print("ALL TESTS PASSED")
    finally:
        if os.path.exists(path):
            os.remove(path)


if __name__ == "__main__":
    main()
