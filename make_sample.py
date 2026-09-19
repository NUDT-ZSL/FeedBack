# -*- coding: utf-8 -*-
"""Generate a sample JSONL log chain, optionally with planted anomalies."""
import sys

from logchain.chain import Chain
from logchain.model import LogRecord
from logchain.storage import save_jsonl

SOURCES = ["web-01", "db-01", "cron", "api-gw"]
BODIES = [
    "用户 admin 登录成功",
    "备份任务开始",
    "备份任务完成, 大小 1.2GB",
    "磁盘使用率 78%",
    "重启 nginx 服务",
    "配置项 max_conn 修改为 512",
    "证书更新完成",
    "清理临时文件 304 个",
]


def build(n=12, tamper=True):
    records = []
    for i in range(1, n + 1):
        records.append(LogRecord(
            seq=i,
            timestamp="2026-09-20T%02d:15:00" % (8 + i),
            source=SOURCES[i % len(SOURCES)],
            body=BODIES[i % len(BODIES)] + " (#%d)" % i,
            prev_seq=None if i == 1 else i - 1,
        ))
    chain = Chain(records)
    prev = ""
    for rec in chain.records:
        rec.checksum = rec.compute_checksum(chain.basis, prev)
        prev = rec.checksum
    if tamper:
        chain.records[4].body = "配置项 max_conn 修改为 99999 (被篡改)"
        chain.records[7].checksum = None            # 缺失校验值
        chain.records[8].checksum = "zzzz-not-hex"  # 格式异常
        chain.records[10].prev_seq = 999            # 悬空引用
    return chain.records


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "sample_logs.jsonl"
    save_jsonl(out, build())
    print("已生成 %s" % out)
