"""支持 ``python -m resource_kernel`` 启动行式 JSON 命令行。"""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
