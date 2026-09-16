# detexp — 离线确定性随机实验复现框架

用于蒙特卡洛估计、随机过程模拟等随机实验的**离线可验收**工具。同一份实验配置，
在任何机器上、无论步骤并行还是乱序执行、无论失败重试多少次，都能逐字节复现
同一结果；多来源给出矛盾配置或结果时双方留档、绝不静默择一。

* 仅依赖 Python 3.9+ 标准库，**完全离线**，不访问任何外部服务。
* 入口：`detexp.ExperimentSystem`。

## 30 秒上手

```python
from detexp import ExperimentSystem
from detexp.models import Experiment, ParameterSpec, Step, Slice

# 投点法估计 pi：1 个步骤，消耗 4000 个 [0,1) 均匀随机量
exp = Experiment(
    experiment_id="pi",
    param_specs=[ParameterSpec("n", kind="int", default=2000, required=False)],
    values={"n": 2000},
    steps=[Step("throw", "pi_dart", params={"n": 2000},
                 slices=[Slice("uniform", 4000, {"low": 0.0, "high": 1.0})])],
    seed_policy={"type": "sequence", "seeds": [101, 102, 103, 104, 105]},
)

system = ExperimentSystem()
system.register_experiment(exp)

# 顺序 / 线程并行 / 逆序调度，逐字节一致
print(system.verify_scheduling_invariance("pi", seed=42)["identical"])  # True

# 多种子批量：均值、样本方差、t 置信区间、离群种子
summary = system.batch_run("pi", ci_level=0.95)
print(summary.mean, summary.ci_low, summary.ci_high)

# 单文件保存/载入（带 SHA-256 校验和与随机流守恒复核）
system.save("bundle.json")
system2 = ExperimentSystem.load("bundle.json")
```

运行端到端演示：`python demo.py`
运行全部测试：`python -m unittest discover -t . -s tests`

## 核心概念

| 概念 | 说明 |
|---|---|
| `Experiment` | 唯一标识 `experiment_id`、参数规格 `ParameterSpec`、有序步骤 `Step`、种子策略 |
| `Step` | 声明计算函数 `fn`、参数（可用 `{"$param": "name"}` 引用实验参数）、若干 `Slice`、可选 `retries` |
| `Slice` | 声明消耗的随机量**类型**（`uniform`/`normal`/`integer`/`bernoulli`）、**数量**与分布参数 |
| 随机流 | 每个实验由 `(seed, experiment_id)` 派生一条可随机访问的 64 位字流；第 `i` 个字 `O(1)` 直接算出 |
| 运行记录 `RunRecord` | 各种子的结果、每步每切片声明/消耗量、每次重试、结果指纹与配置指纹 |
| 冲突记录 `ConflictRecord` | 矛盾的配置/结果双方内容、来源、可读差异、裁决状态 |

### 确定性从哪里来

1. **计数器式随机访问 RNG**：第 `i` 个随机量 =
   `splitmix64(key + i·GOLDEN)`，与“之前取过多少个”无关。步骤切片只是一段
   `[offset, offset+count)`，所以先跑、后跑、并行跑、失败重跑，拿到的数都相同。
2. **一个逻辑随机量固定消耗一个字**，类型只决定解释方式，切片偏移严格守恒。
3. **跨平台按位一致**：浮点路径只用 IEEE-754 四则运算与 `sqrt`；正态分布用
   Acklam 有理逆 CDF，尾部所需的 `log` 由本仓库确定性实现（`detexp.rng.det_log`），
   不调用平台相关的 libm `log`。测试中含固定黄金向量锚定数值。
4. **结果指纹**：`(seed, 各步骤状态与结果)` 的规范 JSON 做 SHA-256，
   重复执行自动比对，不一致即报“确定性自检失败”。

内置步骤函数（`detexp.steps`）：

* `pi_dart` — 单位正方形投点估计 π（`uniform`，2n 个）
* `normal_mean` — N(μ,σ²) 样本均值（`normal`，n 个；μ/σ 在切片 `draw_params` 声明）
* `bernoulli_walk` — ±1 随机游走，支持越界失败（`bernoulli`，n 个）
* `flaky_retry` — 专用于验收重试语义的可配置瞬时失败/溢出步骤
* `passthrough` — 透传参数，用于组合与测试

自定义步骤：

