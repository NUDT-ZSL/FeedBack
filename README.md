# 分块上传协调器（Chunked Upload Coordinator）

把大文件切成固定大小的块、并发上传到对象存储风格的多分片上传接口，支持
**断点续传、分片校验、失败重试**。仅依赖 Python 3.10+ 标准库，不接真实
对象存储，存储端通过一个可替换的后端接口模拟，可以完全离线运行和单测。

## 目录结构

```
.
├── chunked_upload/
│   ├── __init__.py        # 公共 API 导出
│   ├── backend.py         # StorageBackend 抽象基类 + InMemoryBackend（含故障注入）
│   ├── coordinator.py     # UploadCoordinator：切块、调度、校验、重试、续传
│   └── progress.py        # 进度记录 JSON 持久化（原子写、字段校验）
├── main.py                # 标准输入 JSON 命令行入口
├── examples/
│   └── demo_acceptance.py # 离线端到端演示（故障→中断→续传→坏文件/坏进度）
└── tests/                 # unittest 测试（99 个用例）
    ├── test_layout.py
    ├── test_backend.py
    ├── test_coordinator.py
    ├── test_regressions.py
    └── test_main_cli.py
```

运行测试和演示：

```bash
python -m unittest discover -s tests -v
python examples/demo_acceptance.py
```

## 快速上手（Python API）

```python
from chunked_upload import InMemoryBackend, UploadConfig, UploadCoordinator

backend = InMemoryBackend()                       # 换成真实后端即可接入 S3 等
config = UploadConfig(
    part_size=5 * 1024 * 1024,   # 默认 5 MiB
    concurrency=4,               # 默认 4 个工作线程
    max_retries=3,               # 单块首传失败后最多再试 3 次（共 4 次）
    backoff_base=1.0,            # 退避 1s, 2s, 4s ...（可注入 sleep）
    progress_path="progress.json",
)

coordinator = UploadCoordinator.begin(backend, "big.bin", "objects/big.bin", config)
final_etag = coordinator.upload()
print(coordinator.get_status())
```

进程中断（或部分块重试耗尽）后，在**新进程**里用同一个后端和进度文件续传：

```python
coordinator = UploadCoordinator.resume(backend, "big.bin", "objects/big.bin", config)
final_etag = coordinator.upload()   # 只传未完成的块
```

> 真实部署时 `backend` 换成实现了 `StorageBackend` 四个方法的 S3/OSS/COS
> 客户端即可，协调器和进度格式都不需要改。

## 存储后端抽象

`chunked_upload.backend.StorageBackend` 定义 4 个方法：

| 方法 | 说明 |
|---|---|
| `create_multipart(object_name, total_size) -> upload_id` | 开启多分片上传 |
| `upload_part(upload_id, part_number, data) -> etag` | 上传一个分片，返回服务端 etag |
| `complete_multipart(upload_id, parts) -> final_etag` | 按 `[(part_number, etag), ...]` 组装对象 |
| `abort_multipart(upload_id) -> None` | 中止并丢弃已上传分片 |
| `multipart_exists(upload_id) -> bool` | *可选*：探测多分片会话是否仍然有效（默认乐观返回 `True`） |

`multipart_exists` 用于续传时发现服务端会话已过期；即使后端不实现它
（沿用乐观默认值），协调器也会在 `upload_part` / `complete_multipart`
抛出 `UploadNotFoundError` 时**反应式重建**会话。

`InMemoryBackend` 是离线参考实现：分片 etag = 该块字节的 SHA-256 十六进制，
最终对象 etag = 各分片按编号拼接后整体 SHA-256。它内置故障注入（均为
**一次性**队列，按块号排队、按序消费）：

```python
backend.queue_exception(3, ConnectionError("network down"))  # 下次传第 3 块抛异常
backend.queue_wrong_etag(2)            # 存了但返回假 etag（触发客户端校验失败）
backend.queue_wrong_etag(2, "0"*64)    # 也可指定假 etag
backend.queue_lost_part(5)             # 表面成功，实际丢块（complete 时暴露）
```

重复上传策略可通过 `duplicate_policy="overwrite" | "ignore" |
"reject_same" | "reject"` 配置，用于模拟重复上传/etag 冲突。

## 分块规则

- 块大小可配置，默认 5 MiB，必须为正整数（`<= 0` 抛 `InvalidConfigError`）。
- 除最后一块外每块等长，最后一块可以更短；**文件大小恰好是块大小整数倍时
  没有短尾块**；空文件（0 字节）对应 0 个块，直接走 complete 空列表。
