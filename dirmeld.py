"""dirmeld: directory snapshot, diff and three-way merge kernel.

Public API:
    snapshot(root)          -> dict[relpath, entry]
    diff(a, b)              -> list of change records, sorted by path
    merge(base, ours, theirs) -> {"merged": dict, "conflicts": list}
    dumps(snap)             -> stable JSON serialization of a snapshot

An entry is {"kind": "file"|"dir"|"symlink", "hash": str, "size": int, "mode": int}.
Files are hashed with sha256 of their content; symlinks with sha256 of the
target path; directories carry an empty hash.

Merge conflict policy:
  * both sides changed the same path differently  -> conflict
  * one side deleted, the other modified          -> conflict (delete wins
    nothing silently; the surviving content stays in `merged`)
  * file-vs-dir type conflict                     -> conflict, `merged` keeps
    the ours-side shape so a human can resolve it
Every conflict record has path/base/ours/theirs, so no side's content is
ever dropped silently.
"""

import hashlib
import json
import os
import stat

__all__ = ["snapshot", "diff", "merge", "dumps"]

_KINDS = ("file", "dir", "symlink")
_ENTRY_KEYS = ("kind", "hash", "size", "mode")
_IGNORED = {".git", "__pycache__"}
_CHUNK = 65536


# ---------------------------------------------------------------------------
# validation helpers
# ---------------------------------------------------------------------------

def _validate_relpath(path):
    if not isinstance(path, str) or path in ("", "."):
        raise ValueError("invalid snapshot path: %r" % (path,))
    if os.path.isabs(path) or (len(path) > 1 and path[1] == ":"):
        raise ValueError("absolute path not allowed in snapshot: %r" % (path,))
    parts = path.replace("\\", "/").split("/")
    for part in parts:
        if part in ("", ".", ".."):
            raise ValueError("path traversal in snapshot path: %r" % (path,))


def _validate_entry(path, entry):
    if not isinstance(entry, dict):
        raise ValueError("snapshot entry for %r is not a dict" % (path,))
    missing = [k for k in _ENTRY_KEYS if k not in entry]
    if missing:
        raise ValueError(
            "snapshot entry for %r missing fields: %s" % (path, ", ".join(missing))
        )
    if entry["kind"] not in _KINDS:
        raise ValueError(
            "snapshot entry for %r has unknown kind %r" % (path, entry["kind"])
        )
    if not isinstance(entry["hash"], str):
        raise ValueError("snapshot entry for %r: hash must be str" % (path,))
    if not isinstance(entry["size"], int) or isinstance(entry["size"], bool):
        raise ValueError("snapshot entry for %r: size must be int" % (path,))
    if not isinstance(entry["mode"], int) or isinstance(entry["mode"], bool):
        raise ValueError("snapshot entry for %r: mode must be int" % (path,))


def _validated(snap, label):
    """Return a normalized copy of a snapshot, raising ValueError on bad input."""
    if not isinstance(snap, dict):
        raise ValueError("%s snapshot is not a dict" % label)
    out = {}
    for path, entry in snap.items():
        _validate_relpath(path)
        _validate_entry(path, entry)
        # normalize to exactly the four known keys, in fixed order
        out[path] = {k: entry[k] for k in _ENTRY_KEYS}
    return out


# ---------------------------------------------------------------------------
# snapshot
# ---------------------------------------------------------------------------

def _sha256_file(full):
    h = hashlib.sha256()
    with open(full, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def _stat_entry(full):
    st = os.lstat(full)
    mode = stat.S_IMODE(st.st_mode)
    if stat.S_ISLNK(st.st_mode):
        target = os.readlink(full)
        digest = hashlib.sha256(target.encode("utf-8")).hexdigest()
        return {"kind": "symlink", "hash": digest,
                "size": len(target.encode("utf-8")), "mode": mode}
    if stat.S_ISDIR(st.st_mode):
        return {"kind": "dir", "hash": "", "size": 0, "mode": mode}
    return {"kind": "file", "hash": _sha256_file(full),
            "size": st.st_size, "mode": mode}


def snapshot(root):
    """Recursively scan *root* and return {relative_path: entry}.

    Paths use forward slashes and are relative to *root*.  .git and
    __pycache__ directories are skipped.  The result is deterministic:
    scanning the same tree twice yields identical dicts.
    """
    root = os.fspath(root)
    if not os.path.isdir(root):
        raise ValueError("snapshot root is not a directory: %r" % root)
    result = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in _IGNORED)
        for name in sorted(dirnames) + sorted(
                f for f in filenames if f not in _IGNORED):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            result[rel] = _stat_entry(full)
    return result


def dumps(snap):
    """Serialize a snapshot to JSON with stable, sorted keys."""
    return json.dumps(_validated(snap, "input"), sort_keys=True,
                      ensure_ascii=False)


# ---------------------------------------------------------------------------
# diff
# ---------------------------------------------------------------------------

def diff(a, b):
    """Return the changes that turn snapshot *a* into snapshot *b*.

    Each record: {"path", "status", "old", "new"} with status one of
    "added" | "removed" | "modified" | "type_changed".  Sorted by path.
    """
    a = _validated(a, "old")
    b = _validated(b, "new")
    changes = []
    for path in sorted(set(a) | set(b)):
        old = a.get(path)
        new = b.get(path)
        if old is None:
            changes.append({"path": path, "status": "added",
                            "old": None, "new": new})
        elif new is None:
            changes.append({"path": path, "status": "removed",
                            "old": old, "new": None})
        elif old["kind"] != new["kind"]:
            changes.append({"path": path, "status": "type_changed",
                            "old": old, "new": new})
        elif old != new:
            changes.append({"path": path, "status": "modified",
                            "old": old, "new": new})
    return changes


# ---------------------------------------------------------------------------
# merge
# ---------------------------------------------------------------------------

def merge(base, ours, theirs):
    """Three-way merge of snapshots.

    Returns {"merged": snapshot, "conflicts": [conflict, ...]} where each
    conflict is {"path", "base", "ours", "theirs"} (any of the three may be
    None when that side lacks the path).

    Resolution rules per path:
      * only one side changed            -> take that side (deletion included)
      * both changed identically         -> take it
      * delete vs modify                 -> conflict; merged keeps the
                                            surviving (modified) entry
      * both present, different kinds    -> conflict; merged keeps ours' shape
      * both present, different content  -> conflict; merged keeps ours
    """
    base = _validated(base, "base")
    ours = _validated(ours, "ours")
    theirs = _validated(theirs, "theirs")

    merged = {}
    conflicts = []
    for path in sorted(set(base) | set(ours) | set(theirs)):
        b = base.get(path)
        o = ours.get(path)
        t = theirs.get(path)
        changed_o = o != b
        changed_t = t != b

        if not changed_o and not changed_t:
            if b is not None:
                merged[path] = b
        elif changed_o and not changed_t:
            if o is not None:
                merged[path] = o
        elif changed_t and not changed_o:
            if t is not None:
                merged[path] = t
        elif o == t:
            # both sides made the same change (including both deleting)
            if o is not None:
                merged[path] = o
        else:
            conflicts.append({"path": path, "base": b, "ours": o, "theirs": t})
            if o is None or t is None:
                # delete vs modify: keep the surviving content in merged so
                # nothing is lost while the conflict awaits resolution
                survivor = o if o is not None else t
                merged[path] = survivor
            elif o["kind"] != t["kind"]:
                # type conflict (e.g. file turned into a dir): keep ours' shape
                merged[path] = o
            else:
                merged[path] = o
    return {"merged": merged, "conflicts": conflicts}
