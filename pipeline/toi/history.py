"""Reconstructed monthly history, computed event by event (docs/methodology.md, History)."""
import csv
import datetime as dt
from pathlib import Path

from .constants import DEFAULT_SEEING_ARCSEC, FIRST_HISTORY_MONTH, MIN_ALTITUDE_KM, OMEGA_MOON_SR, apparent_toi

HEADER = ("date", "kind", "toi_abs", "toi_fac", "toi_app", "n_objects",
          # addition to the contract (appended): status of the run that wrote the row
          "status")


def month_starts(last_day):
    """First of each month from 1957-11-01 up to the month containing last_day."""
    y, m = FIRST_HISTORY_MONTH
    out = []
    while (y, m) <= (last_day.year, last_day.month):
        out.append(dt.date(y, m, 1))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def first_index_on_or_after(d, n_months):
    """Index of the first month start >= d, clamped to [0, n_months]."""
    y0, m0 = FIRST_HISTORY_MONTH
    i = (d.year - y0) * 12 + (d.month - m0) + (0 if d.day == 1 else 1)
    return min(max(i, 0), n_months)


def altitude_at(t, ah, start, end, h_now, h_early, survivor):
    """Altitude of a curated-design object at date t under its alt_history rule."""
    h_base = (h_now if survivor else h_early) or ah.shell_km
    if t < start + dt.timedelta(days=ah.raise_days) or (
            end is not None and t >= end - dt.timedelta(days=ah.descent_days)):
        return max(min(ah.transit_km, h_base), MIN_ALTITUDE_KM)
    if t < ah.until:
        return ah.shell_km
    target = h_now if survivor else ah.shell_km
    if t < ah.ramp_until:
        frac = (t - ah.until).days / max((ah.ramp_until - ah.until).days, 1)
        return ah.shell_km + (target - ah.shell_km) * frac
    return target


def reconstruct(current, decayed, last_day):
    """Monthly sums (abs_A_h2, fac_A_h2, fac_P_h, n) for every month start <= last_day.

    Each object adds its contribution at the first month on or after its start date and
    removes it at the first month on or after its decay date (difference arrays), so the
    cost is linear in objects plus months. Objects of a design with an alt_history rule
    are evaluated month by month over their lifetime instead.
    """
    months = month_starts(last_day)
    n = len(months)
    diff = [[0.0] * (n + 1) for _ in range(4)]
    direct = [[0.0] * n for _ in range(4)]
    for o, survivor in [(o, True) for o in current] + [(o, False) for o in decayed]:
        start = o.get("start")
        if start is None:
            continue
        end = None if survivor else o.get("end")
        i0 = first_index_on_or_after(start, n)
        i1 = first_index_on_or_after(end, n) if end else n
        if i0 >= i1:
            continue
        design = o.get("design")
        ah = design.alt_history if design is not None else None
        if ah is None:
            h_m = o["h_km"] * 1000.0
            vals = (o["A_abs"] / h_m ** 2, o["A_fac"] / h_m ** 2, o["P_fac"] / h_m, 1.0)
            for k in range(4):
                diff[k][i0] += vals[k]
                diff[k][i1] -= vals[k]
            continue
        h_now = o["h_km"] if survivor else None
        h_early = None if survivor else o["h_km"]
        for i in range(i0, i1):
            h_m = altitude_at(months[i], ah, start, end, h_now, h_early, survivor) * 1000.0
            direct[0][i] += o["A_abs"] / h_m ** 2
            direct[1][i] += o["A_fac"] / h_m ** 2
            direct[2][i] += o["P_fac"] / h_m
            direct[3][i] += 1.0
    rows = []
    run = [0.0] * 4
    for i, t in enumerate(months):
        for k in range(4):
            run[k] += diff[k][i]
        s = [run[k] + direct[k][i] for k in range(4)]
        n_obj = int(round(s[3]))
        rows.append({"date": t.isoformat(), "kind": "reconstructed",
                     "toi_abs": max(s[0], 0.0) / OMEGA_MOON_SR,
                     "toi_fac": max(s[1], 0.0) / OMEGA_MOON_SR,
                     "toi_app": apparent_toi(max(s[1], 0.0), max(s[2], 0.0), n_obj, DEFAULT_SEEING_ARCSEC),
                     "n_objects": n_obj})
    return rows


def read_existing(path):
    p = Path(path)
    if not p.exists():
        return []
    with open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def merge_history(reconstructed, existing, measured_row, status="ok"):
    """Reconstructed rows (regenerated), plus existing measured rows, plus this run's
    measured row (replacing any measured row with the same date). This run's rows carry
    `status` ("ok" or "degraded"); earlier measured rows keep the status they were written with."""
    keep = [r for r in existing if r.get("kind") == "measured" and r.get("date") != measured_row["date"]]
    rows = [dict(r, status=status) for r in reconstructed] + keep + [dict(measured_row, status=status)]
    rows.sort(key=lambda r: (r["date"], 0 if r["kind"] == "reconstructed" else 1))
    return rows


def format_row(r):
    def f(v):
        return v if isinstance(v, str) else f"{v:.6g}"
    return [r["date"], r["kind"], f(r["toi_abs"]), f(r["toi_fac"]), f(r["toi_app"]),
            str(int(float(r["n_objects"]))), r.get("status") or ""]
