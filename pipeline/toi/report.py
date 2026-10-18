"""Assemble latest.json, buses.json and objects.csv rows (docs/data-contract.md)."""
import datetime as dt
import statistics
from collections import defaultdict

from .constants import (DEFAULT_SEEING_ARCSEC, GENERIC_GROUPS, MIN_ALTITUDE_KM, MOON_ANGULAR_DIAMETER_DEG,
                        MOON_DISTANCE_KM, MOON_RADIUS_KM, OMEGA_MOON_SR, SCHEMA_VERSION,
                        SUN_TRACKING_FACTOR, TOP_OBJECTS, TYPE_KEYS, apparent_toi)

OBJECT_COLUMNS = (
    "norad", "name", "cospar", "type", "owner", "launch_date", "group", "bus", "perigee_km",
    "apogee_km", "alt_km", "orbit_src", "length_m", "diameter_m", "span_m", "shape", "area_src",
    "A_abs_m2", "A_fac_m2", "P_fac_m", "toi_abs", "toi_fac",
    # additions to the contract (appended so positional readers keep working)
    "jcat", "regime",
)
AREA_SOURCES = ("curated", "gcat", "rcs", "default")
ORBIT_SOURCES = ("celestrak", "gcat", "launch-mates")
REGIMES = ("LEO", "MEO", "GEO", "HEO")


def sums_of(objs):
    s = {"n": 0, "abs_A_h2": 0.0, "fac_A_h2": 0.0, "fac_P_h": 0.0}
    for o in objs:
        s["n"] += 1
        s["abs_A_h2"] += o["abs_A_h2"]
        s["fac_A_h2"] += o["fac_A_h2"]
        s["fac_P_h"] += o["fac_P_h"]
    return s


def toi_of(s, seeing=DEFAULT_SEEING_ARCSEC):
    return {"absolute": s["abs_A_h2"] / OMEGA_MOON_SR, "facing": s["fac_A_h2"] / OMEGA_MOON_SR,
            "apparent": apparent_toi(s["fac_A_h2"], s["fac_P_h"], s["n"], seeing)}


def next_month_start(d):
    return dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def _group_entry(gid, label, family, bus_id, objs):
    s = sums_of(objs)
    t = toi_of(s)
    return {"id": gid, "label": label, "family": family, "bus_id": bus_id, "n": s["n"],
            "median_alt_km": statistics.median(o["h_km"] for o in objs) if objs else None,
            "toi_abs": t["absolute"], "toi_fac": t["facing"],
            "abs_A_h2": s["abs_A_h2"], "fac_A_h2": s["fac_A_h2"], "fac_P_h": s["fac_P_h"],
            "toi_app": t["apparent"]}


def build_groups(objs, designs):
    by_group = defaultdict(list)
    for o in objs:
        by_group[o["group"]].append(o)
    curated = [_group_entry(d.id, d.label, d.family, d.id, by_group[d.id])
               for d in designs if by_group.get(d.id)]
    curated.sort(key=lambda g: g["toi_fac"], reverse=True)
    generic = [_group_entry(gid, label, "Other", None, by_group[gid])
               for gid, label in GENERIC_GROUPS if by_group.get(gid)]
    return curated + generic


def _breakdown(objs, key, order, name):
    out = []
    for k in order:
        sel = [o for o in objs if key(o) == k]
        s = sums_of(sel)
        t = toi_of(s)
        out.append({name: k, "n": s["n"], "toi_abs": t["absolute"], "toi_fac": t["facing"],
                    "toi_app": t["apparent"], "abs_A_h2": s["abs_A_h2"],
                    "fac_A_h2": s["fac_A_h2"], "fac_P_h": s["fac_P_h"]})
    return out


def build_coverage(objs, total):
    area = []
    for src in AREA_SOURCES:
        sel = [o for o in objs if o["area_src"] == src]
        area.append({"source": src, "n": len(sel),
                     "share_abs": sum(o["abs_A_h2"] for o in sel) / total["abs_A_h2"],
                     "share_fac": sum(o["fac_A_h2"] for o in sel) / total["fac_A_h2"]})
    orbit = [{"source": src, "n": sum(1 for o in objs if o["orbit_src"] == src)} for src in ORBIT_SOURCES]
    gen_abs = gen_fac = guess_abs = 0.0
    for o in objs:
        h2 = (o["h_km"] * 1000.0) ** 2
        gen_abs += o["gen_A_abs"] / h2
        gen_fac += o["gen_A_fac"] / h2
        if o["guess"]:
            guess_abs += o["gen_A_abs"] / h2
    final_guess = sum(o["abs_A_h2"] for o in objs if o["guess"] and o["area_src"] == "gcat")
    return {
        "area_source": area,
        "orbit_source": orbit,
        "gcat_guess_share_abs": guess_abs / gen_abs if gen_abs else 0.0,
        # additions: the published TOI's share still resting on flagged GCAT guesses, and the
        # TOI the generic model alone would give (no curated designs)
        "gcat_guess_share_abs_final": final_guess / total["abs_A_h2"],
        "generic_only": {"absolute": gen_abs / OMEGA_MOON_SR, "facing": gen_fac / OMEGA_MOON_SR},
    }


