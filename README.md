# 构建依赖推演工作台

把"多来源任务声明 → 依赖合并 → 冲突检测 → 人工裁决 → 拓扑顺序 / 最早开始时刻 / 关键路径 → 排位依据追溯 → 局部修正重推"整条链路收敛为**一个**可离线运行的推演引擎，替代各模块各自维护依赖顺序的做法。

## 快速开始

```bash
npm install
npm run bench   # 离线批量验证：samples/ 下全部样例（正常/成环/缺失/耗时冲突/局部修正重推）
npm run dev     # 浏览器工作台
npm run check   # 类型检查
```

## 输入模型

每条声明带 `taskId`、`duration`、`source`（来源标识）、`note`（来源说明）、`dependsOn`（硬依赖）、`optionalDependsOn`（可选依赖，目标缺失时自动跳过并记录）。同一任务可被多个来源重复声明；耗时冲突、依赖指向缺失、依赖成环**全部保留为待裁决问题**，绝不静默择一。裁决（`decisions`）支持：采纳某来源耗时、人工指定耗时、放弃依赖边、把缺失目标登记为外部任务。每次裁决都留痕，无法匹配的裁决进入 `ignoredDecisions` 而不是被吞掉。

## 输出模型

`derive(input)` 返回：

- `order`：确定性拓扑序（就绪集合按"最早开始时刻 + 任务标识"稳定选取）
- `tasks[id]`：最早/最晚开始完成时刻、松弛度、是否关键、`startRationale`（最早开始依据）、`rationale`（为什么排在这个位置）
- `criticalPaths` / `criticalTasks`：松弛度为 0 的全部最长路径
- `issues`：每个问题的状态与裁决依据；`blocked`：因未裁决问题而挂起的任务
- `fingerprint`：输入内容指纹，任何一次改动后的展示结果都可追溯到具体声明与裁决

## 局部重推与一致性

`deriveIncremental(previous, previousInput, nextInput)` 基于结构化差异定位受影响任务（改动点及其下游），标注 `affected` / `reused` / `changedPositions`，并内置自检：返回结果与对同一输入整体重推**逐字段一致**（批量入口对每个修正步骤都会断言这一点）。

## 目录

- `src/scheduler/`：统一推演引擎（`merge` 多来源合并与冲突检测、`resolve` 裁决应用、`schedule` 拓扑+CPM+关键路径、`derive` 整体入口、`incremental` 局部重推）
- `src/components/workbench/`：浏览器工作台（问题裁决、顺序表、排位依据追溯、局部修正、增量日志）
- `samples/`：本地样例（正常 DAG、成环、指向缺失、耗时冲突、综合问题、局部修正重推）
- `scripts/bench.ts`：统一批量运行入口，离线可重复执行
