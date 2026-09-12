"""Self-test for dirmeld: builds base/ours/theirs trees and checks the merge.

Scenarios covered:
  1. added      - file created on one side only
  2. removed    - file deleted on one side, untouched on the other
  3. modified   - file edited on one side only (auto-merge)
  4. type conflict   - ours turns a file into a directory, theirs edits the file
  5. delete vs modify - ours deletes, theirs modifies
Plus: snapshot determinism, diff output, ours/theirs swap symmetry,
and ValueError on malformed snapshots.
"""

import json
import os
import shutil
import sys
import tempfile

import dirmeld


def write(root, rel, content):
    full = os.path.join(root, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)


def build_trees(tmp):
    base = os.path.join(tmp, "base")
    ours = os.path.join(tmp, "ours")
    theirs = os.path.join(tmp, "theirs")

    # --- base ---
    write(base, "keep.txt", "untouched\n")
    write(base, "modified.txt", "v1\n")
    write(base, "removed.txt", "gone on ours\n")
    write(base, "both_modified.txt", "base content\n")
    write(base, "type_clash.txt", "a file in base\n")
    write(base, "del_vs_mod.txt", "base version\n")
    write(base, "sub/nested.txt", "nested\n")

    shutil.copytree(base, ours)
    shutil.copytree(base, theirs)

    # --- ours ---
    write(ours, "added_by_ours.txt", "new from ours\n")
    write(ours, "modified.txt", "v2 by ours\n")
    os.remove(os.path.join(ours, "removed.txt"))
    write(ours, "both_modified.txt", "ours version\n")
    os.remove(os.path.join(ours, "type_clash.txt"))
    os.makedirs(os.path.join(ours, "type_clash.txt"))  # file -> dir
    os.remove(os.path.join(ours, "del_vs_mod.txt"))    # delete on ours

    # --- theirs ---
    write(theirs, "added_by_theirs.txt", "new from theirs\n")
    write(theirs, "both_modified.txt", "theirs version\n")
    write(theirs, "type_clash.txt", "edited by theirs\n")  # still a file
    write(theirs, "del_vs_mod.txt", "modified by theirs\n")

    return (dirmeld.snapshot(base), dirmeld.snapshot(ours),
            dirmeld.snapshot(theirs))


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("  ok:", msg)


