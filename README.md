# exprkernel

可嵌入的**表达式求值与静态检查内核**，面向规则配置与指标计算场景。
纯 Python 标准库实现，**不使用 `eval`/`exec`，不依赖第三方库，不访问网络**。

处理管线：

```
表达式文本
  → Lexer（词法，行列位置）
  → Parser（递归下降 → AST）
  → TypeChecker（静态检查：未定义变量 / 类型 / 参数 / 除零告警）
  → Compiler（AST → 字节码）
  → Evaluator（显式操作数栈解释执行 + 逐步 trace）
```

## 快速开始

```python
from exprkernel import Engine

engine = Engine()
engine.bind("threshold", 100)                 # 字面量绑定
engine.bind_expr("gmv", "80 + 30")            # 表达式绑定（可引用其他变量）
engine.bind_expr("ratio", "(gmv - 80) / 10")

chk = engine.check("gmv > threshold and ratio > 1")
print(chk.ok, chk.type)                        # True 'bool'

r = engine.evaluate("if(gmv > threshold, 'hit', 'miss')", logical_time=0)
print(r.ok, r.value, r.type, r.logical_time)   # True hit string 9
for step in r.trace:                           # 每一步求值轨迹
    print(step.tick, step.op, step.inputs, "->", step.output)
```

## 语法

| 类别 | 内容 |
|---|---|
| 字面量 | 数字（`1`、`2.5`、`.5`、`1e-3`，统一有限 float）、字符串（`'x'` / `"x"`，支持 `\n \t \\ \' \"`）、布尔 `true` / `false` |
| 变量 | `[A-Za-z_][A-Za-z0-9_]*`（关键字与内置函数名保留） |
| 一元 | `-x`（number）、`not x`（bool） |
| 二元 | `+ - * / %`（number；`+` 也用于 string 拼接）、`< <= > >=`（number）、`== !=`（同类型） |
| 逻辑 | `and` / `or`，短路求值 |
| 分组 | 括号 `( ... )` |
| 函数 | `min(a,b)`、`max(a,b)`、`abs(x)`、`round(x)`、`if(cond, a, b)` |

类型系统只有 `number` / `string` / `bool`：算术只接受 number，
大小比较只接受 number，判等要求两侧同类型，逻辑只接受 bool，
`if` 两个分支必须同类型；函数参数个数与类型在静态阶段校验。

## 静态检查

`engine.check(expr)` 返回 `CheckResult`：

- `ok`：是否通过；
- `type`：推断出的结果类型（失败为 `None`）；
- `undefined`：未定义变量诊断列表（去重、带行列位置）；
- `type_errors`：类型不匹配、参数个数错误等；
- `warnings`：告警。目前仅 `WARN_DIV_ZERO_LITERAL` —— 表达式中出现
  字面量 `0` 作除数时**提前告警但不阻断**，真正求值时仍返回
  `EVAL_DIV_ZERO` / `EVAL_MOD_ZERO`。

静态检查不过时，`evaluate` 直接拒绝执行，不会等到运行时才炸。

## 变量绑定与循环引用

- `bind(name, value, type_hint=None)`：重复绑定返回失败，
  `result.conflict_name` 给出冲突名。
- `bind_expr(name, expr)`：允许前向引用；每次注册都对依赖图做一次
  显式栈 DFS，成环则注册失败，`result.cycle` 给出首尾闭合的变量序列：

```python
engine.bind_expr("a", "b + 1")
r = engine.bind_expr("b", "a + 1")
print(r.ok, r.cycle)        # False ['b', 'a', 'b']
```

注册失败的变量不会进入注册表（失败即不存在）。依赖链深度受
`max_depth` 限制（默认 64）。

## 求值与错误处理

`engine.evaluate(expr, logical_time=0)` 返回 `EvalResult`：

- 成功：`ok=True`，`value` 为原生 Python 值，`type` 为类型标签，
  `trace` 为逐步轨迹（每条含 `tick/pc/op/text/line/column/inputs/output`），
  `logical_time` 为末 tick（整数逻辑时钟，起始值可注入，便于测试）；
- 失败：`ok=False`，`error` 是带 `code` / `message` / `line` / `column`
  / `extra` 的诊断对象；任何错误都不会以未捕获异常的形式逃逸。

运行时错误码：`EVAL_DIV_ZERO`、`EVAL_MOD_ZERO`、
`EVAL_STRING_TOO_LONG`（拼接超过 `max_string_len`，默认 100000）、
`EVAL_DEPTH_EXCEEDED`、`EVAL_NON_FINITE`（运算溢出为 inf/NaN 时拒绝传播）、
`EVAL_UNDEFINED_VAR`、`EVAL_TYPE`、`EVAL_INTERNAL`。

## 测试

```bash
python -m unittest test_exprkernel -v
```

覆盖词法解析、语法解析、静态类型检查、循环引用/重复绑定、
求值语义、trace 生成与全部边界场景（空表达式、只有括号、非法变量名、
未闭合字符串、除零、类型不匹配、循环引用、递归过深、if 分支不一致、
inf/NaN 等）。

## 模块结构

| 文件 | 职责 |
|---|---|
| `errors.py` | 错误码/告警码、`Diagnostic`、内部异常 |
| `values.py` | `TypedValue`、有限浮点守卫、类型推断 |
| `lexer.py` | 词法分析 |
| `ast_nodes.py` | AST 节点 |
| `parser.py` | 递归下降解析器 |
| `checker.py` | 静态类型检查（错误收集，不遇错即停） |
| `registry.py` | 绑定、依赖图、环检测、深度守卫 |
| `compiler.py` | AST → 跳转式字节码（短路/分支在编译期落实） |
| `evaluator.py` | 显式栈字节码解释器、trace、运行时守卫 |
| `kernel.py` | `Engine` 门面 |
