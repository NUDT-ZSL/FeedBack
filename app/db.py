from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    length_units INTEGER NOT NULL CHECK(length_units > 0),
    topic TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY,
    from_material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    to_material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('citation','continuation','same_topic')),
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(from_material_id, to_material_id, kind),
    CHECK(from_material_id <> to_material_id)
);

CREATE TABLE IF NOT EXISTS reading_events (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('read','checkpoint','finish','note')),
    delta_units INTEGER NOT NULL DEFAULT 0 CHECK(delta_units >= 0),
    position INTEGER CHECK(position IS NULL OR position >= 0),
    note TEXT NOT NULL DEFAULT '',
    acted_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    excluded_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_material
    ON reading_events(material_id, acted_at, id);

CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    conflict_key TEXT NOT NULL UNIQUE,
    conflict_type TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence JSON NOT NULL,
    resolution TEXT NOT NULL DEFAULT '',
    rationale TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_conflicts_material ON conflicts(material_id);

CREATE TABLE IF NOT EXISTS material_states (
    material_id TEXT PRIMARY KEY REFERENCES materials(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('not_started','in_progress','digested','conflict')),
    progress_units INTEGER NOT NULL,
    progress_ratio REAL NOT NULL,
    basis_event_ids JSON NOT NULL,
    open_conflict_ids JSON NOT NULL,
    propagated_status TEXT NOT NULL DEFAULT '',
    propagated JSON NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);
"""


def connect(db_path: str | Path = "reading.db") -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.executescript(SCHEMA)
    return conn


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def seed_if_empty(conn: sqlite3.Connection) -> None:
    """Create a compact, immediately usable example set on a fresh database."""
    if conn.execute("SELECT COUNT(*) FROM materials").fetchone()[0]:
        return
    ts = "2026-09-20T09:00:00"
    materials = [
        ("m1", "如何做知识卡片", "《卡片笔记写作法》书摘", 120, "知识管理"),
        ("m2", "卡片盒实践复盘", "个人笔记", 100, "知识管理"),
        ("m3", "必要难度理论", "心理学论文", 80, "认知科学"),
        ("m4", "访谈方法提纲", "课程资料", 50, "研究方法"),
        ("m5", "编码手册示例", "同事分享", 60, "研究方法"),
    ]
    conn.executemany(
        "INSERT INTO materials VALUES (?,?,?,?,?,?,?)",
        [(i, t, s, length, topic, ts, ts) for i, t, s, length, topic in materials],
    )
    events = [
        ("e1", "m1", "read", 35, None, "第一章：原子化记录", "2026-09-20T09:10:00"),
        ("e2", "m1", "checkpoint", 0, 60, "读到卡片类型部分", "2026-09-20T09:30:00"),
        ("e3", "m2", "read", 45, None, "先补齐背景", "2026-09-20T10:00:00"),
        ("e4", "m2", "finish", 0, None, "已完成并写了复盘", "2026-09-20T10:40:00"),
        ("e5", "m3", "checkpoint", 0, 80, "精读完成", "2026-09-20T11:00:00"),
        ("e6", "m4", "read", 15, None, "读到抽样原则", "2026-09-20T11:20:00"),
        ("e7", "m4", "checkpoint", 0, 45, "修正书签：已到结论前", "2026-09-20T11:40:00"),
        ("e8", "m4", "checkpoint", 0, 30, "另一设备记录：实际只到编码小节", "2026-09-20T12:00:00"),
    ]
    conn.executemany(
        """INSERT INTO reading_events
           (id,material_id,kind,delta_units,position,note,acted_at,
            active,excluded_reason,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,'',?,?)""",
        [(eid, mid, kind, delta, pos, note, at, ts, ts)
         for eid, mid, kind, delta, pos, note, at in events],
    )
    relations = [
        ("r1", "m2", "m1", "continuation", "实践篇续接方法篇"),
        ("r2", "m1", "m3", "citation", "引用必要难度解释"),
    ]
    conn.executemany(
        "INSERT INTO relations VALUES (?,?,?,?,?,?)",
        [(rid, a, b, kind, label, ts) for rid, a, b, kind, label in relations],
    )
    conn.commit()
