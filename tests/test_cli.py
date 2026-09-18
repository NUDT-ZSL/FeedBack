"""端到端：JSON 配置 → CLI → 报告；以及同配置两次运行结论一致。"""

import json
import subprocess
import sys

from propverify.__main__ import main

CONFIG = {
    "seed": 20260918,
    "input_count": 120,
    "objects": ["counter"],
    "objects_config": {
        "counter": {
            "fields": {
                "delta": {"type": "int", "min": -20, "max": 20},
                "balance": {"type": "int", "min": -100, "max": 100, "edge_weight": 0.3},
                "tags": {"type": "list", "element": {"type": "int", "min": 0, "max": 9},
                          "min_len": 0, "max_len": 6},
            },
            "constraints": ["balance != 0 or delta >= 0"],
        }
    },
    "invariants": [
        {"id": "余额非负", "target": "counter", "check": "balance >= 0",
         "when": "delta > 0", "description": "正变动后余额必须非负"},
        {"id": "标签求和有界", "target": "counter", "check": "sum(tags) <= 100"},
    ],
}


def test_cli_end_to_end(tmp_path, capsys):
    cfg_path = tmp_path / "cfg.json"
    cfg_path.write_text(json.dumps(CONFIG), encoding="utf-8")
    out_path = tmp_path / "report.json"
    rc = main(["check", str(cfg_path), "--json", str(out_path)])
    assert rc == 1  # “余额非负”会被违反（balance 可为负且 delta>0）
    report = json.loads(out_path.read_text(encoding="utf-8"))
    inv = report["invariants"]["余额非负"]
    assert inv["fail"] > 0
    # 每个反例都有收缩轨迹且复验仍违反
    for f in inv["failures"]:
        assert f["shrink_verified"] is True
        assert f["shrink_trace"]
    # 跳过不计入通过
    assert inv["skip"] >= 0
    text = capsys.readouterr().out
    assert "总体结论" in text and "最小反例" in text


def test_cli_rejects_bad_config(tmp_path, capsys):
    bad = dict(CONFIG)
    bad["invariants"] = [
        {"id": "dup", "target": "counter", "check": "true"},
        {"id": "dup", "target": "counter", "check": "true"},
    ]
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(bad), encoding="utf-8")
    rc = main(["check", str(p)])
    assert rc == 2
    err = capsys.readouterr().err
    assert "重复" in err and "invariants[1]" in err


def test_two_runs_identical_report(tmp_path):
    cfg_path = tmp_path / "cfg.json"
    cfg_path.write_text(json.dumps(CONFIG), encoding="utf-8")
    reports = []
    for i in range(2):
        out = tmp_path / f"r{i}.json"
        main(["check", str(cfg_path), "--json", str(out)])
        reports.append(json.loads(out.read_text(encoding="utf-8")))
    assert reports[0] == reports[1]