def main():
    tmp = tempfile.mkdtemp(prefix="dirmeld_test_")
    try:
        base, ours, theirs = build_trees(tmp)

        print("[1] snapshot determinism")
        again = dirmeld.snapshot(os.path.join(tmp, "base"))
        check(again == base, "re-snapshot of same tree is identical")
        check(dirmeld.dumps(base) == dirmeld.dumps(again),
              "JSON serialization is stable")
        check(json.loads(dirmeld.dumps(base)) == base, "JSON round-trips")

        print("[2] diff")
        d = dirmeld.diff(base, ours)
        by_path = {c["path"]: c["status"] for c in d}
        check([c["path"] for c in d] == sorted(by_path), "diff sorted by path")
        check(by_path["added_by_ours.txt"] == "added", "added detected")
        check(by_path["removed.txt"] == "removed", "removed detected")
        check(by_path["modified.txt"] == "modified", "modified detected")
        check(by_path["type_clash.txt"] == "type_changed",
              "file->dir is type_changed")
        check("keep.txt" not in by_path, "untouched file not in diff")

        print("[3] merge: auto-merged changes")
        result = dirmeld.merge(base, ours, theirs)
        merged, conflicts = result["merged"], result["conflicts"]
        check(merged["added_by_ours.txt"]["kind"] == "file", "ours add merged")
        check(merged["added_by_theirs.txt"]["kind"] == "file", "theirs add merged")
        check("removed.txt" not in merged, "delete vs untouched -> deleted")
        check(merged["modified.txt"]["hash"] == ours["modified.txt"]["hash"],
              "one-sided modify merged")
        check(merged["keep.txt"] == base["keep.txt"], "untouched preserved")

        print("[4] merge: conflicts")
        cpaths = {c["path"] for c in conflicts}
        check(cpaths == {"both_modified.txt", "type_clash.txt",
                         "del_vs_mod.txt"},
              "exactly 3 conflicts: %s" % sorted(cpaths))
        for c in conflicts:
            check(set(c) == {"path", "base", "ours", "theirs"},
                  "conflict %s has path/base/ours/theirs" % c["path"])
        # both modified differently -> conflict, merged keeps ours
        check(merged["both_modified.txt"]["hash"] ==
              ours["both_modified.txt"]["hash"],
              "both-modified conflict keeps ours in merged")
        # type conflict -> conflict, merged keeps ours' shape (a dir)
        check(merged["type_clash.txt"]["kind"] == "dir",
              "type conflict keeps ours' dir shape in merged")
        # delete vs modify -> conflict, surviving content kept in merged
        check(merged["del_vs_mod.txt"]["hash"] ==
              theirs["del_vs_mod.txt"]["hash"],
              "delete-vs-modify keeps surviving content in merged")
        del_rec = next(c for c in conflicts if c["path"] == "del_vs_mod.txt")
        check(del_rec["ours"] is None and del_rec["theirs"] is not None,
              "delete-vs-modify conflict records ours=None")

        print("[5] swap symmetry")
        swapped = dirmeld.merge(base, theirs, ours)
        check({c["path"] for c in swapped["conflicts"]} == cpaths,
              "same conflict paths when ours/theirs swapped")
        for c in swapped["conflicts"]:
            orig = next(x for x in conflicts if x["path"] == c["path"])
            check(c["ours"] == orig["theirs"] and c["theirs"] == orig["ours"],
                  "swap only exchanges ours/theirs labels (%s)" % c["path"])
        # merged identical outside conflict paths
        strip = lambda m: {p: e for p, e in m.items() if p not in cpaths}
        check(strip(swapped["merged"]) == strip(merged),
              "non-conflicted merge result is order-insensitive")

        print("[6] error handling")
        bad_missing = {"x.txt": {"kind": "file", "hash": "abc"}}
        try:
            dirmeld.diff(bad_missing, {})
            check(False, "missing fields should raise")
        except ValueError as e:
            check("x.txt" in str(e), "ValueError names the path: %s" % e)
        try:
            dirmeld.merge({"../evil.txt": {"kind": "file", "hash": "",
                                           "size": 0, "mode": 0}}, {}, {})
            check(False, "path traversal should raise")
        except ValueError as e:
            check(".." in str(e) or "traversal" in str(e),
                  "ValueError on '..': %s" % e)
        try:
            dirmeld.snapshot(os.path.join(tmp, "does_not_exist"))
            check(False, "missing root should raise")
        except ValueError as e:
            check("does_not_exist" in str(e), "ValueError on bad root")

        print("[7] ignore rules & symlink (best effort)")
        write(os.path.join(tmp, "base"), ".git/config", "ignored\n")
        pyc = os.path.join(tmp, "base", "__pycache__")
        os.makedirs(pyc, exist_ok=True)
        write(os.path.join(tmp, "base"), "__pycache__/x.pyc", "ignored\n")
        snap = dirmeld.snapshot(os.path.join(tmp, "base"))
        check(not any(".git" in p or "__pycache__" in p for p in snap),
              ".git and __pycache__ ignored")
        link = os.path.join(tmp, "base", "link.txt")
        try:
            os.symlink("keep.txt", link)
            snap = dirmeld.snapshot(os.path.join(tmp, "base"))
            check(snap["link.txt"]["kind"] == "symlink", "symlink detected")
            import hashlib
            expect = hashlib.sha256(b"keep.txt").hexdigest()
            check(snap["link.txt"]["hash"] == expect,
                  "symlink hash is sha256 of target path")
        except OSError as e:
            print("  skip: symlink not permitted here (%s)" % e)

        print("\nALL TESTS PASSED")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
