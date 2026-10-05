# Auto16 标记链路：可推演的规则匹配与依赖传播

## 链路五段

1. **输入**（`src/chain/fragment-store.js`）：片段带 `source` / `seq` / `revision` / `text`。
   装配顺序只由 `(source, seq)` 决定，乱序到达不影响结果；位置 id 形如 `cam1#2@0`，修正后稳定。
   同一位置重复提交幂等忽略；同版本不同内容拒绝（`conflicting-duplicate-rejected`）；
   更低 revision 拒绝（`stale-rejected`）；更高 revision 覆盖并触发重推。
2. **规则匹配**（`src/chain/rule-set.js` + 引擎）：规则带优先级、作用范围（函数或
   `{sources, pattern}`）与 `apply(pos, api)`。每个位置保留**全部命中候选**作为依据；
   最高优先级唯一则胜出；同优先级结论不一致进入 `conflict` 中间状态（`finalTag=null`），
   不静默择一，等待人工裁决。
3. **依赖传播**：`apply` 内通过 `api.read(id)` / `api.readOffset(n)` 读取其它位置标记，
   读取被追踪为依赖边（读者 -> 被读位置的反向边 `rdeps`）。上游变化时只把读者加入脏集，
   不动点迭代直至收敛。读取不存在的位置记入 `dangling`，不跳过不崩溃。
4. **状态收敛**：迭代超过 `max(64, 8*位置数)` 仍在变化的位置判为 `unconverged`，
   `finalTag` 置空、依据保留，并沿依赖边向下游传染；`requires` 静态成环单独记录事件。
5. **输出**（`report()`）：每个位置给出 `finalTag` / `status` / `hits`(全部依据) /
   `reads` / `propagationPath`(上游传播链)；汇总 `conflicts`、`unconverged`、`dangling`、
   `cycles` 与全部 `events`。

## 增量重推与整体重推

- 片段修正：仅受影响位置（含索引平移、消失位置的读者）入脏集。
- 规则改写：旧作用域 ∪ 新作用域内位置入脏集，下游经动态依赖边自动传播。
- 人工裁决：该位置入脏集，全部传递下游重推（裁决后下游不会漏推）。
- `recomputeAll()` 清空派生状态（保留片段/规则/裁决输入）全量重推；验收在每次变更后
  比较增量结果与整体重推结果，必须完全一致。

## 离线运行

```bash
npm test       # 15 项验收测试（node --test，零依赖、可离线）
npm run samples  # 6 个边界场景逐步演示，并逐步校验增量==整体
```

## 边界场景（samples/scenarios.js）

乱序到达、重复提交、同版本冲突提交、过期版本、中途修正、同优先级冲突与裁决传播、
规则改写、作用范围部分重叠、依赖成环、悬空依赖、裁决无效位置。
