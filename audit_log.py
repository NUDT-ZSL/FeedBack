"""Tamper-evident audit log kernel (Python standard library only).

Provides:
  - Hash-chained append-only records (SHA-256 over a canonical serialization).
  - Full-chain and sub-range integrity verification.
  - Compact Merkle inclusion proofs for individual records.
  - Range anchors (Merkle root over a half-open interval of record hashes).
  - A hash-chained signature history over anchors (pluggable pure-function signer).
  - JSON snapshot persistence with strict validation on load.

All serialization rules are documented in README.md and are deterministic
across machines: the same record always produces the same hash.
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
from typing import Any, Callable, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Hash of the implicit "genesis" record that precedes record seq 0.
GENESIS_HASH: str = hashlib.sha256(b"AUDIT-LOG-GENESIS-V1").hexdigest()

#: prev_sig_hash of the first signature in the signature history.
SIG_GENESIS_HASH: str = hashlib.sha256(b"AUDIT-LOG-SIG-GENESIS-V1").hexdigest()

#: Domain-separation prefix for Merkle internal nodes.
_MERKLE_PREFIX: bytes = b"AUDIT-LOG-MERKLE-V1"

#: Snapshot format version written by save() and required by load().
FORMAT_VERSION: int = 1

_HEX64 = set("0123456789abcdef")


class AuditLogError(Exception):
    """Raised for invalid operations, invalid ranges, or corrupt snapshots."""


# ---------------------------------------------------------------------------
# Signer registry and built-in signer factories
# ---------------------------------------------------------------------------

#: Process-level registry of signers, keyed by signer_id. register_signer()
#: writes here so that AuditLog.load() can restore a signer by the identifier
#: stored in the snapshot, without the caller re-registering it.
_SIGNER_REGISTRY: Dict[str, Callable[[bytes], bytes]] = {}


def make_hmac_signer(key: str) -> Callable[[bytes], bytes]:
    """Deterministic pure-function signer: HMAC-SHA256(key, data)."""
    key_bytes = key.encode("utf-8")

    def signer(data: bytes) -> bytes:
        return hmac.new(key_bytes, data, hashlib.sha256).digest()

    return signer


def _hmac_factory(spec: Dict[str, Any]) -> Callable[[bytes], bytes]:
    return make_hmac_signer(str(spec["key"]))


#: Factories that rebuild a signer from its JSON-serializable spec, used by
#: AuditLog.load() when the snapshot carries a "signer_spec".
_SIGNER_FACTORIES: Dict[str, Callable[[Dict[str, Any]], Callable[[bytes], bytes]]] = {
    "hmac-sha256": _hmac_factory,
}


# ---------------------------------------------------------------------------
# Canonical serialization and hashing primitives
# ---------------------------------------------------------------------------

def canonical_bytes(obj: Any) -> bytes:
    """Serialize ``obj`` to canonical JSON bytes.

    Rules (see README.md): UTF-8, keys sorted, no whitespace, non-ASCII
    emitted raw (ensure_ascii=False), NaN/Infinity rejected.
    """
    try:
        return json.dumps(
            obj,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise AuditLogError(f"payload is not canonically JSON-serializable: {exc}") from exc


def compute_record_hash(
    seq: int,
    record_id: str,
    ts: int,
    payload: Any,
    prev_hash: str,
) -> str:
    """Compute the SHA-256 record hash over the canonical record fields."""
    body = {
        "seq": seq,
        "record_id": record_id,
        "ts": ts,
        "payload": payload,
        "prev_hash": prev_hash,
    }
    return hashlib.sha256(canonical_bytes(body)).hexdigest()


def _hash_pair(left_hex: str, right_hex: str) -> str:
    """Merkle internal node: SHA-256(prefix || left_bytes || right_bytes)."""
    return hashlib.sha256(
        _MERKLE_PREFIX + bytes.fromhex(left_hex) + bytes.fromhex(right_hex)
    ).hexdigest()


def _is_hex64(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in _HEX64 for c in value)
    )


def merkle_root(leaves: List[str]) -> str:
    """Merkle root over hex-hash leaves; odd levels duplicate the last node."""
    if not leaves:
        raise AuditLogError("cannot compute Merkle root of an empty leaf set")
    for leaf in leaves:
        if not _is_hex64(leaf):
            raise AuditLogError(f"invalid Merkle leaf hash: {leaf!r}")
    level = list(leaves)
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        level = [
            _hash_pair(level[i], level[i + 1]) for i in range(0, len(level), 2)
        ]
    return level[0]


def _tree_depth(count: int) -> int:
    """Number of Merkle levels (and thus proof length) for ``count`` leaves."""
    depth = 0
    n = count
    while n > 1:
        n = (n + 1) // 2
        depth += 1
    return depth


def _merkle_proof(leaves: List[str], index: int) -> List[Dict[str, str]]:
    """Build a Merkle inclusion path for ``leaves[index]``.

    Each step is {"hash": <sibling hex>, "side": "left"|"right"} where side
    says on which side of the running hash the sibling is concatenated.
    """
    path: List[Dict[str, str]] = []
    level = list(leaves)
    idx = index
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        sibling = idx ^ 1
        side = "left" if sibling < idx else "right"
        path.append({"hash": level[sibling], "side": side})
        idx //= 2
        level = [
            _hash_pair(level[i], level[i + 1]) for i in range(0, len(level), 2)
        ]
    return path


def _merkle_fold(leaf_hash: str, path: List[Dict[str, str]]) -> str:
    """Fold a proof path from the leaf up to the candidate root."""
    h = leaf_hash
    for step in path:
        if step["side"] == "left":
            h = _hash_pair(step["hash"], h)
        else:
            h = _hash_pair(h, step["hash"])
    return h


def compute_sig_hash(
    signer_id: str,
    anchor_hash: str,
    signature_hex: str,
    prev_sig_hash: str,
) -> str:
    """Hash of one signature-history entry (chains the history together)."""
    body = {
        "signer_id": signer_id,
        "anchor_hash": anchor_hash,
        "signature": signature_hex,
        "prev_sig_hash": prev_sig_hash,
    }
    return hashlib.sha256(canonical_bytes(body)).hexdigest()


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _check_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise AuditLogError(f"{name} must be an integer, got {value!r}")
    return value


def _validate_record_fields(rec: Dict[str, Any]) -> None:
    required = ("seq", "record_id", "ts", "payload", "prev_hash", "record_hash")
    for field in required:
        if field not in rec:
            raise AuditLogError(f"record missing field '{field}'")
    _check_int(rec["seq"], "seq")
    _check_int(rec["ts"], "ts")
    if not isinstance(rec["record_id"], str) or not rec["record_id"]:
        raise AuditLogError("record_id must be a non-empty string")
    if not _is_hex64(rec["prev_hash"]):
        raise AuditLogError(f"prev_hash is not a 64-char hex string: {rec['prev_hash']!r}")
    if not _is_hex64(rec["record_hash"]):
        raise AuditLogError(f"record_hash is not a 64-char hex string: {rec['record_hash']!r}")
    canonical_bytes(rec["payload"])  # raises if payload is not serializable


# ---------------------------------------------------------------------------
# AuditLog
# ---------------------------------------------------------------------------

class AuditLog:
    """Append-only, hash-chained, tamper-evident audit log."""

    def __init__(self) -> None:
        self._records: List[Dict[str, Any]] = []
        self._by_id: Dict[str, int] = {}
        self._anchors: List[Dict[str, Any]] = []
        self._signatures: List[Dict[str, Any]] = []
        self._log: List[Dict[str, Any]] = []
        self._op_counter: int = 0
        self._signer: Optional[Callable[[bytes], bytes]] = None
        self._signer_id: Optional[str] = None
        self._signer_spec: Optional[Dict[str, Any]] = None

    # ------------------------------------------------------------------
    # internal helpers
    # ------------------------------------------------------------------

    def _log_op(self, op: str, **detail: Any) -> None:
        entry = {"op_index": self._op_counter, "op": op}
        entry.update(detail)
        self._log.append(entry)
        self._op_counter += 1

    def _tip_hash(self) -> str:
        return self._records[-1]["record_hash"] if self._records else GENESIS_HASH

    # ------------------------------------------------------------------
    # 1/2. append + chain verification
    # ------------------------------------------------------------------

    def append(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Append a record. ``record`` needs record_id, ts, payload; seq is
        optional but, if present, must equal the next sequence number.

        prev_hash and record_hash are always (re)computed here; any values
        supplied by the caller are ignored.

        Returns the stored record (a copy).
        """
        if not isinstance(record, dict):
            raise AuditLogError("record must be a dict")
        record_id = record.get("record_id")
        if not isinstance(record_id, str) or not record_id:
            raise AuditLogError("record_id must be a non-empty string")
        if record_id in self._by_id:
            raise AuditLogError(f"duplicate record_id: {record_id!r}")
        ts = _check_int(record.get("ts"), "ts")
        if "payload" not in record:
            raise AuditLogError("record missing field 'payload'")
        payload = record["payload"]
        canonical_bytes(payload)  # reject non-serializable payloads early

        seq = len(self._records)
        if "seq" in record and record["seq"] is not None:
            given = _check_int(record["seq"], "seq")
            if given != seq:
                raise AuditLogError(
                    f"seq mismatch: expected {seq}, got {given}"
                )

        prev_hash = self._tip_hash()
        record_hash = compute_record_hash(seq, record_id, ts, payload, prev_hash)
        stored = {
            "seq": seq,
            "record_id": record_id,
            "ts": ts,
            "payload": copy.deepcopy(payload),
            "prev_hash": prev_hash,
            "record_hash": record_hash,
        }
        self._records.append(stored)
        self._by_id[record_id] = seq
        self._log_op("append", seq=seq, record_id=record_id)
        return copy.deepcopy(stored)

    def verify_chain(self, start: int = 0, end: Optional[int] = None) -> Dict[str, Any]:
        """Recompute hashes and prev_hash links over [start, end).

        Returns {"ok": bool, "seq": first-bad-seq-or-None, "reason": str,
        "checked": int}.
        """
        if end is None:
            end = len(self._records)
        start = _check_int(start, "start")
        end = _check_int(end, "end")
        if start < 0 or end < start or end > len(self._records):
            return {
                "ok": False,
                "seq": None,
                "reason": f"invalid range [{start}, {end}) for {len(self._records)} records",
                "checked": 0,
            }
        prev_hash = GENESIS_HASH if start == 0 else self._records[start - 1]["record_hash"]
        for i in range(start, end):
            rec = self._records[i]
            if rec["prev_hash"] != prev_hash:
                return {
                    "ok": False,
                    "seq": i,
                    "reason": "prev_hash mismatch: chain link broken",
                    "checked": i - start,
                }
            expected = compute_record_hash(
                rec["seq"], rec["record_id"], rec["ts"], rec["payload"], rec["prev_hash"]
            )
            if rec["record_hash"] != expected:
                return {
                    "ok": False,
                    "seq": i,
                    "reason": "record_hash mismatch: record content tampered",
                    "checked": i - start,
                }
            if rec["seq"] != i:
                return {
                    "ok": False,
                    "seq": i,
                    "reason": f"seq mismatch: expected {i}, got {rec['seq']}",
                    "checked": i - start,
                }
            prev_hash = rec["record_hash"]
        return {
            "ok": True,
            "seq": None,
            "reason": "chain valid",
            "checked": end - start,
        }

    # ------------------------------------------------------------------
    # 3. inclusion proofs
    # ------------------------------------------------------------------

    def prove(self, seq: int, anchor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Build a Merkle inclusion proof for the record at ``seq``.

        Without ``anchor`` the proof runs to the Merkle root of the whole
        chain (the tip root). With an anchor dict (containing start/end, and
        optionally anchor_hash) the proof runs to that anchor's root, which
        keeps the path short.
        """
        seq = _check_int(seq, "seq")
        if not self._records:
            raise AuditLogError("cannot prove membership of an empty log")
        if seq < 0 or seq >= len(self._records):
            raise AuditLogError(f"seq {seq} out of range [0, {len(self._records)})")

        if anchor is not None:
            if not isinstance(anchor, dict) or "start" not in anchor or "end" not in anchor:
                raise AuditLogError("anchor must be a dict with 'start' and 'end'")
            start = _check_int(anchor["start"], "anchor.start")
            end = _check_int(anchor["end"], "anchor.end")
            if start >= end:
                raise AuditLogError(f"anchor range invalid: start {start} >= end {end}")
            if end > len(self._records):
                raise AuditLogError("anchor range out of bounds for current chain")
            if not (start <= seq < end):
                raise AuditLogError(f"seq {seq} not inside anchor range [{start}, {end})")
            root = merkle_root([r["record_hash"] for r in self._records[start:end]])
            if "anchor_hash" in anchor and anchor["anchor_hash"] != root:
                raise AuditLogError("given anchor_hash does not match the current chain")
        else:
            start, end = 0, len(self._records)
            root = merkle_root([r["record_hash"] for r in self._records])

        leaves = [r["record_hash"] for r in self._records[start:end]]
        index = seq - start
        path = _merkle_proof(leaves, index)
        proof = {
            "seq": seq,
            "record_hash": self._records[seq]["record_hash"],
            "start": start,
            "end": end,
            "index": index,
            "count": end - start,
            "root": root,
            "path": path,
        }
        self._log_op("prove", seq=seq, start=start, end=end)
        return proof

    @staticmethod
    def verify_proof(
        record: Dict[str, Any],
        proof: Dict[str, Any],
        anchor_hash: str,
    ) -> Dict[str, Any]:
        """Verify that ``record`` belongs to the chain/anchor identified by
        ``anchor_hash``, using only the record content and ``proof``.

        Never raises on bad input; returns {"ok": bool, "reason": str}.
        """
        def fail(reason: str) -> Dict[str, Any]:
            return {"ok": False, "reason": reason}

        if not isinstance(record, dict):
            return fail("record must be a dict")
        for field in ("seq", "record_id", "ts", "payload", "prev_hash"):
            if field not in record:
                return fail(f"record missing field '{field}'")
        try:
            recomputed = compute_record_hash(
                record["seq"], record["record_id"], record["ts"],
                record["payload"], record["prev_hash"],
            )
        except AuditLogError as exc:
            return fail(f"record not serializable: {exc}")
        if "record_hash" in record and record["record_hash"] != recomputed:
            return fail("record_hash does not match record content")

        if not isinstance(proof, dict):
            return fail("proof must be a dict")
        for field in ("record_hash", "path", "index", "count", "start", "end", "seq"):
            if field not in proof:
                return fail(f"proof missing field '{field}'")
        if proof["record_hash"] != recomputed:
            return fail("proof does not belong to this record (record_hash differs)")
        if proof["seq"] != record["seq"]:
            return fail(f"proof seq {proof['seq']} != record seq {record['seq']}")

        start, end, count, index = proof["start"], proof["end"], proof["count"], proof["index"]
        for name, value in (("start", start), ("end", end), ("count", count), ("index", index)):
            if isinstance(value, bool) or not isinstance(value, int):
                return fail(f"proof field '{name}' must be an integer")
        if count != end - start or count <= 0:
            return fail("proof count does not match [start, end) range")
        if index != record["seq"] - start or not (0 <= index < count):
            return fail("proof index inconsistent with record seq and range")

        path = proof["path"]
        if not isinstance(path, list):
            return fail("proof path must be a list")
        expected_depth = _tree_depth(count)
        if len(path) != expected_depth:
            return fail(
                f"proof path length mismatch: expected {expected_depth} step(s), got {len(path)}"
            )
        for i, step in enumerate(path):
            if not isinstance(step, dict) or "hash" not in step or "side" not in step:
                return fail(f"proof path step {i} must have 'hash' and 'side'")
            if not _is_hex64(step["hash"]):
                return fail(f"proof path step {i} hash is not 64-char hex")
            if step["side"] not in ("left", "right"):
                return fail(f"proof path step {i} has invalid side {step['side']!r}")

        if not _is_hex64(anchor_hash):
            return fail("anchor_hash is not a 64-char hex string")

        root = _merkle_fold(recomputed, path)
        if root != anchor_hash:
            return fail("root hash mismatch: record is not in this chain/anchor")
        return {"ok": True, "reason": "proof valid"}

    # ------------------------------------------------------------------
    # 4. range anchors
    # ------------------------------------------------------------------

    def anchor(self, start: int, end: int) -> Dict[str, Any]:
        """Create an anchor (Merkle root) over record hashes in [start, end)."""
        start = _check_int(start, "start")
        end = _check_int(end, "end")
        if start < 0:
            raise AuditLogError(f"anchor start must be >= 0, got {start}")
        if start >= end:
            raise AuditLogError(f"anchor range invalid: start {start} >= end {end}")
        if end > len(self._records):
            raise AuditLogError(
                f"anchor range [{start}, {end}) out of bounds: only {len(self._records)} records"
            )
        anchor_hash = merkle_root([r["record_hash"] for r in self._records[start:end]])
        anchor_obj = {
            "start": start,
            "end": end,
            "count": end - start,
            "anchor_hash": anchor_hash,
        }
        self._anchors.append(anchor_obj)
        self._log_op("anchor", start=start, end=end, anchor_hash=anchor_hash)
        return copy.deepcopy(anchor_obj)

    def _content_hashes(self, start: int, end: int) -> List[str]:
        """Record hashes for [start, end) recomputed from record content."""
        return [
            compute_record_hash(
                r["seq"], r["record_id"], r["ts"], r["payload"], r["prev_hash"]
            )
            for r in self._records[start:end]
        ]

    def verify_anchor(self, anchor_obj: Dict[str, Any]) -> Dict[str, Any]:
        """Recompute an anchor against the current chain and compare.

        Record hashes are recomputed from record content (not taken from
        stored record_hash values), so tampering with payload/ts/prev_hash
        is detected here even if the stored hashes were left inconsistent.
        """
        if not isinstance(anchor_obj, dict):
            return {"ok": False, "reason": "anchor must be a dict"}
        for field in ("start", "end", "count", "anchor_hash"):
            if field not in anchor_obj:
                return {"ok": False, "reason": f"anchor missing field '{field}'"}
        start, end = anchor_obj["start"], anchor_obj["end"]
        if (isinstance(start, bool) or not isinstance(start, int)
                or isinstance(end, bool) or not isinstance(end, int)):
            return {"ok": False, "reason": "anchor start/end must be integers"}
        if start < 0:
            return {"ok": False, "reason": f"anchor start must be >= 0, got {start}"}
        if start >= end:
            return {"ok": False, "reason": f"anchor range invalid: start {start} >= end {end}"}
        if end > len(self._records):
            return {
                "ok": False,
                "reason": f"anchor range [{start}, {end}) out of bounds: "
                          f"only {len(self._records)} records",
            }
        if anchor_obj["count"] != end - start:
            return {"ok": False, "reason": "anchor count does not match [start, end) range"}
        if not _is_hex64(anchor_obj["anchor_hash"]):
            return {"ok": False, "reason": "anchor_hash is not a 64-char hex string"}
        expected = merkle_root(self._content_hashes(start, end))
        if expected != anchor_obj["anchor_hash"]:
            return {"ok": False, "reason": "anchor_hash mismatch: chain content changed"}
        return {"ok": True, "reason": "anchor valid"}

    def get_anchors(self) -> List[Dict[str, Any]]:
        """Return copies of all anchors, oldest first."""
        return copy.deepcopy(self._anchors)

    # ------------------------------------------------------------------
    # 5. signature chain
    # ------------------------------------------------------------------

    def register_signer(
        self,
        signer_id: str,
        signer: Callable[[bytes], bytes],
        spec: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Register a pure-function signer: bytes in, signature bytes out.

        ``spec`` is an optional JSON-serializable dict describing how to
        rebuild the signer (e.g. {"type": "hmac-sha256", "key": "..."}); when
        present it is stored in snapshots so load() can restore the signer in
        a fresh process. The signer is also recorded in a process-level
        registry keyed by signer_id, so load() in the same process can
        restore it even without a spec.
        """
        if not isinstance(signer_id, str) or not signer_id:
            raise AuditLogError("signer_id must be a non-empty string")
        if not callable(signer):
            raise AuditLogError("signer must be callable")
        if spec is not None:
            if not isinstance(spec, dict) or "type" not in spec:
                raise AuditLogError("signer spec must be a dict with a 'type' field")
            canonical_bytes(spec)  # must be JSON-serializable to be snapshotted
        self._signer = signer
        self._signer_id = signer_id
        self._signer_spec = copy.deepcopy(spec) if spec is not None else None
        _SIGNER_REGISTRY[signer_id] = signer
        self._log_op("register_signer", signer_id=signer_id)

    def sign_anchor(self, anchor_obj: Dict[str, Any]) -> Dict[str, Any]:
        """Sign an anchor's hash and append the signature to the history."""
        if self._signer is None or self._signer_id is None:
            raise AuditLogError("no signer registered")
        check = self.verify_anchor(anchor_obj)
        if not check["ok"]:
            raise AuditLogError(f"cannot sign invalid anchor: {check['reason']}")
        anchor_hash = anchor_obj["anchor_hash"]
        signature = self._signer(bytes.fromhex(anchor_hash))
        if not isinstance(signature, (bytes, bytearray)) or len(signature) == 0:
            raise AuditLogError("signer must return non-empty bytes")
        signature_hex = bytes(signature).hex()
        prev_sig_hash = (
            self._signatures[-1]["sig_hash"] if self._signatures else SIG_GENESIS_HASH
        )
        sig_hash = compute_sig_hash(self._signer_id, anchor_hash, signature_hex, prev_sig_hash)
        sig_obj = {
            "index": len(self._signatures),
            "signer_id": self._signer_id,
            "anchor_hash": anchor_hash,
            "signature": signature_hex,
            "prev_sig_hash": prev_sig_hash,
            "sig_hash": sig_hash,
        }
        self._signatures.append(sig_obj)
        self._log_op("sign", anchor_hash=anchor_hash, sig_hash=sig_hash)
        return copy.deepcopy(sig_obj)

    def verify_signature(
        self, anchor_obj: Dict[str, Any], sig_obj: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify a signature object against an anchor and the registered signer."""
        def fail(reason: str) -> Dict[str, Any]:
            return {"ok": False, "reason": reason}

        if self._signer is None:
            if self._signer_id is not None:
                return fail(
                    f"signer unavailable: snapshot signer {self._signer_id!r} was not "
                    "restored (no matching registered signer or signer spec)"
                )
            return fail("no signer registered")
        if not isinstance(sig_obj, dict):
            return fail("signature object must be a dict")
        for field in ("signer_id", "anchor_hash", "signature", "prev_sig_hash", "sig_hash"):
            if field not in sig_obj:
                return fail(f"signature object missing field '{field}'")
        if not isinstance(anchor_obj, dict) or "anchor_hash" not in anchor_obj:
            return fail("anchor object missing 'anchor_hash'")
        if sig_obj["signer_id"] != self._signer_id:
            return fail(
                f"signer_id mismatch: object signed by {sig_obj['signer_id']!r}, "
                f"registered signer is {self._signer_id!r}"
            )
        if sig_obj["anchor_hash"] != anchor_obj["anchor_hash"]:
            return fail("anchor hash mismatch between anchor and signature object")
        if not _is_hex64(sig_obj["anchor_hash"]):
            return fail("anchor_hash is not a 64-char hex string")
        sig_hex = sig_obj["signature"]
        if not isinstance(sig_hex, str):
            return fail("signature must be a hex string")
        try:
            sig_bytes = bytes.fromhex(sig_hex)
        except ValueError:
            return fail("signature is not valid hex")
        expected = bytes(self._signer(bytes.fromhex(sig_obj["anchor_hash"])))
        if len(sig_bytes) != len(expected):
            return fail(
                f"signature length mismatch: expected {len(expected)} bytes, got {len(sig_bytes)}"
            )
        if sig_bytes != expected:
            return fail("signature mismatch: does not match signer output")
        expected_sig_hash = compute_sig_hash(
            sig_obj["signer_id"], sig_obj["anchor_hash"], sig_hex, sig_obj["prev_sig_hash"]
        )
        if expected_sig_hash != sig_obj["sig_hash"]:
            return fail("sig_hash mismatch: signature history entry tampered")
        return {"ok": True, "reason": "signature valid"}

    def verify_signatures(self) -> Dict[str, Any]:
        """Verify the whole signature history: chain links, entry hashes,
        anchor references, and (if a signer is registered) signature bytes."""
        anchor_hashes = {a["anchor_hash"] for a in self._anchors}
        prev = SIG_GENESIS_HASH
        for i, sig in enumerate(self._signatures):
            if sig["anchor_hash"] not in anchor_hashes:
                return {
                    "ok": False,
                    "index": i,
                    "reason": "signature references unknown anchor",
                    "checked": i,
                }
            if sig["prev_sig_hash"] != prev:
                return {
                    "ok": False,
                    "index": i,
                    "reason": "prev_sig_hash mismatch: signature history tampered",
                    "checked": i,
                }
            expected = compute_sig_hash(
                sig["signer_id"], sig["anchor_hash"], sig["signature"], sig["prev_sig_hash"]
            )
            if expected != sig["sig_hash"]:
                return {
                    "ok": False,
                    "index": i,
                    "reason": "sig_hash mismatch: signature entry tampered",
                    "checked": i,
                }
            if self._signer is not None:
                expected_sig = bytes(self._signer(bytes.fromhex(sig["anchor_hash"]))).hex()
                if expected_sig != sig["signature"]:
                    return {
                        "ok": False,
                        "index": i,
                        "reason": "signature bytes do not match registered signer",
                        "checked": i,
                    }
            prev = sig["sig_hash"]
        return {
            "ok": True,
            "index": None,
            "reason": "signature history valid",
            "checked": len(self._signatures),
        }

    def get_signatures(self) -> List[Dict[str, Any]]:
        """Return copies of all signature-history entries, oldest first."""
        return copy.deepcopy(self._signatures)

    # ------------------------------------------------------------------
    # 6. queries and state
    # ------------------------------------------------------------------

    def get_record(self, seq: int) -> Optional[Dict[str, Any]]:
        """Return a copy of the record at ``seq``, or None if absent."""
        if isinstance(seq, bool) or not isinstance(seq, int):
            return None
        if 0 <= seq < len(self._records):
            return copy.deepcopy(self._records[seq])
        return None

    def get_record_by_id(self, record_id: str) -> Optional[Dict[str, Any]]:
        """Return a copy of the record with this record_id, or None."""
        seq = self._by_id.get(record_id)
        if seq is None:
            return None
        return copy.deepcopy(self._records[seq])

    def range_records(self, start: int, end: int) -> Dict[str, Any]:
        """Return records with seq in [start, end), ascending by seq.

        Illegal ranges are errors, never silently truncated: ``start < 0``
        and ``start > end`` raise AuditLogError. An ``end`` past the last
        record is legal and truncated to the chain length; the result then
        reports the effective range so callers can tell "legally empty"
        apart from "clipped":

        {"records": [...], "start": start, "end": <effective end>,
         "requested_end": end, "truncated": bool, "count": len(records)}
        """
        start = _check_int(start, "start")
        end = _check_int(end, "end")
        if start < 0:
            raise AuditLogError(f"range start must be >= 0, got {start}")
        if start > end:
            raise AuditLogError(f"invalid range: start {start} > end {end}")
        effective_end = min(end, len(self._records))
        records = copy.deepcopy(self._records[start:effective_end])
        return {
            "records": records,
            "start": start,
            "end": effective_end,
            "requested_end": end,
            "truncated": effective_end < end,
            "count": len(records),
        }

    def get_state(self) -> Dict[str, Any]:
        """Summary: counts, tip, and chain-validity flag."""
        return {
            "record_count": len(self._records),
            "latest_seq": len(self._records) - 1,
            "latest_record_hash": self._records[-1]["record_hash"] if self._records else None,
            "anchor_count": len(self._anchors),
            "signature_count": len(self._signatures),
            "chain_valid": bool(self.verify_chain()["ok"]),
            "signer_id": self._signer_id,
            "signer_registered": self._signer is not None,
        }

    def get_log(self) -> List[Dict[str, Any]]:
        """Time-ordered operation log (append/anchor/sign/register_signer/load)."""
        return copy.deepcopy(self._log)

    # ------------------------------------------------------------------
    # 7. persistence
    # ------------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        """Full serializable snapshot of the log state."""
        return {
            "version": FORMAT_VERSION,
            "signer_id": self._signer_id,
            "signer_spec": copy.deepcopy(self._signer_spec),
            "records": copy.deepcopy(self._records),
            "anchors": copy.deepcopy(self._anchors),
            "signatures": copy.deepcopy(self._signatures),
            "log": copy.deepcopy(self._log),
            "op_counter": self._op_counter,
        }

    def save(self, path: str) -> Dict[str, Any]:
        """Write the snapshot to ``path`` as JSON."""
        data = self.snapshot()
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
        except OSError as exc:
            raise AuditLogError(f"cannot write snapshot to {path!r}: {exc}") from exc
        return {"ok": True, "path": path, "record_count": len(self._records)}

    @classmethod
    def load(cls, path: str) -> "AuditLog":
        """Rebuild a log from a snapshot file, validating all consistency
        invariants. Raises AuditLogError with a precise reason on any
        corruption; never returns a partially-valid log."""
        try:
            with open(path, "r", encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            raise AuditLogError(f"cannot read snapshot {path!r}: {exc}") from exc
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AuditLogError(f"snapshot {path!r} is not valid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise AuditLogError("snapshot root must be a JSON object")
        for field in ("version", "records", "anchors", "signatures", "log"):
            if field not in data:
                raise AuditLogError(f"snapshot missing field '{field}'")
        if data["version"] != FORMAT_VERSION:
            raise AuditLogError(
                f"unsupported snapshot version {data['version']!r} (expected {FORMAT_VERSION})"
            )
        records = data["records"]
        anchors = data["anchors"]
        signatures = data["signatures"]
        if not isinstance(records, list):
            raise AuditLogError("snapshot field 'records' must be a list")
        if not isinstance(anchors, list):
            raise AuditLogError("snapshot field 'anchors' must be a list")
        if not isinstance(signatures, list):
            raise AuditLogError("snapshot field 'signatures' must be a list")

        # --- records: fields, seq continuity, id uniqueness, hashes, links
        seen_ids: set = set()
        prev_hash = GENESIS_HASH
        for i, rec in enumerate(records):
            if not isinstance(rec, dict):
                raise AuditLogError(f"record {i} is not an object")
            try:
                _validate_record_fields(rec)
            except AuditLogError as exc:
                raise AuditLogError(f"record {i}: {exc}") from exc
            if rec["seq"] != i:
                raise AuditLogError(
                    f"record {i}: seq not continuous (expected {i}, got {rec['seq']})"
                )
            if rec["record_id"] in seen_ids:
                raise AuditLogError(f"record {i}: duplicate record_id {rec['record_id']!r}")
            seen_ids.add(rec["record_id"])
            if rec["prev_hash"] != prev_hash:
                raise AuditLogError(
                    f"record {i}: prev_hash does not match previous record_hash (chain broken)"
                )
            expected = compute_record_hash(
                rec["seq"], rec["record_id"], rec["ts"], rec["payload"], rec["prev_hash"]
            )
            if rec["record_hash"] != expected:
                raise AuditLogError(
                    f"record {i}: record_hash does not match content (tampered)"
                )
            prev_hash = rec["record_hash"]

        # --- anchors: shape, legal range, hash matches records
        for j, anchor_obj in enumerate(anchors):
            if not isinstance(anchor_obj, dict):
                raise AuditLogError(f"anchor {j} is not an object")
            for field in ("start", "end", "count", "anchor_hash"):
                if field not in anchor_obj:
                    raise AuditLogError(f"anchor {j} missing field '{field}'")
            start, end = anchor_obj["start"], anchor_obj["end"]
            if (isinstance(start, bool) or not isinstance(start, int)
                    or isinstance(end, bool) or not isinstance(end, int)):
                raise AuditLogError(f"anchor {j}: start/end must be integers")
            if start < 0 or start >= end:
                raise AuditLogError(f"anchor {j}: invalid range [{start}, {end})")
            if end > len(records):
                raise AuditLogError(
                    f"anchor {j}: range [{start}, {end}) out of bounds for {len(records)} records"
                )
            if anchor_obj["count"] != end - start:
                raise AuditLogError(f"anchor {j}: count does not match range")
            if not _is_hex64(anchor_obj["anchor_hash"]):
                raise AuditLogError(f"anchor {j}: anchor_hash is not 64-char hex")
            expected_root = merkle_root([r["record_hash"] for r in records[start:end]])
            if expected_root != anchor_obj["anchor_hash"]:
                raise AuditLogError(f"anchor {j}: anchor_hash does not match records")

        # --- signatures: shape, anchor references, history chain
        anchor_hashes = {a["anchor_hash"] for a in anchors}
        prev_sig = SIG_GENESIS_HASH
        for k, sig in enumerate(signatures):
            if not isinstance(sig, dict):
                raise AuditLogError(f"signature {k} is not an object")
            for field in ("index", "signer_id", "anchor_hash", "signature",
                          "prev_sig_hash", "sig_hash"):
                if field not in sig:
                    raise AuditLogError(f"signature {k} missing field '{field}'")
            if sig["index"] != k:
                raise AuditLogError(f"signature {k}: index mismatch (got {sig['index']})")
            if not _is_hex64(sig["anchor_hash"]) or not _is_hex64(sig["prev_sig_hash"]) \
                    or not _is_hex64(sig["sig_hash"]):
                raise AuditLogError(f"signature {k}: hash fields must be 64-char hex")
            if not isinstance(sig["signature"], str):
                raise AuditLogError(f"signature {k}: signature must be a hex string")
            try:
                bytes.fromhex(sig["signature"])
            except ValueError as exc:
                raise AuditLogError(f"signature {k}: signature is not valid hex") from exc
            if sig["anchor_hash"] not in anchor_hashes:
                raise AuditLogError(f"signature {k}: references unknown anchor")
            if sig["prev_sig_hash"] != prev_sig:
                raise AuditLogError(
                    f"signature {k}: prev_sig_hash mismatch (history tampered)"
                )
            expected_sig_hash = compute_sig_hash(
                sig["signer_id"], sig["anchor_hash"], sig["signature"], sig["prev_sig_hash"]
            )
            if expected_sig_hash != sig["sig_hash"]:
                raise AuditLogError(f"signature {k}: sig_hash mismatch (entry tampered)")
            prev_sig = sig["sig_hash"]

        log = cls()
        log._records = copy.deepcopy(records)
        log._by_id = {r["record_id"]: r["seq"] for r in records}
        log._anchors = copy.deepcopy(anchors)
        log._signatures = copy.deepcopy(signatures)
        log._log = copy.deepcopy(data["log"]) if isinstance(data["log"], list) else []
        log._op_counter = (
            data["op_counter"] if isinstance(data.get("op_counter"), int)
            else len(log._log)
        )
        log._signer_id = data.get("signer_id")
        # Restore the signer so verify_signature works right after load:
        # prefer the serialized spec (works across processes), then the
        # process-level registry (works when the signer was registered in
        # this process before the load). If neither matches, the log still
        # loads — get_state()["signer_registered"] is False and verify_
        # signature reports "signer unavailable", distinct from a bad
        # signature.
        spec = data.get("signer_spec")
        restored: Optional[Callable[[bytes], bytes]] = None
        if isinstance(spec, dict) and spec.get("type") in _SIGNER_FACTORIES:
            restored = _SIGNER_FACTORIES[spec["type"]](spec)
            log._signer_spec = copy.deepcopy(spec)
        elif isinstance(log._signer_id, str) and log._signer_id in _SIGNER_REGISTRY:
            restored = _SIGNER_REGISTRY[log._signer_id]
        if restored is not None:
            log._signer = restored
        log._log_op("load", path=path, record_count=len(records))
        return log
