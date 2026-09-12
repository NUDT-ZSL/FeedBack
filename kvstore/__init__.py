"""kvstore — 本地嵌入式 KV 存储，WAL 保证崩溃恢复语义。

确认语义：write/delete 先追加 WAL 记录（always 模式下 fsync 落盘）再改内存，
方法返回才算确认。恢复时只重放完整且 CRC 校验通过、带 commit 标记的记录，
尾部半截/未提交记录直接截断。仅使用标准库。
"""

from __future__ import annotations

import json
import os
import struct
import threading
import zlib
from collections import namedtuple

__all__ = ["KVStore", "RecoveryReport"]

# 记录格式：header(18B) + payload
#   header: lsn(Q,8) payload_len(I,4) op(B,1) commit(B,1) crc32(I,4)
#   payload: key_len(H,2) key value_len(I,4) value
# crc32 覆盖 lsn+op+commit+payload，可识别任何字节级损坏。
_HEADER = struct.Struct("<QIBBI")
_OP_DEL = 0
_OP_PUT = 1
_MAX_PAYLOAD = 64 * 1024 * 1024  # 长度越界判定阈值

RecoveryReport = namedtuple("RecoveryReport",
                            ["replayed", "truncated_at", "corrupted"])


def _encode_record(lsn, op, commit, key, value):
    kb = key.encode("utf-8")
    vb = value.encode("utf-8") if (op == _OP_PUT and value is not None) else b""
    payload = struct.pack("<H", len(kb)) + kb + struct.pack("<I", len(vb)) + vb
    crc = zlib.crc32(struct.pack("<QBB", lsn, op, commit) + payload) & 0xFFFFFFFF
    return _HEADER.pack(lsn, len(payload), op, commit, crc) + payload


def _decode_payload(payload, op):
    klen = struct.unpack_from("<H", payload, 0)[0]
    key = payload[2:2 + klen].decode("utf-8")
    value = None
    if op == _OP_PUT:
        vlen = struct.unpack_from("<I", payload, 2 + klen)[0]
        value = payload[6 + klen:6 + klen + vlen].decode("utf-8")
    return key, value


