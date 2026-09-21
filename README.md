# depimpact

离线依赖影响推演工具。它从本地 JSON 描述构建依赖图，沿完整上下游链路计算受影响节点和一条确定的最短传播路径，并显式标出成环、缺失引用以及因此不可信的结论。

## 依赖方向

边 `{ "from": "api", "to": "database" }` 表示 `api` 直接依赖 `database`。当 `database` 变化时，影响沿反向依赖传播到 `api`，再继续传播到依赖 `api` 的节点。

边变化从边的 `from` 端开始传播：新增、删除或修改 `api -> database` 可能影响 `api` 以及所有依赖 `api` 的节点。

## 描述格式

```json
{
  "version": 1,
  "nodes": [
    {"id": "database", "attributes": {"schema": 5}},
    {"id": "api", "attributes": {"version": "1.3.0"}}
  ],
  "edges": [
    {"from": "api", "to": "database", "attributes": {"kind": "runtime"}}
  ],
  "controls": {
    "locked": ["worker"],
    "excluded": ["scratch"]
  }
}
```

`version`、`nodes`、`edges` 为必填。节点必须有非空字符串 `id`；边必须有 `from` 和 `to`。`attributes` 必须是对象。重复节点、重复边、未知字段、控制不存在的节点等格式/schema 问题都会失败，并且不会输出任何传播结果。

成环和边端点未声明不是格式错误：工具会保留可观察的图、列出结构问题，并把被这些边界污染的路径和节点标为 `untrusted`。

## 使用

无需联网，也没有第三方运行时依赖：

```powershell
$env:PYTHONPATH = "src"
python -m depimpact inspect examples/new.json
python -m depimpact propagate examples/new.json --node database
python -m depimpact propagate examples/new.json --edge-added "reporting->database"
python -m depimpact diff examples/old.json examples/new.json
```

任意命令都可以在子命令前加 `--json`，获得稳定的机器可读输出：

```powershell
python -m depimpact --json propagate examples/new.json --node database
```

## 输出含义

- `direct_dependencies`：节点直接依赖的对象。
- `reverse_dependencies`：直接依赖该节点的对象。
- `affected`：完整可达推导后受影响的普通节点。
- `locked`：被使用者锁定的可达节点；节点本身不计入 affected，但传播仍穿过它，所以后续节点的结论与无干预时一致。
- `excluded`：被使用者排除的可达节点；它从 affected 中隐藏，但完整路径仍在内部计算并可在 paths 中查看，不会截断其他节点的可达性。
- `untrusted`：传播路径进入循环或未声明节点，结论可能不完整。
- `undeclared`：边引用但 nodes 中没有声明的信任边界，不属于真实受影响节点。
- `paths`：每个可达节点的一条最短路径；循环会导致同一节点反复可达，因此输出按最短路径解释传播方式，同时保留不可信标记。

## 校验

```powershell
python -m unittest discover -s tests
```

