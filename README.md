# depviz — 多模块构建依赖推演工具

本地离线运行的命令行工具（纯 Python 标准库，3.6+），用于在多模块工程中
反复改动模块内容 / 依赖声明，并立即观察受影响范围与缓存复用情况。

## 清单格式

一份 JSON 文件，`modules` 数组中每个模块包含：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 模块标识（唯一） |
| `fingerprint` | 是 | 内容指纹，模块内容变化时应改变 |
| `deps` | 否 | 声明的依赖指向（模块 id 数组，默认空） |
| `cache` | 否 | 缓存产物标记（上次构建时的输入签名） |

示例见 [examples/modules.json](examples/modules.json)。

## 快速开始

```powershell
python -m depviz analyze examples/modules.json   # 一次性完整分析
python -m depviz load examples/modules.json      # 加载清单，开始会话
python -m depviz status                          # 当前构建顺序与逐模块结论
python -m depviz set-fingerprint core core-v2    # 改内容指纹，看影响面
python -m depviz add-dep app core                # 新增依赖（目标可不存在）
python -m depviz remove-dep app core             # 移除依赖
python -m depviz mark-built                      # 模拟重编，更新缓存标记
python -m depviz show app                        # 单模块详情与结论依据
```

会话状态保存在当前目录的 `.depviz-state.json`，可连续多次改动。

## 判定语义

- **输入签名** = 模块自身内容指纹 + 全部传递依赖指纹集合的哈希（与声明
  顺序无关）。每次改动后都对当前状态做完整重算，因此结果始终与从零
  全量重算一致。
- **必须重编**：无缓存产物，或缓存标记与当前输入签名不一致。
- **可复用缓存**：缓存标记与当前输入签名一致。
- **仅顺序调整**：依赖声明变了，但传递依赖集合没变（如移除冗余依赖），
  输入签名不变，无需重编。
- **成环无法构建**：Tarjan 强连通分量识别依赖环，明确列出参与闭环的
  全部模块，环上模块不参与构建顺序。
- **结论不可信**：依赖指向清单中不存在的模块时，该模块保留在清单与
  构建顺序中，但它及其全部下游模块的构建结论标记为不可信。
- 指纹变更的影响面沿依赖反方向（谁依赖它）传导，报告中为每个受影响
  模块给出一条具体传导链，如 `core -> net -> app`。

## 测试

```powershell
python -m unittest discover -s tests
```
