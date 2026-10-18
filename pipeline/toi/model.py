"""Population, orbits and areas of every counted object (docs/methodology.md)."""
import dataclasses
import re
import statistics
from collections import Counter, defaultdict

from .areas import fallback_area, generic_area
from .catalogs import (GCAT_CAT_COLUMNS, GCAT_CUR_COLUMNS, jcat_for_norad, launch_key, num,
                       parse_iso_date, parse_vague_date, read_celestrak, read_gcat)
from .constants import (EARTH_RADIUS_KM, GEO_ALTITUDE_KM, GEO_BAND_KM, GEO_MAX_ECCENTRICITY,
                        LEO_MAX_APOGEE_KM, MEO_MAX_ECCENTRICITY, MIN_ALTITUDE_KM, OMEGA_MOON_SR)

GCAT_IN_ORBIT = ("In Earth orbit", "Lost")              # status O and OX of the latest phase
GCAT_EARTH_END = ("Reentered Earth atmosphere", "Deorbited into Earth atmosphere",
                  "Landed on Earth", "Crashed on Earth", "Exploded")
GCAT_TYPE = {"P": "PAY", "R": "R/B", "C": "DEB", "D": "DEB"}
# Alias and tracking-artifact entries: "dup" analyst objects, mistagged or bad element sets.
ARTIFACT_NAME = re.compile(r"\bdup\b|mistag|bad tle", re.IGNORECASE)
# Latest-phase status of an object joined to another one in orbit, naming its host.
GCAT_JOINED = re.compile(r"^(?:Attached to|Docked with|Attached inside|Inside)\s+([A-Z]\d+)")
# CelesTrak names pieces it has not identified "OBJECT A", "TRANSPORTER-18 OBJECT AB", ...
UNIDENTIFIED_NAME = re.compile(r"\bOBJECT [A-Z]{1,3}$")


@dataclasses.dataclass
class Catalogs:
    celestrak: list | None        # CelesTrak SATCAT rows, or None in degraded mode
    cat: dict                     # GCAT object catalogs (satcat, satcat100k, tmpcat, auxcat) by JCAT
    cur: dict                     # GCAT currentcat by JCAT


def load_catalogs(inputs, celestrak_ok):
    cat = {}
    for sid in ("gcat-satcat", "gcat-satcat100k", "gcat-tmpcat", "gcat-auxcat"):
        rows, _ = read_gcat(inputs[sid].path, GCAT_CAT_COLUMNS)
        for r in rows:
            cat.setdefault(r["JCAT"], r)
    rows, _ = read_gcat(inputs["gcat-currentcat"].path, GCAT_CUR_COLUMNS)
    cur = {r["JCAT"]: r for r in rows}
    ct = read_celestrak(inputs["celestrak-satcat"].path) if celestrak_ok else None
    return Catalogs(celestrak=ct, cat=cat, cur=cur)


# --------------------------------------------------------------------------- helpers
def valid_orbit(peri, apo):
    return peri is not None and apo is not None and peri > 0 and apo > 0


def mean_altitude(peri, apo):
    return max((peri + apo) / 2.0, MIN_ALTITUDE_KM)


def regime(peri, apo):
    """LEO apogee <= 2000 km; GEO mean altitude within 35,786 +/- 1,000 km and e <= 0.02;
    MEO between LEO and GEO with e < 0.25; HEO everything else (eccentric or beyond GEO)."""
    if apo <= LEO_MAX_APOGEE_KM:
        return "LEO"
    h = (peri + apo) / 2.0
    ecc = (apo - peri) / (apo + peri + 2.0 * EARTH_RADIUS_KM)
    if abs(h - GEO_ALTITUDE_KM) <= GEO_BAND_KM and ecc <= GEO_MAX_ECCENTRICITY:
        return "GEO"
    if apo < GEO_ALTITUDE_KM - GEO_BAND_KM and ecc < MEO_MAX_ECCENTRICITY:
        return "MEO"
    return "HEO"


def gcat_type_code(row):
    return (row.get("Type") or "").ljust(12)


