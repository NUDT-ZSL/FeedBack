# -*- coding: utf-8 -*-
"""本地离线 HTTP 服务与界面入口。

运行：python -m logchain.server [端口]   然后浏览器打开 http://127.0.0.1:8765
"""
import copy
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logchain.chain import AFFECTED, BAD_STATUS, LogChain, MISMATCH, OK, SUSPICIOUS
from logchain.store import AdjudicationStore

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(ROOT, "static")
SAMPLE_PATH = os.path.join(ROOT, "sample_logs.jsonl")


class Session(object):
    def __init__(self):
        self.chain = None
        self.store = None
        self.report = None

    def load_chain(self, chain):
        self.chain = chain
        adj_path = (chain.path or "logs") + ".adjudications.json"
        self.store = AdjudicationStore(adj_path)
        self.report = self.chain.verify_full()

    def _merged_results(self):
        results = copy.deepcopy(self.report["results"])
        for res in results:
            rec = self.chain.records[res["index"]]
            res["time"] = rec.time
            res["source"] = rec.source
            res["body"] = rec.body
            res["prev_seq"] = rec.prev_seq
            adj = self.store.get(res["seq"]) if res["seq"] is not None else None
            res["adjudication"] = adj
            if adj and adj.get("context_checksum") and \
                    adj["context_checksum"] != res["actual_checksum"]:
                res["adjudication_stale"] = True
        return results

    def state(self):
        if self.chain is None:
            return {"loaded": False}
        report = dict(self.report)
        report["results"] = self._merged_results()
        return {"loaded": True, "path": self.chain.path,
                "adjudication_path": self.store.path, "report": report}

    def record_detail(self, seq):
        chain = self.chain
        if seq not in chain.pos_by_seq:
            return None
        index = chain.pos_by_seq[seq]
        rec = chain.records[index]
        res = self.report["results"][index]
        n_after = len(chain.records) - index - 1
        if res["status"] in BAD_STATUS:
            impact = ("该记录是链条断点。由于每条记录的校验值都基于前序校验值生成，"
                      "在其得到处置前，后续 %d 条记录的可信结论都依赖于此处。"
                      % n_after)
        elif res["status"] == AFFECTED:
            impact = ("该记录本身校验通过，但受前序断点 seq=%s 影响，"
                      "其结论需等待断点处置后才能最终确认。" % res["impacted_by"])
        else:
            impact = "该记录校验通过，且不受任何前序问题影响。"
        return {
            "record": {"seq": rec.seq, "time": rec.time, "source": rec.source,
                       "body": rec.body, "prev_seq": rec.prev_seq,
                       "checksum": rec.checksum, "line_no": rec.line_no,
                       "raw": rec.raw},
            "result": res, "impact": impact,
            "adjudication": self.store.get(seq),
        }

    def update_record(self, seq, body=None, new_seq=None, checksum=None,
                      recompute=False, recompute_chain=False):
        chain = self.chain
        index = chain.update_record(seq, body=body, new_seq=new_seq,
                                    checksum=checksum, recompute=recompute,
                                    recompute_chain=recompute_chain)
        self.report = chain.verify_from(index)  # 只重算受影响区间
        if chain.path:
            chain.save()
        # 对照：从头完整校验，确认增量结论与全量一致
        clone = LogChain.from_text(
            "\n".join(r.to_json_line() for r in chain.records))
        full = clone.verify_full()
        consistent = [r for r in full["results"]] == \
            [{k: v for k, v in r.items()} for r in self.report["results"]]
        out = dict(self.report)
        out["matches_full"] = consistent
        out["results"] = self._merged_results()
        return out


SESSION = Session()


class Handler(BaseHTTPRequestHandler):
    server_version = "LogChainAudit/1.0"

    def log_message(self, *args):
        pass

    # ---- 工具 ----
    def _send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, path, content_type):
        if not os.path.isfile(path):
            self._send_json({"error": "not found"}, 404)
            return
        with open(path, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b"{}"
        return json.loads(body.decode("utf-8"))

    def _error(self, exc, status=400):
        self._send_json({"error": "%s: %s" % (type(exc).__name__, exc)}, status)

    # ---- GET ----
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        try:
            if path == "/":
                self._send_file(os.path.join(STATIC_DIR, "index.html"),
                                "text/html; charset=utf-8")
            elif path == "/static/app.js":
                self._send_file(os.path.join(STATIC_DIR, "app.js"),
                                "application/javascript; charset=utf-8")
            elif path == "/static/style.css":
                self._send_file(os.path.join(STATIC_DIR, "style.css"),
                                "text/css; charset=utf-8")
            elif path == "/api/state":
                self._send_json(SESSION.state())
            elif path == "/api/record":
                from urllib.parse import parse_qs, urlparse
                seq = int(parse_qs(urlparse(self.path).query)["seq"][0])
                detail = SESSION.record_detail(seq)
                if detail is None:
                    self._send_json({"error": "记录不存在"}, 404)
                else:
                    self._send_json(detail)
            else:
                self._send_json({"error": "not found"}, 404)
        except Exception as exc:
            self._error(exc, 500)

    # ---- POST ----
    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            req = self._read_json()
            if path == "/api/sample":
                import sample_data
                sample_data.write_sample(SAMPLE_PATH)
                SESSION.load_chain(LogChain.from_file(SAMPLE_PATH))
                self._send_json(SESSION.state())
            elif path == "/api/load":
                SESSION.load_chain(LogChain.from_file(req["path"]))
                self._send_json(SESSION.state())
            elif path == "/api/load_text":
                chain = LogChain.from_text(req.get("text", ""),
                                           path=req.get("name"))
                SESSION.load_chain(chain)
                self._send_json(SESSION.state())
            elif path == "/api/verify/full":
                SESSION.report = SESSION.chain.verify_full()
                self._send_json(SESSION.state())
            elif path == "/api/record/update":
                out = SESSION.update_record(
                    int(req["seq"]), body=req.get("body"),
                    new_seq=req.get("new_seq"), checksum=req.get("checksum"),
                    recompute=bool(req.get("recompute")),
                    recompute_chain=bool(req.get("recompute_chain")))
                self._send_json(out)
            elif path == "/api/adjudicate":
                seq = int(req["seq"])
                actual = None
                if SESSION.chain and seq in SESSION.chain.by_seq:
                    actual = SESSION.chain.by_seq[seq].checksum
                adj = SESSION.store.set(seq, req["verdict"],
                                        req.get("note", ""),
                                        context_checksum=actual)
                self._send_json({"adjudication": adj, "state": SESSION.state()})
            else:
                self._send_json({"error": "not found"}, 404)
        except Exception as exc:
            self._error(exc, 500)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("日志链核查工具已启动: http://127.0.0.1:%d" % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