def top_objects(objs, k=TOP_OBJECTS):
    out = []
    for o in sorted(objs, key=lambda o: o["toi_abs"], reverse=True)[:k]:
        out.append({"norad": o["norad"], "name": o["name"], "group": o["group"],
                    "alt_km": o["h_km"], "A_abs_m2": o["A_abs"], "A_fac_m2": o["A_fac"],
                    "toi_abs": o["toi_abs"], "toi_fac": o["toi_fac"],
                    "cospar": o["cospar"], "P_fac_m": o["P_fac"], "area_src": o["area_src"],
                    "bus": o["bus"]})
    return out


def build_latest(objs, inputs, designs, status, notes, catalog_date, generated_at):
    total = sums_of(objs)
    counts = {"total": total["n"]}
    for code, key in TYPE_KEYS.items():
        counts[key] = sum(1 for o in objs if o["type"] == code)
    other = total["n"] - sum(counts[k] for k in TYPE_KEYS.values())
    if other:
        counts["unknown"] += other
    order = ("celestrak-satcat", "gcat-satcat", "gcat-satcat100k", "gcat-tmpcat", "gcat-auxcat",
             "gcat-currentcat")
    return {
        "schema_version": SCHEMA_VERSION,
        "fixture": False,
        "generated_at": generated_at,
        "catalog_date": catalog_date.isoformat(),
        "next_update": next_month_start(catalog_date).isoformat(),
        "status": status,
        "status_notes": notes,
        "constants": {
            "moon_radius_km": MOON_RADIUS_KM,
            "moon_distance_km": MOON_DISTANCE_KM,
            "moon_angular_diameter_deg": MOON_ANGULAR_DIAMETER_DEG,
            "omega_moon_sr": OMEGA_MOON_SR,
            "default_seeing_arcsec": DEFAULT_SEEING_ARCSEC,
            "sun_tracking_factor": SUN_TRACKING_FACTOR,
            "min_altitude_km": MIN_ALTITUDE_KM,
        },
        "toi": toi_of(total),
        "sums": total,
        "counts": counts,
        "coverage": build_coverage(objs, total),
        "groups": build_groups(objs, designs),
        "by_type": _breakdown(objs, lambda o: TYPE_KEYS.get(o["type"], "unknown"),
                              tuple(TYPE_KEYS.values()), "type"),
        "by_regime": _breakdown(objs, lambda o: o["regime"], REGIMES, "regime"),
        "top_objects": top_objects(objs),
        "sources": [inputs[i].as_source_entry() for i in order if i in inputs],
        "files": {"objects_csv": "data/objects.csv", "buses_json": "data/buses.json",
                  "history_csv": "data/history.csv"},
    }


def build_buses(designs, objs):
    by_design = defaultdict(list)
    for o in objs:
        if o["design"] is not None:
            by_design[o["design"].id].append(o)
    out = []
    for d in designs:
        sel = by_design.get(d.id, [])
        s = sums_of(sel)
        a_abs, a_fac, p_fac = d.A_abs_m2, d.A_fac_m2, d.P_fac_m
        if d.area_model == "gcat" and sel:      # per-object values differ; report the median
            a_abs = statistics.median(o["A_abs"] for o in sel)
            a_fac = statistics.median(o["A_fac"] for o in sel)
            p_fac = statistics.median(o["P_fac"] for o in sel)
        entry = {
            "id": d.id, "label": d.label, "family": d.family, "confidence": d.confidence,
            "area_model": d.area_model,
            "match": {"gcat_bus": list(d.gcat_bus), "norad": list(d.norad), "name_regex": d.name_regex},
            "body": d.body, "arrays": d.arrays, "extra_area_m2": d.extra_area_m2,
            "A_abs_m2": a_abs, "A_fac_m2": a_fac, "P_fac_m": p_fac,
            "n_on_orbit": s["n"], "toi_abs": s["abs_A_h2"] / OMEGA_MOON_SR,
            "toi_fac": s["fac_A_h2"] / OMEGA_MOON_SR,
            "median_alt_km": statistics.median(o["h_km"] for o in sel) if sel else None,
            "alt_history": None if d.alt_history is None else {
                "shell_km": d.alt_history.shell_km, "until": d.alt_history.until.isoformat(),
                "ramp_until": d.alt_history.ramp_until.isoformat(),
                "raise_days": d.alt_history.raise_days, "descent_days": d.alt_history.descent_days,
                "transit_km": d.alt_history.transit_km},
            "sources": d.sources,
            "notes": d.notes,
        }
        out.append(entry)
    return out


def _g(o, field):
    g = o["gcat"]
    v = g.get(field, "") if g else ""
    return "" if v == "-" else v


def _f(v, fmt="{:.6g}"):
    return "" if v is None else fmt.format(v)


def object_rows(objs):
    for o in objs:
        yield [
            "" if o["norad"] is None else str(o["norad"]), o["name"], o["cospar"], o["type"],
            o["owner"], o["launch_date"], o["group"], o["bus"], _f(o["peri"], "{:.10g}"),
            _f(o["apo"], "{:.10g}"), _f(o["h_km"], "{:.10g}"), o["orbit_src"], _g(o, "Length"),
            _g(o, "Diameter"), _g(o, "Span"), _g(o, "Shape"), o["area_src"], _f(o["A_abs"]),
            _f(o["A_fac"]), _f(o["P_fac"]), _f(o["toi_abs"]), _f(o["toi_fac"]), o["jcat"], o["regime"],
        ]
