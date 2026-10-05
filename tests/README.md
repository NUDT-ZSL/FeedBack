# 离线验证（幻灯片状态链路）

## 运行

```bash
npm test
```

统一批量入口：`tests/runner.mjs` → 注册 TS 加载钩子（`tests/loader.mjs`）→
执行 `tests/index.ts`，串行跑完所有验证序列，输出可读的通过/失败结论；
有任意失败时进程退出码为 1。

全程只依赖 Node 与项目已有的 `typescript` 包：不启动浏览器、不触发 DOM
渲染/全屏接口、不加载网络字体或任何在线资源。

## 结构

| 文件 | 职责 |
| --- | --- |
| `src/state/storyState.ts` | 纯状态机：类型、reducer、动作、键盘策略、可注入环境（id/随机源）、轻量 Store |
| `src/state/presentation.ts` | 演示模式服务：全屏能力抽象为可替换端口，含真实 DOM 适配器 |
| `tests/harness.ts` | 用例注册、深度部分断言、操作序列步进器、确定性环境 |
| `tests/storyState.test.ts` | 新增/删除/切换/编辑/键盘导航验证 |
| `tests/presentation.test.ts` | 演示模式进出与全屏不可用/失败时的降级一致性验证 |

## 失败定位

断言失败会输出：序列名称 → 步骤序号与操作标签 → 不符字段的路径及
期望值/实际值，例如：

```
✗ 跳转到不存在或越界的索引被静默跳过
    步骤 #1 [合法跳转]
        字段不符 → currentIndex: 期望 1，实际 2
```

## 确定性

测试环境的 id 自增、随机数按固定序列循环（`tests/harness.ts` 中的
`makeDeterministicEnv`），因此新增幻灯片的数据点可被精确断言，
重复运行结果完全一致。
