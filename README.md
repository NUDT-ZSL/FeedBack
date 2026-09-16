# rng_core：离线可验收的确定性随机实验复现工具

一套**零第三方依赖、完全离线**的 Python 模块，用于蒙特卡洛估计、随机过程模拟等
随机实验的定义、执行、批量统计、冲突留痕与单文件存档。核心承诺：

> 同一份实验配置 + 同一个种子，在**任何机器、任何执行顺序（顺序/并行）、任何
> 执行次数**下，得到逐位相同的结果（以 SHA-256 指纹固化）。

- 运行环境：Python 3.9+，仅标准库（`hashlib`、`concurrent.futures`、`json`…）
- 测试：`python -m unittest discover -s tests`（67 个用例）
- 演示：`python demo.py`，验收模式：`python demo.py verify`

---

## 1. 它解决什么问题（对照需求）

| # | 需求 | 实现方式 |
|---|------|----------|
| 1 | 实验有唯一标识、种子策略、参数、有序步骤；非法配置带位置拒绝 | `models.parse_experiment` 在注册/载入阶段校验，错误形如 `steps.[2].draws.[0].count: …` |
| 2 | 步骤声明随机量类型与数量；随机流按步骤与消耗量确定性切分 | 每个 `(实验, 种子, 步骤序号, 抽签id, 类型)` 是独立计数器流（`rng.py`）；处理器只能拿到预算数组，无法越界抽取 |
| 3 | 并行/顺序/重复执行结果完全一致 | 流的派生不含执行序；引擎按拓扑分层线程调度，记录按步骤序号落库；指纹逐位相等（`test_engine.py`、`test_golden.py`） |
| 4 | 多种子批量：均值/方差/置信区间 + 离群种子 | `batch.py`：样本均值、样本方差、t 分位数置信区间（标准库数值反解，无需 scipy）、稳健 z(MAD) + 经典 z 双口径离群判定与文字原因 |
| 5 | 步骤失败按配置重试，复用原有随机流，不消耗后续步骤 | 重试时把**本步骤流整体倒回重播**并逐元素核对；流键数量不变；后续步骤的流键与重试次数无关 |
| 6 | 多来源矛盾配置/结果：双方保留 + 可读冲突记录，禁止静默择一 | `Registry` 按来源全量保留；此后必须 `source=` 显式指定，否则抛 `AmbiguousReferenceError`；冲突记录含实验、来源、各方内容 |
| 7 | 查询当前结果、随机量消耗、种子、置信区间、离群原因；稳定顺序 | `get_result / consumed_draws / seed_info / confidence_interval / explain_outlier / outliers / list_results`，一律按 id、种子、步骤序号排序 |
| 8 | 单文件写入/重载；校验唯一性、步骤顺序、随机流守恒；损坏清晰报错且失败后状态不变 | `persistence.save/load`：原子写单 JSON；载入重放声明校验、指纹复算、守恒核对、统计重算、冲突交叉核对；先构建到新实例，成功才返回 |

---

## 2. 五分钟上手

```python
from rng_core import Registry, parse_experiment, save, load

wire = {
    "id": "coin",
    "source": "lab-a",
    "seed_policy": {"mode": "list", "seeds": [1, 2, 3, 4, 5, 6, 7, 8]},
    "params": [
        {"name": "n", "type": "int", "default": 20000, "min": 1, "max": 1_000_000},
        {"name": "p", "type": "float", "default": 0.5, "min": 0.0, "max": 1.0},
    ],
    "steps": [
        {"id": "toss", "handler": "bernoulli_count",
         "draws": [{"id": "trials", "type": "bernoulli",
                    "count": "$params.n",
                    "params": {"p": "$params.p"}}]},
        {"id": "diag", "handler": "combine",
         "params": {"a": "$steps.toss.successes", "b": "$seed"},
         "depends_on": ["toss"]},
    ],
}

reg = Registry()
reg.register_experiment(parse_experiment(wire))

# 顺序与并行逐指纹相同
r1 = reg.run("coin", seed=1, parallel=False)
r2 = reg.run("coin", seed=1, parallel=True)
assert r1.fingerprint == r2.fingerprint

# 多种子批量 + 置信区间 + 离群原因
report = reg.run_batch("coin", [("p_hat", "toss", "p_hat")], source="lab-a")
s = report.summaries[0]
print(s.mean, s.variance, (s.ci_low, s.ci_high))
print(reg.explain_outlier("coin", "p_hat", seed=1)["reason"])

# 存档 / 重载 / 验收
save(reg, "store.json")
reg2 = load("store.json")
assert reg2.get_result("coin", 1).fingerprint == r1.fingerprint
```