```python
from detexp.steps import StepContext, StepFail, register_step_fn

def my_step(ctx: StepContext, params):
    w = ctx.window(0)              # 只能读自己切片里的随机量
    x = w.draw()                   # 类型/分布由 Slice 声明，不能临时改
    if out_of_range(x):
        raise StepFail("参数越界", retryable=True)   # 触发重试
    return {"estimate": x}

register_step_fn("my_step", my_step)
```

## 八项需求与实现/验收位置

| # | 需求 | 实现 | 测试 |
|---|---|---|---|
| 1 | 实验维护、非法参数/悬空引用拒绝并指出位置 | `models.Experiment.validate`（错误带 `loc` 位置，一次收集全部） | `tests/test_validation.py` |
| 2 | 步骤声明随机量类型/数量，按顺序确定性切分、互不干扰 | `rng.DeterministicStream/RandomWindow`、`Experiment.lay_out_stream` | `tests/test_determinism.py::TestStreamLayout` |
| 3 | 并行/乱序/重复执行结果一致，执行顺序不影响随机数 | `engine.Executor`（sequential/parallel/reverse）、结果指纹 | `tests/test_determinism.py::TestSchedulingInvariance` |
| 4 | 多种子批量、均值/方差/置信区间、指出离群种子 | `analysis.analyze_estimates`（自研 t 临界值、留一法 z 分数） | `tests/test_analysis.py` |
| 5 | 越界/溢出按配置重试，重试复用原随机流、不碰后续步骤 | `engine` 每次尝试按同一 `(offset,count)` 重开窗口 | `tests/test_retry.py` |
| 6 | 矛盾配置/结果双方保留 + 可读冲突记录，禁止静默择一 | `registry.register_experiment/submit_result/resolve_conflict` | `tests/test_conflicts.py` |
| 7 | 查询结果/随机量消耗/种子/置信区间/偏离原因，稳定顺序 | `registry.get_result/get_stream_usage/query/...` | `tests/test_queries.py` |
| 8 | 单文件写入/载入，校验唯一性/步骤顺序/随机流守恒，损坏清晰报错且状态不变 | `persistence.save_bundle/load_bundle` | `tests/test_persistence.py` |

## 冲突处理（需求 6）

* `register_experiment(exp, source=...)`：同内容返回 `unchanged`；内容矛盾返回
  `conflict` 并生成 open 冲突，双方配置都保留。
* 存在未裁决的**配置冲突**时，执行/批量会被 `ConflictPendingError` 阻止
  （查询仍可用），避免静默选择任意一方。
* `resolve_conflict(cid, "a"|"b")` 显式裁决；`reject_conflict(cid)` 驳回；
  裁决后双方内容与记录仍保留，只改变状态与活动配置。
* `submit_result(eid, seed, source, status, estimate)` 登记外部结果；与本地或
  其他来源矛盾时生成 `kind="result"` 的冲突。

## 持久化文件格式

单个 UTF-8 JSON 文件（原子写入：临时文件 + `os.replace`）：

```json
{
  "format": "detexp-bundle", "version": 1,
  "checksum": {"algorithm": "sha256", "value": "…", "covers": [ … 6 个区段 ]},
  "experiments": [ … ], "variants": { … }, "runs": [ … ],
  "result_claims": [ … ], "batch_summaries": [ … ], "conflicts": [ … ]
}
```

载入按 **JSON → 格式/版本 → 校验和 → 结构 → 语义** 顺序检查：

* 校验和不匹配（任何字节被改动、缺字段）→ `IntegrityError`；
* 即使伪造校验和，仍会复核：实验/运行标识唯一、步骤顺序与配置一致、
  每个抽样随机量可按 `(seed, experiment_id, offset)` 重算且逐位相等、
  消耗不越界、布局连续、批量统计可由原始估计量重算复现；
* `load_into(path)` 在校验全部通过后才整体替换状态，**失败后系统状态不变**。

## 目录结构

```
detexp/
  errors.py        # 异常（带位置/实验信息）
  rng.py           # 确定性随机访问 RNG、随机窗口、确定性 log/逆正态
  models.py        # 实验/步骤/切片/运行记录/汇总/冲突 数据模型与校验
  steps.py         # 内置蒙特卡洛/随机过程步骤
  engine.py        # 三种调度、重试、结果指纹
  analysis.py      # t 临界值、均值方差置信区间、留一法离群检测
  persistence.py   # 单文件信封、校验和、载入守恒校验
  registry.py      # ExperimentSystem 门面
tests/             # 88 个 unittest 验收用例
demo.py            # 8 项需求的端到端离线演示
```
