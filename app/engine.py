from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import deque
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .db import dumps, now

STATUS_RANK = {"not_started": 0, "in_progress": 1, "digested": 2, "conflict": 3}


def _loads(raw: str, default):
    try:
        return json.loads(raw)
    except Exception:
        return default


def _conflict_id(key: str) -> str:
    return "cf_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def _active_events(conn: sqlite3.Connection, material_id: str) -> List[sqlite3.Row]:
    return list(conn.execute(
        """SELECT * FROM reading_events WHERE material_id=? AND active=1
           ORDER BY acted_at, id""",
        (material_id,),
    ))


def _conflicts_for_material(conn: sqlite3.Connection, material_id: str):
    return {
        row["conflict_key"]: row
        for row in conn.execute(
            "SELECT * FROM conflicts WHERE material_id=?", (material_id,)
        )
    }


def _regression(material, earlier, later, expected, claimed):
    key = "regression:{}:{}:{}".format(material["id"], earlier["id"], later["id"])
    return {
        "key": key,
        "type": "position_regression",
        "description": (
            f"较早记录已推进到 {expected}，但较晚记录声称位置为 {claimed}；"
            "两条进度互相矛盾。"
        ),
        "evidence": {
            "events": [earlier["id"], later["id"]],
            "earlier_event_id": earlier["id"],
            "later_event_id": later["id"],
            "expected_position": expected,
            "claimed_position": claimed,
            "length_units": material["length_units"],
        },
    }


def _overread(material, event, claimed, basis):
    key = "overread:{}:{}".format(material["id"], event["id"])
    return {
        "key": key,
        "type": "position_out_of_range",
        "description": (
            f"记录声称位置 {claimed}，超过素材篇幅 {material['length_units']}；"
            "可能是篇幅填错，也可能是误登记。"
        ),
        "evidence": {
            "events": [event["id"]],
            "event_id": event["id"],
            "basis_event_id": basis["id"] if basis else None,
            "claimed_position": claimed,
            "length_units": material["length_units"],
        },
    }


def _detect_conflicts(
    material: sqlite3.Row, events: Sequence[sqlite3.Row]
) -> List[dict]:
    """Detect incompatible progress claims while retaining every event."""
    length = int(material["length_units"])
    found: List[dict] = []
    cumulative_read = 0
    latest_claim: Optional[sqlite3.Row] = None
    latest_claim_pos = 0
    last_read: Optional[sqlite3.Row] = None

    def expected() -> Tuple[int, Optional[sqlite3.Row]]:
        if latest_claim is None or cumulative_read > latest_claim_pos:
            return cumulative_read, last_read
        return latest_claim_pos, latest_claim

    for event in events:
        kind = event["kind"]
        if kind == "read":
            before, basis = expected()
            cumulative_read += int(event["delta_units"])
            last_read = event
            after = max(cumulative_read, latest_claim_pos)
            if after > length and before < length and int(event["delta_units"]) > 0:
                found.append(_overread(material, event, after, basis))
        elif kind == "checkpoint":
            position = int(event["position"])
            expected_pos, basis = expected()
            if position > length:
                found.append(_overread(material, event, position, basis))
            elif basis is not None and position < expected_pos:
                found.append(_regression(material, basis, event, expected_pos, position))
            if position >= latest_claim_pos:
                latest_claim, latest_claim_pos = event, position
                # Later read deltas are measured forward from this checkpoint.
                cumulative_read = position
        elif kind == "finish":
            # A finish makes the full length an explicit claim. Earlier claims
            # cannot regress it; later contradictory claims form a pair with it.
            latest_claim, latest_claim_pos = event, length
    return found


def _evidence_changed(conn: sqlite3.Connection, conflict: sqlite3.Row,
                      material: sqlite3.Row) -> bool:
    resolved_at = conflict["resolved_at"]
    if not resolved_at:
        return False
    evidence = _loads(conflict["evidence"], {})
    if conflict["conflict_type"] == "position_out_of_range" and \
            int(evidence.get("length_units") or 0) != int(material["length_units"]):
        return True
    event_ids = evidence.get("events", [])
    if not event_ids:
        return False
    placeholders = ",".join("?" for _ in event_ids)
    row = conn.execute(
        f"SELECT MAX(updated_at) AS latest FROM reading_events WHERE id IN ({placeholders})",
        event_ids,
    ).fetchone()
    return bool(row["latest"] and row["latest"] > resolved_at)


