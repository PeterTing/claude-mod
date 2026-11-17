#!/usr/bin/env python3
"""crew's local web page: one server per Claude Code session, started and stopped by crew.

crew writes the configuration as one JSON line on standard input (never argv or the
environment, which other processes can list), and reads what happens as JSON lines on
standard output. Python 3.9's standard library only.

Two listeners, never on every address:
- 127.0.0.1:<port>, for this computer's browser. The link crew shows carries a one-time
  key after `#k=` (never sent in a request line, so in no log or Referer); the page trades
  it for a token crew's secret signs and keeps it in localStorage, which is this origin's
  alone (a cookie would go to every port on 127.0.0.1). A used key is replaced at once.
- <this Mac's Tailscale address>:<port>, for the person's other devices. Each peer is looked
  up with `tailscale whois`, and only the owner's own account gets in; a connection from
  this Mac's own Tailscale address, or from a loopback address, is refused, so nothing
  running here reaches the page that way.

What the page shows and what a press does are crew's: this server only checks who is
asking, passes presses on, and hands each page the last frame crew pushed for it.

The decide page (待你決定) is crew's own files in one folder crew names, served under
/decide/<cap>/ where <cap> is this server's own random value, given only in the frames of
pages that got in. It runs in a frame of the page, on the page's own origin (browsers such
as Claude Code's own refuse what an opaque-origin frame asks for), and writes what a role
wrote as text alone; a role's HTML (a mockup, a question's picture) runs only in a
sandboxed frame of its own, an opaque origin, which reaches neither page nor the token. A
decision on it goes to the page, which posts it here, and crew's answer comes back on the
same request.
"""

import hashlib
import hmac
import http.server
import json
import os
import queue
import re
import secrets
import select
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse

MAX_BODY = 64 * 1024
# What crew itself pushes (a page's whole frame, a long board drawn in full) may be larger: taken only with crew's push token.
MAX_PUSH = 8 * 1024 * 1024
MAX_KEY = 200
MAX_VALUE = 10_000
CLIENT = re.compile(r"^[A-Za-z0-9-]{8,64}$")
PRESS_ID = re.compile(r"^[A-Za-z0-9-]{1,40}$")
FRAME_MARK = re.compile(r"^[a-z0-9.]{1,40}$")
TOKEN = re.compile(r"^[0-9a-f]{32}\.[0-9a-f]{64}$")
KINDS = ("press", "submit", "select", "nav")
GO = re.compile(r"^[A-Za-z0-9_.:@~-]{1,160}$")
# What crew's decide page folder may hand out: the page, its data, a design's mockup, QA's screenshots.
DECIDE_FILE = re.compile(r"^(web\.html|data\.json|prd\.json|SCR-\d{1,6}\.json|checks/[a-z0-9][a-z0-9-]{0,80}\.(?:png|jpe?g))$")
DECIDE_TYPES = {".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
MAX_DECIDE_TEXT = 12_000
# How long a decision waits for crew's answer before the page is told crew did not answer.
DECIDE_WAIT_S = 20.0
WHOIS_TTL = 60.0
PING_S = 15.0
FRAMES_KEPT = 64

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}

