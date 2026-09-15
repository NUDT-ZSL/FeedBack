# 离线设备配置适配内核

给型号、硬件版本、能力各异的设备下发会随固件演进而改结构的配置：**同一份配置适配不同设备**——
旧设备不认识的新字段安全降级并说明原因，新设备读到旧配置按默认值补齐，必填缺失明确拒绝。
其他模块可以查询「设备最终生效的配置」「这次适配做了哪些取舍」「配置到目标版本的完整迁移路径」。

* **纯标准库**，无任何第三方依赖，可完全离线运行与单元测试。
* 适配结果**只取决于设备固件/能力与配置版本**，与字段到达顺序无关；同一输入重复适配得到
  逐字节相同的生效配置、取舍记录与记录 ID。

## 运行环境

Python 3.8+（开发环境为 3.13）。无需安装任何包。

## 一分钟上手

```bash
python demo.py                      # 端到端演示，覆盖需求 1~8
python -m unittest discover -s tests -v   # 55 个单元测试
```

```python
from device_config import ConfigKernel

k = ConfigKernel()

# 字段：名字、类型(int/float/bool/string)、引入版本、可选默认值、能力要求
k.register_field("ssid", "string", "1.0")
k.register_field("timeout_ms", "int", "1.0", default=1000)
k.register_field("timeout_s", "float", "2.0", default=1.0)   # 改名目标
k.register_field("power_save", "bool", "2.0", default=False)
k.register_field("bt_name", "string", "3.0", required=False,
                 required_capabilities={"bt"})

# 迁移规则：逐级登记改名 / 改类型
k.register_migration_rule(
    "1.0", "2.0",
    renames=[("timeout_ms", "timeout_s")],
    type_changes=[("timeout_ms", "float")],
)
k.register_migration_rule("2.0", "3.0")   # 纯字段新增版本

# 设备：唯一标识、型号、固件版本、能力标签集合
k.register_device("dev-old", "Sensor-A", "1.0.0", {"wifi"})
k.register_device("dev-new", "Sensor-B", "3.0.0", {"wifi", "bt"})

# 配置：带版本号的字段集合
k.register_config("cfg-old", "1.0.0", {"ssid": "home", "timeout_ms": 500})

# 适配
record = k.adapt("cfg-old", "dev-new")
print(record["effective_config"])
# {'bt_name' 不会出现（旧配置没给，且它是可选）,
#  'power_save': False,        <- 按 2.0 默认值补齐
#  'ssid': 'home',
#  'timeout_s': 500.0}         <- 改名 + int->float 逐级迁移

# 查询
record_id = record["record_id"]
k.effective_config("dev-new")                       # 设备最终生效配置
k.field_decision(record_id, "power_save")           # 某字段为何保留/裁掉
k.describe_migration_path("1.0.0", "3.0.0")         # 完整迁移路径

# 导出 / 重新载入（JSON，仅标准库）
from device_config import dump_json, load_json
text = dump_json(k)
restored = load_json(text)
assert dump_json(restored) == text
```

## 模型与关键语义

| 概念 | 说明 |
| --- | --- |
| 版本号 | 点分非负整数 `1`、`1.2`、`1.10.2`；按整数段比较，右侧补 0（`1.2 == 1.2.0`）。非法版本抛 `VersionError`，带首错字符位置与段序号。 |
| 设备 `Device` | 唯一标识、型号、固件版本、能力标签集合。 |
| 字段 `FieldDef` | 名字（全局唯一）、类型、引入版本、`required`、可选 `default`、`required_capabilities`。 |
| 迁移规则 `MigrationRule` | 从低版本到高版本的一条规则，含若干改名与改类型动作；一个起始版本至多一条迁出规则（不允许分叉）。 |
| 配置 | 带版本号的字段集合；引用的字段必须存在、类型必须匹配、不能携带高于配置版本才引入的字段。 |

**改名模型**：字段名即身份，改名通过规则表达。改名目标必须是「为该次改名而登记」的新字段
（它在规则起始版本尚不存在、在目标版本首次存活）；把旧字段改名为一个已经独立存在的字段
（身份合并）会被拒绝。

**类型转换**只允许安全方向：`int→float`、`float→int`（仅整数值，如 `3.0` 可以、`3.5` 拒绝）、
`int→string`、`string→int`/`string→float`（严格十进制，拒绝符号位、空白、十六进制、`1e3`、
`NaN`/`Infinity`）。布尔值永远不会被当作整数。

**适配流程**：

1. 把配置沿迁移规则迁到设备固件版本（固件更旧则逆向回退）；
2. 只保留「固件版本 ≥ 字段引入版本」**且**「设备具备全部所需能力」的字段；
3. 旧配置缺失、但新固件支持的字段：有默认值则按默认补齐（默认值同样沿迁移链转换），
   必填且无默认则抛 `MissingFieldError` 并列出字段名；
4. 产出排序后的生效配置与逐字段取舍记录（`kept / reason / detail / source / value`）。

裁剪原因码：

* `kept`：保留；
* `unsupported_firmware`：字段在该固件版本之后才引入，安全降级；
* `missing_capability`：设备缺少字段要求的能力标签；
* 必填缺失不以裁剪记录形式出现，而是直接拒绝整个适配。

**迁移路径**：规则之间必须首尾相接，中间断链抛 `MigrationChainError` 并带断点版本与目标版本；
规则版本跨越目标版本（无法在目标停留，如只有 `1→3` 却要到 `2`）同样报错。
配置版本早于第一条规则、或最后一条规则之后只有字段新增的区间，用 identity（无结构变更）步通过。

**确定性**：所有列表/字典输出按键排序；记录 ID 是规范化内容的 SHA-256 前缀；
适配是幂等的——重复适配返回同一条记录，不产生重复存档。

## 异常体系

均在 `device_config.errors` 下，继承同一基类 `KernelError`：

`VersionError`（带位置）、`ValidationError`、`DuplicateError`、`NotFoundError`、
`MigrationChainError`（带断点版本）、`MissingFieldError`（带字段名列表）、
`CorruptStateError`（载入损坏）。所有登记/适配失败都**先校验后写入**，失败时内核状态不变。

## 导出/载入格式

`dump_json(kernel)` 导出单个 JSON 对象（顶层 `format_version: "dc-state/1"`），包含
`devices / fields / migration_rules / configs / adaptations` 五段，键排序、无歧义分隔符，
相同状态永远产出逐字符相同的文本。

`load_json(text)` / `import_state(dict)` 分两阶段：

1. **结构校验**：JSON 结构、必填键、基本类型、重复标识、分叉规则，错误带 JSON 路径（如 `$.devices[0].firmware`）；
2. **语义重放**：在全新临时内核上重放全部登记（复用内核全部校验：版本合法、引用字段存在、无环等），
   再把每条适配记录**重新计算并与存档逐条比对**（含记录 ID），任何篡改/损坏都会被发现。

载入始终返回**新建内核**，调用方已有内核在任何失败下都不受影响。

## 代码结构

```
device_config/
  __init__.py     # 公开 API
  version.py      # Version / parse_version / canonical_version
  values.py       # 标量类型严格校验与安全转换
  errors.py       # 异常类型
  kernel.py       # ConfigKernel：登记、快照、迁移、适配、查询
  persistence.py  # JSON 导出/载入、结构与语义校验
tests/
  test_kernel.py  # 55 个单元测试，逐条对应需求 1~8
demo.py           # 端到端演示
```