class KVStore:
    """单进程多线程嵌入式 KV 存储。

    directory: 数据目录（wal.log 与 snapshot.json 存放于此）。
    sync_mode: always 每条确认前 fsync；interval 按 sync_interval_ms 批量刷盘；
               never 不刷盘（仅测试用，恢复语义放宽但不会产生错乱数据）。
    """

    def __init__(self, directory, sync_mode="always", sync_interval_ms=100):
        if sync_mode not in ("always", "interval", "never"):
            raise ValueError("sync_mode must be always/interval/never")
        if sync_mode == "interval" and sync_interval_ms <= 0:
            raise ValueError("sync_interval_ms must be positive")
        self._dir = directory
        os.makedirs(directory, exist_ok=True)
        self._wal_path = os.path.join(directory, "wal.log")
        self._snap_path = os.path.join(directory, "snapshot.json")
        self._sync_mode = sync_mode
        self._data = {}
        self._lsn = 0
        self._write_lock = threading.Lock()  # 保证单条记录原子追加
        self._wal = None                     # 追加句柄，按需打开
        self._dirty = False
        self._closed = False
        self._stop = threading.Event()
        self._flusher = None
        if sync_mode == "interval":
            interval = sync_interval_ms / 1000.0
            self._flusher = threading.Thread(
                target=self._flush_loop, args=(interval,), daemon=True)
            self._flusher.start()

    # ---- 内部 ----

    def _flush_loop(self, interval):
        while not self._stop.wait(interval):
            with self._write_lock:
                if self._wal is not None and self._dirty:
                    self._wal.flush()
                    os.fsync(self._wal.fileno())
                    self._dirty = False

    def _append(self, record):
        """追加一条记录并按 sync_mode 刷盘。调用方必须持有 _write_lock。"""
        if self._closed:
            raise ValueError("store is closed")
        if self._wal is None:
            self._wal = open(self._wal_path, "ab")
        self._wal.write(record)
        if self._sync_mode == "always":
            self._wal.flush()
            os.fsync(self._wal.fileno())
        elif self._sync_mode == "interval":
            self._wal.flush()  # 交给 OS，后台线程按周期 fsync
            self._dirty = True
        # never: 仅写 Python 缓冲区

    # ---- 写路径（全部走同一条确认语义） ----

    def write(self, key, value):
        """先落 WAL 再改内存；返回时该写已按 sync_mode 确认。返回 lsn。"""
        with self._write_lock:
            self._lsn += 1
            self._append(_encode_record(self._lsn, _OP_PUT, 1, key, value))
            self._data[key] = value
            return self._lsn

    def delete(self, key):
        """与 write 同一确认语义。返回被删 key 此前是否存在。"""
        with self._write_lock:
            existed = key in self._data
            self._lsn += 1
            self._append(_encode_record(self._lsn, _OP_DEL, 1, key, None))
            self._data.pop(key, None)
            return existed

    def get(self, key):
        """读路径不加锁，绝不阻塞写。"""
        return self._data.get(key)

    def keys(self):
        return list(self._data.keys())

    # ---- 快照 ----

    def snapshot(self):
        """冻结写入，落盘与当前 lsn 一致的快照。返回快照对应的 lsn。"""
        with self._write_lock:
            if self._wal is not None:  # 保证快照 lsn 之前的 WAL 已落盘
                self._wal.flush()
                if self._sync_mode != "never":
                    os.fsync(self._wal.fileno())
                self._dirty = False
            payload = {"lsn": self._lsn, "data": self._data}
            tmp = self._snap_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(payload, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self._snap_path)  # 原子替换，不会留下半个快照
            return self._lsn

    # ---- 恢复 ----

    def recover(self):
        """加载 snapshot 并从其 lsn 之后重放 WAL，返回 RecoveryReport。

        只重放完整、CRC 通过、带 commit 标记的记录；遇到半截/损坏/未提交
        记录时停止，把 WAL 物理截断到该位置，不抛未捕获异常。
        """
        with self._write_lock:
            if self._wal is not None:  # 同进程恢复前先冲刷缓冲区
                self._wal.flush()
            snapshot_lsn = 0
            self._data = {}
            if os.path.exists(self._snap_path):
                try:
                    with open(self._snap_path, encoding="utf-8") as f:
                        snap = json.load(f)
                    self._data = dict(snap["data"])
                    snapshot_lsn = int(snap["lsn"])
                except Exception:
                    self._data = {}
                    snapshot_lsn = 0
            try:
                with open(self._wal_path, "rb") as f:
                    buf = f.read()
            except FileNotFoundError:
                buf = b""
            replayed = []
            truncated_at = None
            corrupted = False
            max_lsn = snapshot_lsn
            offset = 0
            while offset < len(buf):
                if len(buf) - offset < _HEADER.size:  # 尾部半截 header
                    truncated_at = offset
                    break
                lsn, plen, op, commit, crc = _HEADER.unpack_from(buf, offset)
                if plen > _MAX_PAYLOAD:  # 长度越界 -> 损坏
                    corrupted = True
                    truncated_at = offset
                    break
                end = offset + _HEADER.size + plen
                if end > len(buf):  # 尾部半截 payload
                    truncated_at = offset
                    break
                payload = buf[offset + _HEADER.size:end]
                expect = zlib.crc32(
                    struct.pack("<QBB", lsn, op, commit) + payload) & 0xFFFFFFFF
                if expect != crc or op not in (_OP_PUT, _OP_DEL):
                    corrupted = True
                    truncated_at = offset
                    break
                if commit != 1:  # 未提交记录：不重放，截断
                    truncated_at = offset
                    break
                max_lsn = max(max_lsn, lsn)
                if lsn > snapshot_lsn:  # 快照已覆盖的记录跳过，不回退
                    try:
                        key, value = _decode_payload(payload, op)
                    except Exception:
                        corrupted = True
                        truncated_at = offset
                        break
                    if op == _OP_PUT:
                        self._data[key] = value
                    else:
                        self._data.pop(key, None)
                    replayed.append(lsn)
                offset = end
            if truncated_at is not None:
                if self._wal is not None:  # 截断后旧句柄位置失效，重开
                    self._wal.close()
                    self._wal = None
                with open(self._wal_path, "r+b") as f:
                    f.truncate(truncated_at)
            self._lsn = max(self._lsn, max_lsn)
            return RecoveryReport(replayed=replayed,
                                  truncated_at=truncated_at,
                                  corrupted=corrupted)

    def close(self):
        self._stop.set()
        with self._write_lock:
            if self._closed:
                return
            self._closed = True
            if self._wal is not None:
                self._wal.flush()
                if self._sync_mode != "never":
                    os.fsync(self._wal.fileno())
                self._wal.close()
                self._wal = None
        if self._flusher is not None:
            self._flusher.join(timeout=2)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
