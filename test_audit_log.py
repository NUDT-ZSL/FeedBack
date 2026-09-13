"""Unit tests for the tamper-evident audit log kernel (stdlib unittest)."""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import audit_log as audit_module
from audit_log import (
    GENESIS_HASH,
    SIG_GENESIS_HASH,
    AuditLog,
    AuditLogError,
    canonical_bytes,
    compute_record_hash,
    merkle_root,
)
import main as cli


def make_log(n: int, prefix: str = "r") -> AuditLog:
    """Build a log with n records (deterministic payloads, shuffled ts)."""
    log = AuditLog()
    for i in range(n):
        log.append({
            "record_id": f"{prefix}-{i}",
            "ts": (i * 37) % 13,  # deliberately non-monotonic logical time
            "payload": {"i": i, "kind": "test", "tags": ["a", i]},
        })
    return log


def hmac_signer(key: str = "test-key"):
    key_bytes = key.encode("utf-8")
    return lambda data: hmac.new(key_bytes, data, hashlib.sha256).digest()


# ---------------------------------------------------------------------------
# 1. Hash determinism
# ---------------------------------------------------------------------------

class TestHashDeterminism(unittest.TestCase):
    def test_same_record_same_hash_across_instances(self):
        a = make_log(5)
        b = make_log(5)
        recs_a = a.range_records(0, 5)["records"]
        recs_b = b.range_records(0, 5)["records"]
        for ra, rb in zip(recs_a, recs_b):
            self.assertEqual(ra["record_hash"], rb["record_hash"])

    def test_hash_matches_manual_computation(self):
        payload = {"x": [1, 2, {"y": "z"}], "n": None}
        expected_body = {
            "seq": 0, "record_id": "r0", "ts": 7,
            "payload": payload, "prev_hash": GENESIS_HASH,
        }
        expected = hashlib.sha256(canonical_bytes(expected_body)).hexdigest()
        self.assertEqual(
            compute_record_hash(0, "r0", 7, payload, GENESIS_HASH), expected
        )

    def test_canonical_serialization_key_order_independent(self):
        h1 = compute_record_hash(0, "r", 1, {"a": 1, "b": 2}, GENESIS_HASH)
        h2 = compute_record_hash(0, "r", 1, {"b": 2, "a": 1}, GENESIS_HASH)
        self.assertEqual(h1, h2)

    def test_genesis_hash_is_stable_constant(self):
        self.assertEqual(
            GENESIS_HASH, hashlib.sha256(b"AUDIT-LOG-GENESIS-V1").hexdigest()
        )

    def test_nan_payload_rejected(self):
        log = AuditLog()
        with self.assertRaises(AuditLogError):
            log.append({"record_id": "x", "ts": 1, "payload": float("nan")})

    def test_non_serializable_payload_rejected(self):
        log = AuditLog()
        with self.assertRaises(AuditLogError):
            log.append({"record_id": "x", "ts": 1, "payload": object()})


# ---------------------------------------------------------------------------
# 2. Append rules
# ---------------------------------------------------------------------------

class TestAppend(unittest.TestCase):
    def test_seq_auto_assigned_and_explicit_ok(self):
        log = AuditLog()
        r0 = log.append({"record_id": "a", "ts": 1, "payload": {}})
        self.assertEqual(r0["seq"], 0)
        r1 = log.append({"record_id": "b", "ts": 2, "payload": {}, "seq": 1})
        self.assertEqual(r1["seq"], 1)

    def test_seq_skip_rejected(self):
        log = make_log(2)
        with self.assertRaises(AuditLogError):
            log.append({"record_id": "c", "ts": 3, "payload": {}, "seq": 5})

    def test_duplicate_record_id_rejected(self):
        log = make_log(2)
        with self.assertRaises(AuditLogError):
            log.append({"record_id": "r-0", "ts": 9, "payload": {}})

    def test_empty_record_id_rejected(self):
        log = AuditLog()
        for bad in ("", None, 123):
            with self.assertRaises(AuditLogError):
                log.append({"record_id": bad, "ts": 1, "payload": {}})

    def test_bad_ts_rejected(self):
        log = AuditLog()
        for bad in ("1", 1.5, True, None):
            with self.assertRaises(AuditLogError):
                log.append({"record_id": "x", "ts": bad, "payload": {}})

    def test_first_record_prev_hash_is_genesis(self):
        log = make_log(1)
        self.assertEqual(log.get_record(0)["prev_hash"], GENESIS_HASH)

    def test_supplied_hashes_are_overwritten(self):
        log = AuditLog()
        rec = log.append({
            "record_id": "a", "ts": 1, "payload": {},
            "prev_hash": "0" * 64, "record_hash": "1" * 64,
        })
        self.assertEqual(rec["prev_hash"], GENESIS_HASH)
        self.assertNotEqual(rec["record_hash"], "1" * 64)


