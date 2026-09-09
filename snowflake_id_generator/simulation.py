"""
多节点模拟模块，用于验证多节点部署下的ID唯一性
"""
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict
from .generator import SnowflakeIDGenerator


class Simulation:
    """
    多节点ID生成模拟
    """

    def __init__(
        self,
        num_nodes: int,
        epoch_ms: int,
        timestamp_bits: int = 41,
        machine_bits: int = 10,
        sequence_bits: int = 12,
        clock_backward_threshold: int = 10
    ):
        """
        初始化模拟

        Args:
            num_nodes: 节点数量
            epoch_ms: 自定义纪元
            timestamp_bits: 时间戳位数
            machine_bits: 机器ID位数
            sequence_bits: 序列号位数
            clock_backward_threshold: 时钟回拨阈值
        """
        self.num_nodes = num_nodes
        self.epoch_ms = epoch_ms
        self.timestamp_bits = timestamp_bits
        self.machine_bits = machine_bits
        self.sequence_bits = sequence_bits
        self.clock_backward_threshold = clock_backward_threshold

        # 创建每个节点的生成器
        self.generators: Dict[int, SnowflakeIDGenerator] = {}
        for machine_id in range(num_nodes):
            self.generators[machine_id] = SnowflakeIDGenerator(
                machine_id=machine_id,
                epoch_ms=epoch_ms,
                timestamp_bits=timestamp_bits,
                machine_bits=machine_bits,
                sequence_bits=sequence_bits,
                clock_backward_threshold=clock_backward_threshold
            )

    def generate_ids(self, num_ids_per_node: int) -> List[int]:
        """
        模拟多节点并行生成ID

        Args:
            num_ids_per_node: 每个节点生成ID数量

        Returns:
            所有生成的ID列表
        """
        all_ids = []
        lock = threading.Lock()

        def worker(machine_id: int) -> None:
            generator = self.generators[machine_id]
            ids = [generator.next_id() for _ in range(num_ids_per_node)]
            with lock:
                all_ids.extend(ids)

        with ThreadPoolExecutor(max_workers=self.num_nodes) as executor:
            for machine_id in range(self.num_nodes):
                executor.submit(worker, machine_id)

        return all_ids

    def check_uniqueness(self, ids: List[int]) -> bool:
        """
        检查ID是否唯一

        Args:
            ids: ID列表

        Returns:
            True如果所有ID都唯一，否则False
        """
        seen = set()
        for _id in ids:
            if _id in seen:
                return False
            seen.add(_id)
        return True

    def get_stats(self, ids: List[int]) -> Dict:
        """
        获取生成统计信息

        Args:
            ids: 生成的ID列表

        Returns:
            统计信息字典
        """
        total_ids = len(ids)
        unique_ids = len(set(ids))
        has_duplicates = not self.check_uniqueness(ids)

        total_clock_backward = sum(
            gen.get_status()["clock_backward_count"]
            for gen in self.generators.values()
        )

        return {
            "num_nodes": self.num_nodes,
            "num_ids_per_node": len(ids) // self.num_nodes if self.num_nodes > 0 else 0,
            "total_ids": total_ids,
            "unique_ids": unique_ids,
            "has_duplicates": has_duplicates,
            "total_clock_backward": total_clock_backward
        }
