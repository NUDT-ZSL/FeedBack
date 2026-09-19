"""Entry point: python run.py [--port 8765] [--data data.json]"""
import argparse
import os

from feedback_app.server import serve
from feedback_app.store import Store


def main():
    parser = argparse.ArgumentParser(description="Offline feedback clustering")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data.json"))
    args = parser.parse_args()
    store = Store(path=args.data)
    serve(store, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
