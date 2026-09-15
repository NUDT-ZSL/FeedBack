"""支持 python -m decision_ledger ... 调用 CLI。"""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
