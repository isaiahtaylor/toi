"""Write the output files atomically (every file is written to a temporary name first)."""
import csv
import io
import json
import os
from pathlib import Path

from .history import HEADER as HISTORY_HEADER, format_row
from .report import OBJECT_COLUMNS, object_rows


def _json(obj):
    return json.dumps(obj, indent=1, ensure_ascii=False, allow_nan=False) + "\n"


def _csv(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def render_all(latest, buses, objs, history_rows):
    """Map of relative path -> file text."""
    month = latest["catalog_date"][:7]
    return {
        "latest.json": _json(latest),
        f"snapshots/{month}.json": _json(latest),
        "buses.json": _json(buses),
        "objects.csv": _csv(OBJECT_COLUMNS, object_rows(objs)),
        "history.csv": _csv(HISTORY_HEADER, (format_row(r) for r in history_rows)),
    }


def write_all(out_dir, files):
    out = Path(out_dir)
    staged = []
    for rel, text in files.items():
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        staged.append((tmp, path))
    for tmp, path in staged:
        os.replace(tmp, path)
    return [p for _, p in staged]
