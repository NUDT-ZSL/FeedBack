"""Offline binary stream codec demo.

The public API is intentionally small so server code can feed arbitrary
``bytes`` chunks to :class:`binary_codec.stream.FrameStreamDecoder`.
"""

from .models import Diagnostic, LogicalMessage, StreamEvent
from .parser import parse_payload
from .stream import FrameStreamDecoder

__all__ = [
    "Diagnostic",
    "LogicalMessage",
    "StreamEvent",
    "FrameStreamDecoder",
    "parse_payload",
]
__version__ = "1.0.0"
