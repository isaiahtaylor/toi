"""Physical constants and fixed modelling parameters (docs/methodology.md)."""
import math

SCHEMA_VERSION = 1

# The unit: the Moon's mean solid angle seen from Earth at its mean distance.
MOON_RADIUS_KM = 1737.4
MOON_DISTANCE_KM = 384400.0
MOON_ALPHA_RAD = math.asin(MOON_RADIUS_KM / MOON_DISTANCE_KM)
OMEGA_MOON_SR = 2.0 * math.pi * (1.0 - math.cos(MOON_ALPHA_RAD))
MOON_ANGULAR_DIAMETER_DEG = math.degrees(2.0 * MOON_ALPHA_RAD)

DEFAULT_SEEING_ARCSEC = 2.0
ARCSEC_RAD = math.pi / (180.0 * 3600.0)

# Orientation factors for solar arrays (fraction of array area seen from directly below).
TRACKING_FACTORS = {"sun": 0.5, "earth": 1.0, "edge": 0.0}
SUN_TRACKING_FACTOR = TRACKING_FACTORS["sun"]

MIN_ALTITUDE_KM = 100.0

# Generic model (GCAT dimensions).
ARRAY_SPAN_MARGIN = 1.05          # Span must exceed the body extent by more than 5%
APPENDAGE_WIDTH_FACTOR = 0.1      # other appendages: area 0.1 * e * min(L, D)
APPENDAGE_FACING_FACTOR = 0.5     # thin appendages of unknown attitude count at 1/2

# Fallback areas (m^2) by object type when there are no dimensions and no RCS.
DEFAULT_AREA_M2 = {"DEB": 0.1, "PAY": 1.0, "R/B": 10.0, "UNK": 0.1}

# Orbit regimes.
EARTH_RADIUS_KM = 6378.137
LEO_MAX_APOGEE_KM = 2000.0
GEO_ALTITUDE_KM = 35786.0
GEO_BAND_KM = 1000.0
GEO_MAX_ECCENTRICITY = 0.02
MEO_MAX_ECCENTRICITY = 0.25

TOP_OBJECTS = 25
FIRST_HISTORY_MONTH = (1957, 11)

TYPE_KEYS = {"PAY": "payload", "R/B": "rocket_body", "DEB": "debris", "UNK": "unknown"}
GENERIC_GROUPS = (
    ("other-payloads", "Other payloads"),
    ("rocket-bodies", "Rocket bodies"),
    ("debris", "Debris and fragments"),
)


def apparent_toi(fac_A_h2, fac_P_h, n, seeing_arcsec=DEFAULT_SEEING_ARCSEC):
    """Apparent TOI in moons from the three published sums (h in metres, theta in arcsec)."""
    half = seeing_arcsec * ARCSEC_RAD / 2.0
    return (fac_A_h2 + half * fac_P_h + n * math.pi * half * half) / OMEGA_MOON_SR
