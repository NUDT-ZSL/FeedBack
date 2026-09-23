# focuslines — 多工作线专注与中断恢复

一个人同时推进多条工作线，每条线由若干有序阶段组成；专注过程中可被
临时打断，之后可继续原阶段、切换到其他阶段，或放弃整条线。无论打断
多少次，每条线的进度、剩余时间和上下文都能被正确推导。

## 核心设计

- **计时模型**：任意时刻只有一个阶段在计时。每次暂停/切换/完成时，
  把当前计时片段累加进该阶段的 `invested_seconds`；剩余时间永远由
  `预计 - 已投入` 推导，因此恢复时不会从预计时长重新开始。
- **状态机**：
  - 阶段：`pending -> active <-> paused -> completed`
  - 工作线：`active -> completed | abandoned`
  - 会话：`idle -> focusing -> interrupted -> (resume|switch) -> focusing`
- **中断上下文**：每次中断记录原因、发生时刻和当时已投入时间。
- **时钟可注入**：`FocusTracker(clock=...)` 便于测试与持久化恢复。

## 命令行用法

```bash
python -m focuslines.cli add-line "写报告" --stage "草稿:30" --stage "审阅:20"
python -m focuslines.cli start L1 S1            # 进入阶段，开始计时
python -m focuslines.cli status                 # 查看所属工作线与剩余时间
python -m focuslines.cli interrupt --reason "临时会议"
python -m focuslines.cli resume                 # 继续原阶段（基于已投入推导）
python -m focuslines.cli switch L1 S2           # 跳到同线另一阶段，原阶段保留未完成
python -m focuslines.cli done                   # 完成当前阶段
python -m focuslines.cli abandon L2             # 放弃整条线并给出汇总
python -m focuslines.cli summary L1             # 查看某条线的汇总
```

状态默认持久化到 `focus_state.json`（可用 `--state` 或环境变量
`FOCUS_STATE` 覆盖），跨进程重启不丢失计时上下文。

## 测试

```bash
python -m pytest tests/ -q
```

12 个测试覆盖：多线与阶段结构、计时与剩余时间展示、中断暂停与原因
记录、恢复后剩余时间推导、反复打断的正确性、线内/跨线切换、稍后
回到暂停阶段、完成与放弃的汇总、非法状态迁移拒绝、持久化往返。
