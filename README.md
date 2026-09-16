# 互动叙事素材编排模块（story_composer）

编剧把同一批**素材单元**按不同**叙事目标**组合成多条故事线。模块解决三类老问题：
引用悬空、替代版本选错、改一条素材后别的故事线仍引用旧内容。

- **纯标准库**（`dataclasses` / `collections` / `typing`），无第三方依赖
- **完全离线**，无需网络或包管理器
- 自带 `unittest` 测试套件（61 个用例）

## 运行测试 / 演示

```bash
python -m unittest discover -s tests -v   # 全部单元测试
python demo.py                            # 端到端可执行示例
```

## 核心概念

| 概念 | 类型 | 说明 |
|---|---|---|
| 素材单元 | `MaterialUnit` | 唯一 `unit_id`、`unit_type` 类型、`body` 正文、`version` 版本号、`prerequisites` 前置依赖 |
| 替代版本组 | `group` | 同一逻辑素材的多个版本用相同 `group` 串联；缺省 `group == unit_id`（无替代版本） |
| 叙事目标 | `NarrativeGoal` | 唯一 `goal_id`、`audience` 受众取向、有序槽位 `slots` |
| 槽位 | `Slot` | `slot_id`、`required_type` 所需类型、`required` 是否必填 |
| 选择来源 | `source` | 谁给出的选择，如 `editor` / `auto`。**同一来源重复给同一槽位不同素材 = 硬冲突，拒绝；不同来源 = 双方保留并记录冲突** |

## 七项需求如何落地

### 1. 素材单元、依赖无环、悬空引用定位
- `register_unit` 拒绝重复 id（`DuplicateIdError`），改写走显式的 `update_unit`。
- 前置依赖必须存在，否则抛 `DanglingReferenceError`，异常上带有
  `unit_id` / `dependency` 与可读位置（`前置依赖[i]（prerequisites 中的 'x'）`）。
- 依赖图用确定性 DFS 检测成环，抛 `CyclicDependencyError` 并给出环路径，如
  `a -> b -> c -> a`。模型层同时禁止自依赖。

### 2. 叙事目标 / 槽位配置校验
- 目标 id、受众非空；至少一个槽位；槽位 id 不得重复；`required_type` 非空；
  `required` 必须是布尔。任何非法配置在构造或注册时即拒绝（`ValueError` /
  `ValidationError`）。
- 改写目标时允许重排槽位（按槽位 id 迁移选择并全量重校验），但不得删除仍有
  素材的槽位、不得改变其所需类型。

### 3. 填槽校验（类型 + 前置依赖 + 单素材）
`fill_slot(goal_id, slot_id, unit_id, source=...)`：
- 类型不匹配 → `SlotFillError`，带 `goal_id/slot_id/unit_id`；
- 前置依赖未在**更早槽位**出现 → `SlotFillError`，带 `missing_dependency`，
  错误信息明确指出是哪个目标的哪个槽位、哪条依赖未满足；
- 同一来源在同一槽位改填不同素材 → `SlotConflictError`（指出旧/新素材）；
- 同一槽位可容纳**不同来源**的选择（见第 6 点），所以"最多一个素材"在消解后成立：
  同组版本唯一入选；跨组则显式冲突而非静默二选一。
- 前置依赖按**替代版本组**满足：槽位里有组 `setup` 的任一版本即可满足依赖。

### 4. 替代版本的确定性选择
槽位上的选择按组归并：
- **同组**：排序键 `(版本号降序, unit_id 字典序升序)`，版本优先、同分时按标识
  字典序打破平局，选出唯一版本；所有给出选择的来源记为一致来源。
- `auto_fill` 自动组合用同一规则在"类型匹配且前置依赖已满足"的候选中取第一名，
  按槽位顺序填充。因此同一目标、同一素材库、同一选择集合，**无论操作顺序如何，
  重复组合都得到完全相同的素材序列**（有随机顺序的对照测试）。

### 5. 改写 / 新版本的增量重算
- 每个版本有稳定指纹 `(group, version, unit_id)`。
- 单元改写后，通过**反向依赖闭包**（被改单元 + 传递依赖于它的单元）找出直接选中
  其中任一单元的目标，只把这些目标标记为脏；查询时惰性重算，其余目标不触碰。
  `recompose_log` 可观测实际重算了哪些目标。
