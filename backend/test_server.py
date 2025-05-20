#!/usr/bin/env python3
# Simple HTTP server for testing connectivity

from http.server import BaseHTTPRequestHandler, HTTPServer
import json

class TestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        
        response = {
            "message": "Test server is working!",
            "path": self.path
        }
        
        self.wfile.write(json.dumps(response).encode('utf-8'))

def run_server(port=9753):
    server_address = ('0.0.0.0', port)
    httpd = HTTPServer(server_address, TestHandler)
    print(f"Starting test server on http://0.0.0.0:{port}")
    httpd.serve_forever()

if __name__ == "__main__":
    run_server() 