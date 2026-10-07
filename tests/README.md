# 云锦织机状态链路离线验证

无需网络、无需安装依赖：`npm test`（等价于
`node --experimental-transform-types --disable-warning=ExperimentalWarning tests/run.mjs`，
要求 Node.js >= 22.7）。全部用例通过退出码为 0，任一失败退出码为 1，可直接接入批量脚本。

## 覆盖的风险链路

- `loom.test.ts` 织造推进（完成只触发一次、完成后冻结、织造中调整目标长度）、落纱颜色联动、越界槽位
- `pattern.test.ts` 灰度→织法/提花映射、应用图案后经线配色、重复/切换图案可复现、逐行提花序列、行索引回绕
- `scroll.test.ts` 悬浮/展开/回卷合法与非法迁移、自动回卷计时在手动回卷/隐藏/重建后不残留
- `boundary.test.ts` 目标长度上下限与 NaN/Infinity、时间步长 0 或过大、全程无 NaN/负长度

## 替身与隔离

- `env/stubs/three.mjs`：最小 THREE 替身（对象树、几何体/材质、BufferGeometry、InstancedMesh、Color 数学）
- `env/stubs/howler.mjs`：Howl 播放替身，记录调用而非发声
- `env/dom.mjs`：canvas 2D、Web Audio、window/document 等浏览器全局替身
- `env/clock.mjs`：可控虚拟时钟，统一驱动 `performance.now()` 与 `setTimeout`，
  动画与自动回卷计时均确定性推进，无需真实等待
- `env/loader.mjs`：自定义 resolve 钩子，将 `three`/`howler` 指向本地替身并解析无扩展名的 TS 导入
