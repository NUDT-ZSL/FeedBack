# 移动轨迹推演：离线自动化验证

本目录下的验证体系让「同样的位置点集合 + 同样的判定参数」在任意时刻得到
**可复现、可追溯** 的分段与同行结论，并在输入被修正后 **只重推受影响部分**，
且与全量重推结论完全一致。全部使用本地构造样例，不依赖网络与任何外部服务。

## 运行方式

```bash
npm run verify:trajectory   # 统一批量入口（等价于 node tests/run.ts）
# 或单独跑某个套件
node --test tests/trajectory/segmentation.test.ts
```

要求 Node.js ≥ 22.18（原生 TypeScript 类型擦除 + 内置 test runner），
无需 `npm install`，完全离线可重复执行。

## 模块构成

| 文件 | 职责 |
| --- | --- |
| `src/trajectory/types.ts` | 位置点、分段、同行区间、异常记录、增量报告等纯数据类型 |
| `src/trajectory/segmentation.ts` | 停留/移动划分：异常校验 + 贪心停留聚类（纯函数） |
| `src/trajectory/companionship.ts` | 同行关系识别：停留区间求交 + 间隔合并（纯函数） |
| `src/trajectory/engine.ts` | `TrajectoryEngine`：增量重推、快照、全量重推对照 |
| `tests/trajectory/*.test.ts` | 批量验证用例（编号 seg-XX / comp-XX / inc-XX） |
| `tests/run.ts` | 统一批量运行入口 |

## 判定契约（被验证的确定性规则）

### 停留段 / 移动段划分
- 有效点按输入顺序从左到右贪心扫描：以当前点为锚点，吸收距离
  `<= stayRadiusMeters`（闭区间）的点构成候选聚类；
- 聚类点数 ≥ 2 且持续时长 `>= minStayDurationMs`（闭区间）→ **停留段**
  （锚点 = 聚类首点坐标）；否则并入当前 **移动段**；
- 分段互不重叠地覆盖全部有效点，按时间首尾相接；
- 每个分段 ID 是内容指纹：构成点或类型变化产生新 ID，未变化则稳定复用。

### 异常输入的显式暴露（绝不静默跳过）
| 异常 | 级别 | 处理 |
| --- | --- | --- |
| `missing-coordinates` 坐标缺失/非法 | error | 记录 issue，点排除出分段 |
| `invalid-timestamp` 时间戳非法 | error | 记录 issue，点排除出分段 |
| `out-of-order` 时间倒序（早于已接受最大时间戳） | error | 记录 issue，点排除出分段 |
| `jitter` 采样抖动（距锚点在 (jitterRadius, stayRadius] 内） | warning | 记录 issue，点保留在停留段 |

### 同行关系
- 仅依据两个目标的停留段：时间区间相交（含端点接触）且重叠时长
  `>= minOverlapMs`、锚点距离 `<= maxDistanceMeters` 即同行；
- **部分重叠与完全包含走同一条区间求交规则**，只是交集形状不同；
- 同一目标对的相邻同行区间，间隔 `<= gapToleranceMs` 时合并；
- 目标对按 ID 排序（`pairKey`），判定与调用方向无关。

### 增量重推
- `correctPoint`：只对该目标做窗口化分段重推（被修正点所在旧分段 ±1 起步，
  边界不收敛则自动扩展）；其他目标分段、无关同行对保持原对象引用；
- `updateParams`：参数影响全局，全体目标与同行对重推；
- 不变量：`engine.snapshot()` 与 `engine.fullRecomputeSnapshot()`（无缓存
  全量重推）deep-equal —— 每条增量路径都与全量重推结论一致；
- 每次修正/调整产生 `IncrementalReport`：版本号、变更/移除/复用的分段 ID、
  重推/复用的目标对、窗口范围、当前异常清单，结论可追溯。

## 失败定位

- 用例按 `seg-XX`（分段）、`comp-XX`（同行）、`inc-XX`（增量）编号；
- 断言信息包含具体位置点 ID、参数组合；属性化用例（inc-07）输出随机种子、
  目标、被修正点与补丁内容，可用同一种子精确复现失败场景。

## 覆盖清单

- seg-01~11：划分顺序与覆盖完整性、时长/半径闭区间边界、抖动告警、
  坐标缺失、时间倒序、非法时间戳、空/单点输入、复现性、相邻停留、距离工具；
- comp-01~07：部分重叠、完全包含一致性、间隔合并/拆分、空间阈值、
  最短重叠阈值与端点接触、多目标对枚举、复现性；
- inc-01~10：段内小修正、停留瓦解（窗口扩展）、多目标隔离、参数调整、
  修正引入倒序/缺坐标、25 种子随机修正属性化验证、连续修正、
  长轨迹局部性（19 段中仅 1 段重推）、双引擎复现性。
