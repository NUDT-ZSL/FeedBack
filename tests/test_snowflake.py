"""
单元测试
"""
import unittest
import time
from snowflake_id_generator.generator import (
    SnowflakeIDGenerator, InvalidConfigurationError, ClockBackwardError, parse_id
)
from snowflake_id_generator.simulation import Simulation


class TestSnowflakeIDGenerator(unittest.TestCase):
    """测试SnowflakeIDGenerator"""

    def setUp(self):
        self.default_epoch = int(time.mktime(time.strptime("2020-01-01 00:00:00", "%Y-%m-%d %H:%M:%S"))) * 1000

    def test_default_config_valid(self):
        """测试默认配置合法"""
        generator = SnowflakeIDGenerator(
            machine_id=1,
            epoch_ms=self.default_epoch
        )
        # 不应该抛出异常
        self.assertTrue(True)

    def test_invalid_total_bits(self):
        """测试位数和不为63"""
        with self.assertRaises(InvalidConfigurationError):
            SnowflakeIDGenerator(
                machine_id=1,
                epoch_ms=self.default_epoch,
                timestamp_bits=40,
                machine_bits=10,
                sequence_bits=12
            )  # 40+10+12=62 ≠ 63

    def test_machine_id_out_of_range(self):
        """测试机器ID超出范围"""
        with self.assertRaises(InvalidConfigurationError):
            SnowflakeIDGenerator(
                machine_id=1024,  # 默认10位，最大机器ID是1023
                epoch_ms=self.default_epoch
            )

    def test_negative_machine_id(self):
        """测试负的机器ID"""
        with self.assertRaises(InvalidConfigurationError):
            SnowflakeIDGenerator(
                machine_id=-1,
                epoch_ms=self.default_epoch
            )

    def test_generate_single_id(self):
        """测试生成单个ID"""
        generator = SnowflakeIDGenerator(
            machine_id=1,
            epoch_ms=self.default_epoch
        )
        _id = generator.next_id()
        self.assertIsInstance(_id, int)
        self.assertTrue(_id > 0)

    def test_generate_multiple_ids_are_unique(self):
        """测试连续生成多个ID都是唯一的"""
        generator = SnowflakeIDGenerator(
            machine_id=1,
            epoch_ms=self.default_epoch
        )
        count = 10000
        ids = [generator.next_id() for _ in range(count)]
        unique_ids = set(ids)
        self.assertEqual(len(unique_ids), count)

    def test_parse_id(self):
        """测试解析ID"""
        machine_id = 42
        generator = SnowflakeIDGenerator(
            machine_id=machine_id,
            epoch_ms=self.default_epoch,
            timestamp_bits=41,
            machine_bits=10,
            sequence_bits=12
        )
        _id = generator.next_id()
        parsed = parse_id(_id, 41, 10, 12, self.default_epoch)
        timestamp, parsed_machine_id, sequence, raw_id = parsed

        self.assertEqual(raw_id, _id)
        self.assertEqual(parsed_machine_id, machine_id)
        self.assertIsInstance(timestamp, int)
        self.assertTrue(timestamp >= self.default_epoch)

    def test_sequence_overflow(self):
        """测试序列号溢出等待"""
        generator = SnowflakeIDGenerator(
            machine_id=1,
            epoch_ms=self.default_epoch,
            timestamp_bits=50,
            machine_bits=10,
            sequence_bits=3  # 50+10+3 = 63，每毫秒最多8个ID，方便触发溢出
        )
        # 生成8个ID，应该都在同一毫秒（如果机器足够快）
        ids = [generator.next_id() for _ in range(8)]
        # 第9个应该等待下一毫秒
        start_time = time.time()
        ninth_id = generator.next_id()
        elapsed = (time.time() - start_time) * 1000
        # 应该至少等待了接近1毫秒
        self.assertTrue(elapsed >= 0.5)
        # 所有9个ID都应该唯一
        self.assertEqual(len(set(ids + [ninth_id])), 9)

    def test_small_clock_backward_wait(self):
        """测试小回拨等待"""
        generator = SnowflakeIDGenerator(
            machine_id=1,
            epoch_ms=self.default_epoch,
            clock_backward_threshold=10
        )

        # 先生成一个ID记录当前时间
        _id1 = generator.next_id()
        # 直接修改last_timestamp模拟时钟回拨5毫秒
        with generator._lock:
            generator.last_timestamp += 5

        # 生成下一个ID应该能处理回拨
        _id2 = generator.next_id()
        # 回拨次数应该增加1
        status = generator.get_status()
        self.assertEqual(status["clock_backward_count"], 1)
        # 两个ID都唯一
        self.assertNotEqual(_id1, _id2)

    def test_large_clock_backward_throw(self):
        """测试大回拨抛出异常"""
        generator = SnowflakeIDGenerator(
            machine_id=1,
            epoch_ms=self.default_epoch,
            clock_backward_threshold=10
        )

        _id1 = generator.next_id()
        # 模拟回拨20毫秒，超过阈值10
        with generator._lock:
            generator.last_timestamp += 20

        with self.assertRaises(ClockBackwardError):
            generator.next_id()

    def test_get_status(self):
        """测试获取状态"""
        generator = SnowflakeIDGenerator(
            machine_id=42,
            epoch_ms=self.default_epoch,
            timestamp_bits=41,
            machine_bits=10,
            sequence_bits=12,
            clock_backward_threshold=10
        )
        generator.next_id()
        status = generator.get_status()

        self.assertEqual(status["machine_id"], 42)
        self.assertEqual(status["epoch_ms"], self.default_epoch)
        self.assertGreater(status["last_timestamp"], -1)
        self.assertIsInstance(status["sequence"], int)
        self.assertEqual(status["clock_backward_count"], 0)
        self.assertEqual(status["config"]["timestamp_bits"], 41)
        self.assertEqual(status["config"]["machine_bits"], 10)
        self.assertEqual(status["config"]["sequence_bits"], 12)
        self.assertEqual(status["config"]["clock_backward_threshold"], 10)

    def test_custom_bit_configuration(self):
        """测试自定义位数配置"""
        generator = SnowflakeIDGenerator(
            machine_id=15,
            epoch_ms=self.default_epoch,
            timestamp_bits=40,
            machine_bits=12,
            sequence_bits=11,  # 40+12+11=63
            clock_backward_threshold=10
        )
        _id = generator.next_id()
        self.assertIsInstance(_id, int)
        parsed = parse_id(_id, 40, 12, 11, self.default_epoch)
        self.assertEqual(parsed[1], 15)


