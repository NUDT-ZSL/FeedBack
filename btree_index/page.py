"""In-memory representation and on-disk (de)serialisation of tree pages.

A page is either:

* a **leaf** -- holds an ordered list of ``(key, value)`` pairs plus a
  ``next_leaf`` pointer which threads all leaves into a singly linked list
  used by range scans; or
* an **inner** (internal) page -- holds ``n - 1`` separator keys and ``n``
  child page ids; ``children[i]`` covers keys ``< keys[i]`` and
  ``children[i+1]`` covers keys ``>= keys[i]`` (B+tree: every separator also
  lives in a leaf).

Every page carries a ``parent`` page id (``None`` for the root) which is
verified during recovery.  The binary on-disk layout is::

    magic (4B) | format version (2B) | flags (2B) | checksum (8B) | payload

The 8-byte checksum is ``sha256(payload)[:8]``.  ``flags`` bit 0 marks a
leaf and bit 1 marks the root.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from .exceptions import ChecksumMismatchError

MAGIC = b"BTPI"                       # B-Tree Page Image
FORMAT_VERSION = 1
FLAG_LEAF = 0x1
FLAG_ROOT = 0x2
CHECKSUM_BYTES = 8
# Fixed overhead inside the payload: four 4-byte counters.
PAYLOAD_FIXED_OVERHEAD = 16
HEADER_SIZE = 4 + 2 + 2 + CHECKSUM_BYTES  # magic + version + flags + checksum


def compute_checksum(payload: bytes) -> bytes:
    """Return the first 8 bytes of SHA-256 over *payload*."""
    return hashlib.sha256(payload).digest()[:CHECKSUM_BYTES]


def _encoded_size(text: str) -> int:
    """Byte cost of storing *text* in a page: 4-byte length prefix + UTF-8."""
    return 4 + len(text.encode("utf-8"))


def leaf_content_size(items: List[Tuple[str, str]]) -> int:
    """Payload bytes used by a leaf holding *items* (excludes page overhead)."""
    total = PAYLOAD_FIXED_OVERHEAD
    for key, value in items:
        total += _encoded_size(key) + _encoded_size(value)
    # next_leaf pointer
    total += 4
    return total


def inner_content_size(keys: List[str], children: List[str]) -> int:
    """Payload bytes used by an inner page (excludes page overhead)."""
    total = PAYLOAD_FIXED_OVERHEAD
    for key in keys:
        total += _encoded_size(key)
    for child in children:
        total += _encoded_size(child)
    return total


@dataclass
class Page:
    """One B+tree node.

    Attributes:
        page_id:  Non-empty unique identifier.
        is_leaf:  Whether this page is a leaf.
        keys:     Leaf: empty (entries live in ``items``).  Inner: separators.
        children: Inner page: child page ids.  Empty for leaves.
        items:    Leaf page: ``(key, value)`` pairs in key order.
        parent:   Page id of the parent, or ``None`` for the root.
        next_leaf: Leaf-only pointer to the next leaf in key order.
        is_root:  Transient flag used when serialising the root bit.
    """

    page_id: str
    is_leaf: bool = True
    keys: List[str] = field(default_factory=list)
    children: List[str] = field(default_factory=list)
    items: List[Tuple[str, str]] = field(default_factory=list)
    parent: Optional[str] = None
    next_leaf: Optional[str] = None
    is_root: bool = False

    # ------------------------------------------------------------------ sizes
    def content_size(self) -> int:
        """Bytes used inside the page payload (pointers/metadata included)."""
        if self.is_leaf:
            total = leaf_content_size(self.items)
        else:
            total = inner_content_size(self.keys, self.children)
        total += _encoded_size(self.page_id)
        total += 4 if self.parent is None else _encoded_size(self.parent)
        return total

    def byte_size(self) -> int:
        """Full on-disk byte size (payload plus the fixed file header)."""
        return HEADER_SIZE + self.content_size()

    # ------------------------------------------------------------- serialise
    def to_bytes(self) -> bytes:
        """Serialise the page to its self-describing on-disk binary format."""
        doc = {
            "id": self.page_id,
            "leaf": self.is_leaf,
            "parent": self.parent,
        }
        if self.is_leaf:
            doc["items"] = self.items
            doc["next_leaf"] = self.next_leaf
        else:
            doc["keys"] = self.keys
            doc["children"] = self.children
        payload = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

        flags = 0
        if self.is_leaf:
            flags |= FLAG_LEAF
        if self.is_root:
            flags |= FLAG_ROOT
        header = MAGIC + struct.pack("<HH", FORMAT_VERSION, flags) + compute_checksum(payload)
        return header + payload

    @classmethod
    def from_bytes(cls, data: bytes, path: str = "<memory>") -> "Page":
        """Parse and verify a page image produced by :meth:`to_bytes`.

        Raises:
            ValueError:              the image is truncated or malformed.
            ChecksumMismatchError:   the stored checksum does not match.
        """
        if len(data) < HEADER_SIZE:
            raise ValueError(f"page image too short ({len(data)} bytes) in {path!r}")
        magic, version, flags = struct.unpack("<4sHH", data[:8])
        stored_checksum = data[8:8 + CHECKSUM_BYTES]
        payload = data[8 + CHECKSUM_BYTES:]
        if magic != MAGIC:
            page_id = "<unknown>"
            try:
                page_id = json.loads(payload.decode("utf-8", errors="replace")).get("id", page_id)
            except Exception:
                pass
            raise ValueError(f"bad page magic in {path!r}; not a btree-index page file")
        if version != FORMAT_VERSION:
            raise ValueError(f"unsupported page format version {version} in {path!r}")
        actual_checksum = compute_checksum(payload)
        if stored_checksum != actual_checksum:
            page_id = "<unknown>"
            try:
                page_id = json.loads(payload.decode("utf-8", errors="replace")).get("id", page_id)
            except Exception:
                pass
            # When the payload itself is unreadable, fall back to the file
            # name, which is the page id on disk.
            if (not page_id or page_id == "<unknown>") and path != "<memory>":
                page_id = os.path.basename(path)
            raise ChecksumMismatchError(
                str(page_id),
                path,
                f"checksum mismatch for page_id={page_id!r} in {path!r}: "
                "stored checksum does not match page content (page is corrupted)",
            )
        try:
            doc = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"malformed page payload in {path!r}: {exc}") from exc

        page = cls(
            page_id=doc["id"],
            is_leaf=bool(doc["leaf"]),
            parent=doc.get("parent"),
        )
        if page.is_leaf:
            page.items = [(k, v) for k, v in doc.get("items", [])]
            page.next_leaf = doc.get("next_leaf")
        else:
            page.keys = list(doc.get("keys", []))
            page.children = list(doc.get("children", []))
        page.is_root = bool(flags & FLAG_ROOT)
        return page

    # ------------------------------------------------------------ snapshots
    def to_snapshot(self) -> dict:
        """JSON-serialisable debug snapshot used by ``BTreeIndex.dump``."""
        snap: dict = {
            "page_id": self.page_id,
            "is_leaf": self.is_leaf,
            "parent": self.parent,
            "is_root": self.is_root,
            "byte_size": self.byte_size(),
        }
        if self.is_leaf:
            snap["items"] = [[k, v] for k, v in self.items]
            snap["next_leaf"] = self.next_leaf
        else:
            snap["keys"] = list(self.keys)
            snap["children"] = list(self.children)
        return snap
