"""Serve only the compiled static files for production browser tests."""

from functools import partial
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class StaticTestServer(ThreadingHTTPServer):
    # Parallel browsers precache many assets at once.
    request_queue_size = 128


worker_versions = {}


class StaticHandler(SimpleHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        # Keep failed requests visible without logging every precached asset.
        if code not in (200, 304):
            super().log_request(code, size)

    def do_POST(self):
        if urlsplit(self.path).path != "/__test__/pwa-version":
            self.send_error(404)
            return
        size = int(self.headers.get("Content-Length", "0"))
        if size < 1 or size > 1024:
            self.send_error(400)
            return
        try:
            data = json.loads(self.rfile.read(size))
            key, version = data["id"], data["version"]
            if not all(isinstance(value, str) and re.fullmatch(r"[a-z0-9-]{1,80}", value) for value in [key, version]):
                raise ValueError("Invalid fixture")
        except (ValueError, KeyError, TypeError):
            self.send_error(400)
            return
        if len(worker_versions) >= 128:
            worker_versions.pop(next(iter(worker_versions)))
        worker_versions[key] = version
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        # Isolated browser contexts exercise the real compiled worker lifecycle.
        key = parse_qs(urlsplit(self.path).query).get("test-worker", [""])[0]
        fixture = worker_versions.get(key)
        if (
            urlsplit(self.path).path == "/service-worker.js"
            and fixture
            and re.fullmatch(r"[a-z0-9-]{1,80}", fixture)
        ):
            version = json.loads(Path("build/_app/version.json").read_text())["version"]
            script = Path("build/service-worker.js").read_text()
            script = script.replace(version, f"{version}-test-{fixture}")
            if fixture.endswith("-broken"):
                script = script.replace("_app/immutable/entry/app.", "__missing-update__/app.")
            body = script.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def send_head(self):
        if self.headers.get("X-Scoretrackrr-Test-Offline") == "1":
            self.send_error(503, "HTTP disabled for cached PWA tests")
            return None
        return super().send_head()


handler = partial(StaticHandler, directory="build")
StaticTestServer(("127.0.0.1", 4178), handler).serve_forever()
