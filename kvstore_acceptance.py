# -*- coding: utf-8 -*-
"""kvstore 离线验收脚本：子进程写一半被 kill，验证崩溃恢复语义。
运行：python kvstore_acceptance.py"""
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kvstore import KVStore, _HEADER, _encode_record

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

passed = failed = 0
_tmpdirs = []


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("PASS  %s" % name)
    else:
        failed += 1
        print("FAIL  %s  %s" % (name, detail))


def check_state(name, store, expected, absent=()):
    bad = []
    for k, v in expected.items():
        actual = store.get(k)
        if actual != v:
            bad.append("key=%s 期望 %r 实际 %r" % (k, v, actual))
    for k in absent:
        actual = store.get(k)
        if actual is not None:
            bad.append("key=%s 期望 None 实际 %r" % (k, actual))
    check(name, not bad, "; ".join(bad))


def mktmp():
    d = tempfile.mkdtemp(prefix="kvacc-")
    _tmpdirs.append(d)
    return d


# ---------- 子进程：写一半被 kill ----------

def child_main(case, d):
    if case == "basic":
        s = KVStore(d, sync_mode="always")
        for i in range(1, 6):
            s.write("k%d" % i, "v%d" % i)
    elif case == "concurrent":
        s = KVStore(d, sync_mode="always")

        def worker(t):
            for j in range(25):
                s.write("t%02d-k%02d" % (t, j), "val-%d-%d" % (t, j))
        ths = [threading.Thread(target=worker, args=(t,)) for t in range(8)]
        for t in ths:
            t.start()
        for t in ths:
            t.join()
    elif case == "snapshot":
        s = KVStore(d, sync_mode="always")
        s.write("k1", "a")       # lsn 1
        s.write("k2", "old")     # lsn 2
        s.write("k2", "new")     # lsn 3
        s.snapshot()             # 快照 @ lsn 3
        s.write("k3", "c")       # lsn 4
        s.delete("k1")           # lsn 5
    elif case == "interval":
        s = KVStore(d, sync_mode="interval", sync_interval_ms=50)
        for i in range(1, 4):
            s.write("ik%d" % i, "x%d" % i)
        time.sleep(0.6)          # 等后台刷盘线程 fsync
    print("READY", flush=True)
    while True:                  # 等父进程 kill，模拟断电
        time.sleep(1)


def run_killed_child(case):
    """启动子进程，等它确认写完（READY）后 kill -9，返回数据目录。"""
    d = mktmp()
    proc = subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), "child", case, d],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    ready = {}
    def reader():
        ready["line"] = proc.stdout.readline()
    t = threading.Thread(target=reader, daemon=True)
    t.start()
    t.join(30)
    ok = (not t.is_alive()) and ready.get("line", "").strip() == "READY"
    proc.kill()
    proc.wait()
    if not ok:
        err = proc.stderr.read()
        check("child-%s-ready" % case, False, "子进程未就绪: %s" % err[-300:])
        return None
    return d


# ---------- 验收用例 ----------

def case_confirmed_survive():
    d = run_killed_child("basic")
    if d is None:
        return
    s = KVStore(d)
    rep = s.recover()
    check_state("confirmed-writes-survive", s,
                {"k%d" % i: "v%d" % i for i in range(1, 6)})
    check("confirmed-replayed", rep.replayed == [1, 2, 3, 4, 5],
          "期望 replayed [1,2,3,4,5] 实际 %s" % rep.replayed)
    check("confirmed-clean-exit",
          rep.truncated_at is None and rep.corrupted is False,
          "期望无截断无损坏 实际 truncated_at=%s corrupted=%s"
          % (rep.truncated_at, rep.corrupted))


def case_concurrent_no_interleave():
    d = run_killed_child("concurrent")
    if d is None:
        return
    s = KVStore(d)
    rep = s.recover()
    expect = {"t%02d-k%02d" % (t, j): "val-%d-%d" % (t, j)
              for t in range(8) for j in range(25)}
    check_state("concurrent-all-present", s, expect)
    check("concurrent-records-intact",
          rep.corrupted is False and rep.truncated_at is None
          and sorted(rep.replayed) == list(range(1, 201)),
          "期望 200 条完整记录 实际 replayed=%d 条 truncated_at=%s corrupted=%s"
          % (len(rep.replayed), rep.truncated_at, rep.corrupted))


def case_snapshot_wal_combo():
    d = run_killed_child("snapshot")
    if d is None:
        return
    s = KVStore(d)
    rep = s.recover()
    check_state("snapshot-combo-state", s, {"k2": "new", "k3": "c"},
                absent=["k1"])
    check("snapshot-combo-replayed", rep.replayed == [4, 5],
          "期望只重放快照后的 [4,5] 实际 %s" % rep.replayed)


