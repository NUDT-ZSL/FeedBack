"""Self-test for the watermark module.

Covers: normal window triggering, late-event merge, monotonic watermark,
buffer-overflow forced close, too-late event rejection, and shuffled-input
determinism of the final flush output.
"""

import random
import sys

from watermark import WindowEngine


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("  ok:", msg)


def expect_value_error(fn, *needles):
    try:
        fn()
    except ValueError as e:
        for n in needles:
            check(n in str(e), "ValueError mentions %r: %s" % (n, e))
        return
    raise AssertionError("expected ValueError from %r" % (fn,))


def sig(records):
    """Order-independent signature of a record list."""
    return sorted((r["key"], r["window_start"], r["window_end"],
                   r["sum"], r["count"]) for r in records)


def main():
    print("[1] normal window triggering")
    eng = WindowEngine(allowed_lateness=20, window_size=100,
                       max_out_of_order=100)
    check(eng.push({"key": "a", "ts": 10, "value": 1}) == [],
          "push emits nothing before watermark passes")
    eng.push({"key": "a", "ts": 30, "value": 2})
    eng.push({"key": "b", "ts": 40, "value": 5})
    eng.push({"key": "a", "ts": 110, "value": 7})  # second window for a
    out = eng.advance_watermark(120)  # [0,100) closes at 100+20=120
    check(len(out) == 2, "exactly 2 windows closed at watermark 120")
    check(sig(out) == [("a", 0, 100, 3, 2), ("b", 0, 100, 5, 1)],
          "closed windows carry correct sum/count: %s" % out)
    check([ (r["window_start"], r["key"]) for r in out] ==
          [(0, "a"), (0, "b")], "results sorted by (window_start, key)")
    p = eng.pending()
    check(p == {"watermark": 120, "open_windows": 1, "buffered": 1},
          "pending reflects one open window with one event: %s" % p)
    out = eng.flush()
    check(sig(out) == [("a", 100, 200, 7, 1)], "flush emits remaining window")
    check(eng.pending()["open_windows"] == 0 and
          eng.pending()["buffered"] == 0, "pending zeroed after flush")

    print("[2] late events merge into the original window")
    eng = WindowEngine(allowed_lateness=20, window_size=100,
                       max_out_of_order=100)
    eng.push({"key": "a", "ts": 10, "value": 1})
    eng.advance_watermark(105)  # window [0,100) closes at 120, still open
    out = eng.push({"key": "a", "ts": 95, "value": 4})  # late but allowed
    check(out == [], "late event within allowed_lateness not rejected")
    out = eng.advance_watermark(120)
    check(sig(out) == [("a", 0, 100, 5, 2)],
          "late event merged into original window (sum=5, count=2)")
    check(eng.flush() == [], "no duplicate window created for late event")

    print("[3] watermark is monotonic")
    eng = WindowEngine(allowed_lateness=10, window_size=100,
                       max_out_of_order=100)
    eng.advance_watermark(500)
    out = eng.advance_watermark(300)  # regression attempt
    check(out == [] and eng.pending()["watermark"] == 500,
          "watermark never moves backwards")
    eng.advance_watermark(500)
    check(eng.pending()["watermark"] == 500, "re-advancing to same value ok")
    expect_value_error(lambda: eng.advance_watermark(12.5), "12.5")
    expect_value_error(lambda: eng.advance_watermark("x"), "x")

    print("[4] buffer overflow force-closes oldest window below watermark")
    eng = WindowEngine(allowed_lateness=10, window_size=100,
                       max_out_of_order=2)
    eng.push({"key": "a", "ts": 10, "value": 1})   # buffered=1
    eng.push({"key": "a", "ts": 20, "value": 2})   # buffered=2 (at limit)
    eng.advance_watermark(105)  # window [0,100) below wm, not yet closed
    out = eng.push({"key": "b", "ts": 105, "value": 9})  # exceeds limit
    check(sig(out) == [("a", 0, 100, 3, 2)],
          "overflow evicts oldest window below watermark: %s" % out)
    check(eng.pending()["buffered"] == 1,
          "evicted window's events leave the buffer")
    # late event for the force-closed window must still merge, not drop
    eng.push({"key": "a", "ts": 95, "value": 100})  # ts == wm - lateness
    rest = eng.flush()
    check(sig(rest) == [("a", 0, 100, 103, 3), ("b", 100, 200, 9, 1)],
          "force-closed window still absorbs late events: %s" % rest)

    print("[5] events for fully closed windows raise ValueError")
    eng = WindowEngine(allowed_lateness=10, window_size=100,
                       max_out_of_order=100)
    eng.push({"key": "a", "ts": 10, "value": 1})
    eng.advance_watermark(200)  # window [0,100) long closed
    expect_value_error(
        lambda: eng.push({"key": "a", "ts": 50, "value": 1}), "'a'", "50")
    expect_value_error(
        lambda: eng.push({"key": "", "ts": 500, "value": 1}), "key")
    expect_value_error(
        lambda: eng.push({"key": "a", "ts": 500.5, "value": 1}), "500.5")
    expect_value_error(
        lambda: eng.push({"key": "a", "ts": True, "value": 1}), "True")
    expect_value_error(
        lambda: eng.push({"key": "a", "ts": 500, "value": "x"}), "value")
    # boundary: ts == watermark - allowed_lateness is still accepted
    eng.push({"key": "b", "ts": 190, "value": 3})
    check(eng.pending()["buffered"] == 1, "boundary ts accepted")

    print("[6] shuffled arrival order yields identical results")
    rng = random.Random(42)
    events = []
    for i in range(60):
        events.append({"key": "k%d" % (i % 4),
                       "ts": rng.randrange(300, 600),
                       "value": rng.randrange(1, 10)})
    # duplicate ts values included on purpose (same window, same key)
    # fixed watermark schedule: 365 closes the [300,350) windows mid-stream;
    # every event has ts >= 350 - 15 after that point, so nothing is rejected
    early = [ev for ev in events if ev["ts"] < 350]
    late = [ev for ev in events if ev["ts"] >= 350]

    def run(order1, order2, moo):
        e = WindowEngine(allowed_lateness=15, window_size=50,
                         max_out_of_order=moo)
        emitted = []
        for ev in order1:
            emitted += e.push(ev)
        emitted += e.advance_watermark(365)
        for ev in order2:
            emitted += e.push(ev)
        emitted += e.flush()
        return emitted

    def finals(emitted):
        """Last record per (key, window_start) — the authoritative totals."""
        out = {}
        for r in emitted:
            out[(r["key"], r["window_start"])] = (r["sum"], r["count"])
        return out

    def shuffled(pair):
        a, b = list(pair[0]), list(pair[1])
        rng.shuffle(a)
        rng.shuffle(b)
        return a, b

    base = run(early, late, moo=1000)
    for trial in range(5):
        got = run(*shuffled((early, late)), moo=1000)
        check(sig(got) == sig(base),
              "trial %d: identical emission stream regardless of order"
              % trial)
    # same invariant through forced evictions (tiny buffer): forced snapshots
    # may differ mid-stream, but the final per-window totals must not
    base_small = finals(run(early, late, moo=8))
    for trial in range(5):
        got = finals(run(*shuffled((early, late)), moo=8))
        check(got == base_small,
              "trial %d: final window totals deterministic with forced closes"
              % trial)
    total = sum(ev["value"] for ev in events)
    check(sum(s for s, _ in base_small.values()) == total,
          "no event lost: final sums add up to %d" % total)

    print("\nALL TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
