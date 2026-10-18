"""Generic area model from GCAT dimensions, and the RCS/default fallbacks."""
import math
import re

from .constants import (APPENDAGE_FACING_FACTOR, APPENDAGE_WIDTH_FACTOR, ARRAY_SPAN_MARGIN,
                        DEFAULT_AREA_M2, SUN_TRACKING_FACTOR)

SPHERE = re.compile(r"sphere|ball|\bico|geodesic")
CYLINDER = re.compile(r"cyl|cone|frust|disk|disc|torus|tank|nozzle|rod|tube|ring|\bell|drum")
PANEL = re.compile(r"pan|wing|array")
# A tether is millimetres thick; when Shape mentions one, Span is the tether length.
TETHER = re.compile(r"tether")


def body_kind(otype, length, diameter, shape):
    """Which body row of the generic table applies."""
    if otype == "R/B":
        return "cylinder"            # rocket bodies tumble: cylinder row regardless of shape
    primary = (shape or "").lower().split("+")[0]
    if SPHERE.search(primary):
        return "sphere"
    if CYLINDER.search(primary):
        return "cylinder"
    if length < diameter:
        return "flat"                # GCAT lists a flat satellite's thickness as Length
    return "box"


def _union_perimeter(extension, width, f, side):
    """Perimeter added by an attachment of length `extension`, width `width` seen at factor f,
    joined along a body side of length `side` (shared edge removed)."""
    return 2.0 * (extension + f * width) - 2.0 * min(f * width, side)


def generic_area(otype, length, diameter, span, shape):
    """(A_abs, A_fac, P_fac, kind) from GCAT Length/Diameter/Span/Shape, or None.

    Implements the table in docs/methodology.md ("Generic objects"). Dimensions that
    are missing or zero mean unknown, and return None.
    """
    L, D = length or 0.0, diameter or 0.0
    if L <= 0 or D <= 0:
        return None
    kind = body_kind(otype, L, D, shape)
    if kind == "sphere":
        r = max(L, D) / 2.0
        a_abs = a_fac = math.pi * r * r
        p_fac = 2.0 * math.pi * r
        extent, width = 2.0 * r, 2.0 * r
    elif kind == "cylinder":
        a_abs = math.sqrt((L * D) ** 2 + (math.pi * D * D / 4.0) ** 2)
        a_fac = (math.pi * D * L + math.pi * D * D / 2.0) / 4.0
        p_fac = math.pi * (L + math.pi * D / 2.0) / 2.0
        extent, width = max(L, D), D
    elif kind == "box":
        a_abs = math.sqrt(2.0 * (L * D) ** 2 + D ** 4)
        a_fac = (2.0 * L * D + D * D) / 2.0
        p_fac = math.pi * (L + 2.0 * D) / 2.0
        extent, width = L, D
    else:  # flat panel, face D x D/2, faces Earth
        a_abs = a_fac = D * D / 2.0
        p_fac = 3.0 * D
        extent, width = D, D / 2.0
    shape_lc = (shape or "").lower()
    if otype != "R/B" and span and span > ARRAY_SPAN_MARGIN * extent and not TETHER.search(shape_lc):
        e = span - extent
        if PANEL.search(shape_lc):
            arr = e * width
            a_abs += arr
            a_fac += SUN_TRACKING_FACTOR * arr
            p_fac += _union_perimeter(e, width, SUN_TRACKING_FACTOR, width)
        else:
            app_w = APPENDAGE_WIDTH_FACTOR * min(L, D)
            a_abs += e * app_w
            a_fac += APPENDAGE_FACING_FACTOR * e * app_w
            p_fac += _union_perimeter(e, app_w, APPENDAGE_FACING_FACTOR, app_w)
    return a_abs, a_fac, p_fac, kind


def circle_perimeter(area):
    return 2.0 * math.sqrt(math.pi * area)


def fallback_area(otype, rcs):
    """(A_abs, A_fac, P_fac, area_src) for an object without dimensions."""
    if rcs is not None and rcs > 0:
        return rcs, rcs, circle_perimeter(rcs), "rcs"
    a = DEFAULT_AREA_M2.get(otype, DEFAULT_AREA_M2["UNK"])
    return a, a, circle_perimeter(a), "default"
