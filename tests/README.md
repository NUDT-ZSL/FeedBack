# 动态波形编辑器 — 离线验证套件

不依赖真实音频设备、浏览器渲染与网络，使用 Node.js 内置测试运行器（`node:test`）
与 TypeScript 原生类型擦除（Node ≥ 22.6 的 `--experimental-strip-types`），
**零安装、可离线、可批量执行**：

```bash
npm test
```

也可以直接运行：

```bash
node --experimental-strip-types --test tests/*.test.ts
```

## 测试设施（tests/helpers/fakes.ts）

- `FakeClock`：接管 `performance.now()` / `requestAnimationFrame`，时间仅在
  显式 `advance(ms)` / `flushFrames()` 时推进，保证结果完全确定、可重复。
- `FakeAudioContext`：无设备的 Web Audio 图（Analyser / Gain / BufferSource），
  `advanceTime(seconds)` 推进音频时钟并在播完时自动触发 `onended`；
  `decodeImpl` 可注入解码结果或让解码失败。
- `RecordingCanvas2D`：记录所有绘制指令，跟踪 `beginPath → stroke/fill` 配对、
  坐标是否有限、是否越界、`save/restore` 是否配对。

## 覆盖范围

### 播放链路（audioEngine.test.ts）
- 加载后时长/初始时间上报，波形长度固定 2048 且归一化到 [0,1]，重复加载稳定，静音不 NaN
- 播放时间随时钟推进；暂停后停住；续播从暂停 offset 继续而非从头
- 播放中持续输出频谱数据
- seek 到任意比例后当前时间 = 比例 × 时长；播放中 seek 仍保持播放
- seek 负数 / 超时长钳制；时长为 0 安全
- 自然结束：时间回起点、`isPlaying` 复位、`onPlayEnd` 触发
- 未加载时播放/暂停/seek 空操作；重复暂停；加载失败后再次加载恢复；重新加载复位旧播放

### 波形渲染（waveRenderer.test.ts）
- 空数据 / 单点数据 / 满量程数据均不抛错，路径全部闭合，无 NaN/越界坐标
- 样式过渡在 300ms 后收敛到目标；连续快速调整最终等于最后一次目标且不残留 rAF
- 扫描线横坐标 = progress × width；resize 安全

### 频谱渲染（spectrumRenderer.test.ts）
- 无数据时柱高单调平滑衰减并归零
- 有数据时按 bin 聚合为 64 柱，EMA 平滑值正确，柱体全部在画布内
- 长度不能被 64 整除 / 小于 64（binSize=0）时安全降级
- 光晕路径闭合，save/restore 配对
