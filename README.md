# 清晰阅读 · 低视力排版工具

一个本地运行的阅读排版工具：导入长文后，可以持续放大字号、缩窄视窗，
正文实时重排，阅读位置不丢失。

## 启动

```bat
start.bat
```

或手动：

```bash
python server.py            # 默认 http://127.0.0.1:8000
python server.py --port 9000 --no-browser
```

只需要 Python 3，无第三方依赖。浏览器打开后点「载入示例」或「导入文档…」
（支持 .txt / .md，也可以直接把文件拖进窗口）。

## 功能与需求对照

1. **导入与渲染**：文件选择 / 拖拽导入本地长文，按当前字号与视窗宽度连续渲染正文。
2. **实时重排**：字号（16–96px，按钮 / 滑块 / Ctrl+= / Ctrl+-）与视窗宽度
   （拖窗口或工具栏 100%/75%/55%/38%）变化时立即重新换行、重新分栏；
   容器 `overflow-x: hidden` + `overflow-wrap: anywhere`，无横向滚动、无溢出。
3. **位置保持**：重排前捕获视口顶部第一句（句子级锚点 + 视口内比例），
   重排后按同一比例放回，正在读的句子停留在视口相近位置。
4. **超大段落**：正文是普通纵向流，任何段落再高都可逐行滚动读完，不裁切不重叠。
5. **位置标记**：当前阅读句以高亮 + 左侧色条标记，状态栏显示段/句/百分比；
   重排后标记仍指向同一句内容。
6. **稳定收敛**：栏数 = `computeColumns(视窗宽, 字号)` 纯函数，锚点恢复按内容坐标
   绝对定位（非增量累加），ResizeObserver + rAF 合帧，连续微调不漂移、不闪烁。

## 结构

```
server.py            本地静态服务器（--port / --no-browser）
start.bat            一键启动
public/index.html    界面
public/style.css     排版与高对比主题
public/lib.js        纯函数：分段/分句/栏数/滚动恢复（Node 可测）
public/app.js        渲染、锚点捕获与恢复、事件绑定
public/sample.txt    示例长文（tools/make_sample.py 生成）
tests/lib.test.mjs   核心逻辑测试：node tests/lib.test.mjs
tests/e2e_check.py   端到端验证（需 pip install playwright，用本机 Edge 无头运行）
tools/smoke_server.py 服务器冒烟测试
```

## 测试

```bash
node tests/lib.test.mjs     # 分段/分句/栏数/滚动恢复的纯函数测试
python tools/smoke_server.py
python tests/e2e_check.py   # 真实浏览器验证六条需求
```
