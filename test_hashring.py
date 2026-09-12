"""Unit tests for hashring.py.

Run with:  python -m unittest -v
"""

import hashlib
import json
import unittest
from unittest import mock

import hashring
from hashring import (
    TOKEN_SPACE,
    HashRing,
    build_ring,
    digest_int,
    plan_migration,
    rebalance_plan,
)


# --------------------------------------------------------------------------- #
# Deterministic small-space vnode layouts (monkeypatch hashring.node_token)
# --------------------------------------------------------------------------- #


def make_token_fn(layout):
    """layout: {(node, vnode_index): token}"""

    def fake_node_token(node, index):
        try:
            return layout[(node, index)]
        except KeyError:
            raise AssertionError(f"unexpected vnode requested: {node}#{index}")

    return fake_node_token


# a:10,30  b:50,70  c:20,60 ; every token distinct
LAYOUT_ABC = {
    ("a", 0): 10,
    ("a", 1): 30,
    ("b", 0): 50,
    ("b", 1): 70,
    ("c", 0): 20,
    ("c", 1): 60,
}

# a and b collide on token 10 (a#0 == b#0)
LAYOUT_COLLISION = {
    ("a", 0): 10,
    ("a", 1): 30,
    ("a", 2): 50,
    ("a", 3): 70,
    ("b", 0): 10,
    ("b", 1): 40,
    ("b", 2): 60,
    ("b", 3): 80,
}

# scale-up layout: a alone owns the whole ring via tokens 10,30,50,70;
# new node d drops tokens into [20,30) (20,25) and [60,70) (60,65)
LAYOUT_UP = {
    ("a", 0): 10,
    ("a", 1): 30,
    ("a", 2): 50,
    ("a", 3): 70,
    ("d", 0): 20,
    ("d", 1): 25,
    ("d", 2): 60,
    ("d", 3): 65,
}

# vnodes=2 layout for scale-down: removed node c owns [20,30) and [60,70),
# whose successor on the new {a,b} ring is b in both cases
LAYOUT_DOWN = {
    ("a", 0): 10,
    ("a", 1): 50,
    ("b", 0): 30,
    ("b", 1): 70,
    ("c", 0): 20,
    ("c", 1): 60,
}


def patched(layout, vnodes):
    return mock.patch.multiple(
        hashring,
        node_token=make_token_fn(layout),
        key_hash=lambda key: int(key),
    )


# --------------------------------------------------------------------------- #
# Ring basics / determinism
# --------------------------------------------------------------------------- #


class TestRingDeterminism(unittest.TestCase):
    def test_ring_content_deterministic_and_index_consistent(self):
        r1 = build_ring(["a", "b", "c"], vnodes=4)
        r2 = build_ring(["c", "b", "a"], vnodes=4)  # different input order
        self.assertEqual(
            r1.ring,
            r2.ring,
            "ring content must not depend on node insertion order",
        )
        # dict index must agree exactly with the sorted list
        self.assertEqual(dict(r1.ring), r1._token_owner)
        # tokens strictly sorted, no duplicates
        tokens = [t for t, _ in r1.ring]
        self.assertEqual(tokens, sorted(tokens))
        self.assertEqual(len(tokens), len(set(tokens)))
        # each node owns exactly vnodes entries
        for node in "abc":
            self.assertEqual(len(r1.tokens_of(node)), 4)

    def test_remove_clears_every_token_and_index(self):
        r = build_ring(["a", "b", "c"], vnodes=4)
        owned_before = set(r.tokens_of("b"))
        r.remove_node("b")
        self.assertNotIn("b", r.nodes)
        self.assertEqual(r.tokens_of("b"), [])
        for token in owned_before:
            self.assertNotIn(
                token,
                r._token_owner,
                f"stale index entry for token {token} after remove_node",
            )
        for _, node in r.ring:
            self.assertNotEqual(node, "b", "b's vnode survived in the list")
        # re-adding reproduces the identical ring
        r.add_node("b")
        self.assertEqual(r.ring, build_ring(["a", "b", "c"], 4).ring)

    def test_empty_ring_lookup_raises(self):
        with self.assertRaises(RuntimeError):
            build_ring([], vnodes=4).lookup("k")


# --------------------------------------------------------------------------- #
# Bug #1: token collision
# --------------------------------------------------------------------------- #


