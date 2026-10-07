# 陶器碎片拼合链路离线验证

针对“碎片几何 → 拼合判定 → 进度推进 → 完成态结算”链路的离线验证能力。
不依赖浏览器、three.js 或任何 npm 包，仅需 Node.js（≥22，原生运行
TypeScript），可完全离线执行。

## 运行入口

```bash
npm run verify        # 等价于 node verification/run.ts
```

批量执行 `verification/cases/*.json` 中的全部用例，逐组输出
`PASS` / `FAIL` 及失败原因；存在失败组时进程退出码为 1。

## 验证覆盖的风险

每组用例在重放碎片集合 + 操作序列时，统一执行五类检查：

1. **结论符合期望**：状态、进度计数、已拼合集合、进度轨迹、拒绝事件、
   失真原因逐项比对。
2. **进度与完成态相互印证**：`checkSnapshotConsistency` 校验计数与列表、
   轨迹与计数、完成态与事件流之间不得互相矛盾（含自检组，确认矛盾
   输入一定会被暴露而非放过）。
3. **确定性复现**：同一操作序列重放两次，结论逐字节一致。
4. **入口一致性**：`place` 批量入口自动展开为 `drag`+`submit` 交互入口，
   同一碎片集合走出的结论必须一致。
5. **变体一致性**：用例自带的等价操作序列（如顺序颠倒）结论必须一致。

边界输入（依赖成环、依赖指向缺失、空集合、未知碎片、重复提交、位姿
超差）均有对应用例，要求链路显式暴露失真或拒绝，不得静默放过。

## 用例格式

每个用例是一个 JSON 文件：

```json
{
  "name": "用例名",
  "description": "覆盖意图",
  "fragments": [
    {
      "id": "f1",
      "targetPosition": { "x": 2.1, "y": 2.0, "z": 0.0 },
      "targetRotation": { "x": 0.0, "y": 0.3, "z": 0.0 },
      "dependsOn": []
    }
  ],
  "operations": [
    { "type": "place", "fragmentId": "f1",
      "position": { "x": 2.5, "y": 1.8, "z": 0.1 },
      "rotation": { "x": 0.1, "y": 0.3, "z": 0.0 } },
    { "type": "drag", "fragmentId": "f2", "position": {}, "rotation": {} },
    { "type": "submit", "fragmentId": "f2" }
  ],
  "variants": [
    { "name": "等价变体（可选）", "operations": [] }
  ],
  "expect": {
    "status": "completed | in-progress | distorted",
    "placedCount": 6,
    "placed": ["f1"],
    "trajectory": [1, 2, 3],
    "rejections": [{ "fragmentId": "f1", "reason": "duplicate-placement" }],
    "distortions": ["dependency-cycle"]
  }
}
```

`expect` 中所有字段均可选，只校验声明了的维度。新增用例只需在
`verification/cases/` 下放入新的 JSON 文件，无需改动运行器。

## 被验证的核心模块

- `src/types.ts`：碎片、操作、事件、快照的纯类型定义（可序列化）。
- `src/puzzleLogic.ts`：吸附/碰撞判定、集合结构校验（依赖成环、指向
  缺失等）、会话推进器、快照一致性印证。渲染层（scene.ts）后续只需
  在边界处做 THREE 类型转换，拼合结论以该模块为准。
