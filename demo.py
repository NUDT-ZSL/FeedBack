#!/usr/bin/env python3
"""端到端演示：蒙特卡洛估计 + 随机过程模拟的离线可验收复现。

运行：
    python demo.py            # 正常演示（含冲突与重试）
    python demo.py verify     # 重跑并逐指纹比对（演示"验收"）

演示覆盖：
  1. 注册实验（参数校验、步骤引用校验）
  2. 顺序 vs 并行执行：逐指纹相同
  3. 多种子批量：均值/方差/95% 置信区间/离群种子原因
  4. 步骤失败重试：复用原随机流，不消耗后续步骤随机量
  5. 多来源矛盾配置/结果：双方保留 + 可读冲突记录
  6. 单文件保存/重新载入：指纹一致、篡改即报错
"""
import json
import os
import sys
import tempfile

from rng_core import (
    Registry, parse_experiment, save, load,
    AmbiguousReferenceError, StoreCorruptError,
)

# --------------------------------------------------------------------------- #
# 实验一：蒙特卡洛估计伯努利频率
# --------------------------------------------------------------------------- #
BERNOULLI_EXP = {
    "id": "coin_monte_carlo",
    "source": "lab-a",
    "description": "估计正面概率 p 的蒙特卡洛实验",
    "seed_policy": {"mode": "list", "seeds": [101, 202, 303, 404, 505,
                                              606, 707, 808]},
    "params": [
        {"name": "n", "type": "int", "default": 20000, "min": 1,
         "max": 1_000_000, "description": "每个种子的投掷次数"},
        {"name": "p", "type": "float", "default": 0.5, "min": 0.0,
         "max": 1.0, "description": "真实正面概率"},
    ],
    "steps": [
        {"id": "toss", "handler": "bernoulli_count",
         "draws": [
             {"id": "trials", "type": "bernoulli", "count": "$params.n",
              "params": {"p": "$params.p"}}
         ]},
        # 第二步引用第一步输出与当前种子，演示跨步骤引用链
        {"id": "check", "handler": "combine",
         "params": {"a": "$steps.toss.successes", "b": "$seed"},
         "depends_on": ["toss"]},
    ],
}

# --------------------------------------------------------------------------- #
# 实验二：带瞬时数值故障的实验（演示重试）
# --------------------------------------------------------------------------- #
RETRY_EXP = {
    "id": "flaky_process",
    "source": "lab-a",
    "seed_policy": {"mode": "fixed", "seed": 77},
    "params": [
        {"name": "fail_first_n", "type": "int", "default": 2,
         "min": 0, "max": 5},
    ],
    "steps": [
        {"id": "risky", "handler": "flaky_overflow",
         "params": {"fail_first_n": "$params.fail_first_n"},
         "draws": [{"id": "samples", "type": "gaussian",
                    "count": 1000, "params": {"mu": 1.0, "sigma": 2.0}}],
         "retry": {"max_attempts": 4,
                   "retry_on": ["overflow", "value_error"]}},
        {"id": "downstream", "handler": "sample_mean",
         "draws": [{"id": "samples", "type": "uniform",
                    "count": 500, "params": {"low": 0, "high": 1}}]},
    ],
}


