"""Download the input catalogs once per run, politely, into a cache directory.

Policy (docs/methodology.md, pipeline/README.md):
- descriptive User-Agent, one GET per file per run, 120 s timeout;
- retry only on connection errors (at most 2 retries, with backoff), never on an HTTP
  error status;
- GCAT files are fetched first. If any GCAT file cannot be obtained the run stops
  (GcatUnavailable) and nothing is written;
- CelesTrak is fetched last. Any non-200 answer stops all CelesTrak queries for the run
  and the pipeline switches to degraded mode (GCAT-only population and orbits);
- a file fetched less than `max_age_hours` ago (its .meta.json sidecar says when) is
  reused instead of downloaded again, so a same-day rerun does not hit the servers.
"""
import dataclasses
import datetime as dt
import hashlib
import http.client
import json
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

from .catalogs import gcat_update_stamp

USER_AGENT = "TOI-tracker/1.0 (+https://github.com/isaiahtaylor/toi)"
TIMEOUT_S = 120
RETRY_DELAYS_S = (10, 30)
DEFAULT_MAX_AGE_HOURS = 20.0

GCAT_BASE = "https://planet4589.org/space/gcat/tsv/"
GCAT_PUBLISHER = "Jonathan C. McDowell, General Catalog of Artificial Space Objects"
GCAT_LICENSE = "CC-BY-4.0"


@dataclasses.dataclass(frozen=True)
class Source:
    id: str
    label: str
    filename: str
    url: str
    publisher: str
    license: str
    provider: str  # "gcat" | "celestrak"


SOURCES = (
    Source("gcat-satcat", "GCAT satcat", "gcat_satcat.tsv", GCAT_BASE + "cat/satcat.tsv",
           GCAT_PUBLISHER, GCAT_LICENSE, "gcat"),
    Source("gcat-satcat100k", "GCAT satcat100k", "gcat_satcat100k.tsv",
           GCAT_BASE + "cat/satcat100k.tsv", GCAT_PUBLISHER, GCAT_LICENSE, "gcat"),
    Source("gcat-tmpcat", "GCAT tmpcat", "gcat_tmpcat.tsv", GCAT_BASE + "cat/tmpcat.tsv",
           GCAT_PUBLISHER, GCAT_LICENSE, "gcat"),
    Source("gcat-auxcat", "GCAT auxcat", "gcat_auxcat.tsv", GCAT_BASE + "cat/auxcat.tsv",
           GCAT_PUBLISHER, GCAT_LICENSE, "gcat"),
    Source("gcat-currentcat", "GCAT currentcat", "gcat_currentcat.tsv",
           GCAT_BASE + "derived/currentcat.tsv", GCAT_PUBLISHER, GCAT_LICENSE, "gcat"),
    Source("celestrak-satcat", "CelesTrak SATCAT", "celestrak_satcat.csv",
           "https://celestrak.org/pub/satcat.csv",
           "CelesTrak, from USSPACECOM data via Space-Track.org",
           "USSPACECOM basic SSA data: redistribution approved with citation", "celestrak"),
)
SOURCE_BY_ID = {s.id: s for s in SOURCES}


@dataclasses.dataclass
class InputFile:
    source: Source
    path: Path
    fetched_at: str
    bytes: int
    sha256: str
    updated: str | None
    downloaded: bool

    def as_source_entry(self):
        s = self.source
        return {"id": s.id, "label": s.label, "url": s.url, "publisher": s.publisher,
                "license": s.license, "fetched_at": self.fetched_at, "bytes": self.bytes,
                "sha256": self.sha256, "updated": self.updated}


class FetchError(Exception):
    def __init__(self, source, message, status=None):
        super().__init__(f"{source.label}: {message}")
        self.source = source
        self.status = status


class GcatUnavailable(Exception):
    pass


class NonOkStatus(Exception):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.status = status


