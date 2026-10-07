# 木料印章工坊 · 离线批量验证

无需浏览器、无需网络、无需安装第三方测试框架，直接运行：

```bash
npm run verify
# 或指定套件/场景：
node --experimental-transform-types --no-warnings verify/run-verify.ts continuous
node --experimental-transform-types --no-warnings verify/run-verify.ts B1
```

验证入口：`verify/run-verify.ts`，结果同时打印到终端并写入
`verify/reports/verify-report.json`（已被 .gitignore 忽略）。任意断言失败时退出码为 1。

## 覆盖场景

- `verify/suites/continuous.ts`（连续刻印状态隔离）
  - C1 切换木料（松木→紫檀）：新一方不继承旧木料属性快照、尺寸、印文与可用字体
  - C2 同一方印重复盖印：记录相互独立、槽位不同、参数刻制后冻结，外部篡改不回流
  - C3 连续刻印三方（松/紫檀/黄杨）：台账与画布记录互不串扰；新一方校验失败不污染历史
- `verify/suites/export.ts`（盖印与导出的状态边界）
  - E1 导出后快照与全新工坊逐项一致（画布/台账/木料/参数/校验结果/计数器）
  - E2 清空画布后立即开新一方：无记录、无文字、无槽位残留，空画布导出被拒绝
  - E3 导出 SVG 确定可复现，内容不含时间戳
- `verify/suites/boundary.ts`（木料属性 × 尺寸 × 字体的参数校验）
  - B1 松木 17–32mm、紫檀 8–37mm、黄杨 11–39mm，min-1/max+1 边界稳定
  - B2 边界值在完整工坊流程中的校验与单次纯函数校验一致
  - B3 硬度门槛（缪篆 ≥55）、字体专属木料（铁线篆仅黄杨）、字体最小尺寸
  - B4 离线模式拦截未缓存在线字体（马善政体），本地字体不受影响
  - B5 印文长度边界（空 / 1 字 / 4 字 / 5 字）

## 离线约束

- 验证代码只依赖 Node 内置模块与 `src/` 下的纯逻辑，不 import React/Three.js。
- 字体清单见 `src/fonts.ts`：小篆、楷书、缪篆、铁线篆均为本地字体栈；
  马善政体标记为 `remote`，离线模式校验返回 `FONT_OFFLINE_MISSING`。
  若将来要在离线环境使用它，将本地字体文件放入仓库并把该条目的 `cached` 置为 `true` 即可。
- 画布导出为内联 SVG（`src/canvas.ts`），不依赖 DOM/Canvas/字体加载。
