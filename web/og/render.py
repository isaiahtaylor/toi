#!/usr/bin/env python3
"""Render the social preview image (og:image) from the hero.

  python3 web/og/render.py [--dist DIR] [--data data] [--out data/og.png]
                           [--chrome PATH] [--budget MS] [--timeout S]

Builds the site into a temporary directory (or uses an existing build with --dist),
serves it from a local HTTP server on a free port, opens og-card.html in headless
Chrome and screenshots it to a 1200×630 PNG (data/og.png by default).

Chrome is --chrome, else $CHROME, else the first of google-chrome,
google-chrome-stable, chromium and chromium-browser on the PATH. The card loads its
fonts from Google Fonts, so the machine needs network access.

Headless Chrome still reserves room for browser UI it does not draw: with
--window-size=1200,630 the page gets a viewport about 87 px shorter, and the bottom of
the screenshot is left unpainted. So the window is made taller than the card, and the
PNG is cropped to the card's 1200×630, which is pinned to the top left of the page.

Before it writes anything, the renderer checks that the card reported back (fonts
loaded, scene drawn, no script errors, viewport at least the card's size) and that
the PNG is exactly 1200×630 and not near-empty. On any failure it exits non-zero and
leaves the existing image alone.

Standard library only.
"""
import argparse
import http.server
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zlib
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
W, H = 1200, 630
EXTRA_H = 240           # window height beyond the card, for the reserved browser UI
MIN_BYTES = 200_000     # the full scene is about 1 MB; a blank or text-only page is far smaller
CHROMES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
PNG_SIG = b"\x89PNG\r\n\x1a\n"


class RenderError(Exception):
    pass


def find_chrome(explicit):
    for cand in (explicit, os.environ.get("CHROME")):
        if cand:
            path = shutil.which(cand) or (cand if Path(cand).is_file() else None)
            if not path:
                raise RenderError(f"Chrome not found at {cand!r}")
            return path
    for name in CHROMES:
        path = shutil.which(name)
        if path:
            return path
    raise RenderError("no Chrome found: pass --chrome PATH or set $CHROME "
                      f"(looked for {', '.join(CHROMES)} on the PATH)")


def build_site(data_dir, out_dir):
    cmd = [sys.executable, str(ROOT / "web" / "build.py"), "--data", str(data_dir), "--out", str(out_dir)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RenderError(f"site build failed:\n{res.stdout}{res.stderr}")


class CardServer:
    """Serves the built site on 127.0.0.1 and collects the card's report."""

    def __init__(self, root):
        self.report = None
        self.failed = []
        server = self

        class Handler(http.server.SimpleHTTPRequestHandler):
            def do_POST(self):
                if self.path.split("?")[0] != "/og-ready":
                    self.send_error(404)
                    return
                n = int(self.headers.get("Content-Length") or 0)
                try:
                    server.report = json.loads(self.rfile.read(n) or b"null")
                except ValueError:
                    server.report = {"errors": ["unreadable report"]}
                self.send_response(204)
                self.end_headers()

            def log_request(self, code="-", size="-"):
                if isinstance(code, int) and code >= 400 and not self.path.startswith("/favicon"):
                    server.failed.append(f"{code} {self.path}")

            def log_message(self, *args):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(root)))
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