---

## 3. 确定性是怎么做到的

不使用任何全局随机状态，也不依赖 `random.Random`（其算法在不同版本间可能变化）。
每个随机数来自：

```
SHA-256("rng-core/v1|exp=<实验id>|seed=<种子>|step=<步骤序号>"
        "|draw=<抽签id>|type=<uniform|integer|bernoulli|gaussian>|block=<块号>")
```

- SHA-256 的字节输出有跨平台标准，Python 只做固定字节序解析；
- **步骤序号**而非完成时刻进入键，因此线程调度无法影响结果；
- 每个随机类型有独立块计数器；`integer` 用拒绝采样消除模偏差；
  `gaussian` 用 Box–Muller，53 位尾数均匀网格；
- 处理器拿不到流对象，只拿到引擎按声明预算切好的数组，
  所以"多抽/偷看后续步骤"在接口层面就不可能；
- 重试调用 `RandomStream.rewind()` 把计数器清零后重放，
  引擎额外逐元素比对重放值与首次值，任何不一致直接报错。

内置处理器：`sample_mean`、`bernoulli_count`、`integer_sum`、`gaussian_walk`、
`combine`（跨步骤引用）、`flaky_overflow`（演示重试的瞬时故障例程）。

### 自定义步骤处理器

```python
from rng_core import HandlerRegistry, StepContext, StepFailure

def my_estimator(ctx: StepContext) -> dict:
    xs = ctx.draws["samples"]          # 长度恰好等于声明的 count
    if not xs:
        raise StepFailure("空样本", category="value_error")
    return {"stat": sum(xs) / len(xs)} # 必须是可 JSON 化、全有限值的 dict

handlers = HandlerRegistry()
# 也可先 build_default_registry() 再追加
handlers.register("my_estimator", my_estimator)
Registry(handler_registry=handlers)
```

失败类别：`value_error` / `overflow` / `invalid_param`。步骤的
`retry.retry_on` 决定哪些类别允许重试。

---

## 4. 实验配置格式（JSON/Python dict）

```jsonc
{
  "id": "walk",                       // 实验唯一标识：[A-Za-z0-9_.-]+
  "source": "lab-a",                  // 配置来源标签
  "seed_policy": { "mode": "derive", "base_seed": 0, "count": 8 },
  "params": [
    {"name": "n", "type": "int", "default": 1000, "min": 1, "max": 100000},
    {"name": "algo", "type": "enum", "choices": ["a", "b"], "default": "a"}
  ],
  "steps": [
    {
      "id": "inc",                    // 实验内唯一
      "handler": "gaussian_walk",
      "draws": [
        {"id": "increments", "type": "gaussian", "count": "$params.n",
         "params": {"mu": 0.0, "sigma": 1.0}}
      ],
      "params": {"start": 0.0},
      "retry": {"max_attempts": 3, "retry_on": ["overflow", "value_error"]},
      "depends_on": []
    }
  ]
}
```

- **参数类型**：`int / float / bool / string / enum`，支持 `required/default/min/max/choices`。
- **引用**（只能出现在步骤参数、抽签数量与分布参数中）：
  - `$params.<名>`：实验参数；
  - `$seed`：本次运行的种子；
  - `$steps.<更早步骤id>.<输出字段路径>`：前序步骤输出。
  - 只能引用**编号更早**的步骤；引用不存在的参数/步骤、前向引用都会被拒绝并指出位置。
- **随机类型**：`uniform(low,high)`、`integer(low,high)`（闭区间）、
  `bernoulli(p)`、`gaussian(mu,sigma)`。`count` 为正整数或参数引用。
- **种子策略**：
  - `{"mode":"fixed","seed":42}` 单种子；
  - `{"mode":"list","seeds":[...]}` 显式列表（不可重复）；
  - `{"mode":"derive","base_seed":0,"count":K}` 由实验 id 确定性派生 K 个种子，
    排序稳定，改实验 id 即换一组种子。
- **并行调度**：无依赖的步骤自动同层并行（`run(..., parallel=True)`），
  批量也可 `parallel_seeds=True`。某步骤失败时，只跳过（传递）依赖它的步骤，
  与它独立的步骤照常执行——顺序与并行语义因此严格一致。

---

## 5. 批量统计与离群说明

- 统计量：`mean`（均值）、`variance`（无偏样本方差）、`std_error`、
  `median`、`mad`（中位数绝对偏差）、`ci_low/ci_high`
  （置信度默认 0.95，t 分布分位数由正则化不完全 Beta 函数反解）。
