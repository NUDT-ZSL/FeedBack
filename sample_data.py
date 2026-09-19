# -*- coding: utf-8 -*-
"""生成示例运维日志链（含若干被篡改/异常记录），用于演示与自测。"""
import json
import sys

from logchain.model import GENESIS, compute_checksum

SOURCES = ["authd", "nginx", "cron", "sshd", "backup"]
BODIES = [
    "user admin login success from 10.0.0.8",
    "GET /api/health 200 3ms",
    "job cleanup finished, removed 12 temp files",
    "password accepted for ops from 10.0.0.21",
    "nightly backup snapshot completed",
    "user deploy login success from 10.0.0.15",
    "POST /api/deploy 201 128ms",
    "job logrotate finished",
    "session closed for user ops",
    "configuration reload requested",
]


def build_records(count=40, start_seq=1001, tamper=True):
    records = []
    prev_checksum = GENESIS
    for i in range(count):
        seq = start_seq + i
        prev_seq = None if i == 0 else start_seq + i - 1
        rec = {
            "seq": seq,
            "time": "2026-09-20T%02d:%02d:%02d" % (8 + i // 60, i % 60, (i * 7) % 60),
            "source": SOURCES[i % len(SOURCES)],
            "body": BODIES[i % len(BODIES)],
            "prev_seq": prev_seq,
        }
        rec["checksum"] = compute_checksum(
            rec["seq"], rec["time"], rec["source"], rec["body"], prev_checksum)
        prev_checksum = rec["checksum"]
        records.append(rec)
    if tamper:
        # 1) 正文被改动但校验值未同步 -> 不一致
        if len(records) > 11:
            records[11]["body"] = "user admin login success from 10.0.0.99"
        # 2) 校验值缺失
        if len(records) > 19:
            records[19]["checksum"] = ""
        # 3) 校验值格式异常
        if len(records) > 26:
            records[26]["checksum"] = "ZZZ-not-a-digest"
        # 4) 前序引用指向不存在的顺序号
        if len(records) > 32:
            records[32]["prev_seq"] = 999999
    return records


def write_sample(path, count=40, tamper=True):
    records = build_records(count=count, tamper=tamper)
    with open(path, "w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "sample_logs.jsonl"
    write_sample(out)
    print("sample written to %s" % out)
