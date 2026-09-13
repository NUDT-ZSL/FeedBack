# Tamper-Evident Audit Log Kernel

一个纯 Python 标准库实现的防篡改审计日志内核：哈希链追加、Merkle 完整性证明、区间锚点、签名历史链、JSON 快照持久化。离线运行，无第三方依赖，可直接单测。

文件：

| 文件 | 说明 |
|---|---|
| `audit_log.py` | 核心库（`AuditLog` 类 + 哈希原语） |
| `main.py` | 命令行入口：stdin 逐行 JSON 命令，stdout 逐行 JSON 结果 |
| `test_audit_log.py` | unittest 测试套件（78 个用例） |

运行测试：`python -m unittest test_audit_log -v`
运行 CLI：`python main.py < commands.jsonl`

---

## 1. 记录模型

每条记录是一个 JSON 对象：

```json
{
  "seq": 0,
  "record_id": "r-0001",
  "ts": 1726000000,
  "payload": { "任意": "可 JSON 序列化的对象" },
  "prev_hash": "<64 位小写 hex>",
  "record_hash": "<64 位小写 hex>"
}
```

- `seq`：从 0 开始连续递增的整数。`append` 只接受 `seq == 当前记录数`（也可省略，自动赋值）。
- `record_id`：非空字符串，全局唯一，重复拒绝。
- `ts`：整数逻辑时间，**允许乱序**，不参与顺序约束。
- `payload`：任意可 JSON 序列化对象（NaN/Infinity 被拒绝，见下文）。
- `prev_hash`：前一条记录的 `record_hash`；首条为创世哈希（见 §2）。`append` 时自动填写，调用方传入的值会被忽略。
- `record_hash`：本条记录哈希，`append` 时自动计算。

## 2. 确定性序列化与哈希规则（跨机器一致）

**规范 JSON 序列化**（`canonical_bytes`）：

```
json.dumps(obj, sort_keys=True, separators=(",", ":"),
           ensure_ascii=False, allow_nan=False).encode("utf-8")
```

即：UTF-8 编码、对象键按字典序排列、无空白分隔符、非 ASCII 字符原样输出（不转义）、拒绝 NaN/Infinity。同一对象在任何机器、任何 Python 版本上得到同一字节串。

**记录哈希**：

```
record_hash = SHA256_HEX(canonical({
    "seq": seq, "record_id": record_id, "ts": ts,
    "payload": payload, "prev_hash": prev_hash
}))
```

注意 `record_hash` 本身不参与自身计算。

**创世哈希**（首条记录的 `prev_hash`）：

```
GENESIS_HASH = SHA256_HEX(b"AUDIT-LOG-GENESIS-V1")
```

**Merkle 内部节点**（带域分离前缀，左右均为 32 字节原始哈希值）：

```
node = SHA256_HEX(b"AUDIT-LOG-MERKLE-V1" || bytes.fromhex(left) || bytes.fromhex(right))
```

奇数层**复制最后一个节点**补齐（Bitcoin 式），叶子为各记录的 `record_hash`。`count` 个叶子的证明路径长度恒为 `ceil(log2(count))`（`count == 1` 时为 0）。

**签名历史条目哈希**：

```
sig_hash = SHA256_HEX(canonical({
    "signer_id": ..., "anchor_hash": ...,
    "signature": "<签名 hex>", "prev_sig_hash": ...
}))
```

首条签名的 `prev_sig_hash = SHA256_HEX(b"AUDIT-LOG-SIG-GENESIS-V1")`。

## 3. API 概览

### 追加与链校验

- `append(record) -> record`：校验 seq 连续、record_id 唯一、payload 可序列化，自动填 `prev_hash`/`record_hash`。违规抛 `AuditLogError`。
- `verify_chain(start=0, end=None) -> {"ok", "seq", "reason", "checked"}`：从创世哈希（或 `start-1` 的哈希）逐条重算并比对 `prev_hash` 与 `record_hash`，返回第一个不一致的 seq 与原因。篡改 payload / ts / prev_hash / record_hash 均可检出。

### 完整性证明

- `prove(seq, anchor=None) -> proof`：生成 Merkle 包含证明。不给锚点时证明到全链 Merkle 根；给锚点（含 `start`/`end`）时证明到锚点根，路径更短（`ceil(log2(count))` 步）。
- `AuditLog.verify_proof(record, proof, anchor_hash) -> {"ok", "reason"}`：静态方法，**只需记录内容 + 证明 + 锚点哈希**，不需要整条日志。会检查：记录内容与 `record_hash` 一致、证明与记录匹配、index/seq/范围一致、路径长度等于 `ceil(log2(count))`、每步哈希为 64 位 hex、`side ∈ {left, right}`、最终折叠根等于 `anchor_hash`。截断、换序、改方向、伪造记录都会返回 `False` 并给出原因。

proof 结构：

```json
{
  "seq": 7, "record_hash": "...", "start": 4, "end": 12,
  "index": 3, "count": 8, "root": "<锚点或链尾根>",
  "path": [{"hash": "<兄弟节点 hex>", "side": "left|right"}, ...]
}
```

### 区间锚点

- `anchor(start, end) -> {"start","end","count","anchor_hash"}`：对 `[start, end)` 的 `record_hash` 做 Merkle 合并。`start >= end`、越界抛 `AuditLogError`。
- `verify_anchor(anchor_obj) -> {"ok","reason"}`：从记录**内容**重算哈希再合并比对，篡改记录内容也能检出。
- 轻量校验：只持有 `anchor_hash` 即可用 `prove(seq, anchor)` + `verify_proof` 判断某条记录是否在区间内。

### 签名链