# ---------------------------------------------------------------------------
# 2. Chain verification and tamper detection
# ---------------------------------------------------------------------------

class TestVerifyChain(unittest.TestCase):
    def test_empty_chain_valid(self):
        result = AuditLog().verify_chain()
        self.assertTrue(result["ok"])
        self.assertEqual(result["checked"], 0)

    def test_single_record_valid(self):
        self.assertTrue(make_log(1).verify_chain()["ok"])

    def test_long_chain_valid(self):
        result = make_log(300).verify_chain()
        self.assertTrue(result["ok"])
        self.assertEqual(result["checked"], 300)

    def test_tampered_payload_detected(self):
        log = make_log(10)
        log._records[4]["payload"]["i"] = 999
        result = log.verify_chain()
        self.assertFalse(result["ok"])
        self.assertEqual(result["seq"], 4)
        self.assertIn("record_hash", result["reason"])

    def test_tampered_ts_detected(self):
        log = make_log(10)
        log._records[7]["ts"] = 123456
        result = log.verify_chain()
        self.assertFalse(result["ok"])
        self.assertEqual(result["seq"], 7)

    def test_tampered_prev_hash_detected(self):
        log = make_log(10)
        log._records[3]["prev_hash"] = "f" * 64
        result = log.verify_chain()
        self.assertFalse(result["ok"])
        self.assertEqual(result["seq"], 3)
        self.assertIn("prev_hash", result["reason"])

    def test_tampered_record_hash_detected_at_next_link(self):
        log = make_log(10)
        log._records[5]["record_hash"] = "e" * 64
        result = log.verify_chain()
        self.assertFalse(result["ok"])
        # record 5's content no longer matches its hash -> caught at 5 or 6
        self.assertIn(result["seq"], (5, 6))

    def test_subrange_verification(self):
        log = make_log(20)
        self.assertTrue(log.verify_chain(5, 15)["ok"])
        log._records[8]["payload"]["i"] = -1
        self.assertFalse(log.verify_chain(5, 15)["ok"])
        # tamper outside the verified subrange is not reported by it
        self.assertTrue(log.verify_chain(10, 15)["ok"])

    def test_invalid_range_reported(self):
        log = make_log(3)
        self.assertFalse(log.verify_chain(0, 10)["ok"])
        self.assertFalse(log.verify_chain(2, 1)["ok"])
        self.assertFalse(log.verify_chain(-1, 2)["ok"])


# ---------------------------------------------------------------------------
# 3. Inclusion proofs
# ---------------------------------------------------------------------------