def gcat_object_type(row):
    return GCAT_TYPE.get(gcat_type_code(row)[0], "UNK")


def gcat_free_flyer_in_orbit(cur, cat):
    """GCAT object in Earth orbit (O or OX), free-flying, not an alias, placeholder or artifact."""
    if cur.get("ExpandedStatus") not in GCAT_IN_ORBIT:
        return False
    t = gcat_type_code(cur if cur.get("Type") else (cat or {}))
    if t[0] not in "PCRD":
        return False
    if t[:2] in ("PA", "CC") or t[5] == "G" or t[8] == "m":
        return False
    if ARTIFACT_NAME.search(cur.get("Name", "")):
        return False
    if cat and cat.get("Primary") and cat["Primary"] != "Earth":
        return False
    return True


def _clean(s):
    return "" if s in (None, "-") else s


def _gcat_bus(g):
    return _clean(g.get("Bus", "")) if g else ""


def _guess(g):
    return bool(g) and any("?" in (g.get(f) or "") for f in ("LFlag", "DFlag", "SpanFlag"))


def gcat_host(cur):
    """JCAT of the object this one is attached to or docked with in orbit, or None."""
    m = GCAT_JOINED.match((cur or {}).get("ExpandedStatus", ""))
    return m.group(1) if m else None


def gcat_stack_root(jcat, cur_by_jcat, limit=20):
    """Follow 'Attached to' / 'Docked with' links up to the free-flying object of the stack."""
    seen = {jcat}
    while limit:
        host = gcat_host(cur_by_jcat.get(jcat))
        if host is None or host in seen:
            return jcat
        seen.add(host)
        jcat = host
        limit -= 1
    return jcat


def gcat_left_earth_orbit(cur):
    """True when GCAT's latest phase says the object came down or left Earth orbit."""
    if not cur:
        return False
    s = cur.get("ExpandedStatus", "")
    return bool(s) and s not in GCAT_IN_ORBIT and gcat_host(cur) is None


def _start_date(cur, fallback_iso):
    """Separation date (when the object became a free object), else launch date."""
    d = parse_vague_date(cur.get("SDate", "")) if cur else None
    return d or parse_iso_date(fallback_iso)


# --------------------------------------------------------------------------- areas
def assign_area(obj, matcher):
    """Set design, group, bus, areas and the generic-only areas of one object record."""
    g = obj["gcat"]
    bus = _gcat_bus(g)
    design = matcher.match(obj["type"], obj["norad"], bus,
                           (obj["name"], g.get("Name") if g else None))
    dims = (num(g.get("Length")), num(g.get("Diameter")), num(g.get("Span")), g.get("Shape", "")) if g else None
    gen = generic_area(obj["type"], *dims) if dims else None
    if gen:
        generic = (gen[0], gen[1], gen[2], "gcat")
    else:
        generic = fallback_area(obj["type"], obj["rcs"])
    if design is not None and design.area_model == "curated":
        a_abs, a_fac, p_fac, src = design.A_abs_m2, design.A_fac_m2, design.P_fac_m, "curated"
    else:
        a_abs, a_fac, p_fac, src = generic
    obj["design"] = design
    obj["bus"] = design.id if design else bus
    if design:
        obj["group"] = design.id
    elif obj["type"] == "PAY":
        obj["group"] = "other-payloads"
    elif obj["type"] == "R/B":
        obj["group"] = "rocket-bodies"
    else:
        obj["group"] = "debris"
    obj.update(A_abs=a_abs, A_fac=a_fac, P_fac=p_fac, area_src=src,
               gen_A_abs=generic[0], gen_A_fac=generic[1], guess=_guess(g) and generic[3] == "gcat")


def set_contributions(obj):
    h_m = obj["h_km"] * 1000.0
    obj["abs_A_h2"] = obj["A_abs"] / (h_m * h_m)
    obj["fac_A_h2"] = obj["A_fac"] / (h_m * h_m)
    obj["fac_P_h"] = obj["P_fac"] / h_m
    obj["toi_abs"] = obj["abs_A_h2"] / OMEGA_MOON_SR
    obj["toi_fac"] = obj["fac_A_h2"] / OMEGA_MOON_SR


