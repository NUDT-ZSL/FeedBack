"""
分布式唯一ID生成器 - 雪花算法变体
支持多节点部署、时钟回拨处理、自定义序列号位数
"""
from .generator import SnowflakeIDGenerator, parse_id

__version__ = "1.0.0"
__author__ = "Claude"
__all__ = ["SnowflakeIDGenerator", "parse_id"]
