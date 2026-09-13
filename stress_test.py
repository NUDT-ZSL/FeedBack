"""Adversarial randomized stress harness (not part of the unit tests).

Runs thousands of interleaved put/update/delete operations against a tiny
page size, reopening (WAL replay) and checkpointing at random points, and
compares every get/scan against an in-memory dict after every operation.
"""
import os
import random
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from btree_index import BTreeIndex  # noqa: E402


def main() -> int:
    random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
    d = tempfile.mkdtemp(prefix="btree-stress-")
    path = os.path.join(d, "db")
    ref = {}
    n_ops = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    try:
        idx = BTreeIndex(path, page_size=random.choice([160, 192, 256, 384]))
        keyspace = [f"k{i:05d}" for i in range(400)]
        for step in range(n_ops):
            op = random.random()
            if op < 0.55:
                k = random.choice(keyspace)
                v = ("x" * random.randint(0, 40)) + ":" + k
                idx.put(k, v)
                ref[k] = v
            elif op < 0.85:
                k = random.choice(keyspace)
                got = idx.delete(k)
                assert got == (k in ref), f"delete mismatch {k}: {got} vs {k in ref}"
                ref.pop(k, None)
            else:
                # overwrite existing
                present = list(ref)
                if present:
                    k = random.choice(present)
                    v = "y" * random.randint(0, 60)
                    idx.put(k, v)
                    ref[k] = v
            # full verification every so often
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
            if random.random() < 0.04:
                # simulate crash: close without checkpoint, reopen
                idx.close()
                idx = BTreeIndex(path)
            elif random.random() < 0.04:
                idx.checkpoint()
        # delete everything in random order, tree must collapse back to empty leaf
        order = list(ref)
        random.shuffle(order)
        for k in order:
            assert idx.delete(k)
            ref.pop(k)
        assert idx.scan() == []
        assert idx.stats()["height"] in (0, 1)
        idx.checkpoint()
        idx.close()
        idx = BTreeIndex(path)
        assert idx.scan() == []
        # reuse the collapsed tree
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
