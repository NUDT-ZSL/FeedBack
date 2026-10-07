# 古风笺纸工坊

基于浏览器的古风笺纸定制应用：挑选宣纸底色、叠加印花与洒金工艺、题字排版，在日光/烛光下预览，最终入匣导出高清 PNG。

## 常用命令

- `npm run dev`：启动开发服务器
- `npm run build`：类型检查并构建产物
- `npm run check`：仅类型检查
- `npm run verify`：**离线批量验证**（无需浏览器），覆盖：
  - 参数变化只使真正相关的渲染层失效，已生成的导出产物不被打乱；
  - 同一份参数多次渲染/导出结果逐字节一致，导出与页面合成一致；
  - 纹样层叠顺序与洒金密度的边界取值（0 片、超界夹取、空印花、空题字、非法参数回退）表现稳定；
  - 题字与纹样/底色的固定遮挡关系（题字永远在最上层）。

## 架构：参数 / 分层渲染 / 导出各自独立

```
src/core/            # 纯逻辑，无 DOM 依赖，浏览器与离线验证共用
  types.ts           # 配方 PaperRecipe（唯一参数来源）、层定义、常量
  recipe.ts          # 参数归一化（边界夹取）+ 分层指纹（失效判定）
  random.ts          # 确定性随机（FNV-1a + mulberry32）与稳定序列化
  goldFoil.ts        # 洒金粒子生成：同 (密度, seed, 尺寸) 恒定同分布
  patterns.ts        # 8 种印花的纯矢量绘制
  renderer.ts        # 四个内容层渲染器 + 固定 z 序合成 + 光源叠加
  engine.ts          # PaperEngine：按层缓存、增量失效、合成、导出
  exporter.ts        # 600x800 木匣导出产物（不可变快照）
  recording.ts       # 录制表面：把渲染记录为可比较的操作日志
  surface.ts         # Surface/RenderContext 抽象
src/utils/
  canvasSurface.ts   # 浏览器 Canvas 适配
  paperRenderer.ts   # 兼容外观：renderPaper(canvas, recipe, lightMode)
src/components/      # ConfigPanel（参数编辑）/ PreviewPanel（预览与入匣）
src/pages/Home.tsx   # 持有配方与光源状态，连接配置与预览
scripts/verify.ts    # 离线批量验证入口
```

关键约定：

- **确定性**：同一份配方（含洒金 `seed`）无论渲染多少次，纹样层叠顺序与洒金分布完全一致；需要重新随机时显式更换 `seed`。
- **分层失效**：每层只依赖配方的对应切片（尺寸影响全部层），改一个参数只重绘相关层，其余层与已生成的导出产物保持稳定。
- **导出一致**：导出复用页面同一合成结果，产物以内容指纹命名并缓存，重复导出得到同一不可变快照。
