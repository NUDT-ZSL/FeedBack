"""Background conversion worker with per-chunk checkpointing and resume."""
import hashlib
import os
import shutil
import threading
import time

import storage

DATA_DIR = storage.DATA_DIR

_workers = {}
_workers_lock = threading.Lock()
_fail_at = {}  # upload_id -> chunk idx, debug hook to simulate a conversion failure


def request_fail_at(upload_id, idx):
    _fail_at[upload_id] = idx


def _convert_bytes(data: bytes) -> bytes:
    """Normalize a raw chunk into the unified container format."""
    digest = hashlib.sha256(data).hexdigest().encode("ascii")
    header = b"CHUNK1|" + str(len(data)).encode("ascii") + b"|" + digest + b"\n"
    return header + data


def start_conversion(upload_id):
    with _workers_lock:
        t = _workers.get(upload_id)
        if t is not None and t.is_alive():
            return False
        t = threading.Thread(target=_run, args=(upload_id,), daemon=True)
        _workers[upload_id] = t
        t.start()
        return True


def _run(upload_id):
    row = storage.get_upload(upload_id)
    if row is None:
        return
    total = row["total_chunks"]
    updir = os.path.join(DATA_DIR, "uploads", upload_id)
    outdir = os.path.join(DATA_DIR, "converted", upload_id)
    os.makedirs(outdir, exist_ok=True)

    start_idx = storage.next_convert_index(upload_id)
    storage.set_status(upload_id, "converting")
    storage.set_convert_progress(upload_id, start_idx, total)
    if start_idx > 0:
        storage.log_event(upload_id, "conversion",
                          f"从断点继续转换：已完成 {start_idx}/{total} 个分段")
    else:
        storage.log_event(upload_id, "conversion", f"开始后台转换，共 {total} 个分段")

    for idx in range(start_idx, total):
        if _fail_at.get(upload_id) == idx:
            _fail_at.pop(upload_id, None)
            _fail(upload_id, idx, total, "模拟故障：转换被中断")
            return
        try:
            cpath = os.path.join(updir, f"chunk_{idx:06d}.part")
            with open(cpath, "rb") as f:
                data = f.read()
            out = _convert_bytes(data)
            tmp = os.path.join(outdir, f"out_{idx:06d}.tmp")
            final = os.path.join(outdir, f"out_{idx:06d}.bin")
            with open(tmp, "wb") as f:
                f.write(out)
            os.replace(tmp, final)
            storage.record_chunk_output(upload_id, idx, final)
            storage.set_convert_progress(upload_id, idx + 1, total)
            time.sleep(0.25)  # simulate per-chunk conversion work
        except Exception as e:
            _fail(upload_id, idx, total, str(e))
            return

    try:
        result_dir = os.path.join(DATA_DIR, "results")
        os.makedirs(result_dir, exist_ok=True)
        result = os.path.join(result_dir, f"{upload_id}.adc")
        tmp = result + ".tmp"
        with open(tmp, "wb") as w:
            w.write(b"AUTODEMO-CONV1\n")
            w.write(row["filename"].encode("utf-8") + b"\n")
            for idx in range(total):
                p = os.path.join(outdir, f"out_{idx:06d}.bin")
                with open(p, "rb") as f:
                    shutil.copyfileobj(f, w)
        os.replace(tmp, result)
        storage.conn().execute(
            "UPDATE uploads SET status='completed', result_path=?, error=NULL WHERE id=?",
            (result, upload_id))
        storage.conn().commit()
        storage.log_event(upload_id, "conversion", "转换完成，结果文件已生成")
    except Exception as e:
        storage.set_status(upload_id, "conversion_failed", error=f"结果合并失败: {e}")
        storage.log_event(upload_id, "error", f"结果合并失败: {e}")


def _fail(upload_id, idx, total, reason):
    msg = f"分段 {idx} 转换失败：{reason}（已保留 {idx}/{total} 个分段结果，可从失败点继续）"
    storage.set_status(upload_id, "conversion_failed", error=msg)
    storage.log_event(upload_id, "error", msg)
