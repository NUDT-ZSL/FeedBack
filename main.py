#!/usr/bin/env python3
"""
分布式唯一ID生成器命令行工具
"""
import argparse
import json
import sys
from datetime import datetime
from snowflake_id_generator import SnowflakeIDGenerator, parse_id
from snowflake_id_generator.simulation import Simulation


def get_default_epoch() -> int:
    """获取默认纪元（2020-01-01 00:00:00 UTC）"""
    return int(datetime(2020, 1, 1).timestamp() * 1000)


def generate_command(args) -> None:
    """处理generate子命令"""
    epoch = args.epoch if args.epoch else get_default_epoch()

    generator = SnowflakeIDGenerator(
        machine_id=args.machine_id,
        epoch_ms=epoch,
        timestamp_bits=args.timestamp_bits,
        machine_bits=args.machine_bits,
        sequence_bits=args.sequence_bits,
        clock_backward_threshold=args.threshold
    )

    ids = [generator.next_id() for _ in range(args.count)]
    parsed = []
    for _id in ids:
        timestamp, machine_id, sequence, _ = parse_id(
            _id,
            args.timestamp_bits,
            args.machine_bits,
            args.sequence_bits,
            epoch
        )
        parsed.append({
            "id": _id,
            "timestamp": timestamp,
            "datetime": datetime.fromtimestamp(timestamp / 1000).isoformat(),
            "machine_id": machine_id,
            "sequence": sequence
        })

    result = {
        "config": generator.get_status()["config"],
        "generated": parsed
    }
    print(json.dumps(result, indent=2))


def status_command(args) -> None:
    """处理status子命令"""
    epoch = args.epoch if args.epoch else get_default_epoch()

    generator = SnowflakeIDGenerator(
        machine_id=args.machine_id,
        epoch_ms=epoch,
        timestamp_bits=args.timestamp_bits,
        machine_bits=args.machine_bits,
        sequence_bits=args.sequence_bits,
        clock_backward_threshold=args.threshold
    )

    if args.generate:
        generator.next_id()

    status = generator.get_status()
    print(json.dumps(status, indent=2))


def simulate_command(args) -> None:
    """处理simulate子命令"""
    epoch = args.epoch if args.epoch else get_default_epoch()

    simulation = Simulation(
        num_nodes=args.nodes,
        epoch_ms=epoch,
        timestamp_bits=args.timestamp_bits,
        machine_bits=args.machine_bits,
        sequence_bits=args.sequence_bits,
        clock_backward_threshold=args.threshold
    )

    print(f"Starting simulation: {args.nodes} nodes, {args.ids_per_node} IDs per node...", file=sys.stderr)
    all_ids = simulation.generate_ids(args.ids_per_node)
    stats = simulation.get_stats(all_ids)

    if args.check_unique:
        stats["unique_check_passed"] = simulation.check_uniqueness(all_ids)

    print(json.dumps(stats, indent=2))


def parse_id_command(args) -> None:
    """处理parse子命令"""
    epoch = args.epoch if args.epoch else get_default_epoch()

    timestamp, machine_id, sequence, _ = parse_id(
        args.id,
        args.timestamp_bits,
        args.machine_bits,
        args.sequence_bits,
        epoch
    )

    result = {
        "id": args.id,
        "timestamp": timestamp,
        "datetime": datetime.fromtimestamp(timestamp / 1000).isoformat(),
        "machine_id": machine_id,
        "sequence": sequence
    }
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(
        description="分布式唯一ID生成器（雪花算法变体）"
    )
    parser.add_argument(
        "--timestamp-bits", type=int, default=41,
        help="时间戳占用位数（默认: 41）"
    )
    parser.add_argument(
        "--machine-bits", type=int, default=10,
        help="机器ID占用位数（默认: 10）"
    )
    parser.add_argument(
        "--sequence-bits", type=int, default=12,
        help="序列号占用位数（默认: 12）"
    )
    parser.add_argument(
        "--epoch", type=int, default=None,
        help="自定义纪元毫秒时间戳（默认: 2020-01-01 00:00:00）"
    )
    parser.add_argument(
        "--threshold", type=int, default=10,
        help="时钟回拨阈值（毫秒，默认: 10）"
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # generate 命令
    generate_parser = subparsers.add_parser("generate", help="生成ID")
    generate_parser.add_argument(
        "--machine-id", type=int, required=True,
        help="机器ID"
    )
    generate_parser.add_argument(
        "--count", type=int, default=1,
        help="生成ID数量（默认: 1）"
    )
    generate_parser.set_defaults(func=generate_command)

    # status 命令
    status_parser = subparsers.add_parser("status", help="查看生成器状态")
    status_parser.add_argument(
        "--machine-id", type=int, required=True,
        help="机器ID"
    )
    status_parser.add_argument(
        "--generate", action="store_true",
        help="生成一个ID后再查看状态"
    )
    status_parser.set_defaults(func=status_command)

    # simulate 命令
    simulate_parser = subparsers.add_parser("simulate", help="多节点模拟生成")
    simulate_parser.add_argument(
        "--nodes", type=int, required=True,
        help="节点数量"
    )
    simulate_parser.add_argument(
        "--ids-per-node", type=int, required=True,
        help="每个节点生成ID数量"
    )
    simulate_parser.add_argument(
        "--check-unique", action="store_true",
        help="检查是否有重复ID"
    )
    simulate_parser.set_defaults(func=simulate_command)

    # parse 命令
    parse_parser = subparsers.add_parser("parse", help="解析ID结构")
    parse_parser.add_argument(
        "id", type=int,
        help="要解析的ID"
    )
    parse_parser.set_defaults(func=parse_id_command)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
