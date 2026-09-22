"""FastAPI app: chunked upload, idempotent chunk intake, resumable conversion."""
import hashlib
import os
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import converter, storage

app = FastAPI(title="Chunked Upload & Convert")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


class InitReq(BaseModel):
    filename: str
    size: int
    chunk_size: int
    client_token: str | None = None


def status_payload(uid):
    meta = storage.load_meta(uid)
    received = sorted(int(k) for k in meta.get("chunks", {}))
    total = meta["total_chunks"]
    conv = meta.get("conversion", {})
    return {
        "id": uid,
        "filename": meta["filename"],
        "size": meta["size"],
        "chunk_size": meta["chunk_size"],
        "total_chunks": total,
        "state": meta["state"],
        "received_chunks": received,
        "missing_chunks": [i for i in range(total) if i not in set(received)],
        "failed_chunks": meta.get("failed_chunks", {}),
        "bytes_billed": meta.get("bytes_billed", 0),
        "conversion": {
            "converted_count": len(conv.get("converted", [])),
            "progress": conv.get("progress", 0.0),
            "failed_at": conv.get("failed_at"),
            "error": conv.get("error"),
            "running": converter.is_running(uid),
        },
        "result_ready": meta["state"] == "completed"
        and os.path.exists(meta.get("result_file") or ""),
    }


@app.post("/api/uploads")
def init_upload(req: InitReq):
    if req.size <= 0 or req.chunk_size <= 0:
        raise HTTPException(400, "size 与 chunk_size 必须为正数")
    if req.client_token:
        existing = storage.find_by_token(req.client_token)
        if existing:
            uid = existing["id"]
            storage.append_event(uid, "session_resumed", "客户端重连，恢复已有上传会话")
            return status_payload(uid)
    uid = uuid.uuid4().hex[:12]
    storage.ensure_dirs(uid)
    total = (req.size + req.chunk_size - 1) // req.chunk_size
    meta = {
        "id": uid,
        "filename": req.filename,
        "size": req.size,
        "chunk_size": req.chunk_size,
        "total_chunks": total,
        "client_token": req.client_token,
        "state": "uploading",
        "chunks": {},
        "failed_chunks": {},
        "bytes_billed": 0,
        "conversion": {"converted": [], "failed_at": None, "error": None, "progress": 0.0},
        "result_file": None,
        "created_at": storage.now(),
    }
    storage.save_meta(meta)
    storage.append_event(uid, "created",
                         "创建上传会话：%s（%d 字节，%d 段）" % (req.filename, req.size, total))
    return status_payload(uid)


@app.get("/api/uploads/{uid}")
def get_status(uid: str):
    if not storage.meta_exists(uid):
        raise HTTPException(404, "上传会话不存在")
    return status_payload(uid)

@app.put("/api/uploads/{uid}/chunks/{index}")
async def put_chunk(uid: str, index: int, request: Request):
    if not storage.meta_exists(uid):
        raise HTTPException(404, "上传会话不存在")
    body = await request.body()
    sha = request.headers.get("x-chunk-sha256", "")
    lock = storage.get_lock(uid)
    with lock:
        meta = storage.load_meta(uid)
        if not 0 <= index < meta["total_chunks"]:
            raise HTTPException(400, "分段序号越界")
        if meta["state"] not in ("uploading",):
            raise HTTPException(409, "当前状态不允许写入分段：%s" % meta["state"])
        chunk_path = os.path.join(storage.chunks_dir(uid), "%06d.chunk" % index)
        if os.path.exists(chunk_path):
            with open(chunk_path, "rb") as f:
                existing_sha = hashlib.sha256(f.read()).hexdigest()
            if existing_sha == sha:
                return {"status": "duplicate", "billed": False, "chunk": index}
        actual = hashlib.sha256(body).hexdigest()
        if sha and actual != sha:
            reason = "校验和不匹配：期望 %s，实际 %s" % (sha[:16], actual[:16])
            meta.setdefault("failed_chunks", {})[str(index)] = {"error": reason}
            storage.save_meta(meta)
            storage.append_event(uid, "chunk_failed",
                                 "分段 %d 写入失败：%s" % (index, reason), chunk=index)
            raise HTTPException(409, reason)
        tmp = chunk_path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, chunk_path)
        meta.setdefault("chunks", {})[str(index)] = {"size": len(body), "sha256": actual}
        meta["bytes_billed"] = meta.get("bytes_billed", 0) + len(body)
        meta.get("failed_chunks", {}).pop(str(index), None)
        if len(meta["chunks"]) == meta["total_chunks"]:
            meta["state"] = "uploaded"
            storage.append_event(uid, "all_chunks_received",
                                 "全部 %d 段接收完成" % meta["total_chunks"])
        storage.save_meta(meta)
        storage.append_event(uid, "chunk_received",
                             "分段 %d 已写入（%d 字节）" % (index, len(body)), chunk=index)
        return {"status": "stored", "billed": True, "chunk": index}


@app.post("/api/uploads/{uid}/convert")
def start_convert(uid: str, fail_at: int | None = None):
    if not storage.meta_exists(uid):
        raise HTTPException(404, "上传会话不存在")
    meta = storage.load_meta(uid)
    if len(meta.get("chunks", {})) < meta["total_chunks"]:
        raise HTTPException(409, "分段尚未全部接收，无法转换")
    if meta["state"] == "completed":
        raise HTTPException(409, "转换已完成")
    if not converter.start_conversion(uid, fail_at=fail_at):
        raise HTTPException(409, "转换正在进行中")
    return {"status": "started"}


@app.get("/api/uploads/{uid}/events")
def get_events(uid: str):
    if not storage.meta_exists(uid):
        raise HTTPException(404, "上传会话不存在")
    return {"events": storage.read_events(uid)}


@app.get("/api/uploads/{uid}/result")
def get_result(uid: str):
    if not storage.meta_exists(uid):
        raise HTTPException(404, "上传会话不存在")
    meta = storage.load_meta(uid)
    path = meta.get("result_file")
    if meta["state"] != "completed" or not path or not os.path.exists(path):
        raise HTTPException(404, "结果文件尚未生成")
    return FileResponse(path, filename="result.ufmt")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
