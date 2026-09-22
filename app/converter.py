"""Background conversion with per-chunk checkpointing.

Each source chunk is converted into a self-describing block of the unified
format (magic + index + length + sha256 + payload) and written to its own
.part file. Completed parts are kept on disk, so a failed conversion can be
resumed from the first missing part instead of starting over.
"""
import hashlib
import os
import struct
import threading
import time

from . import storage

MAGIC = b"UFMT"

_active = {}
_active_guard = threading.Lock()


def is_running(upload_id):
    with _active_guard:
        return upload_id in _active


def start_conversion(upload_id, fail_at=None):
    """Start (or resume) conversion in a background thread. False if running."""
    with _active_guard:
        if upload_id in _active:
            return False
        _active[upload_id] = True
    t = threading.Thread(target=_run, args=(upload_id, fail_at), daemon=True)
    t.start()
    return True


def _convert_chunk(upload_id, index):
    chunk_path = os.path.join(storage.chunks_dir(upload_id), "%06d.chunk" % index)
    with open(chunk_path, "rb") as f:
        payload = f.read()
    digest = hashlib.sha256(payload).digest()
    block = MAGIC + struct.pack(">QI", index, len(payload)) + digest + payload
    part_path = os.path.join(storage.parts_dir(upload_id), "%06d.part" % index)
    tmp = part_path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(block)
    os.replace(tmp, part_path)


def _merge_parts(upload_id, total):
    result_path = os.path.join(storage.upload_dir(upload_id), "result.ufmt")
    tmp = result_path + ".tmp"
    with open(tmp, "wb") as out:
        out.write(MAGIC + struct.pack(">Q", total))
        for i in range(total):
            part = os.path.join(storage.parts_dir(upload_id), "%06d.part" % i)
            with open(part, "rb") as p:
                out.write(p.read())
    os.replace(tmp, result_path)
    return result_path


def _run(upload_id, fail_at):
    lock = storage.get_lock(upload_id)
    try:
        with lock:
            meta = storage.load_meta(upload_id)
            conv = meta.setdefault(
                "conversion",
                {"converted": [], "failed_at": None, "error": None, "progress": 0.0})
            done = set(conv.get("converted", []))
            total = meta["total_chunks"]
            resumed = len(done) > 0
            start_at = (max(done) + 1) if done else 0
            meta["state"] = "converting"
            storage.save_meta(meta)
            storage.append_event(
                upload_id,
                "conversion_resumed" if resumed else "conversion_started",
                "转换%s，从第 %d 段开始（已完成 %d/%d）"
                % ("续跑" if resumed else "开始", start_at, len(done), total))
            for i in range(total):
                if i in done:
                    continue
                if fail_at is not None and i == fail_at:
                    raise RuntimeError("模拟转换失败：分段 %d 处理出错" % i)
                _convert_chunk(upload_id, i)
                done.add(i)
                meta = storage.load_meta(upload_id)
                meta["conversion"]["converted"] = sorted(done)
                meta["conversion"]["progress"] = round(len(done) / total, 4)
                meta["conversion"]["error"] = None
                storage.save_meta(meta)
                storage.append_event(upload_id, "chunk_converted",
                                     "分段 %d 转换完成（%d/%d）" % (i, len(done), total),
                                     chunk=i)
                time.sleep(0.15)  # keep progress observable in the UI
            result = _merge_parts(upload_id, total)
            meta = storage.load_meta(upload_id)
            meta["state"] = "completed"
            meta["result_file"] = result
            meta["conversion"]["progress"] = 1.0
            storage.save_meta(meta)
            storage.append_event(upload_id, "completed",
                                 "全部转换完成，结果文件 result.ufmt 可下载")
    except Exception as e:  # keep finished parts, record failure point
        with lock:
            meta = storage.load_meta(upload_id)
            conv = meta.setdefault(
                "conversion",
                {"converted": [], "failed_at": None, "error": None, "progress": 0.0})
            done = conv.get("converted", [])
            meta["state"] = "convert_failed"
            conv["error"] = str(e)
            conv["failed_at"] = (max(done) + 1) if done else 0
            storage.save_meta(meta)
            storage.append_event(upload_id, "conversion_failed", str(e),
                                 failed_at=conv["failed_at"], kept=len(done))
    finally:
        with _active_guard:
            _active.pop(upload_id, None)
