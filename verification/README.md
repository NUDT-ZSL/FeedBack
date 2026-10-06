# 离线批量验证（三维时序回放与关键事件定位）

对判定链路（导入 → 回放推进 → 事件关联推导 → 矛盾裁决 → 局部重推）的自动化验证。
零第三方依赖、零网络访问，仅需 Node.js（>=18）。

## 运行

```bash
npm run verify          # 或 node verification/run.mjs
```

- 退出码 `0`：全部用例通过；非 `0`：存在失败。
- 每次运行输出 `verification/verification-report.json`（机器可读报告，含逐用例、逐检查项结果）。

## 风险类别与失败定位

失败输出按类别汇总，可直接定位是哪一类判定不一致：

| 类别 | 覆盖风险 |
| --- | --- |
| `link-integrity` | 指向缺失 / 自引用 / 成环 / 重复 ID 内容不一致的异常归属（不静默跳过） |
| `conflict-adjudication` | 同对象同时刻矛盾状态：裁决前双方保留、裁决后局部重推与整体重推一致 |
| `event-association` | 事件关联修正 / 撤回后影响范围与回放区间精确更新，未受影响部分不被改动 |
| `import-invariance` | 同一输入在不同导入顺序、不同批次切分下结论指纹一致 |
| `baseline` / `end-to-end` | 无异常基线与全链路衔接回归 |

每条失败检查会打印 `actual` / `expected` 的规范化内容，可直接比对。

## 目录

- `src/replay/` 判定链路核心（纯 ESM，可被 UI 复用）：
  - `importer.js` 分批导入与全量校验（异常归属、成环检测）
  - `engine.js` 时间线推导、矛盾识别、事件影响范围推导
  - `session.js` 矛盾裁决与事件修正/撤回后的局部重推（含整体重推对拍）
  - `canonical.js` 规范化序列化 / 内容指纹 / 确定性工具
- `verification/cases/` 用例（每个文件导出一个用例，新增文件即自动纳入批量运行）
- `verification/fixtures/` 本地样例数据
- `verification/harness.mjs` 断言与汇总框架
- `verification/run.mjs` 批量入口
