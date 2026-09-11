"""Embeddable streaming hotspot-detection and eviction-decision kernel.

Pure standard library, no network access. All time is integer logical time
so tests can inject timestamps deterministically.

Core concepts (see README.md for the full policy definitions):

- Access: one upstream access record (key, weight, ts).
- Decayed frequency table: each key keeps a hotness score. On a new access
  the old score is decayed by ``decay ** (now - last_ts)`` and the weight is
  added.
- Eviction decisions: ``evict_candidates(n)`` returns the coldest keys in a
  stable (score asc, key asc) order; keys below ``min_score`` are always
  included, even beyond ``n``.
- Cache admission: ``admit(key)`` decides whether a key deserves a cache
  slot, evicting the coldest cached key when the cache is full.
- Burst detection: per-key sliding-window counts; a key is bursting when the
  current window count exceeds ``burst_factor`` times the previous window
  count (previous window == 0 -> any current count > 0 is a burst).
- Bounded vs exact mode: with ``max_keys=None`` (exact mode) the table is
  unbounded. With ``max_keys`` set, overflow is handled per the ``overflow``
  policy ("error" by default, see README).
- Persistence: ``save``/``load`` round-trip the full state as JSON.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Union

__all__ = ["Access", "HotspotKernel", "MaxKeysExceededError"]


class MaxKeysExceededError(Exception):
    """Raised when a new key would exceed ``max_keys`` under the "error" policy."""


def _is_int(value: object) -> bool:
    # bool is a subclass of int; reject it explicitly for strict validation.
    return isinstance(value, int) and not isinstance(value, bool)


@dataclass(frozen=True)
class Access:
    """One upstream access record.

    key:    non-empty string
    weight: positive integer (default 1)
    ts:     integer logical time, >= 0
    """

    key: str
    weight: int = 1
    ts: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.key, str) or not self.key:
            raise ValueError(
                f"Access.key must be a non-empty string, got {self.key!r}"
            )
        if not _is_int(self.weight):
            raise ValueError(
                f"Access.weight must be an integer, got {self.weight!r}"
            )
        if self.weight < 1:
            raise ValueError(
                f"Access.weight must be >= 1, got {self.weight}"
            )
        if not _is_int(self.ts):
            raise ValueError(f"Access.ts must be an integer, got {self.ts!r}")
        if self.ts < 0:
            raise ValueError(f"Access.ts must be >= 0, got {self.ts}")


class HotspotKernel:
    """Streaming hotspot detection and eviction/admission decision kernel."""

    STATE_VERSION = 1
    OVERFLOW_POLICIES = ("error", "evict_lowest")

    def __init__(
        self,
        *,
        decay: float = 0.9,
        min_score: float = 0.0,
        capacity: int = 1024,
        max_keys: Optional[int] = None,
        window: int = 10,
        burst_factor: float = 2.0,
        overflow: str = "error",
    ) -> None:
        if not isinstance(decay, (int, float)) or isinstance(decay, bool):
            raise ValueError(f"decay must be a number in (0, 1], got {decay!r}")
        if not (0.0 < float(decay) <= 1.0):
            raise ValueError(f"decay must be in (0, 1], got {decay!r}")
        if not isinstance(min_score, (int, float)) or isinstance(min_score, bool):
            raise ValueError(f"min_score must be a number >= 0, got {min_score!r}")
        if float(min_score) < 0.0:
            raise ValueError(f"min_score must be >= 0, got {min_score!r}")
        if not _is_int(capacity) or capacity < 1:
            raise ValueError(f"capacity must be an integer >= 1, got {capacity!r}")
        if max_keys is not None and (not _is_int(max_keys) or max_keys < 1):
            raise ValueError(
                f"max_keys must be None (exact mode) or an integer >= 1, "
                f"got {max_keys!r}"
            )
        if not _is_int(window) or window < 1:
            raise ValueError(f"window must be an integer >= 1, got {window!r}")
        if not isinstance(burst_factor, (int, float)) or isinstance(burst_factor, bool):
            raise ValueError(
                f"burst_factor must be a number > 0, got {burst_factor!r}"
            )
        if float(burst_factor) <= 0.0:
            raise ValueError(f"burst_factor must be > 0, got {burst_factor!r}")
        if overflow not in self.OVERFLOW_POLICIES:
            raise ValueError(
                f"overflow must be one of {self.OVERFLOW_POLICIES}, got {overflow!r}"
            )

        self.decay = float(decay)
        self.min_score = float(min_score)
        self.capacity = capacity
        self.max_keys = max_keys  # None -> exact mode, no bound
        self.window = window
        self.burst_factor = float(burst_factor)
        self.overflow = overflow

        # key -> [score_as_of_last_ts, last_ts]
        self._scores: Dict[str, List[float]] = {}
        # key -> {window_index: weighted count} (only current and previous kept)
        self._windows: Dict[str, Dict[int, int]] = {}
        # keys currently admitted to the managed cache
        self._cache: set = set()
        # largest ts ever seen; default "now" for queries
        self._now = 0

    # ------------------------------------------------------------------ time

    def _resolve_now(self, now: Optional[int]) -> int:
        if now is None:
            return self._now
        if not _is_int(now):
            raise ValueError(f"now must be an integer, got {now!r}")
        if now < 0:
            raise ValueError(f"now must be >= 0, got {now}")
        return now

    @property
    def now(self) -> int:
        """Largest logical timestamp seen so far."""
        return self._now

    # ------------------------------------------------------------------ add

    def add(self, access: Access) -> float:
        """Record one access; returns the key's updated score.

        The stored score is first decayed by ``decay ** (ts - last_ts)`` and
        then the weight is added. Out-of-order timestamps (ts < last_ts for
        the same key) are rejected.
        """
        if not isinstance(access, Access):
            raise ValueError(
                f"add() expects an Access instance, got {type(access).__name__}"
            )
        key, ts, weight = access.key, access.ts, access.weight

        if key not in self._scores:
            self._make_room_for(key, ts)
            self._scores[key] = [0.0, ts]
            self._windows[key] = {}

        score, last_ts = self._scores[key]
        if ts < last_ts:
            raise ValueError(
                f"out-of-order access for key {key!r}: ts {ts} < last_ts {last_ts}"
            )
        new_score = score * (self.decay ** (ts - last_ts)) + weight
        self._scores[key] = [new_score, ts]

        w = ts // self.window
        win = self._windows[key]
        win[w] = win.get(w, 0) + weight
        for idx in [i for i in win if i < w - 1]:
            del win[idx]

        if ts > self._now:
            self._now = ts
        return new_score

    def _make_room_for(self, new_key: str, ts: int) -> None:
        """Enforce max_keys before inserting a key that is not tracked yet."""
        if self.max_keys is None:  # exact mode: never bounded
            return
        if len(self._scores) < self.max_keys:
            return
        if self.overflow == "evict_lowest":
            victim = min(
                self._scores,
                key=lambda k: (self._decayed(self._scores[k], ts), k),
            )
            self._drop(victim)
            return
        raise MaxKeysExceededError(
            f"max_keys={self.max_keys} exceeded: cannot track new key "
            f"{new_key!r} (overflow policy is 'error')"
        )

    def _drop(self, key: str) -> None:
        self._scores.pop(key, None)
        self._windows.pop(key, None)
        self._cache.discard(key)

    # ---------------------------------------------------------------- scores

    def _decayed(self, entry: List[float], now: int) -> float:
        score, last_ts = entry
        dt = now - last_ts
        if dt <= 0:  # queries must not fail on future-dated entries
            return score
        return score * (self.decay ** dt)

    def score(self, key: str, now: Optional[int] = None) -> float:
        """Decayed hotness of ``key`` at ``now`` (unknown keys score 0.0)."""
        now = self._resolve_now(now)
        entry = self._scores.get(key)
        if entry is None:
            return 0.0
        return self._decayed(entry, now)

    def __contains__(self, key: str) -> bool:
        return key in self._scores

    def __len__(self) -> int:
        return len(self._scores)

    def keys(self) -> List[str]:
        """All tracked keys, sorted."""
        return sorted(self._scores)

    # ------------------------------------------------------------- eviction

    def evict_candidates(self, n: int, now: Optional[int] = None) -> List[str]:
        """The ``n`` coldest keys, ordered by (score asc, key asc).

        Keys whose score is below ``min_score`` are always included first,
        even when there are more of them than ``n`` (the returned list may
        then be longer than ``n``).
        """
        if not _is_int(n) or n < 0:
            raise ValueError(f"n must be an integer >= 0, got {n!r}")
        now = self._resolve_now(now)
        ranked = sorted(
            ((self._decayed(entry, now), key) for key, entry in self._scores.items()),
            key=lambda item: (item[0], item[1]),
        )
        below = [key for score, key in ranked if score < self.min_score]
        rest = [key for score, key in ranked if score >= self.min_score]
        limit = max(n, len(below))
        return (below + rest)[:limit]

    # ------------------------------------------------------------ admission

    def admit(self, key: str, now: Optional[int] = None) -> bool:
        """Decide whether ``key`` deserves a cache slot, updating the cache.

        Admitted when the cache is not full, or when the key's score is not
        lower than the coldest cached key's score (which it then replaces).
        Ties are admitted; the lexicographically smallest coldest cached key
        is the victim. Returns True when the key is in the cache afterwards
        due to this call or was already cached.
        """
        if not isinstance(key, str) or not key:
            raise ValueError(f"key must be a non-empty string, got {key!r}")
        now = self._resolve_now(now)
        if key in self._cache:
            return True
        if len(self._cache) < self.capacity:
            self._cache.add(key)
            return True
        victim = min(
            self._cache, key=lambda k: (self.score(k, now), k)
        )
        if self.score(key, now) >= self.score(victim, now):
            self._cache.discard(victim)
            self._cache.add(key)
            return True
        return False

    @property
    def cache(self) -> List[str]:
        """Currently admitted cache keys, sorted."""
        return sorted(self._cache)

    # ---------------------------------------------------------------- burst

    def window_counts(self, key: str, now: Optional[int] = None):
        """(current_window_count, previous_window_count) for ``key``."""
        now = self._resolve_now(now)
        w = now // self.window
        win = self._windows.get(key, {})
        return win.get(w, 0), win.get(w - 1, 0)

    def is_burst(self, key: str, now: Optional[int] = None) -> bool:
        """True when the key suddenly became hot in the current window.

        Burst iff current > previous * burst_factor; when the previous
        window count is 0, any current count > 0 counts as a burst.
        """
        cur, prev = self.window_counts(key, now)
        if prev == 0:
            return cur > 0
        return cur > prev * self.burst_factor

    def burst_keys(self, now: Optional[int] = None) -> List[str]:
        """All currently bursting keys, sorted."""
        return sorted(k for k in self._windows if self.is_burst(k, now))

    # ---------------------------------------------------------- persistence

    def config(self) -> dict:
        return {
            "decay": self.decay,
            "min_score": self.min_score,
            "capacity": self.capacity,
            "max_keys": self.max_keys,
            "window": self.window,
            "burst_factor": self.burst_factor,
            "overflow": self.overflow,
        }

    def save(self, path: Union[str, Path]) -> None:
        """Persist the full kernel state (config, table, windows, cache)."""
        data = {
            "version": self.STATE_VERSION,
            "config": self.config(),
            "scores": {k: [e[0], e[1]] for k, e in self._scores.items()},
            "windows": {
                k: {str(idx): c for idx, c in win.items()}
                for k, win in self._windows.items()
            },
            "cache": sorted(self._cache),
            "now": self._now,
        }
        Path(path).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @classmethod
    def load(cls, path: Union[str, Path]) -> "HotspotKernel":
        """Restore a kernel saved with :meth:`save`.

        Raises ValueError with a clear message when the file is unreadable,
        is not valid JSON, or required fields are missing or malformed.
        """
        path = Path(path)
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"cannot read state file {path}: {exc}") from exc
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"corrupt state file {path}: invalid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError(
                f"corrupt state file {path}: top level must be a JSON object"
            )
        for field_name in ("version", "config", "scores", "windows", "cache", "now"):
            if field_name not in data:
                raise ValueError(
                    f"corrupt state file {path}: missing field {field_name!r}"
                )
        if data["version"] != cls.STATE_VERSION:
            raise ValueError(
                f"unsupported state version {data['version']!r} "
                f"(expected {cls.STATE_VERSION})"
            )
        if not isinstance(data["config"], dict):
            raise ValueError(f"corrupt state file {path}: 'config' must be an object")

        kernel = cls(**data["config"])  # constructor re-validates every option

        scores = data["scores"]
        if not isinstance(scores, dict):
            raise ValueError(f"corrupt state file {path}: 'scores' must be an object")
        for key, entry in scores.items():
            if (
                not isinstance(key, str)
                or not key
                or not isinstance(entry, list)
                or len(entry) != 2
                or not isinstance(entry[0], (int, float))
                or isinstance(entry[0], bool)
                or not _is_int(entry[1])
                or entry[1] < 0
            ):
                raise ValueError(
                    f"corrupt state file {path}: bad score entry for key {key!r}"
                )
            kernel._scores[key] = [float(entry[0]), entry[1]]

        windows = data["windows"]
        if not isinstance(windows, dict):
            raise ValueError(f"corrupt state file {path}: 'windows' must be an object")
        for key, win in windows.items():
            if not isinstance(key, str) or not isinstance(win, dict):
                raise ValueError(
                    f"corrupt state file {path}: bad window entry for key {key!r}"
                )
            parsed = {}
            for idx, count in win.items():
                if (
                    not isinstance(idx, str)
                    or not idx.lstrip("-").isdigit()
                    or not _is_int(count)
                    or count < 0
                ):
                    raise ValueError(
                        f"corrupt state file {path}: bad window count for key {key!r}"
                    )
                parsed[int(idx)] = count
            kernel._windows[key] = parsed

        cache = data["cache"]
        if not isinstance(cache, list) or not all(
            isinstance(k, str) and k for k in cache
        ):
            raise ValueError(
                f"corrupt state file {path}: 'cache' must be a list of non-empty strings"
            )
        kernel._cache = set(cache)

        if not _is_int(data["now"]) or data["now"] < 0:
            raise ValueError(f"corrupt state file {path}: 'now' must be an int >= 0")
        kernel._now = data["now"]

        return kernel
