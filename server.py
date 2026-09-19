# -*- coding: utf-8 -*-
"""Offline web UI for log-chain verification (Python stdlib only).

Usage: python server.py [logfile.jsonl] [--port 8000]
Then open http://127.0.0.1:8000/ in a browser.
"""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from logchain.adjudication import AdjudicationStore
from logchain.chain import Chain
from logchain.model import Basis, SUPPORTED_ALGORITHMS
from logchain.storage import load_jsonl, save_jsonl

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


class AppState:
    def __init__(self, logfile, adjud_path):
        self.logfile = logfile
        self.chain = Chain(load_jsonl(logfile)) if logfile else Chain([])
        self.chain.verify(full=True)
        self.adjud = AdjudicationStore(adjud_path)
        self.adjud.re_evaluate(self.chain.results)

    def after_change(self):
        """Persist logs and refresh only the adjudications affected."""
        if self.logfile:
            save_jsonl(self.logfile, self.chain.records)
        updated = self.adjud.re_evaluate(self.chain.results)
        return updated

    def payload(self):
        s = self.chain.summary()
        s["records"] = [
            dict(rec.to_dict(), result=res)
            for rec, res in zip(self.chain.records, self.chain.results)
        ]
        s["impacted_by"] = {
            str(r["index"]): self.chain.impact_of(r["index"])
            for r in self.chain.suspicious()
        }
        s["adjudications"] = {str(k): v for k, v in self.adjud.rulings.items()}
        s["algorithms"] = list(SUPPORTED_ALGORITHMS)
        return s


def make_handler(state: AppState):
    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, obj, code=200):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path == "/api/state":
                return self._send_json(state.payload())
            path = "/index.html" if self.path == "/" else self.path
            fp = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
            if not fp.startswith(STATIC_DIR) or not os.path.isfile(fp):
                return self._send_json({"error": "not found"}, 404)
            with open(fp, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            try:
                data = self._read_json()
                if self.path == "/api/verify":
                    state.chain.verify(full=True)
                    state.after_change()
                elif self.path == "/api/edit":
                    kw = {}
                    for k in ("body", "checksum"):
                        if k in data:
                            kw[k] = data[k]
                    if "new_seq" in data:
                        kw["new_seq"] = data["new_seq"]
                    if "prev_seq" in data:
                        kw["prev_seq"] = data["prev_seq"]
                    state.chain.edit_record(int(data["seq"]), **kw)
                    state.after_change()
                elif self.path == "/api/basis":
                    state.chain.set_basis(Basis(algorithm=data["algorithm"]))
                    state.after_change()
                elif self.path == "/api/adjudicate":
                    seq = int(data["seq"])
                    rec = state.chain._find(seq)
                    res = next(r for r in state.chain.results
                               if r["seq"] == seq)
                    state.adjud.rule(seq, data["verdict"],
                                     data.get("note", ""),
                                     rec.to_dict(), res["status"])
                else:
                    return self._send_json({"error": "unknown route"}, 404)
                out = state.payload()
                out["adjudications_updated"] = state.adjud.last_updated
                return self._send_json(out)
            except (KeyError, ValueError) as exc:
                return self._send_json({"error": str(exc)}, 400)

    return Handler


def main():
    p = argparse.ArgumentParser()
    p.add_argument("logfile", nargs="?", default=None)
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--adjudications", default="adjudications.json")
    args = p.parse_args()
    state = AppState(args.logfile, args.adjudications)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(state))
    print("打开 http://127.0.0.1:%d/ 查看核查界面" % args.port)
    srv.serve_forever()


if __name__ == "__main__":
    main()
