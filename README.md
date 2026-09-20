# 键盘任务流验证台

一个完全本地离线运行的静态 Web 应用，用于验证多步骤任务流在纯键盘操作下是否可达，并实时显示焦点、语义标签、顺序冲突、焦点陷阱和步骤闸门。

## 启动

直接双击打开 `index.html`，或：

```powershell
Start-Process .\index.html
```

不需要安装依赖，也不需要网络或构建步骤。

## 键盘操作

- `Tab` / `Shift+Tab`：沿任务控件移动焦点。
- `Enter` / `Space`：激活按钮、复选框、单选框等控件。
- `Alt+←` / `Alt+→`：上一步、下一步。
- `Alt+S`：对当前步骤设置或取消“临时跳过”。
- `Alt+F`：对当前步骤设置或取消“强制进入”。
- `Alt+E`：显示或隐藏 JSON 编辑器。
- `Alt+A`：当焦点在编辑器中时应用 JSON。
- `Esc`：在焦点陷阱中使用程序出口。

左侧步骤按钮也可直接用键盘选择，便于检查一个自然不可进入的步骤；中央控件仍会保留不可进入/不可达标记。

## 定义格式

顶层是一个对象，`steps` 为步骤数组。步骤字段：

- `id`：稳定步骤 ID；省略时自动生成。
- `name`：步骤名称。
- `controls`：控件数组。
- `order`：可选，声明 Tab 顺序。省略时按非可选控件的数组顺序推导。
- `relations`：可选，`{ "from": "a", "to": "b" }` 表示 `a` 必须在 `b` 前。
- `completion`：完成条件，支持 `all`、`any`、`none`，并通过 `controls` 引用控件。

控件常用字段：

- `id`、`type`、`label`、`ariaLabel`、`ariaLabelledby`。
- `type`：`textbox`、`textarea`、`checkbox`、`radio`、`select`、`listbox`、`button`、`link`、`generic`。
- `before` / `after`：字符串或字符串数组，声明与其他控件的顺序关系。
- `optional: true`：不出现在默认完成条件中，但仍参与顺序推导和问题检查。
- `trap: true`：模拟焦点陷阱。Tab 会在陷阱控件内循环，只能通过 `Esc` 使用程序出口。
- `focusable: false`：声明控件不可聚焦。
- `options`、`defaultValue`、`checked`：控件初始值。

可导入 [examples/task-flow.sample.json](examples/task-flow.sample.json) 查看包含顺序冲突、缺失标签和焦点陷阱的例子。

## 推导与裁决

系统会沿控件顺序建立有向图并进行拓扑/可达性推导：

- 缺少 `label`、`ariaLabel`、`ariaLabelledby` 或文本名称的控件会被标记为语义标签缺失。
- 顺序图中的环会被标记为顺序冲突。
- `trap: true` 会标记为焦点陷阱；其后的控件不能通过自然 Tab 到达。
- 前置步骤未完成时，后续步骤标记为不可进入并显示原因。
- “临时跳过”会把该步骤视为完成裁决并尝试释放后续步骤；但被跳过步骤自身若不在有效路径上，不能修复其定义缺陷。
- “强制进入”只改变进入许可，界面和路径中会明确标注结论来自裁决，原始推导问题仍保留。

修改编辑器中的步骤或控件顺序后，增量分析器从第一个受影响步骤开始重算后续步骤。测试会将增量结果与从头完整推导结果做深比较，保证两者一致。

## 验证

```powershell
npm test
npm run check
npm run browser:smoke
```

核心推导位于 [src/analyzer.js](src/analyzer.js)，不依赖 DOM，可被 Node 直接测试；界面代码位于 [src/app.js](src/app.js)。

`browser:smoke` 是额外的本地 Chrome 键盘冒烟测试，使用脚本中配置的 Windows Chrome 路径和 DevTools 协议；离线打开应用本身不需要执行该测试。
