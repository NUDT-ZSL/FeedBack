"""Requirement tests for the note-threading engine."""
import copy
import json
import os

from core import Engine, UserError


def load_sample():
    with open(os.path.join(os.path.dirname(__file__), "sample_notes.json"),
              encoding="utf-8") as f:
        return json.load(f)


def make_engine():
    e = Engine()
    e.add_notes(load_sample())
    return e


def thread_of(e, nid):
    return e.assignments[nid]


def test_import_clusters():
    e = make_engine()
    assert len(e.notes) == len(load_sample())
    assert len(e.threads) >= 3, "expected several topic threads"
    # every note belongs to exactly one thread
    assert sorted(e.assignments) == sorted(e.notes)
    for t in e.state()["threads"]:
        assert t["note_count"] == len(t["notes"])
        assert 0.0 <= t["strength"] <= 1.0
        assert t["latest_ts"]
    print("ok import_clusters: %d threads" % len(e.threads))


def test_move_detaches_old_links():
    e = make_engine()
    st = e.state()
    # pick a note from a multi-note thread and move it to another thread
    src = next(t for t in st["threads"] if t["note_count"] >= 3)
    dst = next(t for t in st["threads"] if t["id"] != src["id"])
    nid = src["notes"][0]["id"]
    old_mates = {n["id"] for n in src["notes"] if n["id"] != nid}
    affected = e.move_note(nid, dst["id"])
    assert src["id"] in affected and dst["id"] in affected
    assert thread_of(e, nid) == dst["id"]
    # exactly one membership anywhere
    assert list(e.assignments.values()).count(dst["id"]) >= 1
    assert sum(1 for t in e.state()["threads"]
               for n in t["notes"] if n["id"] == nid) == 1
    # no residual edges to old thread-mates inside any shared thread
    for t in e.state()["threads"]:
        ids = {n["id"] for n in t["notes"]}
        if nid in ids:
            assert not (ids & old_mates), "old membership残留"
        for ed in t["edges"]:
            pair = {ed["a"], ed["b"]}
            if nid in pair:
                assert not (pair & old_mates), "old association残留"
    print("ok move_detaches_old_links")


def test_incremental_equals_full_and_untouched_stable():
    e = make_engine()
    st = e.state()
    src = next(t for t in st["threads"] if t["note_count"] >= 3)
    dst = next(t for t in st["threads"] if t["id"] != src["id"])
    nid = src["notes"][0]["id"]
    before = {t["id"]: sorted(n["id"] for n in t["notes"]) for t in st["threads"]}
    affected = set(e.move_note(nid, dst["id"]))
    after = {t["id"]: sorted(n["id"] for n in t["notes"]) for t in e.state()["threads"]}
    # threads outside the affected range keep identical membership
    for tid, members in before.items():
        if tid not in affected and tid in after:
            assert after[tid] == members, "unaffected thread changed: %s" % tid
    # incremental result equals a full reorganize of all notes
    snap = copy.deepcopy(e.assignments)
    e.reorganize_all()
    assert e.assignments == snap, "incremental != full reorganize"
    print("ok incremental_equals_full, affected=%s" % sorted(affected))


def test_merge_and_duplicate_block():
    e = make_engine()
    st = e.state()
    a, b = st["threads"][0], st["threads"][1]
    union = sorted(n["id"] for n in a["notes"] + b["notes"])
    e.merge_threads(a["id"], b["id"])
    merged = e.state()["threads"]
    survivor = next(t for t in merged if t["id"] == a["id"])
    assert sorted(n["id"] for n in survivor["notes"]) == union, "merge must keep both sides"
    assert survivor["label"], "merged thread needs a recomputed theme"
    # merging a thread with itself is rejected
    try:
        e.merge_threads(a["id"], a["id"])
        assert False, "self merge should fail"
    except UserError:
        pass
    # duplicate membership must be blocked explicitly
    e2 = make_engine()
    tids = list(e2.threads)
    victim = sorted(e2._members_of(tids[0]))[0]
    orig = e2._members_of
    e2._members_of = lambda t: (orig(t) | {victim}) if t == tids[1] else orig(t)
    try:
        e2.merge_threads(tids[0], tids[1])
        assert False, "duplicate merge should fail"
    except UserError as err:
        assert err.status == 409
        assert "重复归属" in str(err)
    print("ok merge_and_duplicate_block")


def test_split_and_undo():
    e = make_engine()
    st = e.state()
    src = next(t for t in st["threads"] if t["note_count"] >= 2)
    nid = src["notes"][0]["id"]
    before = copy.deepcopy((e.assignments, e.pinned, e.threads))
    e.split_note(nid)
    new_tid = thread_of(e, nid)
    assert new_tid != src["id"]
    assert e._members_of(new_tid) == {nid}, "split note must be alone"
    assert nid not in e._members_of(src["id"])
    # undo restores the exact previous state
    e.undo()
    assert (e.assignments, e.pinned, e.threads) == before
    print("ok split_and_undo")


if __name__ == "__main__":
    test_import_clusters()
    test_move_detaches_old_links()
    test_incremental_equals_full_and_untouched_stable()
    test_merge_and_duplicate_block()
    test_split_and_undo()
    print("ALL TESTS PASSED")