- 离群判定：优先**稳健 z** `0.6745·(x−median)/MAD`，阈值默认 3.5；
  MAD 退化（半数以上取值相同）时回退经典 z（阈值默认 3）。
  每个种子都有可读 `reason`，写清基准、方向、偏离量，例如：

  `稳健 z=-5.37，绝对值超过阈值 3.5：相对中位数 0.501937 偏低 0.013937（MAD=0.00175），偏离整体分布`

- 运行失败的种子不参与统计，行内注明失败原因。

---

## 6. 多来源与冲突

任何对象都按来源保存，**永不覆盖、永不静默择一**：

```python
reg.register_experiment(parse_experiment(wire_lab_a))
reg.register_experiment(parse_experiment(wire_lab_b))   # 内容不同 -> "conflict"

reg.get_experiment("coin")                       # 抛 AmbiguousReferenceError
reg.get_experiment("coin", source="lab-a")       # 显式取 A 方
reg.get_experiment("coin", source="lab-b")       # 显式取 B 方
for c in reg.conflicts("coin"):
    print(c.render())                            # 实验、双方来源、各方内容
```

- 配置、单次结果（按 实验×种子）、批量汇总三类对象都有冲突记录；
- 同一来源再次提交**不同**结果也不会覆盖旧值，自动分配 `来源#v2` 标签并记冲突；
- 内容一致的多来源返回 `"consistent"`，不产生冲突记录。

---

## 7. 单文件持久化与载入校验

`save(reg, path)` 原子写入（临时文件 + `os.replace`）一个 UTF-8 JSON 文件，
内含实验配置（各方版本及其摘要）、全部运行记录、批量汇总、冲突记录与运行参数。

`load(path)` 返回**全新** Registry；任何校验失败抛 `StoreCorruptError`
（消息带 JSON 路径），且不会影响任何已存在的实例（失败后状态不变）。校验包括：

1. JSON 可解析、格式版本、顶层字段齐全、整体 `content_hash`（防截断/篡改）；
2. 实验标识与来源唯一，重放全部声明期校验（参数非法、步骤顺序、引用合法性）；
3. 运行步骤序号连续且与某一配置版本一一对应；尝试序列自洽；
   **指纹复算逐字符一致**（改任意输出立即报）；每步声明量 = 消耗量、
   流键唯一且归属本运行、重试不产生新流键（随机流守恒）；
4. 汇总每行取值能在运行记录中找到一致来源；均值/方差/中位数/MAD/CI 按行重算一致；
5. 冲突记录与"数据里真实存在的矛盾"集合**严格一一对应**：漏报、多报都算损坏。

---

## 8. 查询 API（全部稳定顺序）

| API | 回答 |
|-----|------|
| `experiment_ids()` / `sources_for(eid)` | 有哪些实验 / 某实验的来源 |
| `get_result(eid, seed, source=None)` | 当前结果（含每步输出、尝试序列、指纹） |
| `list_results(eid)` | `(种子, 来源, 状态)`，按种子/来源排序 |
| `seed_info(eid)` | 策略种子集合与已执行种子 |
| `consumed_draws(eid, seed)` | 每步声明/实际消耗、读取块数、流键、重播次数 |
| `confidence_interval(eid, estimator)` | n、均值、方差、标准误、置信水平、CI、种子 |
| `explain_outlier(eid, estimator, seed)` | 该种子取值、两套 z、是否离群及文字原因 |
| `outliers(eid, estimator)` | 所有离群种子及原因 |
| `conflicts(eid=None)` / `ConflictRecord.render()` | 冲突记录（可读长文本） |

---

## 9. 目录结构

```
rng_core/
  __init__.py      # 公共 API 导出
  rng.py           # SHA-256 计数器模式确定性随机流
  models.py        # 规格数据类、声明期校验、引用解析、wire 序列化
  handlers.py      # 处理器注册表与内置处理器
  engine.py        # 拓扑分层执行、并行、重试重播、守恒核对、指纹
  batch.py         # 多种子批量、t 分位数、均值/方差/CI、稳健离群
  registry.py      # 多来源登记、冲突留痕、稳定查询
  persistence.py   # 单文件原子写入与严格载入校验
tests/             # 67 个 unittest 用例（含黄金值/跨进程用例）
demo.py            # 端到端演示与 verify 验收模式
```

## 10. 验收建议

```bash
python -m unittest discover -s tests -v   # 全部用例
python demo.py verify                      # 重跑并逐指纹比对
```

`tests/test_golden.py` 固化了一组黄金指纹；由于流派生只依赖标准库规定的字节运算，
换机器、换操作系统、换 Python 小版本都应保持通过。若未来需要演进流算法，
请提升 `rng.py` 中的 `SCHEMA_VERSION`，旧版本文件仍由格式版本字段识别。
