# mapmatching —— 带误差定位序列的离线路网还原

把漂移、跳点、丢点、多来源重复上报的定位序列，还原成**合法且可追溯**的
行驶路径。纯 Python 标准库实现，离线可运行、可验收。

## 快速开始

```bash
python demo.py                      # 端到端演示（含 7 项需求的内置自检）
python -m unittest discover -s tests -v   # 46 项验收测试
```

无需联网、无第三方依赖（Python 3.9+）。

## 七项需求与对应实现

| # | 需求 | 实现位置 | 关键行为 |
|---|------|----------|----------|
| 1 | 路网维护：唯一标识、方向、长度、禁行 | `network.py` | `RoadNetwork.add_node/add_edge`；重复 ID 抛 `DuplicateIdError`；反向单行抛 `WrongWayError`（含 `edge_id`）；走禁行路抛 `EdgeClosedError`；`validate_route` 给出断点 `breakpoint_index` 与原因 |
| 2 | 序列登记：单调、幂等 | `samples.py` | `Track.add`；同来源 tick 必须单调不减；`(source, seq)` 重复且内容一致→幂等忽略并留痕，内容矛盾→拒绝 |
| 3 | 候选匹配：代价、依据、未匹配 | `matching.py` | 候选按代价升序，`Candidate.basis()` 给出可读依据；超 `max_distance` 标 `UNMATCHED` 并记录最近路段证据，绝不强贴 |
| 4 | 串成合法路径 | `pathfinding.py` | 维特比式 DP（发射代价 + 路网转移代价）；产出路径在 `_assemble_steps` 中强制过 `validate_route`；不合法衔接不可能产出 |
| 5 | 跳变/缺失补路 | `pathfinding.py` | Dijkstra 在当前有向约束图上补路（`filled`），记录补出路段、缺失采样数、疑似跳变；无合法通路→`unreachable` 断片并说明断点节点 |
| 6 | 多来源矛盾留存 | `tracker.py` | 各方独立还原、结果全部保留；逐时刻比对生成 `MultiSourceConflict.describe()`（时刻、双方来源、坐标、各自匹配），不静默择一 |
| 7 | 禁行增量重算 | `store.py` | 只重算经过被禁边的片段（受影响 run），其余片段 Python 对象原样保留；每次更新自动与"从头全量重算"逐片段比对 |

## 模块结构

```
mapmatching/
  geometry.py    点、投影、点到线段距离、局部米制投影
  network.py     节点/路段、邻接表、方向与禁行约束、路径合法性校验
  samples.py     Observation / Track：单调、幂等登记
  matching.py    候选生成、代价分项、未匹配证据
  pathfinding.py Dijkstra 补路 + 维特比 DP 拼接、断片、不可达标记
  tracker.py     多来源总装与冲突检测
  store.py       禁行/解禁的增量重算与全量等价性校验
  report.py      可读文本报告
  scenarios.py   演示/测试共用的微型网格路网
tests/           7 个测试文件，逐条覆盖需求（46 个用例）
demo.py          端到端离线演示
```

## 典型用法

```python
from mapmatching import (RoadNetwork, Point, Track, Matcher, MatchConfig,
                         TrackReconstructor, ReconstructionStore)

net = RoadNetwork()
net.add_node("A", Point(0, 0)); net.add_node("B", Point(100, 0))
net.add_edge("e1", "A", "B", oneway=True)          # 单行
net.add_edge("e2", "B", "A", oneway=False)          # 双行

track = Track("车-1")
track.add(1, Point(10, 4), "gps", seq=1)            # tick 单调不减
track.add(1, Point(10, 4), "gps", seq=1)            # 幂等：返回 None
track.add(4, Point(90, -3), "gps", seq=2)           # tick2/3 丢点

matcher = Matcher(net, MatchConfig(max_distance=20))
recon = TrackReconstructor(matcher).reconstruct(track)
for frag in recon.fragments:
    print(net.describe_route(frag.steps))           # 合法路径

store = ReconstructionStore(net, matcher)
store.register(track)
report = store.close_edge("e1")                     # 增量重算
assert report.equivalent_to_full_rebuild            # 自动等价性校验
```

## 设计要点：为什么增量结果能与全量重算一致

禁行具有**单调性**：它只会从候选集合中移除候选，不会增加。因此：

1. 旧最优片段若不经过被禁边 E，移除含 E 的候选后它仍可行、代价不变，
   在确定性 DP 下仍是最优——这部分片段在数学上不可能改变；
2. 只有"片段经过 E"或"片段内某采样点最佳匹配发生变化"的 run 才需重算；
3. 受影响 run 用与全量还原**同一份确定性 DP 代码**重算，所有并列最优
   都用固定签名（路段:朝向、补路序列）字典序裁决，同输入必得同输出；
4. 片段标识 `Fragment.content_id()` 由规范内容的 SHA-1 派生，内容相同
   则 ID 相同，增量时直接复用旧对象。

每次 `close_edge` 后，`ReconstructionStore` 会把受影响轨迹在**当前路网**
上从头全量重匹配、重拼接，逐片段（tick 区间 + 规范内容）、逐不可达
断点、逐冲突与增量结果比对，只有完全一致才把
`equivalent_to_full_rebuild` 置为 `True`。

解禁不具备单调性（可能出现更短补路），采用保守策略：重算全部轨迹但
复用内容未变的片段对象，零变化轨迹整体保留原 `Reconstruction`。

## 坐标约定

内部坐标 x/y 为同一米制度量单位。经纬度数据可用
`geometry.great_circle_meters(lon, lat, lon0, lat0)` 做局部等距投影后
登记；匹配阈值、路段长度均以米表达。
