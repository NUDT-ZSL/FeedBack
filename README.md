# devdiag 离线设备诊断模块

纯 Python、零第三方依赖，面向嵌入式设备有限存储场景：从只保留最近一段的
运行线索中，还原故障前后的状态变化路径。

## 功能与需求对应

1. **有限容量存储** `BoundedClueStore(capacity_bytes)`：接收带时间戳、来源、
   严重级别的线索（`Clue`），按估算字节数控制总量。
2. **覆盖与墓碑**：空间不足时覆盖最旧线索；若被覆盖线索属于某故障链，
   自动留下 `Tombstone`（时间戳、来源、关键状态快照、摘要哈希），
   故障链仍可推断其存在。
3. **故障链重建** `rebuild_chains(store)`：按时间序排列链内事件，结合
   `caused_by` 因果关系，标注缺失环节（`overwritten` / `missing_cause`）
   与矛盾环节（冲突记录）。
4. **冲突保留**：同一时间点、不同来源对同一状态键给出不同取值时，生成
   `ConflictRecord` 并将双方钉住，绝不静默丢弃。
5. **关键证据** `mark_key_evidence(id)`：被标记线索在存储压力下优先保留；
   `confirm_chain(chain_id)` 确认故障链完整后解除该链关键证据的保护。
   若所有线索均受保护，抛出 `StorageFullError` 而非丢弃证据。
6. **诊断报告** `build_report(store)` / `render_text(report)`：输出每条
   故障链的完整度、被覆盖线索的影响时间范围，以及综合可信度
   （完整度均值减去冲突罚分）。

## 使用

```bash
python main.py                                  # 演示场景
python -m unittest discover -s tests -v         # 单元测试
```

```python
from devdiag import BoundedClueStore, Clue, Severity, build_report, render_text

store = BoundedClueStore(capacity_bytes=4096)
c = store.add(Clue(1.0, "temp-sensor", Severity.ERROR, "温度越限",
                   chain_id="FAULT-1", state={"temp": "95C"}))
store.mark_key_evidence(c.id)
print(render_text(build_report(store)))
```