class TestProofs(unittest.TestCase):
    def setUp(self):
        self.log = make_log(17)
        self.tip_root = merkle_root(
            [r["record_hash"] for r in self.log.range_records(0, 17)["records"]]
        )

    def test_proof_roundtrip_all_records(self):
        for seq in range(17):
            proof = self.log.prove(seq)
            record = self.log.get_record(seq)
            # has record_hash
            result = AuditLog.verify_proof(record, proof, self.tip_root)
            self.assertTrue(result["ok"], f"seq {seq}: {result['reason']}")

    def test_proof_length_is_logarithmic(self):
        log = make_log(300)
        proof = log.prove(150)
        self.assertLessEqual(len(proof["path"]), 9)  # ceil(log2(300)) = 9

    def test_single_record_proof_is_empty_path(self):
        log = make_log(1)
        proof = log.prove(0)
        self.assertEqual(proof["path"], [])
        record = log.get_record(0)
        self.assertTrue(
            AuditLog.verify_proof(record, proof, record["record_hash"])["ok"]
        )

    def test_empty_log_prove_raises(self):
        with self.assertRaises(AuditLogError):
            AuditLog().prove(0)

    def test_truncated_path_rejected(self):
        proof = self.log.prove(3)
        record = self.log.get_record(3)
        proof["path"] = proof["path"][:-1]
        result = AuditLog.verify_proof(record, proof, self.tip_root)
        self.assertFalse(result["ok"])
        self.assertIn("length", result["reason"])

    def test_reordered_path_rejected(self):
        proof = self.log.prove(3)
        record = self.log.get_record(3)
        proof["path"] = list(reversed(proof["path"]))
        result = AuditLog.verify_proof(record, proof, self.tip_root)
        self.assertFalse(result["ok"])

    def test_flipped_side_rejected(self):
        proof = self.log.prove(5)
        record = self.log.get_record(5)
        step = proof["path"][0]
        step["side"] = "right" if step["side"] == "left" else "left"
        result = AuditLog.verify_proof(record, proof, self.tip_root)
        self.assertFalse(result["ok"])

    def test_wrong_anchor_rejected(self):
        proof = self.log.prove(3)
        record = self.log.get_record(3)
        result = AuditLog.verify_proof(record, proof, "0" * 64)
        self.assertFalse(result["ok"])
        self.assertIn("root", result["reason"])

    def test_tampered_record_rejected(self):
        proof = self.log.prove(3)
        record = self.log.get_record(3)
        record["payload"]["i"] = 42  # content no longer matches record_hash
        result = AuditLog.verify_proof(record, proof, self.tip_root)
        self.assertFalse(result["ok"])

    def test_forged_record_with_recomputed_hash_rejected(self):
        # attacker recomputes a valid record_hash for forged content, but the
        # Merkle path no longer leads to the real root
        proof = self.log.prove(3)
        forged = self.log.get_record(3)
        forged["payload"] = {"forged": True}
        forged["record_hash"] = compute_record_hash(
            forged["seq"], forged["record_id"], forged["ts"],
            forged["payload"], forged["prev_hash"],
        )
        result = AuditLog.verify_proof(forged, proof, self.tip_root)
        self.assertFalse(result["ok"])

    def test_proof_without_record_hash_field_still_verifies(self):
        # verifier only needs content fields; record_hash is recomputed
        proof = self.log.prove(3)
        record = self.log.get_record(3)
        del record["record_hash"]
        self.assertTrue(AuditLog.verify_proof(record, proof, self.tip_root)["ok"])

    def test_proof_to_anchor(self):
        anchor = self.log.anchor(4, 12)
        proof = self.log.prove(7, anchor=anchor)
        record = self.log.get_record(7)
        result = AuditLog.verify_proof(record, proof, anchor["anchor_hash"])
        self.assertTrue(result["ok"], result["reason"])
        # and the same proof must NOT verify against the tip root
        self.assertFalse(AuditLog.verify_proof(record, proof, self.tip_root)["ok"])

    def test_prove_outside_anchor_range_raises(self):
        anchor = self.log.anchor(4, 12)
        with self.assertRaises(AuditLogError):
            self.log.prove(2, anchor=anchor)


# ---------------------------------------------------------------------------
# 4. Anchors
# ---------------------------------------------------------------------------

class TestAnchors(unittest.TestCase):
    def test_anchor_roundtrip(self):
        log = make_log(20)
        anchor = log.anchor(0, 20)
        self.assertEqual(anchor["count"], 20)
        self.assertTrue(log.verify_anchor(anchor)["ok"])
        sub = log.anchor(3, 9)
        self.assertEqual(sub["count"], 6)
        self.assertTrue(log.verify_anchor(sub)["ok"])

    def test_anchor_single_record(self):
        log = make_log(1)
        anchor = log.anchor(0, 1)
        self.assertEqual(anchor["anchor_hash"], log.get_record(0)["record_hash"])
        self.assertTrue(log.verify_anchor(anchor)["ok"])

    def test_anchor_invalid_ranges(self):
        log = make_log(5)
        for start, end in ((2, 2), (4, 3), (-1, 3), (0, 6), (0, 0)):
            with self.assertRaises(AuditLogError, msg=f"[{start},{end})"):
                log.anchor(start, end)

    def test_verify_anchor_out_of_bounds(self):
        log = make_log(5)
        result = log.verify_anchor({"start": 0, "end": 9, "count": 9, "anchor_hash": "0" * 64})
        self.assertFalse(result["ok"])
        self.assertIn("bounds", result["reason"])

    def test_verify_anchor_start_ge_end(self):
        log = make_log(5)
        result = log.verify_anchor({"start": 3, "end": 3, "count": 0, "anchor_hash": "0" * 64})
        self.assertFalse(result["ok"])

    def test_anchor_detects_tampered_chain(self):
        log = make_log(10)
        anchor = log.anchor(0, 10)
        log._records[2]["payload"]["i"] = -5
        result = log.verify_anchor(anchor)
        self.assertFalse(result["ok"])

    def test_anchor_detects_tampered_anchor_hash(self):
        log = make_log(10)
        anchor = log.anchor(0, 10)
        anchor["anchor_hash"] = "a" * 64
        self.assertFalse(log.verify_anchor(anchor)["ok"])

    def test_anchor_membership_via_proof(self):
        # light client: holds ONLY the anchor, verifies one record + proof
        log = make_log(50)
        anchor = log.anchor(10, 40)
        proof = log.prove(25, anchor=anchor)
        record = log.get_record(25)
        self.assertTrue(
            AuditLog.verify_proof(record, proof, anchor["anchor_hash"])["ok"]
        )
        # a record outside the anchor range cannot be proven against it
        other = log.get_record(45)
        self.assertFalse(
            AuditLog.verify_proof(other, proof, anchor["anchor_hash"])["ok"]
        )


