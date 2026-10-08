# 古籍修复工坊

基于 React + TypeScript + Express 的古籍修复工坊应用。工序推进、材料领用、
修复记录三个模块共享同一份可追溯状态来源（`src/workshop/`），任一操作提交后，
所有入口读到的进度、材料余量与记录条数立即一致。

## 状态一致性设计

- **统一状态来源**：`src/workshop/store.ts` 以操作日志（event log）为唯一事实，
  工序进度、材料余量、修复记录均为同一日志的物化视图，不存在各模块私有副本。
- **幂等**：每个操作携带 `opId`，重复提交（网络重试、工序切换后重发）返回
  `duplicate`，不会重复扣减材料。
- **冲突留痕**：操作可携带 `baseVersion`（提交方读到的状态版本）。版本不匹配时
  操作不生效，完整冲突痕迹写入该册书的冲突列表，当前有效状态由日志确定性决定。
- **材料账目**：余量由领用/退回收支事件推导；退回不得超过该册已领未退数量，
  余量不足拒绝领用，均不产生半落账。
- **历史迁移**：`src/workshop/migrate.ts` 把旧架构下三模块分散的快照归并为
  有序事件流回放进统一存储；旧模块余量与流水不符时以旧展示值为准补校正事件，
  保证迁移后各模块读取结果与迁移前一致。

## 常用命令

```bash
npm run dev                 # 前端 + 后端并发开发
npm run verify:consistency  # 离线批量一致性验证（无需启动服务）
npm run build               # 类型检查 + 前端构建
```

## 离线一致性验证

`npm run verify:consistency`（即 `tsx scripts/verify-consistency.ts`）覆盖：

1. 工序来回切换 —— 三模块读取一致，切换不丢材料账、不丢记录
2. 材料重复领用与退回 —— 幂等重试不重复扣减，余量精确还原
3. 并发冲突操作 —— 不静默择一，冲突留痕且有效状态可判定
4. 历史数据迁移 —— 迁移后各模块读取结果与迁移前一致

## API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/workshop/books` | GET | 古籍列表 |
| `/api/workshop/books/:id/snapshot` | GET | 某册书三模块一致性快照 |
| `/api/workshop/books/:id/records` | GET | 修复记录 |
| `/api/workshop/books/:id/conflicts` | GET | 冲突痕迹 |
| `/api/workshop/materials` | GET | 材料清单 |
| `/api/workshop/materials/movements?bookId=` | GET | 领用/退回流水 |
| `/api/workshop/operations` | POST | 提交操作（工序推进/领用/退回/记录），冲突返回 409 |
