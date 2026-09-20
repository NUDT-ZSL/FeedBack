# depsim：多模块构建依赖推演工具

本地离线运行的命令行工具。给定一份模块清单，推导出完整构建顺序，
识别依赖环与缺失依赖；当模块内容指纹或依赖声明发生变化时，推出
受影响范围、传导链与缓存复用结论。支持连续多次改动，每次结果都
与从零全量重算一致（内部每次改动后都对全图重新计算签名）。

纯 Python 3 标准库实现，无第三方依赖。

## 清单格式（manifest.json）

```json
{
  "modules": [
    {"id": "core", "fingerprint": "core-v1", "deps": []},
    {"id": "web", "fingerprint": "web-v1", "deps": ["core"],
     "cache": {"signature": "aa4c1aa1c20c9af9"}}
  ]
}
```

- `id`：模块标识（必填，唯一）
- `fingerprint`：内容指纹（必填），内容或外部依赖版本变化时更新它
- `deps`：声明的依赖指向（可选，按 id 引用其他模块）
- `cache`：可选的缓存产物标记，`signature` 是上次构建时的构建签名；
  省略或签名未知时视为无可用缓存。`rebuild` 命令会自动写入

## 构建签名与缓存复用规则

模块的构建签名 = 哈希（自身内容指纹 + 全部依赖的签名）。因此：

- 自身内容指纹变化 → 自身及所有下游必须重编
- 依赖声明增删 → 该模块及所有下游必须重编
- 仅依赖声明顺序调整 → 签名不变，缓存可复用
- 成环模块（强连通分量）整组共享组签名，任一成员变化整组重编
- 依赖指向清单外模块 → 该模块标记为依赖缺失，其自身与下游的
  构建结论标记为“不可信”

缓存产物仅在缓存签名与当前构建签名一致时可复用。

## 命令

```bash
python -m depsim --manifest examples/manifest.json status    # 构建顺序与缓存状态
python -m depsim --manifest examples/manifest.json check     # 校验：依赖环、缺失依赖
python -m depsim --manifest examples/manifest.json show web  # 单模块详细判定

# 推演改动影响（不写回清单）
python -m depsim --manifest examples/manifest.json impact --fp core=v2
python -m depsim --manifest examples/manifest.json impact --add-dep app:net --remove-dep web:util

# 应用改动并写回清单，同时输出影响
python -m depsim --manifest examples/manifest.json apply --fp core=v2

# 模拟重编：为必须重编的模块写入新缓存签名
python -m depsim --manifest examples/manifest.json rebuild

# 交互模式：连续改动
python -m depsim --manifest examples/manifest.json repl
```

交互模式命令：`status` / `show <模块>` / `check` / `impact <改动...>` /
`apply <改动...>` / `rebuild` / `save [路径]` / `load <路径>` / `help` / `quit`。
改动语法：`fp 模块=新指纹`、`add-dep 模块:依赖`、`remove-dep 模块:依赖`，
可一次给多个，例如：`impact fp core=v2 add-dep app:core`。

## 输出说明

- **构建顺序**：被依赖者在前；成环模块整组相邻并标注
- **成环模块组**：明确列出参与闭环的模块
- **依赖缺失**：缺失指向保留在清单中，并列出结论不可信的下游模块
- **影响推演**：必须重编的模块逐个给出原因（内容指纹变化 / 依赖声明
  变化 / 沿依赖链传导：a -> b -> c）；仅顺序调整的模块单独列出并
  说明缓存可复用
- **汇总**：当前可复用缓存 / 必须重编 / 结论不可信的模块数与清单

## 测试

```bash
python -m unittest discover -s tests -v
```
