# 验收报告：带误差定位序列到路网的离线还原模块

- 交付物：`mapmatching/`（纯标准库 Python 包）、`demo.py`（离线演示）、`tests/`（验收测试）
- 运行环境：Python 3.9+，无第三方依赖，全程离线
- 验收命令：
  - `python demo.py` —— 端到端演示 + 内置自检（7 项需求逐项 PASS）
  - `python -m unittest discover -s tests -v` —— **46 个用例全部通过**
- 额外质量手段：200 组随机模糊场景（随机轨迹 × 随机连续禁行 / 禁行-解禁混合序列），
  逐片段比对"增量重算"与"在最终路网上从头全量重算"，**零差异**。

---

## 一、需求逐条验收

### 需求 1：路网维护（唯一标识、方向、长度、禁行）

- 节点 `Node(node_id, point)`、路段 `Edge(edge_id, from_node, to_node, length, oneway, closed)`
  均有唯一标识；重复登记抛 `DuplicateIdError`；路段端点不存在抛 `NodeNotFoundError`。
- 路段缺省长度取端点几何距离，也可显式指定米数。
- 反向通行单行路段：`WrongWayError`，异常携带 `edge_id` 明确指出路段；
  通行禁行路段：`EdgeClosedError`，同样指出路段。
- `RoadNetwork.validate_route(steps)` 校验整条路径，违例抛 `PathValidationError`：
  - `reason="wrong_way" / "closed" / "not_connected"`；
  - `breakpoint_index` 给出断点位置（第几段或哪两段衔接处）；
  - 不连通时同时给出 `from_node / to_node`。
- 验收：`tests/test_1_network.py`（12 例），含"禁行 b1 后 b0→b1 衔接在第 1 段被拒绝"。

### 需求 2：带误差序列登记（单调不减、来源序号幂等）

- `Track.add(tick, point, source, seq)`：
  - 同一来源 tick 必须单调不减，倒退抛 `SampleValidationError`（指出两个 tick）；
  - `(source, seq)` 重复且内容一致 → 幂等忽略（返回 `None`，`track.duplicates` 留痕）；
  - `(source, seq)` 重复但坐标/时刻不同 → 拒绝（同源同序号自相矛盾，禁止静默覆盖）；
  - 不同来源的单调性各自独立维护；同一 tick 允许多来源并存。
- 验收：`tests/test_2_samples.py`（7 例）。

### 需求 3：候选路段匹配（代价、依据、过远不强贴）

- 对每条当前可通行路段做点-线段投影，生成候选：
  - 单行仅顺行候选；双行产生顺/逆行两个等代价候选（朝向交由路径 DP 裁决）；
  - 禁行路段不产生候选，但仍计入"最近路段"证据。
- `Candidate` 携带垂直距离、端点外推量、纵向偏移、垂足与总代价；
  `Candidate.basis()` 与 `MatchResult.explain()` 给出可读匹配依据。
- 距离超过 `MatchConfig.max_distance` → 状态 `UNMATCHED`：
  `UnmatchedSample` 记录最近路段 ID、最近距离与阈值，**绝不强行贴合**。
- 验收：`tests/test_3_matching.py`（7 例）。

### 需求 4：串成合法路径（首尾相接、约束拒绝、断点定位）

- 在每点候选集合上做维特比式 DP：发射代价 = 匹配代价，
  转移代价 = 路网上当前有向约束图中的最短路行驶长度。
- 交付片段 `Fragment.steps` 在组装后**强制**通过 `validate_route`
  （首尾相接 / 单行 / 禁行），非法路径在结构上不可能产出。
- 采样证据因禁行缺失（该点变为未匹配）时，轨迹以该点为界切成片段，
  诊断明确指出 tick 位置；拓扑上不可达的衔接标记 `unreachable`，
  `Leg.reason` 指出从哪个出口节点到哪个入口节点无合法通路。
- 验收：`tests/test_4_path_assembly.py`（5 例）。

### 需求 5：跳变 / 缺失补路（方向合法、不可达明确标记）

- 相邻锚点分四类衔接：
  - `continue` 同边同朝向延续；`direct` 首尾直接相接；
  - `filled` Dijkstra 补出的中间路段（补路只走邻接表中的合法方向，
    单行反向、禁行路天然不可进入），记录补出路段、行驶长度、
    跨越的缺失采样数；补路过长标 `jump_suspected`；
  - `unreachable` 无合法通路：轨迹断成两个片段，绝不制造非法路径。
