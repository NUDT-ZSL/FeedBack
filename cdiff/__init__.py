"""内容指纹与差分补丁引擎（仅依赖 Python 标准库）。

对外公开接口：

- :func:`fingerprint` / :class:`Fingerprint` / :class:`ChunkConfig`
- :func:`diff` / :func:`patch` / :class:`Delta` / :class:`Copy` / :class:`Add`
- :func:`compare` / :class:`DiffReport`
- :func:`save_delta` / :func:`load_delta`
- :func:`patch_size`
"""

from .chunking import ChunkConfig, content_defined_chunks
from .errors import (
    CdiffError,
    CorruptPatchError,
    FingerprintMismatchError,
    InvalidConfigError,
)
from .fingerprint import ChunkFingerprint, Fingerprint, fingerprint
from .delta import ADD, COPY, Add, Copy, Delta, diff, patch, patch_size
from .report import DiffReport, compare
from .persistence import load_delta, save_delta

__all__ = [
    "ChunkConfig",
    "content_defined_chunks",
    "CdiffError",
    "CorruptPatchError",
    "FingerprintMismatchError",
    "InvalidConfigError",
    "ChunkFingerprint",
    "Fingerprint",
    "fingerprint",
    "ADD",
    "COPY",
    "Add",
    "Copy",
    "Delta",
    "diff",
    "patch",
    "patch_size",
    "DiffReport",
    "compare",
    "save_delta",
    "load_delta",
]
