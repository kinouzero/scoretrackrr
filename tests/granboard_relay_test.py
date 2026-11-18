import asyncio
import http.client
import json
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "docker" / "granboard"))
from relay import COOKIE, PREFIX, RelayServer

CODE = "test_code_for_the_fake_board_only"


class RelayTest(unittest.TestCase):
    def setUp(self):
        self.release = threading.Event()

        async def simulated_board(send, heartbeat):
            send({"type": "ready"})
            send({"type": "hit", "sequence": 1, "frame": "3.4@"})
            send({"type": "hit", "sequence": 2, "frame": "3.4@"})
            heartbeat()
            await asyncio.to_thread(self.release.wait, 2)

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
        response = self.pair()
        self.assertEqual(response.status, 204)
        cookie = response.getheader("Set-Cookie")
        self.assertIn("HttpOnly; Secure; SameSite=Strict", cookie)
        self.assertIn("Path=" + PREFIX, cookie)
        token = cookie.split(";", 1)[0]
        self.assertTrue(token.startswith(COOKIE + "="))
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
            {"type": "ready"},
            {"type": "hit", "sequence": 1, "frame": "3.4@"},
            {"type": "hit", "sequence": 2, "frame": "3.4@"},
        ]:
            self.assertEqual(stream.readline().strip(), b"event: board")
            self.assertEqual(json.loads(stream.readline().removeprefix(b"data: ")), event)
            self.assertEqual(stream.readline().strip(), b"")
        self.assertEqual(stream.readline().strip(), b": heartbeat")
        self.release.set()
        stream.read()
        self.assertEqual(self.request("GET", "events", headers={"Cookie": token}).status, 401)

    def test_rejects_cross_site_and_limits_failed_pairing(self):
        self.assertEqual(self.pair(**{"Sec-Fetch-Site": "cross-site"}).status, 403)
        self.assertEqual(self.pair(code="wrong").status, 403)
        self.assertEqual(self.pair().status, 429)


if __name__ == "__main__":
    unittest.main()