class TestTokenCollision(unittest.TestCase):
    def test_collision_arbitrated_by_node_name_stable_lookup(self):
        with patched(LAYOUT_COLLISION, vnodes=4):
            # build in both insertion orders; token 10 must resolve the same
            r_ab = build_ring(["a", "b"], vnodes=4)
            r_ba = build_ring(["b", "a"], vnodes=4)

            self.assertEqual(r_ab.ring, r_ba.ring)
            tokens = [t for t, _ in r_ab.ring]
            self.assertEqual(
                len(tokens),
                len(set(tokens)),
                f"duplicate token(s) on ring: {tokens}",
            )
            # lexicographically smaller node name wins the shared token
            self.assertEqual(
                r_ab._token_owner[10],
                "a",
                "colliding token 10 not arbitrated to smaller node name",
            )
            self.assertNotIn(10, r_ab.tokens_of("b"))

            # every point clockwise from 10 up to 30 resolves to a (tokens
            # 10/30); the same key must return the same owner on repeated
            # lookups, regardless of insertion order
            for point in [5, 10, 11, 25]:
                owner_ab = r_ab.lookup(str(point))
                owner_ba = r_ba.lookup(str(point))
                self.assertEqual(
                    owner_ab,
                    owner_ba,
                    f"colliding token: key at point {point} maps "
                    f"differently depending on insertion order: "
                    f"{owner_ab!r} vs {owner_ba!r}",
                )
                self.assertEqual(
                    r_ab.lookup(str(point)),
                    r_ab.lookup(str(point)),
                    f"key at point {point} gave a different owner on repeat",
                )
                self.assertEqual(owner_ab, "a", f"point {point} owner")
            # first token >= 40 is b's vnode; >= 80 wraps-free to b
            self.assertEqual(r_ab.lookup("40"), "b")
            self.assertEqual(r_ab.lookup("80"), "b")

    def test_collision_under_real_md5_is_order_independent(self):
        # shrink the token space so md5 collisions occur naturally; both
        # hashing paths (vnode names and keys) go through the same wrapper
        small = lambda data: int.from_bytes(  # noqa: E731
            hashlib.md5(data).digest(), "big"
        ) % 64
        with mock.patch.object(hashring, "digest_int", small):
            r1 = build_ring(["n1", "n2", "n3", "n4"], vnodes=4)
            r2 = build_ring(["n4", "n3", "n2", "n1"], vnodes=4)
            self.assertEqual(r1.ring, r2.ring)
            for key in [f"key-{i}" for i in range(500)]:
                self.assertEqual(
                    r1.lookup(key),
                    r2.lookup(key),
                    f"colliding ring disagrees on key {key!r}",
                )

    def test_removing_winner_hands_token_to_surviving_contender(self):
        with patched(LAYOUT_COLLISION, vnodes=4):
            r = build_ring(["a", "b"], vnodes=4)
            self.assertEqual(r._token_owner[10], "a")
            r.remove_node("a")
            self.assertEqual(
                r._token_owner.get(10),
                "b",
                "token 10 should pass to b after winner a is removed",
            )


# --------------------------------------------------------------------------- #
# get_replicas
# --------------------------------------------------------------------------- #


class TestReplicas(unittest.TestCase):
    def test_distinct_physical_nodes_clockwise(self):
        with patched(LAYOUT_ABC, vnodes=2):
            r = build_ring(["a", "b", "c"], vnodes=2)
            self.assertEqual(r.get_replicas("10", 3), ["a", "c", "b"])
            # point 75 wraps around; first physical node clockwise is a
            self.assertEqual(r.get_replicas("75", 3), ["a", "c", "b"])

    def test_exclude_is_skipped(self):
        with patched(LAYOUT_ABC, vnodes=2):
            r = build_ring(["a", "b", "c"], vnodes=2)
            self.assertEqual(
                r.get_replicas("10", 3, exclude={"a"}), ["c", "b"]
            )
            self.assertEqual(
                r.get_replicas("10", 1, exclude={"a", "c"}), ["b"]
            )

    def test_insufficient_nodes_returns_all_available(self):
        with patched(LAYOUT_ABC, vnodes=2):
            r = build_ring(["a", "b", "c"], vnodes=2)
            self.assertEqual(r.get_replicas("10", 10), ["a", "c", "b"])
            self.assertEqual(r.get_replicas("10", 10, exclude={"a", "b", "c"}), [])
            # excluding an unknown node is a no-op
            self.assertEqual(
                r.get_replicas("10", 2, exclude={"ghost"}), ["a", "c"]
            )


