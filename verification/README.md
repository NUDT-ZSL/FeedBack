# 调用链归因离线验证套件

在无网络、无外部账号的前提下，对调用链归因分析器做端到端验证。零依赖，仅需 Node.js（已用 Node 22 验证）。

## 运行

```bash
node verification/runner.js                 # 跑全部用例
node verification/runner.js --case 04-reference-cycle   # 只跑单个用例（不带 .json 后缀）
node verification/runner.js --evidence-dir /tmp/evidence # 自定义证据输出目录
```

也可通过 npm 脚本运行：`npm run verify`。

输出每个用例的 `PASS`/`FAIL` 与具体差异（期望值、实际值、差异路径），结尾给出汇总；任一用例失败时进程以退出码 1 结束，可直接接入 CI。

每次运行会把完整归因结论与增量重算证据写入 `verification/evidence/<用例>.json`（该目录已被 gitignore），用于事后追溯。

## 覆盖范围

| 用例 | 验证内容 |
| --- | --- |
| `01-order-invariance-basic` | 同一批样本在 5 种导入顺序（原序、逆序、3 个固定种子洗牌）下归因结论完全一致；跨 trace 同名共享节点 |
| `02-shared-node-separation` | 同名共享节点在不同路径下的贡献分别归因，不被全局合并 |
| `03-missing-parent` | 父引用缺失：产生可观察异常、节点提升为根、继续归因，不静默跳过 |
| `04-reference-cycle` | 引用成环：产生可观察异常、确定性断环（环中最小 id 提升为根）后继续归因，且断环结果与导入顺序无关 |
| `05-abnormal-duration` | 耗时缺失、非数值、为负以及子节点耗时超过父节点：均可观察且归因继续，结论与全量归因一致 |
| `06-incremental-duration-fix` | 修正节点耗时后只重算受影响路径；增量结果与整体重算严格一致；证据含受影响路径、原因、前后值 |
| `07-incremental-reparent` | 修正父引用（修复缺失父节点）：旧路径 removed、新路径 added，其他路径不重算；增量结果与整体重算一致 |

## 用例文件格式（数据驱动）

用例放在 `verification/cases/*.json`，运行器自动发现，断言内容全部写在用例数据里，运行器不针对任何具体用例写死断言。

```json
{
  "name": "用例名",
  "description": "用例说明",
  "samples": [
    {
      "traceId": "t1",
      "nodes": [
        { "id": "a", "name": "api", "parentId": null, "durationMs": 100 },
        { "id": "b", "name": "auth", "parentId": "a", "durationMs": 30 }
      ]
    }
  ],
  "checks": [
    { "type": "order-invariance" },
    {
      "type": "attribution",
      "expect": {
        "pathCount": 1,
        "anomalies": [],
        "pathTotals": { "t1:api>auth": 70 },
        "selfTimes": { "t1:api>auth :: a": 70 },
        "cumulativeTimes": { "t1:api>auth :: b": 100 },
        "sharedSelfTimes": { "db": { "t1:api>db": 50 } }
      }
    },
    {
      "type": "incremental",
      "corrections": [
        { "traceId": "t1", "nodeId": "b", "set": { "durationMs": 40 } }
      ],
      "expect": {
        "affectedPaths": { "t1:api>auth": "updated" },
        "pathTotals": { "t1:api>auth": 60 }
      }
    }
  ]
}
```

`expect` 中所有投影均按形状做子集断言：用例只需声明关心的键。

- 路径标签格式：`<traceId>:<节点名用 > 连接>`，如 `t1:api>auth>db`
- `selfTimes` / `cumulativeTimes` 的键格式：`<路径标签> :: <节点id>`
- `anomalies` 为排序后的 `<type>@<traceId>@<nodeId>` 列表，异常类型包括 `invalid-duration`、`negative-duration`、`missing-parent`、`cycle`、`negative-self-time` 等
- `affectedPaths` 的值为路径状态：`added` / `updated` / `removed`
- `incremental` 检查除用例声明的期望外，内置恒真性质校验：增量合并结果必须与对修正后样本做全量重算的结果完全一致

## 目录结构

```
analyzer/                  归因分析器核心（纯 ESM，零依赖）
  import.js                样本导入、调用树还原、边界输入异常记录
  attribute.js             逐路径逐层累计归因、共享节点视图
  incremental.js           增量引擎：受影响路径判定与局部重算
  canonical.js             规范化序列化（跨顺序/增量 vs 全量比较）
  index.js                 analyze / createEngine 入口
verification/
  runner.js                验证入口：发现并执行全部用例、输出差异、落证据
  lib/checks.js            检查类型（attribution / order-invariance / incremental）
  lib/projections.js       可断言的归因投影
  lib/diff.js              递归差异输出
  cases/*.json             数据驱动用例
  evidence/                运行产生的可追溯证据（gitignored）
```

## 归因语义

- `selfMs(node) = max(0, durationMs(node) - Σ durationMs(children))`；子耗时之和超过父节点时记录 `negative-self-time` 异常，self 按 0 计
- `cumulativeMs` 沿根到当前节点逐层累计 selfMs；路径总耗时为叶子的 cumulativeMs
- 共享节点（同名节点出现在多条路径）的贡献按路径分别记录
- 结构异常（缺失父、成环）只影响相关节点的挂载位置，所有节点始终参与归因，绝不静默丢弃
