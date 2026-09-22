# 分段上传与后台转换（本地全栈应用）

围绕“分段接收 → 幂等去重 → 后台可续传转换 → 结果下载”的完整链路。

## 启动

```bat
start.bat
```

或手动：

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

浏览器打开 http://127.0.0.1:8000

## 功能对照

1. 选择本地大文件后按段上传，界面显示整体进度与每段状态，可暂停/继续。
2. 断网重连后，前端凭 `client_token` 恢复同一会话，只补传缺失分段；
   服务端按 SHA-256 幂等去重，已落盘分段直接返回 `duplicate`，
   不重复写入、`bytes_billed` 不重复计费。
3. 分段写入失败（如校验和不匹配）会在界面标红该段并显示原因，
   可单独点“重试该分段”。
4. 全部分段接收完成后自动进入后台转换，界面轮询显示转换进度与状态。
5. 转换按段生成 `.part` 检查点；中途失败保留已完成结果，
   “从失败点继续转换”只处理缺失的段。
6. 转换完成后可下载 `result.ufmt`，并展示完整状态变化记录（events）。

## 演示开关（界面右上角数字框）

- “损坏第 N 段”：上传时故意发错校验和，演示分段失败与单段重试。
- “转换在第 N 段失败”：演示转换中断与断点续转。

## API 概览

- `POST /api/uploads` 初始化/恢复会话（按 client_token 去重）
- `PUT /api/uploads/{id}/chunks/{i}` 上传分段（幂等）
- `GET /api/uploads/{id}` 会话状态（已收/缺失/失败分段、转换进度）
- `POST /api/uploads/{id}/convert[?fail_at=N]` 开始或续跑转换
- `GET /api/uploads/{id}/events` 状态变化记录
- `GET /api/uploads/{id}/result` 下载结果
