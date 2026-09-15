# cfgkernel：配置演进与能力适配内核

面向出厂固件版本各异的嵌入式设备：同一份配置在不同型号 / 固件上含义不同，
本内核负责**按设备能力解析配置、在版本间安全迁移，并保证迁移可回滚、可复现**。

- 纯 Python 标准库实现，零第三方依赖；
- 完全离线运行与单元测试（`python run_tests.py`，74 个用例）；
- 整体状态可序列化为单个带校验和的 JSON 文件，损坏 / 缺字段清晰报错。

## 快速开始

```bash
python run_tests.py   # 运行全部单元测试与验收场景
python demo.py        # 端到端演示：老读新 / 新读老 / 迁移 / 回滚 / 落盘
```

```python
from cfgkernel.kernel import ConfigKernel
from cfgkernel.migrate import MigrationOp

k = ConfigKernel()

# 1) 能力、型号 / 固件、型号能力支持
k.register_capability("ble_mesh", "2.0.0")
m = k.register_model("GW-A200")
k.register_firmware("GW-A200", "2.0.0")
k.register_support("GW-A200", "ble_mesh", "2.0.0")

# 2) 字段演进规则：引入版本、类型、默认值、范围、枚举、能力依赖、收紧策略
k.register_field("net.tx_power", "int", "1.0.0", default=20,
                 min_value=0, max_value=30, range_policy="clamp")
k.add_field_change("net.tx_power", "2.0.0", max_value=20)  # 2.0.0 收紧上限
k.register_field("ble_mesh.enable", "bool", "2.0.0", default=False,
                 required_capability="ble_mesh")

# 3) 演进链：逐版本的声明式迁移操作
k.register_migration_step("1.0.0", "2.0.0", [])

# 4) 按设备应用配置（自动按固件版本解析 + 能力判定）
cfg = k.apply({"net": {"tx_power": 25}}, "GW-A200", "2.0.0")
cfg.get("net.tx_power")          # 20 —— 超上限，clamp 降级
cfg.source_of("net.tx_power").status          # "degraded"
cfg.source_of("net.tx_power").detail["original"]  # 25（原值保真）

# 5) 显式迁移 / 回滚
old = k.normalize({"net": {"tx_power": 25}}, "1.0.0", name="site1")
new, record = k.migrate(old, "2.0.0")
restored, rb = k.rollback_record(record.id)

# 6) 查询：字段最终取值 + 来源；稳定顺序的差异报告
k.field_info(new, "net.tx_power")
k.diff(new)

# 7) 整体落盘 / 重载（单个 JSON，内含 SHA-256 校验和，原子写入）
from cfgkernel.persistence import save_kernel, load_kernel
save_kernel(k, "kernel.json")
k2 = load_kernel("kernel.json")
```

## 核心概念

| 概念 | 类型 | 说明 |
|---|---|---|
| 能力 | `Capability` | 如 `wifi` / `ble_mesh`，有引入版本与可选下线版本 |
| 型号 | `DeviceModel` | 登记固件版本链与“自哪个固件起支持某能力” |
| 字段规则 | `FieldSpec` | 点分路径（`net.wifi.power`）的完整演进史 |
| 规则变化 | `FieldChange` | 某版本上：默认值 / 类型 / 范围 / 枚举扩值移除 / 废弃 |
| 枚举成员 | `EnumMember` | 成员自身带引入版本与可选移除版本（枚举可扩可收） |
| 迁移边 | `MigrationStep` | `from -> to` 上的一组声明式操作 |
| 配置 | `Config` | 活动取值 + 每字段来源（`FieldSource`）+ 忽略清单 `extras` |

### 字段收紧策略 `range_policy`

- `error`（默认）：无法表示时迁移 / 应用**失败**（迁移触发整体回滚）；
- `clamp`：数值夹到范围内，取值保留但标记 `degraded`，原值存入
  `detail.original`；
- `fallback`（仅枚举）：替换为 `degrade_fallback`，同样标记 `degraded`。

### 字段状态（`FieldSource.status`）

