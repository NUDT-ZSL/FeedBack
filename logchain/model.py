# -*- coding: utf-8 -*-
"""Data model: log records and the verification basis (checksum recipe)."""
import hashlib
import json
import re
from dataclasses import dataclass, field, asdict
from typing import List, Optional

SUPPORTED_ALGORITHMS = ("sha256", "sha1", "md5")
CHECKSUM_FIELDS = ("seq", "timestamp", "source", "body", "prev_checksum")


@dataclass
class Basis:
    """The verification basis: how a record's checksum is derived.

    Changing any attribute produces a new basis_id, which invalidates all
    cached per-record verification results (the whole chain is affected).
    """
    algorithm: str = "sha256"
    fields: tuple = CHECKSUM_FIELDS
    separator: str = "|"
    encoding: str = "utf-8"

    def __post_init__(self):
        if self.algorithm not in SUPPORTED_ALGORITHMS:
            raise ValueError("unsupported algorithm: %s" % self.algorithm)
        unknown = [f for f in self.fields if f not in CHECKSUM_FIELDS]
        if unknown:
            raise ValueError("unknown checksum fields: %s" % unknown)
        self.fields = tuple(self.fields)

    @property
    def basis_id(self) -> str:
        raw = json.dumps({
            "algorithm": self.algorithm,
            "fields": list(self.fields),
            "separator": self.separator,
            "encoding": self.encoding,
        }, sort_keys=True)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    @property
    def digest_length(self) -> int:
        return hashlib.new(self.algorithm).digest_size * 2  # hex chars

    def to_dict(self):
        d = asdict(self)
        d["fields"] = list(self.fields)
        d["basis_id"] = self.basis_id
        return d

    @classmethod
    def from_dict(cls, d):
        d = dict(d)
        d.pop("basis_id", None)
        return cls(**d)


@dataclass
class LogRecord:
    seq: int
    timestamp: str
    source: str
    body: str
    prev_seq: Optional[int] = None   # sequence number this record chains to
    checksum: Optional[str] = None   # stored checksum (may be missing/abnormal)

    def canonical(self, basis: Basis, prev_checksum: str) -> str:
        values = {
            "seq": str(self.seq),
            "timestamp": self.timestamp,
            "source": self.source,
            "body": self.body,
            "prev_checksum": prev_checksum or "",
        }
        return basis.separator.join(values[f] for f in basis.fields)

    def compute_checksum(self, basis: Basis, prev_checksum: str) -> str:
        h = hashlib.new(basis.algorithm)
        h.update(self.canonical(basis, prev_checksum).encode(basis.encoding))
        return h.hexdigest()

    def checksum_format_ok(self, basis: Basis) -> bool:
        if self.checksum is None:
            return False
        pat = r"^[0-9a-fA-F]{%d}$" % basis.digest_length
        return re.match(pat, self.checksum) is not None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return cls(
            seq=int(d["seq"]),
            timestamp=str(d.get("timestamp", "")),
            source=str(d.get("source", "")),
            body=str(d.get("body", "")),
            prev_seq=d.get("prev_seq"),
            checksum=d.get("checksum"),
        )
