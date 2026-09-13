"""Persistent B+tree index package.

Public API:
    BTreeIndex       -- the on-disk B+tree index
    Page             -- one tree node or overflow chunk
    OverflowRef      -- leaf reference to an overflow-page chain
    WAL              -- write-ahead log
    exceptions       -- exception hierarchy
"""
from .btree import BTreeIndex, DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_KEY_BYTES, MAX_VALUE_BYTES
from .page import Page, OverflowRef, LeafValue, compute_checksum
from .wal import WAL, WALRecord
from .exceptions import (
    BTreeIndexError,
    InvalidKeyError,
    InvalidValueError,
    InvalidPageSizeError,
    ChecksumMismatchError,
    RecoveryError,
)

__all__ = [
    "BTreeIndex",
    "Page",
    "OverflowRef",
    "LeafValue",
    "WAL",
    "WALRecord",
    "DEFAULT_PAGE_SIZE",
    "MIN_PAGE_SIZE",
    "MAX_KEY_BYTES",
    "MAX_VALUE_BYTES",
    "compute_checksum",
    "BTreeIndexError",
    "InvalidKeyError",
    "InvalidValueError",
    "InvalidPageSizeError",
    "ChecksumMismatchError",
    "RecoveryError",
]
