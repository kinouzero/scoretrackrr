import asyncio
import http.client
import json
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "docker" / "granboard"))
from relay import COOKIE, LIGHTS, NOTIFY, PREFIX, RelayServer, stream_board

CODE = "test_code_for_the_fake_board_only"
LIGHT = bytes([4] * 20)
DOUBLE_BULL = bytes([0x1F, 0, 220, 0, 0, 60, 255, 0, 220, 0, 2, 0, 20, 2, 0, 1])


class RelayTest(unittest.TestCase):
    def setUp(self):
        self.release = threading.Event()
        self.board_requested = threading.Event()
        self.light_received = threading.Event()
        self.frame = None

        async def simulated_board(send, heartbeat, take_light):
            self.board_requested.set()
            send({"type": "ready", "lights": True, "lightPatterns": True})
            send({"type": "hit", "sequence": 1, "frame": "3.4@"})
            send({"type": "hit", "sequence": 2, "frame": "3.4@"})
            heartbeat()
            for _ in range(200):
                if self.release.is_set():
                    break
                if (frame := take_light()) is not None:
                    self.frame = frame
                    self.light_received.set()
                await asyncio.sleep(0.01)

        self.server = RelayServer(("127.0.0.1", 0), CODE, simulated_board)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.thread.join, 5)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.release.set)

    def request(self, method, route, *, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        self.addCleanup(connection.close)
        connection.request(method, PREFIX + route, body, headers or {})
        return connection.getresponse()

    def pair(self, code=CODE, **headers):
        return self.request("POST", "session", body=json.dumps({"code": code}), headers={
            "Content-Type": "application/json",
            **headers,
        })

    def test_stream_requires_authorization_and_delivers_identical_hits_separately(self):
        status = self.request("GET", "status")
        self.assertEqual(status.status, 200)
        self.assertEqual(json.load(status), {"protocol": "granboard-v1"})
        self.assertEqual(self.request("GET", "events").status, 401)
        self.assertFalse(self.board_requested.is_set())
        response = self.pair()
        self.assertEqual(response.status, 204)
        self.assertFalse(self.board_requested.is_set())
        cookie = response.getheader("Set-Cookie")
        self.assertIn("HttpOnly; Secure; SameSite=Strict", cookie)
        self.assertIn("Path=" + PREFIX, cookie)
        token = cookie.split(";", 1)[0]
        self.assertTrue(token.startswith(COOKIE + "="))
        def light(frame=LIGHT, **headers):
            return self.request("POST", "lights", body=frame, headers={
                "Content-Type": "application/octet-stream", "Cookie": token, **headers,
            })

        self.assertEqual(light().status, 401)
        stream = self.request("GET", "events", headers={"Cookie": token})
        self.addCleanup(stream.close)
        self.assertEqual(stream.status, 200)
        self.assertEqual(stream.getheader("Content-Type"), "text/event-stream")
        self.assertEqual(stream.getheader("Cache-Control"), "no-store")
        self.assertEqual(self.pair().status, 409)
        self.assertEqual(self.request("GET", "events", headers={"Cookie": token}).status, 409)
        self.assertEqual(stream.readline().strip(), b": connecting")
        self.assertEqual(stream.readline().strip(), b"")
        for event in [
            {"type": "ready", "lights": True, "lightPatterns": True},
            {"type": "hit", "sequence": 1, "frame": "3.4@"},
            {"type": "hit", "sequence": 2, "frame": "3.4@"},
        ]:
            self.assertEqual(stream.readline().strip(), b"event: board")
            self.assertEqual(json.loads(stream.readline().removeprefix(b"data: ")), event)
            self.assertEqual(stream.readline().strip(), b"")
        self.assertEqual(stream.readline().strip(), b": heartbeat")
        self.assertTrue(self.board_requested.is_set())
        self.assertEqual(light(**{"Sec-Fetch-Site": "cross-site"}).status, 403)
        self.assertEqual(light(b"\x08" + LIGHT[1:]).status, 400)
        self.assertEqual(light(b"\x20" + DOUBLE_BULL[1:]).status, 400)
        self.assertEqual(light(Cookie="").status, 401)
        self.assertEqual(light().status, 204)
        self.assertTrue(self.light_received.wait(1))
        self.assertEqual(self.frame, LIGHT)
        self.light_received.clear()
        self.assertEqual(light(DOUBLE_BULL).status, 204)
        self.assertTrue(self.light_received.wait(1))
        self.assertEqual(self.frame, DOUBLE_BULL)
        self.release.set()
        stream.read()
        self.assertEqual(light().status, 401)
        self.assertEqual(self.request("GET", "events", headers={"Cookie": token}).status, 401)

    def test_rejects_cross_site_and_limits_failed_pairing(self):
        self.assertEqual(self.pair(**{"Sec-Fetch-Site": "cross-site"}).status, 403)
        self.assertEqual(self.pair(code="wrong").status, 403)
        self.assertEqual(self.pair().status, 429)


class BoardTransportTest(unittest.IsolatedAsyncioTestCase):
    async def test_forwards_an_impact_and_writes_the_ring_over_bluetooth(self):
        notify = SimpleNamespace(uuid=NOTIFY, properties=["notify"])
        output = SimpleNamespace(uuid=LIGHTS, properties=["write-without-response"])
        service = SimpleNamespace(characteristics=[notify, output])
        events = []
        writes = []
        subscriptions = []

        class Board:
            services = SimpleNamespace(get_service=lambda _: service)

            def __init__(self, _, disconnected_callback, timeout):
                self.disconnect = disconnected_callback

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                pass

            async def start_notify(self, characteristic, notify_hit):
                subscriptions.append(characteristic)
                notify_hit(characteristic, b"3.4@")

            async def write_gatt_char(self, characteristic, frame, *, response):
                writes.append((characteristic, frame, response))
                # Let the transport drain the recorded hit before losing the board.
                asyncio.get_running_loop().call_later(0.015, self.disconnect, None)

        def take_light():
            return LIGHT if len(events) == 2 else None

        scanner = SimpleNamespace(find_device_by_address=AsyncMock(return_value="board"))
        with patch.dict(sys.modules, {
            "bleak": SimpleNamespace(BleakClient=Board, BleakScanner=scanner),
            "bleak.exc": SimpleNamespace(BleakError=type("BleakError", (Exception,), {})),
        }):
            await asyncio.wait_for(stream_board("A", events.append, lambda: None, take_light), 1)

        self.assertEqual(subscriptions, [notify])
        self.assertEqual(events, [
            {"type": "ready", "lights": True, "lightPatterns": True},
            {"type": "hit", "sequence": 1, "frame": "3.4@"},
        ])
        self.assertEqual(writes, [(output, LIGHT, False)])


if __name__ == "__main__":
    unittest.main()
