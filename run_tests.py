#!/usr/bin/env python3
"""离线测试入口：python run_tests.py

仅使用标准库 unittest，发现并运行 tests/ 下全部用例，返回合适的退出码。
请在仓库根目录（本文件所在目录）运行。
"""

import os
import sys
import unittest

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    loader = unittest.TestLoader()
    suite = loader.discover(
        start_dir=os.path.join(here, "tests"),
        pattern="test_*.py",
        top_level_dir=here,
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
