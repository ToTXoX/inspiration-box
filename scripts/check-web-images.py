#!/usr/bin/env python3
"""Exercise the native parser against a local page with hydrated, repeated and invalid OG images."""
import http.server
import json
import pathlib
import struct
import subprocess
import threading
import zlib
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent


def png(width, height, rgb):
    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value))
    scanlines = (b'\0' + bytes(rgb) * width) * height
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scanlines)) + chunk(b'IEND', b''))


images = {'/logo.png': png(600, 315, (255, 0, 0)),
          '/photo-a.png': png(500, 700, (0, 200, 100)),
          '/same-photo.png': png(500, 700, (0, 200, 100)),
          '/photo-b.png': png(500, 800, (0, 100, 200))}
page = b'''<!doctype html><html><head><title>Hydrated image fixture</title>
<meta name="description" content="Fallback description"><meta property="og:image" content="/logo.png"></head><body>
<img src="/photo-a.png"><img src="/photo-b.png">
<script>setTimeout(() => {
for (const url of ['/photo-a.png', '/photo-a.png', '/same-photo.png', '/photo-b.png', '/invalid.png', 'file:///etc/passwd']) {
const m = document.createElement('meta'); m.setAttribute('property', 'og:image'); m.content = url; document.head.appendChild(m);
}
for (const [property, content] of [['og:title', 'Hydrated OG title'], ['og:description', 'Hydrated OG description']]) {
const m = document.createElement('meta'); m.setAttribute('property', property); m.content = content; document.head.appendChild(m);
}
}, 700);</script></body></html>'''
text_page = b'''<!doctype html><title>Document title fallback</title>
<meta property="og:title" content="   "><meta name="description" content="Text-only description">'''
requests = Counter()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        requests[self.path] += 1
        if self.path == '/redirect':
            self.send_response(302)
            self.send_header('Location', '/text-only')
            self.end_headers()
            return
        data = images.get(self.path)
        if self.path == '/':
            data, mime = page, 'text/html'
        elif self.path == '/text-only':
            data, mime = text_page, 'text/html'
        elif self.path == '/login':
            data, mime = b'<title>Login</title>', 'text/html'
        elif data:
            mime = 'image/png'
        else:
            data, mime = b'not an image', 'text/plain'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', len(data))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    run = subprocess.run([str(ROOT / 'macos/.build/release/PreviewCheck'),
                          'http://127.0.0.1:%d/' % server.server_port, '3', '--cancel-first'],
                         capture_output=True, text=True, timeout=55)
    if run.returncode:
        raise RuntimeError(run.stdout + run.stderr)
    result = json.loads(run.stdout)
    assert result['imageCount'] == 3, result
    assert [(i['imageWidth'], i['imageHeight']) for i in result['images']] == [(500, 700), (500, 800), (600, 315)], result
    assert result['defaultIsFirst'] is True, result
    assert result['cancellationCount'] == 1, result
    assert result['warning'], result  # Invalid image is reported without discarding good candidates.
    assert result['title'] == 'Hydrated OG title', result
    assert result['description'] == 'Hydrated OG description', result
    print('PASS: pending request cancellation/replacement, delayed OG metadata, relative URLs, URL/content deduplication, body-image priority, local files and partial failures')

    run = subprocess.run([str(ROOT / 'macos/.build/release/PreviewCheck'),
                          'http://127.0.0.1:%d/redirect' % server.server_port, '0'],
                         capture_output=True, text=True, timeout=55)
    if run.returncode:
        raise RuntimeError(run.stdout + run.stderr)
    result = json.loads(run.stdout)
    assert result['title'] == 'Document title fallback', result
    assert result['description'] == 'Text-only description', result
    assert result['finalPath'] == '/text-only', result
    assert result['imageCount'] == 0 and result['warning'] is None, result
    assert requests['/redirect'] == 1 and requests['/text-only'] == 1, requests
    print('PASS: one page load, redirects, document-title/description fallback and no-image metadata')

    run = subprocess.run([str(ROOT / 'macos/.build/release/PreviewCheck'),
                          'http://127.0.0.1:%d/login' % server.server_port],
                         capture_output=True, text=True, timeout=55)
    assert run.returncode == 1 and '\u767b\u5f55\u6216\u9a8c\u8bc1\u9875' in run.stdout, run.stdout + run.stderr
    print('PASS: login pages do not become successful previews')
finally:
    server.shutdown()
    server.server_close()
