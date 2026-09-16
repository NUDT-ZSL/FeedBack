# ThemeOracle — 视觉变量与多主题继承编排

纯 Python 标准库实现，无第三方依赖，可完全离线运行与单元测试。
在 Python 3.9 / 3.10 下验证通过（代码仅使用 3.8+ 语法）。

## 解决什么问题

同一套视觉变量在几十个主题下取值、主题间有继承关系时：

- 改一个基础变量，下游主题自动按继承链取到新值，且**只重算受影响的下游**；
- 子主题覆盖父主题时，可以回答「最终值是什么、来自哪个主题、被谁覆盖过」；
- 链上多个主题给出矛盾取值时**不丢任何一方**，生成可读冲突记录；
- 全部定义与冲突快照可写入**单个 JSON 文件**并无损载入，文件损坏清晰报错且不污染内存状态。

## 五分钟上手

```python
from themeoracle import DesignSystem

ds = DesignSystem()

# 变量：唯一标识 + 取值类型 + 默认值
ds.add_variable("color.primary", "color", "#3366ff")
ds.add_variable("radius.base", "length", "4px")

# 主题：单继承 + 自身覆盖
ds.add_theme("base", overrides={"color.primary": "#3366ff"})
ds.add_theme("dark", parent="base", overrides={"color.primary": "#6699ff"})
ds.add_theme("amoled", parent="dark")

# 解析：最终值 + 来源主题 + 继承链
r = ds.resolve("amoled", "color.primary")
r.value      # Color('#6699ff')
r.source     # 'dark'
r.chain      # ('amoled', 'dark', 'base')

# 该变量被哪些主题覆盖过（按主题名稳定排序）
ds.override_themes("color.primary")   # ('base', 'dark')

# 链上的矛盾取值：双方保留
for conflict in ds.conflicts("amoled"):
    print(conflict.describe())

# 增量修改：只重算 dark 自己及其下游 ['amoled', 'dark']
ds.set_override("dark", "color.primary", "#7aa2ff")

# 文件往返
from themeoracle import persistence
persistence.save(ds, "design-system.json")
restored = persistence.load("design-system.json")
```

运行完整演示：

```
python examples/demo.py
```

## 语义约定

### 解析规则（需求 3）

对主题 T 的变量 V：从 T 开始沿 `parent` 链向上，**第一个在自身 overrides 中
给出 V 的主题**即生效来源；整条链都没有时回落到变量默认值
（`ResolvedValue.source is None`、`used_default is True`）。
分支互不可见：dark 支系看不到 light 支系的覆盖。

### 冲突规则（需求 5）

同一条继承链上，只要出现 **≥2 个互不相同的规范化取值**就生成一条
`ConflictRecord`：

- 生效值仍按就近原则解析，不受冲突影响；
- 记录保留链上**全部**赋值（主题 + 取值），顺序为就近到远；
- 同一组矛盾在不同下游视角下分别出记录（视角不同，可见链条不同）；
- `#fff` 与 `#ffffff`、`0` 与 `0px` 这类等价写法经规范化后视为**不冲突**。

### 增量规则（需求 4）

`set_override` / `remove_override` 只重算「被改主题自身 + 其全部下游子孙」
对该变量的缓存条目；其他主题、其他变量的缓存对象原样保留（测试用
`assertIs` 同一性校验）。重算与全量解析是同一段链上查找代码，因此结果
必然一致——测试以「增量系统 vs 从头重放系统」逐步对照验证。
改变继承拓扑（`set_parent`）属于结构变更，会清空全部缓存重算。

### 稳定顺序

| 接口 | 顺序 |
| --- | --- |
| `variable_ids` / `theme_names` | 字典序 |
| `override_themes(vid)` | 覆盖主题名字典序 |
| `inheritance_chain(t)` | 自身 → 父 → … → 根 |
| `descendants(t)` | 自身与全部子孙，字典序 |
| `themes_in_topo_order()` | 父先于子，同父下字典序 |
| `conflicts()` | 主题拓扑序 + 变量标识字典序 |

## 取值类型

| 类型名 | Python 形态 | 规范化说明 |
| --- | --- | --- |
| `string` | `str` | 不接受数字/布尔 |
| `integer` | `int` | 拒绝 `float` 与 `bool`（`bool` 不是整数） |
| `number` | `int`/`float` | 统一为 `float`；拒绝 NaN/无穷 |
| `boolean` | `bool` | 只接受 `true`/`false` |
| `color` | 字符串或 `Color` | `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`/`rgb()`/`rgba()` → 规范 `#rrggbb[aa]` |
| `length` | 字符串或 `Length` | 如 `16px`、`1.5rem`、`0`（零值单位归一为 `px`） |

所有非法输入抛 `InvalidValueError`，消息含期望类型、实际值与定位
（如 `themes['dark'].overrides['color.primary']`）。

## 错误体系

所有异常都继承 `ThemeOracleError`，可一次性兜底：

- `DuplicateVariableError` / `DuplicateThemeError` — 标识重复，带定位
- `InvalidValueError` — 类型不符，带变量、期望类型、实际值与定位
- `VariableNotFoundError` / `ThemeNotFoundError` — 引用不存在对象
- `ParentThemeNotFoundError` — 未知父主题，消息含完整链条，如 `a -> b -> c`
- `InheritanceCycleError` — 继承成环，消息含环路径，如 `base -> amoled -> dark -> base`
- `SerializationError` — 文件损坏/缺字段/冲突快照被篡改，带 JSON 指针式定位

所有拒绝性操作都是**先校验后落库**，失败时系统状态不变。

## 文件格式（`themeoracle/v1`）

单个 UTF-8 JSON 文件，原子写入（临时文件 + `os.replace`）：

```json
{
  "format": "themeoracle/v1",
  "variables": [
    {"id": "color.primary", "type": "color", "default": "#3366ff"}
  ],
  "themes": [
    {"name": "base", "parent": null, "overrides": {"color.primary": "#3366ff"}},
    {"name": "dark", "parent": "base", "overrides": {"color.primary": "#6699ff"}}
  ],
  "conflicts": [
    {"variable_id": "color.primary", "theme": "dark",
     "assignments": [
       {"theme": "dark", "value": "#6699ff"},
       {"theme": "base", "value": "#3366ff"}
     ]}
  ]
}
```

载入时在临时系统上完整重建并校验（JSON 合法性 → 必需字段与类型 →
变量重复/取值类型 → 主题重复/父主题存在 → 环检测 → 冲突快照与重新推导
逐条比对），**全部通过后才原子替换目标系统状态**；任一步失败，传入的
`target` 系统保持原状。`conflicts` 段是防篡改校验快照：手工改了某个
冲突取值而不更新该段，载入会被拒绝。

## 目录结构

```
themeoracle/
  __init__.py     公开 API
  errors.py       异常体系（全部带定位/链条）
  valuetypes.py   六种取值类型与 Color/Length 规范化
  model.py        Variable / Theme / ResolvedValue / ConflictRecord
  core.py         DesignSystem：登记、继承校验、解析、缓存与增量重算
  persistence.py  JSON 单文件导出/载入，严格分段校验
tests/            87 个 unittest（七条需求逐一覆盖）
examples/demo.py  可运行演示
```

## 运行测试

```
python -m unittest discover -s tests -v
```

测试与实现均只 import 标准库（`unittest` / `json` / `os` / `tempfile`），
断网环境可直接运行。
