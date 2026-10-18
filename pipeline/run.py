"""Monthly TOI pipeline.

  python3 -m pipeline.run [--cache DIR] [--offline] [--out data] [--date YYYY-MM-DD]

Downloads (or reuses) the GCAT and CelesTrak catalogs, computes the three TOI
expressions and the reconstructed history, and writes data/latest.json, objects.csv,
buses.json, history.csv and snapshots/YYYY-MM.json. Exits with status 2 and writes
nothing if GCAT cannot be obtained. Standard library only (Python >= 3.11).
"""
import argparse
import datetime as dt
import sys
import time
from pathlib import Path

from .toi import fetch as fetch_mod
from .toi.designs import Matcher, load_designs
from .toi.history import merge_history, read_existing, reconstruct
from .toi.model import (build_current, build_decayed, describe_exclusions, describe_no_orbit,
                        load_catalogs, review_flags)
from .toi.output import render_all, write_all
from .toi.report import build_buses, build_latest

ROOT = Path(__file__).resolve().parent.parent


def parse_args(argv):
    ap = argparse.ArgumentParser(prog="python3 -m pipeline.run", description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", default=str(ROOT / ".cache" / "inputs"),
                    help="directory where downloads are stored and reused")
    ap.add_argument("--offline", action="store_true", help="never touch the network; use the cache")
    ap.add_argument("--out", default=str(ROOT / "data"), help="output directory (default: data)")
    ap.add_argument("--date", help="catalog date to record (default: the CelesTrak fetch date)")
    ap.add_argument("--buses", default=str(Path(__file__).resolve().parent / "buses.toml"))
    ap.add_argument("--max-age-hours", type=float, default=fetch_mod.DEFAULT_MAX_AGE_HOURS,
                    help="reuse cached downloads younger than this instead of fetching again")
    return ap.parse_args(argv)


COMPLETE_RATIO = 0.95


def _s_count(jcats, analyst=False):
    """Number of S-catalog identifiers; analyst objects (270000 and up) only if asked."""
    n = 0
    for j in jcats:
        if j.startswith("S") and j[1:].isdigit() and (analyst or int(j[1:]) < 270000):
            n += 1
    return n


def gcat_incomplete(cats):
    """Reason string if GCAT's object catalog and current catalog disagree in size, else None."""
    n_cat, n_cur = _s_count(cats.cat), _s_count(cats.cur)
    if min(n_cat, n_cur) < COMPLETE_RATIO * max(n_cat, n_cur):
        return f"{n_cat:,} S-catalog objects in satcat but {n_cur:,} in currentcat"
    return None


def celestrak_incomplete(cats):
    """Reason string if CelesTrak's SATCAT is much smaller than GCAT's S catalog, else None."""
    n_ct, n_s = len(cats.celestrak), _s_count(cats.cat)
    if n_ct < COMPLETE_RATIO * n_s:
        return f"{n_ct:,} rows against {n_s:,} catalogued objects in GCAT"
    return None


def run(args, opener=None, sleep=time.sleep, log=print, now=None):
    t0 = time.time()
    log("TOI pipeline: obtaining inputs")
    try:
        inputs, celestrak_ok, notes = fetch_mod.fetch_all(
            args.cache, offline=args.offline, opener=opener, sleep=sleep,
            max_age_hours=args.max_age_hours, log=log)
    except fetch_mod.GcatUnavailable as e:
        log(f"error: GCAT is unavailable ({e}). No output written; the site keeps last month's data.")
        return 2
    designs = load_designs(args.buses)
    matcher = Matcher(designs)
    cats = load_catalogs(inputs, celestrak_ok)

    # Completeness checks: a truncated download that still parses must not shrink the index.
    problem = gcat_incomplete(cats)
    if problem:
        log(f"error: GCAT looks incomplete ({problem}). No output written; the site keeps last month's data.")
        return 2
    if celestrak_ok:
        problem = celestrak_incomplete(cats)
        if problem:
            log(f"  celestrak_satcat.csv: {problem}; degraded mode")
            notes.append(f"CelesTrak SATCAT looked incomplete ({problem}), so the population and orbits "
                         "come from GCAT alone and radar cross-sections are unavailable.")
            celestrak_ok = False
            inputs.pop("celestrak-satcat", None)
            cats = load_catalogs(inputs, celestrak_ok)
    if not celestrak_ok:
        notes.append("GCAT's orbits for some recent launches are still their insertion orbits, which are "
                     "lower than the current ones, so values in this mode run high.")

    current, no_orbit, gcat_only, excluded = build_current(cats, matcher)
    decayed, skipped = build_decayed(cats, matcher)

    status = "ok" if celestrak_ok else "degraded"
    if gcat_only:
        notes.append(f"{gcat_only} objects that GCAT lists in Earth orbit but CelesTrak does not "
                     "carry are counted, with orbits from GCAT.")
    notes.extend(describe_exclusions(excluded))
    notes.extend(describe_no_orbit(no_orbit, degraded=not celestrak_ok))
    if args.date:
        catalog_date = dt.date.fromisoformat(args.date)
    else:
        primary = inputs["celestrak-satcat"] if celestrak_ok else inputs["gcat-currentcat"]
        catalog_date = dt.date.fromisoformat(primary.fetched_at[:10])
    generated = (now or fetch_mod.utc_now())
    latest = build_latest(current, inputs, designs, status, notes, catalog_date, fetch_mod.iso(generated))

    hist = reconstruct(current, decayed, catalog_date)
    measured = {"date": catalog_date.isoformat(), "kind": "measured",
                "toi_abs": latest["toi"]["absolute"], "toi_fac": latest["toi"]["facing"],
                "toi_app": latest["toi"]["apparent"], "n_objects": latest["sums"]["n"]}
    history_rows = merge_history(hist, read_existing(Path(args.out) / "history.csv"), measured, status)
    buses = build_buses(designs, current)

    written = write_all(args.out, render_all(latest, buses, current, history_rows))
    t = latest["toi"]
    log(f"catalog {catalog_date}  status {status}  objects {latest['counts']['total']:,}")
    log(f"TOI absolute {t['absolute']:.5f}  facing {t['facing']:.5f}  apparent(2\") {t['apparent']:.5f} moons")
    for g in latest["groups"][:8]:
        log(f"  {g['label']:<36} n={g['n']:>6}  abs {g['toi_abs']:.5f}  fac {g['toi_fac']:.5f}")
    log(f"history: {len(hist)} reconstructed months; {skipped} decayed objects without dates or orbit skipped")
    for n in notes:
        log(f"note: {n}")
    for flag in review_flags(current):
        log(f"review: {flag}")
    log(f"wrote {len(written)} files to {args.out} in {time.time() - t0:.1f} s")
    return 0


def main(argv=None):
    return run(parse_args(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    sys.exit(main())
