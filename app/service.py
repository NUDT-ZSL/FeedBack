from __future__ import annotations

import sqlite3
from typing import Optional

from .db import new_id, now
from .engine import recompute_affected


EVENT_KINDS = {"read", "checkpoint", "finish", "note"}
RELATION_KINDS = {"citation", "continuation", "same_topic"}


class ServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _require(value, message: str):
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ServiceError(message)
    return value


def _int(value, field: str, minimum: Optional[int] = None) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ServiceError(f"{field} 必须是整数")
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise ServiceError(f"{field} 必须是整数")
    if minimum is not None and result < minimum:
        raise ServiceError(f"{field} 不能小于 {minimum}")
    return result


def _material(conn, material_id: str):
    row = conn.execute("SELECT * FROM materials WHERE id=?", (material_id,)).fetchone()
    if row is None:
        raise ServiceError("素材不存在", 404)
    return row


def _topic_peers(conn, topic: str, exclude: str = ""):
    topic = (topic or "").strip()
    if not topic:
        return []
    rows = conn.execute(
        "SELECT id FROM materials WHERE topic=? AND id<>? ORDER BY id",
        (topic, exclude),
    ).fetchall()
    return [row["id"] for row in rows]


def _snapshot(conn) -> dict:
    import json
    rejected_event_ids = set()
    for row in conn.execute(
        """SELECT evidence,resolution FROM conflicts
           WHERE resolution IN ('reject_earlier','reject_later','reject_event')"""
    ):
        evidence = json.loads(row["evidence"])
        field = {"reject_earlier": "earlier_event_id",
                 "reject_later": "later_event_id",
                 "reject_event": "event_id"}[row["resolution"]]
        if evidence.get(field):
            rejected_event_ids.add(evidence[field])
    materials = []
    for row in conn.execute(
        """SELECT m.*, s.status,s.progress_units,s.progress_ratio,s.basis_event_ids,
                  s.open_conflict_ids,s.propagated_status,s.propagated
           FROM materials m LEFT JOIN material_states s ON s.material_id=m.id
           ORDER BY m.created_at,m.id"""
    ):
        item = dict(row)
        import json
        for key in ("basis_event_ids", "open_conflict_ids", "propagated"):
            item[key] = json.loads(item[key] or "[]")
        materials.append(item)
    events = [dict(r) for r in conn.execute(
        """SELECT * FROM reading_events ORDER BY material_id, acted_at, id"""
    )]
    for event in events:
        event["rejected_by_conflict_id"] = ""
    relations = [dict(r) for r in conn.execute(
        "SELECT * FROM relations ORDER BY created_at,id"
    )]
    conflicts = [dict(r) for r in conn.execute(
        """SELECT * FROM conflicts ORDER BY
           CASE WHEN resolution='' THEN 0 ELSE 1 END, material_id,id"""
    )]
    for row in conflicts:
        row["evidence"] = json.loads(row["evidence"])
        field = {"reject_earlier": "earlier_event_id",
                 "reject_later": "later_event_id",
                 "reject_event": "event_id"}.get(row["resolution"])
        rejected_id = row["evidence"].get(field) if field else None
        if rejected_id in rejected_event_ids:
            for event in events:
                if event["id"] == rejected_id:
                    event["rejected_by_conflict_id"] = row["id"]
    return {"materials": materials, "events": events,
            "relations": relations, "conflicts": conflicts}


def get_state(conn) -> dict:
    return _snapshot(conn)


def create_material(conn, data: dict) -> dict:
    material_id = new_id("m")
    stamp = now()
    title = str(_require(data.get("title"), "标题不能为空")).strip()
    source = str(data.get("source", "")).strip()
    topic = str(data.get("topic", "")).strip()
    length_units = _int(data.get("length_units"), "篇幅", 1)
    conn.execute(
        "INSERT INTO materials VALUES (?,?,?,?,?,?,?)",
        (material_id, title, source, length_units, topic, stamp, stamp),
    )
    recompute_affected(conn, [material_id], _topic_peers(conn, topic))
    conn.commit()
    return _snapshot(conn)


def update_material(conn, material_id: str, data: dict) -> dict:
    old = _material(conn, material_id)
    title = str(data.get("title", old["title"])).strip()
    source = str(data.get("source", old["source"])).strip()
    topic = str(data.get("topic", old["topic"])).strip()
    length_units = _int(data.get("length_units", old["length_units"]), "篇幅", 1)
    old_peers = _topic_peers(conn, old["topic"], material_id)
    stamp = now()
    conn.execute(
        """UPDATE materials SET title=?,source=?,length_units=?,topic=?,
           updated_at=? WHERE id=?""",
        (title, source, length_units, topic, stamp, material_id),
    )
    new_peers = _topic_peers(conn, topic, material_id)
    recompute_affected(conn, [material_id], old_peers + new_peers)
    conn.commit()
    return _snapshot(conn)


