# pattern-kernel：可嵌入的文本模式匹配与结构化抽取内核

用于日志解析与半结构化文本转换的纯 Python 内核。给定一批带占位符的模式，
可以把文本按模式切出字段、在长文本里扫描命中、解释某条文本为什么没匹配上，
并支持分块流式抽取。

**硬约束**：只用 Python 标准库；不接网络；不使用 `re` 模块；匹配引擎是
Thompson 构造的 NFA + Pike VM 模拟，全程无回溯递归，匹配耗时对文本长度线性，
不存在灾难性回溯；同一输入无论分几段喂入，抽取结果完全一致；所有匹配决策
确定可复现。

## 文件

| 文件 | 说明 |
|---|---|
| `pattern_kernel.py` | 内核：`PatternSet`、`StreamExtractor`、模式解析、NFA、Pike VM |
| `main.py` | 命令行入口：标准输入逐行 JSON 命令，逐行 JSON 输出 |
| `test_pattern_kernel.py` | `unittest` 测试（75 个用例） |

运行测试：`python -m unittest test_pattern_kernel -v`

## 模式语法

| 语法 | 含义 |
|---|---|
| 普通字符 | 字面量，逐字符匹配 |
| `\c` | 转义：把下一字符当字面量（用于字面 `{`、`}`、`?`、`\`） |
| `?` | 单字符通配：匹配任意一个字符（含空白） |
| `{name}` | 命名占位符：匹配**非空且不含空白**的连续片段（`\S+`，空白按 `str.isspace()`） |
| `{name:*}` | 贪婪占位符：匹配**任意字符（含空白）零次或多次**，尽量长 |
| `{name:int}` | 类型占位符：匹配 `-?[0-9]+`（ASCII 数字，可选负号） |
| `{name:word}` | 类型占位符：匹配 `[A-Za-z0-9_]+` |

占位符名必须匹配 `[A-Za-z_][A-Za-z0-9_]*`，同一模式内不得重复。
以下情况编译报错（`PatternSyntaxError`）：空模式、占位符名为空或非法、
占位符名重复、未知类型标注（如 `{a:float}`）、`{` 未闭合、裸 `}`、
末尾孤立反斜杠。空 `pattern_id` 同样报错；重复 `pattern_id` 抛
`PatternConflictError`（携带 `conflict_id`）。

## 匹配语义

- **`extract(text, pattern_id)` —— 整串匹配**：模式必须从位置 0 开始
  **完整消费整个文本**，否则返回 `None`。字段按占位符出现顺序返回
  （dict 保持插入序）。
- **`match(text)` / `match_all(text)` —— 最左最长搜索**：在文本的每个
  起点尝试锚定匹配，起点最小者胜出，同起点取最长接受。`match` 返回能命中的
  **pattern_id 字典序最小**的模式；`match_all` 返回全部命中，按 pattern_id
  升序，每项含 `pattern_id / start / end / fields`。
- **字段值一律是字符串**（`{name:int}` 也只约束形状，不做数值转换）。

### 歧义切分优先级（确定性保证）

同一文本可能有多种切分时，按以下规则选出**唯一**结果：

1. **总跨度最长优先**（搜索模式下同一起点的多个接受中，结束位置最大者胜）；
2. 总跨度并列时，**按占位符出现顺序，靠前者取最长**——即最左边的占位符
   尽可能多吃，剩下的交给后续片段。

该规则由 Pike VM 的线程优先级天然实现（贪婪回边优先于出边），不是事后
排序，因此**同一模式加同一文本，跑多少遍结果都相同**，流式与一次性也相同。

示例：

| 模式 | 文本 | 结果 |
|---|---|---|
| `{a}{b}` | `abc` | `a="ab", b="c"`（a 靠前，尽量长） |
| `{a:*} END` | `a END b END` | `a="a END b"`（a 尽量长，吃掉第一个 END） |
| `{a:*}\|{b}` | `x\|y\|z` | `a="x\|y", b="z"` |

### 类型标注策略

类型标注是**硬约束**，直接编译进自动机的字符类：文本片段不满足类型时
**整体匹配失败**（`extract` 返回 `None`），不做静默截断、不做事后转换。
`explain` 会在失败位置报告期望的字符类（如 `a digit (0-9)`）。

## 编译报告

`compile()` 返回：

```json
{
  "pattern_id": "p1",
  "pattern_text": "INFO {msg:*}",
  "states": 12,
  "transitions": 13,
  "placeholders": [{"name": "msg", "type": "greedy"}],
  "possibly_ambiguous": true,
  "ambiguity_reasons": ["placeholder 'msg' ..."]
}
```

`possibly_ambiguous` 是**保守的静态启发式**：若某占位符主体可消费的字符与
其后继片段的首字符集合相交，则报告"可能歧义"。报"可能"不代表一定会出现
多种切分；但不报则一定没有。

## explain：失败定位

`explain(text, pattern_id)` 命中时返回 `{"matched": true, "fields": ...}`；
未命中时返回：

- `position`：失败位置（最后一条存活 NFA 线程无法前进的下标）；
- `expected`：该位置期望的字符（字面量 / 字符类 / `?` / 文本结束）；
- `found`：该位置实际字符（文本耗尽时为 `null`）；
- `reason`：可读原因。三种典型情形：某下标处无可行解析、模式只匹配了
  前缀但尾部有剩余、文本提前结束。

## 流式抽取

```python
se = StreamExtractor(pattern_set, "log", max_buffer=4096)
for chunk in chunks:
    r = se.feed(chunk)   # {"status": "pending", "committed": {...}, "buffered": n}
