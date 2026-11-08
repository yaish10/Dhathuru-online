#!/usr/bin/env python3
"""Local dev server for VEYORA. Sends no-store headers so the browser never shows stale files.
Usage: python3 serve.py [port] [host]   (host 0.0.0.0 = reachable from other devices on your Wi-Fi)"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
ThreadingHTTPServer((host, port), NoCache).serve_forever()