def delete_material(conn, material_id: str) -> dict:
    material = _material(conn, material_id)
    peers = _topic_peers(conn, material["topic"], material_id)
    relations = conn.execute(
        "SELECT from_material_id,to_material_id FROM relations WHERE ? IN (from_material_id,to_material_id)",
        (material_id,),
    ).fetchall()
    relation_peers = [r["from_material_id"] if r["to_material_id"] == material_id
                      else r["to_material_id"] for r in relations]
    conn.execute("DELETE FROM materials WHERE id=?", (material_id,))
    # The removed material can no longer be reached; propagate through the old
    # neighbors so their visible related chains are refreshed.
    recompute_affected(conn, [], peers + relation_peers)
    conn.commit()
    return _snapshot(conn)


def _validate_event_payload(data: dict, existing: Optional[dict] = None) -> dict:
    kind = str(data.get("kind", existing["kind"] if existing else "")).strip()
    if kind not in EVENT_KINDS:
        raise ServiceError("动作类型必须是 read、checkpoint、finish 或 note")
    delta = _int(data.get("delta_units", existing["delta_units"] if existing else 0),
                 "累计推进量", 0)
    position_raw = data.get("position", existing["position"] if existing else None)
    position = None if position_raw in (None, "") else _int(position_raw, "阅读位置", 0)
    note = str(data.get("note", existing["note"] if existing else "")).strip()
    acted_at = str(data.get("acted_at",
                            existing["acted_at"] if existing else now())).strip()
    if not acted_at:
        raise ServiceError("动作时间不能为空")
    if kind == "read" and delta <= 0:
        raise ServiceError("阅读推进动作的推进量必须大于 0")
    if kind == "checkpoint" and position is None:
        raise ServiceError("阅读位置核对必须提供位置")
    if kind == "finish":
        delta, position = 0, None
    if kind == "note":
        delta, position = 0, None
    return {"kind": kind, "delta_units": delta, "position": position,
            "note": note, "acted_at": acted_at}


def _event_open_conflict(conn, event_id: str) -> bool:
    return _event_resolved_rejection(conn, event_id, open_only=True)


def _event_resolved_rejection(conn, event_id: str, open_only: bool = False) -> bool:
    where = "c.resolution=''" if open_only else \
        "c.resolution IN ('reject_earlier','reject_later','reject_event')"
    rows = conn.execute(
        """SELECT c.evidence,c.resolution FROM conflicts c
           WHERE """ + where + """ AND c.evidence LIKE ?""",
        (f'%"{event_id}"%',),
    ).fetchall()
    import json
    for row in rows:
        try:
            evidence = json.loads(row["evidence"])
            if open_only and event_id in evidence.get("events", []):
                return True
            if not open_only:
                rejected_id = {
                    "reject_earlier": evidence.get("earlier_event_id"),
                    "reject_later": evidence.get("later_event_id"),
                    "reject_event": evidence.get("event_id"),
                }.get(row["resolution"])
                if rejected_id == event_id:
                    return True
        except Exception:
            continue
    return False


def create_event(conn, material_id: str, data: dict) -> dict:
    _material(conn, material_id)
    payload = _validate_event_payload(data)
    event_id = new_id("e")
    stamp = now()
    conn.execute(
        """INSERT INTO reading_events
           (id,material_id,kind,delta_units,position,note,acted_at,
            active,excluded_reason,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,'',?,?)""",
        (event_id, material_id, payload["kind"], payload["delta_units"],
         payload["position"], payload["note"], payload["acted_at"], stamp, stamp),
    )
    recompute_affected(conn, [material_id])
    conn.commit()
    return _snapshot(conn)


def update_event(conn, event_id: str, data: dict) -> dict:
    row = conn.execute(
        "SELECT * FROM reading_events WHERE id=?", (event_id,)
    ).fetchone()
    if row is None:
        raise ServiceError("阅读动作不存在", 404)
    material_id = row["material_id"]
    if _event_open_conflict(conn, event_id):
        raise ServiceError("该动作参与未裁决冲突；请先裁决，或排除误登记记录。")
    payload = _validate_event_payload(data, row)
    conn.execute(
        """UPDATE reading_events SET kind=?,delta_units=?,position=?,note=?,
           acted_at=?,updated_at=? WHERE id=?""",
        (payload["kind"], payload["delta_units"], payload["position"],
         payload["note"], payload["acted_at"], now(), event_id),
    )
    recompute_affected(conn, [material_id])
    conn.commit()
    return _snapshot(conn)


def set_event_active(conn, event_id: str, active: bool, reason: str = "") -> dict:
    row = conn.execute(
        "SELECT * FROM reading_events WHERE id=?", (event_id,)
    ).fetchone()
    if row is None:
        raise ServiceError("阅读动作不存在", 404)
    if _event_open_conflict(conn, event_id):
        action = "重新启用" if active else "排除"
        raise ServiceError(f"{action}该动作前必须先在冲突中心裁决冲突并填写依据。")
    if active and _event_resolved_rejection(conn, event_id):
        raise ServiceError("该动作已被裁决否定；如确需恢复，请先重新打开冲突。")
    conn.execute(
        "UPDATE reading_events SET active=?,excluded_reason=?,updated_at=? WHERE id=?",
        (1 if active else 0, "" if active else str(reason).strip(), now(), event_id),
    )
    recompute_affected(conn, [row["material_id"]])
    conn.commit()
    return _snapshot(conn)