class TestSimulation(unittest.TestCase):
    """测试Simulation类"""

    def setUp(self):
        self.default_epoch = int(time.mktime(time.strptime("2020-01-01 00:00:00", "%Y-%m-%d %H:%M:%S"))) * 1000

    def test_multiple_nodes_unique(self):
        """测试多节点并行生成无重复"""
        num_nodes = 10
        ids_per_node = 1000
        simulation = Simulation(
            num_nodes=num_nodes,
            epoch_ms=self.default_epoch
        )
        all_ids = simulation.generate_ids(ids_per_node)
        self.assertEqual(len(all_ids), num_nodes * ids_per_node)
        self.assertTrue(simulation.check_uniqueness(all_ids))

    def test_get_stats(self):
        """测试获取统计信息"""
        num_nodes = 5
        ids_per_node = 100
        simulation = Simulation(
            num_nodes=num_nodes,
            epoch_ms=self.default_epoch
        )
        all_ids = simulation.generate_ids(ids_per_node)
        stats = simulation.get_stats(all_ids)

        self.assertEqual(stats["num_nodes"], num_nodes)
        self.assertEqual(stats["num_ids_per_node"], ids_per_node)
        self.assertEqual(stats["total_ids"], num_nodes * ids_per_node)
        self.assertEqual(stats["unique_ids"], num_nodes * ids_per_node)
        self.assertFalse(stats["has_duplicates"])


if __name__ == "__main__":
    unittest.main()
