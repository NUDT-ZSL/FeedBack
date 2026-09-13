"""Adversarial randomized stress harness (not part of the unit tests).

Runs thousands of interleaved put/update/delete operations against a tiny
page size -- including values large enough to force overflow-page chains --
reopening (WAL replay) and checkpointing at random points, and compares
every get/scan and the overflow accounting against an in-memory dict.

Usage::

    python stress_test.py [seed] [ops]
"""
import os
import random
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from btree_index import BTreeIndex, OverflowRef  # noqa: E402


def main() -> int:
    random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
    d = tempfile.mkdtemp(prefix="btree-stress-")
    path = os.path.join(d, "db")
    n_ops = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    ref = {}
    try:
        # Reopen below deliberately uses the DEFAULT page-size argument;
        # the stored manifest must win, so the chosen tiny size persists.
        chosen = random.choice([160, 192, 256, 384])
        idx = BTreeIndex(path, page_size=chosen)
        keyspace = [f"k{i:05d}" for i in range(400)]
        for step in range(n_ops):
            op = random.random()
            if op < 0.55:
                k = random.choice(keyspace)
                if random.random() < 0.12:
                    # Oversized value: forces an overflow chain.
                    v = "Z" * random.choice([400, 1500, 6000]) + ":" + k
                else:
                    v = ("x" * random.randint(0, 40)) + ":" + k
                idx.put(k, v)
                ref[k] = v
            elif op < 0.85:
                k = random.choice(keyspace)
                got = idx.delete(k)
                assert got == (k in ref), f"delete mismatch {k}: {got}"
                ref.pop(k, None)
            else:
                present = list(ref)
                if present:
                    k = random.choice(present)
                    v = "y" * random.randint(0, 60)
                    idx.put(k, v)
                    ref[k] = v
            if step % 250 == 0 or step == n_ops - 1:
                for k in keyspace:
                    assert idx.get(k) == ref.get(k), f"get mismatch at {step}: {k}"
                got_scan = idx.scan()
                assert len(got_scan) == len(ref), (step, len(got_scan), len(ref))
                assert [k for k, _ in got_scan] == sorted(ref), f"scan order at {step}"
                for k, v in got_scan:
                    assert v == ref[k]
                lo = random.choice(keyspace[:200])
                hi = random.choice(keyspace[200:])
                if lo <= hi:
                    rng = idx.scan(lo, hi)
                    expected = sorted((k, v) for k, v in ref.items() if lo <= k < hi)
                    assert rng == expected, f"range mismatch at {step}"
                # Every >=400-char value must be externalised; short values
                # may also be externalised at the tiniest page size -- that
                # is legal, so compare stats against the actual references.
                stored_refs = sum(
                    1
                    for p in idx.pages.values()
                    if p.is_leaf
                    for _, v in p.items
                    if isinstance(v, OverflowRef)
                )
                self_ = idx
                for k, v in ref.items():
                    if len(v) >= 400:
                        leaf = self_._find_leaf(k)
                        stored = dict(leaf.items)[k]
                        assert isinstance(stored, OverflowRef), (step, k, chosen)
                assert idx.stats()["overflow_entries"] == stored_refs, step
                # Every leaf reference marked overflow really is one.
                for p in idx.pages.values():
                    if p.is_leaf:
                        for _, v in p.items:
                            assert isinstance(v, (str, OverflowRef))
            if random.random() < 0.04:
                # Simulate a crash: close without checkpoint, reopen.
                idx.close()
                idx = BTreeIndex(path)
                assert idx.page_size == chosen, (idx.page_size, chosen)
                assert idx.scan() == sorted(ref.items()), f"post-crash scan at {step}"
            elif random.random() < 0.04:
                idx.checkpoint()
        # Delete everything in random order; the tree collapses back to a
        # single empty leaf and every overflow chain is reclaimed.
        order = list(ref)
        random.shuffle(order)
        for k in order:
            assert idx.delete(k)
            ref.pop(k)
        assert idx.scan() == []
        assert idx.stats()["overflow_pages"] == 0
        assert idx.stats()["height"] in (0, 1)
        idx.checkpoint()
        idx.close()
        idx = BTreeIndex(path)
        assert idx.scan() == []
        # Reuse the collapsed tree (and the reclaimed page ids).
        for i in range(300):
            idx.put(f"rebirth-{i:04d}", "v")
        assert len(idx.scan()) == 300
        idx.checkpoint()
        idx.close()
        idx = BTreeIndex(path)
        assert len(idx.scan()) == 300
        idx.close()
        print("STRESS OK", n_ops)
        return 0
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
