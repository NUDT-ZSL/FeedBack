# 多租户物联网规则引擎

一个用于物联网设备数据流处理的多租户规则引擎，支持实时决策、规则动态更新和租户隔离。

## 功能特性

- **事件模型**: 支持设备事件，包含 event_id, tenant_id, device_id, metric, value, timestamp
- **规则模型**: JSON格式配置规则，支持条件表达式（比较运算符、逻辑运算符）和动作（forward、alert、drop）
- **规则引擎**: 按租户分组，优先级匹配，动态更新规则
- **租户隔离**: 完全隔离不同租户的规则和数据
- **统计审计**: 事件统计、动作计数、告警日志
- **模拟事件源**: 支持从文件读取和标准输入交互
- **命令行接口**: 简洁的CLI，输出JSON格式统计结果

## 项目结构

```
.
├── README.md
├── main.py                 # 命令行入口
├── rule_engine/
│   ├── __init__.py
│   ├── event.py            # 事件模型定义
│   ├── rule.py             # 规则模型定义
│   ├── engine.py           # 规则引擎核心
│   ├── event_source.py     # 事件源实现
│   └── parser.py           # 条件表达式解析
├── examples/
│   ├── rules.json          # 示例规则文件
│   └── events.jsonl        # 示例事件文件
└── output/
```

## 安装与运行

本项目仅使用Python标准库，无需安装第三方依赖。

### 基本用法

处理文件中的事件和规则：

```bash
python main.py --rules examples/rules.json --events examples/events.jsonl --output output/result.json
```

输出结果是JSON格式，包含每个租户的统计信息和告警列表。

### 交互模式（标准输入事件源）

```bash
python main.py --rules examples/rules.json
```

然后可以逐行输入JSON格式的事件，引擎会实时处理并输出结果。按Ctrl+D结束输入。

### 动态规则更新

在交互模式下，可以输入特殊命令来动态更新规则：

- 加载新规则：`load: path/to/rules.json`
- 删除规则：`delete: rule_id`
- 显示统计：`stats`

示例：
```
{"event_id": "e1", "tenant_id": "factory_a", "device_id": "t1", "metric": "temperature", "value": 85, "timestamp": "2026-09-09T10:00:00Z"}
load: examples/new_rules.json
delete: rule_1
stats
```

## 规则格式

规则使用JSON格式配置，示例：

```json
[
  {
    "rule_id": "rule_1",
    "tenant_id": "factory_a",
    "priority": 1,
    "condition": "temperature > 80 AND humidity < 60",
    "action": "alert"
  },
  {
    "rule_id": "rule_2",
    "tenant_id": "factory_b",
    "priority": 10,
    "condition": "humidity < 20",
    "action": "alert"
  },
  {
    "rule_id": "rule_3",
    "tenant_id": "factory_b",
    "priority": 5,
    "condition": "temperature >= 70",
    "action": "forward"
  }
]
```

### 条件表达式语法

- 比较运算符：`>`, `<`, `>=`, `<=`, `==`, `!=`
- 逻辑运算符：`AND`, `OR`, `NOT`
- 支持括号改变优先级
- 示例：
  - `temperature > 80`
  - `NOT (temperature < 50)`
  - `(temperature > 50 AND humidity < 40) OR pressure > 1000`

### 动作类型

- `forward`: 转发事件到下一阶段
- `alert`: 产生告警并转发
- `drop`: 丢弃事件，不继续处理

## 事件格式

每个事件是一个JSON对象，每行一个：

```json
{"event_id": "e1", "tenant_id": "factory_a", "device_id": "thermo_1", "metric": "temperature", "value": 85.5, "timestamp": "2026-09-09T10:00:00Z"}
{"event_id": "e2", "tenant_id": "factory_b", "device_id": "hygro_1", "metric": "humidity", "value": 15.0, "timestamp": "2026-09-09T10:01:00Z"}
```

## 输出格式

处理完成后，输出JSON格式的统计结果：

```json
{
  "generated_at": "2026-09-09T12:34:56Z",
  "total_events_processed": 100,
  "errors": [
    "Error message 1",
    "Error message 2"
  ],
  "tenants": {
    "factory_a": {
      "total_events": 50,
      "action_counts": {
        "forward": 40,
        "alert": 8,
        "drop": 2
      },
      "alerts": [
        {
          "event_id": "e1",
          "device_id": "t1",
          "metric": "temperature",
          "value": 85.5,
          "timestamp": "2026-09-09T10:00:00Z",
          "rule_id": "rule_1"
        }
      ]
    },
    "factory_b": {
      "total_events": 50,
      "action_counts": {
        "forward": 35,
        "alert": 10,
        "drop": 5
      },
      "alerts": []
    }
  }
}
```

## 测试

使用示例文件测试：

```bash
python main.py --rules examples/rules.json --events examples/events.jsonl
cat output/result.json
```

预期输出会显示两个租户的统计信息，正确匹配规则，没有串扰。

## 设计说明

### 架构

1. **EventSource**: 抽象接口，支持替换为不同的事件源（文件、标准输入、消息队列）
2. **RuleParser**: 将条件表达式解析为AST，用于评估
3. **RuleEngine**: 核心引擎，按租户隔离规则，事件处理，动态更新
4. **Statistics**: 统计收集，线程安全支持并发处理

### 扩展性

- 要添加新的事件源，只需继承`EventSource`并实现`events()`方法
- 要添加新的动作类型，只需扩展`Action`枚举并在引擎中添加处理逻辑
- 条件表达式解析器支持轻松添加新的运算符

### 性能

- 使用惰性解析，规则只在加载时解析一次
- 评估时直接遍历AST，无额外开销
- 租户隔离使用字典分组，快速查找
- 处理10万事件在普通机器上可在几秒内完成

## 边界情况处理

- 非法事件（字段缺失、类型错误）会被记录错误并跳过，不影响其他事件
- 非法规则（条件语法错误）会被记录错误，不影响其他规则
- 空事件流会输出空统计
- 乱序事件处理正确，统计不受顺序影响
