# 浑仪拆装研习：步骤状态机

将拆装过程从交互回调中抽离为可独立推演的步骤状态机。每次操作都基于
“当前在位部件集合 + 静态依赖关系”推导可执行步骤、受阻原因与进度结论，
与操作历史路径无关，因此同一操作序列重复执行或乱序执行结论稳定。

## 模型约定

- 部件配置 `deps`：装回本部件时必须先在位的部件；拆下方向相反
  （被依赖的部件须等依赖方拆下后才能拆下）。
- 状态仅为“在位部件集合”，步骤状态 / 受阻原因 / 进度结论全部由此推导。
- 依赖成环：环上部件及被环波及的部件识别为拆下不可达，给出明确原因。
- 依赖指向缺失部件：装回被阻止并给出明确原因，不静默跳过。
- 重复拆下 / 重复装回：识别为无效操作，不改变状态与进度结论。
- 每次操作仅局部重推受影响部件（自身 + 依赖方 + 被依赖方），
  推演入口会逐步校验其与整体重推一致。

## 文件

- `stateMachine.js`：状态机核心（纯 ESM、零依赖，浏览器与 Node 共用）。
- `index.html` / `ui.js`：研习界面，展示部件、当前拆装进度与提示。
- `runner.js`：离线批量推演入口。
- `scenarios/*.json`：部件依赖 + 操作序列 + 期望结论。

## 运行

界面（任意静态服务器，ESM 需 http 协议）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000/armillary/
```

离线批量推演（Node ≥ 18，无需安装依赖）：

```bash
node armillary/runner.js            # 使用 armillary/scenarios 下全部场景
node armillary/runner.js <场景目录>  # 指定场景目录
npm run verify:armillary            # 等价封装
```

任一校验失败（局部/整体重推不一致、期望结论不符、乱序不等价）时退出码非零。

## 场景格式

```json
{
  "name": "场景名",
  "parts": [{ "id": "a", "label": "部件甲", "deps": ["b"] }],
  "ops": [{ "op": "disassemble", "part": "a" }],
  "altOps": [],
  "expect": [{ "step": 0, "kind": "blocked", "messageIncludes": "需先拆下", "removed": 0 }]
}
```

- `ops`：主操作序列；`altOps`（可选）：应到达同一结论的乱序序列。
- `expect`（可选）：对第 `step` 步（0 起）断言 `kind` / `applied` /
  `messageIncludes` / `conclusion` / `removed` / `stepStatus`。
