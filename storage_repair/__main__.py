"""支持 ``python -m storage_repair`` 调用 JSONL 命令行接口。"""

from __future__ import annotations

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
