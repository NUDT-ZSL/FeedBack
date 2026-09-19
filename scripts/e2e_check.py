# -*- coding: utf-8 -*-
"""端到端冒烟验证：启动服务 -> 示例 -> 详情 -> 修改 -> 裁决 -> 全量复核。"""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:8766"


def call(path, payload=None):
    if payload is None:
        with urllib.request.urlopen(BASE + path) as resp:
            return json.loads(resp.read().decode("utf-8"))
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    proc = subprocess.Popen(
        [sys.executable, "-m", "logchain.server", "8766"],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(30):
            try:
                call("/api/state")
                break
            except Exception:
                time.sleep(0.3)
        state = call("/api/sample", {})
        rep = state["report"]
        print("sample: total=%d first_bad=%s counts=%s"
              % (rep["total"], rep["first_bad_seq"], rep["counts"]))
        assert rep["first_bad_seq"] == 1012

        detail = call("/api/record?seq=1012")
        print("detail 1012: status=%s expected=%s... actual=%s..."
              % (detail["result"]["status"],
                 detail["result"]["expected_checksum"][:12],
                 detail["result"]["actual_checksum"][:12]))
        assert detail["result"]["status"] == "mismatch"
        print("impact:", detail["impact"])

        adj = call("/api/adjudicate", {
            "seq": 1012, "verdict": "confirmed_tampered",
            "note": "登录来源 IP 被改动"})
        print("adjudication saved:", adj["adjudication"]["verdict"])

        upd = call("/api/record/update", {
            "seq": 1012, "body": "user admin login success from 10.0.0.8",
            "recompute_chain": True})
        print("update: recomputed=%d reused=%d matches_full=%s ok=%d"
              % (upd["recomputed"], upd["reused"], upd["matches_full"],
                 upd["counts"]["ok"]))
        assert upd["matches_full"] is True
        assert upd["reused"] == 11

        state2 = call("/api/state")
        adj2 = [r for r in state2["report"]["results"]
                if r.get("adjudication")]
        print("adjudications retained:", len(adj2))
        assert len(adj2) == 1
        assert adj2[0]["adjudication"]["note"] == "登录来源 IP 被改动"

        full = call("/api/verify/full", {})
        print("full reverify counts:", full["report"]["counts"])
        print("E2E OK")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
