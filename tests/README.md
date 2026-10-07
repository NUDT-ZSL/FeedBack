# 成绩记录链路离线测试

## 运行

```bash
npm test
```

一条命令批量执行 `tests/leaderboard.test.ts` 中的全部用例，输出每个风险点的通过/失败结论。
测试完全离线：使用临时目录下的独立 SQLite 文件和 `127.0.0.1` 随机端口，不依赖外部网络与账号。

## 覆盖的风险点

1. **重复/丢失**：同一用户对同一迷宫连续提交多次，排行条数、记录 id 与提交响应一一对应，不去重、不丢失。
2. **并发一致性**：40 次并发提交与持续轮询读取交错，每次读取都必须是完整、有序、无重复的一致快照；结束后排行包含全部成绩。
3. **错误语义一致**：迷宫不存在时提交与读取均返回 404 且 `error` 文案一致；用户名为空、用时为负数/非数字/缺失时提交返回 400，且非法数据不写入排行。所有错误响应统一为 `{ "error": "..." }`。
4. **顺序稳定可复现**：排行按 `time_seconds ASC, created_at ASC, id ASC` 排序；相同用时按提交先后排列，多次读取结果完全一致。

## 接口约定（测试锁定）

- 提交：`POST /api/mazes/:id/attempt`，成功 201 返回成绩对象 `{id, maze_id, username, time_seconds, created_at}`。
- 排行：`GET /api/mazes/:id/attempts`，成功 200 返回同结构对象数组，字段与提交响应一致。

## 环境说明

- 依赖安装需要 Node >= 22.18（利用内置 TypeScript 类型剥离直接运行 `.ts` 测试，无需额外构建）。
- 本环境无编译工具且 GitHub 不可达，`sqlite3` 原生模块通过 npmmirror 预编译包安装：

```bash
npm install --ignore-scripts
curl -sL -o /tmp/sqlite3.tar.gz https://registry.npmmirror.com/-/binary/sqlite3/v5.1.7/sqlite3-v5.1.7-napi-v3-linux-x64.tar.gz
tar -xzf /tmp/sqlite3.tar.gz -C node_modules/sqlite3
```
