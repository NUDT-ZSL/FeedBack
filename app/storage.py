"""Persistence layer for chunked upload sessions.

Layout on disk (per upload id):
  data/uploads/<id>/meta.json       session metadata (state machine)
  data/uploads/<id>/events.jsonl    append-only status change log
  data/uploads/<id>/chunks/*.chunk  raw received chunks
  data/uploads/<id>/parts/*.part    per-chunk converted results (resumable)
  data/uploads/<id>/result.ufmt     merged final output
"""
import json
import os
import threading
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "uploads")

_locks = {}
_locks_guard = threading.Lock()


def get_lock(upload_id):
    with _locks_guard:
        return _locks.setdefault(upload_id, threading.Lock())


def upload_dir(upload_id):
    return os.path.join(DATA_DIR, upload_id)


def chunks_dir(upload_id):
    return os.path.join(upload_dir(upload_id), "chunks")


def parts_dir(upload_id):
    return os.path.join(upload_dir(upload_id), "parts")


def meta_path(upload_id):
    return os.path.join(upload_dir(upload_id), "meta.json")


def events_path(upload_id):
    return os.path.join(upload_dir(upload_id), "events.jsonl")


def ensure_dirs(upload_id):
    os.makedirs(chunks_dir(upload_id), exist_ok=True)
    os.makedirs(parts_dir(upload_id), exist_ok=True)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def meta_exists(upload_id):
    return os.path.exists(meta_path(upload_id))


def save_meta(meta):
    meta["updated_at"] = now()
    tmp = meta_path(meta["id"]) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    os.replace(tmp, meta_path(meta["id"]))


def load_meta(upload_id):
    with open(meta_path(upload_id), encoding="utf-8") as f:
        return json.load(f)


def append_event(upload_id, type_, message, **extra):
    ev = {"ts": now(), "type": type_, "message": message}
    ev.update(extra)
    with open(events_path(upload_id), "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def read_events(upload_id):
    if not os.path.exists(events_path(upload_id)):
        return []
    out = []
    with open(events_path(upload_id), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def find_by_token(client_token):
    """Locate an existing session by client token (reconnect / resume)."""
    if not os.path.isdir(DATA_DIR):
        return None
    for uid in os.listdir(DATA_DIR):
        p = meta_path(uid)
        if not os.path.exists(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                m = json.load(f)
            if m.get("client_token") == client_token:
                return m
        except Exception:
            continue
    return None