def _reconcile_conflicts(
    conn: sqlite3.Connection, material: sqlite3.Row, generated: Sequence[dict]
) -> Set[str]:
    existing = _conflicts_for_material(conn, material["id"])
    generated_keys = {item["key"] for item in generated}
    stamp = now()

    for old in existing.values():
        if old["conflict_key"] not in generated_keys and not old["resolution"]:
            conn.execute("DELETE FROM conflicts WHERE id=?", (old["id"],))

    open_keys: Set[str] = set()
    for item in generated:
        old = existing.get(item["key"])
        payload = (item["description"], dumps(item["evidence"]))
        if old is None:
            conn.execute(
                """INSERT INTO conflicts
                   (id,material_id,conflict_key,conflict_type,description,evidence,
                    resolution,rationale,created_at,updated_at,resolved_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,'')""",
                # resolution and rationale are intentionally the empty strings
                # at placeholders 7 and 8; remaining timestamps are explicit.
                (_conflict_id(item["key"]), material["id"], item["key"],
                 item["type"], payload[0], payload[1], "", "", stamp, stamp),
            )
            open_keys.add(item["key"])
        elif old["resolution"] and _evidence_changed(conn, old, material):
            conn.execute(
                """UPDATE conflicts SET resolution='', rationale='',
                   resolved_at='', updated_at=?, description=?, evidence=?
                   WHERE id=?""",
                (stamp, payload[0], payload[1], old["id"]),
            )
            open_keys.add(item["key"])
        else:
            conn.execute(
                "UPDATE conflicts SET description=?, evidence=?, updated_at=? WHERE id=?",
                (payload[0], payload[1], stamp, old["id"]),
            )
            if not old["resolution"]:
                open_keys.add(item["key"])
    return open_keys


def _effective_events(conn: sqlite3.Connection, material_id: str):
    events = _active_events(conn, material_id)
    rows = list(conn.execute(
        """SELECT conflict_key, resolution, evidence FROM conflicts
           WHERE material_id=? AND resolution<>''""",
        (material_id,),
    ))
    excluded = set()
    for row in rows:
        if row["resolution"] == "reject_earlier":
            excluded.add(json.loads(row["evidence"]).get("earlier_event_id"))
        elif row["resolution"] == "reject_later":
            excluded.add(json.loads(row["evidence"]).get("later_event_id"))
        elif row["resolution"] == "reject_event":
            excluded.add(json.loads(row["evidence"]).get("event_id"))
    return [event for event in events if event["id"] not in excluded]


def recompute_material(conn: sqlite3.Connection, material_id: str) -> None:
    """Recompute one local conclusion; callers then propagate on the graph."""
    material = conn.execute(
        "SELECT * FROM materials WHERE id=?", (material_id,)
    ).fetchone()
    if material is None:
        conn.execute("DELETE FROM material_states WHERE material_id=?", (material_id,))
        return

    active_events = _active_events(conn, material_id)
    generated = _detect_conflicts(material, active_events)
    _reconcile_conflicts(conn, material, generated)
    open_rows = conn.execute(
        """SELECT id FROM conflicts WHERE material_id=?
           AND resolution='' ORDER BY id""",
        (material_id,),
    ).fetchall()
    open_ids = [row["id"] for row in open_rows]

    events = _effective_events(conn, material_id)
    length = int(material["length_units"])
    progress = 0
    progress_baseline = 0
    basis: List[str] = []
    for event in events:
        if event["kind"] == "read":
            progress = progress_baseline + int(event["delta_units"])
        elif event["kind"] == "checkpoint":
            position = int(event["position"])
            if position >= progress:
                progress = position
            progress_baseline = progress
        elif event["kind"] == "finish":
            progress = length
            progress_baseline = length
        if event["kind"] in ("read", "checkpoint", "finish"):
            basis.append(event["id"])
    progress = max(0, min(progress, length))
    status = (
        "conflict" if open_ids
        else "digested" if progress >= length
        else "in_progress" if progress > 0
        else "not_started"
    )
    conn.execute(
        """INSERT INTO material_states
           (material_id,status,progress_units,progress_ratio,basis_event_ids,
            open_conflict_ids,propagated_status,propagated,updated_at)
           VALUES (?,?,?,?,?,?,'','[]',?)
           ON CONFLICT(material_id) DO UPDATE SET
             status=excluded.status, progress_units=excluded.progress_units,
             progress_ratio=excluded.progress_ratio,
             basis_event_ids=excluded.basis_event_ids,
             open_conflict_ids=excluded.open_conflict_ids,
             propagated_status='', propagated='[]', updated_at=excluded.updated_at""",
        (material_id, status, progress,
         round(progress / length, 4) if length else 0.0,
         dumps(basis), dumps(open_ids), now()),
    )

