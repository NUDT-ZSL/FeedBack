"""Exception hierarchy for the B+tree index package."""
from __future__ import annotations


class BTreeIndexError(Exception):
    """Base class for every error raised by this package."""


class InvalidKeyError(BTreeIndexError):
    """Raised when a key violates the key constraints.

    Keys must be non-empty ``str`` values whose UTF-8 encoding does not
    exceed 256 bytes.
    """


class InvalidValueError(BTreeIndexError):
    """Raised when a value violates the value constraints.

    Values must be ``str`` values (possibly empty) whose UTF-8 encoding
    does not exceed 1 MiB.
    """


class InvalidPageSizeError(BTreeIndexError):
    """Raised when the configured page size is below ``MIN_PAGE_SIZE``."""


class ChecksumMismatchError(BTreeIndexError):
    """Raised when a page or manifest fails its checksum check.

    Attributes:
        page_id: Identifier of the corrupted page.  For manifest corruption
            this is the literal string ``"manifest"``.
        path:    Filesystem path whose content failed verification.
    """

    def __init__(self, page_id: str, path: str, message: str | None = None):
        self.page_id = page_id
        self.path = path
        if message is None:
            message = (
                f"checksum mismatch for page_id={page_id!r} in {path!r}: "
                "the on-disk content is corrupted"
            )
        super().__init__(message)


class RecoveryError(BTreeIndexError):
    """Raised when the on-disk tree cannot be made consistent at open time."""
