"""In-memory representation and on-disk (de)serialisation of tree pages.

Three kinds of pages share one framed binary format:

* **leaf** (``flags`` bit 0) -- ordered ``(key, value)`` entries plus a
  ``next_leaf`` pointer threading all leaves into a linked list for range
  scans.  An entry value is either an inline string or an
  :class:`OverflowRef` pointing at a chain of overflow pages;
* **inner** page -- ``n - 1`` separator keys and ``n`` child page ids;
* **overflow** page (``flags`` bit 2) -- one base64 chunk of an oversized
  value plus a ``next`` pointer to the following chunk.

On-disk layout::

    magic (4B) | format version (2B) | flags (2B) | checksum (8B) | payload

The 8-byte checksum is ``sha256(payload)[:8]``.  The payload is compact
JSON for tree pages and JSON-with-base64-data for overflow pages.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import struct
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union

from .exceptions import ChecksumMismatchError

MAGIC = b"BTPI"                       # B-Tree Page Image
FORMAT_VERSION = 2
FLAG_LEAF = 0x1
FLAG_ROOT = 0x2
FLAG_OVERFLOW = 0x4
CHECKSUM_BYTES = 8
HEADER_SIZE = 4 + 2 + 2 + CHECKSUM_BYTES  # magic + version + flags + checksum

# A leaf value is either the inline string itself or a reference to an
# overflow-page chain.
LeafValue = Union[str, "OverflowRef"]


def compute_checksum(payload: bytes) -> bytes:
    """Return the first 8 bytes of SHA-256 over *payload*."""
    return hashlib.sha256(payload).digest()[:CHECKSUM_BYTES]


def json_payload_bytes(doc: Dict[str, Any]) -> bytes:
    """Canonical compact JSON encoding used both for writing and sizing."""
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


@dataclass
class OverflowRef:
    """Reference stored in a leaf entry in place of an oversized value.

    Attributes:
        head:   page id of the first overflow page.
        length: total size of the value in bytes (UTF-8).
        chunks: number of overflow pages in the chain.
    """

    head: str
    length: int
    chunks: int

    def to_doc(self) -> Dict[str, Any]:
        return {"ovf": self.head, "len": self.length, "chunks": self.chunks}

    @classmethod
    def from_doc(cls, doc: Dict[str, Any]) -> "OverflowRef":
        return cls(head=str(doc["ovf"]), length=int(doc["len"]), chunks=int(doc["chunks"]))

    def to_snapshot(self) -> Dict[str, Any]:
        return {"overflow_head": self.head, "length": self.length, "chunks": self.chunks}


@dataclass
class Page:
    """One B+tree node or one overflow chunk.

    Tree-page attributes:
        page_id:   Non-empty unique identifier (also the file name).
        is_leaf:   Leaf vs inner distinction (ignored for overflow pages).
        keys:      Inner-page separator keys.
        children:  Inner-page child page ids.
        items:     Leaf entries ``(key, str | OverflowRef)`` in key order.
        parent:    Parent page id, or ``None`` for the root.
        next_leaf: Next leaf in key order.
    Overflow-page attributes:
        is_overflow:   Marks an overflow chunk page.
        overflow_next: Next chunk page id (``None`` at the tail).
        overflow_data: This chunk's raw value bytes.
    ``is_root`` is a transient flag used when serialising the root bit.
    """

    page_id: str
    is_leaf: bool = True
    keys: List[str] = field(default_factory=list)
    children: List[str] = field(default_factory=list)
    items: List[Tuple[str, LeafValue]] = field(default_factory=list)
    parent: Optional[str] = None
    next_leaf: Optional[str] = None
    is_root: bool = False
    is_overflow: bool = False
    overflow_next: Optional[str] = None
    overflow_data: bytes = b""

    # --------------------------------------------------------- doc builders
    @staticmethod
    def _entry_doc(value: LeafValue) -> Any:
        return value.to_doc() if isinstance(value, OverflowRef) else value

    def _doc(self) -> Dict[str, Any]:
        if self.is_overflow:
            return {
                "id": self.page_id,
                "ovf": True,
                "next": self.overflow_next,
                "data": base64.b64encode(self.overflow_data).decode("ascii"),
            }
        doc: Dict[str, Any] = {
            "id": self.page_id,
            "leaf": self.is_leaf,
            "parent": self.parent,
        }
        if self.is_leaf:
            doc["items"] = [[k, self._entry_doc(v)] for k, v in self.items]
            doc["next_leaf"] = self.next_leaf
        else:
            doc["keys"] = self.keys
            doc["children"] = self.children
        return doc

    @staticmethod
    def leaf_doc(
        page_id: str,
        parent: Optional[str],
        items: List[Tuple[str, LeafValue]],
        next_leaf: Optional[str],
    ) -> Dict[str, Any]:
        """Build the payload document for a hypothetical leaf (for sizing)."""
        return {
            "id": page_id,
            "leaf": True,
            "parent": parent,
            "items": [[k, Page._entry_doc(v)] for k, v in items],
            "next_leaf": next_leaf,
        }

    @staticmethod
    def inner_doc(
        page_id: str, parent: Optional[str], keys: List[str], children: List[str]
    ) -> Dict[str, Any]:
        """Build the payload document for a hypothetical inner page."""
        return {
            "id": page_id,
            "leaf": False,
            "parent": parent,
            "keys": list(keys),
            "children": list(children),
        }

    # ---------------------------------------------------------------- sizes
    def content_size(self) -> int:
        """Exact payload byte size (the checksummed region)."""
        return len(json_payload_bytes(self._doc()))

    def byte_size(self) -> int:
        """Full on-disk byte size (fixed header plus payload)."""
        return HEADER_SIZE + self.content_size()

    # ------------------------------------------------------------- serialise
    def to_bytes(self) -> bytes:
        """Serialise the page to its self-describing on-disk binary format."""
        payload = json_payload_bytes(self._doc())
        flags = 0
        if self.is_overflow:
            flags |= FLAG_OVERFLOW
        elif self.is_leaf:
            flags |= FLAG_LEAF
        if self.is_root and not self.is_overflow:
            flags |= FLAG_ROOT
        header = MAGIC + struct.pack("<HH", FORMAT_VERSION, flags) + compute_checksum(payload)
        return header + payload

    @classmethod
    def from_bytes(cls, data: bytes, path: str = "<memory>") -> "Page":
        """Parse and verify a page image produced by :meth:`to_bytes`.

        Raises:
            ValueError:            the image is truncated, malformed or has
                an unsupported magic/format version.
            ChecksumMismatchError: the stored checksum does not match.
        """
        if len(data) < HEADER_SIZE:
            raise ValueError(f"page image too short ({len(data)} bytes) in {path!r}")
        magic, version, flags = struct.unpack("<4sHH", data[:8])
        stored_checksum = data[8:8 + CHECKSUM_BYTES]
        payload = data[8 + CHECKSUM_BYTES:]
        if magic != MAGIC:
            raise ValueError(f"bad page magic in {path!r}; not a btree-index page file")
        if version != FORMAT_VERSION:
            raise ValueError(
                f"unsupported page format version {version} in {path!r}; "
                f"expected {FORMAT_VERSION}"
            )
        if compute_checksum(payload) != stored_checksum:
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

        page = cls(page_id=doc["id"], parent=doc.get("parent"))
        if doc.get("ovf") is True:
            page.is_overflow = True
            page.is_leaf = False
            page.overflow_next = doc.get("next")
            try:
                page.overflow_data = base64.b64decode(doc["data"], validate=True)
            except (KeyError, ValueError) as exc:
                raise ValueError(f"malformed overflow page in {path!r}: {exc}") from exc
            return page

        page.is_leaf = bool(doc["leaf"])
        if page.is_leaf:
            items: List[Tuple[str, LeafValue]] = []
            for entry in doc.get("items", []):
                key, raw_value = entry
                if isinstance(raw_value, dict) and "ovf" in raw_value:
                    items.append((key, OverflowRef.from_doc(raw_value)))
                elif isinstance(raw_value, str):
                    items.append((key, raw_value))
                else:
                    raise ValueError(
                        f"malformed leaf entry in {path!r}: value is neither string nor "
                        "overflow reference"
                    )
            page.items = items
            page.next_leaf = doc.get("next_leaf")
        else:
            page.keys = list(doc.get("keys", []))
            page.children = list(doc.get("children", []))
        page.is_root = bool(flags & FLAG_ROOT)
        return page

    # ------------------------------------------------------------ snapshots
    def to_snapshot(self) -> dict:
        """JSON-serialisable debug snapshot used by ``BTreeIndex.dump``."""
        if self.is_overflow:
            return {
                "page_id": self.page_id,
                "is_overflow": True,
                "next_overflow": self.overflow_next,
                "chunk_bytes": len(self.overflow_data),
                "byte_size": self.byte_size(),
            }
        snap: dict = {
            "page_id": self.page_id,
            "is_leaf": self.is_leaf,
            "parent": self.parent,
            "is_root": self.is_root,
            "byte_size": self.byte_size(),
        }
        if self.is_leaf:
            snap["items"] = [
                [k, v] if isinstance(v, str) else [k, {"@overflow": v.to_snapshot()}]
                for k, v in self.items
            ]
            snap["next_leaf"] = self.next_leaf
        else:
            snap["keys"] = list(self.keys)
            snap["children"] = list(self.children)
        return snap
