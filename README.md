# pattern-kernel：可嵌入的文本模式匹配与结构化抽取内核

从日志文本中按模式抠取字段的纯标准库内核。上游按任意大小的分片（chunk）
喂入，无需等整条日志到齐。**不使用 `re` 模块，不使用回溯递归**：模式经
Thompson 构造编译为 NFA 指令程序，匹配用 Pike-VM 风格多线程模拟执行，
复杂度 O(状态数 × 文本长度)，长文本不会爆栈或指数退化。

## 文件

| 文件 | 说明 |
|---|---|
| `pattern_kernel.py` | 内核：`PatternSet`、`StreamExtractor`、错误类型 |
| `main.py` | 命令行入口 |
| `test_pattern_kernel.py` / `test_main.py` | unittest 测试 |

## 模式语法

| 语法 | 含义 |
|---|---|
| 普通字符 | 字面量，原样匹配 |
| `\x` | 转义：把任意字符 `x` 变为字面量（如 `\?`、`\{`、`\\`） |
| `?` | 单字符通配：匹配任意一个字符 |
| `{name}` | 命名占位符：非空且不含空白的连续片段 |
| `{name:*}` | 贪婪占位符：任意字符（可含空白、可为空），在“剩余模式仍能匹配”的约束下尽量长 |
| `{name:int}` | 整数占位符：可选符号位 `+`/`-` + 至少一位 ASCII 数字 |
| `{name:word}` | 词占位符：`[A-Za-z0-9_]` 的非空序列 |

占位符名须为 `[A-Za-z_][A-Za-z0-9_]*`，同一模式内不得重名。
`pattern_id` 为非空字符串，按**字典序升序**决定优先级（需要数值顺序时请
自行零填充，如 `007`）。

## 匹配语义（重要约定）

- **整串匹配（full match）**：模式必须覆盖整段文本，不多不少。文本有剩余
  或文本不足都算不匹配。
- **歧义优先级**：多个模式命中同一段文本时，`match()` 返回 `pattern_id`
  升序的第一个；`match_all()` 按 `pattern_id` 升序返回全部命中。
- **贪婪归属**：相邻占位符或贪婪占位符的分界由 NFA 线程优先级确定——
  左侧占位符在满足剩余模式的前提下尽量长。例如 `{a}{b}` 作用于 `xyz`
  得 `a="xy", b="z"`；`{a:*}={b}` 作用于 `x=y=z` 得 `a="x=y", b="z"`。
- **类型标注不匹配的策略**：类型约束（`int`/`word`）在编译期进入自动机，
  在匹配期生效。文本不满足类型约束时，该模式**整体不匹配**——
  `match()` 跳过它继续尝试后续模式，`extract()` 返回 `None`，
  `explain()` 给出失败位置与期望的字符类别。不会产出“半匹配”的字段。
- **类型转换**：`extract()`/`match()` 的字段值中，`int` 占位符产出
  Python `int`，其余产出 `str`。

## PatternSet API

```python
from pattern_kernel import PatternSet

ps = PatternSet()
report = ps.compile("001", "ERROR {code:int} {msg:*}")
# report = {"pattern_id", "state_count", "transition_count", "placeholders"}

ps.match("ERROR 42 disk full")        # {"pattern_id": "001", "fields": {"code": 42, "msg": "disk full"}}
ps.match_all("ERROR 42 disk full")    # 全部命中，按 pattern_id 升序
ps.extract("ERROR 42 disk full", "001")  # [42, "disk full"]，按占位符出现顺序
ps.explain("ERROR abc", "001")        # {"matched": False, "position": 6, "reason": ...}
```

- `compile()` 重复 `pattern_id` 抛 `PatternConflictError`，冲突 id 在
  异常的 `.pattern_id` 属性上。
- `extract()`/`explain()` 引用未知 `pattern_id` 抛 `UnknownPatternError`。
- 模式语法错误抛 `PatternSyntaxError`，带模式内偏移 `.position`。

## StreamExtractor：流式抽取

```python
from pattern_kernel import StreamExtractor

ex = StreamExtractor(ps, max_buffer=65536)
out = ex.feed("ERROR 42 disk")    # 尚无完整行 -> []
out += ex.feed(" full\nINFO ok")  # 第一条记录在此确定
out += ex.finish()                # 冲刷尾部 "INFO ok"
```

- 记录按 `\n` 切分；行尾单个 `\r` 会被去掉（兼容 CRLF）。末尾无换行的
  最后一行在 `finish()` 时作为一条记录处理。
- 每条结果：`{"line_no", "pattern_id", "fields"}`；未命中任何模式时
  `pattern_id` 为 `None`、`fields` 为 `{}`。`line_no` 从 1 开始。
- **一致性保证**：同一段文本，无论一次性喂入还是切成任意大小的分片逐片
  `feed()`，产出的记录序列完全一致；跨分片的占位符会被正确拼接。
- **max_buffer 策略**：未终结（未遇到 `\n`）的缓冲超过 `max_buffer`
  字符时，丢弃该缓冲，产出一条
  `{"error": "buffer_overflow", "pattern_id": null, "fields": {}, ...}`
  记录（占用一个 `line_no`），后续数据继续正常处理。默认上限 1 MiB。
- `finish()` 之后不能再 `feed()`（抛 `PatternError`）。

## 快照 save/load

```python
ps.save("patterns.snapshot.json")
ps2 = PatternSet.load("patterns.snapshot.json")
```

快照为 JSON，含格式标识、版本、模式列表与统计信息。`load` 重新编译全部
模式并校验统计一致；文件不是合法 JSON、格式/版本不符、缺少字段或统计被
篡改时抛 `SnapshotError`，错误信息指明具体原因。往返后模式与统计一致。

## 命令行

```bash
python main.py compile --pattern-id 001 --pattern 'ERROR {code:int} {msg:*}'
python main.py match    --pattern '001=ERROR {code:int} {msg:*}' --text 'ERROR 42 disk full'
python main.py match-all --snapshot patterns.snapshot.json --text 'ERROR 42 disk full'
python main.py extract  --pattern '001=ERROR {code:int} {msg:*}' --pattern-id 001 --text 'ERROR 42 x'
python main.py explain  --pattern '001=ERROR {code:int} {msg:*}' --pattern-id 001 --text 'ERROR abc'
python main.py stream   --snapshot patterns.snapshot.json < app.log          # 按行喂入
python main.py stream   --snapshot patterns.snapshot.json --chunk-size 7 < app.log
python main.py save     --pattern '001=ERROR {code:int} {msg:*}' --output patterns.snapshot.json
python main.py stats    --snapshot patterns.snapshot.json
```

- `--pattern ID=PATTERN` 可重复，按第一个 `=` 切分；可与 `--snapshot` 叠加。
- 所有输出为 JSON（stdout）。出错时 stdout 输出
  `{"error": ..., "error_type": ...}` 并以退出码 1 结束。

## 测试

```bash
python -m unittest discover -v
```

覆盖：模式解析、NFA 构造（状态数/转移数）、抽取语义、流式一致性
（任意分片 vs 一次性）、歧义优先级、max_buffer 上限、快照往返与
损坏文件、错误处理与 CLI。
