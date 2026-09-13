#!/usr/bin/env python3
"""Command-line entry point for the chunked upload coordinator.

Reads one JSON command per line from standard input and writes one JSON
result per line to standard output.  Every result has either ``"ok": true``
or an ``"error"`` string field, so the stream is machine-parseable even when
individual commands fail.

Supported commands::

    {"op": "start",  "file": "...", "object": "...", ...options}
    {"op": "resume", "file": "...", "object": "...", ...options}
    {"op": "status", "object": "..."}
    {"op": "cancel", "object": "...", "upload_id": "..." (optional)}
    {"op": "dump",   "object": "..."}
    {"op": "list"}

Optional knobs on start/resume: ``part_size`` (bytes), ``concurrency``,
``max_retries``, ``backoff_base`` (seconds), ``progress_path``.

The backend is an in-process :class:`InMemoryBackend`; its lifetime is this
process (use the Python API directly to script fault injection across the
same backend).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from chunked_upload import (
    InMemoryBackend,
    ProgressCorruptError,
    UploadConfig,
    UploadCoordinator,
    UploadFailedError,
    status_from_snapshot,
)
from chunked_upload.backend import UploadNotFoundError
from chunked_upload.coordinator import (
    DEFAULT_CONCURRENCY,
    DEFAULT_MAX_RETRIES,
    DEFAULT_PART_SIZE,
    DEFAULT_PROGRESS_PATH,
)
from chunked_upload.progress import ProgressStore


class UploadSession:
    """Holds the backend and the coordinators created during this process."""

    def __init__(self, default_progress_path: str) -> None:
        self.backend = InMemoryBackend()
        self.default_progress_path = default_progress_path
        self.coordinators: Dict[str, UploadCoordinator] = {}

    # -- helpers -----------------------------------------------------------

    def _progress_path(self, command: Dict[str, Any]) -> str:
        return str(command.get("progress_path", self.default_progress_path))

    def _config(self, command: Dict[str, Any]) -> UploadConfig:
        try:
            return UploadConfig(
                part_size=int(command.get("part_size", DEFAULT_PART_SIZE)),
                concurrency=int(command.get("concurrency", DEFAULT_CONCURRENCY)),
                max_retries=int(command.get("max_retries", DEFAULT_MAX_RETRIES)),
                backoff_base=float(command.get("backoff_base", 1.0)),
                progress_path=self._progress_path(command),
            )
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid option: {exc}") from exc

    def _snapshot_status(self, object_name: str, path: str) -> Dict[str, Any]:
        snapshot = ProgressStore(path).load(object_name)
        if snapshot is None:
            raise KeyError(object_name)
        return status_from_snapshot(snapshot)

    # -- command handlers --------------------------------------------------

    def handle(self, command: Dict[str, Any]) -> Dict[str, Any]:
        op = command.get("op")
        if op == "start":
            return self._start(command)
        if op == "resume":
            return self._resume(command)
        if op == "status":
            return self._status(command)
        if op == "cancel":
            return self._cancel(command)
        if op == "dump":
            return self._dump(command)
        if op == "list":
            return self._list(command)
        raise ValueError(
            f"unknown op {op!r}; expected one of: "
            f"start, resume, status, cancel, dump, list"
        )

    def _start(self, command: Dict[str, Any]) -> Dict[str, Any]:
        file_path, object_name = self._required_file_object(command)
        config = self._config(command)
        coordinator = UploadCoordinator.begin(
            self.backend, file_path, object_name, config
        )
        self.coordinators[object_name] = coordinator
        result: Dict[str, Any] = {"upload_id": coordinator.upload_id}
        result["final_etag"] = self._run(coordinator)
        result["status"] = coordinator.get_status()
        return result

    def _resume(self, command: Dict[str, Any]) -> Dict[str, Any]:
        file_path, object_name = self._required_file_object(command)
        config = self._config(command)
        coordinator = UploadCoordinator.resume(
            self.backend, file_path, object_name, config
        )
        self.coordinators[object_name] = coordinator
        result = {"upload_id": coordinator.upload_id}
        result["final_etag"] = self._run(coordinator)
        result["status"] = coordinator.get_status()
        return result

    @staticmethod
    def _run(coordinator: UploadCoordinator) -> Optional[str]:
        """Run upload(); return final etag, or None when parts still fail."""
        try:
            return coordinator.upload()
        except UploadFailedError as exc:
            # Progress is intentionally retained so a later resume continues.
            return None

    def _status(self, command: Dict[str, Any]) -> Dict[str, Any]:
        object_name = self._require_object(command)
        coordinator = self.coordinators.get(object_name)
        if coordinator is not None:
            return coordinator.get_status()
        return self._snapshot_status(
            object_name, self._progress_path(command)
        )

    def _cancel(self, command: Dict[str, Any]) -> Dict[str, Any]:
        object_name = self._require_object(command)
        coordinator = self.coordinators.get(object_name)
        upload_id = command.get("upload_id")
        if coordinator is None:
            # No live coordinator in this process: operate on the snapshot
            # so cancel still aborts a backend upload it knows about.
            path = self._progress_path(command)
            snapshot = ProgressStore(path).load(object_name)
            if snapshot is None:
                if upload_id is None:
                    raise KeyError(object_name)
                # Explicit cancel of an unknown id – ask the backend so the
                # error reflects reality.
                self.backend.abort_multipart(upload_id)
                return {"cancelled": upload_id}
            target_id = upload_id or snapshot["upload_id"]
            self.backend.abort_multipart(target_id)
            ProgressStore(path).delete(object_name)
            return {"cancelled": target_id}
        coordinator.cancel(upload_id)
        self.coordinators.pop(object_name, None)
        return {"cancelled": coordinator.upload_id}

    def _dump(self, command: Dict[str, Any]) -> Dict[str, Any]:
        object_name = self._require_object(command)
        coordinator = self.coordinators.get(object_name)
        if coordinator is not None:
            return coordinator.get_progress()
        snapshot = ProgressStore(self._progress_path(command)).load(object_name)
        if snapshot is None:
            raise KeyError(object_name)
        return snapshot

    def _list(self, command: Dict[str, Any]) -> Dict[str, Any]:
        return {"objects": ProgressStore(self._progress_path(command)).keys()}

    # -- argument helpers --------------------------------------------------

    @staticmethod
    def _require_object(command: Dict[str, Any]) -> str:
        object_name = command.get("object")
        if not isinstance(object_name, str) or not object_name:
            raise ValueError("command requires a non-empty 'object' field")
        return object_name

    def _required_file_object(
        self, command: Dict[str, Any]
    ) -> tuple[Path, str]:
        object_name = self._require_object(command)
        file_path = command.get("file")
        if not isinstance(file_path, str) or not file_path:
            raise ValueError("command requires a non-empty 'file' field")
        return Path(file_path), object_name


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Chunked multipart upload coordinator REPL"
    )
    parser.add_argument(
        "--progress",
        default=DEFAULT_PROGRESS_PATH,
        help=f"progress JSON file (default: {DEFAULT_PROGRESS_PATH})",
    )
    args = parser.parse_args(argv)

    session = UploadSession(args.progress)

    for line_number, raw_line in enumerate(sys.stdin, start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            try:
                command = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"line {line_number} is not valid JSON: {exc.msg}"
                ) from exc
            if not isinstance(command, dict):
                raise ValueError("command must be a JSON object")
            payload = session.handle(command)
            response: Dict[str, Any] = {"ok": True}
            response.update(payload)
        except KeyError as exc:
            response = {
                "ok": False,
                "error": f"no progress record for object {exc.args[0]!r}",
            }
        except ProgressCorruptError as exc:
            response = {"ok": False, "error": f"progress record corrupt: {exc}"}
        except UploadNotFoundError as exc:
            response = {"ok": False, "error": f"unknown upload_id: {exc}"}
        except Exception as exc:  # every command failure is a JSON error row
            response = {"ok": False, "error": str(exc) or exc.__class__.__name__}

        # ensure_ascii keeps the output safe on non-UTF-8 consoles (Windows
        # GBK code pages); every row is still one line of valid JSON.
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
