"""Curated designs (pipeline/buses.toml): area formulas and object matching."""
import dataclasses
import datetime as dt
import re
import tomllib

from .constants import TRACKING_FACTORS

CONFIDENCE = ("published", "estimated", "assumed", "proxy")
AREA_MODELS = ("curated", "gcat")


def flat_panel_areas(a, b, n=0, length=0.0, width=0.0, tracking="sun", extra=0.0):
    """Areas of a flat-panel design: body face a x b and n arrays of length x width.

    Arrays are attached to the body's b sides. Returns (A_abs, A_fac, P_fac) where
      A_abs = a*b + n*L*w + extra
      A_fac = a*b + f*n*L*w + extra
      P_fac = 2(a + b) + n*2(L + f*w) - 2n*min(f*w, b)
    with f the orientation factor of the arrays (1/2 sun-tracking, 1 Earth-facing, 0 edge-on).
    """
    f = TRACKING_FACTORS[tracking]
    body = a * b
    arrays = n * length * width
    a_abs = body + arrays + extra
    a_fac = body + f * arrays + extra
    p_fac = 2.0 * (a + b) + n * 2.0 * (length + f * width) - 2.0 * n * min(f * width, b)
    return round(a_abs, 9), round(a_fac, 9), round(p_fac, 9)


@dataclasses.dataclass
class AltHistory:
    """Altitude rule for the reconstructed history of a curated design.

    While on station, objects fly at `shell_km` before `until`, then move linearly to
    their current altitude by `ramp_until`. Within `raise_days` after launch and
    `descent_days` before decay they are in transit at min(transit_km, own altitude).
    """
    shell_km: float
    until: dt.date
    ramp_until: dt.date
    raise_days: int = 45
    descent_days: int = 120
    transit_km: float = 350.0


@dataclasses.dataclass
class Design:
    id: str
    label: str
    family: str
    confidence: str
    area_model: str
    gcat_bus: tuple
    norad: tuple
    name_regex: str | None
    body: dict | None
    arrays: dict | None
    extra_area_m2: float
    A_abs_m2: float | None
    A_fac_m2: float | None
    P_fac_m: float | None
    direct: bool
    alt_history: AltHistory | None
    sources: list
    notes: str
    order: int
    _regex: re.Pattern | None = None

    def matches_name(self, name):
        return bool(self._regex and name and self._regex.search(name))


def _date(s, field):
    if isinstance(s, dt.date):
        return s
    try:
        return dt.date.fromisoformat(str(s))
    except ValueError as e:
        raise ValueError(f"buses.toml: bad date in {field}: {s!r}") from e


def _design_from(d, order):
    did = d["id"]
    where = f"buses.toml design {did!r}"
    conf = d.get("confidence")
    if conf not in CONFIDENCE:
        raise ValueError(f"{where}: confidence must be one of {CONFIDENCE}")
    model = d.get("area_model", "curated")
    if model not in AREA_MODELS:
        raise ValueError(f"{where}: area_model must be one of {AREA_MODELS}")
    match = d.get("match", {})
    gcat_bus = tuple(match.get("gcat_bus", []))
    norad = tuple(int(x) for x in match.get("norad", []))
    name_regex = match.get("name_regex") or None
    if not (gcat_bus or norad or name_regex):
        raise ValueError(f"{where}: needs at least one match rule")
    body = d.get("body")
    arrays = d.get("arrays")
    extra = float(d.get("extra_area_m2", 0.0))
    direct = d.get("direct")
    a_abs = a_fac = p_fac = None
    if model == "curated":
        if direct:
            a_abs, a_fac, p_fac = (float(direct[k]) for k in ("A_abs_m2", "A_fac_m2", "P_fac_m"))
            body = arrays = None
        else:
            if body is None and arrays is None:
                raise ValueError(f"{where}: give body/arrays, direct values, or area_model = 'gcat'")
            bb = body or {"a_m": 0.0, "b_m": 0.0}
            ar = arrays or {"n": 0, "length_m": 0.0, "width_m": 0.0, "tracking": "sun"}
            if ar.get("tracking", "sun") not in TRACKING_FACTORS:
                raise ValueError(f"{where}: arrays.tracking must be one of {tuple(TRACKING_FACTORS)}")
            a_abs, a_fac, p_fac = flat_panel_areas(
                float(bb["a_m"]), float(bb["b_m"]), int(ar["n"]), float(ar["length_m"]),
                float(ar["width_m"]), ar.get("tracking", "sun"), extra)
    else:
        body = arrays = None
    ah = d.get("alt_history")
    alt_history = None
    if ah:
        alt_history = AltHistory(
            shell_km=float(ah["shell_km"]), until=_date(ah["until"], f"{did}.alt_history.until"),
            ramp_until=_date(ah.get("ramp_until", ah["until"]), f"{did}.alt_history.ramp_until"),
            raise_days=int(ah.get("raise_days", 45)), descent_days=int(ah.get("descent_days", 120)),
            transit_km=float(ah.get("transit_km", 350.0)))
    sources = [{"title": s["title"], "url": s["url"]} for s in d.get("sources", [])]
    if not sources:
        raise ValueError(f"{where}: needs at least one source")
    des = Design(id=did, label=d["label"], family=d["family"], confidence=conf, area_model=model,
                 gcat_bus=gcat_bus, norad=norad, name_regex=name_regex, body=body,
                 arrays=arrays, extra_area_m2=extra, A_abs_m2=a_abs, A_fac_m2=a_fac,
                 P_fac_m=p_fac, direct=bool(direct), alt_history=alt_history, sources=sources,
                 notes=" ".join(str(d.get("notes", "")).split()), order=order)
    des._regex = re.compile(name_regex, re.IGNORECASE) if name_regex else None
    return des


def load_designs(path):
    with open(path, "rb") as f:
        doc = tomllib.load(f)
    designs = [_design_from(d, i) for i, d in enumerate(doc.get("design", []))]
    ids = [d.id for d in designs]
    if len(ids) != len(set(ids)):
        raise ValueError("buses.toml: duplicate design ids")
    reserved = {"other-payloads", "rocket-bodies", "debris"}
    if reserved & set(ids):
        raise ValueError(f"buses.toml: ids {reserved} are reserved for generic groups")
    return designs


class Matcher:
    """Assigns payloads to curated designs.

    Precedence: an explicit catalog number, then GCAT's Bus string, then the name
    regex. The name regex applies when the object has no GCAT Bus (for example a new
    CelesTrak object GCAT has not catalogued yet) or when the design lists no Bus
    strings. Only payloads are matched.
    """

    def __init__(self, designs):
        self.designs = designs
        self.by_norad = {}
        self.by_bus = {}
        for d in designs:
            for n in d.norad:
                self.by_norad.setdefault(n, d)
            for b in d.gcat_bus:
                self.by_bus.setdefault(b, d)
        self.regex_designs = [d for d in designs if d._regex]

    def match(self, otype, norad, bus, names):
        if otype != "PAY":
            return None
        if norad is not None and norad in self.by_norad:
            return self.by_norad[norad]
        has_bus = bool(bus) and bus != "-"
        if has_bus and bus in self.by_bus:
            return self.by_bus[bus]
        for d in self.regex_designs:
            if has_bus and d.gcat_bus:
                continue
            if any(d.matches_name(n) for n in names if n):
                return d
        return None