# ---------------------------------------------------------------------------
# 5. Signature chain
# ---------------------------------------------------------------------------

class TestSignatures(unittest.TestCase):
    def setUp(self):
        self.log = make_log(10)
        self.anchor = self.log.anchor(0, 10)

    def test_sign_without_signer_raises(self):
        with self.assertRaises(AuditLogError):
            self.log.sign_anchor(self.anchor)

    def test_verify_sig_without_signer_returns_false(self):
        log2 = make_log(10)
        log2.register_signer("s", hmac_signer())
        anchor2 = log2.anchor(0, 10)
        sig = log2.sign_anchor(anchor2)
        result = self.log.verify_signature(anchor2, sig)  # self.log has no signer
        self.assertFalse(result["ok"])
        self.assertIn("no signer", result["reason"])

    def test_sign_and_verify_roundtrip(self):
        self.log.register_signer("s1", hmac_signer())
        sig = self.log.sign_anchor(self.anchor)
        self.assertEqual(sig["prev_sig_hash"], SIG_GENESIS_HASH)
        result = self.log.verify_signature(self.anchor, sig)
        self.assertTrue(result["ok"], result["reason"])

    def test_signature_history_chains(self):
        self.log.register_signer("s1", hmac_signer())
        a1 = self.log.anchor(0, 5)
        a2 = self.log.anchor(5, 10)
        s1 = self.log.sign_anchor(a1)
        s2 = self.log.sign_anchor(a2)
        self.assertEqual(s2["prev_sig_hash"], s1["sig_hash"])
        self.assertTrue(self.log.verify_signatures()["ok"])

    def test_wrong_anchor_hash_rejected(self):
        self.log.register_signer("s1", hmac_signer())
        sig = self.log.sign_anchor(self.anchor)
        other = self.log.anchor(2, 8)
        result = self.log.verify_signature(other, sig)
        self.assertFalse(result["ok"])
        self.assertIn("anchor hash mismatch", result["reason"])

    def test_wrong_signature_length_rejected(self):
        self.log.register_signer("s1", hmac_signer())
        sig = self.log.sign_anchor(self.anchor)
        sig["signature"] = sig["signature"][:-4]  # truncate
        result = self.log.verify_signature(self.anchor, sig)
        self.assertFalse(result["ok"])
        self.assertIn("length", result["reason"])

    def test_wrong_signature_bytes_rejected(self):
        self.log.register_signer("s1", hmac_signer("key-a"))
        sig = self.log.sign_anchor(self.anchor)
        self.log.register_signer("s1", hmac_signer("key-b"))  # different key
        result = self.log.verify_signature(self.anchor, sig)
        self.assertFalse(result["ok"])
        self.assertIn("mismatch", result["reason"])

    def test_tampered_history_detected(self):
        self.log.register_signer("s1", hmac_signer())
        a1 = self.log.anchor(0, 5)
        a2 = self.log.anchor(5, 10)
        self.log.sign_anchor(a1)
        self.log.sign_anchor(a2)
        self.log._signatures[1]["prev_sig_hash"] = "0" * 64
        result = self.log.verify_signatures()
        self.assertFalse(result["ok"])
        self.assertEqual(result["index"], 1)

    def test_tampered_sig_hash_detected(self):
        self.log.register_signer("s1", hmac_signer())
        sig = self.log.sign_anchor(self.anchor)
        sig["sig_hash"] = "0" * 64
        result = self.log.verify_signature(self.anchor, sig)
        self.assertFalse(result["ok"])
        self.assertIn("sig_hash", result["reason"])

    def test_sign_invalid_anchor_raises(self):
        self.log.register_signer("s1", hmac_signer())
        with self.assertRaises(AuditLogError):
            self.log.sign_anchor({"start": 0, "end": 99, "count": 99, "anchor_hash": "0" * 64})


# ---------------------------------------------------------------------------
# 5b. Signer restoration across save/load
# ---------------------------------------------------------------------------

