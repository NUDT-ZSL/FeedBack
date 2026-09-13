"""Persistent, crash-recoverable B+tree index for string keys.

See the package README for the on-disk format overview.  The interesting
invariants maintained here are:

* leaves are threaded into a singly linked list (``next_leaf``) which
  :meth:`BTreeIndex.scan` walks directly;
* splits copy the separator key *up* (B+tree) while merges pull the parent
  separator *down*;
* every mutation is preceded by a fsync'd WAL record, and every page write
* is checksummed and atomically replaced, so reopening either replays the
* committed operations or refuses to return corrupted data.
"""
from __future__ import annotations

import bisect
import json
import os
import re
import struct
from typing import Dict, List, Optional, Tuple

from .exceptions import (
    ChecksumMismatchError,
    InvalidKeyError,
    InvalidPageSizeError,
    InvalidValueError,
    RecoveryError,
)
from .page import (
    HEADER_SIZE,
    PAYLOAD_FIXED_OVERHEAD,
    Page,
    compute_checksum,
    inner_content_size,
    leaf_content_size,
)
from .wal import OP_DELETE, OP_PUT, WAL

DEFAULT_PAGE_SIZE = 4096
MIN_PAGE_SIZE = 128
MAX_KEY_BYTES = 256
MAX_VALUE_BYTES = 1024 * 1024

MANIFEST_NAME = "manifest.json"
WAL_NAME = "wal.log"
JOURNAL_NAME = "journal.dat"
JOURNAL_MAGIC = b"BTJR"

_PAGE_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_OWNED_PAGE_RE = re.compile(r"^p-[0-9a-fA-F]{8}$")


def _validate_page_id(page_id: str) -> str:
    """Reject page ids that are not safe to use as bare file names."""
    if not isinstance(page_id, str) or not page_id or not _PAGE_ID_RE.match(page_id):
        raise RecoveryError(f"invalid page_id {page_id!r}: must be non-empty and contain only "
                            r"letters, digits, '.', '_' or '-'")
    if page_id in (".", "..") or page_id.startswith(".tmp"):
        raise RecoveryError(f"invalid page_id {page_id!r}")
    return page_id


def _entry_bytes(key: str, value: str) -> int:
    """Byte cost of one leaf entry (4-byte length prefixes included)."""
    return 4 + len(key.encode("utf-8")) + 4 + len(value.encode("utf-8"))


def _validate_key(key: object) -> str:
    if not isinstance(key, str):
        raise InvalidKeyError("key must be a string")
    if not key:
        raise InvalidKeyError("key must be a non-empty string")
    if len(key.encode("utf-8")) > MAX_KEY_BYTES:
        raise InvalidKeyError(f"key exceeds {MAX_KEY_BYTES} bytes: {len(key.encode('utf-8'))} bytes")
    return key


def _validate_value(value: object) -> str:
    if not isinstance(value, str):
        raise InvalidValueError("value must be a string")
    encoded_len = len(value.encode("utf-8"))
    if encoded_len > MAX_VALUE_BYTES:
        raise InvalidValueError(f"value exceeds {MAX_VALUE_BYTES} bytes: {encoded_len} bytes")
    return value


