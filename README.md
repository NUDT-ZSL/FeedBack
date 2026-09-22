# 批注锚点重定位系统

根据编辑操作序列，把初始文档上的批注锚点重新映射到最新版本，并区分
**已解决 / 待确认 / 已失效** 三种状态。

## 运行

直接用浏览器打开 `index.html`（或 `python -m http.server` 后访问）。
界面默认加载 `data/sample.js` 中的演示数据，也可以点击“载入自定义 JSON”
导入自己的数据文件，格式：

```json
{
  "initialText": "初始文档全文",
  "comments": [{ "id": "m1", "content": "批注内容", "start": 10, "end": 16 }],
  "edits": [
    { "type": "insert",  "pos": 5, "text": "..." },
    { "type": "delete",  "start": 3, "end": 8 },
    { "type": "replace", "start": 3, "end": 8, "text": "..." },
    { "type": "move",    "start": 3, "end": 8, "to": 20 }
  ]
}
```

所有位置均为字符偏移（半开区间），且相对于该操作执行时的文档状态。

## 状态判定规则

核心思路（`js/anchor-engine.js`）：把文档表示为带稳定 ID 的字符序列，
批注锚点对应一组字符 ID；依次应用全部编辑后按存活情况判定——

| 情况 | 状态 |
| --- | --- |
| 锚定字符全部存活，且区间内无新插入字符 | 已解决 |
| 部分存活（仍有重叠文本），或锚点内部被插入 | 待确认 |
| 锚定字符全部被删除 | 已失效 |

界面上可对“待确认”批注执行 **保留**（转为已解决）或 **删除**（从文档移除）。
顶部滑块可逐步回放编辑操作，验证多次编辑叠加下的映射结果。

## 测试

```
node tests/test-anchor-engine.js   # 引擎单元测试 + 500 组随机化交叉验证
node tests/test-ui.js              # 界面冒烟测试（需先 npm install）
```

随机化测试用一套独立的“逐偏移映射”实现交叉验证引擎输出，
确保多次编辑叠加后的批注位置与直接对初始文档应用全部编辑的结果一致。

## 目录结构

```
index.html            界面入口
css/style.css         样式
js/anchor-engine.js   核心引擎（浏览器 / Node 通用）
js/app.js             界面交互逻辑
data/sample.js        演示数据（由 tools/build-sample.js 生成）
tools/build-sample.js 演示数据生成器
tests/                测试
```
