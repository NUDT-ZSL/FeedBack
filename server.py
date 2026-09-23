"""Local HTTP server for the note-threading app (stdlib only).

Run:  python server.py [port]   then open http://127.0.0.1:8000/
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from threads import ThreadStore

BASE = os.path.dirname(os.path.abspath(__file__))
STORE = ThreadStore()


def _ok(handler, payload, code=200):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(code)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _state_payload(affected=None, message=None):
    payload = STORE.to_dict()
    payload['affected'] = affected or []
    payload['problems'] = STORE.verify_consistency()
    if message:
        payload['message'] = message
    return payload


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def do_GET(self):
        if self.path == '/api/state':
            return _ok(self, _state_payload())
        if self.path == '/api/sample':
            with open(os.path.join(BASE, 'sample_notes.json'),
                      encoding='utf-8') as f:
                return _ok(self, json.load(f))
        path = 'index.html' if self.path in ('/', '/index.html') else None
        if path:
            full = os.path.join(BASE, 'static', path)
            with open(full, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return _ok(self, {'ok': False, 'error': 'not found'}, 404)

    def do_POST(self):
        try:
            data = self._body()
            if self.path == '/api/import':
                affected = STORE.import_notes(data.get('notes', []))
                return _ok(self, _state_payload(affected, 'imported'))
            if self.path == '/api/move':
                affected = STORE.move_note(data['note_id'], data['thread_id'])
                return _ok(self, _state_payload(affected, 'moved'))
            if self.path == '/api/split':
                affected = STORE.split_note(data['note_id'])
                return _ok(self, _state_payload(affected, 'split'))
            if self.path == '/api/merge':
                affected = STORE.merge_threads(data['thread_a'], data['thread_b'])
                return _ok(self, _state_payload(affected, 'merged'))
            if self.path == '/api/undo':
                affected = STORE.undo()
                if affected is None:
                    return _ok(self, {'ok': False, 'error': 'nothing to undo'}, 400)
                return _ok(self, _state_payload(affected, 'undone'))
            return _ok(self, {'ok': False, 'error': 'not found'}, 404)
        except ValueError as exc:
            return _ok(self, {'ok': False, 'error': str(exc)}, 409)
        except (KeyError, json.JSONDecodeError) as exc:
            return _ok(self, {'ok': False, 'error': 'bad request: %s' % exc}, 400)


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print('serving on http://127.0.0.1:%d/' % port)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