class BTreeIndex:
    """A persistent B+tree index living inside one directory.

    Args:
        directory: Directory used for the manifest, WAL and page files.
            Created if it does not exist.  Opening an existing directory
            loads and validates every page and replays the WAL.
        page_size: Fixed page size in bytes.  Honoured only when creating a
            brand-new index; an existing index keeps the value stored in its
            manifest.

    Raises:
        InvalidPageSizeError: *page_size* is below ``MIN_PAGE_SIZE``.
        ChecksumMismatchError: a page or manifest on disk is corrupted.
        RecoveryError: the page graph fails structural validation.
    """

    def __init__(self, directory: str, page_size: int = DEFAULT_PAGE_SIZE):
        if not isinstance(page_size, int) or isinstance(page_size, bool) or page_size < MIN_PAGE_SIZE:
            raise InvalidPageSizeError(
                f"page_size must be an integer >= {MIN_PAGE_SIZE}, got {page_size!r}"
            )
        self.directory = os.path.abspath(directory)
        os.makedirs(self.directory, exist_ok=True)
        self.manifest_path = os.path.join(self.directory, MANIFEST_NAME)
        self.wal_path = os.path.join(self.directory, WAL_NAME)

        self.pages: Dict[str, Page] = {}
        self.root_id: str = ""
        self.page_size = page_size
        self._next_id = 1
        self.free_pages: List[str] = []
        self._dirty: set[str] = set()
        self._removed_pages: set[str] = set()
        self._last_replay_count = 0
        self._cleanup_temp_files()

        state = self._classify_persisted_state()
        if state == "pages":
            # Finish or undo a checkpoint that a crash interrupted before we
            # trust any page file on disk.
            self._rollback_pending_checkpoint()
            state = self._classify_persisted_state()
        if state == "pages":
            # Validate page files before taking ownership of the WAL so a
            # corruption error does not leak an open log handle.
            self._load_persisted()
            self.wal = WAL(self.wal_path)
            try:
                self._recover_from_wal()
            except BaseException:
                self.wal.close()
                raise
        else:
            # Empty directory: start from an empty root.  "wal-only" means a
            # crash happened on a brand-new tree before its first checkpoint
            # (no page files exist); the base state is the empty tree and the
            # WAL records are replayed on top of it.
            self.wal = WAL(self.wal_path)
            root = self._new_page(is_leaf=True)
            root.is_root = True
            self.root_id = root.page_id
            self._dirty.discard(root.page_id)
            if state == "wal-only":
                try:
                    self._recover_from_wal()
                except BaseException:
                    self.wal.close()
                    raise

    # ============================================================ lifecycle
    def _classify_persisted_state(self) -> str:
        """Classify the directory as ``pages`` / ``wal-only`` / ``empty``."""
        has_pages = False
        for name in os.listdir(self.directory):
            full = os.path.join(self.directory, name)
            if not os.path.isfile(full):
                continue
            if name == MANIFEST_NAME or name == JOURNAL_NAME:
                has_pages = True
            elif name != WAL_NAME and not name.endswith(".tmp") and ".tmp." not in name:
                has_pages = True
        if has_pages:
            return "pages"
        if os.path.exists(self.wal_path) and os.path.getsize(self.wal_path) > 0:
            return "wal-only"
        return "empty"

    def _new_page(self, is_leaf: bool) -> Page:
        if self.free_pages:
            page_id = self.free_pages.pop()
            # A reused id may still be queued for file removal; it is live
            # again and will be rewritten.
            self._removed_pages.discard(page_id)
        else:
            page_id = f"p-{self._next_id:08x}"
            self._next_id += 1
        page = Page(page_id=page_id, is_leaf=is_leaf)
        self.pages[page_id] = page
        self._dirty.add(page_id)
        return page

    def _mark_dirty(self, page: Page) -> None:
        self._dirty.add(page.page_id)

    # ------------------------------------------------------------- manifest
    def _manifest_doc(self) -> dict:
        return {
            "root_id": self.root_id,
            "page_size": self.page_size,
            "next_page_id": self._next_id,
            "free_pages": sorted(self.free_pages),
            "pages": sorted(self.pages.keys()),
        }

    def _write_manifest_atomic(self) -> None:
        doc = self._manifest_doc()
        # Checksum over canonical JSON of every field except the checksum.
        body = json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        wrapped = dict(doc)
        wrapped["checksum"] = compute_checksum(body).hex()
        data = (json.dumps(wrapped, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        self._atomic_write(self.manifest_path, data)

    def _read_manifest(self) -> dict:
        with open(self.manifest_path, "rb") as fh:
            raw = fh.read()
        try:
            doc = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ChecksumMismatchError(
                "manifest", self.manifest_path, f"manifest is unreadable: {exc}"
            ) from exc
        stored = doc.pop("checksum", None)
        body = json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if stored != compute_checksum(body).hex():
            raise ChecksumMismatchError(
                "manifest",
                self.manifest_path,
                "manifest checksum mismatch: the manifest file is corrupted",
            )
        return doc

    # --------------------------------------------------------- page file IO
    def _page_path(self, page_id: str) -> str:
        return os.path.join(self.directory, page_id)

    def _atomic_write(self, path: str, data: bytes) -> None:
        """Write *data* to *path* atomically (temp file + fsync + rename)."""
        tmp_path = f"{path}.tmp.{os.getpid()}"
        with open(tmp_path, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, path)
        self._fsync_directory()

    def _fsync_directory(self) -> None:
        try:
            dir_fd = os.open(self.directory, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(dir_fd)
        except OSError:
            pass
        finally:
            os.close(dir_fd)

    def _write_page(self, page: Page) -> None:
        page.is_root = page.page_id == self.root_id
        self._atomic_write(self._page_path(page.page_id), page.to_bytes())

    def _read_page_file(self, page_id: str) -> Page:
        path = self._page_path(page_id)
        with open(path, "rb") as fh:
            data = fh.read()
        # ChecksumMismatchError from from_bytes already carries the page id.
        return Page.from_bytes(data, path=path)

    # ------------------------------------------------------------- loading
    def _load_persisted(self) -> None:
        """Load pages (from manifest or by scanning) and validate the tree."""
        self._cleanup_temp_files()
        if os.path.exists(self.manifest_path):
            manifest = self._read_manifest()
            self.page_size = int(manifest["page_size"])
            if self.page_size < MIN_PAGE_SIZE:
                raise InvalidPageSizeError(f"stored page_size {self.page_size} is below minimum")
            self.root_id = _validate_page_id(manifest["root_id"])
            self._next_id = int(manifest.get("next_page_id", 1))
            self.free_pages = [_validate_page_id(p) for p in manifest.get("free_pages", [])]
            listed = {_validate_page_id(p) for p in manifest.get("pages", [])}
            for page_id in sorted(listed):
                if not os.path.exists(self._page_path(page_id)):
                    raise RecoveryError(
                        f"manifest lists page_id={page_id!r} but its page file is missing"
                    )
                self.pages[page_id] = self._read_page_file(page_id)
            stray = [
                name
                for name in os.listdir(self.directory)
                if name not in listed
                and name not in (MANIFEST_NAME, WAL_NAME)
                and not name.endswith(".tmp")
                and ".tmp." not in name
                and os.path.isfile(os.path.join(self.directory, name))
            ]
            foreign = [n for n in stray if not _OWNED_PAGE_RE.match(n)]
            if foreign:
                raise RecoveryError(
                    f"found {len(foreign)} file(s) not recorded in the manifest and not "
                    f"recognised as page files (first unexpected file: {sorted(foreign)[0]!r})"
                )
            # Leftover page-shaped files from an interrupted checkpoint are
            # safe garbage; they get removed atomically with the next flush.
            for name in stray:
                os.remove(os.path.join(self.directory, name))
        else:
            # Manifest lost: rebuild purely by scanning page files.
            self._rebuild_by_scanning()
        self._validate_tree()

    def _cleanup_temp_files(self) -> None:
        """Remove leftovers of atomic writes killed mid-rename."""
        for name in os.listdir(self.directory):
            if name.endswith(".tmp") or ".tmp." in name:
                try:
                    os.remove(os.path.join(self.directory, name))
                except OSError:
                    pass

    def _rebuild_by_scanning(self) -> None:
        candidates = [
            name
            for name in os.listdir(self.directory)
            if name not in (MANIFEST_NAME, WAL_NAME)
            and os.path.isfile(os.path.join(self.directory, name))
        ]
        if not candidates:
            raise RecoveryError("no manifest and no page files found in data directory")
        max_num = 0
        for name in candidates:
            _validate_page_id(name)
            page = self._read_page_file(name)
            if page.page_id != name:
                raise RecoveryError(
                    f"page file {name!r} contains page with page_id={page.page_id!r}"
                )
            self.pages[page.page_id] = page
            if page.page_id.startswith("p-"):
                try:
                    max_num = max(max_num, int(page.page_id[2:], 16))
                except ValueError:
                    pass
        self._next_id = max_num + 1
        roots = [p for p in self.pages.values() if p.parent is None]
        if len(roots) != 1:
            raise RecoveryError(
                f"cannot rebuild without manifest: expected exactly one root, found {len(roots)}"
            )
        self.root_id = roots[0].page_id
        self.free_pages = []

    def _validate_tree(self) -> None:
        """Cross-check parent pointers, child links and the leaf chain."""
        if self.root_id not in self.pages:
            raise RecoveryError(f"root page_id={self.root_id!r} does not exist")
        root = self.pages[self.root_id]
        if root.parent is not None:
            raise RecoveryError(f"root page {self.root_id!r} unexpectedly has parent {root.parent!r}")

        for page in self.pages.values():
            if page.parent is not None:
                if page.parent not in self.pages:
                    raise RecoveryError(
                        f"page {page.page_id!r} points to missing parent {page.parent!r}"
                    )
                parent = self.pages[page.parent]
                if parent.is_leaf or page.page_id not in parent.children:
                    raise RecoveryError(
                        f"parent pointer of page {page.page_id!r} is inconsistent with parent "
                        f"{page.parent!r}"
                    )
            if not page.is_leaf:
                if len(page.children) < 2 and page.page_id != self.root_id:
                    raise RecoveryError(
                        f"inner page {page.page_id!r} has fewer than 2 children"
                    )
                if len(page.keys) != len(page.children) - 1:
                    raise RecoveryError(
                        f"inner page {page.page_id!r} has {len(page.keys)} keys but "
                        f"{len(page.children)} children"
                    )
                if page.keys != sorted(page.keys) or len(set(page.keys)) != len(page.keys):
                    raise RecoveryError(f"separator keys in page {page.page_id!r} are not sorted/unique")
                for child_id in page.children:
                    if child_id not in self.pages:
                        raise RecoveryError(
                            f"inner page {page.page_id!r} references missing child {child_id!r}"
                        )
                    child = self.pages[child_id]
                    if child.parent != page.page_id:
                        raise RecoveryError(
                            f"child {child_id!r} does not name parent {page.page_id!r} "
                            f"(found {child.parent!r})"
                        )
            else:
                keys = [k for k, _ in page.items]
                if keys != sorted(keys) or len(set(keys)) != len(keys):
                    raise RecoveryError(f"leaf page {page.page_id!r} items are not sorted/unique")

        # Separator/range consistency and leaf-chain completeness.
        self._validate_ranges(root, None, None)
        self._validate_leaf_chain()

    def _validate_ranges(self, page: Page, low: Optional[str], high: Optional[str]) -> None:
        if page.is_leaf:
            if page.items:
                first, last = page.items[0][0], page.items[-1][0]
                if low is not None and first < low:
                    raise RecoveryError(f"leaf {page.page_id!r} contains key below separator {low!r}")
                if high is not None and last >= high:
                    raise RecoveryError(f"leaf {page.page_id!r} contains key at/above separator {high!r}")
            return
        for i, child_id in enumerate(page.children):
            child_low = low if i == 0 else page.keys[i - 1]
            child_high = high if i == len(page.children) - 1 else page.keys[i]
            self._validate_ranges(self.pages[child_id], child_low, child_high)
        for i, sep in enumerate(page.keys):
            right_min = self._subtree_extreme(page.children[i + 1], smallest=True)
            left_max = self._subtree_extreme(page.children[i], smallest=False)
            if right_min is not None and sep != right_min:
                raise RecoveryError(
                    f"inner page {page.page_id!r}: separator {sep!r} does not match first key "
                    f"{right_min!r} of right subtree"
                )
            if left_max is not None and not left_max < sep:
                raise RecoveryError(
                    f"inner page {page.page_id!r}: key {left_max!r} left of separator {sep!r} "
                    "is not smaller"
                )

    def _subtree_extreme(self, page_id: str, smallest: bool) -> Optional[str]:
        page = self.pages[page_id]
        while not page.is_leaf:
            page = self.pages[page.children[0 if smallest else -1]]
        if not page.items:
            return None
        return page.items[0][0] if smallest else page.items[-1][0]

    def _validate_leaf_chain(self) -> None:
        page = self.pages[self.root_id]
        while not page.is_leaf:
            page = self.pages[page.children[0]]
        seen: set[str] = set()
        all_leaves = {p.page_id for p in self.pages.values() if p.is_leaf}
        order = []
        while page is not None:
            if page.page_id in seen:
                raise RecoveryError(f"leaf chain contains a cycle at page_id={page.page_id!r}")
            seen.add(page.page_id)
            order.append(page.page_id)
            nxt = page.next_leaf
            if nxt is None:
                break
            if nxt not in self.pages:
                raise RecoveryError(
                    f"leaf {page.page_id!r} points to missing next_leaf {nxt!r}"
                )
            if not self.pages[nxt].is_leaf:
                raise RecoveryError(f"next_leaf {nxt!r} of leaf {page.page_id!r} is not a leaf")
            page = self.pages[nxt]
        if seen != all_leaves:
            missing = sorted(all_leaves - seen)
            extra = sorted(seen - all_leaves)
            raise RecoveryError(
                f"leaf chain is incomplete (unreached leaves={missing}, bogus={extra})"
            )
        chain_keys = [k for pid in order for k, _ in self.pages[pid].items]
        if chain_keys != sorted(chain_keys):
            raise RecoveryError("leaf chain does not visit keys in sorted order")

    # ----------------------------------------------------------- WAL replay
    def _recover_from_wal(self) -> int:
        records = WAL.read_records(self.wal_path)
        for record in records:
            try:
                if record.op == OP_PUT:
                    self._apply_put(record.key, record.value)
                else:
                    self._apply_delete(record.key)
            except (InvalidKeyError, InvalidValueError) as exc:
                raise RecoveryError(f"cannot replay WAL record {record.to_dict()!r}: {exc}") from exc
        # The replayed pages stay dirty but are NOT flushed here: the old
        # page files plus this same WAL replayed again on the next open
        # produce an identical state, so a full checkpoint can wait until
        # the caller asks for one.  This keeps reopen cheap.
        self._last_replay_count = len(records)
        return len(records)

    # ============================================================== lookups
    @property
    def root(self) -> Page:
        return self.pages[self.root_id]

    def _find_leaf(self, key: str) -> Page:
        """Descend from the root to the leaf that could contain *key*."""
        page = self.root
        while not page.is_leaf:
            idx = bisect.bisect_right(page.keys, key)
            page = self.pages[page.children[idx]]
        return page

    def get(self, key: str) -> Optional[str]:
        """Return the value for *key*, or ``None`` if it is not present."""
        key = _validate_key(key)
        leaf = self._find_leaf(key)
        keys = [k for k, _ in leaf.items]
        idx = bisect.bisect_left(keys, key)
        if idx < len(keys) and keys[idx] == key:
            return leaf.items[idx][1]
        return None

    def scan(self, start: Optional[str] = None, end: Optional[str] = None) -> List[Tuple[str, str]]:
        """Return ``(key, value)`` pairs in ``[start, end)`` key order.

        ``start=None`` starts at the smallest key, ``end=None`` means no upper
        bound.  The leaves are followed through their linked list, so a scan
        costs one root-to-leaf descent plus linear leaf traversal.
        """
        if start is not None:
            start = _validate_key(start)
        if end is not None:
            end = _validate_key(end)
        if start is not None and end is not None and start > end:
            return []

        page = self.root
        if start is None:
            while not page.is_leaf:
                page = self.pages[page.children[0]]
        else:
            page = self._find_leaf(start)

        results: List[Tuple[str, str]] = []
        while page is not None:
            for key, value in page.items:
                if start is not None and key < start:
                    continue
                if end is not None and key >= end:
                    return results
                results.append((key, value))
            nxt = page.next_leaf
            page = self.pages[nxt] if nxt is not None else None
        return results

    # ============================================================== mutations
    def put(self, key: str, value: str) -> None:
        """Insert *key* with *value*, overwriting any previous value."""
        key = _validate_key(key)
        value = _validate_value(value)
        # WAL first, and only then touch in-memory pages.
        self.wal.append(OP_PUT, key, value)
        self._apply_put(key, value)

    def delete(self, key: str) -> bool:
        """Delete *key*; return whether it was present.

        Deleting a missing key is a no-op (nothing is logged, ``False`` is
        returned).
        """
        key = _validate_key(key)
        leaf = self._find_leaf(key)
        keys = [k for k, _ in leaf.items]
        idx = bisect.bisect_left(keys, key)
        if idx >= len(keys) or keys[idx] != key:
            return False
        self.wal.append(OP_DELETE, key)
        self._apply_delete(key)
        return True

    def _apply_put(self, key: str, value: Optional[str]) -> None:
        value = value if value is not None else ""
        leaf = self._find_leaf(key)
        keys = [k for k, _ in leaf.items]
        idx = bisect.bisect_left(keys, key)
        if idx < len(keys) and keys[idx] == key:
            leaf.items[idx] = (key, value)
        else:
            leaf.items.insert(idx, (key, value))
        self._mark_dirty(leaf)
        if self._needs_split(leaf):
            # Walk bottom-up; after each split the parent may itself be
            # over-full, so the loop continues up to (and including) the root.
            self._split_bottom_up(leaf)

    def _apply_delete(self, key: str) -> None:
        leaf = self._find_leaf(key)
        keys = [k for k, _ in leaf.items]
        idx = bisect.bisect_left(keys, key)
        if idx < len(keys) and keys[idx] == key:
            leaf.items.pop(idx)
            self._mark_dirty(leaf)
            anchor_id = self._rebalance_after_delete(leaf)
            # Deleting a key that was a copied-up separator leaves stale
            # copies at every ancestor level; refresh them along the path.
            self._refresh_ancestor_separators(anchor_id)

    def _refresh_ancestor_separators(self, anchor_id: str) -> None:
        """Set every separator left of *anchor_id*'s subtree to its true min.

        Walks the parent chain from a leaf to the root.  In a B+tree the
        separator immediately to the left of a child always equals the
        smallest key of that child's subtree; recomputing it repairs stale
        copies left by deletions and rotations.
        """
        cur_id = anchor_id
        while True:
            cur = self.pages.get(cur_id)
            if cur is None or cur.parent is None:
                break
            parent = self.pages[cur.parent]
            pos = parent.children.index(cur_id)
            if pos > 0:
                min_key = self._subtree_extreme(cur_id, smallest=True)
                if min_key is not None and parent.keys[pos - 1] != min_key:
                    parent.keys[pos - 1] = min_key
                    self._mark_dirty(parent)
            cur_id = parent.page_id

    # ---------------------------------------------------------------- splits
    def _needs_split(self, page: Page) -> bool:
        if page.content_size() <= self.page_size:
            return False
        if page.is_leaf:
            # A leaf holding one oversized entry cannot be split further;
            # it stays over-full (see README "oversized values").
            return len(page.items) >= 2
        # Each part needs >=2 children, i.e. at least 4 children to form two.
        return len(page.children) >= 4

    def _split_bottom_up(self, leaf: Page) -> None:
        """Split *leaf* and every ancestor that becomes over-full.

        One over-full page may fan out into several siblings because a
        single value may itself be larger than the page size; the loop keeps
        cutting parts until every part fits or holds a single irreducible
        oversized entry.
        """
        cur = leaf
        while self._needs_split(cur):
            siblings = self._fan_split(cur)
            if len(siblings) == 1:
                break  # irreducible (oversized single entry)
            separators = [self._subtree_extreme(p.page_id, smallest=True) for p in siblings[1:]]
            if cur.page_id == self.root_id:
                new_root = self._new_page(is_leaf=False)
                new_root.children = [p.page_id for p in siblings]
                new_root.keys = [s for s in separators]
                for part in siblings:
                    part.parent = new_root.page_id
                    self._mark_dirty(part)
                new_root.is_root = True
                self.root_id = new_root.page_id
                self._mark_dirty(new_root)
                return
            parent = self.pages[cur.parent]
            child_index = parent.children.index(cur.page_id)
            parent.children[child_index:child_index + 1] = [p.page_id for p in siblings]
            parent.keys[child_index:child_index] = separators
            for part in siblings:
                part.parent = parent.page_id
                self._mark_dirty(part)
            self._mark_dirty(parent)
            cur = parent  # the parent may itself now be over-full

    def _fits_budget(self, content_bytes: int) -> bool:
        """Whether *content_bytes* of payload (id/parent overhead included)."""
        return HEADER_SIZE + content_bytes <= self.page_size

    def _balanced_partition(
        self,
        n: int,
        element_cost,
        fixed_overhead: int,
        min_group_size: int = 1,
    ) -> List[Tuple[int, int]]:
        """Partition ``range(n)`` into balanced, byte-budgeted groups.

        Args:
            n: number of ordered elements.
            element_cost(a, b): payload byte cost of elements ``[a, b)``
                (variable content only -- no per-group fixed overhead).
            fixed_overhead: constant overhead charged to every group.
            min_group_size: minimum number of elements per group (2 for
                inner pages, which need >=2 children; 1 for leaves).

        Returns:
            ``(start, end)`` ranges covering ``0..n``.  Boundaries are chosen
            to make every group's *element* byte cost as equal as possible,
            preferring partitions where every group fits the page budget.
            Groups are allowed to exceed the budget only when no fitting
            partition exists (irreducibly oversized elements).  At least two
            groups are returned whenever possible.
        """
        budget = self.page_size - HEADER_SIZE - fixed_overhead
        big = 10 ** 9

        def valid_size(size: int) -> bool:
            return size >= min_group_size

        def within_budget(a: int, b: int) -> bool:
            return b - a == 1 or element_cost(a, b) <= budget

        # dp[i] = (overflowing groups, group count) minimised over all
        # valid partitions of the suffix [i, n).
        dp: List[Tuple[int, int]] = [(big, big)] * (n + 1)
        dp[n] = (0, 0)
        for i in range(n - 1, -1, -1):
            for j in range(i + 1, n + 1):
                size = j - i
                remainder = n - j
                if not valid_size(size) or not (remainder == 0 or valid_size(remainder)):
                    continue
                overflow = 0 if within_budget(i, j) else 1
                cand = (dp[j][0] + overflow, dp[j][1] + 1)
                if cand < dp[i]:
                    dp[i] = cand
        parts_n = max(2, dp[0][1])

        # feasible[i][g]: minimum number of overflowing groups when the
        # suffix [i, n) is split into exactly g groups.
        feasible: List[Dict[int, int]] = [dict() for _ in range(n + 1)]
        feasible[n][0] = 0
        for i in range(n - 1, -1, -1):
            for j in range(i + 1, n + 1):
                size = j - i
                if not valid_size(size):
                    continue
                overflow = 0 if within_budget(i, j) else 1
                for g_left, tail_overflow in feasible[j].items():
                    value = overflow + tail_overflow
                    best = feasible[i].get(g_left + 1, big)
                    if value < best:
                        feasible[i][g_left + 1] = value
        total_element_cost = element_cost(0, n)

        bounds = [0]
        start = 0
        for part in range(1, parts_n):
            remaining_groups = parts_n - part
            ideal = total_element_cost * part / parts_n
            fitting: List[Tuple[float, int]] = []
            overflowing: List[Tuple[float, int]] = []
            for j in range(start + 1, n + 1):
                size = j - start
                remainder = n - j
                if not valid_size(size) or not (remainder == 0 or valid_size(remainder)):
                    continue
                if remaining_groups not in feasible[j]:
                    continue  # remainder cannot fill the remaining groups
                tail_overflow = feasible[j][remaining_groups]
                bucket = fitting if within_budget(start, j) and tail_overflow == 0 else overflowing
                bucket.append((abs(element_cost(0, j) - ideal), j))
            candidates = fitting if fitting else overflowing
            candidates.sort()
            if candidates:
                start = candidates[0][1]
            else:  # defensive: cut minimally and continue
                start = min(n, start + min_group_size)
            bounds.append(start)
        bounds.append(n)
        return [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)
                if bounds[i + 1] > bounds[i]]

    def _fan_split(self, page: Page) -> List[Page]:
        """Cut one over-full page into a chain of fitting pages.

        The original *page* becomes the first part (its id and parent are
        kept); further parts are freshly allocated.  Every returned part is
        within the page budget except parts that hold a single irreducibly
        oversized entry (leaves) -- such a part is returned on its own-ish
        and skipped by :meth:`_needs_split`.
        """
        if page.is_leaf:
            return self._fan_split_leaf(page)
        return self._fan_split_inner(page)

    def _fan_split_leaf(self, leaf: Page) -> List[Page]:
        items = leaf.items
        weights = [_entry_bytes(k, v) for k, v in items]
        prefix = [0]
        for w in weights:
            prefix.append(prefix[-1] + w)

        def element_cost(a: int, b: int) -> int:
            return prefix[b] - prefix[a]

        fixed = PAYLOAD_FIXED_OVERHEAD + 4 + self._node_overhead(leaf)
        ranges = self._balanced_partition(len(items), element_cost, fixed)
        if len(ranges) == 1:
            return [leaf]
        groups = [items[a:b] for a, b in ranges]
        old_next = leaf.next_leaf
        parts: List[Page] = []
        previous: Optional[Page] = None
        for i, group in enumerate(groups):
            if i == 0:
                part = leaf
                part.items = group
            else:
                part = self._new_page(is_leaf=True)
                part.parent = leaf.parent
                part.items = group
            if previous is not None:
                previous.next_leaf = part.page_id
            parts.append(part)
            previous = part
        parts[-1].next_leaf = old_next
        for part in parts:
            self._mark_dirty(part)
        return parts

    def _fan_split_inner(self, page: Page) -> List[Page]:
        keys, children = page.keys, page.children
        child_weights = [4 + len(c.encode("utf-8")) for c in children]
        sep_weights = [4 + len(k.encode("utf-8")) for k in keys]
        child_prefix = [0]
        for w in child_weights:
            child_prefix.append(child_prefix[-1] + w)
        sep_prefix = [0]
        for w in sep_weights:
            sep_prefix.append(sep_prefix[-1] + w)

        def element_cost(a: int, b: int) -> int:
            # children [a, b) plus their local separators keys[a .. b-2);
            # keys[b-1] at a group cut is promoted instead.
            kids = child_prefix[b] - child_prefix[a]
            seps = sep_prefix[b - 1] - sep_prefix[a]
            return kids + seps

        fixed = PAYLOAD_FIXED_OVERHEAD + self._node_overhead(page)
        ranges = self._balanced_partition(
            len(children), element_cost, fixed, min_group_size=2
        )
        if len(ranges) == 1:
            return [page]
        parts: List[Page] = []
        for i, (a, b) in enumerate(ranges):
            local_keys = keys[a:b - 1]  # keys[b-1] at a cut is promoted
            local_children = children[a:b]
            if i == 0:
                part = page
                page.keys = local_keys
                page.children = local_children
            else:
                part = self._new_page(is_leaf=False)
                part.parent = page.parent
                part.keys = local_keys
                part.children = local_children
            for child_id in part.children:
                child = self.pages[child_id]
                if child.parent != part.page_id:
                    child.parent = part.page_id
                    self._mark_dirty(child)
            parts.append(part)
            self._mark_dirty(part)
        return parts

    # --------------------------------------------------- merges / borrowing
    def _rebalance_after_delete(self, leaf: Page) -> str:
        """Restore the half-page occupancy invariant bottom-up.

        Returns the page id of the leaf that now owns the deleted key's
        neighbourhood (it changes when the original leaf is merged away).
        """
        cur = leaf
        anchor_id = leaf.page_id
        while cur.page_id != self.root_id and self._is_underfull(cur):
            parent = self.pages[cur.parent]
            idx = parent.children.index(cur.page_id)
            if idx > 0:
                left = self.pages[parent.children[idx - 1]]
                sep_idx = idx - 1
                if self._merge_would_fit(left, cur, parent.keys[sep_idx]):
                    # Prefer merging when the two halves fit in one page:
                    # this keeps post-delete occupancy high and never fails.
                    merged_at_leaf = cur.is_leaf
                    self._merge_siblings(left, cur, parent, sep_idx)
                    if merged_at_leaf:
                        anchor_id = left.page_id
                    cur = parent
                    continue
                if self._redistributable(left, cur):
                    self._redistribute_from_left(cur, left, parent, sep_idx)
                    break
                if not cur.is_leaf and len(cur.children) < 2:
                    # Structural minimum violated and no legal donation
                    # exists: merge anyway; the over-full result is split by
                    # the next insert, exactly like an oversized leaf entry.
                    self._merge_siblings(left, cur, parent, sep_idx)
                    cur = parent
                    continue
                # Nothing legal to do; cur merely stays below half (a leaf
                # may hold a single oversized entry, for example).
                break
            else:
                right = self.pages[parent.children[1]]
                sep_idx = 0
                if self._merge_would_fit(cur, right, parent.keys[sep_idx]):
                    self._merge_siblings(cur, right, parent, sep_idx)
                    cur = parent
                    continue
                if self._redistributable(right, cur):
                    self._redistribute_from_right(cur, right, parent, sep_idx)
                    break
                if not cur.is_leaf and len(cur.children) < 2:
                    self._merge_siblings(cur, right, parent, sep_idx)
                    cur = parent
                    continue
                break
        self._collapse_root_if_needed()
        if anchor_id not in self.pages:
            anchor_id = self._find_leaf(self._subtree_extreme(self.root_id, smallest=True) or "").page_id
        return anchor_id

    def _is_underfull(self, page: Page) -> bool:
        """Whether *page* holds less than half a page of payload bytes."""
        return page.content_size() < self.page_size // 2

    @staticmethod
    def _node_overhead(page: Page) -> int:
        """Byte overhead a page spends on its id and parent pointer."""
        total = 4 + len(page.page_id.encode("utf-8"))
        total += 4 if page.parent is None else 4 + len(page.parent.encode("utf-8"))
        return total

    def _merge_would_fit(self, left: Page, right: Page, separator: str) -> bool:
        """Whether merging the two siblings keeps the result <= page size.

        A leaf merge simply concatenates entries; an inner merge additionally
        pulls the separating parent key (*separator*) down.
        """
        if left.is_leaf:
            content = leaf_content_size(left.items + right.items)
        else:
            content = inner_content_size(
                left.keys + [separator] + right.keys,
                left.children + right.children,
            )
        content += self._node_overhead(left)
        return HEADER_SIZE + content <= self.page_size

    def _redistributable(self, donor: Page, node: Page) -> bool:
        """Whether at least one entry/child can legally move donor -> node."""
        half = self.page_size // 2
        if donor.content_size() <= half:
            return False
        if donor.is_leaf:
            # The donor must keep at least one entry (its first key anchors
            # the parent separator).
            return len(donor.items) >= 2
        # The donor must retain at least the two-child minimum.
        return len(donor.children) >= 3

    def _redistribute_from_left(
        self, node: Page, left: Page, parent: Page, sep_idx: int
    ) -> None:
        """Move trailing entries/children of *left* onto the front of *node*.

        Moves continue until both sides are at least half full or the donor
        reaches its structural minimum.  For inner pages the parent
        separator rotates down and the donor's last separator takes its
        place (a classic B+tree rotation).
        """
        half = self.page_size // 2
        if node.is_leaf:
            while left.content_size() > half and node.content_size() < half and len(left.items) >= 2:
                key, value = left.items.pop()
                node.items.insert(0, (key, value))
            parent.keys[sep_idx] = node.items[0][0]
        else:
            while (
                left.content_size() > half
                and node.content_size() < half
                and len(left.children) >= 3
            ):
                moved_child = left.children.pop()
                sep = left.keys.pop()
                node.keys.insert(0, parent.keys[sep_idx])
                node.children.insert(0, moved_child)
                parent.keys[sep_idx] = sep
                self.pages[moved_child].parent = node.page_id
                self._mark_dirty(self.pages[moved_child])
        for touched in (node, left, parent):
            self._mark_dirty(touched)

    def _redistribute_from_right(
        self, node: Page, right: Page, parent: Page, sep_idx: int
    ) -> None:
        """Move leading entries/children of *right* onto the end of *node*."""
        half = self.page_size // 2
        if node.is_leaf:
            while right.content_size() > half and node.content_size() < half and len(right.items) >= 2:
                key, value = right.items.pop(0)
                node.items.append((key, value))
            parent.keys[sep_idx] = right.items[0][0]
        else:
            while (
                right.content_size() > half
                and node.content_size() < half
                and len(right.children) >= 3
            ):
                moved_child = right.children.pop(0)
                sep = right.keys.pop(0)
                node.keys.append(parent.keys[sep_idx])
                node.children.append(moved_child)
                parent.keys[sep_idx] = sep
                self.pages[moved_child].parent = node.page_id
                self._mark_dirty(self.pages[moved_child])
        for touched in (node, right, parent):
            self._mark_dirty(touched)

    def _merge_siblings(self, left: Page, right: Page, parent: Page, sep_idx: int) -> None:
        if left.is_leaf:
            left.items.extend(right.items)
            left.next_leaf = right.next_leaf
        else:
            left.keys.append(parent.keys[sep_idx])
            left.keys.extend(right.keys)
            for child_id in right.children:
                child = self.pages[child_id]
                child.parent = left.page_id
                self._mark_dirty(child)
            left.children.extend(right.children)
        parent.keys.pop(sep_idx)
        parent.children.pop(sep_idx + 1)
        # The right page id can be reused later.
        self.free_pages.append(right.page_id)
        del self.pages[right.page_id]
        self._dirty.discard(right.page_id)
        self._removed_pages.add(right.page_id)  # file unlinked on next flush
        self._mark_dirty(left)
        self._mark_dirty(parent)

    def _collapse_root_if_needed(self) -> None:
        """While the root is a unary inner node, remove the empty level."""
        while not self.root.is_leaf and len(self.root.children) == 1:
            old_root = self.root
            child = self.pages[old_root.children[0]]
            child.parent = None
            child.is_root = True
            self.root_id = child.page_id
            self.free_pages.append(old_root.page_id)
            del self.pages[old_root.page_id]
            self._dirty.discard(old_root.page_id)
            self._removed_pages.add(old_root.page_id)
            self._mark_dirty(child)
        # The tree may have collapsed all the way to an empty leaf: its
        # root bit is maintained lazily at flush time, nothing to do here.

    # ============================================================ durability
    def save(self) -> None:
        """Flush all dirty pages and a fresh manifest to disk (WAL kept)."""
        self._flush()

    def checkpoint(self) -> None:
        """Flush dirty pages + manifest, then truncate the WAL."""
        self._flush()
        self.wal.truncate()

    def _rollback_journal_path(self) -> str:
        return os.path.join(self.directory, JOURNAL_NAME)

    def _write_rollback_journal(self, changed: set[str]) -> str:
        """Save old images of every file a checkpoint is about to overwrite.

        Layout (little-endian)::

            magic(4) | n(4) | [ name_len(4) name data_len(4) data ]*

        Page images are stored verbatim (with their own checksum); the
        manifest is stored as its raw bytes.  A ``data_len`` of 0 records
        that the file did not exist before and must be deleted on rollback.
        The journal is fsync'd before any live file is touched.
        """
        path = self._rollback_journal_path()
        records: List[Tuple[str, bytes]] = []
        for name in sorted(changed):
            full = os.path.join(self.directory, name)
            data = b""
            if os.path.exists(full):
                with open(full, "rb") as fh:
                    data = fh.read()
            records.append((name, data))
        with open(path, "wb") as fh:
            fh.write(JOURNAL_MAGIC)
            fh.write(struct.pack("<I", len(records)))
            for name, data in records:
                name_b = name.encode("utf-8")
                fh.write(struct.pack("<I", len(name_b)))
                fh.write(name_b)
                fh.write(struct.pack("<I", len(data)))
                fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        self._fsync_directory()
        return path

    def _parse_rollback_journal(self) -> Optional[List[Tuple[str, bytes]]]:
        """Parse a rollback journal; ``None`` if it is absent or torn.

        A torn journal (crash while it was being written) cannot be trusted:
        the caller then falls back to the last committed manifest, which by
        journal ordering can still only reference valid old pages.
        """
        path = self._rollback_journal_path()
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            return None
        try:
            with open(path, "rb") as fh:
                blob = fh.read()
            if blob[:4] != JOURNAL_MAGIC:
                return None
            (count,) = struct.unpack_from("<I", blob, 4)
            pos = 8
            records: List[Tuple[str, bytes]] = []
            for _ in range(count):
                (name_len,) = struct.unpack_from("<I", blob, pos)
                pos += 4
                name = blob[pos:pos + name_len].decode("utf-8")
                pos += name_len
                (data_len,) = struct.unpack_from("<I", blob, pos)
                pos += 4
                data = blob[pos:pos + data_len]
                if len(data) != data_len:
                    return None
                pos += data_len
                records.append((name, data))
            if pos != len(blob):
                return None
            return records
        except (struct.error, UnicodeDecodeError):
            return None

    def _rollback_pending_checkpoint(self) -> bool:
        """Undo an interrupted checkpoint using its rollback journal.

        Restores old page/manifest images (or removes freshly created
        files), then deletes the journal.  Returns whether a journal was
        processed.
        """
        records = self._parse_rollback_journal()
        if records is None:
            path = self._rollback_journal_path()
            if os.path.exists(path):
                # Unparseable journal: keep the last committed state.  Remove
                # files newer than the checkpoint cannot be distinguished,
                # but the manifest still references only old pages; leftover
                # new page files are treated as garbage on load.
                os.remove(path)
            return False
        for name, data in records:
            full = os.path.join(self.directory, name)
            if data:
                with open(full, "wb") as fh:
                    fh.write(data)
                    fh.flush()
                    os.fsync(fh.fileno())
            elif os.path.exists(full):
                os.remove(full)
        os.remove(self._rollback_journal_path())
        self._fsync_directory()
        return True

    def _discard_rollback_journal(self) -> None:
        path = self._rollback_journal_path()
        if os.path.exists(path):
            os.remove(path)
            self._fsync_directory()

    def _flush(self) -> None:
        """Atomically flush dirty pages, deletions and the manifest.

        Crash safety protocol (classic rollback journal):

        1. Write every *current* on-disk image of files we are about to
           change into ``journal.dat`` and fsync it.
        2. Write new page images, delete dead pages, write the new manifest
           (each step individually fsync'd).
        3. Delete the journal.  Its existence is therefore exactly the
           predicate "checkpoint in flight"; on open, a surviving journal
           rolls every file back to its pre-checkpoint state, and the WAL
           (still untruncated) re-applies committed operations.
        """
        dirty_page_ids = {
            p.page_id for p in self.pages.values()
            if p.page_id in self._dirty or not os.path.exists(self._page_path(p.page_id))
        }
        changed_names = set(dirty_page_ids) | set(self._removed_pages) | {MANIFEST_NAME}
        self._write_rollback_journal(changed_names)

        for page_id in sorted(dirty_page_ids):
            self._write_page(self.pages[page_id])
        for page_id in sorted(self._removed_pages):
            path = self._page_path(page_id)
            if os.path.exists(path):
                os.remove(path)
        self._write_manifest_atomic()
        self._discard_rollback_journal()
        self._dirty.clear()
        self._removed_pages.clear()
        self._fsync_directory()

    def close(self) -> None:
        """Flush the WAL and close file handles.

        Pages are not forced to disk here; any committed-but-uncheckpointed
        changes are replayed from the WAL on the next open.  Call
        :meth:`save` or :meth:`checkpoint` first for an immediate page flush.
        """
        self.wal.close()

    def __enter__(self) -> "BTreeIndex":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    # =============================================================== introspection
    def stats(self) -> dict:
        """Return structural statistics about the tree."""
        leaves = [p for p in self.pages.values() if p.is_leaf]
        inners = [p for p in self.pages.values() if not p.is_leaf]
        height = 0
        page = self.root
        if page.is_leaf:
            height = 0 if not page.items else 1
        else:
            height = 1
            while not page.is_leaf:
                page = self.pages[page.children[0]]
                height += 1
        return {
            "height": height,
            "page_count": len(self.pages),
            "leaf_pages": len(leaves),
            "inner_pages": len(inners),
            "used_bytes": sum(p.byte_size() for p in self.pages.values()),
            "free_pages": len(self.free_pages),
            "page_size": self.page_size,
            "root_id": self.root_id,
        }

    def dump(self) -> dict:
        """Return a debug snapshot with pages sorted by page_id."""
        return {
            "root_id": self.root_id,
            "page_size": self.page_size,
            "pages": [self.pages[pid].to_snapshot() for pid in sorted(self.pages.keys())],
        }