def case_interval_flush():
    d = run_killed_child("interval")
    if d is None:
        return
    s = KVStore(d)
    rep = s.recover()
    check_state("interval-writes-survive", s,
                {"ik1": "x1", "ik2": "x2", "ik3": "x3"})
    check("interval-replayed", rep.replayed == [1, 2, 3],
          "期望 replayed [1,2,3] 实际 %s" % rep.replayed)


def case_half_record_truncated():
    d = mktmp()
    s = KVStore(d)
    s.write("a", "1")
    s.write("b", "2")
    s.close()
    wal = os.path.join(d, "wal.log")
    size_before = os.path.getsize(wal)
    with open(wal, "ab") as f:  # 模拟断电留下的半截记录
        f.write(_encode_record(3, 1, 1, "ghost", "x")[:10])
    s2 = KVStore(d)
    rep = s2.recover()
    check("half-record-truncated-at", rep.truncated_at == size_before,
          "期望截断于 %d 实际 %s" % (size_before, rep.truncated_at))
    check("half-record-replayed", rep.replayed == [1, 2],
          "期望 replayed [1,2] 实际 %s" % rep.replayed)
    check_state("half-record-state", s2, {"a": "1", "b": "2"}, absent=["ghost"])
    s2.write("c", "3")  # 截断后新写接在正确位置，恢复后仍完整
    s3 = KVStore(d)
    rep3 = s3.recover()
    check("append-after-truncate",
          rep3.replayed == [1, 2, 3] and s3.get("c") == "3",
          "期望截断后可继续写入 实际 replayed=%s c=%r" % (rep3.replayed, s3.get("c")))


def case_uncommitted_not_replayed():
    d = mktmp()
    s = KVStore(d)
    s.write("a", "1")
    s.close()
    wal = os.path.join(d, "wal.log")
    size_before = os.path.getsize(wal)
    with open(wal, "ab") as f:  # CRC 合法但 commit=0 的未确认记录
        f.write(_encode_record(2, 1, 0, "ghost", "x"))
    s2 = KVStore(d)
    rep = s2.recover()
    check("uncommitted-truncated", rep.truncated_at == size_before,
          "期望截断于 %d 实际 %s" % (size_before, rep.truncated_at))
    check_state("uncommitted-absent", s2, {"a": "1"}, absent=["ghost"])


def case_crc_corruption():
    d = mktmp()
    s = KVStore(d)
    s.write("k1", "v1")
    s.write("k2", "v2")
    s.write("k3", "v3")
    s.close()
    wal = os.path.join(d, "wal.log")
    rec1 = _encode_record(1, 1, 1, "k1", "v1")
    off2 = len(rec1)  # 第二条记录起始偏移
    with open(wal, "r+b") as f:  # 翻转第二条记录 payload 的一个字节
        f.seek(off2 + _HEADER.size)
        b = f.read(1)
        f.seek(off2 + _HEADER.size)
        f.write(bytes([b[0] ^ 0xFF]))
    s2 = KVStore(d)
    rep = s2.recover()
    check("crc-detected", rep.corrupted is True,
          "期望 corrupted=True 实际 %s" % rep.corrupted)
    check("crc-truncated-at", rep.truncated_at == off2,
          "期望截断于 %d 实际 %s" % (off2, rep.truncated_at))
    check("crc-replayed", rep.replayed == [1],
          "期望 replayed [1] 实际 %s" % rep.replayed)
    check_state("crc-state", s2, {"k1": "v1"}, absent=["k2", "k3"])


def case_never_mode_consistent():
    d = mktmp()
    s = KVStore(d, sync_mode="never")
    s.write("n1", "a")
    s.write("n2", "b")
    rep = s.recover()  # 同进程恢复：never 模式数据可丢但不允许错乱
    check("never-mode-consistent",
          rep.corrupted is False and rep.truncated_at is None
          and s.get("n1") == "a" and s.get("n2") == "b",
          "never 模式出现错乱: replayed=%s corrupted=%s"
          % (rep.replayed, rep.corrupted))


def main():
    for case in (case_confirmed_survive, case_concurrent_no_interleave,
                 case_snapshot_wal_combo, case_interval_flush,
                 case_half_record_truncated, case_uncommitted_not_replayed,
                 case_crc_corruption, case_never_mode_consistent):
        try:
            case()
        except Exception as exc:  # noqa: BLE001
            check(case.__name__, False, "用例抛出异常 %r" % exc)
    for d in _tmpdirs:
        shutil.rmtree(d, ignore_errors=True)
    print("-" * 60)
    print("通过 %d 项，失败 %d 项" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "child":
        child_main(sys.argv[2], sys.argv[3])
    else:
        main()
