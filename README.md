# 补贴申报自助引导（离线版）

一个**完全离线、无需后端、无需安装**的分步申报引导应用，面向第一次办理复杂补贴申请的用户。
用户随时可以回头修改答案，系统会沿依赖关系自动判定：**哪些后续答案仍然有效、哪些必须重新确认、哪些暂不适用（但原样保留）**，并逐项给出判定依据。

## 一、运行方式

直接用浏览器打开本目录下的 `index.html` 即可（双击或拖入 Chrome / Edge）。
不联网、不发请求、不写磁盘，所有数据只存在于当前页面内存中。

- 首屏即为可操作界面，从第 1 步开始。
- 地址栏加演示种子可直达典型场景（便于验收）：
  - `index.html#seed` —— 已填写后修改上游数字，下游两题变为「待重新确认」并显示依据链；
  - `index.html#seed2` —— 切换补贴项目，原专项步骤整体「未激活」，已填答案保留只读；
  - `index.html#block` —— 必答未完成时点击前进，触发阻止面板（指出缺失项）。
- 右下角「配置校验演示」可直接查看三类非法配置被拒绝时的报错（位置 + 链条）。

命令行运行引擎测试：

```bash
node tests/engine.test.js
```

## 二、目录结构

```
index.html        界面结构
styles.css        样式（含深色模式、响应式）
js/engine.js      引导引擎（无依赖，UMD：浏览器 window.GuideEngine / Node module.exports）
js/config.js      示例申报配置（一次性就业补贴）
js/app.js         界面渲染与交互
tests/engine.test.js  引擎测试（26 项，node 直接运行）
```

## 三、四种状态（问题）

| 状态 | 含义 | 是否计入进度 |
|---|---|---|
| **已确认** confirmed | 答案有效，且自确认以来其依赖输入未变化 | 是 |
| **待重新确认** needsReconfirm | 上游答案变化（或失活/恢复）波及本题；**原答案保留并显式标注**，核对后一键确认 | 否（待办） |
| **未激活** inactive | 所属步骤或本题的成立条件当前不满足；**若曾填写，答案原样保留**，条件恢复自动回来 | 否 |
| **未到达** unreached | 条件适用、但还没轮到作答 | 否 |

步骤另有：已完成 / 进行中 / 未激活 / 未到达 / 已跳过（可跳过步骤）。

关键原则：**答案永远不会被静默清空或删除**。未激活时答案「保留未激活」；恢复成立后原样回到流程，
不要求重填，也不会重复计入进度。

## 四、配置格式

```js
{
  stages: [{ id: 'prepare', title: '申报准备' }],
  steps: [
    {
      id: 's_x',                 // 必填，全局唯一（步骤与问题共用命名空间）
      title: '步骤名',
      stage: 'prepare',          // 可选，必须是已登记阶段
      skippable: false,          // 可选，是否允许整步跳过
      dependsOn: ['q_a'],        // 条件中引用的每个问题都必须在此显式声明
      condition: (a) => a.q_a === 'person', // 可选，步骤成立条件
      questions: [
        {
          id: 'q_b',             // 必填，全局唯一
          title: '问题',
          type: 'text',          // text/textarea/number/select/radio/boolean/date
          options: [{ value: 'x', label: 'X' }],
          optional: false,       // 可选，true 为选填
          dependsOn: ['q_a'],
          condition: (a) => a.q_a === 'x'
        }
      ]
    }
  ]
}
```

条件函数 `(answers) => boolean` 只能访问 `dependsOn` 中声明的问题；未声明/未登记的访问在校验时即被拒绝。
条件读到「未激活或未作答」的问题时得到 `undefined`。

## 五、配置校验（加载时强制进行，非法即拒绝启动）

`validateConfig(config)` 返回 `{ valid, errors, warnings }`，`createGuide` 对非法配置抛 `GuideConfigError`。
每条错误含 `code / message / location`，成环错误额外含 `chain`（首尾相接的完整闭环）。

