#!/usr/bin/env python3
"""NOC Check-in — static file server"""
import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silence logs

if __name__ == '__main__':
    port = 8080
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f'  Serving at http://0.0.0.0:{port}')
    print(f'  Open http://127.0.0.1:{port}')
    server.serve_forever()