def hr(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def main() -> int:
    reg = Registry()

    # ---------- 1. 注册（声明期校验） ----------
    hr("1) 注册实验：非法参数 / 非法引用会被拒绝并指出位置")
    reg.register_experiment(parse_experiment(BERNOULLI_EXP))
    reg.register_experiment(parse_experiment(RETRY_EXP))
    bad = json.loads(json.dumps(BERNOULLI_EXP))
    bad["steps"][0]["draws"][0]["count"] = "$params.ghost"
    try:
        parse_experiment(bad)
    except Exception as exc:
        print("拒绝非法配置 ->", exc)

    # ---------- 2. 顺序 vs 并行 ----------
    hr("2) 同一实验：顺序执行 vs 线程并行，指纹逐位相同")
    spec = reg.get_experiment("coin_monte_carlo")
    fps = {"sequential": [], "parallel": []}
    for seed in [101, 202, 303]:
        fps["sequential"].append(
            reg.engine.run(spec, seed, {}, parallel=False).fingerprint)
        fps["parallel"].append(
            reg.engine.run(spec, seed, {}, parallel=True).fingerprint)
    print("顺序指纹:", fps["sequential"])
    print("并行指纹:", fps["parallel"])
    print("完全一致:", fps["sequential"] == fps["parallel"])

    # ---------- 3. 多种子批量统计 ----------
    hr("3) 多种子批量：均值 / 方差 / 95% 置信区间 / 离群种子")
    report = reg.run_batch(
        "coin_monte_carlo", [("p_hat", "toss", "p_hat")], source="lab-a")
    summ = report.summaries[0]
    print(f"有效种子数 n = {summ.n}")
    print(f"均值 = {summ.mean:.6f}  样本方差 = {summ.variance:.3e}")
    print(f"95% CI = [{summ.ci_low:.6f}, {summ.ci_high:.6f}]")
    print("各种子（按种子稳定排序）：")
    for row in summ.rows:
        flag = "  <== 离群" if row.is_outlier else ""
        rz = f"{row.robust_z:+.2f}" if row.robust_z is not None else "  n/a"
        print(f"  seed={row.seed:<4} p_hat={row.value:.5f} "
              f"robust_z={rz}{flag}")
    print("查询示例 explain_outlier(seed=101):")
    print("  ", reg.explain_outlier("coin_monte_carlo", "p_hat", 101)["reason"])

    # ---------- 4. 重试复用原流 ----------
    hr("4) 步骤前 2 次数值溢出：重试倒回重播，不借用后续步骤随机量")
    r_retry = reg.run("flaky_process", 77, source="lab-a", parallel=True)
    risky = next(s for s in r_retry.steps if s.sid == "risky")
    downstream = next(s for s in r_retry.steps if s.sid == "downstream")
    print(f"risky 尝试序列: {[(a.attempt, a.status, a.category) for a in risky.attempts]}")
    print(f"重放次数 = {risky.replayed_attempts}，流键数 = "
          f"{len(risky.stream_keys)}（重试不新增随机流）")
    print(f"声明 {risky.declared_draws} == 消耗 {risky.consumed_draws}")
    # 对照组：从不失败时下游输出必须完全一致
    r0 = reg.engine.run(reg.get_experiment("flaky_process"), 77,
                        {"fail_first_n": 0})
    same = r0.steps[1].output == downstream.output
    print(f"与“从不失败”运行的下游步骤输出一致: {same}")

    # ---------- 5. 多来源冲突 ----------
    hr("5) 多来源矛盾：双方都保留 + 可读冲突记录，拒绝静默择一")
    other = json.loads(json.dumps(BERNOULLI_EXP))
    other["source"] = "lab-b"
    other["params"][0]["default"] = 999  # 矛盾配置
    outcome = reg.register_experiment(parse_experiment(other))
    print("登记第二份配置 ->", outcome)
    try:
        reg.get_experiment("coin_monte_carlo")
    except AmbiguousReferenceError as exc:
        print("未指定来源即报错 ->", exc)
    conflict = next(c for c in reg.conflicts("coin_monte_carlo")
                    if c.kind == "config")
    print(conflict.render().splitlines()[0])
    print("仍可显式取双方: lab-a n =",
          reg.get_experiment("coin_monte_carlo", "lab-a").params[0].default,
          "| lab-b n =",
          reg.get_experiment("coin_monte_carlo", "lab-b").params[0].default)

    # 矛盾结果：外部实验室提交了同种子的不同结果
    foreign = reg.engine.run(spec, 101, {"n": 500})
    print("外部结果登记 ->", reg.store_result(foreign, "external-lab"))
    result_conflict = next(c for c in reg.conflicts("coin_monte_carlo")
                           if c.kind == "result")
    print("结果冲突记录:", result_conflict.render().splitlines()[0])

    # ---------- 6. 单文件保存 / 载入 / 防篡改 ----------
    hr("6) 写成单文件并重新载入：结果、冲突、统计全部保留")
    path = os.path.join(tempfile.gettempdir(), "rng_core_demo_store.json")
    save(reg, path)
    print("已保存:", path)
    reg2 = load(path)
    fp1 = reg.get_result("coin_monte_carlo", 101, "lab-a").fingerprint
    fp2 = reg2.get_result("coin_monte_carlo", 101, "lab-a").fingerprint
    ci1 = reg.confidence_interval("coin_monte_carlo", "p_hat")
    ci2 = reg2.confidence_interval("coin_monte_carlo", "p_hat")
    print("载入后指纹一致:", fp1 == fp2)
    print("载入后 CI 一致:", abs(ci1["ci_low"] - ci2["ci_low"]) < 1e-12
          and abs(ci1["ci_high"] - ci2["ci_high"]) < 1e-12)
    print("冲突记录数:", len(reg.conflicts()), "->", len(reg2.conflicts()))

    if len(sys.argv) > 1 and sys.argv[1] == "verify":
        hr("验收模式：重跑全部种子并逐指纹比对")
        ok = True
        for seed in report.seeds:
            fresh = reg.engine.run(spec, seed, {}, parallel=True)
            stored = reg2.get_result("coin_monte_carlo", seed, "lab-a")
            same_fp = fresh.fingerprint == stored.fingerprint
            ok &= same_fp
            print(f"  seed={seed:<4} {'OK' if same_fp else 'MISMATCH'}")
        print("验收结论:", "PASS ✅" if ok else "FAIL ❌")
        return 0 if ok else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
