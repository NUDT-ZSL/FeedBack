#!/usr/bin/env python3
"""因果一致性快照与部分回放引擎的命令行入口。

用法（从标准输入逐行读 JSON 命令）::

    python main.py < commands.txt

或交互式运行::

    python main.py
    > {"cmd": "register", "process_id": "p1"}
    > {"cmd": "append", "event": {...}}

每行输出一条 JSON 结果，出错时响应含 ``error`` 字段。
详见 README 与 :mod:`causal_engine.cli`。
"""

from __future__ import annotations

from causal_engine.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
