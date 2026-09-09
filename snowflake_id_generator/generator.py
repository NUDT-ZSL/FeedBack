"""
雪花算法ID生成器核心实现
"""
import time
import threading
from typing import Dict, Tuple


class InvalidConfigurationError(Exception):
    """配置不合法时抛出的异常"""
    pass


class ClockBackwardError(Exception):
    """时钟回拨超过阈值时抛出的异常"""
    pass


class SnowflakeIDGenerator:
    """
    雪花算法ID生成器变体

    ID结构（64位长整型）：
    +-------+------------+-----------+------------+
    | 符号位 | 时间戳部分 | 机器ID部分 | 序列号部分 |
    +-------+------------+-----------+------------+
    |  1位  | 可配置位数  |  可配置位数 |  可配置位数 |
    +-------+------------+-----------+------------+

    总位数固定64位，时间戳、机器ID、序列号位数之和必须为63。
    """

    def __init__(
        self,
        machine_id: int,
        epoch_ms: int,
        timestamp_bits: int = 41,
        machine_bits: int = 10,
        sequence_bits: int = 12,
        clock_backward_threshold: int = 10
    ):
        """
        初始化ID生成器

        Args:
            machine_id: 机器ID，必须小于 2^machine_bits
            epoch_ms: 自定义纪元的毫秒时间戳，时间戳将基于这个纪元计算
            timestamp_bits: 时间戳占用位数，默认41位（可使用约69年）
            machine_bits: 机器ID占用位数，默认10位（支持最多1024个节点）
            sequence_bits: 序列号占用位数，默认12位（每毫秒最多生成4096个ID）
            clock_backward_threshold: 时钟回拨容忍阈值（毫秒），超过此阈值将抛出异常

        Raises:
            InvalidConfigurationError: 当配置不合法时抛出
        """
        # 校验配置
        self._validate_config(timestamp_bits, machine_bits, sequence_bits, machine_id)

        self.machine_id = machine_id
        self.epoch_ms = epoch_ms
        self.timestamp_bits = timestamp_bits
        self.machine_bits = machine_bits
        self.sequence_bits = sequence_bits
        self.clock_backward_threshold = clock_backward_threshold

        # 计算移位和掩码
        self.timestamp_shift = machine_bits + sequence_bits
        self.machine_id_shift = sequence_bits
        self.sequence_mask = (1 << sequence_bits) - 1

        # 状态变量
        self.last_timestamp = -1
        self.sequence = 0
        self.clock_backward_count = 0

        # 线程锁
        self._lock = threading.Lock()

    def _validate_config(
        self,
        timestamp_bits: int,
        machine_bits: int,
        sequence_bits: int,
        machine_id: int
    ) -> None:
        """校验配置合法性"""
        total_bits = timestamp_bits + machine_bits + sequence_bits
        if total_bits != 63:
            raise InvalidConfigurationError(
                f"时间戳({timestamp_bits}) + 机器ID({machine_bits}) + 序列号({sequence_bits}) = {total_bits} ≠ 63，配置不合法"
            )

        max_machine_id = 1 << machine_bits
        if machine_id < 0 or machine_id >= max_machine_id:
            raise InvalidConfigurationError(
                f"机器ID {machine_id} 超出范围 [0, {max_machine_id})，配置不合法"
            )

    def _current_time_millis(self) -> int:
        """获取当前时间戳（毫秒）"""
        return int(time.time() * 1000)

    def _wait_next_millis(self, last_timestamp: int) -> int:
        """等待直到下一毫秒"""
        current_timestamp = self._current_time_millis()
        while current_timestamp <= last_timestamp:
            time.sleep(0.001)
            current_timestamp = self._current_time_millis()
        return current_timestamp

    def _handle_clock_backward(self, current_timestamp: int) -> int:
        """处理时钟回拨"""
        self.clock_backward_count += 1
        backoff = self.last_timestamp - current_timestamp

        if backoff <= self.clock_backward_threshold:
            # 回拨较小，等待时钟追上
            time.sleep(backoff / 1000.0)
            current_timestamp = self._current_time_millis()
            if current_timestamp < self.last_timestamp:
                # 等待后仍然回拨，使用上次时间戳+1
                return self.last_timestamp + 1
            return current_timestamp
        else:
            # 回拨较大，抛出异常
            raise ClockBackwardError(
                f"检测到时钟回拨 {backoff} 毫秒，超过阈值 {self.clock_backward_threshold} 毫秒，拒绝生成ID"
            )

    def next_id(self) -> int:
        """
        生成下一个ID

        Returns:
            生成的64位唯一ID

        Raises:
            ClockBackwardError: 时钟回拨超过阈值时抛出
        """
        with self._lock:
            current_timestamp = self._current_time_millis()

            if current_timestamp < self.last_timestamp:
                # 检测到时钟回拨
                current_timestamp = self._handle_clock_backward(current_timestamp)

            if current_timestamp == self.last_timestamp:
                # 同一毫秒，序列号递增
                self.sequence = (self.sequence + 1) & self.sequence_mask
                if self.sequence == 0:
                    # 序列号溢出，等待下一毫秒
                    current_timestamp = self._wait_next_millis(self.last_timestamp)
            else:
                # 新的毫秒，序列号重置为0
                self.sequence = 0

            self.last_timestamp = current_timestamp

            # 组合ID
            timestamp_offset = current_timestamp - self.epoch_ms
            _id = (timestamp_offset << self.timestamp_shift) | \
                  (self.machine_id << self.machine_id_shift) | \
                  self.sequence

            return _id

    def get_status(self) -> Dict:
        """
        获取当前生成器状态

        Returns:
            包含上次时间戳、当前序列号、回拨次数等信息的字典
        """
        with self._lock:
            return {
                "machine_id": self.machine_id,
                "epoch_ms": self.epoch_ms,
                "last_timestamp": self.last_timestamp,
                "sequence": self.sequence,
                "clock_backward_count": self.clock_backward_count,
                "config": {
                    "timestamp_bits": self.timestamp_bits,
                    "machine_bits": self.machine_bits,
                    "sequence_bits": self.sequence_bits,
                    "clock_backward_threshold": self.clock_backward_threshold
                }
            }


def parse_id(
    _id: int,
    timestamp_bits: int = 41,
    machine_bits: int = 10,
    sequence_bits: int = 12,
    epoch_ms: int = 0
) -> Tuple[int, int, int, int]:
    """
    解析ID，获取时间戳、机器ID、序列号

    Args:
        _id: 要解析的ID
        timestamp_bits: 时间戳位数
        machine_bits: 机器ID位数
        sequence_bits: 序列号位数
        epoch_ms: 纪元时间戳，如果提供则返回绝对时间戳，否则返回相对偏移

    Returns:
        (timestamp, machine_id, sequence, raw_id) 元组
        - timestamp: 时间戳（如果提供epoch_ms则为绝对时间，否则为相对偏移）
        - machine_id: 机器ID
        - sequence: 本毫秒内的序列号
        - raw_id: 原始ID
    """
    sequence_mask = (1 << sequence_bits) - 1
    machine_id_mask = (1 << machine_bits) - 1

    sequence = _id & sequence_mask
    machine_id = (_id >> sequence_bits) & machine_id_mask
    timestamp_offset = _id >> (sequence_bits + machine_bits)

    if epoch_ms > 0:
        timestamp = timestamp_offset + epoch_ms
    else:
        timestamp = timestamp_offset

    return (timestamp, machine_id, sequence, _id)
