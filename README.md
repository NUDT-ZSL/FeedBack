# 离线阅读重排引擎（reflow）

面向阅读类应用包容性适配的**离线、零依赖**重排引擎：字号放大或视窗变化时，
自动重排分栏与图片，保持阅读顺序、锚点关系与阅读位置连续、可追溯、可存档验收。

- 纯 Python 标准库（Python ≥ 3.9），无需联网、无第三方依赖
- 全部规则确定性：相同输入永远产生逐字节一致的输出
- 57 个单元测试 + 75 个脚本化验收点，覆盖需求 1..8 及两处语义收紧

## 目录结构

```
reflow/
  __init__.py      公共 API
  errors.py        错误类型（带 code / position / sequence 等机器可读细节）
  engine.py        模型、校验、几何、分栏、增量重排、恢复、查询、持久化
tests/
  test_engine.py   需求 1..8 的单元测试
acceptance_demo.py 一键离线验收演示（生成样例存档 examples/sample.reflow.json）
```

## 运行

```bash
# 1) 单元测试
python -m unittest discover -s tests -v

# 2) 离线验收演示（逐条打印 [通过]/[失败] 与证据）
python acceptance_demo.py
```

## 快速上手

```python
from reflow import Manuscript, Block, ReflowEngine

ms = Manuscript("doc-1", [
    Block("h1",  "title", 0, 220, content="标题"),
    Block("p1",  "text",  1, 220, content="正文…"),
    Block("img", "image", 2, 260, content="图1 城市天际线",
          image_width=600, image_height=300),
    Block("cap", "note",  3, 180, anchor="img", content="注释须紧跟图1"),
    Block("p2",  "text",  4, 220, content="后文…"),
])

eng = ReflowEngine(ms)
eng.configure(font_size=18, viewport_width=1100,
              reading_block_id="p1", reading_intra_offset=40)

for v in eng.query_all():
    print(v.column, v.offset, v.block_id, v.degraded, v.anchor_satisfied)

eng.save("doc.reflow.json")
eng2 = ReflowEngine.load("doc.reflow.json")   # 载入时完整自洽校验
```

## 需求与实现对照

| 需求 | 实现要点 |
|---|---|
| 1 稿件/块校验 | `Manuscript` 构造即校验：类型 ∈ {正文,标题,图片,注释}，`id` 与 `order` 唯一；错误 `details.position/first_position` 指出位置 |
| 2 锚点合法 | 目标须存在且 `order` 在前；同目标只允许一个紧邻者；DFS 成环检测；`AnchorError.sequence` 给出涉及块序列 |
| 3 确定性重排 | 栏数 `n=clamp(floor(vp/(fs·16)),1,6)` 并按块 `min_readable_width` 下调；顺序流式分栏，栏号随阅读顺序单调 |
| 4 真增量 | ① `(块,字号,栏宽)` 几何缓存 ② 锚点组几何签名前缀复用、placement 对象直接复用、从变化组游标续排；结果与 `reflow_cold()` 冷重排逐字段相等。**“重新打包”与“坐标变化”分离**：`relaid_out_blocks` 是触碰范围（被重新打包的后缀），`affected_blocks` 只含相对上一版 `(栏号,偏移)` 真正变化的块（最小重绘集），前者 ⊇ 后者；可通过 `query_relayout_info()` 分别查询。被重新打包但自身起点没动的块不会出现在 `affected_blocks` 中，调用方据此重绘不做无谓工作 |
| 5 图片策略 | 栏宽够 → 原样；等比缩小但 ≥50% 且 ≥最小可读宽 → `scaled_to_fit`；否则降级占位（`below_legible_scale` / `below_min_readable_width`），保留替代文本，绝不静默丢弃 |
| 6 位置恢复 | `restore_reading_position()` 返回同块新栏号与块内偏移（越界自动夹取并标记 `offset_clamped`）；块缺失时按原始顺序最近原则回退并给 `fallback_reason` |
| 7 稳定查询 | `query_block/query_all` 返回栏号、偏移、是否降级、降级原因、锚点是否满足；顺序固定为 (栏号, 偏移, order)，重复查询逐字段一致；`layout_version` 每次重排 +1。**锚点满足按真实几何判定**：目标须与锚点块同栏、偏移紧邻（`target.offset+height == block.offset`）、同栏前驱恰为目标；打破时 `anchor_satisfied=False`，并通过 `anchor_violation`/`anchor_involved` 及 `query_anchor_violations()` 给出原因与涉及块序列。`verify_anchors(placements)` 也可校验任意（含人为拆散的）版面 |
| 8 存档/载入 | JSON 原子写入（临时文件 + `os.replace`）；载入校验字段完整 → 标识唯一 → 锚点合法 → 按配置重算并逐块比对栏号/偏移/几何；任何失败抛 `PersistenceError` 且不触碰既有引擎状态 |

