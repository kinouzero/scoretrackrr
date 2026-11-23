"""Forward live GranBoard notifications to a single authorized browser."""

import asyncio
import hmac
import json
import os
import re
import secrets
import threading
import time
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVICE = "442f1570-8a00-9a28-cbe1-e1d4212d53eb"
NOTIFY = "442f1571-8a00-9a28-cbe1-e1d4212d53eb"
LIGHTS = "442f1572-8a00-9a28-cbe1-e1d4212d53eb"
PREFIX = "/api/granboard/"
COOKIE = "scoretrackrr_granboard"


def valid_light_frame(frame):
    if len(frame) == 20:
        return all(color <= 7 for color in frame)
    if len(frame) != 16 or frame[12] > 35 or frame[15] != 1:
        return False
    if frame[0] == 0x1F:
        return frame[10:12] == b"\x02\x00" and frame[13:15] == b"\x02\x00"
    return (
        frame[0] in (0x14, 0x15)
        and frame[4] == (0x7D if frame[0] == 0x14 else 0)
        and not any(frame[5:12]) and frame[13:15] == b"\x00\x00"
    )


class Sessions:
    def __init__(self, code):
        self.code = code.encode()
        self.lock = threading.Lock()
        self.pending = None
        self.active = None
        self.lights_enabled = False
        self.light = None
        self.next_attempt = 0

    def pair(self, code):
        with self.lock:
            now = time.monotonic()
            if now < self.next_attempt:
                return 429, None
            if not hmac.compare_digest(code.encode(), self.code):
                self.next_attempt = now + 1
                return 403, None
            if self.active:
                return 409, None
            token = secrets.token_urlsafe(32)
            self.pending = (token, now + 20)
            return 204, token

    def claim(self, token):
        with self.lock:
            if self.active:
                return 409
            if not self.pending:
                return 401
            expected, expires = self.pending
            if time.monotonic() >= expires or not hmac.compare_digest(token, expected):
                return 401
            self.pending = None
            self.active = token
            return 200

    def enable_lights(self):
        with self.lock:
            self.lights_enabled = True

    def set_light(self, token, frame):
        with self.lock:
            if not self.active or not hmac.compare_digest(token, self.active):
                return 401
            if not self.lights_enabled:
                return 409
            self.light = frame
            return 204

    def take_light(self):
        with self.lock:
            frame, self.light = self.light, None
            return frame

    def release(self):
        with self.lock:
            self.active = None
            self.lights_enabled = False
            self.light = None


async def stream_board(address, send, heartbeat, take_light):
    from bleak import BleakClient, BleakScanner
    from bleak.exc import BleakError

    queue = asyncio.Queue(maxsize=16)
    failed = asyncio.Event()

    def notify(_, data):
        if not 1 <= len(data) <= 5:
            return
        try:
            frame = data.decode("ascii")
        except UnicodeDecodeError:
            return
        try:
            queue.put_nowait(frame)
        except asyncio.QueueFull:
            failed.set()

    async with asyncio.timeout(15):
        device = await BleakScanner.find_device_by_address(address, timeout=8)
        if device is None:
            raise RuntimeError("Board not found")

    def disconnected(_):
        failed.set()

    async with BleakClient(device, disconnected_callback=disconnected, timeout=8) as board:
        service = board.services.get_service(SERVICE)
        notifications = [
            item for item in service.characteristics if "notify" in item.properties
        ] if service else []
        fallback = notifications[0] if len(notifications) == 1 else None
        characteristic = next((item for item in notifications if item.uuid == NOTIFY), fallback)
        if not characteristic:
            raise RuntimeError("Board notification characteristic not found")
        async with asyncio.timeout(5):
            await board.start_notify(characteristic, notify)
        # Keep the connection alive only while the browser consumes this stream.
        output = next((item for item in service.characteristics if item.uuid == LIGHTS), None)
        properties = output.properties if output else []
        lights = "write-without-response" in properties or "write" in properties
        send({"type": "ready", "lights": True, "lightPatterns": True} if lights else {"type": "ready"})
        sequence = 0
        next_heartbeat = time.monotonic() + 3
        while not failed.is_set():
            if lights and (light := take_light()) is not None:
                try:
                    async with asyncio.timeout(1):
                        await board.write_gatt_char(
                            output, light, response="write-without-response" not in properties
                        )
                except (BleakError, OSError, TimeoutError):
                    # A failed ring animation must not interrupt scoring.
                    pass
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=0.1 if lights else 3)
            except TimeoutError:
                if time.monotonic() >= next_heartbeat:
                    heartbeat()
                    next_heartbeat = time.monotonic() + 3
                continue
            if not failed.is_set():
                sequence += 1
                send({"type": "hit", "sequence": sequence, "frame": frame})
                next_heartbeat = time.monotonic() + 3


class RelayServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, code, transport):
        super().__init__(address, RelayHandler)
        self.sessions = Sessions(code)
        self.transport = transport
        self.slots = threading.BoundedSemaphore(8)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class RelayHandler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def log_message(self, *_):
        # The reverse proxy handles access logs. Never log cookies or request bodies.
        pass

    def respond(self, status, body=b"", cookie=None):
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_POST(self):
        if self.path not in (PREFIX + "session", PREFIX + "lights"):
            self.respond(404)
            return
        if self.headers.get("Sec-Fetch-Site") not in (None, "same-origin"):
            self.respond(403)
            return
        if self.path == PREFIX + "lights":
            self.write_lights()
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 1 <= size <= 512 or self.headers.get_content_type() != "application/json":
                raise ValueError
            payload = json.loads(self.rfile.read(size))
            code = payload.get("code") if isinstance(payload, dict) else None
            if not isinstance(code, str) or len(code) > 128:
                raise ValueError
            code.encode("ascii")
        except (ValueError, TimeoutError):
            self.respond(400)
            return
        status, token = self.server.sessions.pair(code)
        cookie = (
            f"{COOKIE}={token}; Path={PREFIX}; HttpOnly; Secure; SameSite=Strict"
            if token else None
        )
        self.respond(status, cookie=cookie)

    def session_token(self):
        try:
            token = SimpleCookie(self.headers.get("Cookie"))[COOKIE].value
        except (CookieError, KeyError):
            return None
        return token if re.fullmatch(r"[A-Za-z0-9_-]{43}", token) else None

    def write_lights(self):
        token = self.session_token()
        if token is None:
            self.respond(401)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size not in (16, 20) or self.headers.get_content_type() != "application/octet-stream":
                raise ValueError
            frame = self.rfile.read(size)
            if len(frame) != size or not valid_light_frame(frame):
                raise ValueError
        except (ValueError, TimeoutError):
            self.respond(400)
            return
        self.respond(self.server.sessions.set_light(token, frame))

    def do_GET(self):
        if self.path == PREFIX + "status":
            self.respond(200, b'{"protocol":"granboard-v1"}')
            return
        if self.path != PREFIX + "events":
            self.respond(404)
            return
        token = self.session_token()
        if token is None:
            self.respond(401)
            return
        status = self.server.sessions.claim(token)
        if status != 200:
            self.respond(status)
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.wfile.write(b": connecting\n\n")
            asyncio.run(self.server.transport(self.send_event, self.heartbeat, self.server.sessions.take_light))
        except OSError:
            pass
        except Exception as error:
            print(f"GranBoard disconnected: {type(error).__name__}", flush=True)
        finally:
            self.server.sessions.release()

    def send_event(self, event):
        if event.get("type") == "ready" and event.get("lights") is True:
            self.server.sessions.enable_lights()
        self.wfile.write(f"event: board\ndata: {json.dumps(event)}\n\n".encode())

    def heartbeat(self):
        self.wfile.write(b": heartbeat\n\n")


def main():
    address = os.environ.get("GRANBOARD_ADDRESS", "")
    if not re.fullmatch(r"(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}", address):
        raise SystemExit("Set GRANBOARD_ADDRESS to the board's Bluetooth address.")
    code = os.environ.get("GRANBOARD_PAIRING_CODE", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", code):
        raise SystemExit("Set GRANBOARD_PAIRING_CODE to a random 32–128 character URL-safe code.")

    async def transport(send, heartbeat, take_light):
        await stream_board(address, send, heartbeat, take_light)

    with RelayServer(("0.0.0.0", 8081), code, transport) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
