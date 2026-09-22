"""Typed decode errors with byte-accurate locations."""

from __future__ import annotations


class DecodeError(Exception):
    """Base class for errors in one frame or TLV field.

    Offsets are relative to the frame payload unless ``frame_relative`` is
    supplied for a whole-frame error.  The stream layer converts them to
    absolute stream offsets.
    """

    def __init__(
        self,
        code: str,
        message: str,
        start: int,
        end: int,
        *,
        frame_relative: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.start = start
        self.end = end
        self.frame_relative = frame_relative


class IllegalLengthError(DecodeError):
    """A length is outside the frame or the allowed size for its field."""


class TruncatedFieldError(DecodeError):
    """A declared field ends outside the available payload."""


class DuplicateFieldError(DecodeError):
    """A TLV tag occurs more than once in one frame."""


class StructureMismatchError(DecodeError):
    """The structure version and payload contents do not agree."""


class ChecksumError(DecodeError):
    """A header or payload checksum is incorrect."""

