"""测试公共夹具。"""

import os
import sys

# 让 tests 目录在未安装包的情况下也能直接运行（python -m unittest）
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import connpool as cp


def make_kernel(start: int = 0) -> tuple[cp.PoolKernel, cp.ManualClock]:
    clock = cp.ManualClock(start)
    return cp.PoolKernel(clock), clock