# --------------------------------------------------------------------------- records
def _record_from_celestrak(r, cats):
    norad = int(r["NORAD_CAT_ID"])
    jcat = jcat_for_norad(norad)
    g = cats.cat.get(jcat)
    c = cats.cur.get(jcat)
    return {
        "norad": norad, "jcat": jcat if (g or c) else "", "name": r["OBJECT_NAME"],
        "cospar": r["OBJECT_ID"], "type": r["OBJECT_TYPE"] or "UNK", "owner": r.get("OWNER", ""),
        "launch_date": r.get("LAUNCH_DATE", ""), "gcat": g, "cur": c, "rcs": num(r.get("RCS")),
        "lkey": launch_key(r["OBJECT_ID"], g.get("Launch_Tag") if g else ""),
        "ct_peri": num(r.get("PERIGEE")), "ct_apo": num(r.get("APOGEE")),
        "start": _start_date(c, r.get("LAUNCH_DATE", "")),
        "end": parse_iso_date(r.get("DECAY_DATE", "")),
        "from_celestrak": True,
    }


def _record_from_gcat(jcat, c, g):
    sat = (c.get("Satcat") or "").strip()
    norad = int(sat) if sat.isdigit() and jcat.startswith("S") else None
    ld = parse_vague_date(c.get("LDate", "")) or (parse_vague_date(g.get("LDate", "")) if g else None)
    return {
        "norad": norad, "jcat": jcat, "name": c.get("Name", ""), "cospar": _clean(c.get("Piece", "")),
        "type": gcat_object_type(c if c.get("Type") else (g or {})), "owner": c.get("Owner", ""),
        "launch_date": ld.isoformat() if ld else "", "gcat": g, "cur": c, "rcs": None,
        "lkey": launch_key(c.get("Piece", ""), g.get("Launch_Tag") if g else ""),
        "ct_peri": None, "ct_apo": None,
        "start": _start_date(c, ld.isoformat() if ld else ""),
        "end": parse_vague_date(_clean(c.get("DDate", ""))),
        "from_celestrak": False,
    }


def _fill_launch_mates(objs, skip_gone=False):
    """Median perigee and apogee of objects from the same launch, for objects with no orbit.

    With skip_gone, objects GCAT records as having come down or left Earth orbit get no
    launch-mate orbit (they stay without an orbit and are left out)."""
    by_launch = defaultdict(list)
    for o in objs:
        if o["orbit_src"] and o["lkey"]:
            by_launch[o["lkey"]].append((o["peri"], o["apo"]))
    for o in objs:
        if o["orbit_src"] or not o["lkey"] or o["lkey"] not in by_launch:
            continue
        if skip_gone and gcat_left_earth_orbit(o["cur"]):
            continue
        mates = by_launch[o["lkey"]]
        o["peri"] = statistics.median(p for p, _ in mates)
        o["apo"] = statistics.median(a for _, a in mates)
        o["orbit_src"] = "launch-mates"


def _current_orbit(o):
    if valid_orbit(o["ct_peri"], o["ct_apo"]):
        return o["ct_peri"], o["ct_apo"], "celestrak"
    c = o["cur"]
    if c:
        p, a = num(c.get("Perigee")), num(c.get("Apogee"))
        if valid_orbit(p, a):
            return p, a, "gcat"
    return None, None, None