`set`（显式）/ `default`（补默认）/ `renamed`（重命名继承）/
`deprecated`（规则已废弃，值保留）/ `degraded`（降级）/
`ignored`（设备缺能力，默认占位，真实值在 extras）。

任何不被当前版本认识或设备能力拒绝的字段都进入 `Config.extras`
（`unknown_field` / `capability_missing` / `field_dropped`），**原始值保真、
明确标注原因，绝不静默丢弃**。

### 迁移操作

`MigrationOp.rename(old, new)`、`set_value(path, value)`、
`map_enum(path, {旧: 新})`、`cast(path, to_type)`、`drop(path)`。
操作是纯数据，可序列化、无时间 / 随机因素——同一输入重复迁移结果逐字节一致，
迁移记录 id 由内容哈希派生（可复现）。

## 八条需求的实现位置

1. **型号 / 固件 / 能力 / 字段登记，重复与非法拒绝**
   — `kernel.register_*`（`RegistrationError`，中文说明）；
   型号逻辑见 `model.py`。
2. **引入 / 废弃版本、类型、默认值；不支持字段明确标记忽略或降级**
   — `schema.py` 的 `FieldSpec.resolve_at()`；解析结果在 `config.py`
   （`status` 与 `extras`）。
3. **逐字段校验，失败指出路径 / 期望 / 实际**
   — `ResolvedField.validate_value()` 与 `errors.FieldProblem`；
   一次性收集全部问题后抛 `ValidationError`。
4. **沿演进链迁移：补默认、转类型、迁移废弃字段；与直接解析一致**
   — `ConfigKernel._replay()` 与 `normalize()` 走**同一条**逐边回放路径，
   结构上保证等价（测试 `test_migration_equals_direct_parse`）。
5. **中途失败整体回滚、重复迁移幂等**
   — `migrate()` 先深拷贝、保存快照；失败恢复输入对象并抛 `MigrationError`
   （不留记录、不留半新半旧）；同版本迁移返回一致副本、不产生记录。
   `rollback_record()` 凭记录恢复，并在配置已分叉时拒绝回滚。
6. **字段最终取值 / 来源版本 / 忽略降级、相对目标版本的稳定顺序差异**
   — `field_info()`、`diff()`（全部按路径排序，跨进程确定）。
7. **整体 JSON 落盘 / 重载，损坏或缺字段清晰报错、失败状态不变**
   — `persistence.py`：原子 `os.replace`、SHA-256 校验和、
   载入时在全新内核上重建 + 跨部分一致性检查，成功才返回。
8. **验收场景**
   — `tests/test_acceptance.py` 手工逐步推导期望值并逐项比对：
   老设备读新配置（A）、新设备读老配置（B）、枚举扩值（C）、
   类型收紧（D）、迁移中途失败 + 回滚（E）、可复现（F）、硬类型错误（G）。

## 目录结构

```
cfgkernel/
  version.py      # Version 值对象（2~3 段点分整数，稳定比较）
  errors.py       # KernelError 体系、FieldProblem
  schema.py       # 类型 / 范围 / 枚举规则与版本快照、纯值校验
  model.py        # Capability / DeviceModel（能力矩阵）
  config.py       # Config / FieldSource / IgnoredField / 嵌套摊平
  migrate.py      # 声明式迁移操作、迁移与回滚记录（含前后快照）
  kernel.py       # 登记、解析、迁移、设备应用、查询（唯一入口）
  persistence.py  # 原子 JSON 落盘 + 校验和 + 严格重载
tests/            # unittest：登记/校验/迁移/设备查询/持久化/验收场景
run_tests.py      # 测试入口
demo.py           # 端到端演示
```

## 设计约束与边界

- 只支持**向前迁移**（版本号单调上升）；回到旧版本使用 `rollback_record()`，
  避免“降级迁移”与回滚语义重叠。
- 演进链是**不分叉的单链**：迁移边必须首尾相接，字段引入 / 变化版本必须落在
  链节点上（登记顺序不限，两个方向都会校验）。
- bool 不会被静默当作 int；`1` 与 `1.0` 视为同一版本。
- 列表整体作为叶子字段（元素类型可约束），不展开下标做逐元素迁移。
