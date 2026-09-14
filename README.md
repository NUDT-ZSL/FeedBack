# 资源管理内核（resource_kernel）

离线可验收的命名资源登记/释放内核：统一管理句柄、临时文件、连接池槽位、
锁等进程内外占用，保证**初始化中断可回退、释放失败可重试、最终占用归零、
任意时刻可查、状态可持久化往返**。仅依赖 Python 标准库（3.10+），无需
联网或第三方包。

## 目录结构

```
resource_kernel/
  __init__.py        包入口，导出公开 API
  __main__.py        支持 python -m resource_kernel
  kernel.py          状态机与生命周期内核（类型注解 + docstring）
  persistence.py     JSON 原子导出 / 校验式导入
  cli.py             标准输入行式 JSON 命令行
tests/
  hooks.py           脚本化初始化/释放回调（模拟失败、超时、异常中断）
  test_kernel.py     状态机、回退、重试、归零、强制清理测试
  test_persistence.py 导出导入往返与损坏文件测试
  test_cli.py        CLI 端到端（含子进程方式）测试
```

## 资源状态机

| 状态字符串 | 含义 | owner | occupation_count |
|---|---|---|---|
| `idle` | 空闲 | null | 0 |
| `initializing` | 初始化中（瞬态） | null | 0 |
| `occupied` | 已占用 | 归属者标识 | 1 |
| `releasing` | 释放中（上次失败，待重试） | null | 0 |
| `released` | 已释放 | null | 0 |
| `failed` | 连续失败达上限，仍可被清理接管 | null | 0 |

关键不变量：

- 同一资源同一时刻最多一个归属者；重复申请返回 `resource_busy`，
  错误信息带当前持有者。
- 初始化失败或抛异常（被打断）时**完整回退**到 `idle`：归属者、计数、
  瞬态状态、尝试序号全部清空，回退后立即可以重新申请。
- 释放失败进入 `releasing` 并逐次记录原因；连续失败达 `max_retries`
  进入 `failed`，但登记仍在，`retry` 或强制清理可随时接管。
- `idle` / `released` / `failed` 状态下均可重新申请，申请前自动清掉
  上一轮的归属者、计数、重试次数与失败原因，保证无残留。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

测试可重复执行，不依赖网络，临时目录自动清理。

## 库 API 快速示例

```python
from resource_kernel import ResourceKernel

def initializer(name):
    # 返回 None 成功；返回字符串或抛异常 = 失败/中断
    return None

def releaser(name):
    return "connection timeout"  # 模拟一次释放失败

k = ResourceKernel(initializer, releaser, max_retries=3)
k.register("db-slot-1")
k.acquire("db-slot-1", owner="worker-1")
k.release("db-slot-1")                 # -> releasing, retry_count=1
k.retry("db-slot-1")                   # 回调恢复后 -> released，计数 0
k.status("db-slot-1")                  # 完整状态字典
k.list_unreleased()                    # 占用未归零清单（按名字典序）
summary = k.force_cleanup()            # 全部强制清理，逐项隔离
summary["manual_review"]               # 仍需人工处理的资源名列表
```

## 命令行（逐行 JSON）

```bash
python -m resource_kernel             # 可选 --max-retries N / RK_MAX_RETRIES
```

每行一条 JSON 命令，每行一条 JSON 输出；错误统一为
`{"ok": false, "code": "...", "error": "..."}`，单条命令失败不影响后续行。

| op | 说明 |
|---|---|
| `register` | `{"op":"register","name":"r"}` |
| `acquire` | `{"op":"acquire","name":"r","owner":"w1"}` |
| `release` / `retry` / `reset` | 释放 / 重试释放 / 重置为空闲 |
| `force_cleanup` | 全部资源强制清理，返回 succeeded/failed/skipped/manual_review |
| `status` / `list_unreleased` / `list_all` | 查询 |
| `export` / `import` | `{"op":"export","path":"state.json"}` |
| `inspect` | 输出内存完整快照 |
| `config` | 失败注入（演练/验收用），见下 |
| `ping` | 连通性自检 |

失败注入（默认初始化与释放总是成功）：

```json
{"op":"config","init_fail":{"b":1},"release_fail":{"a":2,"c":-1}}
```

值为正整数 n 表示该资源接下来 n 次回调失败（自动递减），`-1` 表示
一直失败。验收"初始化中断""释放超时""连续失败到上限"等场景无需改代码。

一次验收演练：

```bash
printf '%s\n' \
  '{"op":"config","init_fail":{"b":1},"release_fail":{"a":2,"c":-1}}' \
  '{"op":"register","name":"a"}' '{"op":"register","name":"b"}' '{"op":"register","name":"c"}' \
  '{"op":"acquire","name":"a","owner":"w1"}' \
  '{"op":"acquire","name":"b","owner":"w2"}' \
  '{"op":"acquire","name":"c","owner":"w3"}' \
  '{"op":"acquire","name":"b","owner":"w2"}' \
  '{"op":"release","name":"a"}' '{"op":"retry","name":"a"}' \
  '{"op":"release","name":"b"}' '{"op":"release","name":"c"}' \
  '{"op":"list_unreleased"}' \
  '{"op":"export","path":"state.json"}' \
  '{"op":"force_cleanup"}' \
  | python -m resource_kernel --max-retries 3
```

## 持久化校验规则

导入时校验：顶层结构与版本、资源名唯一非空、状态为六种合法值之一、
`occupation_count` 非负、占用态必须有 owner 且计数为 1、非占用态必须
无 owner 且计数为 0、尝试序号自洽。任何一项不通过都报明确错误，
且**先完整构建新状态再整体替换**，失败时内存状态保持不变。
导出采用临时文件 + `os.replace` 原子替换，不会留下半截文件。

## 错误码

`resource_not_found` / `resource_already_exists` / `resource_busy` /
`resource_not_occupied` / `invalid_state` / `invalid_argument` /
`persistence_error` / `bad_json` / `unknown_op` / `internal_error`。
