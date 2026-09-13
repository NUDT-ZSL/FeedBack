"""Chunked multipart upload coordinator package.

The public surface consists of the pluggable storage backend, the in-memory
backend used for tests/offline demos, the upload coordinator and its
configuration/data types.
"""

from .backend import (
    InMemoryBackend,
    PartEtagConflictError,
    PartLostError,
    PartSpec,
    PartsMissingError,
    StorageBackend,
    StorageError,
    UploadAbortedError,
    UploadNotFoundError,
)
from .coordinator import (
    DEFAULT_BACKOFF_BASE,
    DEFAULT_CONCURRENCY,
    DEFAULT_MAX_RETRIES,
    DEFAULT_PART_SIZE,
    DEFAULT_PROGRESS_PATH,
    CoordinatorError,
    FingerprintMismatchError,
    InvalidConfigError,
    PartChecksumMismatchError,
    UploadCancelledError,
    UploadConfig,
    UploadCoordinator,
    UploadExistsError,
    UploadFailedError,
    UploadStateError,
    compute_part_sizes,
    hash_file,
    part_etag,
    status_from_snapshot,
)
from .progress import ProgressCorruptError, ProgressError, ProgressStore

__all__ = [
    "InMemoryBackend",
    "PartEtagConflictError",
    "PartLostError",
    "PartSpec",
    "PartsMissingError",
    "StorageBackend",
    "StorageError",
    "UploadAbortedError",
    "UploadNotFoundError",
    "DEFAULT_BACKOFF_BASE",
    "DEFAULT_CONCURRENCY",
    "DEFAULT_MAX_RETRIES",
    "DEFAULT_PART_SIZE",
    "DEFAULT_PROGRESS_PATH",
    "CoordinatorError",
    "FingerprintMismatchError",
    "InvalidConfigError",
    "PartChecksumMismatchError",
    "UploadCancelledError",
    "UploadConfig",
    "UploadCoordinator",
    "UploadExistsError",
    "UploadFailedError",
    "UploadStateError",
    "compute_part_sizes",
    "hash_file",
    "part_etag",
    "status_from_snapshot",
    "ProgressCorruptError",
    "ProgressError",
    "ProgressStore",
]