def create_relation(conn, data: dict) -> dict:
    from_id = str(_require(data.get("from_material_id"), "起点素材不能为空"))
    to_id = str(_require(data.get("to_material_id"), "关联素材不能为空"))
    kind = str(data.get("kind", "")).strip()
    if kind not in RELATION_KINDS:
        raise ServiceError("关系类型必须是 citation、continuation 或 same_topic")
    _material(conn, from_id)
    _material(conn, to_id)
    if from_id == to_id:
        raise ServiceError("素材不能关联自己；同主题请在主题字段中体现")
    relation_id = new_id("r")
    try:
        conn.execute(
            "INSERT INTO relations VALUES (?,?,?,?,?,?)",
            (relation_id, from_id, to_id, kind,
             str(data.get("label", "")).strip(), now()),
        )
    except sqlite3.IntegrityError:
        raise ServiceError("这两个素材之间已存在相同类型的关系")
    recompute_affected(conn, [from_id, to_id])
    conn.commit()
    return _snapshot(conn)


def delete_relation(conn, relation_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM relations WHERE id=?", (relation_id,)
    ).fetchone()
    if row is None:
        raise ServiceError("关系不存在", 404)
    conn.execute("DELETE FROM relations WHERE id=?", (relation_id,))
    recompute_affected(conn, [row["from_material_id"], row["to_material_id"]])
    conn.commit()
    return _snapshot(conn)


RESOLUTIONS = {
    "reject_earlier",
    "reject_later",
    "reject_event",
    "accept_claims",
    "ignore",
}


def resolve_conflict(conn, conflict_id: str, data: dict) -> dict:
    conflict = conn.execute(
        "SELECT * FROM conflicts WHERE id=?", (conflict_id,)
    ).fetchone()
    if conflict is None:
        raise ServiceError("冲突不存在", 404)
    resolution = str(data.get("resolution", "")).strip()
    rationale = str(data.get("rationale", "")).strip()
    if resolution not in RESOLUTIONS:
        raise ServiceError("裁决方式无效")
    if resolution == "reject_event" and conflict["conflict_type"] != "position_out_of_range":
        raise ServiceError("排除单条记录仅适用于越界冲突")
    if resolution in ("reject_earlier", "reject_later") and \
            conflict["conflict_type"] != "position_regression":
        raise ServiceError("否定较早/较晚记录仅适用于进度回退冲突")
    if resolution in ("reject_event", "reject_earlier", "reject_later") and not rationale:
        raise ServiceError("排除记录需要填写裁决依据")
    stamp = now()
    conn.execute(
        """UPDATE conflicts SET resolution=?, rationale=?, resolved_at=?,
           updated_at=? WHERE id=?""",
        (resolution, rationale, stamp, stamp, conflict_id),
    )
    recompute_affected(conn, [conflict["material_id"]])
    conn.commit()
    return _snapshot(conn)


def reopen_conflict(conn, conflict_id: str) -> dict:
    conflict = conn.execute(
        "SELECT * FROM conflicts WHERE id=?", (conflict_id,)
    ).fetchone()
    if conflict is None:
        raise ServiceError("冲突不存在", 404)
    conn.execute(
        """UPDATE conflicts SET resolution='', rationale='', resolved_at='',
           updated_at=? WHERE id=?""",
        (now(), conflict_id),
    )
    recompute_affected(conn, [conflict["material_id"]])
    conn.commit()
    return _snapshot(conn)


def next_actions(conn) -> list:
    """Return deterministic suggestions for the immediate reading queue."""
    state = _snapshot(conn)
    materials = {m["id"]: m for m in state["materials"]}
    visible_digested: dict = {}
    for material in state["materials"]:
        for related in material.get("propagated", []):
            if related["status"] == "digested":
                visible_digested.setdefault(material["id"], []).append(related)

    suggestions = []
    for m in state["materials"]:
        open_count = len(m.get("open_conflict_ids", []))
        if open_count:
            action = "先裁决冲突，再更新消化结论"
            priority = 0
        elif m["status"] == "in_progress":
            remaining = m["length_units"] - m["progress_units"]
            action = f"继续阅读，剩余约 {remaining} 个篇幅单位"
            priority = 1
        elif m["status"] == "not_started":
            action = "登记首次阅读动作或位置"
            priority = 2
        else:
            continue
        related = visible_digested.get(m["id"], [])
        suggestions.append({
            "material_id": m["id"],
            "title": m["title"],
            "status": m["status"],
            "priority": priority,
            "reason": action,
            "digested_relations": [
                {"material_id": r["material_id"], "title": r["title"]}
                for r in sorted(related, key=lambda x: x["title"])[:5]
            ],
        })
    suggestions.sort(key=lambda s: (
        s["priority"],
        -(materials[s["material_id"]]["length_units"] -
          materials[s["material_id"]]["progress_units"]),
        s["title"],
        s["material_id"],
    ))
    return suggestions
