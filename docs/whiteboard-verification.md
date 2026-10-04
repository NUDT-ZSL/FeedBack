# 白板元素链路：离线验证能力

覆盖元素增删改、图层顺序、分组嵌套、撤销重做与双端合并的自动化验证。**不依赖网络与外部服务**：
运行时只用 Node.js（>= 22，内置 `node:test` 与 TypeScript 类型擦除），无新增运行时依赖。

## 运行方式

```bash
npm test        # 运行 tests/ 下全部测试，可离线重复执行
npm run typecheck  # 对白板核心与测试做严格 TypeScript 检查
```

## 被测核心（纯函数、无 UI 依赖）

| 文件 | 职责 |
| --- | --- |
| `src/whiteboard/types.ts` | 元素/分组数据模型：`nodes` + `children`（有序即 z-order）+ `parent` 三表 |
| `src/whiteboard/ops.ts` | 原子操作 `add` / `remove` / `update` / `move`，先校验后变更，返回逆操作 |
| `src/whiteboard/state.ts` | 树结构查询：子树、祖先判断、`visibleOrder`（深度优先可见顺序） |
| `src/whiteboard/history.ts` | 撤销 / 重做栈，删除分组等复合操作整体回滚 |
| `src/whiteboard/serialize.ts` | 规范化快照与 FNV-1a 状态哈希（键排序，与插入顺序无关） |
| `src/whiteboard/merge.ts` | 多端操作日志合并：Lamport 排序 + 确定性冲突裁决与报告 |

## 验证场景

- **确定性**（`tests/determinism.test.ts`）：同一初始集合与同一串操作跑多次，逐步哈希完全一致；
  最终状态以黄金哈希 `526b407681444a98` 锚定，推演逻辑任何静默失真都会直接失败。
- **操作与层级**（`tests/ops.test.ts`、`tests/groups.test.ts`）：z-order 插入/重排、跨组移动、
  分组嵌套、级联删除及其恢复；非法操作（未知元素、重复 id、非容器挂载、成环、越界索引、
  非法/不可变字段、操作 root）以 `OpError` 错误码明确拒绝，且拒绝前后状态哈希一致。
- **撤销重做**（`tests/history.test.ts`）：全量撤销回到初始哈希、全量重做回到最终哈希；
  带后代的分组删除可整体恢复；撤销后新操作清空 redo 分支；拒绝的操作不入栈。
- **协作合并**（`tests/merge.test.ts`）：
  - 改同一元素的不同字段 → 双方改动都保留；改同一字段 → 按（Lamport 时钟, 客户端 id）
    确定性获胜，并在 `report.conflicts` 中记录败方完整操作；
  - 删除与更新并发 → 删除生效，更新进入 `report.dropped`（保留完整操作负载，可人工恢复）；
  - 删除分组与向组内移动并发 → 移动的元素不丢失，确定性地挂回 root 并记录冲突；
  - 双向合并且交换参数顺序结果一致（交换律），重复合并状态与报告字节级一致；
  - 双方新增全部保留；成环移动在合并期被拒绝并报告，树结构始终合法；
  - 本地拒绝的非法操作不进入共享日志。

## 定位偏离步骤

`tests/helpers/scenario.ts` 的场景追踪器在每一步后记录
`{ index, name, hash, rejected }`。多次运行不一致时，`assertTracesEqual` 会抛出
`state diverged at step <序号> "<步骤名>"`，直接定位到具体操作；被拒绝的步骤记录错误码，
并要求其哈希与上一步相同。