- `register_signer(signer_id, signer, spec=None)`：注册签名器，纯函数 `bytes -> bytes`。可选 `spec` 是可 JSON 序列化的重建描述（如 `{"type": "hmac-sha256", "key": "..."}`），会写入快照供 load 恢复；签名器同时记入进程级注册表（按 signer_id）。
- `sign_anchor(anchor_obj) -> sig_obj`：对锚点哈希签名并追加到签名历史；未注册签名器或锚点无效抛错。
- `verify_signature(anchor_obj, sig_obj) -> {"ok","reason"}`：依次检查签名器可用、signer_id 匹配、锚点哈希匹配、签名 hex 合法、签名长度与签名器输出一致、签名字节一致、`sig_hash` 自洽。失败原因明确区分三类：**签名器缺失**（`signer unavailable` / `no signer registered`）、**签名器标识不匹配**（`signer_id mismatch`）、**签名内容被改**（`signature mismatch`）。
- `verify_signatures() -> {"ok","index","reason","checked"}`：校验整条签名历史——每条引用存在的锚点、`prev_sig_hash` 链连续、`sig_hash` 正确、（若签名器可用）签名字节正确。篡改历史可检出。
- **load 后签名器自动恢复**：快照中的 `signer_spec` 可跨进程重建签名器；否则回退到进程级注册表（同进程先注册过即可）。恢复结果看 `get_state()["signer_registered"]`；无法恢复时 load 仍成功，但 `verify_signature` 返回 `signer unavailable` 而非笼统的 False。

### 查询与状态

- `get_record(seq)` / `get_record_by_id(record_id)`：返回记录副本，不存在返回 `None`。
- `range_records(start, end)`：`[start, end)` 内记录按 seq 升序。**非法区间直接报错**（`start < 0`、`start > end` 抛 `AuditLogError`，与 `prove` 越界行为一致）；`end` 超过最大 seq 合法但截断，返回字典带实际生效区间：`{"records", "start", "end"(生效), "requested_end", "truncated", "count"}`，调用方可区分"合法但为空"与"参数非法"。
- `get_state()`：`record_count`、`latest_seq`、`latest_record_hash`、`anchor_count`、`signature_count`、`chain_valid`、`signer_id`、`signer_registered`（签名器是否已恢复/可用）。
- `get_log()`：追加/锚点/签名/注册/load 操作的时间顺序日志（带单调 `op_index`）。

### 持久化

- `save(path)`：把记录链、锚点、签名历史、签名器标识与可恢复的 `signer_spec`、操作日志写成单个 JSON 文件。
- `AuditLog.load(path)`：重建并**严格校验**——seq 从 0 连续、record_id 唯一、`record_hash` 与内容匹配、`prev_hash` 链接正确、锚点区间合法且哈希匹配、签名引用的锚点存在、签名历史链完整。任何不一致都抛 `AuditLogError` 并说明位置与原因，不会静默吞错或返回断裂的链。加载后按 `signer_spec`（跨进程）或进程级注册表（同进程）自动恢复签名器；恢复结果见 `get_state()["signer_registered"]`。注意：`signer_spec` 含 HMAC 密钥材料，仅适用于离线验收场景，不要把快照当作保密边界。

## 4. 命令行接口（main.py）

从标准输入逐行读 JSON 命令，每条输出一行 JSON 结果；错误统一为 `{"ok": false, "error": "..."}`。

| 命令 | 参数 | 说明 |
|---|---|---|
| `append` | `record_id, ts, payload[, seq]` | 追加记录 |
| `verify` | `[start][, end]` | 链校验 |
| `prove` | `seq[, anchor \| anchor_index]` | 生成证明 |
| `verify_proof` | `record, proof, anchor_hash` | 校验证明 |
| `anchor` | `start, end` | 创建锚点 |
| `verify_anchor` | `anchor` 或 `anchor_index` | 校验锚点 |
| `register_signer` | `signer_id[, key]` | 注册内置 HMAC-SHA256 签名器（key 默认为 signer_id），key 作为 `signer_spec` 写入快照，load 后自动恢复 |
| `sign` | `anchor` 或 `anchor_index` | 签名锚点 |
| `verify_sig` | `anchor, signature` | 校验签名 |
| `verify_sigs` | — | 校验整条签名历史 |
| `get` | `seq` 或 `record_id` | 查询记录 |
| `range` | `start, end` | 区间查询；`start<0` 或 `start>end` 报错，`end` 越界截断并返回 `end`/`requested_end`/`truncated` |
| `state` | — | 状态摘要 |
| `log` | — | 操作日志 |
| `save` / `load` | `path` | 快照存取 |
| `dump` | — | 输出完整快照 |

示例：

```bash
$ printf '%s\n' \
  '{"op":"append","record_id":"r0","ts":1,"payload":{"a":1}}' \
  '{"op":"append","record_id":"r1","ts":2,"payload":{"a":2}}' \
  '{"op":"anchor","start":0,"end":2}' \
  '{"op":"register_signer","signer_id":"s","key":"k"}' \
  '{"op":"sign","anchor_index":0}' \
  '{"op":"state"}' | python main.py
```

## 5. 已覆盖的边界情况

空日志、单条记录、seq 跳号、重复 record_id、空 record_id、非法 ts、NaN/不可序列化 payload、payload/ts/prev_hash/record_hash 篡改、证明路径截断/换序/翻转方向/长度错误、伪造记录（重算 record_hash 仍被 Merkle 根拒绝）、锚点区间越界与 `start >= end`、签名器未注册、签名长度/字节不符、签名历史篡改、save→load 往返后链校验与证明仍通过、坏 JSON/缺字段/断链文件给出明确错误。