## 确定性几何模型

- **栏数**：`n = clamp(⌊viewport / (font_size · 16)⌋, 1, 6)`，再当
  `column_width < max(min_readable_width)` 时逐档下调。字号越大、视窗越窄、
  可读要求越宽 → 栏数越少（单调）。
- **栏宽**：`⌊(viewport − (n−1)·gutter) / n⌋`，gutter 默认 16。
- **页高**：阅读视口按 4:3 建模，`page_height = ⌊viewport · 4/3⌋`。
  固定页高是“前缀稳定”的关键：早放置的块坐标不会因后面块变化而漂移。
- **文本高度**：每行字数 `column_width / font_size`（字身宽≈1em），
  `height = ⌈字数/每行字数⌉ · font_size · line-height`
  （正文 1.5 / 标题 1.3 / 注释 1.35）。
- **图片**：`ratio = column_width / image_width`，按上表三档处理。
- **分栏**：锚点链构成不可拆分的组，按阅读顺序流式入栏，当前栏放不下整组
  整体移到下一栏，填满 n 栏开下一“水平带”；栏号跨带连续。因此：
  - 栏号顺序严格等于阅读顺序；
  - 锚点块与目标必然同栏且偏移紧邻（`anchor_satisfied` 据此几何验证）。

## 增量重排的正确性论证（简述）

1. **测量层**：几何只依赖 `(块, 字号, 栏宽)`，命中缓存即零重算；
2. **打包层**：打包是“组序列 + 起始游标”的纯函数。固定栏数与页高下，
   找到第一个几何签名变化的组 `k`，其前各组签名与结束游标与上一版完全相同，
   故前缀 placement 可逐对象复用，从组 `k−1` 的结束游标续排；
3. **等价性**：续排使用与冷重排相同的纯函数、相同输入，由确定性得
   前缀 + 后缀拼接结果与冷重排逐字段相等（测试在多组配置网格上验证）。

## 两个易混语义的边界

**“重新打包” ≠ “坐标变化”。** 字号微变时，后缀组都会被重新打包
（`relaid_out_blocks`），但某块自身的起始栏/偏移可能恰好没变——典型情况是
它仍位于某栏栏首。这类块不进 `affected_blocks`。调用方：

- 想失效几何/渲染缓存 → 看 `relaid_out_blocks` 与 `geometry_recomputed`；
- 只想重绘真正移动的块 → 只看 `affected_blocks`（恒为前者的子集）。

`query_relayout_info()` 一次返回这两个集合及其包含关系是否成立。

**锚点满足是真实几何关系，不是“目标存在”。** 对声明锚点 T 的块 B，需同时满足：

1. T 在当前版面中；
2. T 与 B 同栏；
3. `T.offset + T.height == B.offset`（偏移紧邻）；
4. B 在同栏的紧邻前驱恰为 T（中间没有别的块）。

任一条不满足，`anchor_satisfied=False`，并在 `anchor_violation` 给出中文原因、
`anchor_involved` 给出涉及块序列（如中间插入块 X 时为 `[T, X, B]`）。
引擎自身的锚点组不可拆分，正常版面恒满足；该判定同时能验收**外部/被人为拆散**
的版面：`verify_anchors(placements)` 与纯函数 `verify_anchor_layout()` 接受任意
placements，返回全部 `AnchorViolation`。

## 错误处理

所有领域错误继承 `FlowError`，携带 `code` 与 `details`：

- `ValidationError`：类型 / 标识 / 顺序 / 尺寸非法（含 `position`）
- `AnchorError`：锚点目标缺失、未在前、成环、冲突（含 `sequence`）
- `LayoutError`：字号 / 视窗参数非法，或未重排即查询
- `PersistenceError`：存档损坏 / 缺字段 / 自洽校验失败

## 存档格式

`examples/sample.reflow.json` 为完整样例，顶层：

```jsonc
{
  "format": "reflow-doc/v1",
  "manuscript": { "id": "...", "title": "...", "blocks": [...] },
  "config": { "font_size": 18, "viewport_width": 1100, "gutter": 16 },
  "layout": { "version": N, "column_count": n,
              "blocks": [{ "block_id", "column", "offset", "height", ... }] },
  "reading_position": { "block_id": "...", "intra_offset": 40 }
}
```

载入时 `layout` 不是“被信任的真相”，而是按 `manuscript + config` **重算后逐块比对**
的快照——任何栏号/偏移/几何被篡改都会被检出。
