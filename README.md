# 运维日志链可信性核查工具

纯 Python 标准库实现,完全离线运行,无需安装任何依赖(Python 3.6+)。

## 数据格式

日志文件为 JSONL,每行一条按顺序追加的记录:

```json
{"seq": 5, "timestamp": "2026-09-20T13:15:00", "source": "db-01",
 "body": "配置项 max_conn 修改为 512 (#5)", "prev_seq": 4,
 "checksum": "<基于前序记录校验值与本记录内容计算的十六进制摘要>"}
```

`prev_seq` 指向前一条记录的顺序号(首条为 `null`);`checksum` 由
校验依据(算法、参与字段、分隔符)对 `prev_checksum|seq|timestamp|source|body`
计算得出。

## 快速开始

```bash
python make_sample.py sample_logs.jsonl   # 生成含异常样例
python cli.py verify sample_logs.jsonl    # 整链校验:首个不一致+影响范围
python cli.py list sample_logs.jsonl      # 查看完整链条
python server.py sample_logs.jsonl --port 8000   # 打开 http://127.0.0.1:8000/
```

## 功能对照

1. **载入与查看链条**: `cli.py list` 或 Web 界面左侧的完整链表格。
2. **完整性校验**: 逐条重算校验值并比对,报告首个不一致记录的位置、
   原因,以及信任被波及的后续区间(所有传递引用该记录的后续记录)。
3. **增量重校验**: 修改正文/顺序号/校验值或切换校验依据后,只重算
   输入发生变化的记录(界面顶部显示"上次重算记录数"),结论与从头
   完整校验完全一致(由 `tests/test_chain.py` 保证)。
4. **可疑标记**: 校验值缺失、格式异常(非预期长度十六进制)、prev_seq
   指向不存在的顺序号、顺序号重复,均标记为可疑并说明原因,不会跳过。
5. **定位与差异查看**: Web 界面"定位下一条可疑记录"按钮循环跳转;
   详情面板展示原始内容、期望/实际校验值差异及对后续链条的影响说明。
6. **裁决管理**: 对可疑记录录入裁决(确认篡改/误报/已修复/待查)与备注,
   持久化在 `adjudications.json`;依据再次变化后仅更新状态实际变化的
   裁决结论,其余裁决逐字节保留。

## 命令行

```bash
python cli.py verify FILE [--json] [--algorithm sha256|sha1|md5]
python cli.py list FILE
python cli.py adjudicate FILE SEQ --verdict tampered|false_positive|fixed|pending --note "备注"
python cli.py reevaluate FILE [--algorithm ALGO]   # 依据变化后重估裁决
```

## 测试

```bash
python -m unittest discover -s tests -v
```