def build_current(cats, matcher):
    """Objects in Earth orbit now.

    Returns (objects, no_orbit, gcat_only_count, excluded) where `excluded` maps a reason
    ("stacked", "stack_host", "tmp_unidentified") to the records left out for it.
    """
    objs = []
    excluded = {"stacked": [], "stack_host": [], "tmp_unidentified": []}
    unidentified = Counter()          # CelesTrak pieces in orbit not yet identified, by launch
    if cats.celestrak is not None:
        ct_numbers = set()
        for r in cats.celestrak:
            try:
                n = int(r["NORAD_CAT_ID"])
            except ValueError:
                continue
            ct_numbers.add(n)
            if r["DECAY_DATE"] or r["ORBIT_CENTER"] != "EA":
                continue
            rec = _record_from_celestrak(r, cats)
            objs.append(rec)
            if UNIDENTIFIED_NAME.search(r["OBJECT_NAME"]) and rec["lkey"]:
                unidentified[rec["lkey"]] += 1
    else:
        ct_numbers = None
    # A stack of joined objects counts once. Docked modules and visiting vehicles normally
    # carry their host's number in ORBIT_CENTER; GCAT also knows of dockings CelesTrak has
    # not recorded yet, and of catalogued objects riding on a host the US catalog lacks.
    ct_jcats = {o["jcat"] for o in objs if o["jcat"]}
    ct_roots = set()
    kept = []
    for o in objs:
        root = gcat_stack_root(o["jcat"], cats.cur) if o["jcat"] else o["jcat"]
        if root and root != o["jcat"]:
            if root in ct_jcats:
                excluded["stacked"].append(o)        # the counted host represents the stack
                continue
            ct_roots.add(root)                       # this object represents its host
        kept.append(o)
    objs = kept
    gcat_only = 0
    tmp = defaultdict(list)
    for jcat, c in cats.cur.items():
        g = cats.cat.get(jcat)
        if not gcat_free_flyer_in_orbit(c, g):
            continue
        letter = jcat[0]
        if letter == "S":
            if ct_numbers is not None and int(jcat[1:]) in ct_numbers:
                continue
        elif letter == "A":
            if not (c.get("Satcat") or "").startswith("NNA"):
                continue                     # shares a number with a catalogued object
        elif letter != "T":
            continue
        rec = _record_from_gcat(jcat, c, g)
        if jcat in ct_roots:
            excluded["stack_host"].append(rec)       # a catalogued object riding on it represents it
            continue
        if letter == "T" and ct_numbers is not None:
            tmp[rec["lkey"]].append(rec)
            continue
        objs.append(rec)
    # Temporary-catalog objects await a US number. When CelesTrak already carries at least as
    # many unidentified pieces from the same launch, they are most likely among those.
    for lkey, recs in tmp.items():
        if lkey and unidentified[lkey] >= len(recs):
            excluded["tmp_unidentified"].extend(recs)
        else:
            objs.extend(recs)
    for o in objs:
        o["peri"], o["apo"], o["orbit_src"] = _current_orbit(o)
    _fill_launch_mates(objs, skip_gone=True)
    counted, no_orbit = [], []
    for o in objs:
        if not o["orbit_src"]:
            no_orbit.append(o)
            continue
        o["h_km"] = mean_altitude(o["peri"], o["apo"])
        o["regime"] = regime(o["peri"], o["apo"])
        assign_area(o, matcher)
        set_contributions(o)
        counted.append(o)
        if cats.celestrak is not None and not o["from_celestrak"]:
            gcat_only += 1
    counted.sort(key=lambda o: o["toi_abs"], reverse=True)
    return counted, no_orbit, gcat_only, excluded


def build_decayed(cats, matcher):
    """Objects that were in Earth orbit and have since come down, for the reconstruction.

    Altitude: GCAT's early-operations orbit, then CelesTrak's listed orbit, then the
    median of the same launch. Returns (objects, skipped_without_orbit).
    """
    objs = []
    if cats.celestrak is not None:
        for r in cats.celestrak:
            if not r["DECAY_DATE"] or r["ORBIT_CENTER"] != "EA":
                continue
            try:
                objs.append(_record_from_celestrak(r, cats))
            except ValueError:
                continue
    else:
        for jcat, c in cats.cur.items():
            if not jcat.startswith("S") or c.get("ExpandedStatus") not in GCAT_EARTH_END:
                continue
            g = cats.cat.get(jcat)
            t = gcat_type_code(c)
            if t[0] not in "PCRD" or t[:2] in ("PA", "CC") or t[4] in "EFOPRST":
                continue
            if ARTIFACT_NAME.search(c.get("Name", "")):
                continue
            objs.append(_record_from_gcat(jcat, c, g))
    for o in objs:
        g = o["gcat"]
        p, a = (num(g.get("Perigee")), num(g.get("Apogee"))) if g else (None, None)
        if valid_orbit(p, a):
            o["peri"], o["apo"], o["orbit_src"] = p, a, "gcat"
        elif valid_orbit(o["ct_peri"], o["ct_apo"]):
            o["peri"], o["apo"], o["orbit_src"] = o["ct_peri"], o["ct_apo"], "celestrak"
        else:
            o["peri"] = o["apo"] = o["orbit_src"] = None
    _fill_launch_mates(objs)
    kept, skipped = [], 0
    for o in objs:
        if not o["orbit_src"] or o["start"] is None or o["end"] is None:
            skipped += 1
            continue
        o["h_km"] = mean_altitude(o["peri"], o["apo"])
        assign_area(o, matcher)
        kept.append(o)
    return kept, skipped


