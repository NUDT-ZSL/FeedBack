# 格式演进与兼容读取内核（evo_kernel）

一套只依赖 Python 标准库、可完全离线运行的归档格式内核，解决历史文件跨
版本读取问题：**识别版本 → 按版本规则解析 → 版本间安全迁移 → 可回滚、
可复现**，并提供差异报告、规则/生命周期查询和整体快照导入导出。

## 快速开始

```python
from evo_kernel import Kernel

k = Kernel()

# 1) 登记版本：每个版本有唯一 id、父版本和完整字段规则
k.register_version("v1", [
    {"name": "id", "type": "integer", "required": True},
    {"name": "status", "type": "string", "required": True,
     "enum": ["draft", "published"]},
])
k.register_version("v2", [
    {"name": "id", "type": "integer", "required": True},
    {"name": "status", "type": "string", "required": True,
     "enum": ["draft", "published", "archived"]},   # 枚举扩值
    {"name": "owner", "type": "string", "default": ""},  # 新增字段带默认值
], parent="v1", description="枚举扩 archived，新增 owner")
```

完整可运行示例见 `demo.py`，公共测试场景见 `tests/scenario.py`。

### 读取带版本标记的数据

```python
result = k.read_envelope({"version": "v1",
                          "data": {"id": 1, "status": "draft", "x": 9}})
result.data                # {'id': 1, 'status': 'draft'} —— 规则内字段
result.unknown             # {'x': 9}                      —— 未知字段不丢弃
result.defaults_applied    # 实际补齐默认值的字段路径
```

不带异常的查询式解析用 `k.query_parse(version, raw)`，读 `result.ok` 与
`result.errors`；每条错误含 `path` / `expected` / `actual` / `reason`。

### 迁移与回滚

```python
k.put_record("rec-1", "v1", {"id": 1, "status": "published"})
k.migrate_record("rec-1", "v2")     # 成功后记录变为 v2
k.revert_migration("rec-1", mig_id) # 按迁移前快照逐字节恢复为 v1
```

迁移只能沿版本链**向前**；需要恢复旧数据用回滚接口（基于迁移前保存的
完整快照，而不是反向执行 transform）。

### 导出 / 重载

```python
text = k.export_bundle()          # JSON 文本，含 SHA-256 校验和
Kernel().import_bundle(text, transforms={"v3": t})  # 损坏/缺字段即报错
```

transform 是 Python 代码、无法序列化进 JSON：导出时只保存其文字描述；
导入后若仍需向挂 transform 的版本迁移，调用方通过 `transforms=` 重新
提供（按版本 id 索引）。

## 运行

需要 Python 3.9+（标准库，无第三方依赖，完全离线）：

```bash
python -m unittest discover -t . -s tests -v   # 全部单元测试（63 个）
python demo.py                                  # 离线端到端演示
```

---

## 语义规则（行为约定）

### 1. 版本链（需求 1）

- 根版本 `parent=None`；其余版本必须指定**已登记**的父版本，且只能沿链
  顺序登记，因此结构天然无环。
- 一个父版本最多有一个后继：**不允许分叉**，保证“版本之间形成一条演进链”。
  允许登记互不相关的多条独立链（多个根），但跨链迁移 / 差异比较会报错。
- 版本登记只增不改；旧版本规则永远保留，旧文件永远可识别。

### 2. 字段规则（需求 2）

| 键 | 适用 | 说明 |
|---|---|---|
| `name` | 全部 | 非空字符串，不能含 `.`、`[`、`]` 或空白 |
| `type` | 全部 | `string` / `integer` / `number` / `boolean` / `object` / `array` |
| `required` | 全部 | 默认 `false`；**与 `default` 互斥** |
| `default` | 可选字段 | 必须是自身规则接受的合法值（含嵌套校验） |
| `enum` | `string` | 非空、无重复的字符串数组 |
| `fields` | `object` | 非空子规则数组，同级字段名不能重复 |
| `item` | `array` | 唯一元素规则，元素本身可以是 object/array |

非法规则在**登记时**拒绝，错误带定位，例如
`版本 v3/fields[2]/fields[0]/enum`。登记失败不写入任何版本，注册表不变。

演进兼容性在登记时静态检查（除非该版本提供了 transform 显式负责）：

- 新增**必填**字段必须给默认值，或由该版本 transform 产出；
- 标量类型只允许放宽 `integer → number`；收紧 / 转换需要 transform；
- 枚举只能扩值；收窄（删掉旧数据中可能存在的取值）需要 transform 先映射；
- 可选变必填必须给默认值或由 transform 产出。

### 3. 解析（需求 3）

按**数据自带版本标记**选定版本规则，然后：

- **类型**：`bool` 不算 `integer`/`number`；`number` 接受 int/float 并在
  输出中统一规整为 `float`；
- **必填**：缺失即错误，`actual=None`，`reason="缺少必填字段"`；
- **枚举**：值不在枚举中即错误，`expected` 列出全部允许取值；
- 一次解析收集**全部**字段错误（不在首个错误处中断），按
  `(字段路径, 原因, 实际值)` 稳定排序；
