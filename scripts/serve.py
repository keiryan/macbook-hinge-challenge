#!/usr/bin/env python3
"""Loopback demo server. Add --reader to enable the optional native bridge."""
import argparse
import hmac
import json
from pathlib import Path
import secrets
import subprocess
import threading
import socketserver
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument('--reader', type=Path)
parser.add_argument('--port', type=int, default=8768)
args = parser.parse_args()
reader = args.reader.resolve() if args.reader else None
root = Path(__file__).resolve().parent.parent / 'web'
token = secrets.token_urlsafe(32)
allowed_host = f'127.0.0.1:{args.port}'
origin = f'http://{allowed_host}'
sensor_lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code, body, mime='text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get('Host') != allowed_host:
            return self.reply(403, b'Unsupported host')
        path = urlsplit(self.path).path
        if path in ('/session', '/sensor'):
            if self.headers.get('Origin') not in (None, origin) or self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin'):
                return self.reply(403, b'Local same-origin requests only')
            if self.headers.get('X-Hinge-Client') != '1':
                return self.reply(403, b'Missing client header')
            if path == '/session':
                return self.reply(200, json.dumps({'token': token, 'nativeAvailable': reader is not None and reader.is_file()}).encode(), 'application/json')
            if not hmac.compare_digest(self.headers.get('X-Hinge-Key', ''), token):
                return self.reply(403, b'Invalid session key')
            if reader is None or not reader.is_file():
                return self.reply(503, b'Native reader is not enabled')
            if not sensor_lock.acquire(blocking=False):
                return self.reply(409, b'Native reader is already in use by another tab')
            process = None
            try:
                process = subprocess.Popen([str(reader)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-ndjson')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                for line in process.stdout:
                    self.wfile.write(line)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except OSError:
                self.close_connection = True
            finally:
                if process:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    if process.stdout:
                        process.stdout.close()
                sensor_lock.release()
            return
        files = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/hinge-challenge.js': 'hinge-challenge.js'}
        if path not in files:
            return self.reply(404, b'Not found')
        mime = 'text/javascript; charset=utf-8' if path.endswith('.js') else 'text/html; charset=utf-8'
        self.reply(200, (root / files[path]).read_bytes(), mime)

class LocalServer(ThreadingHTTPServer):
    def server_bind(self):
        # The loopback-only host is known; avoid reverse-DNS startup delays.
        socketserver.TCPServer.server_bind(self)
        self.server_name = '127.0.0.1'
        self.server_port = self.server_address[1]

server = LocalServer(('127.0.0.1', args.port), Handler)
print(f'Hinge reader available at {origin}/', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
