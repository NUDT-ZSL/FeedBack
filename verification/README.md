# 判定链路离线验证

为「空间记录导入 → 按时间回放 → 矛盾裁决 → 受影响范围重推」这条判定链路
提供可离线批量运行的自动化验证。同一批输入稳定产出可比较的判定结论与依据，
输入顺序、记录修正或裁决变化会暴露为结论差异，而非静默通过。

## 运行

```bash
npm run verify          # 批量执行全部检查，输出报告，失败时退出码为 1
npm run check:verify    # 可选：对验证代码做 TypeScript 类型检查（需 npx tsc 可用）
```

- 纯离线：不访问网络、不依赖外部服务，输入全部来自 `verification/fixtures/` 本地样例。
- 零安装：验证入口只依赖 Node（>= 22.18，直接运行 TypeScript），无需 `npm install`。
- 可复现：报告 `verification/report/verdict-report.json` 内容确定（不含时间戳等
  非确定字段），同一输入重复运行逐字节一致；结论以 sha256 哈希标识，便于跨次比较。

## 检查项

| 检查 | 验证内容 |
| --- | --- |
| `order-invariance` | 同一批记录/事件/裁决以 8 种确定性洗牌顺序导入，回放结论哈希全部一致 |
| `adjudication-scoped-replay` | 矛盾双方保留在输入中；裁决前冲突以 `unresolved-conflict` 异常可见；裁决只重推受影响对象与时间区间，且与整体重推哈希一致；范围外对象结论不变 |
| `anomaly-visibility` | 事件依赖缺失产生 `missing-dependency`、成环产生 `dependency-cycle` 异常并进入结论；涉事事件不参与影响计算但不静默；修复输入后异常清零 |
| `correction-scoped-replay` | 记录修正（`corrects` 指向旧记录）后，受影响范围重推与全量重推哈希一致 |
| `difference-exposure` | 翻转裁决结果、改变修正值等输入变化必须产生不同的结论哈希，保证差异被暴露 |

## 结构

- `src/replay/types.ts` — 记录、事件、裁决、异常、判定结论的领域模型
- `src/replay/engine.ts` — 全量回放：规范化排序（顺序无关）、修正解析、矛盾裁决、
  事件依赖缺失/成环检测、对象状态与事件影响范围计算（状态键带来源记录 id，依据可追溯）
- `src/replay/incremental.ts` — 受影响范围（对象 + 时间区间）计算与局部重推
- `src/replay/canonical.ts` — 结论规范化与稳定序列化（可哈希、可逐字节比较）
- `verification/run.ts` — 统一批量运行入口
- `verification/fixtures/` — 本地样例数据（含矛盾记录、缺失依赖、成环、修正样例）

## 扩展样例

新增场景只需在 `verification/fixtures/` 放置数据文件，并在 `verification/run.ts`
的 `checks` 列表中追加一个检查函数；报告与退出码会自动汇总。
