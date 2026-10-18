"""Readers for the CelesTrak SATCAT and GCAT files, and small parsing helpers."""
import calendar
import csv
import datetime as dt
import re

# GCAT columns the pipeline uses (object catalogs: satcat, satcat100k, tmpcat, auxcat).
GCAT_CAT_COLUMNS = (
    "JCAT", "Satcat", "Launch_Tag", "Piece", "Type", "Name", "LDate", "SDate", "DDate",
    "Status", "Primary", "Owner", "Bus", "Mass", "Length", "LFlag", "Diameter", "DFlag",
    "Span", "SpanFlag", "Shape", "ODate", "Perigee", "Apogee",
)
# Columns from the derived current catalog (latest phase of every object).
GCAT_CUR_COLUMNS = (
    "JCAT", "Satcat", "Piece", "Type", "Name", "LDate", "Owner", "SDate",
    "ExpandedStatus", "DDate", "ODate", "Perigee", "Apogee",
)

_UPDATED = re.compile(r"#\s*Updated\s+(.*\S)")
_MONTHS = {m: i for i, m in enumerate(calendar.month_abbr) if m}
_VAGUE = re.compile(r"^\s*(\d{4})(?:\s+([A-Za-z]{3}))?(?:\s+(\d{1,2}))?")


def gcat_update_stamp(path):
    """Return GCAT's own update stamp ("2026 Oct 17 1832:50") from the file header, or None."""
    with open(path, encoding="utf-8", errors="replace") as f:
        for _ in range(5):
            line = f.readline()
            if not line:
                break
            m = _UPDATED.match(line)
            if m:
                return m.group(1)
    return None


def read_gcat(path, columns=None):
    """Read a GCAT TSV file into a list of dicts with stripped string values.

    The first line is the header (prefixed with '#'); other lines starting with '#'
    are comments. Returns (rows, update_stamp).
    """
    rows = []
    updated = None
    with open(path, encoding="utf-8", errors="replace", newline="") as f:
        header = [h.strip() for h in f.readline().lstrip("#").rstrip("\r\n").split("\t")]
        if "JCAT" not in header:
            raise ValueError(f"{path}: not a GCAT table (no JCAT column)")
        wanted = [(i, h) for i, h in enumerate(header) if columns is None or h in columns]
        missing = [c for c in (columns or ()) if c not in header]
        for line in f:
            if line.startswith("#"):
                m = _UPDATED.match(line)
                if m and updated is None:
                    updated = m.group(1)
                continue
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) < 2:
                continue
            n = len(parts)
            row = {h: (parts[i].strip() if i < n else "") for i, h in wanted}
            for c in missing:
                row[c] = ""
            rows.append(row)
    return rows, updated


def read_celestrak(path):
    """Read CelesTrak's satcat.csv into a list of dicts."""
    with open(path, encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        required = {"NORAD_CAT_ID", "OBJECT_NAME", "OBJECT_ID", "OBJECT_TYPE", "DECAY_DATE",
                    "PERIGEE", "APOGEE", "ORBIT_CENTER"}
        if not required.issubset(reader.fieldnames or ()):
            raise ValueError(f"{path}: missing CelesTrak SATCAT columns")
        return [{k: (v or "").strip() for k, v in r.items() if k is not None} for r in reader]


def num(s):
    """Parse a catalog number: '' and '-' are missing; a trailing '?' flag is ignored."""
    if s is None:
        return None
    s = s.strip().rstrip("?").strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_iso_date(s):
    try:
        return dt.date.fromisoformat(s.strip()[:10]) if s and s.strip() else None
    except ValueError:
        return None


def parse_vague_date(s):
    """Parse a GCAT vague date ('2026 Oct 16 0102?', '1957 Nov?', '2026 Jul', '-').

    A missing day becomes the 15th; a missing month becomes 1 July.
    """
    if not s:
        return None
    m = _VAGUE.match(s)
    if not m:
        return None
    year = int(m.group(1))
    month = _MONTHS.get((m.group(2) or "").title())
    if month is None:
        return dt.date(year, 7, 1)
    if m.group(3) is None:
        return dt.date(year, month, 15)
    day = min(max(int(m.group(3)), 1), calendar.monthrange(year, month)[1])
    return dt.date(year, month, day)


def jcat_for_norad(norad):
    """GCAT JCAT of a US catalog number: S + at least five digits."""
    return f"S{int(norad):05d}"


_LAUNCH = re.compile(r"^(\d{4}-\d{3})")


def launch_key(cospar, launch_tag=""):
    """COSPAR launch prefix ('1998-067A' -> '1998-067'), falling back to GCAT's Launch_Tag."""
    m = _LAUNCH.match(cospar or "")
    if m:
        return m.group(1)
    m = _LAUNCH.match(launch_tag or "")
    if m:
        return m.group(1)
    return (launch_tag or "").strip() or None