- 代表性验收（`tests/test_5_gap_filling.py`，5 例）：
  - tick1 在 b0、tick4 在 b2，丢点补出 `b0→b1→b2`，记录缺失 2 个时刻；
  - b1 禁行后跳点补为 `b0→c1(顺)→t1(顺)→c2(逆)→b2`，c2 逆行合法、b1 绝不出现；
  - 封死 n10 全部出路后，补路明确标记不可达并断片；
  - 单行边上的采样倒退，不会产生逆行步。

### 需求 6：多来源矛盾双方保留 + 可读冲突记录

- 每个来源独立完成"匹配 → 合法路径"，`Reconstruction.source_builds`
  同时持有各方全部片段与未匹配证据，**从不择一丢弃**。
- 逐对来源、逐共同时刻比对：
  - 双方匹配到不同路段/朝向 → `match_disagree`；
  - 一方匹配、另一方偏离过远未匹配 → `match_vs_unmatched`；
  - 双方一致（含双方都未匹配）不记冲突。
- `MultiSourceConflict.describe()` 为中文可读记录，点名：轨迹、逻辑时刻、
  两个来源、双方序号与坐标、双方各自匹配结果、"双方均已保留"。
- 验收：`tests/test_6_conflicts.py`（5 例）。

### 需求 7：临时禁行只重算受影响片段，且与全量重算完全一致

- `ReconstructionStore.close_edge(edge_id)`：
  1. 不做全量重匹配，先用旧结果精确圈定可能受影响的来源（片段经过 E、
     最佳候选在 E 上、或采样点几何上临近 E）；
  2. 仅对这些来源在当前路网重匹配，找出最佳匹配变化的 dirty ticks；
  3. 仅重算"经过 E 或触碰 dirty tick"的连续匹配 run，其余 run 的
     **片段 Python 对象原样保留**（可用 `is` 验证）；
  4. 受影响 run 内内容未变的片段同样复用旧对象。
- 每次更新返回 `IncrementalUpdate`：重算/未触及轨迹、被替换/新增/消失
  的片段、复用片段、新增不可达断点。
- 自动等价性校验：把受影响轨迹在当前路网上**从头全量重匹配+重拼接**，
  逐片段（tick 区间 + 规范内容）、逐不可达断点、逐未匹配点、逐冲突比对，
  完全一致才置 `equivalent_to_full_rebuild=True`。
- 正确性依据：禁行对候选集合是单调减法，不经过 E 的旧最优路径仍可行且
  代价不变；所有 DP 并列最优都以固定签名字典序裁决，保证确定性。
- 解禁不具单调性，采用保守策略：重算全部轨迹，但内容不变的片段与
  零变化轨迹整体保留原对象，并执行同样的等价性校验。
- 验收：`tests/test_7_incremental.py`（5 例），含独立第二路网的
  交叉核对（不依赖模块自检）。

## 二、测试结果

```
python -m unittest discover -s tests
Ran 46 tests in 0.01x s
OK
```

| 测试文件 | 用例数 | 覆盖需求 |
|---|---|---|
| test_1_network.py | 12 | 需求 1 |
| test_2_samples.py | 7 | 需求 2 |
| test_3_matching.py | 7 | 需求 3 |
| test_4_path_assembly.py | 5 | 需求 4 |
| test_5_gap_filling.py | 5 | 需求 5 |
| test_6_conflicts.py | 5 | 需求 6 |
| test_7_incremental.py | 5 | 需求 7 |

模糊测试（手工执行，脚本见交付会话记录）：

- 120 组随机轨迹 × 1~4 条随机连续禁行：顺序增量 vs 一次性封闭后全量登记，
  逐片段规范内容零差异，每次内置等价标志均为 True；
- 80 组随机禁行→解禁混合操作序列：最终状态与全量结果零差异。

## 三、已知边界与扩展点（如实说明）

1. 匹配代价目前以垂直距离为主，`CostBreakdown` 已预留航向角、先验等分项，
   扩展不需改 DP 与增量接口。
2. 补路以"行驶长度最短"为目标且不使用采样时间戳速度约束；时间戳只用于
   缺失计数，接入速度模型后可进一步区分"停车"与"绕行"。
3. 冲突检测负责"如实记录双方"，不做自动裁决；上游可基于冲突记录
   （含来源、坐标、匹配代价）做加权融合。
4. 坐标为米制平面；经纬度需先经 `great_circle_meters` 局部投影，
   不适合跨城市的大范围一次性匹配。
