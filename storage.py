"""SQLite-backed state store for uploads, chunks, conversion outputs and events."""
import os
import sqlite3
import threading
import time

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
DB_PATH = os.path.join(DATA_DIR, "app.db")

_local = threading.local()


def conn():
    c = getattr(_local, "c", None)
    if c is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        _local.c = c
    return c


SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads(
  id TEXT PRIMARY KEY,
  client_key TEXT,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading',
  bytes_written INTEGER NOT NULL DEFAULT 0,
  convert_done INTEGER NOT NULL DEFAULT 0,
  convert_total INTEGER NOT NULL DEFAULT 0,
  result_path TEXT,
  error TEXT,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks(
  upload_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  received_at REAL NOT NULL,
  PRIMARY KEY(upload_id, idx)
);
CREATE TABLE IF NOT EXISTS chunk_outputs(
  upload_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY(upload_id, idx)
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id TEXT NOT NULL,
  ts REAL NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL
);
"""


def init():
    c = conn()
    c.executescript(SCHEMA)
    c.commit()


def log_event(upload_id, type_, message):
    c = conn()
    c.execute("INSERT INTO events(upload_id,ts,type,message) VALUES(?,?,?,?)",
              (upload_id, time.time(), type_, message))
    c.commit()


def get_upload(upload_id):
    return conn().execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()


def find_by_client_key(client_key):
    return conn().execute(
        "SELECT * FROM uploads WHERE client_key=? ORDER BY created_at DESC LIMIT 1",
        (client_key,)).fetchone()


def set_status(upload_id, status, error=None):
    conn().execute("UPDATE uploads SET status=?, error=? WHERE id=?",
                   (status, error, upload_id))
    conn().commit()


def received_indexes(upload_id):
    rows = conn().execute(
        "SELECT idx FROM chunks WHERE upload_id=? ORDER BY idx", (upload_id,)).fetchall()
    return [r["idx"] for r in rows]


def record_chunk(upload_id, idx, size, sha256):
    """Insert chunk record if absent. Returns 'exists' or 'written'."""
    c = conn()
    row = c.execute("SELECT sha256 FROM chunks WHERE upload_id=? AND idx=?",
                    (upload_id, idx)).fetchone()
    if row is not None:
        return "exists" if row["sha256"] == sha256 else "conflict"
    c.execute("INSERT INTO chunks(upload_id,idx,size,sha256,received_at) VALUES(?,?,?,?,?)",
              (upload_id, idx, size, sha256, time.time()))
    c.execute("UPDATE uploads SET bytes_written = bytes_written + ? WHERE id=?",
              (size, upload_id))
    c.commit()
    return "written"


def chunk_count(upload_id):
    return conn().execute(
        "SELECT COUNT(*) n FROM chunks WHERE upload_id=?", (upload_id,)).fetchone()["n"]


def set_convert_progress(upload_id, done, total):
    conn().execute("UPDATE uploads SET convert_done=?, convert_total=? WHERE id=?",
                   (done, total, upload_id))
    conn().commit()


def record_chunk_output(upload_id, idx, path):
    conn().execute(
        "INSERT OR REPLACE INTO chunk_outputs(upload_id,idx,path) VALUES(?,?,?)",
        (upload_id, idx, path))
    conn().commit()


def next_convert_index(upload_id):
    row = conn().execute(
        "SELECT COALESCE(MAX(idx),-1) m FROM chunk_outputs WHERE upload_id=?",
        (upload_id,)).fetchone()
    return row["m"] + 1


def get_events(upload_id, limit=200):
    rows = conn().execute(
        "SELECT * FROM events WHERE upload_id=? ORDER BY id DESC LIMIT ?",
        (upload_id, limit)).fetchall()
    return [dict(r) for r in reversed(rows)]