# --------------------------------------------------------------------------- #
# Bug #2: migration plan coverage (shared exhaustive checker)
# --------------------------------------------------------------------------- #


def assert_plan_covers_ownership_changes(
    testcase, old_nodes, new_nodes, vnodes
):
    """Independently verify a migration plan against raw ring lookups.

    Exhaustive over the partition cut at every old/new token: ownership is
    constant inside every such segment, so checking each segment's left
    endpoint covers the whole 128-bit token space. Also verifies disjoint,
    sorted, maximally merged ranges.
    """
    old = build_ring(old_nodes, vnodes=vnodes)
    new = build_ring(new_nodes, vnodes=vnodes)
    plan = plan_migration(old_nodes, new_nodes, vnodes=vnodes)

    # structural: sorted, disjoint, half-open, no mergeable neighbours
    ends = []
    for i, (start, end, frm, to) in enumerate(plan):
        testcase.assertLess(
            start,
            end,
            f"plan entry {i} ({start},{end},{frm},{to}) is empty/invalid",
        )
        testcase.assertIsNotNone(
            to, f"plan entry {i} migrates range {start}..{end} onto nothing"
        )
        ends.append(end)
        if i > 0:
            prev = plan[i - 1]
            testcase.assertLessEqual(
                prev[1],
                start,
                f"ranges overlap: {prev[:2]} vs {(start, end)}",
            )
            testcase.assertFalse(
                prev[1] == start and prev[2:] == (frm, to),
                f"adjacent ranges {prev[:2]} and {(start, end)} should "
                f"have been merged (same {frm} -> {to})",
            )

    def containing(point):
        hits = [
            (i, e)
            for i, e in enumerate(plan)
            if e[0] <= point < e[1]
        ]
        return hits

    # exhaustive over the boundary partition: with "first token >= point",
    # ownership is constant on [token+1, next_token+1); cut at token + 1
    boundaries = sorted(
        {
            t + 1
            for t in (set(old._tokens) | set(new._tokens))
            if t + 1 < TOKEN_SPACE
        }
    )
    cuts = [0] + boundaries + [TOKEN_SPACE]
    for seg in range(len(cuts) - 1):
        start, end = cuts[seg], cuts[seg + 1]
        if start == end:
            continue
        point = start  # left endpoint; ownership constant within [start,end)
        old_owner = old.owner_at(point) if old._tokens else None
        new_owner = new.owner_at(point)
        hits = containing(point)
        if old_owner == new_owner:
            testcase.assertFalse(
                hits,
                f"range [{start},{end}) unchanged ({old_owner}) but appears "
                f"in plan: {hits}",
            )
        else:
            testcase.assertEqual(
                len(hits),
                1,
                f"changed segment [{start},{end}) token {point}: "
                f"{old_owner} -> {new_owner} covered {len(hits)} times",
            )
            _, entry = hits[0]
            testcase.assertEqual(
                (entry[2], entry[3]),
                (old_owner, new_owner),
                f"token {point} in [{start},{end}) expected "
                f"{old_owner} -> {new_owner}, plan says "
                f"{entry[2]} -> {entry[3]}",
            )

    # half-open semantics on every plan boundary: end point must not be in
    # the same entry; start point must be in it
    for start, end, frm, to in plan:
        self_hits = containing(start)
        testcase.assertTrue(
            any(e[0] == start for _, e in self_hits),
            f"left endpoint token {start} not covered by its own range",
        )
        for i, e in containing(end):
            testcase.assertNotEqual(
                (e[0], e[1]),
                (start, end),
                f"token {end} leaked into half-open range [{start},{end})",
            )
    return plan