- 重算函数是关于（目标定义、选择集合、素材库）的**纯函数**，因此增量结果与
  `recompose_all()` 从头重排逐字节一致——`test_incremental_matches_full_recompute_*`
  在一系列随机操作序列后，每一步都比对增量实例与强制全量重算实例。
- 槽位级缓存带输入指纹：**未受影响的槽位连结果对象都保持不变**（有 `is` 同一性断言）。
- 破坏性改写（会使已成立编排失效，如把被依赖的单元挪到别的组）在提交前用假定的
  新素材库预校验，整体拒绝、状态不变，并指出哪个目标的哪个槽位会失效。

### 6. 跨来源矛盾：双方保留，不静默择一
不同来源在同一槽位给出**不同组**素材时：
- 全部选择原样保留（`slot_sources` / `SlotResolution.choices` 可查）；
- 该槽位 `chosen is None`，生成 `ConflictRecord`，`render()` 给出可读描述：
  目标、槽位、双方（多方）来源及各自素材与版本；
- `conflicts()` 返回全部未解决冲突，按 `(目标 id, 槽位顺序)` 稳定排序；
- 序列在冲突槽位不输出任何素材（而非偷偷选一个），并计入 `unfilled_required`。

### 7. 查询（全部稳定顺序）
| 方法 | 返回 |
|---|---|
| `get_sequence(goal)` | 当前素材序列 `GoalSequence`（位置/槽位/入选 id/版本/来源） |
| `get_slot_resolution(goal, slot)` | 槽位解析：入选版本、全部来源、冲突记录 |
| `slot_sources(goal, slot)` | 各来源的原始选择 `(source, unit_id, version)` |
| `references(unit)` | 该素材被哪些目标/槽位/来源引用，含 `effective` 是否真正入选 |
| `referencing_goals(unit)` | 引用它的目标 id（字典序） |
| `referenced_units()` | 被引用素材列表 `(unit_id, 目标 id 元组)`，单元/目标均字典序 |
| `conflicts(goal=None)` | 全部（或某目标）未解决冲突 |
| `unfilled_required(goal)` | 必填但无一致入选素材的槽位（含未填与冲突） |

所有列表都按明确的键排序（单元/目标/来源按字典序，槽位按声明顺序），
重复查询返回相等结果。

## 最小示例

```python
from story_composer import Composer, MaterialUnit, NarrativeGoal, Slot

c = Composer()
c.register_unit(MaterialUnit("setup", "scene", "开端"))
c.register_unit(MaterialUnit(
    "duel", "scene", "决斗", prerequisites=frozenset({"setup"})))
c.register_unit(MaterialUnit(
    "duel-v2", "scene", "决斗（重剪）", version=2,
    prerequisites=frozenset({"setup"}), group="duel"))
c.register_goal(NarrativeGoal(
    "g1", "新观众", [Slot("s1", "scene"), Slot("s2", "scene")]))

c.fill_slot("g1", "s1", "setup", source="editor")
c.fill_slot("g1", "s2", "duel", source="editor")
c.fill_slot("g1", "s2", "duel-v2", source="reviewer")  # 同组新版本

seq = c.get_sequence("g1")
print(seq.material_ids())   # ('setup', 'duel-v2')  —— 新版本确定性胜出
```

## 文件结构

```
story_composer/
  __init__.py     # 公共 API 导出
  model.py        # 不可变值对象（单元/目标/槽位/选择/解析/冲突）
  composer.py     # Composer 编排引擎：校验、消解、增量重算、查询
  errors.py       # 带结构化定位信息的异常体系
tests/            # unittest 套件（单元、目标槽位、版本/冲突、增量、查询）
demo.py           # 端到端可执行示例
```

## 设计备注

- **依赖按"组"满足而非按具体版本**：槽位中出现某组的任意版本，即视为该组对应的
  前置依赖已满足。这让"换用替代版本"不需要重写下游的依赖声明。
- **硬冲突 vs 跨来源矛盾**：同一来源不能在同一槽位自相矛盾（直接拒绝，避免脏数据）；
  不同来源的分歧是真实的创作分歧，系统的职责是完整呈现而不是替人拍板。
- **前置依赖只看更早槽位**：同一槽位内或更后槽位的素材不能满足依赖，保证故事线
  是一条有向推进的序列。