- 块编号从 **1** 开始连续。开始前可从协调器读取：
  `total_parts`、`part_sizes`、`file_size`。
- 纯函数 `compute_part_sizes(total_size, part_size)` 可单独使用和测试。

## 并发调度

- `ThreadPoolExecutor`，并发度可配置（`< 1` 报配置错误）。
- 每个剩余分片**只提交一次**；该分片的所有重试都发生在同一个工作线程内，
  从调度上保证同一块不会有两个并发上传任务（另有每块锁兜底）。
- 每块成功后立即落盘进度，失败记录也落盘。

## 进度记录与断点续传

进度记录是单个 JSON 文件，文档结构为 `{对象名: 快照}`，可同时容纳多个上传。
写入采用临时文件 + `os.replace` **原子替换**。快照字段：

```json
{
  "version": 1,
  "upload_id": "upload-00000001",
  "object_name": "objects/big.bin",
  "file_path": "/data/big.bin",
  "file_size": 20972753,
  "file_sha256": "…64 位十六进制…",
  "part_size": 5242880,
  "total_parts": 4,
  "part_sizes": [5242880, 5242880, 5242880, 5242813],
  "completed": {"1": "<etag>", "2": "<etag>"},
  "failed_parts": [],
  "final_etag": null
}
```

- `resume(file, object)` 读取快照、重新流式计算文件 SHA-256 并与
  `file_sha256` 比对；**大小或内容不一致直接抛 `FingerprintMismatchError`
  拒绝续传**，避免把别的文件的块拼进对象。
- 续传后跳过 `completed` 中的块，只上传缺失块；分块布局始终以快照为准。
- **服务端会话失效自动重建**：进度文件只证明客户端上次看到的状态，后端的
  multipart 会话可能已过期或被外部中止。`resume` 会用
  `multipart_exists(upload_id)` 探测；上传/组装过程中若后端抛
  `UploadNotFoundError` 也会反应式处理。发现会话已失效时，协调器
  **重新 `create_multipart` 拿新 upload_id 并写回进度**，保留已完成块的
  etag 映射；旧会话上的块在 `complete` 时按缺失块重传到新会话（块哈希
  保证内容一致），最终 etag 与一次性上传完全相同。多线程同时发现会话失效
  时由会话锁串行化，只创建一个新会话。
- 快照加载时做强校验（缺字段、版本不符、块大小求和不等于文件大小、etag
  长度非法、块号越界等都抛带具体字段的 `ProgressCorruptError`）。
- 重试耗尽导致整次上传失败时，**已完成块保留在进度文件里**，修复后端后
  再 `resume` 即可。
- 同一对象名重复 `start`：未完成提示改用 `resume`，已完成提示换名字
  （`UploadExistsError`）。

## 分片校验与重试

- 约定 etag 规则：**块内容 SHA-256 十六进制**（客户端与 `InMemoryBackend`
  一致；接入真实存储时可在后端实现里适配 S3 的 MD5 etag 规则并在协调器
  子类中替换 `part_etag`）。
- 每块上传后比较后端 etag 与本地哈希；不一致按该块失败处理并重试。
- 每个剩余分片只提交给线程池一次，该块的全部重试都在**同一个工作线程**内、
  持有该块的锁完成；下一次重试必须等上一次 `upload_part` 完全返回（或抛错）
  并结束退避后才开始，任意时刻同一块最多只有一个在途上传。调度器不会在旧
  任务未结束时把块重新放回待传集合。
- 单块最多 `max_retries + 1` 次尝试（默认 4 次），重试间隔指数退避
  `backoff_base * 2**attempt`。`UploadConfig(sleep=...)` 可注入假 sleep，
  测试里不真正等待。
- 后端把块"收到又弄丢"时，`complete_multipart` 会报告缺失块号
  （`PartsMissingError.part_numbers`），协调器会重传这些块后再次 complete。
- 有块最终失败时抛 `UploadFailedError`（含 `failed_parts` 和每块原因），
  进度保留；全部成功才调用 complete 并写入 `final_etag`。
- `cancel()` 尽力调用 `abort_multipart`（会话已过期也不报错）、删除进度
  记录，可协作式中断正在跑的 `upload()`；显式传入的 `upload_id` 与当前
  不符时抛 `UploadNotFoundError`。
- `upload()` 不可重入：同一协调器上并发调用第二次会抛 `UploadStateError`。

## 状态查询

