#!/usr/bin/env python3
"""Assemble the static site into dist/.

  python3 web/build.py [--data data] [--out dist] [--artifact]

- Inlines `<!--#include file.html-->` directives from web/src/.
- Replaces `{{ path.to.value | filter }}` placeholders with values from data/latest.json,
  so the key numbers are in the HTML before any script runs. Unknown paths fail the build.
  `derived.*` paths are computed here from latest.json and history.csv (see derive()).
- Copies web/assets/ to dist/assets/ and data/ to dist/data/.
- Also renders web/src/og.html to dist/og-card.html: the 1200×630 social preview card
  that web/og/render.py screenshots into data/og.png.
- Social meta tags need absolute URLs. The site URL is $SITE_URL if set, else
  https://$VERCEL_PROJECT_PRODUCTION_URL (set by Vercel at build time), else empty, and
  then the tags fall back to relative paths (fine for local builds).
- With --artifact, also writes dist/artifact.html: the same page without the
  doctype/html/head/body wrapper, for previewing as a claude.ai artifact.

Standard library only.
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import math
import os
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
    if x != x:  # NaN: a derived value the data could not supply
        return "–"
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
    "pctsig2": lambda v: f"{sig(float(v) * 100, 2)}%",         # 4.6%, 12%, 0.93% (as the hero)
    "int": lambda v: f"{int(round(float(v))):,}",
    "sci": lambda v: sci(v),
    "sci3": lambda v: sci(v, 3),
    "date_long": date_long,                                   # 18 October 2026
    "month": lambda s: f"{dt.date.fromisoformat(s[:10]):%B %Y}",  # October 2026
    "arcsec": lambda v: f"{float(v):g}″",
    "fix1": lambda v: f"{float(v):.1f}",                       # 22.9
    "fix2": lambda v: f"{float(v):.2f}",                       # 35.72
    "fix6": lambda v: f"{float(v):.6f}",                       # 0.082472
    "bytes": lambda v: human_bytes(int(v)),                    # 5.9 MB (as bytes() in method/format.js)
}


def human_bytes(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.{1 if n < 10240 else 0}f} KB"
    return f"{n / 1024 / 1024:.1f} MB"


def top_lead(latest):
    """One sentence on what leads the top-objects table, from this month's data."""
    top = latest.get("top_objects") or []
    labels = {g["id"]: g["label"] for g in latest.get("groups", [])}
    stations = {"iss", "tiangong"}
    if not top:
        return "The table ranks single objects by their absolute contribution."
    k = 0
    while k < len(top) and top[k].get("group") in stations:
        k += 1
    if k >= 2:
        s = "The two space stations lead"
    elif k == 1:
        s = f"The {labels.get(top[0]['group'], top[0]['name'])} leads"
    else:
        s = f"{top[0]['name']} leads"
        k = 1
    rest = top[k:k + 10]
    generic = {"other-payloads", "rocket-bodies", "debris"}
    if rest:
        counts = {}
        for o in rest:
            counts[o.get("group")] = counts.get(o.get("group"), 0) + 1
        g = max(counts, key=counts.get)
        if g in labels and g not in generic and counts[g] >= 3:
            mine = [o for o in top if o.get("group") == g]
            lo = min(o["alt_km"] for o in mine)
            hi = max(o["alt_km"] for o in mine)
            area = mine[0]["A_abs_m2"]
            same = all(abs(o["A_abs_m2"] - area) < 1e-6 for o in mine)
            size = f", {area:,.0f} m² each," if same else ""
            s += f", followed by {labels[g]} satellites{size} at {lo:,.0f} to {hi:,.0f} km"
    return s + "."


def site_url(env=os.environ):
    """The deployed site's origin without a trailing slash, or "" if unknown."""
    url = env.get("SITE_URL", "").strip() or env.get("VERCEL_PROJECT_PRODUCTION_URL", "").strip()
    if url and "://" not in url:
        url = "https://" + url  # Vercel gives a bare host name
    return url.rstrip("/")


