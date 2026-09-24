# 字幕对齐推演工具（离线）

纯本地、零第三方依赖（Python 3 标准库 + 浏览器），用于把一批来源杂乱、
时间标注常有偏差的字幕片段对齐到媒体播放位置，并解释每步推演依据。

## 启动

```
python server.py
```

然后浏览器打开 http://127.0.0.1:8765 （端口可用环境变量 `ALIGN_PORT` 修改）。
启动后直接进入时间轴 + 片段列表界面，内置 `sample_data.json` 示例，
也可通过界面"载入 JSON"换成自己的数据。

## 数据格式

```json
{
  "media": {"duration": 620.0, "fps": 25.0, "name": "demo.mp4"},
  "anchors": [{"id": "a1", "segment_id": "s2", "media_time": 10.0, "note": "..."}],
  "segments": [{"id": "s1", "start": 2.0, "end": 5.5, "text": "...", "source": "asr-v1"}],
  "decisions": {}
}
```

锚点也可用 `"text_match": "台词片段"` 代替 `segment_id` 绑定到首个包含该文本的片段。

## 对齐推演规则

- 锚点断言某片段的起点应对齐到媒体时刻 T，隐含偏移 = T − 片段原始起点。
- 两锚点之间的片段按区间线性插值偏移（置信度：中）；锚点绑定片段为
  高置信；锚点范围之外按最近区间的漂移速率外推（置信度：低）。
- 矛盾检测（双方依据均保留，不静默择一）：
  - 锚点隐含偏移与相邻锚点插值不一致（anchor_conflict）；
  - 对齐后与相邻片段重叠（overlap，双方各记一条）；
  - 对齐后越出媒体时长范围（越界，记为警告）；
  - 时长倒置（end ≤ start）与缺少锚点：标记为"不可信"并说明原因。
- 漂移累积趋势：每段偏移相对首个锚点偏移的漂移量与逐段步进，
  用于判断锚点修正效果。

## 裁决与增量重推

在详情面板可对矛盾片段裁决：采用锚点 / 采用插值 / 指定偏移 / 清除裁决；
可直接拖动时间轴上的锚点或在锚点列表中改时刻。引擎按依赖关系只重推
受影响片段（`apply_change`），`test_engine.py` 逐用例断言增量结果与
整体重推（`derive`）完全一致。

## 测试

```
python -m unittest test_engine
```

## 文件

- `align_engine.py` — 对齐推演引擎（全量 derive / 增量 apply_change）
- `server.py` — 本地 HTTP 服务与 JSON API
- `static/index.html` + `static/app.js` — 时间轴 / 列表 / 裁决界面
- `sample_data.json` — 覆盖各类异常的示例数据
- `test_engine.py` — 异常检测与增量一致性测试
