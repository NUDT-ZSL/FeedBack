"""FastAPI server: chunked upload, idempotent chunk writes, background conversion."""
import hashlib
import os
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

import converter
import storage

app = FastAPI(title="AutoDemo Chunked Upload")
storage.init()

DATA_DIR = storage.DATA_DIR
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
_complete_lock = threading.Lock()


class InitReq(BaseModel):
    filename: str
    size: int
    chunk_size: int
    client_key: str | None = None


def _upload_dir(upload_id):
    d = os.path.join(DATA_DIR, "uploads", upload_id)
    os.makedirs(d, exist_ok=True)
    return d


def _status_payload(u):
    received = storage.received_indexes(u["id"])
    return {
        "id": u["id"],
        "filename": u["filename"],
        "size": u["size"],
        "chunk_size": u["chunk_size"],
        "total_chunks": u["total_chunks"],
        "status": u["status"],
        "bytes_written": u["bytes_written"],
        "received": received,
        "received_count": len(received),
        "convert_done": u["convert_done"],
        "convert_total": u["convert_total"],
        "error": u["error"],
        "has_result": bool(u["result_path"]),
    }


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/static/{name}")
def static_file(name: str):
    path = os.path.join(STATIC_DIR, name)
    if not os.path.isfile(path):
        raise HTTPException(404, "not found")
    return FileResponse(path)


@app.post("/api/uploads")
def init_upload(req: InitReq):
    if req.client_key:
        existing = storage.find_by_client_key(req.client_key)
        if existing is not None and existing["status"] != "completed":
            storage.log_event(existing["id"], "upload",
                              "client reconnected, resume existing session")
            return _status_payload(storage.get_upload(existing["id"]))
    upload_id = uuid.uuid4().hex[:12]
    total = (req.size + req.chunk_size - 1) // req.chunk_size
    storage.conn().execute(
        "INSERT INTO uploads(id,client_key,filename,size,chunk_size,total_chunks,"
        "status,created_at) VALUES(?,?,?,?,?,?,'uploading',?)",
        (upload_id, req.client_key, req.filename, req.size, req.chunk_size,
         total, time.time()))
    storage.conn().commit()
    _upload_dir(upload_id)
    storage.log_event(upload_id, "upload",
                      "session created: %s, %d bytes, %d chunks"
                      % (req.filename, req.size, total))
    return _status_payload(storage.get_upload(upload_id))


@app.get("/api/uploads/{upload_id}")
def get_upload(upload_id: str):
    u = storage.get_upload(upload_id)
    if u is None:
        raise HTTPException(404, "upload not found")
    return _status_payload(u)


@app.put("/api/uploads/{upload_id}/chunks/{idx}")
async def put_chunk(upload_id: str, idx: int, request: Request):
    u = storage.get_upload(upload_id)
    if u is None:
        raise HTTPException(404, "upload not found")
    if idx < 0 or idx >= u["total_chunks"]:
        raise HTTPException(400, "分段序号 %d 超出范围" % idx)
    body = await request.body()
    sha = hashlib.sha256(body).hexdigest()
    expect = (u["chunk_size"] if idx < u["total_chunks"] - 1
              else u["size"] - idx * u["chunk_size"])
    if len(body) != expect:
        raise HTTPException(400, "分段 %d 大小不符：期望 %d 字节，实际 %d 字节"
                            % (idx, expect, len(body)))

    updir = _upload_dir(upload_id)
    final = os.path.join(updir, "chunk_%06d.part" % idx)
    tmp = os.path.join(updir, "chunk_%06d.tmp" % idx)
    with open(tmp, "wb") as f:
        f.write(body)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, final)  # atomic: a crashed write never leaves a partial chunk

    result = storage.record_chunk(upload_id, idx, len(body), sha)
    if result == "conflict":
        raise HTTPException(409, "分段 %d 已存在且校验和不一致" % idx)
    if result == "exists":
        return {"idx": idx, "deduped": True, "written_bytes": 0}

    storage.log_event(upload_id, "upload",
                      "chunk %d received (%d bytes)" % (idx, len(body)))
    _maybe_complete(u, upload_id)
    return {"idx": idx, "deduped": False, "written_bytes": len(body)}


def _maybe_complete(u, upload_id):
    with _complete_lock:
        if storage.chunk_count(upload_id) != u["total_chunks"]:
            return
        fresh = storage.get_upload(upload_id)
        if fresh["status"] != "uploading":
            return
        storage.set_status(upload_id, "queued")
        storage.log_event(upload_id, "upload",
                          "all chunks received, queued for conversion")
        converter.start_conversion(upload_id)


@app.post("/api/uploads/{upload_id}/conversion/resume")
def resume_conversion(upload_id: str):
    u = storage.get_upload(upload_id)
    if u is None:
        raise HTTPException(404, "upload not found")
    if u["status"] not in ("conversion_failed", "queued"):
        raise HTTPException(409, "当前状态 %s 不允许恢复转换" % u["status"])
    started = converter.start_conversion(upload_id)
    if not started:
        raise HTTPException(409, "转换任务已在运行中")
    return {"resumed": True, "from_chunk": storage.next_convert_index(upload_id)}


@app.get("/api/uploads/{upload_id}/events")
def events(upload_id: str):
    if storage.get_upload(upload_id) is None:
        raise HTTPException(404, "upload not found")
    return {"events": storage.get_events(upload_id)}


@app.get("/api/uploads/{upload_id}/result")
def result(upload_id: str):
    u = storage.get_upload(upload_id)
    if u is None or not u["result_path"] or not os.path.isfile(u["result_path"]):
        raise HTTPException(404, "result not ready")
    name = os.path.splitext(u["filename"])[0] + ".adc"
    return FileResponse(u["result_path"], filename=name)


class FailAtReq(BaseModel):
    idx: int


@app.post("/api/uploads/{upload_id}/debug/fail-at")
def debug_fail_at(upload_id: str, req: FailAtReq):
    """Demo hook: make the conversion fail when it reaches chunk idx."""
    if storage.get_upload(upload_id) is None:
        raise HTTPException(404, "upload not found")
    converter.request_fail_at(upload_id, req.idx)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8766")))