def describe_no_orbit(no_orbit, degraded=False):
    """Human-readable notes about objects left out for lack of an orbit."""
    notes = []
    listed = [o for o in no_orbit if o["from_celestrak"]]
    if listed:
        gone = sum(1 for o in listed if o["cur"] and o["cur"].get("ExpandedStatus") not in GCAT_IN_ORBIT)
        notes.append(f"{len(listed)} objects that CelesTrak lists in orbit have no orbit in CelesTrak "
                     f"or GCAT and are not counted; GCAT records {gone} of them as reentered or no "
                     "longer in Earth orbit.")
    extra = [o for o in no_orbit if not o["from_celestrak"]]
    if extra:
        launches = Counter(o["lkey"] or "unknown launch" for o in extra).most_common()
        parts = [f"{n} from launch {k}" for k, n in launches[:2]]
        rest = len(extra) - sum(n for _, n in launches[:2])
        if rest:
            parts.append(f"{rest} others")
        who = "GCAT lists" if degraded else "only GCAT lists"
        notes.append(f"{len(extra)} objects that {who} in Earth orbit have no orbit in any "
                     f"source and are not counted ({', '.join(parts)}).")
    return notes


def describe_exclusions(excluded):
    """Human-readable notes about objects left out so that nothing is counted twice."""
    notes = []
    stacked = excluded.get("stacked", [])
    if stacked:
        names = ", ".join(o["name"] for o in stacked[:3])
        more = f" and {len(stacked) - 3} others" if len(stacked) > 3 else ""
        notes.append(f"{len(stacked)} objects that GCAT records as docked with or attached to another "
                     f"counted object are counted through their host ({names}{more}).")
    hosts = excluded.get("stack_host", [])
    if hosts:
        notes.append(f"{len(hosts)} objects that only GCAT lists carry a catalogued object attached to "
                     "them and are counted through that object.")
    tmp = excluded.get("tmp_unidentified", [])
    if tmp:
        launches = sorted({o["lkey"] for o in tmp})
        notes.append(f"{len(tmp)} objects in GCAT's temporary catalog are not counted because CelesTrak "
                     f"already lists unidentified objects from the same launches ({', '.join(launches)}).")
    return notes


def review_flags(objs, threshold=0.005):
    """Maintenance hints: uncurated payload buses or launches carrying a noticeable share
    of the facing TOI, which may need a curated design in buses.toml."""
    total = sum(o["fac_A_h2"] for o in objs) or 1.0
    by_bus, by_launch = defaultdict(float), defaultdict(float)
    for o in objs:
        if o["type"] != "PAY" or o["design"] is not None:
            continue
        if o["bus"]:
            by_bus[o["bus"]] += o["fac_A_h2"]
        elif o["lkey"]:
            by_launch[o["lkey"]] += o["fac_A_h2"]
    flags = [f"uncurated bus {k!r} carries {v / total:.1%} of the facing TOI"
             for k, v in sorted(by_bus.items(), key=lambda kv: -kv[1]) if v / total >= threshold]
    flags += [f"uncurated payloads from launch {k} without a GCAT bus carry {v / total:.1%} of the facing TOI"
              for k, v in sorted(by_launch.items(), key=lambda kv: -kv[1]) if v / total >= threshold]
    return flags