class TestMigrationPlan(unittest.TestCase):
    def test_expansion_covers_every_changed_range(self):
        # real md5 ring, several expansion shapes
        for old, new in [
            (["n1"], ["n1", "n2"]),
            (["n1", "n2"], ["n1", "n2", "n3", "n4"]),
            (["alpha", "beta", "gamma"], ["alpha", "beta", "gamma", "delta"]),
        ]:
            plan = assert_plan_changes(self, old, new, 4)
            self.assertTrue(plan, f"adding nodes to {old} produced no moves")

    def test_scaleup_hand_checked_merge(self):
        with patched(LAYOUT_UP, vnodes=4):
            plan = plan_migration(["a"], ["a", "d"], vnodes=4)
            # "first token >= point" makes token t own up to t inclusive, so
            # d's tokens 20,25 together take integer range [11,26) and
            # 60,65 take [51,66); adjacent same-pair segments are merged
            self.assertEqual(
                plan,
                [(11, 26, "a", "d"), (51, 66, "a", "d")],
                f"unexpected expansion ranges: {plan}",
            )

    def test_scaledown_ranges_go_to_successor(self):
        with patched(LAYOUT_DOWN, vnodes=2):
            # a:10,50  b:30,70  c:20,60; removing c must move its two
            # ranges to its successor on the {a,b} ring
            plan = plan_migration(["a", "b", "c"], ["a", "b"], vnodes=2)
            self.assertEqual(
                plan,
                [(11, 21, "c", "b"), (51, 61, "c", "b")],
                f"removed node c's ranges not handed to successor b: {plan}",
            )
            # and the general checker must agree on every segment
            assert_plan_covers_ownership_changes(
                self, ["a", "b", "c"], ["a", "b"], 2
            )

    def test_scaledown_real_hashes_exhaustive(self):
        assert_plan_covers_ownership_changes(
            self, ["h1", "h2", "h3", "h4"], ["h1", "h2"], 4
        )

    def test_new_keys_from_empty_ring(self):
        plan = plan_migration([], ["solo"], vnodes=4)
        self.assertEqual(plan, [(0, TOKEN_SPACE, None, "solo")])

    def test_key_level_owner_change_matches_plan_real_ring(self):
        # direct key-level contract: for sampled keys, owner change <=> key
        # lies in exactly one plan entry with matching from/to
        old_nodes = ["k-a", "k-b", "k-c"]
        new_nodes = ["k-a", "k-b", "k-c", "k-d", "k-e"]
        old = build_ring(old_nodes, 4)
        new = build_ring(new_nodes, 4)
        plan = plan_migration(old_nodes, new_nodes, 4)
        for key in [f"item/{i}" for i in range(3000)]:
            point = hashring.key_hash(key)
            before, after = old.lookup(key), new.lookup(key)
            hits = [e for e in plan if e[0] <= point < e[1]]
            if before == after:
                self.assertEqual(
                    hits,
                    [],
                    f"key {key!r} (token {point}) owner stayed {before} "
                    f"but appears in plan {hits}",
                )
            else:
                self.assertEqual(
                    len(hits),
                    1,
                    f"key {key!r} (token {point}) {before}->{after} "
                    f"missing/duplicated in plan",
                )
                self.assertEqual(
                    (hits[0][2], hits[0][3]),
                    (before, after),
                    f"key {key!r} token {point}: plan says "
                    f"{hits[0][2]}->{hits[0][3]}, ring says "
                    f"{before}->{after}",
                )


def assert_plan_changes(testcase, old, new, vnodes):
    return assert_plan_covers_ownership_changes(testcase, old, new, vnodes)


# --------------------------------------------------------------------------- #
# rebalance_plan
# --------------------------------------------------------------------------- #


class TestRebalancePlan(unittest.TestCase):
    def _plan(self):
        return rebalance_plan(
            ["a", "b", "c"], ["b", "c", "d"], vnodes=4
        )

    def test_step_order_and_ranges_match_intermediate_rings(self):
        plan = self._plan()
        actions = [(action, node) for action, node, _ in plan]
        # removes (name order) before adds (name order)
        self.assertEqual(actions, [("remove", "a"), ("add", "d")])

        _, _, remove_ranges = plan[0]
        self.assertEqual(
            remove_ranges, plan_migration(["a", "b", "c"], ["b", "c"], 4)
        )
        _, _, add_ranges = plan[1]
        self.assertEqual(
            add_ranges, plan_migration(["b", "c"], ["b", "c", "d"], 4)
        )
        for action, node, ranges in plan:
            self.assertTrue(ranges, f"{action} {node} produced empty step")

    def test_two_calls_byte_identical(self):
        blob1 = json.dumps(self._plan(), sort_keys=True, separators=(",", ":"))
        blob2 = json.dumps(self._plan(), sort_keys=True, separators=(",", ":"))
        self.assertEqual(blob1, blob2)
        self.assertEqual(self._plan(), self._plan())

    def test_noop_topology_is_empty(self):
        self.assertEqual(
            rebalance_plan(["a", "b"], ["b", "a"], vnodes=4), []
        )


if __name__ == "__main__":
    unittest.main()