fin = se.finish()        # {"status": "ok", "fields": {...}, "all_fields": {...}}
```

**语义约定（与一次性 extract 的一致性保证）**：

- `extract` 是整串匹配，因此在输入结束前，任何字段理论上都可能被未来的
  输入推翻。本内核采用**安全提交规则**：当某占位符在**所有存活 NFA 线程**
  中都已完成且取值一致时，它的值不再受未来输入影响，`feed` 通过
  `committed` 字段增量提交它。
- `finish()` 返回**权威最终结果**：`fields` 是尚未提交的部分，
  `all_fields` 是完整字段。成功时 **`committed` 累加 `fields` ==
  `all_fields` == 对完整文本做一次性 `extract` 的结果**，与分块方式无关
  （跨块占位符会被正确拼接）。
- 若 `finish()` 报告 `no_match`，则整次抽取无效，此前提交的字段应丢弃
  （一次性 `extract` 此时也返回 `None`）。
- 若所有线程中途死亡，`feed` 立即返回 `{"status": "failed", ...}`——
  此后任何输入都不可能匹配，无需等 `finish`。
- 空 chunk 是合法 no-op；`finish` 后再 `feed`、重复 `finish` 抛
  `StreamStateError`。

## 内存上限（max_buffer）

流式抽取只需保留"待定"文本：已提交占位符之前的缓冲会被立即丢弃。但当
模式形如 `{a:*} END` 而终止片段迟迟不出现时，待定缓冲会无界增长。

- 构造 `StreamExtractor(..., max_buffer=N)` 时，待定缓冲超过 `N` 个字符
  立即抛 `BufferLimitExceeded`，错误信息会提示**该模式可能导致无界缓冲**
  （例如贪婪占位符的终止片段始终未到达）。超限后流进入失败态。
- `max_buffer=None`（默认）为**精确模式**：不设上限，用于小规模对照或
  确认输入有界的场景。
- `stats()` 的 `stream_pending_buffer_bytes` 实时反映所有活跃流的待定
  缓冲总量。

## 统计

`stats()` 返回：

| 字段 | 含义 |
|---|---|
| `patterns_compiled` | 已编译模式数 |
| `texts_processed` | 已处理文本数（`match`/`match_all`/`extract` 调用次数） |
| `hits` / `misses` | 命中 / 未命中次数 |
| `avg_match_seconds` | 平均匹配耗时（秒） |
| `stream_pending_buffer_bytes` | 活跃流式待定缓冲总字符数 |

## 持久化

`save(path)` 写入 JSON 快照：格式标识、版本、全部模式的
`pattern_id + pattern_text`（按 id 排序，确定性输出）、统计计数。

`load(path)` 重建状态，**全部校验通过后**才替换当前状态（失败不影响
现有状态）。校验项：文件可读且为合法 JSON；`format`/`version` 正确；
`pattern_id` 非空且唯一；`pattern_text` 非空且能重新编译（占位符名合法、
不重复、类型标注合法）；统计计数为非负数。文件损坏或字段缺失抛
`SnapshotError`，错误信息指明具体字段，不静默吞错。save/load 往返后
继续匹配，结果与往返前一致。

## 命令行接口

`python main.py`，标准输入逐行 JSON 命令，逐行输出 JSON 结果；错误输出
`{"ok": false, "error": ..., "error_type": ...}`（pattern_id 冲突时另含
`conflict_id`）。

```jsonc
// 输入（每行一条）
{"cmd":"compile","pattern_id":"log","pattern_text":"{ts} {level} {msg:*}"}
{"cmd":"extract","pattern_id":"log","text":"2026-09-11 INFO hello"}
{"cmd":"match","text":"2026-09-11 INFO hello"}
{"cmd":"match_all","text":"2026-09-11 INFO hello"}
{"cmd":"explain","pattern_id":"log","text":"oops"}
{"cmd":"stream_feed","pattern_id":"log","chunk":"2026-09-11 INFO he","max_buffer":1024}
{"cmd":"stream_feed","chunk":"llo"}
{"cmd":"stream_finish"}
{"cmd":"stats"}
{"cmd":"save","path":"snap.json"}
{"cmd":"load","path":"snap.json"}
{"cmd":"dump"}
```

说明：`stream_feed` 在首次调用时创建流（`pattern_id` 必填、`max_buffer`
可选），后续 `stream_feed` 只需 `chunk`；`stream_finish` 结束当前流。
`dump` 导出全部模式的编译报告与统计。

## 复杂度

设文本长 `n`、某模式 NFA 状态数 `s`：`extract`/`explain` 为 O(n·s)；
`match`/`match_all` 的最左搜索为 O(n²·s)（每模式每起点一次锚定模拟），
模式均为编译期一次性构造。任何情况下都没有指数级回溯。
