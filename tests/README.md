# 轨道数值链路离线验证

覆盖恒星系模拟器的核心数值链路，无需浏览器与网络，可批量重复运行：

```bash
npm ci        # 仅首次需要安装依赖（three / typescript）
npm test      # 等价于 node --test tests/*.test.ts
```

Node.js >= 22.18 原生支持 TypeScript 类型擦除，测试直接导入 `src/` 源码，无需编译步骤。

## 覆盖范围

| 文件 | 验证目标 |
| --- | --- |
| `mass-boundary.test.ts` | 质量取 GUI 边界（0.5 / 10 M☉）及全量程扫描时，轨道半长轴、周期与开普勒公式一致，行星位置有限且落在轨道包络内；退化输入（0 / 负质量）不产生 NaN 或除零 |
| `orbit-propagation.test.ts` | 真实近点角跨整周期正确回绕到 [0, 2π)，回绕帧行星位置连续；推进整周期后回到出发点；轨道线 128 个采样点严格满足椭圆方程；固定种子下轨迹逐帧可复现 |
| `perturbation.test.ts` | 双星距离进入/离开扰动阈值（10 单位）时，偏心率与倾角动态项平滑收敛、无单帧跳变，远离阈值后回归基础值 |
| `mass-stability.test.ts` | 质量 0.5↔10 往返 20 次后停在 5，终态与直接设定 5 完全一致（路径无关）；同一质量重复设定幂等 |

## 可复现性

- `Orbit` 构造函数接受可选随机源参数（默认 `Math.random`），测试通过 `tests/helpers.ts` 中的 `mulberry32(seed)` 注入确定性序列。
- 测试通过 `createBinarySystem({ seed, starDistance })` 工厂直接设定双星距离，不依赖渲染循环。

## 注意事项

- `tests/helpers.ts` 安装了最小 DOM 桩（canvas 2d 上下文），使依赖 `document.createElement('canvas')` 的 `Star`/`Orbit` 能在 Node 中实例化；桩仅覆盖构造路径，不模拟渲染。
- 若新增涉及 DOM API 的构造期调用，需要同步扩展桩。