def _build_graph(conn: sqlite3.Connection):
    graph: Dict[str, Dict[str, dict]] = {}

    def add(a: str, b: str, edge: dict):
        graph.setdefault(a, {}).setdefault(b, {"links": []})["links"].append(edge)

    for row in conn.execute("SELECT id,title FROM materials"):
        graph.setdefault(row["id"], {})

    relations = list(conn.execute(
        """SELECT r.id,r.from_material_id,r.to_material_id,r.kind,r.label
           FROM relations r JOIN materials a ON a.id=r.from_material_id
           JOIN materials b ON b.id=r.to_material_id"""
    ))
    for rel in relations:
        edge = {
            "relation_id": rel["id"],
            "kind": rel["kind"],
            "label": rel["label"],
            "from_material_id": rel["from_material_id"],
            "to_material_id": rel["to_material_id"],
        }
        add(rel["from_material_id"], rel["to_material_id"], dict(edge))
        reverse = dict(edge)
        reverse["reverse"] = True
        add(rel["to_material_id"], rel["from_material_id"], reverse)

    topics: Dict[str, List[sqlite3.Row]] = {}
    for row in conn.execute(
        "SELECT id,topic FROM materials WHERE TRIM(topic)<>''"
    ):
        topics.setdefault(row["topic"], []).append(row)
    for topic, rows in topics.items():
        rows = sorted(rows, key=lambda r: r["id"])
        edge = {"kind": "same_topic", "label": topic, "topic": topic}
        for i, a in enumerate(rows):
            for b in rows[i + 1:]:
                add(a["id"], b["id"], dict(edge))
                add(b["id"], a["id"], dict(edge))
    return graph


def _shortest_paths(graph: dict, roots: Iterable[str]):
    paths: Dict[str, List[dict]] = {}
    queue = deque()
    for root in roots:
        if root in graph and root not in paths:
            paths[root] = []
            queue.append(root)
    while queue:
        current = queue.popleft()
        for neighbor, payload in graph.get(current, {}).items():
            if neighbor in paths:
                continue
            # Parallel explicit/implicit links are equivalent for reachability.
            edge = sorted(payload["links"], key=lambda x: (
                0 if x["kind"] != "same_topic" else 1,
                x.get("relation_id", x.get("topic", ""))))[0]
            paths[neighbor] = paths[current] + [edge]
            queue.append(neighbor)
    return paths


def _update_propagation(conn: sqlite3.Connection, affected: Iterable[str]) -> None:
    graph = _build_graph(conn)
    materials = {
        row["id"]: row
        for row in conn.execute("SELECT id,title FROM materials")
    }
    states = {
        row["material_id"]: row
        for row in conn.execute("SELECT * FROM material_states")
    }
    stamp = now()
    for material_id in sorted(set(affected)):
        if material_id not in materials:
            continue
        paths = _shortest_paths(graph, [material_id])
        related = []
        best = ""
        best_rank = -1
        for other_id, path in paths.items():
            if other_id == material_id or not path:
                continue
            state = states.get(other_id)
            material = materials[other_id]
            status = state["status"] if state else "not_started"
            rank = STATUS_RANK.get(status, 0)
            if rank > best_rank:
                best, best_rank = status, rank
            related.append({
                "material_id": other_id,
                "title": material["title"],
                "status": status,
                "progress_ratio": state["progress_ratio"] if state else 0,
                "direct": len(path) == 1,
                "path": path,
            })
        related.sort(key=lambda item: (-STATUS_RANK[item["status"]],
                                       materials[item["material_id"]]["title"],
                                       item["material_id"]))
        conn.execute(
            """UPDATE material_states SET propagated_status=?, propagated=?,
               updated_at=? WHERE material_id=?""",
            (best, dumps(related), stamp, material_id),
        )


def recompute_affected(conn: sqlite3.Connection, seed_ids: Iterable[str],
                       extra_graph_seeds: Optional[Iterable[str]] = None) -> Set[str]:
    """Locally recompute seeds, then every material on affected graph chains."""
    seeds = {mid for mid in list(seed_ids) + list(extra_graph_seeds or [])
             if conn.execute("SELECT 1 FROM materials WHERE id=?", (mid,)).fetchone()}
    for material_id in seeds:
        recompute_material(conn, material_id)
    graph = _build_graph(conn)
    affected = set(_shortest_paths(graph, seeds))
    _update_propagation(conn, affected)
    return affected


def recompute_all(conn: sqlite3.Connection) -> None:
    """Reference implementation: derive every conclusion from raw records."""
    ids = [row["id"] for row in conn.execute("SELECT id FROM materials ORDER BY id")]
    for material_id in ids:
        recompute_material(conn, material_id)
    _update_propagation(conn, ids)
