# 活字印刷排样 — 离线批量验证

## 统一入口

```bash
npm test
# 等价于
node --test "test/**/*.test.ts"
```

无需安装任何依赖、无需浏览器或网络（要求 Node.js ≥ 22，内置 `node:test` 与 TypeScript 类型擦除）。
新增 `test/` 目录下任意 `*.test.ts` 文件会被批量入口自动发现并执行。

## 验证对象

交互链路的全部状态迁移收敛在纯 TypeScript 状态机 `src/state/printingStudio.ts` 中
（不依赖 React/DOM），UI 事件与批量测试调用同一套动作，避免"页面能点但状态漂移"：

| 链路动作 | 状态机 API |
| --- | --- |
| 字架取字 / 取消取字 | `takeFromRack` / `returnHeldToRack` |
| 版盘落位 | `placeOnGrid` |
| 版盘内换位 | `moveOnGrid`（越界返回 `cell-out-of-range`，即回弹原位） |
| 从版盘取回 | `returnToRack` |
| 墨色 / 字号切换 | `setInkColor` / `setFontSize` |
| 捺印导出 | `exportComposition`（生成不可变快照并保留历史） |
| 清空印版 | `clearComposition`（字模全部回收字架） |

`checkInvariants()` 是一致性巡检：每个字模实例在"字架 / 持字 / 版盘"中归属唯一、
总数守恒、版盘占用格位与字模 `position` 完全同步。所有测试在每步操作后都会断言它为空。

## 覆盖的状态一致性风险（test/printingStudio.test.ts）

- 归属唯一：取字离架、落位归属唯一格位、同一字符不能取/放两次
- 同步更新：占用格拒绝落位、取回后格位释放与 position 清除、取回后可再放回、版盘换位双方 position 同步
- 全局设置：墨色/字号切换后已落位与后续落位表现一致、50 次快速连续切换后状态确定且全局统一
- 导出/清空：空版盘导出、连续导出一致、历史快照不被后续操作污染、导出→清空→再排样无旧字符残留
- 边界：版盘满格（9×5=45）继续落位拒绝且状态不变、越界格位、未取字先落位、200 步高频混合操作序列巡检