def default_opener(url, timeout):
    """One HTTP GET. Returns (body_bytes, headers_dict). Raises on any non-200 status."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                               "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", 200)
        if status != 200:
            raise NonOkStatus(status)
        return resp.read(), {k.lower(): v for k, v in resp.headers.items()}


_CONNECTION_ERRORS = (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError,
                      http.client.IncompleteRead, http.client.RemoteDisconnected)


def get_with_retry(source, opener, sleep, delays=RETRY_DELAYS_S):
    attempt = 0
    while True:
        try:
            return opener(source.url, TIMEOUT_S)
        except urllib.error.HTTPError as e:          # an HTTP status: never retried
            raise FetchError(source, f"HTTP {e.code}", status=e.code) from e
        except NonOkStatus as e:
            raise FetchError(source, f"HTTP {e.status}", status=e.status) from e
        except _CONNECTION_ERRORS as e:
            if attempt >= len(delays):
                raise FetchError(source, f"connection failed after {attempt + 1} attempts: {e}") from e
            sleep(delays[attempt])
            attempt += 1


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _meta_path(path):
    return path.with_name(path.name + ".meta.json")


def _read_meta(path):
    try:
        return json.loads(_meta_path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _describe(source, path, downloaded):
    meta = _read_meta(path) or {}
    fetched_at = meta.get("fetched_at")
    if not fetched_at:
        fetched_at = iso(dt.datetime.fromtimestamp(os.path.getmtime(path), dt.timezone.utc))
    if source.provider == "gcat":
        updated = gcat_update_stamp(path)
    else:
        updated = meta.get("last_modified")
    return InputFile(source=source, path=path, fetched_at=fetched_at,
                     bytes=path.stat().st_size, sha256=sha256_file(path), updated=updated,
                     downloaded=downloaded)


def _fresh(path, max_age_hours, now):
    meta = _read_meta(path)
    if not path.exists() or not meta or not meta.get("fetched_at"):
        return False
    try:
        t = dt.datetime.strptime(meta["fetched_at"], "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=dt.timezone.utc)
    except ValueError:
        return False
    return (now - t).total_seconds() < max_age_hours * 3600 and path.stat().st_size == meta.get("bytes")


CELESTRAK_REQUIRED = ("NORAD_CAT_ID", "OBJECT_NAME", "OBJECT_ID", "OBJECT_TYPE", "DECAY_DATE",
                      "PERIGEE", "APOGEE", "ORBIT_CENTER")


def check_content(source, path):
    """Raise FetchError unless the file looks like the expected table with at least one row
    (an HTML error page or an empty file served with status 200 must not pass)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            header = f.readline()
            rows = sum(1 for line in f if line.strip() and not line.startswith("#"))
    except OSError as e:
        raise FetchError(source, f"cannot read {path.name}: {e}") from e
    if source.provider == "gcat":
        cols = [c.strip() for c in header.lstrip("#").split("\t")]
        ok = header.startswith("#") and "JCAT" in cols
    else:
        cols = [c.strip() for c in header.split(",")]
        ok = all(c in cols for c in CELESTRAK_REQUIRED)
    if not ok:
        raise FetchError(source, f"{path.name} does not have the expected header")
    if rows == 0:
        raise FetchError(source, f"{path.name} has no data rows")


def obtain(source, cache_dir, offline, opener, sleep, max_age_hours, now=None):
    path = Path(cache_dir) / source.filename
    if offline:
        if not path.exists():
            raise FetchError(source, f"{path.name} is not in the cache for this offline run")
        check_content(source, path)
        return _describe(source, path, downloaded=False)
    now = now or utc_now()
    if _fresh(path, max_age_hours, now):
        check_content(source, path)
        return _describe(source, path, downloaded=False)
    body, headers = get_with_retry(source, opener, sleep)
    if not body:
        raise FetchError(source, "empty response")
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(body)
    try:
        check_content(source, tmp)
    except FetchError:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, path)
    meta = {"url": source.url, "fetched_at": iso(utc_now()), "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "last_modified": headers.get("last-modified")}
    _meta_path(path).write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return _describe(source, path, downloaded=True)


def fetch_all(cache_dir, offline=False, opener=None, sleep=time.sleep,
              max_age_hours=DEFAULT_MAX_AGE_HOURS, log=print):
    """Obtain every input. Returns (inputs_by_id, celestrak_ok, notes).

    Raises GcatUnavailable if any GCAT file cannot be obtained.
    """
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    opener = opener or default_opener
    inputs = {}
    for src in SOURCES:
        if src.provider != "gcat":
            continue
        try:
            inputs[src.id] = obtain(src, cache_dir, offline, opener, sleep, max_age_hours)
        except FetchError as e:
            raise GcatUnavailable(str(e)) from e
        log(f"  {src.filename}: {'downloaded' if inputs[src.id].downloaded else 'cached'}, "
            f"{inputs[src.id].bytes:,} bytes")
    notes = []
    src = SOURCE_BY_ID["celestrak-satcat"]
    try:
        inputs[src.id] = obtain(src, cache_dir, offline, opener, sleep, max_age_hours)
        log(f"  {src.filename}: {'downloaded' if inputs[src.id].downloaded else 'cached'}, "
            f"{inputs[src.id].bytes:,} bytes")
        return inputs, True, notes
    except FetchError as e:
        log(f"  {src.filename}: FAILED ({e}); degraded mode")
        why = f"HTTP {e.status}" if e.status else str(e).split(": ", 1)[-1]
        notes.append(f"CelesTrak SATCAT could not be fetched ({why}), so the population and "
                     "orbits come from GCAT alone and radar cross-sections are unavailable.")
        return inputs, False, notes
