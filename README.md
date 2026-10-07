# 古代花灯铺 / Ancient Lantern Shop

基于浏览器的虚拟古代花灯铺：挑骨架、裱绢纱、绘灯面、点亮、上墙，支持多件作品并行制作。

## 运行

```bash
npm install
npm run dev        # 开发服务器（/ 与 /batch.html）
npm run build      # 产出 dist/，index.html 与 batch.html 均为自包含单文件
npm run preview    # 预览构建产物
```

构建后的 `dist/index.html`、`dist/batch.html` 已内联全部 JS/CSS，可直接双击离线打开（file:// 协议）。

## 多作品模型

- 每件作品（`LanternWork`）独立持有骨架、纱色、笔触、直线、点亮状态、创建时间与随机编号。
- 顶部「新开一盏」创建作品并自动切换；作品条上的 chip 用于切换/删除。
- 花灯墙展示 `savedAt !== null` 的作品；重复保存只更新同一盏灯，不新增条目。
- 删除作品同时将其移出花灯墙，当前编辑对象自动回退到剩余作品，不留悬空引用。
- 「清空重做」：未上墙的作品重置内容保留身份；已上墙的作品直接从墙上移除。

## 批量自检入口

- 浏览器：页面右上角「批量自检」，或直接打开 `batch.html`。
- 命令行：`npm run verify:batch`（Node 环境复现同一套场景，38 项检查）。

自检覆盖：多作品创建与来回切换、切换中的临时笔触归属、保存与花灯墙同步、
删除与清空的同步、绘制前置条件守卫（未选骨架/纱色不可落笔）、30 件作品下的一致性。

## 结构

```
src/
  App.tsx               主组件：语言 Context、作品条、花灯墙、布局
  Workbench.tsx         工作台：骨架/纱色/颜料/画笔交互与画布事件
  LanternRenderer.ts    Canvas 渲染引擎（骨架、绢纱、笔触、点亮动画、导出）
  renderAdapter.ts      LanternWork ↔ 渲染器同步、缩略图/整图缓存
  store/lanternStore.ts 纯函数状态核心（reducer + 不变量检查）
  store/useLanternStudio.tsx  React Context 绑定
  batch/batchScenarios.ts     批量自检场景（页面与 CLI 共用）
  types.ts / i18n.ts    类型与库存数据 / 中英文案
scripts/
  verify-batch.mjs      Node 侧批量自检
  inline-dist.mjs       构建产物内联（离线单文件）
```