def social(latest, data_dir, env=os.environ):
    """URLs for the og:/twitter: tags. The image URL carries a short hash of og.png, so
    platforms that cache previews by URL fetch the image again whenever it changes: after
    each monthly render, and after a redesign of the card in the middle of a month.
    Without og.png it falls back to the catalog date."""
    base = site_url(env)
    png = Path(data_dir) / "og.png"
    if png.is_file():
        version = hashlib.sha256(png.read_bytes()).hexdigest()[:10]
    else:
        version = latest["catalog_date"][:10]
    image = f"data/og.png?v={version}"
    return {
        "site_url": base,
        "og_url": f"{base}/" if base else "./",
        "og_image": f"{base}/{image}" if base else image,
    }


def derive(latest, data_dir):
    """Values the page shows that are not plain paths into latest.json. The front end
    computes the same numbers at run time (assets/js/method/); computing them here too
    keeps the HTML correct before any script runs."""
    toi, sums, c = latest["toi"], latest["sums"], latest["constants"]
    omega = c["omega_moon_sr"]
    half = math.radians(c["default_seeing_arcsec"] / 3600) / 2
    area = sums["fac_A_h2"] / omega
    rim = half * sums["fac_P_h"] / omega
    disc = sums["n"] * math.pi * half * half / omega
    total = area + rim + disc
    starlink = sum(g["toi_fac"] for g in latest.get("groups", []) if g.get("family") == "Starlink")
    d = {
        "starlink_share": starlink / toi["facing"],
        "debris_share": latest["counts"]["debris"] / latest["counts"]["total"],
        "app_ratio": toi["apparent"] / toi["facing"],
        "app_area": area, "app_rim": rim, "app_disc": disc,
        "app_area_share": area / total, "app_rim_share": rim / total, "app_disc_share": disc / total,
        "app_area_pct": 100 * area / total, "app_rim_pct": 100 * rim / total, "app_disc_pct": 100 * disc / total,
        # Fig. 1: disc radii against a Moon of radius 80, so area ratio = TOI.
        "r_absolute": 80 * math.sqrt(toi["absolute"]),
        "r_facing": 80 * math.sqrt(toi["facing"]),
        "r_apparent": 80 * math.sqrt(toi["apparent"]),
        "oct2024_abs": float("nan"), "oct2024_fac": float("nan"),
    }
    d["top_lead"] = top_lead(latest)
    d.update(social(latest, data_dir))
    # Published file sizes, for the Verify table and the explorer's loading note.
    for key, name in (("latest", "latest.json"), ("objects", "objects.csv"),
                      ("buses", "buses.json"), ("history", "history.csv")):
        f = data_dir / name
        d[f"size_{key}"] = f.stat().st_size if f.exists() else 0
    hist = data_dir / "history.csv"
    if hist.exists():
        with hist.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("date") == "2024-10-01" and row.get("kind") == "reconstructed":
                    d["oct2024_abs"] = float(row["toi_abs"])
                    d["oct2024_fac"] = float(row["toi_fac"])
                    break
    d["growth_abs"] = toi["absolute"] / d["oct2024_abs"] if d["oct2024_abs"] > 0 else float("nan")
    return d


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
    context = {**latest, "derived": derive(latest, data_dir)}
    html = render((SRC / "index.html").read_text(encoding="utf-8"), context, "index.html")
    card = render((SRC / "og.html").read_text(encoding="utf-8"), context, "og.html")

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ASSETS, out / "assets")
    shutil.copytree(data_dir, out / "data")
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / "og-card.html").write_text(card, encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    if args.artifact:
        (out / "artifact.html").write_text(artifact_variant(html), encoding="utf-8")
    print(f"build: wrote {out} (catalog {latest.get('catalog_date')}, fixture={latest.get('fixture')})")


if __name__ == "__main__":
    main()