HEADERS = (
    ("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("Cache-Control", "no-store"),
    ("X-Frame-Options", "DENY"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
)

out_lock = threading.Lock()


def say(event):
    """One event for crew, as one JSON line."""
    with out_lock:
        sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
        sys.stdout.flush()


class State:
    def __init__(self, cfg):
        self.lock = threading.Lock()
        secret = cfg.get("secret")
        self.fresh_secret = not (isinstance(secret, str) and re.match(r"^[0-9a-f]{64}$", secret))
        self.secret_hex = secrets.token_hex(32) if self.fresh_secret else secret
        self.secret = bytes.fromhex(self.secret_hex)
        self.push = secrets.token_hex(24)
        self.key = secrets.token_urlsafe(24)
        self.port = int(cfg["port"])
        self.dir = str(cfg["dir"])
        tailnet = cfg.get("tailnet") or None
        self.tailnet = tailnet_of(tailnet) if tailnet is not None else None
        self.tailnet_up = False
        self.clients = {}
        self.frames = {}
        self.whois = {}
        # The decide page: the folder crew names, and the part of its address only pages that got in are given.
        self.cap = secrets.token_hex(16)
        self.decide_dir = None
        # Decisions waiting for crew's answer, by the page's id for each.
        self.replies = {}

    def sign(self, sid):
        return hmac.new(self.secret, sid.encode(), hashlib.sha256).hexdigest()

    def new_token(self):
        sid = secrets.token_hex(16)
        return "%s.%s" % (sid, self.sign(sid))

    def token_ok(self, value):
        if not isinstance(value, str) or not TOKEN.match(value):
            return False
        sid, mac = value.split(".", 1)
        return hmac.compare_digest(mac, self.sign(sid))

    def take_key(self, offered):
        """The key works once: a new one is made and said, so the pane's link always opens."""
        with self.lock:
            if not isinstance(offered, str) or not hmac.compare_digest(offered.encode(), self.key.encode()):
                return None
            self.key = secrets.token_urlsafe(24)
            return self.key

    def owner_of(self, ip):
        """The Tailscale login a peer connects as, looked up once a minute at most."""
        now = time.monotonic()
        with self.lock:
            hit = self.whois.get(ip)
            if hit is not None and now - hit[1] < WHOIS_TTL:
                return hit[0]
        login = None
        try:
            done = subprocess.run([self.tailnet["cli"], "whois", "--json", ip], capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL)
            if done.returncode == 0:
                found = json.loads(done.stdout)
                login = ((found.get("UserProfile") or {}).get("LoginName")) or None
        except Exception as err:  # A whois that fails lets no one in.
            say({"t": "log", "text": "whois failed: %s" % type(err).__name__})
        with self.lock:
            self.whois[ip] = (login, now)
            if len(self.whois) > 256:
                self.whois.clear()
        return login


state = None
IPV4 = re.compile(r"^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$")


def tailnet_of(t):
    """This Mac on the tailnet, as crew read it from `tailscale status`: checked, as it names what to run."""
    if not isinstance(t, dict):
        raise ValueError("tailnet")
    ip, owner, cli = t.get("ip"), t.get("owner"), t.get("cli")
    names = t.get("names") or []
    if not isinstance(ip, str) or not IPV4.match(ip):
        raise ValueError("tailnet ip")
    if not isinstance(owner, str) or owner == "" or not isinstance(cli, str) or not os.path.isabs(cli):
        raise ValueError("tailnet owner")
    if not isinstance(names, list) or not all(isinstance(n, str) and re.match(r"^[a-z0-9.-]{1,253}$", n.lower()) for n in names):
        raise ValueError("tailnet names")
    return {"ip": ip, "names": [n.lower() for n in names], "owner": owner, "cli": cli}


class Client:
    def __init__(self, via):
        self.queue = queue.Queue(maxsize=8)
        self.via = via


def put_latest(q, item):
    """A slow page gets the newest frame, not a backlog."""
    while True:
        try:
            q.put_nowait(item)
            return
        except queue.Full:
            try:
                q.get_nowait()
            except queue.Empty:
                pass


REFUSED = """<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>crew</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/app.css"></head>
<body class="refused"><main class="cover-card"><h1>%(title)s</h1><p>%(text)s</p></main></body></html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "crew"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    mode = "local"

    def log_message(self, *args):
        pass

    def host_ok(self):
        """Only the page's own address: a name another site points here (DNS rebinding) is refused."""
        host = (self.headers.get("Host") or "").lower()
        if self.mode == "local":
            return host in ("127.0.0.1:%d" % state.port, "localhost:%d" % state.port)
        t = state.tailnet
        return host in ["%s:%d" % (n, state.port) for n in [t["ip"]] + t["names"]]

    def peer_ok(self):
        """On the tailnet: the owner's own account, from another device."""
        if self.mode == "local":
            return True
        peer = self.client_address[0]
        t = state.tailnet
        if peer == t["ip"] or peer.startswith("127.") or peer == "::1":
            return False
        return state.owner_of(peer) == t["owner"]

    def token_ok(self, offered):
        """Here, the token the key was traded for; on the tailnet the account is the check."""
        return self.mode == "tailnet" or state.token_ok(offered)

    def send(self, code, body=b"", ctype="text/plain; charset=utf-8", extra=()):
        self.send_response(code)
        for k, v in HEADERS:
            self.send_header(k, v)
        for k, v in extra:
            self.send_header(k, v)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, code, data):
        self.send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def refuse(self, code, title, text):
        page = REFUSED % {"title": title, "text": text}
        self.send(code, page.encode("utf-8"), "text/html; charset=utf-8")

    def file(self, name, ctype):
        try:
            with open(os.path.join(state.dir, name), "rb") as f:
                body = f.read()
        except OSError:
            return self.send(404, b"not found")
        self.send(200, body, ctype)

    def do_GET(self):
        if not self.host_ok():
            return self.send(421, b"wrong host")
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/favicon.svg" or url.path == "/app.css":
            name, ctype = STATIC[url.path]
            return self.file(name, ctype)
        if not self.peer_ok():
            return self.refuse(403, "沒有權限", "這個 crew 只開放給這台 Mac 主人的 Tailscale 帳號，而且要從另一台裝置連。換成主人的帳號登入 Tailscale 後，重新整理這一頁。")
        if url.path in STATIC:
            name, ctype = STATIC[url.path]
            return self.file(name, ctype)
        if url.path == "/events":
            return self.events(urllib.parse.parse_qs(url.query))
        if url.path.startswith("/decide/"):
            return self.decide_file(url.path[len("/decide/"):])
        return self.send(404, b"not found")

    def decide_file(self, rest):
        """One of the decide page's files, to the page holding this server's cap; nothing outside crew's folder."""
        cap, _, name = rest.partition("/")
        if not hmac.compare_digest(cap.encode(), state.cap.encode()):
            return self.send(404, b"not found")
        with state.lock:
            folder = state.decide_dir
        if folder is None or not DECIDE_FILE.match(name):
            return self.send(404, b"not found")
        path = os.path.realpath(os.path.join(folder, name))
        if not path.startswith(os.path.realpath(folder) + os.sep) or not os.path.isfile(path):
            return self.send(404, b"not found")
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            return self.send(404, b"not found")
        ctype = DECIDE_TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
        if name == "web.html":
            # crew's own page, on this page's origin and framed by it alone. What a role wrote in HTML (a mockup, a
            # question's picture) it shows only in a sandboxed frame of its own, which reaches neither page; the rest
            # it writes as text. Nothing it loads comes from anywhere but here.
            csp = (
                "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; "
                "font-src data:; connect-src 'self'; frame-src 'self' data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
            )
            extra = (("Content-Security-Policy", csp), ("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "no-referrer"), ("Cache-Control", "no-store"), ("Cross-Origin-Resource-Policy", "same-origin"))
        else:
            extra = (("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "no-referrer"), ("Cache-Control", "no-store"), ("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"), ("Cross-Origin-Resource-Policy", "same-origin"))
        self.send_response(200)
        for k, v in extra:
            self.send_header(k, v)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def events(self, query):
        cid = (query.get("client") or [""])[0]
        tab = (query.get("tab") or [""])[0][:40]
        # Where a press on crew's pane sent a new tab: a word of crew's, or nothing.
        go = (query.get("go") or [""])[0]
        if not GO.fullmatch(go):
            go = ""
        if not CLIENT.match(cid):
            return self.send(400, b"bad client")
        if not self.token_ok((query.get("t") or [""])[0]):
            return self.send(401, b"no")
        client = Client(self.mode)
        with state.lock:
            state.clients[cid] = client
            last = state.frames.get(cid)
        self.send_response(200)
        for k, v in HEADERS:
            self.send_header(k, v)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        say({"t": "hello", "client": cid, "tab": tab, "via": self.mode, **({"go": go} if go else {})})
        try:
            self.wfile.write(b"retry: 3000\n\n")
            if last is not None:
                self.wfile.write(b"data: " + last + b"\n\n")
            self.wfile.flush()
            idle = 0.0
            while True:
                try:
                    item = client.queue.get(timeout=1.0)
                    self.wfile.write(b"data: " + item + b"\n\n")
                    self.wfile.flush()
                    idle = 0.0
                    continue
                except queue.Empty:
                    pass
                # A page closed is seen within a second, not at the next ping: crew stops drawing for it.
                if self.gone():
                    break
                idle += 1.0
                if idle >= PING_S:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    idle = 0.0
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            # A page that came back on a new connection is already its own again: only the last one's end is said.
            with state.lock:
                gone = state.clients.get(cid) is client
                if gone:
                    del state.clients[cid]
            if gone:
                say({"t": "bye", "client": cid})
            self.close_connection = True

    def gone(self):
        """The page hung up: its side of the connection reads as ended."""
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            return bool(readable) and self.connection.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True

    def read_body(self, limit=MAX_BODY):
        """The whole body, read before anything is answered: bytes left unread would be taken for the next request on the connection."""
        self.raw = b""
        if self.headers.get("Transfer-Encoding"):
            return False
        try:
            n = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            return False
        if n < 0 or n > limit:
            return False
        if n > 0:
            self.raw = self.rfile.read(n)
        return True

    def body(self):
        if not self.raw:
            return None
        try:
            return json.loads(self.raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def same_origin(self):
        """Another site cannot post here: the page's own origin and a header a form cannot send."""
        if (self.headers.get("Origin") or "") != "http://%s" % (self.headers.get("Host") or ""):
            return False
        return self.headers.get("X-Crew") == "1" and (self.headers.get("Content-Type") or "").startswith("application/json")

    def do_POST(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path.startswith("/_crew/"):
            # crew's own: its token is checked before a body that size is read, and a refused one is not read at all.
            if self.mode != "local" or not hmac.compare_digest((self.headers.get("X-Crew-Push") or "").encode(), state.push.encode()):
                self.close_connection = True
                return self.send(403, b"no")
            if not self.read_body(MAX_PUSH):
                self.close_connection = True
                return self.send(413, b"too large")
            if not self.host_ok():
                return self.send(421, b"wrong host")
            data = self.body()
            if not isinstance(data, dict):
                return self.send(400, b"bad body")
            return self.crew(url.path, data)
        if not self.read_body():
            self.close_connection = True
            return self.send(413, b"too large")
        if not self.host_ok():
            return self.send(421, b"wrong host")
        if not self.same_origin():
            return self.send(403, b"no")
        if not self.peer_ok():
            return self.send(403, b"no")
        if url.path == "/pair":
            return self.pair()
        if url.path == "/hello":
            if not self.token_ok(self.headers.get("X-Crew-Token") or ""):
                return self.json(401, {"ok": False})
            return self.json(200, {"ok": True, "via": self.mode})
        if url.path == "/decide":
            return self.decision()
        if url.path != "/press":
            return self.send(404, b"not found")
        if not self.token_ok(self.headers.get("X-Crew-Token") or ""):
            return self.send(401, b"no")
        data = self.body()
        if not isinstance(data, dict):
            return self.send(400, b"bad body")
        cid, key, kind, value, pid, mark = data.get("client"), data.get("key"), data.get("kind"), data.get("value"), data.get("id"), data.get("frame")
        if not isinstance(cid, str) or not CLIENT.match(cid) or kind not in KINDS:
            return self.send(400, b"bad press")
        if not isinstance(key, str) or not 0 < len(key) <= MAX_KEY:
            return self.send(400, b"bad key")
        if value is not None and (not isinstance(value, str) or len(value) > MAX_VALUE):
            return self.send(400, b"bad value")
        if not isinstance(pid, str) or not PRESS_ID.match(pid):
            return self.send(400, b"bad id")
        if mark is not None and (not isinstance(mark, str) or not FRAME_MARK.match(mark)):
            return self.send(400, b"bad frame")
        with state.lock:
            known = cid in state.clients
        if not known:
            return self.send(409, b"not connected")
        event = {"t": "press", "client": cid, "key": key, "kind": kind, "id": pid, "via": self.mode}
        if value is not None:
            event["value"] = value
        if mark is not None:
            event["frame"] = mark
        say(event)
        self.send(204)

    def decision(self):
        """A decision from the decide page, through the page: crew takes it and its answer goes back on this request."""
        if not self.token_ok(self.headers.get("X-Crew-Token") or ""):
            return self.json(401, {"ok": False})
        data = self.body()
        if not isinstance(data, dict):
            return self.send(400, b"bad body")
        cid, did, text = data.get("client"), data.get("id"), data.get("text")
        if not isinstance(cid, str) or not CLIENT.match(cid):
            return self.send(400, b"bad client")
        if not isinstance(did, str) or not PRESS_ID.match(did):
            return self.send(400, b"bad id")
        if not isinstance(text, str) or not 0 < len(text) <= MAX_DECIDE_TEXT:
            return self.send(400, b"bad text")
        with state.lock:
            known = cid in state.clients
            busy = did in state.replies
            if known and not busy:
                waiting = [threading.Event(), None]
                state.replies[did] = waiting
        if not known:
            return self.json(409, {"ok": False})
        if busy:
            return self.json(409, {"ok": False})
        say({"t": "decide", "client": cid, "id": did, "text": text, "via": self.mode})
        waiting[0].wait(DECIDE_WAIT_S)
        # The reply is written under the same lock: crew's answer is either here, or crew hears 404 and tells the page another way.
        with state.lock:
            state.replies.pop(did, None)
            said = waiting[1]
        if not isinstance(said, dict):
            return self.json(504, {"ok": False})
        return self.json(200, said)

    def pair(self):
        """The one-time key from the pane's link, traded for a token this page keeps."""
        if self.mode != "local":
            return self.send(404, b"not found")
        data = self.body()
        offered = data.get("key") if isinstance(data, dict) else None
        fresh = state.take_key(offered)
        if fresh is None:
            return self.json(403, {"ok": False})
        say({"t": "key", "key": fresh})
        return self.json(200, {"ok": True, "token": state.new_token()})

    def crew(self, path, data):
        if path == "/_crew/frame":
            cid, frame = data.get("client"), data.get("frame")
            if not isinstance(cid, str) or not CLIENT.match(cid) or not isinstance(frame, dict):
                return self.send(400, b"bad frame")
            body = json.dumps(frame, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            with state.lock:
                state.frames[cid] = body
                client = state.clients.get(cid)
                if len(state.frames) > FRAMES_KEPT:
                    for old in [c for c in state.frames if c not in state.clients][:16]:
                        del state.frames[old]
            if client is not None:
                put_latest(client.queue, body)
            return self.send(204)
        if path == "/_crew/tailnet":
            return self.open_tailnet(data)
        if path == "/_crew/decide":
            folder = data.get("dir")
            if folder is not None and (not isinstance(folder, str) or not os.path.isabs(folder) or not os.path.isdir(folder)):
                return self.send(400, b"bad dir")
            with state.lock:
                state.decide_dir = folder
            return self.send(204)
        if path == "/_crew/reply":
            did, ok, text = data.get("id"), data.get("ok"), data.get("text")
            if not isinstance(did, str) or not PRESS_ID.match(did) or not isinstance(ok, bool) or not isinstance(text, str):
                return self.send(400, b"bad reply")
            said = {"ok": ok, "text": text[:MAX_DECIDE_TEXT]}
            # Taken, and still being worked on: the page says it was sent, not yet recorded.
            if ok and data.get("pending") is True:
                said["pending"] = True
            with state.lock:
                waiting = state.replies.get(did)
                if waiting is not None:
                    waiting[1] = said
            if waiting is None:
                return self.send(404, b"gone")
            waiting[0].set()
            return self.send(204)
        if path == "/_crew/clients":
            with state.lock:
                listed = [{"client": c, "via": v.via} for c, v in state.clients.items()]
            return self.json(200, listed)
        return self.send(404, b"not found")

    def open_tailnet(self, data):
        """Tailscale came up after the page did: the tailnet's listener opens now, the page's own stays as it is."""
        try:
            t = tailnet_of(data)
        except ValueError:
            return self.send(400, b"bad tailnet")
        with state.lock:
            if state.tailnet_up:
                # Listening on the address it first had: a new one is the next start's.
                same = state.tailnet is not None and state.tailnet.get("ip") == t["ip"]
                if same:
                    # The same address under a name or an account renamed since: the Host and whois checks follow it.
                    state.tailnet = t
                return self.json(200 if same else 409, {"ok": same})
            state.tailnet = t
        try:
            if answers(t["ip"], state.port):
                raise OSError(48, "Address already in use")
            srv = Server((t["ip"], state.port), Tailnet)
        except OSError as err:
            return self.json(409, {"ok": False, "detail": err.strerror or str(err)})
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        with state.lock:
            state.tailnet_up = True
        return self.json(200, {"ok": True})

    do_HEAD = do_GET


class Tailnet(Handler):
    mode = "tailnet"


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    # The port a server before this one closed is free again at once (its connections' wait would hold it half a minute):
    # a page kept open finds the same link after a reload. Another program on the port is told apart by answers() first.
    allow_reuse_address = True
    request_queue_size = 32


def answers(host, port):
    """Something already takes connections there: the port is another program's (or a server not yet gone), not this one's."""
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


def watch_parent(parent):
    """crew ends with Claude Code: once the process that started this one is gone, this one goes too."""
    while True:
        time.sleep(2)
        if os.getppid() != parent:
            os._exit(0)


def main():
    global state
    try:
        cfg = json.loads(sys.stdin.readline())
        state = State(cfg)
    except Exception as err:
        say({"t": "error", "what": "config", "detail": type(err).__name__})
        sys.exit(2)
    servers = []
    try:
        if answers("127.0.0.1", state.port):
            raise OSError(48, "Address already in use")
        servers.append(Server(("127.0.0.1", state.port), Handler))
    except OSError as err:
        say({"t": "error", "what": "bind", "port": state.port, "detail": err.strerror or str(err)})
        sys.exit(3)
    tailnet_up = False
    if state.tailnet is not None:
        try:
            if answers(state.tailnet["ip"], state.port):
                raise OSError(48, "Address already in use")
            servers.append(Server((state.tailnet["ip"], state.port), Tailnet))
            tailnet_up = True
            state.tailnet_up = True
        except OSError as err:
            say({"t": "tailnet_error", "detail": err.strerror or str(err)})
    for s in servers:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    threading.Thread(target=watch_parent, args=(os.getppid(),), daemon=True).start()
    ready = {"t": "ready", "port": state.port, "tailnet": tailnet_up, "push": state.push, "key": state.key, "cap": state.cap}
    if state.fresh_secret:
        ready["secret"] = state.secret_hex
    say(ready)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
