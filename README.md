# 表单填写离线推演台

这是一个无外部依赖的离线交互应用，用于接收键盘、语音、开关、粘贴等输入事件，并沿事件顺序推导表单字段结论。

## 启动

直接双击 `index.html`，或在 Windows 上双击 `start.bat`。不需要联网、构建步骤或第三方服务。

## 能力

- 字段支持类型、正则/数值格式、必填标记、依赖前置字段和可接受输入方式。
- 事件保留来源、顺序、原始内容与依据说明。
- 输出字段当前值、来源、错误事件、依赖阻塞、可信标记和 `canConfirm` 可确认状态。
- 同一字段出现相互矛盾的有效输入时，不会自动以后发事件覆盖；双方证据都保留，必须由用户采信或人工修正。
- 新事件会使旧裁决失效，要求重新裁决。
- 修改字段或依赖后，只重算该字段、旧/新前置字段和下游字段；测试验证增量结果与整表重算一致。
- 依赖成环、前置字段定义缺失、字段收到不支持的输入方式时，结论标记为不可信并展示原因。

## 文件

- `index.html`：离线界面。
- `engine.js`：可在浏览器和 Node 中复用的推导引擎。
- `app.js`：界面状态、事件录入、裁决与本地持久化。
- `engine.test.js`：Node 内置测试框架编写的规则测试。

## 给其他模块的核心接口

```js
const engine = new FormEngine.FormDeduction({ fields, events, decisions });
engine.addEvent({ fieldId: "email", source: "voice", raw: "a@b.com", basis: "语音识别" });
engine.adjudicate("email", { mode: "event", selectedEventId: "evt_1" });
engine.updateField("city", { dependencies: ["country"] });
engine.getResult("email");
```

`getResult(fieldId)` 返回的关键字段：

- `value` / `displayValue`：当前结论值。
- `source`：结论来源。
- `status`：`ready`、`conflict`、`invalid`、`unsupported`、`blocked`、`cycle` 等状态。
- `trusted`：是否可信；依赖异常或不可用输入会为 `false`。
- `canConfirm`：是否可确认。
- `issues` / `dependencyIssues`：错误、警告及其事件 ID、来源。
- `rawAttempts`：仍参与当前结论的事件证据。

## 测试

```bash
npm test
```
