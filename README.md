# 分布式唯一ID生成器（雪花算法变体）

一个灵活、健壮的雪花算法变体实现，支持自定义位数配置、多节点部署和时钟回拨处理。

## 特性

- 🚀 **灵活配置**: 支持自定义时间戳、机器ID、序列号位数
- 🛡️ **时钟回拨处理**: 智能处理系统时钟回拨，支持可配置阈值
- 🔒 **线程安全**: 多线程环境下安全生成ID
- 🧪 **完整测试**: 覆盖所有边界场景的单元测试
- 🖥️ **命令行工具**: 提供方便的CLI工具
- 🔍 **模拟验证**: 内置多节点模拟验证，确保全局唯一性

## ID结构

默认配置下生成64位长整型ID，结构如下：

| 符号位 | 时间戳 | 机器ID | 序列号 |
|--------|--------|--------|--------|
| 1位    | 41位   | 10位   | 12位   |

- **符号位**: 固定为0，保证ID为正数
- **时间戳**: 相对于自定义纪元的毫秒偏移量，41位可使用约69年
- **机器ID**: 标识节点，10位支持最多1024个节点
- **序列号**: 每毫秒内自增，12位支持每毫秒最多4096个ID

总位数固定为64位，时间戳+机器ID+序列号 = 63位，加上符号位正好64位。

## 安装

```bash
# 克隆项目
git clone https://github.com/your-username/snowflake-id-generator.git
cd snowflake-id-generator

# 安装依赖（本项目只需要Python标准库）
# Python 3.6+ required
```

## 快速开始

### Python API

```python
import time
from snowflake_id_generator import SnowflakeIDGenerator, parse_id

# 自定义纪元（示例：2020-01-01 00:00:00 UTC）
epoch_ms = int(time.mktime(time.strptime("2020-01-01 00:00:00", "%Y-%m-%d %H:%M:%S"))) * 1000

# 创建生成器，机器ID为1
generator = SnowflakeIDGenerator(machine_id=1, epoch_ms=epoch_ms)

# 生成一个ID
new_id = generator.next_id()
print(f"Generated ID: {new_id}")

# 解析ID
timestamp, machine_id, sequence, _ = parse_id(new_id, epoch_ms=epoch_ms)
# 或使用全参数调用
# timestamp, machine_id, sequence, _ = parse_id(new_id, 41, 10, 12, epoch_ms)
print(f"Timestamp: {timestamp}")
print(f"Machine ID: {machine_id}")
print(f"Sequence: {sequence}")
```

### 命令行工具

```bash
# 生成一个ID
python main.py generate --machine-id 1

# 生成多个ID并查看解析结果
python main.py generate --machine-id 1 --count 5

# 查看生成器状态
python main.py status --machine-id 1

# 解析已有ID
python main.py parse <your-id>

# 模拟多节点生成（10个节点，每个生成1000个ID）
python main.py simulate --nodes 10 --ids-per-node 1000 --check-unique
```

## 配置说明

### 自定义位数

你可以根据需求调整各部分位数：

```python
generator = SnowflakeIDGenerator(
    machine_id=1,
    epoch_ms=epoch_ms,
    timestamp_bits=40,  # 40位时间戳，可使用约34年
    machine_bits=12,     # 12位机器ID，支持最多4096个节点
    sequence_bits=11     # 11位序列号，每毫秒最多2048个ID
    # 40+12+11 = 63，总和必须为63
)
```

### 时钟回拨处理

- 当检测到时钟回拨小于配置的阈值（默认10毫秒），会等待时钟追上
- 如果回拨超过阈值，会抛出 `ClockBackwardError` 异常
- 生成器会记录发生过的回拨次数，可以通过 `get_status()` 查看

```python
generator = SnowflakeIDGenerator(
    ...,
    clock_backward_threshold=20  # 修改阈值为20毫秒
)

# 查看回拨次数
status = generator.get_status()
print(f"Clock backward count: {status['clock_backward_count']}")
```

