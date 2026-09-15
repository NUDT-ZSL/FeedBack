# 经营指标台账(metric-ledger)

离线可验收的经营指标台账模块:把**指标定义、口径版本、依赖关系、原始数据和历史结果**
串成一条可追溯的链路。纯 Python 实现,零第三方依赖,数值一律用 `Fraction` 精确运算,
保证"增量重算 ≡ 从头全量重算"可以逐位比对。

```
metric_ledger/
  expressions.py   # 口径公式 DSL:解析(带位置报错)、引用提取、规范渲染
  ledger.py        # 台账核心:版本管理 / 上报 / 计算 / 溯源 / 轨迹 / 重算
tests/
  test_ledger.py   # 34 个验收测试,逐条对应需求 1-8
```

运行测试:`python -m pytest tests/ -q`

## 快速上手

```python
from metric_ledger import MetricLedger

clock = [100]
led = MetricLedger(clock=lambda: clock[0])   # 可注入逻辑时钟

# 1. 声明原始数据字段与指标(公式只能引用已声明的指标/字段/常量)
led.declare_field("revenue"); led.declare_field("refund"); led.declare_field("orders")
led.define_metric("net", [(0, "revenue - refund")])
led.define_metric("aov", [(0, "net / orders")])

# 2. 上报原始数据(幂等;矛盾来源双方都保留并生成冲突记录)
led.ingest("revenue", 100, source="系统A")        # 时刻取逻辑时钟 100
led.ingest("refund", 10, time=100)
led.ingest("orders", 4, time=100)

# 3. 查询:使用该时刻生效口径逐层计算
led.query("aov", 100).value        # Fraction(45, 2)

# 4. 口径变更:只重算受影响指标与时段,并留痕
led.add_version("aov", 200, "net / (orders + 1)")

# 5. 溯源 / 轨迹 / 不连续点
led.explain("aov", 200)            # 完整来源链:口径版本、依赖、各自贡献
led.trajectory("aov", 0, 300)      # 口径切换轨迹 + 差异归因
led.discontinuities("aov", 0, 300) # 切换时刻附近的不连续点(不静默拼接)
led.verify_consistency()           # 物化结果 vs 从头全量计算,应为 []
```

## 需求映射

| # | 需求 | 实现 |
|---|------|------|
| 1 | 指标 + 按逻辑时刻排序的口径版本,同一时刻最多一个生效版本 | `define_metric` / `add_version`;重复生效时刻、空版本组、同名冲突一律 `LedgerError` 并指出位置(第几个版本、t=?) |
| 2 | 只能引用已声明指标/字段/常量,依赖不成环 | 定义时校验引用;`add_version` 后以被改指标为起点做环检测,报错给出完整指标链(如 `net -> scale -> aov -> net`),非法变更整体回滚 |
| 3 | 可注入逻辑时钟;重复上报幂等;矛盾来源保留 + 可读冲突记录 | `MetricLedger(clock=...)`;完全相同的 (字段,时刻,来源,值) 为幂等空操作;同字段同时刻不同值全部保留于 `conflicts()`,该时刻按缺失(冲突)参与计算 |
| 4 | 按生效口径逐层计算,缺失显式标注不为零 | `query(metric, t)` 沿依赖链同层同时刻计算;缺失原因:`no_data` / `conflict` / `division_by_zero` / `no_spec_version`,沿链传播,绝不静默当零 |
| 5 | 口径变更只重算受影响指标与时段,与全量一致 | 变更影响范围 = 该指标及其传递下游 × `[生效时刻, 下一版本生效时刻)`;重算记录含 `affected_metrics/affected_times/changes`;`verify_consistency()` 用从头全量计算校验物化结果 |
| 6 | 完整来源链,重复查询结果与顺序一致 | `explain(metric, t)`:每层记录口径版本号、规范公式、各依赖贡献值;结果不可变、顺序按公式引用序,重复查询逐字节一致 |
| 7 | 口径切换轨迹,差异归因到具体依赖 | `trajectory(metric, start, end)`:每次切换给出生效时刻、前后版本/公式、同一时刻按旧/新口径的取值与差值,以及逐依赖的 `added/removed/retained` 归因 |
| 8 | 切换时刻附近不连续必须报告 | `discontinuities(metric, start, end)`:比较 T-1(旧口径)与 T(新口径),跳变(`value_jump`)、出现(`appears`)、消失(`vanishes`)都报告并附归因,绝不静默拼接 |

## 关键设计决策

- **精确算术**:所有数值为 `Fraction`(int/Decimal/字符串/浮点输入均精确转换),
  增量重算与全量重算可严格相等比对,不存在浮点漂移。
- **物化 + 定向重算**:计算结果物化在结果存储中;数据上报只重算"(传递)依赖该字段的
  指标 × 该时刻",口径变更只重算"该指标及下游 × 受影响时段",未受影响的条目对象级不变。
- **版本号稳定**:口径版本号按创建顺序分配,中间插入版本不会导致已有版本重新编号,
  历史来源链中的版本引用永远有效。
- **缺失是一等公民**:无数据、冲突、除零、无生效口径都是带原因的显式标注,
  沿依赖链传播并进入来源链与冲突记录,任何缺失都不会被当作零。
- **确定性**:来源链、轨迹、重算日志的顺序全部由公式引用顺序 / 排序键决定,
  同样的操作序列重放必然得到逐字节一致的结果。
