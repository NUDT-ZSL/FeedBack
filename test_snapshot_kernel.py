"""snapshot_kernel 与 main.py CLI 的测试套件。

运行：python -m unittest test_snapshot_kernel.py -v
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest

import main as cli
from snapshot_kernel import (
    AncestorNotFoundError,
    Entry,
    LimitExceededError,
    SerializationError,
    Snapshot,
    SnapshotNotFoundError,
    SnapshotStore,
    ValidationError,
    entry_to_dict,
    make_dir,
    make_file,
    validate_entry_set,
)


# ---------------------------------------------------------------------------
# 构造辅助
# ---------------------------------------------------------------------------


def file(path, h, size=1, mode=0o644):
    return make_file(path, h, size=size, mode=mode)


def dir_(path, mode=0o755):
    return make_dir(path, mode=mode)


def base_tree():
    """/ 下两棵子树 /a 与 /d，外加一个根级文件，便于各类合并场景。"""
    return {
        "/": dir_("/"),
        "/a": dir_("/a"),
        "/a/f.txt": file("/a/f.txt", "h-f", size=10),
        "/a/g.txt": file("/a/g.txt", "h-g", size=20),
        "/d": dir_("/d"),
        "/d/keep": file("/d/keep", "h-keep", size=3),
        "/d/sub": dir_("/d/sub"),
        "/d/sub/deep": file("/d/sub/deep", "h-deep", size=4),
        "/b.txt": file("/b.txt", "h-b", size=7),
    }


def clone(entries, overrides=None):
    out = dict(entries)
    if overrides:
        out.update(overrides)
    return out


def drop(entries, *paths):
    out = dict(entries)
    for p in paths:
        out.pop(p, None)
    return out


def three_snapshots(store=None):
    """返回 (store, base, ours, theirs)。"""
    store = store or SnapshotStore()
    base = store.create_snapshot(None, base_tree(), snap_id="base")
    ours_entries = clone(
        base_tree(),
        {
            "/a/f.txt": file("/a/f.txt", "h-f-ours", size=11),
            "/b.txt": file("/b.txt", "h-b-ours", size=8),
        },
    )
    ours = store.create_snapshot("base", ours_entries, snap_id="ours")
    theirs_entries = clone(
        base_tree(),
        {
            "/a/g.txt": file("/a/g.txt", "h-g-theirs", size=22),
            "/c.txt": file("/c.txt", "h-c", size=5),
        },
    )
    theirs = store.create_snapshot("base", theirs_entries, snap_id="theirs")
    return store, base, ours, theirs


# ---------------------------------------------------------------------------
# 1. Entry / 路径校验
# ---------------------------------------------------------------------------


class EntryValidationTests(unittest.TestCase):
    def test_valid_file_and_dir(self):
        f = Entry(path="/x", kind="file", content_hash="h", size=1, mode=0)
        d = Entry(path="/x", kind="dir", size=0, mode=0)
        self.assertEqual(f.content_hash, "h")
        self.assertIsNone(d.content_hash)

    def test_path_rules(self):
        for bad in ("", "relative/path", "/a/./b", "/a/../b", "/a/../", 123, None):
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError):
                    Entry(path=bad, kind="dir")

    def test_backslash_rejected(self):
        with self.assertRaises(ValidationError):
            Entry(path=r"\windows", kind="dir")
        with self.assertRaises(ValidationError):
            Entry(path="/a\\b", kind="dir")

    def test_path_normalized(self):
        e = Entry(path="/a//b/c/", kind="dir")
        self.assertEqual(e.path, "/a/b/c")
        # 含 . 段即使能被 normpath 消掉也必须拒绝。
        with self.assertRaises(ValidationError):
            Entry(path="/a/./b", kind="dir")
        with self.assertRaises(ValidationError):
            Entry(path="/a/b/../c", kind="dir")

    def test_kind_must_be_valid(self):
        with self.assertRaises(ValidationError) as ctx:
            Entry(path="/x", kind="symlink")
        self.assertIn("/x", str(ctx.exception))
        self.assertEqual(ctx.exception.path, "/x")

    def test_file_requires_hash(self):
        with self.assertRaises(ValidationError):
            Entry(path="/x", kind="file", content_hash=None, size=1, mode=0)
        with self.assertRaises(ValidationError):
            Entry(path="/x", kind="file", content_hash="", size=1, mode=0)

    def test_dir_must_not_have_hash(self):
        with self.assertRaises(ValidationError):
            Entry(path="/x", kind="dir", content_hash="h", size=0, mode=0)

    def test_negative_size_and_mode(self):
        with self.assertRaises(ValidationError):
            Entry(path="/x", kind="file", content_hash="h", size=-1, mode=0)
        with self.assertRaises(ValidationError):
            Entry(path="/x", kind="file", content_hash="h", size=0, mode=-1)

    def test_bool_not_accepted_as_int(self):
        with self.assertRaises(ValidationError):
            Entry(path="/x", kind="file", content_hash="h", size=True, mode=0)
        with self.assertRaises(ValidationError):
            Entry(path="/x", kind="dir", size=0, mode=False)

    def test_entry_is_frozen(self):
        e = file("/x", "h")
        with self.assertRaises(Exception):
            e.size = 5  # type: ignore[misc]


class EntrySetValidationTests(unittest.TestCase):
    def test_empty_tree_ok(self):
        validate_entry_set({})

    def test_root_only_ok(self):
        validate_entry_set({"/": dir_("/")})

    def test_key_path_mismatch(self):
        entries = {"/a": file("/b", "h")}
        with self.assertRaises(ValidationError) as ctx:
            validate_entry_set(entries)
        self.assertIn("/a", str(ctx.exception))

    def test_duplicate_path_via_spelling(self):
        # dict 键不同，但规范化后碰撞。
        entries = {"/a/b": dir_("/a/b"), "/a//b": dir_("/a//b")}
        with self.assertRaises(ValidationError):
            validate_entry_set(entries)

    def test_missing_parent_dir(self):
        with self.assertRaises(ValidationError) as ctx:
            validate_entry_set({"/": dir_("/"), "/a/f": file("/a/f", "h")})
        self.assertIn("/a/f", str(ctx.exception))

    def test_parent_is_file(self):
        entries = {
            "/": dir_("/"),
            "/a": file("/a", "h"),
            "/a/f": file("/a/f", "h2"),
        }
        with self.assertRaises(ValidationError):
            validate_entry_set(entries)

    def test_error_mentions_problem_path(self):
        # 绕过冻结构造，制造一个“构造后被破坏”的非法条目，
        # 验证集合级校验的报错同样带问题路径。
        bad = file("/a/f", "h")
        object.__setattr__(bad, "size", -1)
        with self.assertRaises(ValidationError) as ctx:
            validate_entry_set(
                {"/": dir_("/"), "/a": dir_("/a"), "/a/f": bad}
            )
        self.assertIn("/a/f", str(ctx.exception))


# ---------------------------------------------------------------------------
# 2. 快照树 / 逻辑时钟 / 限额
# ---------------------------------------------------------------------------


class SnapshotTreeTests(unittest.TestCase):
    def test_snap_id_rules(self):
        with self.assertRaises(ValidationError):
            Snapshot(snap_id="", parent_id=None, entries={})
        with self.assertRaises(ValidationError):
            Snapshot(snap_id=123, parent_id=None, entries={})  # type: ignore[arg-type]

    def test_snapshot_entries_are_immutable(self):
        snap = Snapshot("s1", None, {"/": dir_("/")})
        with self.assertRaises(TypeError):
            snap.entries["/x"] = file("/x", "h")  # type: ignore[index]

    def test_create_assigns_monotonic_logical_time(self):
        store = SnapshotStore(initial_time=10)
        self.assertEqual(store.logical_time, 10)
        s1 = store.create_snapshot(None, {})
        s2 = store.create_snapshot(s1.snap_id, {"/": dir_("/")})
        self.assertEqual((s1.logical_time, s2.logical_time), (11, 12))
        self.assertEqual(store.logical_time, 12)

    def test_auto_ids_unique(self):
        store = SnapshotStore()
        ids = {store.create_snapshot(None, {}).snap_id for _ in range(3)}
        self.assertEqual(len(ids), 3)

    def test_explicit_duplicate_id_rejected(self):
        store = SnapshotStore()
        store.create_snapshot(None, {}, snap_id="x")
        with self.assertRaises(Exception):
            store.create_snapshot(None, {}, snap_id="x")

    def test_unknown_parent_rejected(self):
        store = SnapshotStore()
        with self.assertRaises(SnapshotNotFoundError):
            store.create_snapshot("ghost", {})

    def test_children_and_multiple_roots(self):
        store = SnapshotStore()
        r1 = store.create_snapshot(None, {}, snap_id="r1")
        r2 = store.create_snapshot(None, {}, snap_id="r2")
        c = store.create_snapshot("r1", {}, snap_id="c")
        self.assertEqual(store.children("r1"), ["c"])
        self.assertEqual(
            sorted(s.snap_id for s in store.roots()), ["r1", "r2"]
        )
        self.assertEqual(
            [s.snap_id for s in store.ancestors_of(c.snap_id)], ["c", "r1"]
        )

    def test_create_copies_entries(self):
        store = SnapshotStore()
        entries = {"/": dir_("/")}
        snap = store.create_snapshot(None, entries)
        entries["/injected"] = file("/injected", "h")
        self.assertNotIn("/injected", snap.entries)


class LimitTests(unittest.TestCase):
    def test_invalid_limits_rejected(self):
        for kwargs in (
            {"max_entries": 0},
            {"max_entries": -1},
            {"max_snapshots": 0},
            {"initial_time": -1},
        ):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(Exception):
                    SnapshotStore(**kwargs)

    def test_max_entries(self):
        store = SnapshotStore(max_entries=2)
        ok = {"/": dir_("/"), "/a": dir_("/a")}
        store.create_snapshot(None, ok, snap_id="s1")
        too_many = {
            "/": dir_("/"),
            "/a": dir_("/a"),
            "/b": dir_("/b"),
        }
        with self.assertRaises(LimitExceededError) as ctx:
            store.create_snapshot("s1", too_many, snap_id="s2")
        self.assertIn("max_entries=2", str(ctx.exception))
        ids = {s.snap_id for s in store.all_snapshots()}
        self.assertNotIn("s2", ids)

    def test_max_snapshots(self):
        store = SnapshotStore(max_snapshots=2)
        s1 = store.create_snapshot(None, {}, snap_id="s1")
        store.create_snapshot(s1.snap_id, {}, snap_id="s2")
        with self.assertRaises(LimitExceededError) as ctx:
            store.create_snapshot("s2", {}, snap_id="s3")
        self.assertIn("max_snapshots=2", str(ctx.exception))

    def test_validation_before_limit(self):
        # 非法输入必须报 ValidationError，而不是限额错误。
        store = SnapshotStore(max_entries=1)
        with self.assertRaises(ValidationError):
            store.create_snapshot(
                None,
                {
                    "/": dir_("/"),
                    "/a": file("/a", "h"),
                    "/a/x": file("/a/x", "h2"),
                },
            )


# ---------------------------------------------------------------------------
# 3. 共同祖先
# ---------------------------------------------------------------------------


class AncestorTests(unittest.TestCase):
    def test_siblings_lca(self):
        store, _b, _o, _t = three_snapshots()
        lca = store.find_common_ancestor("ours", "theirs")
        self.assertEqual(lca.snap_id, "base")

    def test_linear_chain(self):
        store = SnapshotStore()
        store.create_snapshot(None, {}, snap_id="r")
        store.create_snapshot("r", {}, snap_id="m")
        store.create_snapshot("m", {}, snap_id="n")
        self.assertEqual(store.find_common_ancestor("r", "n").snap_id, "r")
        self.assertEqual(store.find_common_ancestor("n", "r").snap_id, "r")
        self.assertEqual(store.find_common_ancestor("m", "n").snap_id, "m")
        self.assertEqual(store.find_common_ancestor("n", "n").snap_id, "n")

    def test_cross_root_no_ancestor(self):
        store = SnapshotStore()
        store.create_snapshot(None, {}, snap_id="r1")
        store.create_snapshot(None, {}, snap_id="r2")
        with self.assertRaises(AncestorNotFoundError):
            store.find_common_ancestor("r1", "r2")

    def test_missing_snapshot(self):
        store = SnapshotStore()
        with self.assertRaises(SnapshotNotFoundError):
            store.find_common_ancestor("a", "b")


# ---------------------------------------------------------------------------
# 4. diff
# ---------------------------------------------------------------------------


class DiffTests(unittest.TestCase):
    def setUp(self):
        self.store, self.base, self.ours, self.theirs = three_snapshots()

    def test_add_modify(self):
        ch = self.store.diff("base", "ours")
        self.assertEqual(ch.modified, ["/a/f.txt", "/b.txt"])
        self.assertEqual(ch.added, [])
        self.assertEqual(ch.removed, [])

    def test_added_and_sorted(self):
        ch = self.store.diff("base", "theirs")
        self.assertEqual(ch.added, ["/c.txt"])
        self.assertEqual(ch.modified, ["/a/g.txt"])

    def test_directory_deletion_lists_whole_subtree(self):
        entries = drop(
            base_tree(), "/d", "/d/keep", "/d/sub", "/d/sub/deep"
        )
        self.store.create_snapshot("base", entries, snap_id="del")
        ch = self.store.diff("base", "del")
        self.assertEqual(
            ch.removed, ["/d", "/d/keep", "/d/sub", "/d/sub/deep"]
        )

    def test_directory_addition_lists_subtree(self):
        entries = clone(
            base_tree(),
            {
                "/n": dir_("/n"),
                "/n/x": file("/n/x", "h-x"),
                "/n/y": file("/n/y", "h-y"),
            },
        )
        self.store.create_snapshot("base", entries, snap_id="add")
        ch = self.store.diff("base", "add")
        self.assertEqual(ch.added, ["/n", "/n/x", "/n/y"])

    def test_kind_change_is_modified(self):
        entries = clone(base_tree(), {"/a": file("/a", "now-a-file")})
        # /a 变 file 后不能再有子节点。
        entries = drop(entries, "/a/f.txt", "/a/g.txt")
        self.store.create_snapshot("base", entries, snap_id="kind")
        ch = self.store.diff("base", "kind")
        self.assertIn("/a", ch.modified)
        self.assertEqual(ch.removed, ["/a/f.txt", "/a/g.txt"])

    def test_metadata_only_change_is_modified(self):
        entries = clone(
            base_tree(), {"/b.txt": file("/b.txt", "h-b", size=99)}
        )
        self.store.create_snapshot("base", entries, snap_id="meta")
        ch = self.store.diff("base", "meta")
        self.assertEqual(ch.modified, ["/b.txt"])

    def test_same_snapshot_empty_diff(self):
        ch = self.store.diff("base", "base")
        self.assertTrue(ch.is_empty)


# ---------------------------------------------------------------------------
# 5. 三方合并
# ---------------------------------------------------------------------------


class MergeTests(unittest.TestCase):
    def setUp(self):
        self.store, self.base, self.ours, self.theirs = three_snapshots()

    def test_clean_parallel_changes_merge(self):
        # ours 改 /a/f.txt、/b.txt；theirs 改 /a/g.txt、加 /c.txt —— 互不相交。
        result = self.store.merge("ours", "theirs")
        self.assertFalse(
            result.has_conflicts, [c.message for c in result.conflicts]
        )
        validate_entry_set(result.entries)
        self.assertEqual(
            result.entries["/a/f.txt"].content_hash, "h-f-ours"
        )
        self.assertEqual(result.entries["/b.txt"].content_hash, "h-b-ours")
        self.assertEqual(
            result.entries["/a/g.txt"].content_hash, "h-g-theirs"
        )
        self.assertIn("/c.txt", result.entries)
        self.assertEqual(result.base_id, "base")
        self.assertEqual(result.auto_resolved["/c.txt"], "theirs")
        self.assertEqual(result.auto_resolved["/b.txt"], "ours")

    def test_identical_sides(self):
        result = self.store.three_way_merge("base", "base", "base")
        self.assertFalse(result.has_conflicts)
        self.assertEqual(set(result.entries), set(self.base.entries))

    def test_fast_forward_when_one_side_is_ancestor(self):
        result = self.store.three_way_merge("ours", "ours", "theirs")
        self.assertIn("/c.txt", result.entries)
        self.assertFalse(result.has_conflicts)

    def test_both_make_same_change_auto_resolved(self):
        same = clone(
            base_tree(), {"/b.txt": file("/b.txt", "h-b-same", size=70)}
        )
        self.store.create_snapshot("base", same, snap_id="o-same")
        self.store.create_snapshot("base", dict(same), snap_id="t-same")
        result = self.store.merge("o-same", "t-same")
        self.assertFalse(result.has_conflicts)
        self.assertEqual(
            result.entries["/b.txt"].content_hash, "h-b-same"
        )
        self.assertEqual(result.auto_resolved["/b.txt"], "both-same")

    def test_modify_modify_conflict_explained(self):
        entries = clone(
            base_tree(),
            {"/a/f.txt": file("/a/f.txt", "h-f-theirs", size=12)},
        )
        self.store.create_snapshot("base", entries, snap_id="theirs2")
        result = self.store.merge("ours", "theirs2")
        self.assertTrue(result.has_conflicts)
        conflict = next(
            c for c in result.conflicts if c.path == "/a/f.txt"
        )
        self.assertEqual(conflict.kind, "modify-modify")
        self.assertIn("h-f-ours", conflict.ours)
        self.assertIn("h-f-theirs", conflict.theirs)
        self.assertIn("h-f", conflict.base)
        self.assertIn("/a/f.txt", conflict.message)
        self.assertNotIn("/a/f.txt", result.entries)
        self.assertNotIn("/a/f.txt", result.auto_resolved)

    def test_add_add_conflict(self):
        o_entries = clone(
            base_tree(), {"/new": file("/new", "from-ours")}
        )
        t_entries = clone(
            base_tree(), {"/new": file("/new", "from-theirs")}
        )
        self.store.create_snapshot("base", o_entries, snap_id="o-add")
        self.store.create_snapshot("base", t_entries, snap_id="t-add")
        result = self.store.merge("o-add", "t-add")
        kinds = {c.path: c.kind for c in result.conflicts}
        self.assertEqual(kinds["/new"], "add-add")
        self.assertNotIn("/new", result.entries)

    def test_modify_delete_conflict(self):
        # theirs 删除 /a 整棵子树，ours 修改了其中既有的 /a/f.txt。
        t_entries = drop(base_tree(), "/a", "/a/f.txt", "/a/g.txt")
        self.store.create_snapshot("base", t_entries, snap_id="del-a")
        result = self.store.merge("ours", "del-a")
        kinds = {c.path: c.kind for c in result.conflicts}
        self.assertEqual(kinds["/a/f.txt"], "modify-delete")
        # ours 没动 /a/g.txt，删除被自动接受。
        self.assertNotIn("/a/g.txt", result.entries)
        # 冲突文件与被删目录都不能静默进入结果。
        self.assertNotIn("/a/f.txt", result.entries)
        self.assertNotIn("/a", result.entries)

    def test_delete_modify_other_direction(self):
        # ours 删除 /b.txt，theirs 修改它。
        o_entries = drop(base_tree(), "/b.txt")
        self.store.create_snapshot("base", o_entries, snap_id="o-delb")
        t_entries = clone(
            base_tree(), {"/b.txt": file("/b.txt", "h-b-t", size=77)}
        )
        self.store.create_snapshot("base", t_entries, snap_id="t-modb")
        result = self.store.merge("o-delb", "t-modb")
        kinds = {c.path: c.kind for c in result.conflicts}
        self.assertEqual(kinds["/b.txt"], "delete-modify")

    def test_file_dir_conflict(self):
        # 两边把同一路径改成不同类型（合法快照：删掉子节点）。
        o_entries = drop(
            clone(base_tree(), {"/a": file("/a", "a-file")}),
            "/a/f.txt",
            "/a/g.txt",
        )
        t_entries = clone(
            base_tree(), {"/a": dir_("/a", mode=0o700)}
        )
        self.store.create_snapshot("base", o_entries, snap_id="o-file")
        self.store.create_snapshot("base", t_entries, snap_id="t-dir")
        result = self.store.merge("o-file", "t-dir")
        kinds = {c.path: c.kind for c in result.conflicts}
        self.assertEqual(kinds["/a"], "file-dir")

    def test_orphan_new_file_under_deleted_directory(self):
        # ours 在 /d 下新增文件；theirs 删除整棵 /d。
        o_entries = clone(
            base_tree(), {"/d/new": file("/d/new", "h-new")}
        )
        self.store.create_snapshot("base", o_entries, snap_id="o-new")
        t_entries = drop(
            base_tree(), "/d", "/d/keep", "/d/sub", "/d/sub/deep"
        )
        self.store.create_snapshot("base", t_entries, snap_id="t-deld")
        result = self.store.merge("o-new", "t-deld")

        self.assertIn("/d/new", result.orphaned)
        self.assertNotIn("/d/new", result.entries)
        orphan_conflicts = {
            c.path: c.kind
            for c in result.conflicts
            if c.path == "/d/new"
        }
        self.assertEqual(orphan_conflicts["/d/new"], "parent-dir")
        message = next(
            c.message for c in result.conflicts if c.path == "/d/new"
        )
        self.assertIn("/d", message)
        # 孤儿不算自动裁决成功。
        self.assertNotIn("/d/new", result.auto_resolved)
        # 删除方一侧的传播生效。
        self.assertNotIn("/d/keep", result.entries)
        # 无冲突部分仍然完整合法。
        validate_entry_set(result.entries)

    def test_conflicted_directory_hides_descendants(self):
        # 双方对目录 /d 的元数据做了不一致修改（modify-modify），
        # 未改动的子文件不能悬空落位。
        o_entries = clone(
            base_tree(), {"/d": dir_("/d", mode=0o700)}
        )
        t_entries = clone(
            base_tree(), {"/d": dir_("/d", mode=0o711)}
        )
        self.store.create_snapshot("base", o_entries, snap_id="o-dmod")
        self.store.create_snapshot("base", t_entries, snap_id="t-dmod")
        result = self.store.merge("o-dmod", "t-dmod")
        kinds = {c.path: c.kind for c in result.conflicts}
        self.assertEqual(kinds["/d"], "modify-modify")
        self.assertIn("/d/keep", result.orphaned)
        self.assertEqual(kinds["/d/keep"], "parent-dir")
        self.assertNotIn("/d/keep", result.entries)

    def test_merge_self_is_valid_tree(self):
        result = self.store.merge("ours", "ours")
        validate_entry_set(result.entries)
        self.assertFalse(result.has_conflicts)

    def test_empty_base_merge(self):
        store = SnapshotStore()
        store.create_snapshot(
            None, {"/": dir_("/"), "/a": file("/a", "ha")}, snap_id="o"
        )
        store.create_snapshot(
            None, {"/": dir_("/"), "/b": file("/b", "hb")}, snap_id="t"
        )
        result = store.three_way_merge(None, "o", "t")
        self.assertFalse(result.has_conflicts)
        self.assertIn("/a", result.entries)
        self.assertIn("/b", result.entries)

        # 同一新增路径两边不同且无 base -> add-add。
        store.create_snapshot(
            None, {"/": dir_("/"), "/x": file("/x", "1")}, snap_id="o2"
        )
        store.create_snapshot(
            None, {"/": dir_("/"), "/x": file("/x", "2")}, snap_id="t2"
        )
        conflict_result = store.three_way_merge(None, "o2", "t2")
        self.assertEqual(
            [
                c.kind
                for c in conflict_result.conflicts
                if c.path == "/x"
            ],
            ["add-add"],
        )

    def test_merge_cross_root_raises(self):
        store = SnapshotStore()
        store.create_snapshot(None, {}, snap_id="x")
        store.create_snapshot(None, {}, snap_id="y")
        with self.assertRaises(AncestorNotFoundError):
            store.merge("x", "y")

    def test_merge_result_to_dict(self):
        result = self.store.merge("ours", "theirs")
        payload = result.to_dict()
        self.assertEqual(payload["base_id"], "base")
        self.assertFalse(payload["has_conflicts"])
        self.assertIn("/a/f.txt", payload["entries"])
        self.assertEqual(payload["conflicts"], [])


# ---------------------------------------------------------------------------
# 6. save / load
# ---------------------------------------------------------------------------


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "store.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_roundtrip_preserves_diff_and_merge(self):
        store, _b, _o, _t = three_snapshots()
        diff_before = store.diff("base", "theirs").to_dict()
        merge_before = store.merge("ours", "theirs").to_dict()
        store.save(self.path)

        loaded = SnapshotStore.load(self.path)
        self.assertEqual(loaded.logical_time, store.logical_time)
        self.assertEqual(
            sorted(s.snap_id for s in loaded.all_snapshots()),
            sorted(s.snap_id for s in store.all_snapshots()),
        )
        diff_after = loaded.diff("base", "theirs").to_dict()
        merge_after = loaded.merge("ours", "theirs").to_dict()
        self.assertEqual(diff_before, diff_after)
        self.assertEqual(
            json.dumps(merge_before, sort_keys=True),
            json.dumps(merge_after, sort_keys=True),
        )

    def test_clock_continues_after_load(self):
        store = SnapshotStore(initial_time=0)
        store.create_snapshot(None, {}, snap_id="s1")
        store.save(self.path)
        loaded = SnapshotStore.load(self.path)
        s2 = loaded.create_snapshot("s1", {})
        self.assertEqual(s2.logical_time, 2)

    def test_limits_persisted(self):
        SnapshotStore(max_entries=5, max_snapshots=9).save(self.path)
        loaded = SnapshotStore.load(self.path)
        self.assertEqual(loaded.max_entries, 5)
        self.assertEqual(loaded.max_snapshots, 9)

    def test_load_missing_file(self):
        with self.assertRaises(SerializationError) as ctx:
            SnapshotStore.load(os.path.join(self.tmp.name, "nope.json"))
        self.assertIn("不存在", str(ctx.exception))

    def test_load_corrupt_json(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        with self.assertRaises(SerializationError) as ctx:
            SnapshotStore.load(self.path)
        self.assertIn("合法 JSON", str(ctx.exception))

    def test_load_bad_top_level(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump([1, 2, 3], fh)
        with self.assertRaises(SerializationError):
            SnapshotStore.load(self.path)

    def test_load_missing_snapshots_field(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"format": "snapshot-store-v1"}, fh)
        with self.assertRaises(SerializationError) as ctx:
            SnapshotStore.load(self.path)
        self.assertIn("snapshots", str(ctx.exception))

    def test_load_missing_snap_id(self):
        payload = {
            "format": "snapshot-store-v1",
            "logical_time": 1,
            "snapshots": [
                {
                    "parent_id": None,
                    "entries": {"/": entry_to_dict(dir_("/"))},
                }
            ],
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        with self.assertRaises(SerializationError) as ctx:
            SnapshotStore.load(self.path)
        self.assertIn("snap_id", str(ctx.exception))

    def test_load_entry_missing_fields(self):
        payload = {
            "snapshots": [
                {
                    "snap_id": "r",
                    "parent_id": None,
                    "entries": {
                        "/x": {"kind": "file", "content_hash": "h"}
                    },
                }
            ]
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        with self.assertRaises(SerializationError) as ctx:
            SnapshotStore.load(self.path)
        self.assertIn("size", str(ctx.exception))
        self.assertIn("mode", str(ctx.exception))

    def test_load_bad_entry_value(self):
        payload = {
            "snapshots": [
                {
                    "snap_id": "r",
                    "parent_id": None,
                    "entries": {
                        "/": entry_to_dict(dir_("/")),
                        "/x": {
                            "kind": "file",
                            "content_hash": "h",
                            "size": -3,
                            "mode": 0,
                        },
                    },
                }
            ]
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        with self.assertRaises(SerializationError) as ctx:
            SnapshotStore.load(self.path)
        self.assertIn("/x", str(ctx.exception))

    def test_load_parent_out_of_order(self):
        root = {
            "snap_id": "r",
            "parent_id": None,
            "logical_time": 1,
            "entries": {},
        }
        child = {
            "snap_id": "c",
            "parent_id": "r",
            "logical_time": 2,
            "entries": {},
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"snapshots": [child, root]}, fh)
        with self.assertRaises(SerializationError) as ctx:
            SnapshotStore.load(self.path)
        self.assertIn("父快照", str(ctx.exception))

    def test_load_limit_enforcement_can_be_skipped(self):
        store = SnapshotStore(max_snapshots=10)
        for i in range(5):
            parent = None if i == 0 else f"s{i}"
            store.create_snapshot(parent, {}, snap_id=f"s{i + 1}")
        store.save(self.path)
        # 文件有 5 个快照；以更小的限额加载 -> 默认拒绝。
        with self.assertRaises(LimitExceededError):
            SnapshotStore.load(self.path, max_snapshots=3)
        # enforce_limits=False -> 放行只读，内容完整。
        relaxed = SnapshotStore.load(
            self.path, max_snapshots=3, enforce_limits=False
        )
        self.assertEqual(len(relaxed.all_snapshots()), 5)


# ---------------------------------------------------------------------------
# 7. CLI
# ---------------------------------------------------------------------------


def write_entries(path, entries):
    payload = {"entries": {p: entry_to_dict(e) for p, e in entries.items()}}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = os.path.join(self.tmp.name, "store.json")
        self.base_json = os.path.join(self.tmp.name, "base.json")
        self.ours_json = os.path.join(self.tmp.name, "ours.json")
        self.theirs_json = os.path.join(self.tmp.name, "theirs.json")
        tree = base_tree()
        write_entries(self.base_json, tree)
        write_entries(
            self.ours_json,
            clone(
                tree,
                {"/a/f.txt": file("/a/f.txt", "h-f-ours", size=11)},
            ),
        )
        write_entries(
            self.theirs_json,
            clone(tree, {"/c.txt": file("/c.txt", "h-c", size=5)}),
        )

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = cli.main(list(argv))
        out = buf.getvalue()
        try:
            payload = json.loads(out) if out.strip() else None
        except json.JSONDecodeError:
            self.fail(f"输出不是合法 JSON: {out!r}")
        return code, payload

    def test_full_workflow(self):
        code, out = self.run_cli("--store", self.store, "init")
        self.assertEqual(code, 0)
        self.assertEqual(out["status"], "ok")

        code, out = self.run_cli(
            "--store", self.store, "root",
            "--entries", self.base_json, "--id", "base",
        )
        self.assertEqual(code, 0)
        self.assertIsNone(out["snapshot"]["parent_id"])

        code, out = self.run_cli(
            "--store", self.store, "create", "--parent", "base",
            "--entries", self.ours_json, "--id", "ours",
        )
        self.assertEqual(code, 0)
        self.assertEqual(out["snapshot"]["logical_time"], 2)

        self.run_cli(
            "--store", self.store, "create", "--parent", "base",
            "--entries", self.theirs_json, "--id", "theirs",
        )

        code, out = self.run_cli(
            "--store", self.store, "ancestor",
            "--a", "ours", "--b", "theirs",
        )
        self.assertEqual(out["common_ancestor"], "base")

        code, out = self.run_cli("--store", self.store, "list")
        self.assertEqual(
            [s["snap_id"] for s in out["snapshots"]],
            ["base", "ours", "theirs"],
        )

        code, out = self.run_cli(
            "--store", self.store, "diff",
            "--from", "base", "--to", "theirs",
        )
        self.assertEqual(out["changes"]["added"], ["/c.txt"])

        code, out = self.run_cli(
            "--store", self.store, "show", "--id", "base"
        )
        self.assertEqual(out["snapshot"]["snap_id"], "base")

    def test_merge_clean_and_commit(self):
        self.run_cli("--store", self.store, "init")
        self.run_cli(
            "--store", self.store, "root",
            "--entries", self.base_json, "--id", "base",
        )
        self.run_cli(
            "--store", self.store, "create", "--parent", "base",
            "--entries", self.ours_json, "--id", "ours",
        )
        self.run_cli(
            "--store", self.store, "create", "--parent", "base",
            "--entries", self.theirs_json, "--id", "theirs",
        )

        code, out = self.run_cli(
            "--store", self.store, "merge",
            "--ours", "ours", "--theirs", "theirs",
            "--commit-as", "merged",
        )
        self.assertEqual(code, 0)
        self.assertFalse(out["merge"]["has_conflicts"])
        self.assertEqual(out["committed"]["parent_id"], "ours")
        self.assertIn("/a/f.txt", out["committed"]["entries"])

    def test_merge_conflict_is_structured_result(self):
        # 双方都改 /a/f.txt。
        conflict_json = os.path.join(self.tmp.name, "conflict.json")
        write_entries(
            conflict_json,
            clone(
                base_tree(),
                {"/a/f.txt": file("/a/f.txt", "other", size=99)},
            ),
        )
        self.run_cli("--store", self.store, "init")
        self.run_cli(
            "--store", self.store, "root",
            "--entries", self.base_json, "--id", "base",
        )
        self.run_cli(
            "--store", self.store, "create", "--parent", "base",
            "--entries", self.ours_json, "--id", "ours",
        )
        self.run_cli(
            "--store", self.store, "create", "--parent", "base",
            "--entries", conflict_json, "--id", "t2",
        )

        # 仅合并：结构化冲突，退出码 0。
        code, out = self.run_cli(
            "--store", self.store, "merge",
            "--ours", "ours", "--theirs", "t2",
        )
        self.assertEqual(code, 0)
        self.assertTrue(out["merge"]["has_conflicts"])
        self.assertEqual(
            out["merge"]["conflicts"][0]["path"], "/a/f.txt"
        )

        # 试图提交冲突结果：错误 JSON，退出码 1，且未创建快照。
        code, out = self.run_cli(
            "--store", self.store, "merge",
            "--ours", "ours", "--theirs", "t2",
            "--commit-as", "bad-commit",
        )
        self.assertEqual(code, 1)
        self.assertIn("error", out)
        code, listing = self.run_cli("--store", self.store, "list")
        self.assertNotIn(
            "bad-commit", [s["snap_id"] for s in listing["snapshots"]]
        )

    def test_error_json_for_missing_snapshot(self):
        self.run_cli("--store", self.store, "init")
        code, out = self.run_cli(
            "--store", self.store, "show", "--id", "ghost"
        )
        self.assertEqual(code, 1)
        self.assertIn("error", out)
        self.assertEqual(out["type"], "SnapshotNotFoundError")

    def test_error_json_for_validation(self):
        bad_json = os.path.join(self.tmp.name, "bad.json")
        write_entries(bad_json, {"/x": file("/x", "h")})  # 缺父目录
        code, out = self.run_cli(
            "--store", self.store, "validate", "--entries", bad_json
        )
        self.assertEqual(code, 1)
        self.assertIn("error", out)
        self.assertIn("/x", out["error"])

    def test_bad_command_argument_error_json(self):
        # argparse 用法错误：输出 JSON 并以退出码 2 结束进程。
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                cli.main(["--store", self.store, "show"])
        self.assertEqual(cm.exception.code, 2)
        out = json.loads(buf.getvalue())
        self.assertIn("error", out)
        self.assertEqual(out["type"], "ArgumentError")

    def test_store_missing_file_error(self):
        code, out = self.run_cli(
            "--store", os.path.join(self.tmp.name, "absent.json"), "list"
        )
        self.assertEqual(code, 1)
        self.assertIn("error", out)

    def test_init_refuses_overwrite_without_force(self):
        self.run_cli("--store", self.store, "init")
        self.run_cli(
            "--store", self.store, "root",
            "--entries", self.base_json, "--id", "base",
        )
        code, out = self.run_cli("--store", self.store, "init")
        self.assertEqual(code, 1)
        self.assertIn("error", out)
        code, out = self.run_cli(
            "--store", self.store, "show", "--id", "base"
        )
        self.assertEqual(code, 0)  # 未被覆盖
        code, _ = self.run_cli("--store", self.store, "init", "--force")
        self.assertEqual(code, 0)

    def test_corrupt_store_file_error(self):
        self.run_cli("--store", self.store, "init")
        with open(self.store, "w", encoding="utf-8") as fh:
            fh.write("@@@ not json")
        code, out = self.run_cli("--store", self.store, "list")
        self.assertEqual(code, 1)
        self.assertIn("error", out)
        self.assertEqual(out["type"], "SerializationError")


if __name__ == "__main__":
    unittest.main()
