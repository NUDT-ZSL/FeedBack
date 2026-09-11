# FeedDecoder — 增量二进制帧解码器

一个基于显式状态机的流式帧解码器。核心保证:

> **同一段字节流,一次性 `feed` 与切成任意大小分片逐片 `feed`,得到的帧序列、每帧校验结果、统计计数与解码器最终状态完全一致。**

(唯一例外:待定缓冲超过 `max_buffer` 触发溢出策略时,行为与分片边界有关,见下文「待定缓冲溢出策略」。)

## 文件结构

| 文件 | 说明 |
|---|---|
| `feed_decoder.py` | 解码器模块:帧格式、状态机、编码对偶、统计、快照 |
| `main.py` | 命令行入口:stdin/stdout 逐行 JSON 命令 |
| `test_feed_decoder.py` | unittest 测试套件(65 个用例) |

运行测试:`python -m unittest test_feed_decoder -v`

## 帧格式

```
+---------+---------+------+----------+----------+---------+
| MAGIC   | VERSION | TYPE | LENGTH   | PAYLOAD  | CRC32   |
| 2 字节  | 1 字节  | 1 B  | 变长整数 | LENGTH   | 4 B LE  |
+---------+---------+------+----------+----------+---------+
```

- **MAGIC**:`FE ED`(2 字节),用于帧对齐与错位重同步。
- **VERSION**:协议版本,当前为 `1`;其他版本判为非法帧。
- **TYPE**:帧类型,0–255,由上层定义语义。
- **LENGTH**:载荷字节数,无符号变长整数(LEB128):每字节低 7 位是数据、最高位为 1 表示还有后续字节,小组在前(小端序)。**超过 5 字节仍未终止即判非法**。
- **PAYLOAD**:`LENGTH` 字节载荷,可为空(`LENGTH = 0`)。
- **CRC32**:对 `VERSION | TYPE | LENGTH | PAYLOAD` 计算 CRC-32(zlib 多项式),小端序 4 字节。

总帧长不固定:`2 + 1 + 1 + len(varint) + LENGTH + 4`。

## 状态机

```
            找到魔数        版本合法       读长度         收齐载荷      收齐CRC     校验
WAIT_MAGIC ──────► READ_VERSION ──► READ_TYPE ──► READ_LENGTH ──► READ_PAYLOAD ──► READ_CRC ──► COMPLETE
    ▲                  │                                  │                                  │
    │                  │ 版本非法                          │ 长度非法(超限/varint超5字节)     │ CRC不匹配
    └──────────────────┴──────────────────────────────────┴──────────────────────────────────┘
                        记录错误帧,回退到 WAIT_MAGIC 逐字节滑动寻找下一个魔数
```

- `COMPLETE` 是瞬时状态:帧拼装完成后立即校验、产出帧记录并回到 `WAIT_MAGIC`,两次 `feed` 之间永远观察不到它。
- 半帧状态(已消费的版本/类型/变长长度字节/部分载荷/部分 CRC)全部保存在解码器内,跨任意多次 `feed` 保留;chunk 边界落在任何位置(包括变长长度编码中间、CRC 中间、魔数中间)都不影响结果。

## 错误分类与恢复策略

| 错误 | `error` 字段 | 恢复方式 |
|---|---|---|
| CRC 不匹配 | `crc_mismatch` | 产出带错误标记的帧记录(含载荷与期望/实际 CRC),把该帧已消费字节(魔数之后)推回缓冲,重新逐字节扫描下一个魔数——因此坏帧载荷内嵌的合法帧也能被救回 |
| 魔数错位 | (不产生帧记录) | `WAIT_MAGIC` 状态下逐字节滑动,丢弃魔数之前的垃圾字节,`magic_misalignments` 计数 +1(每段连续垃圾计一次,与分片方式无关) |
| 长度超过 `max_payload` | `payload_too_large` | 在长度字段解码完成的**当场**判非法,不分配载荷缓冲、不等待载荷字节;记录错误后重同步 |
| 变长长度超 5 字节未终止 | `invalid_length_varint` | 同上 |
| 版本号不支持 | `unsupported_version` | 同上 |
| 待定缓冲超过 `max_buffer` | `buffer_overflow` | 见下节 |

所有错误恢复后都能继续解析后续合法帧(测试覆盖:连续多个非法帧、坏帧内嵌合法帧、垃圾夹带半个魔数等)。

## 待定缓冲溢出策略(max_buffer)

「待定缓冲」= 尚未被状态机消费的字节 + 当前半帧已消费的字节。

**策略:当待定缓冲超过 `max_buffer` 时,解码器产出一条 `buffer_overflow` 错误记录(提示流中可能缺少魔数或长度字段异常),丢弃全部待定字节,状态机复位到 `WAIT_MAGIC`,`buffer_overflows` 计数 +1,之后继续正常解码。**

设计说明与注意事项:

- 检查发生在每次 `feed` 解析完成之后,因此一次 `feed` 内能完整解析的帧不受限制(例如 `max_buffer=0` 时,一整帧一次性喂入仍可正常解码,因为解析后待定字节为 0)。
- **分片等价性前提**:只要待定缓冲从未超过 `max_buffer`,一次性喂入与任意分片喂入结果完全一致。一旦触发溢出,触发点取决于分片边界(这是任何缓冲上限语义的固有性质),验收等价性测试应使用足够大的 `max_buffer`。
- `max_buffer=0` 是合法配置:任何无法立即决定的字节都会立即触发溢出。

## API

```python
from feed_decoder import FeedDecoder, encode_frame, encode_stream

dec = FeedDecoder(max_payload=1 << 20, max_buffer=4 << 20)

frames = dec.feed(chunk)        # -> List[Frame];chunk 可为空、可为 1 字节
result = dec.finish()           # -> FinishResult(frames, incomplete, pending_bytes, state)
                                #    finish 之后再 feed 会抛 RuntimeError

stats = dec.stats()             # frames_parsed / crc_errors / invalid_frames /
                                # magic_misalignments / buffer_overflows /
                                # pending_bytes / max_payload_seen /
                                # avg_frame_length / state

dec.save("snap.json")           # JSON 快照:配置 + 计数器 + 半帧状态 + 待定缓冲(hex)
dec2 = FeedDecoder.load("snap.json")  # 重建;之后继续 feed 与未快照时结果一致
dec.dump()                      # 内存中的同构快照字典

wire = encode_frame(frame_type=1, payload=b"hello")   # 编码单帧
stream = encode_stream([(1, b"a"), (2, b"")])          # 批量编码
```

`Frame` 字段:`ok`、`frame_type`、`payload`、`error`、`detail`、`crc_expected`、`crc_actual`、`raw_length`(线上字节数)。`frame.to_dict()` 转为 JSON 友好形式(payload 为 hex)。

## 快照格式与校验

`save(path)` 写入的 JSON 包含:`format`/`format_version`、配置(`max_payload`、`max_buffer`)、全部统计计数、状态机状态、半帧各字段(版本、类型、长度值、变长长度字节、部分载荷、部分 CRC 的 hex)、待定缓冲 hex、`finished` 标记。

`load(path)` 严格校验,任何问题都抛出带明确信息的 `SnapshotError`,不静默吞错:

- 文件不是合法 JSON / 顶层不是对象 / `format` 不匹配;
- 必填字段缺失(报错信息指出具体字段名);
- 配置或计数为负数、非整数;
- hex 字段非法(非 hex 字符或奇数长度);
- 状态名不存在,或为瞬时状态 `COMPLETE`;
- 半帧状态内部不一致(如 `READ_PAYLOAD` 状态下载荷长度不小于声明长度、长度值与变长字节不吻合、声明长度超过 `max_payload` 等)。

文件不存在时抛出 `OSError`(含 `FileNotFoundError`)。

## 命令行接口(main.py)

从标准输入逐行读 JSON 命令,每条命令输出一行 JSON 结果;错误统一为 `{"ok": false, "error": "..."}`。

```bash
python main.py [--max-payload N] [--max-buffer M]
```

| 命令 | 说明 |
|---|---|
| `{"cmd":"feed","chunk":"<hex>"}` | 喂入字节,返回本次确定的帧列表 |
| `{"cmd":"finish"}` | 输入结束,返回剩余帧与 `incomplete` 标记 |
| `{"cmd":"encode","frame_type":1,"payload":"<hex>"}` | 编码单帧,返回 `chunk`(hex) |
| `{"cmd":"encode","frames":[{"frame_type":1,"payload":"<hex>"},...]}` | 批量编码整条流 |
| `{"cmd":"stats"}` | 统计信息 |
| `{"cmd":"save","path":"..."}` | 保存快照 |
| `{"cmd":"load","path":"..."}` | 加载快照(替换当前解码器) |
| `{"cmd":"dump"}` | 输出完整内部状态(与快照同构) |
| `{"cmd":"config","max_payload":N,"max_buffer":M}` | 按新限制重建解码器(状态重置) |

示例:

```
$ printf '%s\n' '{"cmd":"encode","frame_type":1,"payload":"6869"}' '{"cmd":"feed","chunk":"feed0101026869f55530d9"}' '{"cmd":"finish"}' | python main.py
{"ok": true, "chunk": "feed0101026869f55530d9"}
{"ok": true, "frames": [{"ok": true, "frame_type": 1, "payload": "6869", ...}]}
{"ok": true, "frames": [], "incomplete": false, "pending_bytes": 0, "state": "WAIT_MAGIC"}
```

## 边界情况

空输入、单字节输入、只有魔数没有后续、`LENGTH=0`、空载荷、变长长度跨 chunk、CRC 跨 chunk、魔数跨 chunk、连续多个非法帧、`max_payload=0`、`max_buffer=0`、save 后 load 状态一致、损坏快照文件明确报错——均有对应测试用例(见 `test_feed_decoder.py`)。