| 规则 | 错误码 | 报告内容 |
|---|---|---|
| 问题/步骤标识缺失或重复 | `E_Q_ID` `E_STEP_ID` `E_DUP_ID` | 两处具体位置（第几步第几题 + 标题） |
| 依赖了不存在的标识 | `E_UNKNOWN_REF` | 引用者位置 + 被引用 id |
| 依赖指向了步骤（只能引用问题） | `E_REF_KIND` | 位置 |
| 自引用 / 步骤条件依赖本步骤问题 | `E_SELF_REF` `E_STEP_SELF_DEP` | 位置 + 链条 |
| 依赖成环（含经所属步骤间接成环） | `E_CYCLE` | 完整环链 `a → b → c → a` 及每环位置 |
| 条件访问了未在 dependsOn 声明的标识 | `E_DEP_NOT_DECLARED` | 位置 + 标识 |
| 阶段未登记、选项重复、类型非法等 | `E_UNKNOWN_STAGE` `E_OPTION_DUP` `E_Q_TYPE` … | 位置 |

引擎同时在两张图上查环：① 各对象自声明依赖图；② **运行时求值图**
（问题求值依赖「所属步骤 + 自身依赖」），从而捕获「问题经步骤依赖间接闭环」。

## 六、改答传播是怎么判定的

- 每次确认答案时，记录当时全部依赖输入的**基线签名** `{依赖id: {active, value}}`。
- 任意答案变化后全量重算，逐题把基线签名与当前签名比较：
  - 依赖由激活变失活 → `deactivated`；由失活变激活 → `reactivated`；激活且值改变 → `changed`；
  - 命中任一项 → **待重新确认**（硬失效，必须本人核对确认）；
  - 直接依赖仍处于待重确认 → 连带挂起（软级联），依据里给出**根源问题与完整依赖链**；
  - 依赖恢复为与基线一致 → 自动解除挂起、恢复已确认，无需操作。
- 右侧面板与问题卡片即时展示失效范围、每条依据（含「由 X 变为 Y」）和依赖链。
- 未受影响的答案与步骤进度保持不变。

求值按依赖图的**拓扑序**进行（配置无环保证可排序）。

## 七、前进守卫

- 步骤存在未完成的必答问题（未作答或待重新确认）时，`advance` 抛错并被界面拦截：
  红色面板逐项列出缺失问题、原因（尚未作答 / 答案待重新确认）以及依赖链；
  **该动作不写入任何状态，已填内容与状态保持原样**。
- 未激活问题不能作答、未到达步骤不能跳转，同样被拒绝且不改状态。
- 不可跳过的步骤不能跳过；可跳过步骤可随时「取消跳过」回来补填。

## 八、引擎主要 API（详见 engine.js 注释）

```js
const g = GuideEngine.createGuide(CONFIG);
g.getState()                 // {cursor, furthest, reached, answers, questionStates, stepStates, reasons, lastChange}
g.answer(questionId, value)  // 作答 / 重新确认；返回 {state, change}
g.advance(stepId?)           // 前进；不满足时抛带 missing(含 chain) 的守卫错误
g.back() / g.goTo(stepId)
g.skipStep(id) / g.unskipStep(id)
g.getBlocking(stepId)        // 纯查询：{blocked, missing:[{questionId,title,status,chain,reasons}]}
g.getQuestionState(id) / g.getStepState(id) / g.getReasons(id) / g.getAnswer(id)
g.progress()                 // {required, confirmed, pending, unanswered, retained, percent}
g.canFinish()
GuideEngine.validateConfig(cfg)
```

## 九、需求对照

1. 维护步骤/问题、阶段、可否跳过、问题唯一标识；重复与悬空引用拒绝并定位 —— 见第五节。
2. 依赖声明与成立条件、不成环；悬空/成环拒绝并给链条 —— 见第五节。
3. 回改答案沿依赖判定沿用 vs 重确认，逐项说明依据 —— 见第六节，界面右栏与卡片内依据。
4. 待重确认保留原答案并显式标注、不清空；未受影响内容与进度不变 —— 有专门测试。
5. 步骤条件失效→其答案「保留未激活」；恢复后原样回到流程、不重复计进度 —— 有专门测试。
6. 跳过必答 / 条件不满足时前进被阻止，指出缺失项与依赖链，且不改任何状态 —— 见第七节。
7. 界面展示步骤序列与四种状态；改答后即时更新失效范围、依据与可用操作 —— 见界面。