- 嵌套对象路径形如 `address.city`，数组元素路径形如 `tags[1].label`；
- 解析在输入的深拷贝上进行，**绝不修改调用方数据**。

### 4. 默认值与未知字段策略（需求 4，本节即策略文档）

**缺字段（旧文件缺后来废弃/变化前的字段，或缺新增的可选字段）：**

1. 字段在该版本中必填且缺失 → 校验错误；
2. 字段可选且声明了 `default` → 深拷贝默认值注入，并把展示路径记入
   `defaults_applied`。默认值本身也要过一遍完整规则解析（嵌套继续补齐、
   `number` 规整），因此**非法默认值在规则登记时就会被拒绝**；
3. 字段可选且没有默认值 → 允许缺省，输出中不出现该键（不会凭空造值）；
4. object 整体缺省：对象本身没有默认值时不补整层；有默认值时按第 2 条处理。

**多字段（新版本才有的字段出现在旧文件里）：**

- 规则之外的键一律视为**未知字段**，不会静默丢弃、也不会混入规则数据；
  原样收集到 `ParseResult.unknown`（映射：展示路径 → 原值），随解析结果
  和迁移记录一起携带、导出；
- 迁移时未知字段逐版本向前携带；当某个新版本为同路径新增了规则，该字段
  自动“转正”，不再算未知。

### 5. 迁移（需求 5）

沿版本链逐版本执行，每一步都复用同一个解析器：

1. 按源版本解析当前数据（校验不变量 + 补默认值）；
2. 应用目标版本登记的 `Transform(description, fn)`（改名、枚举映射、
   嵌套重排等自定义演进；fn 接收 dict 可原地修改）；
3. 按目标版本解析产物。

因此每步产物都与“直接按目标版本解析”的结果一致；引擎在结束时还会再
解析一次最终数据做**复现性自检**（逐字节比对规范化 JSON）。

- 纯函数式：`migrate()` 内部深拷贝，不修改输入；同数据迁移两次得到
  逐字节一致的结果与迁移记录（迁移 id 由 `记录+源+目标+数据指纹` 决定）。
- **失败回滚**：已入库记录迁移失败时，记录版本与数据恢复到迁移前快照，
  且不留下迁移日志条目，内核状态等同迁移未发生。
- 已完成的迁移可用 `revert_migration(record_id, migration_id)` 精确回滚，
  必须按逆序回滚；回滚动作本身也记日志（状态置为 `reverted`，不删除）。

### 6. 差异报告（需求 6）

- `version_diff(a, b)`：规则层面 `added` / `removed` / `type_changed` /
  `enum_changed`（列出具体新增、删除的枚举值）/ `required_changed`；
- `data_diff(a, b, raw)`：额外报告该数据实际触发的 `default_applied`、
  `unknown`（含值）、`parse_error`；
- 全部条目按 `(字段路径, 差异类型)` 稳定排序。

### 7. 查询（需求 7，结果均稳定排序）

- `field_rule(version, path)`：任意版本任意字段（含 `tags[].label`）；
- `field_lifecycle(path=None)`：每个字段路径的引入版本、废弃版本
  （未废弃为 `null`），按路径排序；
- `query_parse(version, raw)`：任意数据在任意版本下的解析结果；
- `migration_path(a, b)` / `plan_migration(a, b)`：迁移逐版本路径与
  每步字段增删；
- `versions()` / `version_chain(v)` / `list_migrations(record_id?)`。

### 8. 导出包（需求 8）

JSON 文档，顶层字段：

```json
{
  "format": "evo-kernel-bundle",
  "bundle_version": 1,
  "versions":  [ { "version_id", "parent", "fields", "description" } ],
  "records":   [ { "record_id", "version_id", "data", "parse_result" } ],
  "migrations":[ { "migration_id", "record_id", "source_version",
                   "target_version", "result", "before", "status",
                   "fingerprint" } ],
  "checksum_sha256": "<其余全部内容规范化 JSON 的 SHA-256>"
}
```

载入校验顺序：JSON 语法 → 顶层字段齐全与类型 → 格式/版本号 →
SHA-256 校验和 → 父版本/记录/迁移引用一致 → 版本链可按序重建 →
每条记录用包内规则重新解析且与包内 `parse_result` 自洽。

任一步失败抛 `BundleError`（中文消息指明位置），重建全程发生在临时
对象上，**全部成功后才替换内核状态**，失败后内存状态保持不变。

## 代码结构

```
evo_kernel/
  errors.py       异常层次（中文消息，错误带路径/位置）
  paths.py        字段路径、字段名校验、规范化 JSON / 指纹
  rules.py        FieldRule：规则字典 -> 校验 -> 对象，序列化
  versions.py     VersionRegistry：登记、演进兼容性、版本链、生命周期
  parser.py       按版本解析：校验/补默认值/未知字段/规范化
  migration.py    逐版本迁移引擎与迁移记录结构
  diff.py         版本差异与数据差异
  persistence.py  导出包组装、校验和、严格载入校验
  kernel.py       Kernel 门面：数据入库、迁移回滚、查询、原子导入导出
tests/            unittest 单元测试（按 8 条需求分文件）
demo.py           离线端到端演示
```
