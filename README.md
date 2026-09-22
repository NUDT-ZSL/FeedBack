# msgstream — 版本化二进制消息流解码器

面向持续接收上游字节流的服务端场景：上游发送方版本不一，同一逻辑消息可能以
旧结构（v1）或新结构（v2）编码。本模块把任意切分的连续字节流稳定解码为统一
的逻辑消息，并对异常帧给出可定位到字节位置的诊断。

## 线协议

帧布局（整数均为大端）：

```
+0  u8    magic 0xA5
+1  u8    magic 0x5A
+2  u8    结构版本（0x01 = v1 旧结构，0x02 = v2 新结构）
+3  u32   负载长度（字节）
+7  ...   负载：TLV 字段序列
```

TLV 字段：`字段id u8 | 类型 u8 (1=u32, 2=utf-8 字符串, 3=bool, 4=原始字节) | 长度 u16 | 值`。

| 字段 id | 含义      | v1 | v2           |
|---------|-----------|----|--------------|
| 1       | msg_id    | 必填 | 必填       |
| 2       | sender    | 必填 | 必填       |
| 3       | body      | 必填 | 必填       |
| 4       | priority  | —  | 可选，默认 0 |
| 5       | sent_at   | —  | 可选，默认 0 |
| >=0x80  | 扩展字段  | 忽略 | 忽略       |

## 行为约定

- `StreamDecoder.feed(bytes)` 接受任意切分的输入，内部缓冲不完整的帧，不丢帧、
  不错位；`finish()` 在流结束时冲刷并报告截断的尾部。
- 每帧产出一个事件：`DecodedMessage`（含统一逻辑结果 `Message` 与兼容处理说明
  `notes`）或 `Diagnostic`（含绝对字节偏移 `offset`、错误码 `code`、详情 `detail`）。
- 版本字节选择解析路径；v1/v2 解码后得到同一结构的 `Message`。
- v1 路径遇到 v2 专有字段或未知扩展字段：忽略并记录说明；v1 帧携带 v2 字段时
  额外给出 `STRUCTURE_MISMATCH` 诊断。v2 路径对缺失的可选字段按约定默认值补齐。
- 未知版本（`UNKNOWN_VERSION`）、非法长度（`BAD_LENGTH`）、截断字段
  （`TRUNCATED_FIELD`）、重复字段（`DUPLICATE_FIELD`）、缺必填字段
  （`MISSING_FIELD`）、类型不符（`TYPE_MISMATCH`）都会使该帧被判为不可用；
  解码器按 magic 重新同步（`RESYNC`），流位置保持正确，后续消息照常解码。

## 离线运行

```
python -m msgstream            # 演示：混合新旧结构与各类损坏帧，随机切分喂入
python -m msgstream --seed 7   # 可复现的切分方式
python -m unittest discover -s tests -v   # 验收测试（15 例）
```

## 代码结构

- `msgstream/protocol.py` — 线协议常量与编码辅助（测试/演示用它构造字节流）
- `msgstream/decoder.py` — `StreamDecoder` 增量解码核心与事件类型
- `msgstream/__main__.py` — 离线演示入口
- `tests/test_decoder.py` — 离线验收测试
