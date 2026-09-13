"""Replicated log with snapshot compaction.

Indices are absolute and 1-based. ``base_index``/``base_term`` describe the
snapshot that precedes the in-memory entries, so a compacted log still
answers ``term_at(base_index)`` for AppendEntries consistency checks.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional

from .errors import LogHoleError, SnapshotIndexError


@dataclass(frozen=True)
class LogEntry:
    index: int
    term: int
    command: Any


class Log:
    def __init__(self) -> None:
        self._entries: List[LogEntry] = []
        self.base_index: int = 0
        self.base_term: int = 0

    @property
    def entries(self) -> List[LogEntry]:
        return list(self._entries)

    @property
    def last_index(self) -> int:
        return self.base_index + len(self._entries)

    @property
    def last_term(self) -> int:
        return self._entries[-1].term if self._entries else self.base_term

    def term_at(self, index: int) -> int:
        if index < 0:
            raise LogHoleError("negative log index", index=index)
        if index < self.base_index:
            raise LogHoleError("log index already compacted into snapshot",
                               index=index, base_index=self.base_index)
        if index > self.last_index:
            raise LogHoleError("log index beyond last entry",
                               index=index, last_index=self.last_index)
        if index == self.base_index:
            return self.base_term
        return self._entries[index - self.base_index - 1].term

    def entry_at(self, index: int) -> LogEntry:
        if index <= self.base_index or index > self.last_index:
            raise LogHoleError("no live entry at index",
                               index=index, base_index=self.base_index,
                               last_index=self.last_index)
        return self._entries[index - self.base_index - 1]

    def entries_from(self, index: int) -> List[LogEntry]:
        """All live entries with entry.index >= index."""
        if index < self.base_index + 1:
            raise LogHoleError("requested entries start inside snapshot",
                               index=index, base_index=self.base_index)
        if index > self.last_index + 1:
            raise LogHoleError("requested entries start beyond log end",
                               index=index, last_index=self.last_index)
        return list(self._entries[index - self.base_index - 1:])

    def append(self, entries: List[LogEntry]) -> None:
        """Append entries, truncating any conflicting suffix first.

        An existing entry with the same term is kept (idempotent retry);
        a different term at the same index drops that entry and everything
        after it. Gaps are never allowed.
        """
        for e in entries:
            if e.index <= self.base_index:
                continue  # already covered by the snapshot
            pos = e.index - self.base_index - 1
            if pos < len(self._entries):
                if self._entries[pos].term != e.term:
                    del self._entries[pos:]
                    self._entries.append(e)
                # else: identical entry already present, nothing to do
            elif pos == len(self._entries):
                self._entries.append(e)
            else:
                raise LogHoleError("refusing to append past a gap",
                                   index=e.index, last_index=self.last_index)

    def truncate_prefix(self, index: int, term: int) -> None:
        """Compact everything up to and including ``index`` into the snapshot."""
        if index <= self.base_index:
            raise SnapshotIndexError("snapshot does not advance the log base",
                                     index=index, base_index=self.base_index)
        if index <= self.last_index:
            actual = self.term_at(index)
            if actual != term:
                raise SnapshotIndexError("snapshot term mismatch",
                                         index=index, expected=term, actual=actual)
            del self._entries[: index - self.base_index]
        else:
            self._entries = []
        self.base_index = index
        self.base_term = term

    def discard_all(self, base_index: int, base_term: int) -> None:
        """Throw away every entry; used when a snapshot conflicts with the log."""
        self._entries = []
        self.base_index = base_index
        self.base_term = base_term

    def first_index_of_term(self, term: int) -> int:
        for e in self._entries:
            if e.term == term:
                return e.index
        raise LogHoleError("term not present in log", term=term)

    def last_index_of_term(self, term: int) -> Optional[int]:
        for e in reversed(self._entries):
            if e.term == term:
                return e.index
            if e.term < term:
                break
        return None
