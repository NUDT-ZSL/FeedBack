# 浑仪拆装研习

基于 TypeScript + React + Three.js 的古代浑仪三维拆装研习应用。拆装顺序、部件依赖、步骤状态、受阻原因与进度结论统一收敛在一个可离线独立推演的步骤状态机中，界面层只负责展示与提交操作。

## 运行

```bash
npm install
npm run dev        # 浏览器调试（默认 http://localhost:3000）
npm run build      # 类型检查 + 生产构建
npm run simulate   # 离线批量推演（无需浏览器，Node 22 直接运行 TS）
```

## 状态机口径（`src/assembly/`）

与 React / Three.js 完全解耦的纯模块：

- `types.ts`：部件定义、挂载状态（`installed`/`removed`/`assembled`）、步骤状态（`ready`/`blocked`/`done`）、受阻原因编码、进度结论。
- `graph.ts`：依赖图分析——传递闭包、Tarjan 成环检测、缺失依赖检测、受影响闭包（自身 + 前驱 + 后继）。
- `machine.ts`：`AssemblyMachine`。`apply(operation)` 基于当前部件状态与依赖推导结论；`deriveAll()` 整体重推；`nextHint()` 推导下一可执行步骤；`snapshot()` 给出步骤状态、受阻原因、进度结论与本次实际重推的部件集合。
- `parts.ts`：浑仪七个部件的唯一依赖口径（拆解：六合仪 → 三辰仪 → 四游仪；装回为其逆序）。

校验规则：

- 拆下某部件前，其传递依赖（外层部件）必须均为 `removed`；装回前，其传递后继（内层部件）必须均为 `assembled`。
- 依赖成环或指向缺失部件 → 部件标记为不可达，受阻原因分别为 `dependency-cycle` / `missing-dependency`，不静默跳过。
- 重复拆下、重复装回、未拆先装、操作未知部件 → 无效操作，部件状态与进度结论完全不变（`already-removed` / `already-assembled` / `not-yet-disassembled` / `unknown-part`）。
- 每次有效操作只重推受影响闭包内的部件步骤，结论与整体重推逐字段一致；同一操作序列重复执行结论稳定。

## 离线批量推演

`scripts/simulate.ts` 读取 `scenarios/*.json`（部件依赖 + 操作序列 + 每步期望），逐次操作后比对：

1. 局部重推与整体重推的步骤状态、受阻原因、进度结论一致；
2. 实际重推部件不越出受影响闭包；
3. 无效操作不改变部件状态与进度结论；
4. 操作结果与最终进度符合场景声明；
5. 同一序列重复执行快照完全一致。

新增场景只需在 `scenarios/` 放置 JSON，或显式指定路径：`node scripts/simulate.ts scenarios/01-normal.json`。
