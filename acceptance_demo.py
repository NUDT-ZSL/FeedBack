"""End-to-end acceptance demo for the persistent B+tree index.

Mirrors the acceptance procedure from the specification:

1. insert tens of thousands of key/value pairs (many splits);
2. delete most of them (merges + redistribution), checking get/scan all
   along against an in-memory reference;
3. simulate a crash by reopening without a checkpoint and replay the WAL;
4. corrupt a page file and truncate the WAL, checking that errors are
   reported clearly and recovery behaves correctly.

Run::

    python acceptance_demo.py
"""
from __future__ import annotations

import os
import random
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from btree_index import BTreeIndex, ChecksumMismatchError  # noqa: E402
from btree_index.wal import WAL  # noqa: E402

N_KEYS = 20_000
PAGE_SIZE = 4096


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError("FAILED: " + message)
    print("  ok -", message)


def main() -> int:
    random.seed(20260913)
    workdir = tempfile.mkdtemp(prefix="btree-acceptance-")
    path = os.path.join(workdir, "index")
    print(f"data directory: {path}")
    try:
        # ------------------------------------------------------------ phase 1
        print(f"[1/5] inserting {N_KEYS} keys (random order, page {PAGE_SIZE})...")
        idx = BTreeIndex(path, page_size=PAGE_SIZE)
        keys = [f"key/{i:06d}" for i in range(N_KEYS)]
        values = {k: f"value/{k}/{random.randint(0, 10 ** 9):09d}" for k in keys}
        random.shuffle(keys)
        start = time.time()
        for i, k in enumerate(keys):
            idx.put(k, values[k])
            if i % 5000 == 4999:
                # Random spot checks while the tree is growing.
                for sample_k in random.sample(keys[:i + 1], 20):
                    check(idx.get(sample_k) == values[sample_k],
                          f"get correct mid-bulk at {i + 1} inserts")
        print(f"  inserted {N_KEYS} keys in {time.time() - start:.1f}s")
        stats = idx.stats()
        print("  stats:", stats)
        check(stats["height"] >= 3, "tree grew to multiple levels (splits happened)")
        check([k for k, _ in idx.scan()] == sorted(values), "full scan is sorted and complete")
        idx.checkpoint()

        # ------------------------------------------------------------ phase 2
        print("[2/5] deleting 85% of keys (merges + redistribution)...")
        shuffled = list(values)
        random.shuffle(shuffled)
        to_delete = shuffled[:N_KEYS // 100 * 85]  # delete 85%
        start = time.time()
        for i, k in enumerate(to_delete):
            check(idx.delete(k) is True, f"delete reports presence ({k})")
            if i % 3000 == 2999:
                remaining = set(values) - set(to_delete[:i + 1])
                scanned = dict(idx.scan())
                check(scanned == {k: values[k] for k in remaining},
                      f"scan matches reference after {i + 1} deletes")
                lo, hi = "key/001000", "key/001100"
                expected = sorted((k, values[k]) for k in remaining if lo <= k < hi)
                check(idx.scan(lo, hi) == expected, "range scan matches reference")
                sample_k = random.choice(sorted(remaining))
                check(idx.get(sample_k) == values[sample_k], "random get after deletes")
        print(f"  deleted {len(to_delete)} keys in {time.time() - start:.1f}s")
        print("  stats:", idx.stats())
        survivors = set(values) - set(to_delete)
        check(idx.delete(to_delete[0]) is False, "deleting a missing key is a no-op")

        # ------------------------------------------------------------ phase 3
        print("[3/5] simulating a crash (no checkpoint) and replaying WAL...")
        crash_keys = ["key/crash1", "key/crash2", "key/crash3"]
        for k in crash_keys:
            idx.put(k, "durable-" + k)
        survivors.update(crash_keys)
        values.update({k: "durable-" + k for k in crash_keys})
        idx.close()  # WAL is fsync'd per record; pages were never flushed
        wal_size_before = os.path.getsize(os.path.join(path, "wal.log"))
        check(wal_size_before > 0, "WAL contains un-checkpointed records")
        idx = BTreeIndex(path)
        for k in crash_keys:
            check(idx.get(k) == "durable-" + k, f"{k} recovered via WAL replay")
        check(dict(idx.scan()) == {k: values[k] for k in survivors},
              "full state correct after WAL replay")
        idx.checkpoint()
        idx.put("key/after_recovery", "x")
        check(idx.delete("key/after_recovery") is True, "tree is writable after recovery")
        idx.checkpoint()

        # ------------------------------------------------------- overflow
        print("[3b] oversized values use overflow pages...")
        big_value = "".join(chr(65 + (i % 26)) for i in range(100_000))
        idx.put("key/big", big_value)
        ovf_stats = idx.stats()
        check(ovf_stats["overflow_entries"] == 1, "one overflow entry reported in stats")
        check(ovf_stats["overflow_pages"] > 20, "value spans many overflow pages")
        check(idx.get("key/big") == big_value, "100 KB value reassembled byte-exact")
        rng = idx.scan("key/a", "key/c")
        check(dict(rng)["key/big"] == big_value, "overflow value visible in range scan")
        check(idx.delete("key/big") is True, "overflow entry deleted")
        after = idx.stats()
        check(after["overflow_pages"] == 0, "overflow chain fully reclaimed")
        check(after["free_pages"] >= ovf_stats["overflow_pages"], "reclaimed pages enter free list")
        idx.checkpoint()

        # ------------------------------------------------------------ phase 4
        print("[4/5] corrupting a page file...")
        page_files = sorted(n for n in os.listdir(path) if n.startswith("p-"))
        victim = page_files[len(page_files) // 2]
        idx.close()
        with open(os.path.join(path, victim), "r+b") as fh:
            fh.seek(-10, os.SEEK_END)
            fh.write(b"\xde\xad\xbe\xef\x00" * 2)
        try:
            BTreeIndex(path)
        except ChecksumMismatchError as exc:
            print(f"  got expected error: {exc}")
            check(exc.page_id == victim, "error identifies the corrupted page_id")
            check(victim in str(exc), "error message mentions the page id")
        else:
            raise AssertionError("corrupted page did not raise")

        # A failed checksum means the index refuses to start; repairing a
        # genuinely corrupted page is an operator decision (backup etc.).
        # For the rest of the demo start a fresh index.
        shutil.rmtree(path)
        idx = BTreeIndex(path)
        for i in range(200):
            idx.put(f"k{i:04d}", "v")
        idx.checkpoint()

        # ------------------------------------------------------------ phase 5
        print("[5/5] truncating the WAL mid-record...")
        for i in range(200, 220):
            idx.put(f"k{i:04d}", "w")
        idx.close()
        wal_file = os.path.join(path, "wal.log")
        with open(wal_file, "ab") as fh:
            fh.write(b'{"op":"put","key":"halfwritten","val')  # no newline
        intact = len(WAL.read_records(wal_file))
        check(intact == 20, f"intact records parse, torn tail skipped ({intact} records)")
        idx = BTreeIndex(path)
        check(idx.get("k0219") == "w", "last committed record replayed")
        check(idx.get("halfwritten") is None, "torn record was not applied")
        idx.put("post-repair", "ok")
        check(idx.get("post-repair") == "ok", "new writes append cleanly after torn tail")
        idx.checkpoint()
        idx.close()
        idx = BTreeIndex(path)
        check(idx.get("post-repair") == "ok", "state survives a clean reopen")
        idx.close()

        print("\nALL ACCEPTANCE CHECKS PASSED")
        return 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