```python
coordinator.get_status()
# {
#   "upload_id": ..., "object_name": ...,
#   "completed_parts": 3, "total_parts": 7,
#   "failed_parts": [6],
#   "uploaded_bytes": 15728640,
#   "file_size": 20972753,
#   "done": False, "final_etag": None,
# }

coordinator.get_progress()   # 返回进度快照的深拷贝
```

## 命令行入口

`main.py` 从标准输入逐行读取 JSON 命令，每行输出一条 JSON 结果
（成功含 `"ok": true`，失败含 `"ok": false` 和 `"error"` 字段）：

```bash
python main.py --progress progress.json <<'EOF'
{"op":"start",  "file":"big.bin", "object":"objects/big.bin", "part_size":5242880}
{"op":"status", "object":"objects/big.bin"}
{"op":"resume", "file":"big.bin", "object":"objects/big.bin"}
{"op":"dump",   "object":"objects/big.bin"}
{"op":"list"}
{"op":"cancel", "object":"objects/big.bin"}
EOF
```

| op | 必填字段 | 说明 |
|---|---|---|
| `start` | `file`, `object` | 指纹、建上传、跑完全部块 |
| `resume` | `file`, `object` | 校验指纹后续传 |
| `status` | `object` | 计数/失败块/已传字节/是否完成 |
| `dump` | `object` | 完整进度快照 |
| `cancel` | `object`（可带 `upload_id` 校验） | abort + 清理进度 |
| `list` | — | 列出进度文件中的对象名 |

可选参数：`part_size`、`concurrency`、`max_retries`、`backoff_base`、
`progress_path`。单块重试耗尽不会让进程报错退出，而是输出
`"final_etag": null` 和失败状态，便于后续 `resume`。注意 CLI 中的
`InMemoryBackend` 生命周期等于进程，跨进程故障注入请直接使用 Python API
（见 `examples/demo_acceptance.py`）。

## 边界情况处理一览

| 情况 | 行为 |
|---|---|
| 空文件 | 0 个块，complete 空列表，etag = SHA-256(空) |
| 文件大小恰为块大小整数倍 | 无短尾块 |
| `part_size <= 0`、非整数、布尔值 | `InvalidConfigError` |
| `concurrency < 1`、`max_retries < 0` | `InvalidConfigError` |
| 上传中途后端抛异常 | 按块重试，退避后再次尝试 |
| 后端返回错误 etag | 本地校验失败，按块重试 |
| 后端丢块 | complete 报缺失块号，自动重传后重试 complete |
| 重试耗尽 | `UploadFailedError`，进度保留可续传 |
| 进度文件 JSON 损坏 | `ProgressCorruptError`（带行列号） |
| 快照字段缺失/不一致 | `ProgressCorruptError`（带字段名） |
| resume 时文件被改（同长改内容/变长度） | `FingerprintMismatchError`，拒绝续传 |
| resume 时后端 multipart 会话已过期 | 自动新建 upload_id，保留 etag 映射，重传缺失块 |
| 重复 start 同一对象名 | `UploadExistsError`，提示 resume 或换名 |
| 同一协调器并发调用 upload() | `UploadStateError` |
| cancel 不存在的 upload_id（显式校验时） | `UploadNotFoundError`；会话已自然过期则幂等清理 |
| cancel 已完成的上传 | `UploadStateError` |

## 测试

99 个 `unittest` 用例，零第三方依赖（退避均通过注入的假 `sleep` 验证，
不会真正等待）：

- `test_layout.py`：分块计算（空文件/整数倍/短尾/非法参数）、配置校验、
  快照校验、进度文件损坏与往返。
- `test_backend.py`：etag 规则、complete 校验（缺块/编号空洞/etag 不符）、
  四类故障注入、四种重复上传策略、`multipart_exists` 状态判定。
- `test_coordinator.py`：并发调度（用 Barrier 强制 4 块同时在飞 + 重叠即
  断言失败）、同块单次调度、重试次数与指数退避数值、错误 etag 重试、
  丢块恢复、失败后进度保留、重启后只传剩余块且结果与一次性上传一致、
  指纹不一致/大小变化拒绝续传、坏进度文件、重复 start、cancel（含上传
  途中协作取消）、20 MiB 大文件验收场景。
- `test_regressions.py`：**失败后 resume 发现会话过期自动换新 upload_id
  并与一次性上传 etag 一致**、探测乐观但调用报 404 时的反应式重建、
  **同一块的多次重试严格串行（门控 + 进入/退出次序断言）**、
  **进度文件截断后 load 报出文件名与行列号、原子写不留临时文件**、
  **空文件 start/complete/resume**。
- `test_main_cli.py`：全部 CLI 操作、JSON 错误行、坏参数、缺文件、空文件。
