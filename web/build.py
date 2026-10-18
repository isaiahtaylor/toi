#!/usr/bin/env python3
"""Assemble the static site into dist/.

  python3 web/build.py [--data data] [--out dist] [--artifact]

- Inlines `<!--#include file.html-->` directives from web/src/.
- Replaces `{{ path.to.value | filter }}` placeholders with values from data/latest.json,
  so the key numbers are in the HTML before any script runs. Unknown paths fail the build.
- Copies web/assets/ to dist/assets/ and data/ to dist/data/.
- With --artifact, also writes dist/artifact.html: the same page without the
  doctype/html/head/body wrapper, for previewing as a claude.ai artifact.

Standard library only.
"""
import argparse
import datetime as dt
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"
ASSETS = ROOT / "web" / "assets"

INCLUDE = re.compile(r"<!--#include\s+([\w.\-/]+)\s*-->")
PLACEHOLDER = re.compile(r"\{\{\s*([\w.\[\]]+)\s*(?:\|\s*(\w+)\s*)?\}\}")
SUPERSCRIPT = str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹")


def sig(x, n):
    """Round to n significant figures and format without exponent."""
    x = float(x)
    if x == 0:
        return "0"
    from math import floor, log10
    decimals = max(0, n - 1 - floor(log10(abs(x))))
    return f"{x:.{decimals}f}"


def sci(x, n=4):
    mant, exp = f"{float(x):.{n - 1}e}".split("e")
    return f"{mant} × 10{str(int(exp)).translate(SUPERSCRIPT)}"


def date_long(s):
    d = dt.date.fromisoformat(s[:10])
    return f"{d.day} {d:%B %Y}"


FILTERS = {
    None: lambda v: str(v),
    "sig2": lambda v: sig(v, 2),
    "sig3": lambda v: sig(v, 3),
    "sig4": lambda v: sig(v, 4),
    "pct1": lambda v: f"{float(v) * 100:.1f}%",
    "pct0": lambda v: f"{float(v) * 100:.0f}%",
    "int": lambda v: f"{int(round(float(v))):,}",
    "sci": lambda v: sci(v),
    "sci3": lambda v: sci(v, 3),
    "date_long": date_long,                                   # 18 October 2026
    "month": lambda s: f"{dt.date.fromisoformat(s[:10]):%B %Y}",  # October 2026
    "arcsec": lambda v: f"{float(v):g}″",
}


def resolve(data, path):
    cur = data
    for part in re.findall(r"[^.\[\]]+", path):
        if isinstance(cur, list):
            cur = cur[int(part)]
        else:
            cur = cur[part]
    return cur


def render(template, data, origin):
    def include(m):
        return render((SRC / m.group(1)).read_text(encoding="utf-8"), data, m.group(1))

    text = INCLUDE.sub(include, template)

    def placeholder(m):
        path, filt = m.group(1), m.group(2)
        if filt not in FILTERS:
            sys.exit(f"build: unknown filter '{filt}' in {origin}")
        try:
            return FILTERS[filt](resolve(data, path))
        except (KeyError, IndexError, ValueError, TypeError) as e:
            sys.exit(f"build: cannot resolve '{{{{ {path} }}}}' in {origin}: {e!r}")

    return PLACEHOLDER.sub(placeholder, text)


def artifact_variant(html):
    """Strip the document wrapper; keep head contents (title, meta, links, styles) and body."""
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    head = re.sub(r'<meta charset="[^"]*">\s*', "", head)
    head = re.sub(r'<meta name="viewport"[^>]*>\s*', "", head)
    body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
    return head.strip() + "\n" + body.strip() + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "data"))
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--artifact", action="store_true")
    args = ap.parse_args()

    data_dir, out = Path(args.data), Path(args.out)
    latest = json.loads((data_dir / "latest.json").read_text(encoding="utf-8"))
    html = render((SRC / "index.html").read_text(encoding="utf-8"), latest, "index.html")

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ASSETS, out / "assets")
    shutil.copytree(data_dir, out / "data")
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    if args.artifact:
        (out / "artifact.html").write_text(artifact_variant(html), encoding="utf-8")
    print(f"build: wrote {out} (catalog {latest.get('catalog_date')}, fixture={latest.get('fixture')})")


if __name__ == "__main__":
    main()
