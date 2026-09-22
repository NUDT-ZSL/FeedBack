from __future__ import annotations

import argparse

from .app import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="本地素材任务生产队列")
    parser.add_argument("--manifest", default="examples/queue.json", help="本地素材与任务清单 JSON")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    run_server(args.manifest, args.host, args.port)


if __name__ == "__main__":
    main()
