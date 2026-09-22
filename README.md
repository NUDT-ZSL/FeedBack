# 离线设备诊断模块

面向嵌入式设备有限存储场景的运行线索管理与故障链重建，纯 Python 标准库实现，完全离线运行。

## 功能与需求对照

1. **线索接入与有限存储**：`Clue` 携带时间戳、来源、严重级别与关键状态快照；
   `BoundedClueStore` 按字节预算（`capacity_bytes`）决定保留哪些线索。
2. **覆盖与存在性推断**：空间不足时最旧线索先被覆盖；每次覆盖留下 `Tombstone`
   （时间、来源、严重级别、所属链、关键状态键与摘要），故障链重建时据此推断
   被覆盖线索的存在。
3. **故障链重建**：`ChainReconstructor` 按因果引用（`causes`）与来源+时间邻近
   归链，输出按时间排列的状态变化路径；环节分为 `present`（在场）、
   `inferred`（被覆盖但可推断）、`missing`（前因既不在场也无摘要）三类，
   矛盾环节以冲突记录形式标注。
4. **冲突保留**：同一时间点、同一来源对同一状态字段给出矛盾取值时，双方线索
   都保留并生成 `ConflictRecord`；未解决的冲突参与线索受覆盖保护。
5. **关键证据**：`key_evidence=True` 的线索在存储压力下最后才被覆盖；
   其所属故障链被确认闭环（`resolves_chain` 线索或 `confirm_chain()`）后，
   转为普通线索按龄覆盖。若存储被受保护证据占满，新线索被拒绝并记入
   `store.rejected`，不会静默丢弃。
6. **诊断报告**：`build_report()` 输出各故障链完整程度、被覆盖线索按链的
   影响范围、未解决冲突数与整体可信度（完整程度均值减去冲突/缺失折减）。

## 使用

```bash
python demo.py            # 端到端演示：泵故障链 + 冲突 + 覆盖
python -m pytest tests/   # 行为测试
```

```python
from diagnostics import BoundedClueStore, Clue, Severity, build_report

store = BoundedClueStore(capacity_bytes=1200)
c1 = Clue(1000.0, "thermal", Severity.WARNING, "temp over limit",
          state={"temp": 87}, chain_id="chain-A")
c2 = Clue(1005.0, "pump", Severity.ERROR, "pump overload",
          state={"pump": "overload"}, causes=[c1.id],
          chain_id="chain-A", key_evidence=True)
store.add_many([c1, c2])
print(build_report(store).render_text())
```

## 模块结构

- `diagnostics/models.py` — Clue / Tombstone / ConflictRecord / Severity
- `diagnostics/store.py` — BoundedClueStore：容量管理、覆盖策略、冲突检测
- `diagnostics/chains.py` — ChainReconstructor / FaultChain：归链与状态路径
- `diagnostics/report.py` — DiagnosticReport / build_report：报告与可信度
