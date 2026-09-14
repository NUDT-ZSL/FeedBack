"""支持 ``python -m leasekernel`` 方式运行命令行入口。"""

from .cli import main

raise SystemExit(main())
