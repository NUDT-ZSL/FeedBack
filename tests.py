"""Engine verification: anomalies, segmentation, co-travel, incremental
consistency, and relation diffing. Run: python tests.py"""
from gen_sample import BASE, sample_rows
from store import Store


def fresh_store():
    s = Store()
    s.add_points(sample_rows())
    return s


def test_anomalies():
    s = fresh_store()
    flags = {f for p in s.points.values() for f in p["flags"]}
    assert "out_of_order" in flags, "missing out_of_order flag"
    assert "duplicate" in flags, "missing duplicate flag"
    assert "drift" in flags, "missing drift flag"
    n_d = sum(1 for p in s.points.values() if p["target"] == "D")
    assert n_d == 8, "anomalous points must be retained, got %d" % n_d
    print("ok anomalies: flags kept, no silent drops")


def test_segments():
    s = fresh_store()
    kinds = [g["kind"] for g in s.segments["A"]]
    assert kinds == ["stay", "move", "stay"], kinds
    first = s.segments["A"][0]
    assert abs(first["start"] - BASE) < 1 and abs(first["end"] - (BASE + 3600)) < 1
    assert first["point_ids"], "stay must list evidence points"
    assert first["params_used"]["stay_radius_m"] == s.params["stay_radius_m"]
    print("ok segments: A -> stay/move/stay with evidence + params")


def test_cotravel():
    s = fresh_store()
    rel_ab = [r for r in s.relations[("A", "B")]]
    assert len(rel_ab) == 1 and rel_ab[0]["kind"] == "stable", rel_ab
    assert rel_ab[0]["basis"]["coverage"] > 0.8
    rel_ac = [r for r in s.relations[("A", "C")]]
    assert len(rel_ac) == 1 and rel_ac[0]["kind"] == "occasional", rel_ac
    print("ok cotravel: A-B stable, A-C occasional")


def test_incremental_matches_full():
    s = fresh_store()
    assert s.verify()["ok"]
    # edit a point, tighten stay radius, widen co radius, delete a point
    a_pid = next(p["id"] for p in s.points.values()
                 if p["target"] == "A" and abs(p["t"] - (BASE + 1800)) < 1)
    s.update_point(a_pid, {"lat": 30.6640, "lon": 104.0640})
    assert s.verify()["ok"], s.verify()
    s.set_params({"stay_radius_m": 80})
    assert s.verify()["ok"], s.verify()
    s.set_params({"co_radius_m": 350})
    assert s.verify()["ok"], s.verify()
    s.delete_point(a_pid)
    assert s.verify()["ok"], s.verify()
    print("ok incremental: edits + param changes match full recompute")


def test_relation_diff_events():
    s = fresh_store()
    assert not any(e["type"] == "removed" for e in s.events)
    s.set_params({"co_radius_m": 30})     # A-B no longer "close"
    types = {e["type"] for e in s.events}
    assert "removed" in types, s.events
    assert not s.relations[("A", "B")]
    s.set_params({"co_radius_m": 200})    # back to normal
    types = {e["type"] for e in s.events}
    assert "added" in types, s.events
    assert s.relations[("A", "B")][0]["kind"] == "stable"
    # point edit that breaks the A-B overlap -> changed/removed event
    s2 = fresh_store()
    b_pids = [p["id"] for p in s2.points.values() if p["target"] == "B"]
    for pid in b_pids:
        p = s2.points[pid]
        if p["t"] <= BASE + 1800:
            s2.update_point(pid, {"lat": p["lat"] + 0.02})  # ~2.2 km away
    assert s2.verify()["ok"]
    assert any(e["type"] in ("changed", "removed") for e in s2.events), s2.events
    print("ok diff: added / removed / changed events emitted")


if __name__ == "__main__":
    test_anomalies()
    test_segments()
    test_cotravel()
    test_incremental_matches_full()
    test_relation_diff_events()
    print("ALL TESTS PASSED")
