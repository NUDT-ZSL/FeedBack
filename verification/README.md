# 归因离线验证

为调用链归因链路提供可离线复现的自动化验证：导入顺序一致性、共享节点跨路径
贡献区分、边界输入（父缺失 / 成环 / 耗时异常）的可观察处理、以及节点修正后
“只重算受影响路径”与全量重算的一致性。

## 运行

```bash
npm run verify                              # 跑全部用例
node verification/run.mjs --list            # 列出用例
node verification/run.mjs --fixture <id>    # 只跑匹配的用例
node verification/run.mjs --report <path>   # 指定报告输出路径
```

退出码：全部通过为 0，任一失败为 1。完全离线，零第三方依赖（Node ≥ 18）。

## 结构

- `analyzer/` — 归因核心（零依赖 ESM）：样本导入 → 调用图还原（多父 DAG）→
  按根到叶路径逐层归因 → 增量重算。共享节点 n 被 k(n) 条路径经过时，每条路径
  记贡献 `duration(n)/k(n)`，全局满足耗时守恒。真实分析器可按同样接口
  （`runFullAttribution` / `IncrementalAttributor`）替换接入。
- `verification/fixtures/*.fixture.json` — 声明式用例（见下）。
- `verification/lib/` — 通用检查与结构化差异比较。
- `verification/run.mjs` — 入口：执行全部用例，输出逐项通过/失败与差异，
  并写出 `verification/reports/attribution-verification.report.json`
  （含每用例证据：受影响区域、删除/新增/重算/未变路径清单）。

## 用例声明（fixture）

```jsonc
{
  "id": "my-case",
  "title": "用例说明",
  // 二选一：samples + 顺序扰动，或显式 imports
  "samples": [{ "sampleId": "t1", "spans": [{ "id": "a", "parentId": null, "duration": 1 }] }],
  "permute": "all",          // "all" = 全排列；数字 n = 原顺序 + n-1 个确定性乱序
  "expectDiagnostics": [     // 必须出现的诊断（可选 count 精确数量）
    { "code": "MISSING_PARENT", "nodeId": "c", "count": 1 }
  ],
  "shared": [                // 共享节点期望
    { "nodeId": "s", "pathCount": 2, "perPathContribution": 3 }
  ],
  "expectPaths": ["a>b"],    // 期望的根到叶路径集合
  "fixes": [                 // 触发增量 vs 全量一致性验证
    { "type": "set-duration", "nodeId": "s", "duration": 9 },
    { "type": "set-parent", "nodeId": "c", "parentId": "b" }
  ]
}
```

诊断码：`DUPLICATE_SPAN`（同样本内重复 id）、`DURATION_CONFLICT`、
`INVALID_DURATION`、`NEGATIVE_DURATION`、`MISSING_PARENT`、`CYCLE_EDGE`。

## 每个用例自动执行的通用检查

- 归因不变量：路径累计 = 逐层贡献之和；节点跨路径贡献之和 = 自身耗时；
  共享节点贡献 = duration/pathCount；全局耗时守恒。
- 不静默跳过：每个输入 span 均可追溯；每条被丢弃的边都有对应诊断。
- 导入顺序无关：声明了多个导入顺序时，所有顺序的报告必须逐位一致。
- 增量一致（声明 fixes 时）：增量结果与“修正回放后全量重算”逐位一致；
  实际变化的路径必须全部落在证据的受影响清单内；未受影响路径的归因
  缓存对象必须保持不变。