## 多节点模拟

可以使用内置的 `Simulation` 类模拟多节点并行生成ID，验证全局唯一性：

```python
from snowflake_id_generator.simulation import Simulation

simulation = Simulation(
    num_nodes=10,  # 10个节点
    epoch_ms=epoch_ms
)

# 每个节点生成1000个ID
all_ids = simulation.generate_ids(1000)

# 检查唯一性
is_unique = simulation.check_uniqueness(all_ids)
print(f"All IDs are unique: {is_unique}")

# 获取统计信息
stats = simulation.get_stats(all_ids)
print(stats)
```

## 命令行使用说明

### generate

生成一个或多个ID，并输出解析后的信息：

```bash
python main.py generate [options]

Options:
  --machine-id INT     机器ID (必填)
  --count INT          生成数量 (默认: 1)
  --timestamp-bits INT 时间戳位数 (默认: 41)
  --machine-bits INT   机器ID位数 (默认: 10)
  --sequence-bits INT  序列号位数 (默认: 12)
  --epoch INT          自定义纪元毫秒时间戳 (默认: 2020-01-01)
  --threshold INT      时钟回拨阈值 (默认: 10)
```

### status

查看生成器当前状态：

```bash
python main.py status --machine-id 1 --generate
```

### simulate

模拟多节点生成并输出统计：

```bash
python main.py simulate --nodes 10 --ids-per-node 1000 --check-unique
```

输出示例：
```json
{
  "num_nodes": 10,
  "num_ids_per_node": 1000,
  "total_ids": 10000,
  "unique_ids": 10000,
  "has_duplicates": false,
  "total_clock_backward": 0,
  "unique_check_passed": true
}
```

### parse

解析已有的ID：

```bash
python main.py parse <id>
```

## 运行单元测试

```bash
python -m unittest discover -v tests
```

所有测试应该都能通过：

```
test_custom_bit_configuration (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_default_config_valid (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_generate_multiple_ids_are_unique (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_generate_single_id (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_get_status (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_invalid_total_bits (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_large_clock_backward_throw (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_machine_id_out_of_range (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_negative_machine_id (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_parse_id (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_sequence_overflow (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_small_clock_backward_wait (tests.test_snowflake.TestSnowflakeIDGenerator) ... ok
test_multiple_nodes_unique (tests.test_snowflake.TestSimulation) ... ok
test_get_stats (tests.test_snowflake.TestSimulation) ... ok

----------------------------------------------------------------------
Ran 14 tests in 2.345s

OK
```

## 性能测试

默认配置下，生成100万个ID大约需要：

```bash
time python -c "
import time
from snowflake_id_generator import SnowflakeIDGenerator
epoch = int(time.time() * 1000)
gen = SnowflakeIDGenerator(1, epoch)
ids = [gen.next_id() for _ in range(1_000_000)]
print(len(set(ids)) == 1_000_000)
"
```

输出应该是 `True`，全部唯一。

## 使用建议

1. **选择合适的纪元**: 选择项目上线时间作为纪元，可以延长可用时间。例如，纪元设为2020年，41位时间戳可以用到2089年。

2. **机器ID分配**: 在分布式环境中，需要保证每个节点的机器ID唯一。可以通过配置中心或服务注册中心分配。

3. **时钟同步**: 虽然本实现处理了时钟回拨，但仍建议使用NTP服务同步节点时钟，减少时钟回拨发生。

4. **自定义位数**: 根据你的集群规模调整位数。如果节点较少，可以减少机器ID位数，增加序列号位数，提高单节点每秒生成能力。

## 异常处理

- `InvalidConfigurationError`: 配置不合法时抛出，请检查位数总和是否为63，机器ID是否在范围内。
- `ClockBackwardError`: 时钟回拨超过阈值时抛出，请检查系统时钟。

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request。
