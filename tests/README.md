# 核心逻辑离线测试

针对渐变卡片设计工具的四类核心逻辑的回归测试，全部基于 Node.js 内置
`node:test` 运行器，**零外部依赖、无需 node_modules、无需网络**。

## 运行

```bash
npm test
```

或直接：

```bash
node --import ./tests/register-loader.mjs --test "tests/*.test.mjs"
```

要求 Node.js >= 22.6（直接加载 `.ts` 源文件，利用内置类型剥离）。
退出码非 0 即表示存在回归，可接入任意 CI。

## 覆盖的风险与可观察结论

| 测试文件 | 被测模块 | 结论 |
| --- | --- | --- |
| `color-interpolation.test.mjs` | `GradientEngine.interpolateColorAt` | 锚点位置相同 / 相邻锚点倒序时，插值结果稳定落在两端颜色之间，无越界、无 `#000000` 黑色兜底、无 NaN |
| `history.test.mjs` | `HistoryManager` | 连续提交相同状态后撤销只回退一步；历史容量溢出后撤销/重做链连续且不丢失最近状态 |
| `serialization.test.mjs` | `HistoryManager` 深拷贝 + JSON 序列化 | 含中文、emoji（含 ZWJ 序列、旗帜、组合字符、零宽字符）与特殊符号的文案还原后逐字一致，不转义、不截断，且深拷贝双向隔离 |
| `gradient-def.test.mjs` | `GradientEngine.generateGradientDef` / `generateCSS` | 线性、径向、角向三种类型在 2 个、多个、位置重复的锚点下，SVG 定义始终包含全部锚点且按位置升序 |

## 实现说明

- `tinycolor-loader.mjs` + `register-loader.mjs`：将 `GradientEngine.ts`
  对 `tinycolor2` 的导入重定向到本地 `tinycolor2-stub.mjs`（仅实现
  `toRgb` / `toHexString` 子集），从而在无 `node_modules` 的环境下
  直接测试真实源码，而不是复制出来的逻辑副本。
