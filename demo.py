#!/usr/bin/env python3
"""离线验收演示：逐条展示 detexp 的 8 项能力。

运行：``python demo.py``（仅需 Python 3.9+ 标准库，无需联网/安装依赖）。
所有数字都由确定性随机流产生，任何机器上输出一致。
"""

from __future__ import annotations

import os
import tempfile

from detexp import ExperimentSystem
from detexp.models import Experiment, ParameterSpec, Slice, Step
from detexp.errors import (
    IntegrityError,
    MultiValidationError,
    ConflictPendingError,
)
from detexp.steps import StepContext, StepFail, register_step_fn


def h(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def main() -> None:
    # ---- 1. 实验维护与非法配置拒绝 -----------------------------------
    h("1. 实验注册：参数非法 / 引用不存在参数 → 拒绝并指出位置")
    bad = Experiment(
        experiment_id="bad",
        param_specs=[ParameterSpec("n", kind="int", min=1, max=10)],
        values={"n": 99},
        steps=[Step("s", "passthrough",
                    params={"v": {"$param": "ghost"}})])
    try:
        bad.validate()
    except MultiValidationError as e:
        print(f"正确拒绝，共 {len(e.errors)} 处问题：")
        for err in e.errors:
            print("  -", err)

    pi_exp = Experiment(
        experiment_id="pi-monte-carlo",
        param_specs=[ParameterSpec("n", kind="int", default=2000,
                                   required=False, min=10, max=10_000_000)],
        values={"n": 2000},
        steps=[Step(
            "throw", "pi_dart", params={"n": 2000},
            slices=[Slice("uniform", 4000, {"low": 0.0, "high": 1.0})])],
        seed_policy={"type": "sequence", "seeds": [101, 102, 103, 104, 105]},
        description="投点法估计 pi")
    sys = ExperimentSystem()
    print("合法实验注册结果：", sys.register_experiment(pi_exp))

    # ---- 2. 随机流确定性切分 ------------------------------------------
    h("2. 随机流按步骤与消耗量切分")
    multi = Experiment(
        experiment_id="stream-demo", param_specs=[],
        steps=[
            Step("a", "flaky_retry", params={"succeed_on_attempt": 0},
                 slices=[Slice("uniform", 4)]),
            Step("b", "normal_mean", params={"n": 3},
                 slices=[Slice("normal", 3, {"mean": 5.0, "std": 0.5})]),
            Step("c", "bernoulli_walk", params={"n": 6},
                 slices=[Slice("bernoulli", 6, {"p": 0.5})]),
        ])
    sys.register_experiment(multi)
    for sl in multi.lay_out_stream():
        print(f"  步骤 {sl.step_id} 切片#{sl.slice_index}: "
              f"{sl.count} 个 {sl.kind:9s} 位于全局偏移 [{sl.offset}, "
              f"{sl.offset + sl.count})")

    # ---- 3. 顺序/并行/逆序结果一致 ------------------------------------
    h("3. 同一实验：顺序 / 并行 / 逆序调度，结果逐字节一致")
    report = sys.verify_scheduling_invariance("stream-demo", seed=77)
    for mode, fp in report["fingerprints"].items():
        print(f"  {mode:10s} fingerprint={fp[:24]}…")
    print("  完全一致：", report["identical"])

    # ---- 4. 多种子批量：均值/方差/置信区间/离群 -----------------------
    h("4. 多种子批量运行与统计汇总")
    summary = sys.batch_run("pi-monte-carlo", ci_level=0.95)
    print(f"  种子：{summary.seeds}")
    print(f"  均值={summary.mean:.5f}  样本方差={summary.variance:.3e}  "
          f"标准差={summary.std:.5f}")
    print(f"  95% 置信区间：[{summary.ci_low:.5f}, {summary.ci_high:.5f}]")
    print("  离群种子：", [o.seed for o in summary.outliers] or "无")

    # 构造一个含离群种子的实验
    def outlier_step(ctx: StepContext, params):
        w = ctx.window(0)
        w.draw_many(w.count)
        return {"estimate": 10.0 if ctx.seed == 4242 else 1.0}
    register_step_fn("outlier_demo", outlier_step)
    out_exp = Experiment(
        experiment_id="outlier-demo", param_specs=[],
        steps=[Step("r", "outlier_demo", slices=[Slice("uniform", 1)])])
    sys.register_experiment(out_exp)
    bs = sys.batch_run("outlier-demo", seeds=[1, 2, 3, 4, 4242])
    print("  离群实验标记：", [o.seed for o in bs.outliers])
    print("  偏离原因：", sys.get_outlier_reason("outlier-demo", 4242))

    # ---- 5. 失败重试复用原有随机流 ------------------------------------
    h("5. 参数越界/溢出失败后重试：复用原随机流，不消耗后续步骤")
    retry_exp = Experiment(
        experiment_id="retry-demo", param_specs=[],
        steps=[
            Step("flaky", "flaky_retry",
                 params={"fail_before": 2, "succeed_on_attempt": 2},
                 slices=[Slice("uniform", 5)]),
            Step("after", "normal_mean", params={"n": 2},
                 slices=[Slice("normal", 2, {"mean": 0.0, "std": 1.0})]),
        ], default_retries=3)
    sys.register_experiment(retry_exp)
    rec = sys.run("retry-demo", seed=9)
    flaky, after = rec.step_records
    print(f"  flaky 尝试次数={len(flaky.attempts)}（offset 0..4 每次从头重放）")
    print(f"  after 的随机量偏移："
          f"{[p[0] for p in after.slices[0].sample_draws]}（仍从 5 开始）")
    print(f"  总重试次数={rec.retries_total}，整体状态={rec.status}")

    # ---- 6. 矛盾配置/结果双方保留 + 冲突记录 ---------------------------
    h("6. 多来源矛盾：双方保留，生成可读冲突记录，禁止静默择一")
    cfg_a = Experiment(
        experiment_id="disputed", param_specs=[],
        steps=[Step("s", "normal_mean", params={"n": 20},
                    slices=[Slice("normal", 20)])])
    cfg_b = Experiment(
        experiment_id="disputed", param_specs=[],
        steps=[Step("s", "normal_mean", params={"n": 80},
                    slices=[Slice("normal", 80)])])
    sys.register_experiment(cfg_a, source="lab-beijing")
    sys.register_experiment(cfg_b, source="lab-shanghai")
    conflict = sys.list_conflicts(kind="config")[0]
    print("  冲突记录：", conflict.conflict_id, conflict.status)
    print("  ", conflict.detail)
    try:
        sys.run("disputed", seed=1)
    except ConflictPendingError as e:
        print("  未裁决时执行被阻止：", e)
    sys.resolve_conflict(conflict.conflict_id, "a")
    rec = sys.run("disputed", seed=1)
    print("  裁决保留 A 后，实际 n =",
          rec.step_records[0].result["n"], "（B 仍保留在记录中）")

    # ---- 7. 稳定顺序查询 ----------------------------------------------
    h("7. 查询：结果 / 随机量消耗 / 种子 / 置信区间 / 偏离原因")
    q = sys.query("pi-monte-carlo")
    print("  种子（升序）：", q["seeds"])
    print("  流声明总量：", q["stream_usage"]["total_declared"])
    print("  置信区间：",
          {k: round(v, 5) if isinstance(v, float) else v
           for k, v in q["confidence_interval"].items()
           if k in ("ci_level", "mean", "ci_low", "ci_high")})
    print("  各种子结果（稳定顺序）：")
    for r in q["result"]["runs"]:
        print(f"    seed={r['seed']:4d}  estimate={r['estimate']:.5f}  "
              f"status={r['status']}")

    # ---- 8. 单文件保存/载入与损坏检测 ---------------------------------
    h("8. 单文件保存 / 重新载入 / 损坏报错且状态不变")
    path = os.path.join(tempfile.gettempdir(), "detexp-demo-bundle.json")
    sys.save(path)
    print("  已保存：", path, f"（{os.path.getsize(path)} 字节）")
    loaded = ExperimentSystem.load(path)
    q1 = sys.query("stream-demo")
    q2 = loaded.query("stream-demo")
    from detexp.engine import canonical_json
    print("  载入后查询与保存前一致：",
          canonical_json(q1) == canonical_json(q2))

    raw = open(path, "rb").read()
    # 8a. 直接改坏（checksum 拦截）
    import json
    doc = json.loads(raw.decode())
    doc["runs"][0]["estimate"] = 999.0
    try:
        from detexp.persistence import load_bundle_bytes
        load_bundle_bytes(json.dumps(doc).encode(), "<tampered>")
    except IntegrityError as e:
        print("  篡改运行结果被拦截：", str(e).splitlines()[0][:80])

    # 8b. 伪造 checksum 后篡改随机量（守恒校验拦截）
    from detexp.persistence import bundle_checksum, COVERED_SECTIONS
    doc2 = json.loads(raw.decode())
    doc2["runs"][0]["step_records"][0]["slices"][0]["sample_draws"][0][1] \
        = 0.123456
    body = {k: doc2.get(k, [] if k != "variants" else {})
            for k in COVERED_SECTIONS}
    doc2["checksum"]["value"] = bundle_checksum(body)
    try:
        load_bundle_bytes(json.dumps(doc2).encode(), "<forged>")
    except IntegrityError as e:
        print("  伪造校验和后篡改随机量仍被拦截：",
              str(e).splitlines()[0][:80])

    print("\n演示完成：全部 8 项能力离线可验收。")


if __name__ == "__main__":
    main()
