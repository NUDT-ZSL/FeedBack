# 离线装载编排模块（loading）

把一批货物按**属性、空间约束和堆叠规则**确定性地装进多节车厢；清单或车厢
条件变化后**只重排受影响部分**，结果与从头编排完全一致。

- 纯 Python 标准库，无第三方依赖，完全离线
- Python 3.9+（在 3.10 上验证）
- 单元测试：`python -m unittest discover -s tests`（86 个用例）
- 离线演示：`python demo.py`
- 缺陷修复验收：`python verify_acceptance.py`（超限定位 + 双顺序逐车厢一致）

## 目录结构

```
loading/
  errors.py       异常体系（错误精确定位到字段 / 超限层号）
  geometry.py     3D 盒几何：重叠检测、候选放置点（extreme points）
  models.py       Cargo / Vehicle / Placement / LoadPlan（构造即校验）
  planner.py      确定性全量编排 + 增量重排
  system.py       LoadingSystem：维护、查询、变更记录、原子化变更
  persistence.py  JSON 保存 / 载入（载入时完整校验，原子写文件）
tests/            八条需求对应的 unittest 用例
demo.py           八条能力的离线演示
```

## 快速上手

```python
from loading import Cargo, Vehicle, LoadingSystem, save_to_file, load_from_file
from loading.geometry import Box

s = LoadingSystem()
s.add_vehicle(Vehicle("V1", 10, 3, 3, max_weight=2000,
                      blocked=(Box(8, 0, 0, 2, 3, 3),)))  # 尾部不可用区域
s.add_vehicle(Vehicle("V2", 8, 3, 3, max_weight=1500))

s.add_cargo(Cargo("A1", 2, 2, 2, weight=300, stack_limit=2))
s.add_cargo(Cargo("F1", 1, 1, 1, weight=20, fragile=True))

s.plan_all()                      # 编排（与 add 顺序无关）
s.vehicle_details("V1")           # 明细 / 剩余空间 / 剩余载重 / 利用率
s.locate_cargo("A1")              # -> 车厢 + 坐标 + 朝向 + 层

s.update_vehicle(Vehicle("V1", 10, 3, 3, 2000,
                         blocked=(Box(4, 0, 0, 6, 3, 3),)))  # 只重排受影响车厢

save_to_file(s, "plan.json")
s2 = load_from_file("plan.json")  # 载入时校验：唯一/合法/无重叠/不超载
```

## 编排规则（全部确定性）

1. **货物排序**：体积降序、id 升序——与到达顺序无关。
2. **车厢排序**：id 升序逐节尝试，第一节能合法放入的车厢即落点
   （放不下自动**跨车厢改派**）。
3. **位置枚举**：六个轴对齐朝向 × extreme-point 候选点，取
   `(z, x, y, 朝向)` 最小的合法位置（尽量贴地、贴角）。
4. **合法性**：在车厢内部；不与不可用区域或其他货物重叠；不超载；
   底面必须被地板 / 不可用区域顶 / 货物顶**完全支撑**（可用多件拼合支撑）。
5. **堆叠**：货物 `stack_limit` 是其**正上方允许的累计层数**；易碎货物
   恒为 0（上方不得压任何货物）。违反时拒绝并指出**第几层超限**。

## 增量重排为什么与从头编排一致

货物始终按同一个全局顺序处理。变更后：

- 变更货物、所在受影响车厢（含已删除车厢）的货物 → 全部车厢重决策；
- 其他货物 → 先按序试探旧车厢**之前**的车厢（捕捉容量释放后被更早车厢
  “吸入”的情况）；都放不下时旧位置在逐件归纳相同的状态下必然仍合法，
  原样保留。

重决策货物落入新车厢会把新车厢也标记为受影响（连锁改派），因此
`affected_vehicles` 之外的车厢装载**逐字节不变**，而整体方案与
`plan_all()` 全量重排完全相同（测试以 60+ 次随机变更做等价性验证）。

## 八条需求与测试对照

| 需求 | 测试文件 |
| --- | --- |
| 1. 货物维护、正数校验、非法配置指出位置 | `tests/test_01_cargo.py` |
| 2. 车厢 / 不可用区域 / 重叠与边界校验 | `tests/test_02_vehicle.py` |
| 3. 确定位置与朝向、与到达顺序无关 | `tests/test_03_determinism.py` |
| 4. 易碎 / 累计层数 / 指出超限层 | `tests/test_04_stacking.py` |
| 5. 跨车厢改派、不超限、不重复装载 | `tests/test_05_rerouting.py` |
| 6. 只重排受影响车厢且与全量一致 | `tests/test_06_incremental.py` |
| 7. 明细 / 剩余空间载重 / 利用率 / 定位（稳定顺序） | `tests/test_07_queries.py` |
| 8. JSON 保存载入、严格校验、失败状态不变 | `tests/test_08_persistence.py` |

## JSON 文件格式

```json
{
  "format": "loading-plan", "version": 1,
  "cargos":  [{"id": "A1", "length": 2, "width": 2, "height": 2,
               "weight": 300, "stack_limit": 2, "fragile": false}],
  "vehicles": [{"id": "V1", "length": 10, "width": 3, "height": 3,
                "max_weight": 2000,
                "blocked": [{"x": 8, "y": 0, "z": 0,
                             "dx": 2, "dy": 3, "dz": 3}]}],
  "plan": {"V1": [{"cargo": "A1", "vehicle": "V1",
                   "x": 0, "y": 0, "z": 0, "orientation": [0, 1, 2]}]},
  "records": [{"seq": 1, "action": "full_plan",
               "changed_cargos": [], "affected_vehicles": [],
               "replanned": true}],
  "seq": 1
}
```

载入会重放整份方案，逐项校验：标识唯一、尺寸/坐标合法、朝向合法、
无重复装载、所有货物均已装载、无重叠、底面有支撑、不超载重、不违反堆叠。
任何错误抛 `PersistenceError` 并说明字段位置；`load_from_file` 总是
返回全新对象，失败不会影响调用方已有系统；`save_to_file` 采用
临时文件 + 原子替换，不会留下半截文件。

## 坐标与朝向约定

- 轴：`x` 长、`y` 宽、`z` 高，原点在车厢地板一角，坐标非负。
- `orientation` 是 `(0,1,2)` 的一个排列：货物原始尺寸
  `(长,宽,高)` 分别映射到车厢的哪根轴，共六种轴对齐朝向。
- 贴合（共面、共边）不算重叠。
