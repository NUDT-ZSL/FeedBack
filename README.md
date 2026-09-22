# 二进制版本化消息流解码器

这是一个只依赖 Python 标准库的离线模块，用于从持续到达、可在任意字节处切分的二进制流中恢复完整消息。它支持新旧两种载荷结构、未知扩展、默认值补齐、结构校验和坏帧恢复。

## 帧格式

所有整数均为大端序：

| 偏移 | 长度 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | 3 | magic | 固定为 `BM2` |
| 3 | 1 | version | `1` 或 `2` |
| 4 | 1 | flags | 预留标志，当前为 `0` |
| 5 | 2 | payload_length | TLV 载荷长度 |
| 7 | 1 | header_crc8 | CRC-8/CDMA2000，校验偏移 0..6 |
| 8 | payload_length | payload | TLV 字段 |
| 末尾 | 2 | payload_crc16 | CRC-16/CCITT-FALSE，校验载荷 |

TLV 字段为：`tag:uint8 + length:uint16 + value:length`。

## 逻辑消息和版本兼容

统一逻辑结果为：

```text
message_id, sender, event, timestamp_ms,
priority, labels, trace_id, retry_count
```

| tag | 字段 | v1 | v2 |
| --- | --- | --- | --- |
| 1 | message_id:uint32 | 必填 | 必填 |
| 2 | sender:UTF-8 | 必填 | 必填 |
| 3 | legacy_event:uint8，1=created、2=updated、3=deleted | 必填 | 必填镜像 |
| 4 | legacy_timestamp:uint32 毫秒 | 必填 | 必填镜像 |
| 5 | event:UTF-8 事件名 | 未知扩展 | 必填 |
| 6 | timestamp:uint64 毫秒 | 未知扩展 | 必填 |
| 7 | priority:uint8 | 未知扩展 | 可选，默认 0 |
| 8 | labels:非空 UTF-8，逗号分隔 | 未知扩展 | 可选，默认空列表 |
| 9 | trace_id:UTF-8 | 未知扩展 | 可选，默认空字符串 |
| 10 | retry_count:uint16 | 未知扩展 | 可选，默认 0 |
| 11..255 | 未来扩展 | 忽略 | 忽略 |

现代解析路径处理 v1 时，从 tag 3/4 映射出 `event` 和 32 位时间戳，并为 v2 可选项补默认值。旧解析路径处理 v2 时，只保留 tag 1..4，忽略 tag 5 及以上扩展。

v2 的 tag 3 必须与 tag 5 的事件名一致，tag 4 必须等于 tag 6 的低 32 位；不一致会判定为结构标识与内容不符。

## 错误恢复

- 输入不足一个完整帧时保留字节并等待后续 `feed()`，不丢帧、不错位。
- 完整帧载荷不合法（TLV 截断、非法整数长度、非法 UTF-8、必填缺失、重复字段、枚举不一致）时拒绝整帧，然后从声明帧边界后继续。
- 未知结构版本通过可信帧头和长度跳过整帧。
- 载荷 CRC 错误时拒绝整帧，再从声明帧边界后继续。
- 帧头 CRC 或长度本身不可信时，逐字节重新扫描 magic，避免把损坏长度当作跳转距离。
- 诊断包含流绝对偏移 `stream_start/stream_end`、帧起点 `frame_start` 和字段范围 `field_start/field_end`（偏移为半开区间）。

## Python API

```python
from binary_codec import FrameStreamDecoder

decoder = FrameStreamDecoder()
events = []
events.extend(decoder.feed(first_chunk))  # 可按网络收到的任意长度反复调用
events.extend(decoder.feed(second_chunk))
events.extend(decoder.finish())

for event in events:
    if event.kind == "message":
        print(event.decoded.message.to_dict())
        print(event.decoded.compatibility_notes)
    else:
        print(event.diagnostic.code, event.diagnostic.field_start)
```

旧应用兼容性可显式验证：

```python
FrameStreamDecoder(parser_path="legacy")
```

## 离线命令行

内置混合流包含 v1、v2、最小 v2、带未来扩展的 v2、未知版本、截断 TLV、重复字段和后续恢复：

```powershell
python -m binary_codec --chunk-size 1
python -m binary_codec --json
python -m binary_codec --legacy-parser
```

解码外部原始流：

```powershell
python -m binary_codec path\to\stream.bin --chunk-size 13
Get-Content -Raw -AsByteStream path\to\stream.bin | python -m binary_codec --stdin --json
```

运行测试：

```powershell
python -m unittest discover -s tests -v
```

## 模块说明

- `stream.py`：增量缓冲、消息边界、再同步、CRC 和错误恢复。
- `parser.py`：v1/v2 TLV 语义解析和统一逻辑结果映射。
- `protocol.py`：协议常量、CRC、TLV 和测试/集成编码器。
- `models.py`：消息、兼容说明、诊断和事件数据模型。
- `demo.py`：确定性混合版本验收样本。