class TestSignerRestore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "snap.json")

    def tearDown(self):
        self.tmp.cleanup()
        # keep the process-level registry clean for other tests
        for signer_id in ("restore-s1", "restore-s2", "restore-spec"):
            audit_module._SIGNER_REGISTRY.pop(signer_id, None)

    def _signed_snapshot(self, signer_id="restore-s1", key="k1", spec=None):
        log = make_log(6)
        log.register_signer(signer_id, hmac_signer(key), spec=spec)
        anchor = log.anchor(0, 6)
        sig = log.sign_anchor(anchor)
        log.save(self.path)
        return anchor, sig

    def test_load_restores_signer_via_registry(self):
        # same process, signer registered before save -> load restores it
        anchor, sig = self._signed_snapshot()
        loaded = AuditLog.load(self.path)
        self.assertTrue(loaded.get_state()["signer_registered"])
        self.assertEqual(loaded.get_state()["signer_id"], "restore-s1")
        result = loaded.verify_signature(anchor, sig)
        self.assertTrue(result["ok"], result["reason"])
        self.assertTrue(loaded.verify_signatures()["ok"])

    def test_load_restores_signer_via_spec_without_registry(self):
        # simulate a fresh process: spec is in the snapshot but the
        # process-level registry does not know the signer_id
        anchor, sig = self._signed_snapshot(
            signer_id="restore-spec", key="kk",
            spec={"type": "hmac-sha256", "key": "kk"},
        )
        audit_module._SIGNER_REGISTRY.pop("restore-spec", None)
        loaded = AuditLog.load(self.path)
        self.assertTrue(loaded.get_state()["signer_registered"])
        result = loaded.verify_signature(anchor, sig)
        self.assertTrue(result["ok"], result["reason"])

    def test_mismatched_signer_id_reported_as_mismatch_not_bad_signature(self):
        anchor, sig = self._signed_snapshot()
        loaded = AuditLog.load(self.path)
        loaded.register_signer("restore-s2", hmac_signer("k2"))
        result = loaded.verify_signature(anchor, sig)
        self.assertFalse(result["ok"])
        self.assertIn("signer_id mismatch", result["reason"])
        self.assertNotIn("signature mismatch", result["reason"])

    def test_unrestorable_signer_reported_as_unavailable(self):
        anchor, sig = self._signed_snapshot()
        # rewrite the snapshot so its signer_id matches nothing restorable
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        data["signer_id"] = "ghost-signer"
        data["signer_spec"] = None
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        loaded = AuditLog.load(self.path)
        self.assertFalse(loaded.get_state()["signer_registered"])
        self.assertEqual(loaded.get_state()["signer_id"], "ghost-signer")
        result = loaded.verify_signature(anchor, sig)
        self.assertFalse(result["ok"])
        self.assertIn("signer unavailable", result["reason"])
        self.assertNotIn("signature mismatch", result["reason"])

    def test_tampered_signature_still_reported_as_content_tampered(self):
        anchor, sig = self._signed_snapshot()
        loaded = AuditLog.load(self.path)  # signer restored
        sig["signature"] = ("0" if sig["signature"][0] != "0" else "1") + sig["signature"][1:]
        result = loaded.verify_signature(anchor, sig)
        self.assertFalse(result["ok"])
        self.assertIn("signature mismatch", result["reason"])


# ---------------------------------------------------------------------------
# 6. Queries and state
# ---------------------------------------------------------------------------

