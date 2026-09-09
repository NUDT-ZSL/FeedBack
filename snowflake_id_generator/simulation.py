"""
多节点模拟模块，用于验证多节点部署下的ID唯一性
"""
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Tuple
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

    def generate_ids(self, num_ids_per_node: int) -> Tuple[List[int], List[int]]:
        """
        模拟多节点并行生成ID

        Args:
            num_ids_per_node: 每个节点生成ID数量

        Returns:
            (所有生成的ID列表, 失败节点的machine_id列表) 元组

        Raises:
            Exception: 如果任何节点生成失败，会抛出最后一个异常
        """
        all_ids = []
        failed_nodes = []
        lock = threading.Lock()
        last_exception = None

        def worker(machine_id: int) -> None:
            nonlocal last_exception
            try:
                generator = self.generators[machine_id]
                ids = [generator.next_id() for _ in range(num_ids_per_node)]
                with lock:
                    all_ids.extend(ids)
            except Exception:
                with lock:
                    failed_nodes.append(machine_id)
                    last_exception = Exception(f"Node {machine_id} failed to generate IDs")
                    last_exception.__cause__ = None
                raise

        with ThreadPoolExecutor(max_workers=self.num_nodes) as executor:
            futures = []
            for machine_id in range(self.num_nodes):
                futures.append(executor.submit(worker, machine_id))

            # 等待所有任务完成，这里会抛出异常如果任何任务失败
            for future in as_completed(futures):
                future.result()

        if last_exception is not None:
            raise last_exception

        return (all_ids, failed_nodes)

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

    def get_stats(self, all_ids: List[int], failed_nodes: List[int] = None) -> Dict:
        """
        获取生成统计信息

        Args:
            all_ids: 生成的ID列表
            failed_nodes: 失败节点列表，可选

        Returns:
            统计信息字典
        """
        if failed_nodes is None:
            failed_nodes = []

        total_ids = len(all_ids)
        unique_ids = len(set(all_ids))
        has_duplicates = not self.check_uniqueness(all_ids)
        successful_nodes = self.num_nodes - len(failed_nodes)
        ids_per_successful_node = total_ids // successful_nodes if successful_nodes > 0 else 0

        total_clock_backward = sum(
            gen.get_status()["clock_backward_count"]
            for gen in self.generators.values()
        )

        return {
            "num_nodes": self.num_nodes,
            "failed_nodes": failed_nodes,
            "successful_nodes": successful_nodes,
            "total_ids": total_ids,
            "avg_ids_per_successful_node": ids_per_successful_node,
            "unique_ids": unique_ids,
            "has_duplicates": has_duplicates,
            "total_clock_backward": total_clock_backward
        }
