"""Command-line entry point for the tamper-evident audit log kernel.

Reads one JSON command per line from stdin and writes one JSON result per
line to stdout. Errors are reported as {"ok": false, "error": "..."}.

Supported commands (the "op" field):
  append          {"op":"append","record_id":"r1","ts":1,"payload":{...},"seq":0?}
  verify          {"op":"verify","start":0?,"end":null?}
  prove           {"op":"prove","seq":N,"anchor":{...}?,"anchor_index":i?}
  verify_proof    {"op":"verify_proof","record":{...},"proof":{...},"anchor_hash":"..."}
  anchor          {"op":"anchor","start":A,"end":B}
  verify_anchor   {"op":"verify_anchor","anchor":{...}}  (or "anchor_index")
  register_signer {"op":"register_signer","signer_id":"s","key":"secret"?"}
  sign            {"op":"sign","anchor":{...}}  (or "anchor_index")
  verify_sig      {"op":"verify_sig","anchor":{...},"signature":{...}}
  verify_sigs     {"op":"verify_sigs"}
  get             {"op":"get","seq":N}  or  {"op":"get","record_id":"r1"}
  range           {"op":"range","start":A,"end":B}
  state           {"op":"state"}
  log             {"op":"log"}
  save            {"op":"save","path":"file.json"}
  load            {"op":"load","path":"file.json"}
  dump            {"op":"dump"}

The built-in CLI signer is HMAC-SHA256 keyed with the given "key"
(default: the signer_id itself) — deterministic and offline. The key is
stored in snapshots as a restorable signer spec, so "load" brings the
signer back and verify_sig works without re-registering (see
get_state()["signer_registered"]).

"range" never silently hides bad arguments: start < 0 or start > end is an
error; an end past the last record is truncated and the result carries the
effective range ("end", "requested_end", "truncated").
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Tuple

from audit_log import AuditLog, AuditLogError, make_hmac_signer


def _resolve_anchor(log: AuditLog, cmd: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve an anchor from a command: inline object or anchor_index."""
    if "anchor" in cmd:
        return cmd["anchor"]
    if "anchor_index" in cmd:
        anchors = log.get_anchors()
        idx = cmd["anchor_index"]
        if not isinstance(idx, int) or idx < 0 or idx >= len(anchors):
            raise AuditLogError(f"anchor_index {idx!r} out of range ({len(anchors)} anchors)")
        return anchors[idx]
    raise AuditLogError("command requires 'anchor' object or 'anchor_index'")


def handle_command(log: AuditLog, cmd: Dict[str, Any]) -> Tuple[AuditLog, Dict[str, Any]]:
    """Execute one command against ``log``.

    Returns (possibly-new-log, result-dict). The log is replaced only by
    the "load" command. Never raises for expected errors; they are returned
    as {"ok": False, "error": ...}.
    """
    if not isinstance(cmd, dict):
        return log, {"ok": False, "error": "command must be a JSON object"}
    op = cmd.get("op")
    if not isinstance(op, str):
        return log, {"ok": False, "error": "command missing string field 'op'"}

    try:
        if op == "append":
            record = cmd.get("record", cmd)
            stored = log.append(record)
            return log, {"ok": True, "record": stored}

        if op == "verify":
            result = log.verify_chain(cmd.get("start", 0), cmd.get("end"))
            return log, result

        if op == "prove":
            anchor = cmd.get("anchor")
            if anchor is None and "anchor_index" in cmd:
                anchor = _resolve_anchor(log, cmd)
            proof = log.prove(cmd.get("seq"), anchor=anchor)
            return log, {"ok": True, "proof": proof}

        if op == "verify_proof":
            for field in ("record", "proof", "anchor_hash"):
                if field not in cmd:
                    return log, {"ok": False, "error": f"verify_proof missing field '{field}'"}
            result = AuditLog.verify_proof(cmd["record"], cmd["proof"], cmd["anchor_hash"])
            return log, result

        if op == "anchor":
            anchor_obj = log.anchor(cmd.get("start"), cmd.get("end"))
            return log, {"ok": True, "anchor": anchor_obj}

        if op == "verify_anchor":
            result = log.verify_anchor(_resolve_anchor(log, cmd))
            return log, result

        if op == "register_signer":
            signer_id = cmd.get("signer_id")
            key = cmd.get("key", signer_id if isinstance(signer_id, str) else "")
            log.register_signer(
                signer_id,
                make_hmac_signer(key),
                spec={"type": "hmac-sha256", "key": key},
            )
            return log, {"ok": True, "signer_id": signer_id}

        if op == "sign":
            sig = log.sign_anchor(_resolve_anchor(log, cmd))
            return log, {"ok": True, "signature": sig}

        if op == "verify_sig":
            if "signature" not in cmd:
                return log, {"ok": False, "error": "verify_sig missing field 'signature'"}
            result = log.verify_signature(_resolve_anchor(log, cmd), cmd["signature"])
            return log, result

        if op == "verify_sigs":
            return log, log.verify_signatures()

        if op == "get":
            if "seq" in cmd:
                record = log.get_record(cmd["seq"])
            elif "record_id" in cmd:
                record = log.get_record_by_id(cmd["record_id"])
            else:
                return log, {"ok": False, "error": "get requires 'seq' or 'record_id'"}
            return log, {"ok": True, "record": record}

        if op == "range":
            result = log.range_records(cmd.get("start"), cmd.get("end"))
            result["ok"] = True
            return log, result

        if op == "state":
            return log, {"ok": True, "state": log.get_state()}

        if op == "log":
            entries = log.get_log()
            return log, {"ok": True, "log": entries, "count": len(entries)}

        if op == "save":
            if "path" not in cmd:
                return log, {"ok": False, "error": "save missing field 'path'"}
            return log, log.save(cmd["path"])

        if op == "load":
            if "path" not in cmd:
                return log, {"ok": False, "error": "load missing field 'path'"}
            new_log = AuditLog.load(cmd["path"])
            state = new_log.get_state()
            return new_log, {"ok": True, "path": cmd["path"], "state": state}

        if op == "dump":
            return log, {"ok": True, "snapshot": log.snapshot()}

        return log, {"ok": False, "error": f"unknown op: {op!r}"}

    except AuditLogError as exc:
        return log, {"ok": False, "error": str(exc)}
    except (TypeError, ValueError) as exc:
        return log, {"ok": False, "error": f"bad command arguments: {exc}"}


def main() -> None:
    """Line-oriented JSON command loop: stdin commands, stdout results."""
    log = AuditLog()
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as exc:
            result = {"ok": False, "error": f"invalid JSON command: {exc}"}
        else:
            log, result = handle_command(log, cmd)
        out.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