class TestQueries(unittest.TestCase):
    def test_get_record(self):
        log = make_log(5)
        self.assertEqual(log.get_record(2)["record_id"], "r-2")
        self.assertIsNone(log.get_record(5))
        self.assertIsNone(log.get_record(-1))
        self.assertIsNone(log.get_record("2"))

    def test_get_record_by_id(self):
        log = make_log(5)
        self.assertEqual(log.get_record_by_id("r-3")["seq"], 3)
        self.assertIsNone(log.get_record_by_id("nope"))

    def test_range_records(self):
        log = make_log(10)
        result = log.range_records(3, 7)
        self.assertEqual([r["seq"] for r in result["records"]], [3, 4, 5, 6])
        self.assertEqual(result["start"], 3)
        self.assertEqual(result["end"], 7)
        self.assertFalse(result["truncated"])
        self.assertEqual(result["count"], 4)

    def test_range_records_empty_is_legal(self):
        log = make_log(10)
        result = log.range_records(4, 4)
        self.assertEqual(result["records"], [])
        self.assertEqual(result["count"], 0)
        self.assertFalse(result["truncated"])

    def test_range_records_negative_start_rejected(self):
        log = make_log(10)
        with self.assertRaises(AuditLogError) as ctx:
            log.range_records(-1, 5)
        self.assertIn(">= 0", str(ctx.exception))

    def test_range_records_start_after_end_rejected(self):
        log = make_log(10)
        with self.assertRaises(AuditLogError) as ctx:
            log.range_records(7, 5)
        self.assertIn("start 7 > end 5", str(ctx.exception))

    def test_range_records_end_beyond_tip_is_truncated_and_reported(self):
        log = make_log(10)
        result = log.range_records(8, 100)
        self.assertEqual([r["seq"] for r in result["records"]], [8, 9])
        self.assertEqual(result["end"], 10)            # effective end
        self.assertEqual(result["requested_end"], 100)  # what was asked
        self.assertTrue(result["truncated"])

    def test_range_records_non_integer_rejected(self):
        log = make_log(10)
        for bad in ("0", 1.5, True, None):
            with self.assertRaises(AuditLogError):
                log.range_records(bad, 5)
            with self.assertRaises(AuditLogError):
                log.range_records(0, bad)

    def test_prove_out_of_range_raises_like_range_records(self):
        # prove and range_records share the same contract: illegal
        # coordinates are loud errors, never silent empty results
        log = make_log(10)
        for bad_seq in (-1, 10, 100):
            with self.assertRaises(AuditLogError, msg=f"seq={bad_seq}"):
                log.prove(bad_seq)
        with self.assertRaises(AuditLogError):
            log.prove("3")
        with self.assertRaises(AuditLogError):
            AuditLog().prove(0)

    def test_get_state(self):
        log = make_log(4)
        log.register_signer("s", hmac_signer())
        anchor = log.anchor(0, 4)
        log.sign_anchor(anchor)
        state = log.get_state()
        self.assertEqual(state["record_count"], 4)
        self.assertEqual(state["latest_seq"], 3)
        self.assertEqual(state["latest_record_hash"], log.get_record(3)["record_hash"])
        self.assertEqual(state["anchor_count"], 1)
        self.assertEqual(state["signature_count"], 1)
        self.assertTrue(state["chain_valid"])
        self.assertTrue(state["signer_registered"])

    def test_get_state_empty(self):
        state = AuditLog().get_state()
        self.assertEqual(state["record_count"], 0)
        self.assertEqual(state["latest_seq"], -1)
        self.assertIsNone(state["latest_record_hash"])
        self.assertTrue(state["chain_valid"])
        self.assertFalse(state["signer_registered"])

    def test_get_log_order(self):
        log = make_log(3)
        log.register_signer("s", hmac_signer())
        anchor = log.anchor(0, 3)
        log.sign_anchor(anchor)
        ops = [e["op"] for e in log.get_log()]
        self.assertEqual(
            ops,
            ["append", "append", "append", "register_signer", "anchor", "sign"],
        )
        indices = [e["op_index"] for e in log.get_log()]
        self.assertEqual(indices, list(range(len(indices))))


# ---------------------------------------------------------------------------
# 7. Persistence
# ---------------------------------------------------------------------------

