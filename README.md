# 供应链履约协同模块

纯标准库实现（Python 3.8+），完全离线运行，无任何第三方依赖。

## 目录结构

```
fulfillment/
    __init__.py      # 对外导出
    errors.py        # 异常体系（FulfillmentError 及子类）
    models.py        # Demand / Batch / Node 数据模型与状态常量
    system.py        # FulfillmentSystem：拆分、承接、推进、改派、查询
    persistence.py   # JSON 存取与载入校验
tests/
    test_fulfillment.py  # 53 个单元测试，覆盖全部验收点
```

## 运行测试

```bash
python -m unittest discover -s tests -t . -v
```

## 核心概念

- **需求（Demand）**：`create_demand(id, total_quantity)`，总量必须为正整数。
- **批次（Batch）**：需求拆分的产物，有唯一标识、正整数数量、可选前置批次
  集合与所属节点。状态机：`pending → ready → in_progress → completed`。
- **节点（Node）**：`add_node(id, capacity)`，capacity 为可承接的批次数量上限；
  已承接量 = 分配到该节点且未完成的批次数（完成自动释放额度）。

## 关键设计

1. **拆分守恒且确定**：`split_demand` 校验各批次数量之和精确等于需求总量；
   `split_evenly` 均分（余数依次分给前面的批次），同一输入结果完全一致；
   对已拆分需求重复提交相同方案是幂等 no-op，不同方案报错。
2. **容量拒绝无副作用**：`assign_batch` 先校验后落库，超容量抛出
   `CapacityError`（消息含剩余可承接量，异常对象带 `remaining` 属性），
   已有承接与事件日志完全不变。
3. **增量推进 ≡ 从头推导**：批次完成时只检查直接后继，是否解除阻塞按
   "全部前置已完成"重新判定，任意时刻 ready/pending 集合与
   `executable_order()` 从零推导的结果一致。
4. **改派原子**：`reassign_batch` 先确认目标节点在线且有余量，再切换
   `batch.node_id`；批次结构上只属于一个节点，不可能双重承接。
   `auto_reassign` 按固定规则选节点（剩余容量最大，并列取标识最小）。
5. **全程可追溯**：每次状态变化追加带序号的推进记录（`events`），
   `advancement_log()` 返回开工/完成/解除阻塞子集，可逐步比对。
6. **持久化安全**：`save` 先写临时文件再原子替换；`load` 在全新实例上
   构建并依次校验标识唯一、数量守恒、前置存在且无环、承接不超容量、
   推进记录合法，任何失败抛出带明确原因的 `PersistenceError`，
   不影响已有系统状态。

## 快速示例

```python
from fulfillment import FulfillmentSystem

s = FulfillmentSystem()
s.create_demand("D1", 100)
s.add_node("N1", 2)
s.add_node("N2", 2)
s.split_demand("D1", [
    {"id": "A", "quantity": 40, "node_id": "N1"},
    {"id": "B", "quantity": 60, "prerequisites": ["A"], "node_id": "N2"},
])
s.start_batch("A")
s.complete_batch("A")          # -> B 被解除阻塞（pending -> ready）
s.start_batch("B")
s.complete_batch("B")

s.save("state.json")
loaded = FulfillmentSystem.load("state.json")
print(loaded.node_status("N1"))       # {'load': 0, 'remaining': 2, ...}
print(loaded.prerequisite_chain("B")) # ['A']
```