def screenshot(chrome, url, shot, profile, budget_ms, timeout_s):
    cmd = [
        chrome,
        "--headless",
        # The page is our own build served from localhost; root in containers needs this.
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--force-device-scale-factor=1",
        f"--user-data-dir={profile}",
        f"--window-size={W},{H + EXTRA_H}",
        # Virtual time stops while requests (fonts) are pending, so this budget is
        # script and layout time after everything has loaded.
        f"--virtual-time-budget={budget_ms}",
        f"--screenshot={shot}",
        url,
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        raise RenderError(f"Chrome did not finish within {timeout_s} s (is the network up for Google Fonts?)")
    if res.returncode != 0 or not Path(shot).is_file():
        tail = "\n".join((res.stdout + res.stderr).strip().splitlines()[-12:])
        raise RenderError(f"Chrome exited with status {res.returncode} and no screenshot:\n{tail}")


def check_report(report, failed):
    if report is None:
        raise RenderError("the card never reported ready: its script failed, or the fonts did "
                          "not load within the virtual-time budget (try a larger --budget)")
    problems = []
    vw, vh = (report.get("viewport") or [0, 0])[:2]
    if vw != W or vh < H:
        problems.append(f"Chrome's viewport was {vw}×{vh}, which does not hold the {W}×{H} card")
    if report.get("dpr") != 1:
        problems.append(f"device pixel ratio was {report.get('dpr')}, expected 1")
    if list(report.get("card") or []) != [W, H]:
        problems.append(f"the card measured {report.get('card')}, expected [{W}, {H}]")
    fonts = report.get("fonts") or {}
    missing = [name for name, ok in fonts.items() if not ok] or ([] if fonts else ["all"])
    if missing:
        problems.append(f"web fonts did not load: {', '.join(missing)}")
    if not report.get("scene") or not report.get("geometry"):
        problems.append("the canvas scene did not draw")
    problems += [f"script error: {e}" for e in report.get("errors") or []]
    problems += [f"request failed: {f}" for f in failed]
    if problems:
        raise RenderError("the card did not render cleanly:\n  " + "\n  ".join(problems))


def read_png(data):
    if data[:8] != PNG_SIG:
        raise RenderError("screenshot is not a PNG")
    chunks = []
    pos = 8
    while pos < len(data):
        (n,) = struct.unpack(">I", data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        chunks.append((kind, data[pos + 8:pos + 8 + n]))
        pos += 12 + n
        if kind == b"IEND":
            break
    if not chunks or chunks[0][0] != b"IHDR":
        raise RenderError("PNG has no IHDR chunk")
    return chunks


def ihdr(chunks):
    w, h, depth, color, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunks[0][1])
    return w, h, depth, color, interlace


def chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def crop_top(data, height):
    """Keep the top `height` rows. Each PNG row is filtered against the row above it
    only, so dropping rows from the bottom leaves the rest valid as they are."""
    chunks = read_png(data)
    w, h, depth, color, interlace = ihdr(chunks)
    if h == height:
        return data
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color)
    if depth != 8 or channels is None or interlace:
        raise RenderError(f"unexpected PNG format (depth {depth}, color type {color}, interlace {interlace})")
    if h < height:
        raise RenderError(f"screenshot is {w}×{h}, shorter than the card's {height} px")
    raw = zlib.decompress(b"".join(body for kind, body in chunks if kind == b"IDAT"))
    raw = raw[: height * (1 + w * channels)]
    head = bytearray(chunks[0][1])
    head[4:8] = struct.pack(">I", height)
    out = [PNG_SIG, chunk(b"IHDR", bytes(head))]
    out += [chunk(kind, body) for kind, body in chunks[1:] if kind not in (b"IDAT", b"IEND")]
    out += [chunk(b"IDAT", zlib.compress(raw, 9)), chunk(b"IEND", b"")]
    return b"".join(out)


def verify(png):
    w, h, *_ = ihdr(read_png(png))
    if (w, h) != (W, H):
        raise RenderError(f"image is {w}×{h}, expected {W}×{H}")
    if len(png) < MIN_BYTES:
        raise RenderError(f"image is only {len(png):,} bytes; the scene probably did not draw")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dist", help="use this existing build instead of building the site")
    ap.add_argument("--data", default=str(ROOT / "data"), help="data directory to build from")
    ap.add_argument("--out", default=str(ROOT / "data" / "og.png"), help="where to write the PNG")
    ap.add_argument("--chrome", help="Chrome or Chromium executable")
    ap.add_argument("--budget", type=int, default=6000, help="virtual-time budget in ms (default 6000)")
    ap.add_argument("--timeout", type=int, default=120, help="give up on Chrome after this many seconds")
    args = ap.parse_args()

    t0 = time.monotonic()
    out = Path(args.out)
    try:
        chrome = find_chrome(args.chrome)
        with tempfile.TemporaryDirectory(prefix="toi-og-") as tmp:
            tmp = Path(tmp)
            if args.dist:
                dist = Path(args.dist)
                if not (dist / "og-card.html").is_file():
                    raise RenderError(f"{dist} has no og-card.html; build the site first (python3 web/build.py)")
            else:
                dist = tmp / "dist"
                build_site(args.data, dist)
            shot = tmp / "shot.png"
            with CardServer(dist) as server:
                url = f"http://127.0.0.1:{server.port}/og-card.html?render"
                screenshot(chrome, url, shot, tmp / "profile", args.budget, args.timeout)
                check_report(server.report, server.failed)
            png = crop_top(shot.read_bytes(), H)
            verify(png)
            out.parent.mkdir(parents=True, exist_ok=True)
            part = out.with_name(out.name + ".part")
            part.write_bytes(png)
            os.replace(part, out)
    except RenderError as e:
        sys.exit(f"render: error: {e}")
    print(f"render: wrote {out} ({W}×{H}, {len(png):,} bytes) in {time.monotonic() - t0:.1f} s")


if __name__ == "__main__":
    main()