class TestPersistence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "snapshot.json")

    def tearDown(self):
        self.tmp.cleanup()

    def _build_full_log(self) -> AuditLog:
        log = make_log(30)
        log.register_signer("s1", hmac_signer())
        a1 = log.anchor(0, 15)
        a2 = log.anchor(15, 30)
        log.sign_anchor(a1)
        log.sign_anchor(a2)
        return log

    def test_save_load_roundtrip(self):
        log = self._build_full_log()
        log.save(self.path)
        loaded = AuditLog.load(self.path)
        self.assertTrue(loaded.verify_chain()["ok"])
        self.assertTrue(loaded.verify_signatures()["ok"])
        self.assertEqual(loaded.get_state()["record_count"], 30)
        self.assertEqual(loaded.get_state()["anchor_count"], 2)
        self.assertEqual(loaded.get_state()["signature_count"], 2)
        self.assertEqual(
            loaded.get_record(7)["record_hash"], log.get_record(7)["record_hash"]
        )
        # proofs still verify after the roundtrip
        anchor = loaded.get_anchors()[0]
        proof = loaded.prove(3, anchor=anchor)
        self.assertTrue(
            AuditLog.verify_proof(loaded.get_record(3), proof, anchor["anchor_hash"])["ok"]
        )

    def test_load_missing_file(self):
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(os.path.join(self.tmp.name, "nope.json"))
        self.assertIn("cannot read", str(ctx.exception))

    def test_load_corrupt_json(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write('{"version": 1, "records": [')
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_load_missing_field(self):
        log = make_log(3)
        log.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        del data["records"]
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("missing field 'records'", str(ctx.exception))

    def _save_then_corrupt(self, mutate):
        log = self._build_full_log()
        log.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        mutate(data)
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def test_load_detects_seq_gap(self):
        def mutate(data):
            data["records"][5]["seq"] = 6
        self._save_then_corrupt(mutate)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("seq", str(ctx.exception))

    def test_load_detects_duplicate_record_id(self):
        def mutate(data):
            data["records"][4]["record_id"] = data["records"][3]["record_id"]
            data["records"][4]["record_hash"] = compute_record_hash(
                4, data["records"][4]["record_id"], data["records"][4]["ts"],
                data["records"][4]["payload"], data["records"][4]["prev_hash"],
            )
        self._save_then_corrupt(mutate)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("duplicate record_id", str(ctx.exception))

    def test_load_detects_tampered_record_hash(self):
        def mutate(data):
            data["records"][2]["payload"]["i"] = 777
        self._save_then_corrupt(mutate)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("record_hash", str(ctx.exception))

    def test_load_detects_broken_prev_hash(self):
        def mutate(data):
            data["records"][6]["prev_hash"] = "0" * 64
            data["records"][6]["record_hash"] = compute_record_hash(
                6, data["records"][6]["record_id"], data["records"][6]["ts"],
                data["records"][6]["payload"], "0" * 64,
            )
        self._save_then_corrupt(mutate)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("prev_hash", str(ctx.exception))

    def test_load_detects_bad_anchor_range(self):
        def mutate(data):
            data["anchors"][0]["end"] = 1000
        self._save_then_corrupt(mutate)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("anchor", str(ctx.exception))

    def test_load_detects_tampered_anchor_hash(self):
        def mutate(data):
            data["anchors"][0]["anchor_hash"] = "b" * 64
            data["signatures"] = []  # avoid the unknown-anchor error masking it
        self._save_then_corrupt(mutate)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("anchor_hash", str(ctx.exception))

    def test_load_detects_signature_with_unknown_anchor(self):
        def mutate(data):
            data["signatures"][0]["anchor_hash"] = "c" * 64
            data["signatures"][0]["sig_hash"] = "d" * 64
            data["signatures"][1]["prev_sig_hash"] = "d" * 64
            data["signatures"][1]["sig_hash"] = "e" * 64
        self._save_then_corrupt(mutate)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("unknown anchor", str(ctx.exception))

    def test_load_detects_tampered_signature_history(self):
        def mutate(data):
            data["signatures"][1]["prev_sig_hash"] = "0" * 64
        self._save_then_corrupt(mutate)
        with self.assertRaises(AuditLogError) as ctx:
            AuditLog.load(self.path)
        self.assertIn("prev_sig_hash", str(ctx.exception))

    def test_save_unwritable_path(self):
        log = make_log(1)
        with self.assertRaises(AuditLogError):
            log.save(os.path.join(self.tmp.name, "no-such-dir", "x.json"))


# ---------------------------------------------------------------------------
# 8. CLI
# ---------------------------------------------------------------------------

class TestCli(unittest.TestCase):
    def run_cli(self, commands):
        """Feed command dicts through main() and parse the output lines."""
        stdin_text = "\n".join(json.dumps(c) for c in commands) + "\n"
        stdout = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO(stdin_text)), \
             mock.patch("sys.stdout", stdout):
            cli.main()
        return [json.loads(line) for line in stdout.getvalue().splitlines()]

    def test_append_and_state_flow(self):
        results = self.run_cli([
            {"op": "append", "record_id": "a", "ts": 1, "payload": {"v": 1}},
            {"op": "append", "record_id": "b", "ts": 2, "payload": {"v": 2}},
            {"op": "state"},
        ])
        self.assertTrue(results[0]["ok"])
        self.assertEqual(results[0]["record"]["seq"], 0)
        self.assertTrue(results[2]["ok"])
        self.assertEqual(results[2]["state"]["record_count"], 2)
        self.assertTrue(results[2]["state"]["chain_valid"])

    def test_error_results_have_error_field(self):
        results = self.run_cli([
            {"op": "append", "record_id": "a", "ts": 1, "payload": {}},
            {"op": "append", "record_id": "b", "ts": 2, "payload": {}, "seq": 5},
            {"op": "append", "record_id": "a", "ts": 3, "payload": {}},
            {"op": "nosuchop"},
            {"op": "anchor", "start": 0, "end": 0},
            {"op": "sign", "anchor_index": 0},
        ])
        self.assertTrue(results[0]["ok"])  # baseline append succeeds
        for res in results[1:]:
            self.assertFalse(res["ok"])
            self.assertIn("error", res)

    def test_invalid_json_line(self):
        stdout = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO("{not json\n")), \
             mock.patch("sys.stdout", stdout):
            cli.main()
        result = json.loads(stdout.getvalue())
        self.assertFalse(result["ok"])
        self.assertIn("error", result)

    def test_full_cli_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "snap.json")
            commands = [
                *[{"op": "append", "record_id": f"r{i}", "ts": i, "payload": {"i": i}}
                  for i in range(10)],
                {"op": "verify"},
                {"op": "anchor", "start": 0, "end": 10},
                {"op": "register_signer", "signer_id": "cli", "key": "k"},
                {"op": "sign", "anchor_index": 0},
                {"op": "verify_sigs"},
                {"op": "prove", "seq": 4, "anchor_index": 0},
                {"op": "get", "record_id": "r4"},
                {"op": "range", "start": 2, "end": 5},
                {"op": "save", "path": path},
                {"op": "load", "path": path},
                {"op": "state"},
                {"op": "dump"},
            ]
            results = self.run_cli(commands)
            self.assertTrue(all(r["ok"] for r in results), results)
            # indices: 0-9 append, 10 verify, 11 anchor, 12 register_signer,
            # 13 sign, 14 verify_sigs, 15 prove, 16 get, 17 range, 18 save,
            # 19 load, 20 state, 21 dump
            self.assertTrue(results[10]["ok"])                       # verify
            anchor = results[11]["anchor"]
            proof = results[15]["proof"]
            record = results[16]["record"]
            self.assertEqual(results[17]["count"], 3)                # range
            self.assertEqual(results[17]["end"], 5)
            self.assertFalse(results[17]["truncated"])
            self.assertEqual(results[20]["state"]["record_count"], 10)  # after load
            # load restored the signer from the snapshot's signer spec
            self.assertTrue(results[20]["state"]["signer_registered"])
            # cross-check proof against anchor, offline
            check = AuditLog.verify_proof(record, proof, anchor["anchor_hash"])
            self.assertTrue(check["ok"], check["reason"])
            # a brand-new CLI session: load restores the signer from the
            # snapshot spec, so verify_sig works WITHOUT re-registering
            sig = results[13]["signature"]
            results2 = self.run_cli([
                {"op": "load", "path": path},
                {"op": "verify_sig", "anchor": anchor, "signature": sig},
            ])
            self.assertTrue(results2[0]["state"]["signer_registered"])
            self.assertTrue(results2[1]["ok"], results2[1])

    def test_cli_range_truncation_and_errors(self):
        results = self.run_cli([
            *[{"op": "append", "record_id": f"r{i}", "ts": i, "payload": {}}
              for i in range(4)],
            {"op": "range", "start": 1, "end": 100},
            {"op": "range", "start": -1, "end": 2},
            {"op": "range", "start": 3, "end": 2},
        ])
        truncated = results[4]
        self.assertTrue(truncated["ok"])
        self.assertEqual(truncated["end"], 4)
        self.assertEqual(truncated["requested_end"], 100)
        self.assertTrue(truncated["truncated"])
        self.assertEqual([r["seq"] for r in truncated["records"]], [1, 2, 3])
        for res in results[5:]:
            self.assertFalse(res["ok"])
            self.assertIn("error", res)

    def test_handle_command_load_replaces_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            log = make_log(3)
            log.save(path)
            fresh = AuditLog()
            new_log, result = cli.handle_command(fresh, {"op": "load", "path": path})
            self.assertTrue(result["ok"])
            self.assertEqual(new_log.get_state()["record_count"], 3)
            self.assertEqual(fresh.get_state()["record_count"], 0)


# ---------------------------------------------------------------------------
# Scale sanity: a few hundred records end to end
# ---------------------------------------------------------------------------

class TestScale(unittest.TestCase):
    def test_five_hundred_records(self):
        log = make_log(500)
        self.assertTrue(log.verify_chain()["ok"])
        anchor = log.anchor(0, 500)
        self.assertTrue(log.verify_anchor(anchor)["ok"])
        for seq in (0, 1, 250, 499):
            proof = log.prove(seq, anchor=anchor)
            self.assertLessEqual(len(proof["path"]), 9)
            self.assertTrue(
                AuditLog.verify_proof(
                    log.get_record(seq), proof, anchor["anchor_hash"]
                )["ok"]
            )
        log.register_signer("scale", hmac_signer())
        sig = log.sign_anchor(anchor)
        self.assertTrue(log.verify_signature(anchor, sig)["ok"])
        self.assertTrue(log.verify_signatures()["ok"])


if __name__ == "__main__":
    unittest.main()
