"""Unit tests for the TOI formulas (docs/methodology.md)."""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.toi import constants as C  # noqa: E402
from pipeline.toi.areas import circle_perimeter, fallback_area, generic_area  # noqa: E402
from pipeline.toi.designs import flat_panel_areas, load_designs  # noqa: E402
from pipeline.toi.history import altitude_at, first_index_on_or_after, month_starts, reconstruct  # noqa: E402

BUSES = Path(__file__).resolve().parents[1] / "buses.toml"


class MoonTests(unittest.TestCase):
    def test_solid_angle(self):
        # 2*pi*(1 - cos(asin(1737.4 / 384400))) = 6.41778e-5 sr
        self.assertAlmostEqual(C.OMEGA_MOON_SR, 6.4177e-5, delta=0.0001e-5)
        self.assertAlmostEqual(C.OMEGA_MOON_SR, 6.41778e-5, delta=0.000005e-5)
        self.assertAlmostEqual(C.MOON_ANGULAR_DIAMETER_DEG, 0.5179, places=4)

    def test_solid_angle_matches_small_angle_disc(self):
        r = C.MOON_RADIUS_KM / C.MOON_DISTANCE_KM
        self.assertAlmostEqual(C.OMEGA_MOON_SR / (math.pi * r * r), 1.0, places=4)


class CuratedFormulaTests(unittest.TestCase):
    def test_v2_mini(self):
        a_abs, a_fac, p_fac = flat_panel_areas(2.7, 4.1, 2, 12.8, 4.1, "sun")
        self.assertAlmostEqual(a_abs, 116.0, delta=0.05)
        self.assertAlmostEqual(a_fac, 63.56, delta=0.02)
        self.assertAlmostEqual(p_fac, 64.8, places=6)

    def test_starlink_v1(self):
        a_abs, a_fac, p_fac = flat_panel_areas(1.3, 2.8, 1, 8.1, 2.8, "sun")
        self.assertAlmostEqual(a_abs, 26.32, places=6)
        self.assertAlmostEqual(a_fac, 3.64 + 11.34, places=6)
        self.assertAlmostEqual(p_fac, 8.2 + 2 * (8.1 + 1.4) - 2 * 1.4, places=6)

    def test_union_perimeter_edge_on_arrays(self):
        # f = 0: each array is seen as a line sticking out of the body, adding 2L.
        a_abs, a_fac, p_fac = flat_panel_areas(2.0, 3.0, 2, 5.0, 3.0, "edge")
        self.assertAlmostEqual(a_fac, 6.0)
        self.assertAlmostEqual(a_abs, 6.0 + 30.0)
        self.assertAlmostEqual(p_fac, 2 * (2 + 3) + 2 * 2 * 5.0)

    def test_union_perimeter_full_width_arrays(self):
        # f = 1, array as wide as the body side: one rectangle (a + nL) x b.
        a_abs, a_fac, p_fac = flat_panel_areas(2.0, 3.0, 1, 5.0, 3.0, "earth")
        self.assertAlmostEqual(a_fac, a_abs)
        self.assertAlmostEqual(p_fac, 2 * (2 + 5 + 3))
        _, _, p2 = flat_panel_areas(2.0, 3.0, 2, 5.0, 3.0, "earth")
        self.assertAlmostEqual(p2, 2 * (2 + 10 + 3))

    def test_arrays_only(self):
        a_abs, a_fac, p_fac = flat_panel_areas(0.0, 0.0, 1, 8.0, 8.0, "earth")
        self.assertEqual((a_abs, a_fac, p_fac), (64.0, 64.0, 32.0))

    def test_buses_toml_loads_and_v2_mini_entry(self):
        designs = {d.id: d for d in load_designs(BUSES)}
        for required in ("starlink-v1", "starlink-v2-mini", "starlink-v2-mini-optimized",
                         "starlink-v2-mini-dtc", "starlink-v3", "starshield", "ast-bluebird-block1",
                         "ast-bluebird-block2", "iss", "tiangong", "amazon-leo", "oneweb", "qianfan",
                         "guowang", "iridium-next"):
            self.assertIn(required, designs)
        v2m = designs["starlink-v2-mini"]
        self.assertAlmostEqual(v2m.P_fac_m, 64.8, places=6)
        for d in designs.values():
            self.assertTrue(d.sources, d.id)
            for s in d.sources:
                self.assertNotIn("skyrocket.de", s["url"], "Gunter's Space Page must not be cited")


class GenericRowTests(unittest.TestCase):
    def test_sphere(self):
        a_abs, a_fac, p, kind = generic_area("PAY", 1.0, 0.8, 1.0, "Sphere")
        self.assertEqual(kind, "sphere")
        self.assertAlmostEqual(a_abs, math.pi * 0.25)
        self.assertAlmostEqual(a_fac, math.pi * 0.25)
        self.assertAlmostEqual(p, math.pi)

    def test_cylinder(self):
        L, D = 11.1, 3.9
        a_abs, a_fac, p, kind = generic_area("PAY", L, D, None, "Cyl")
        self.assertEqual(kind, "cylinder")
        self.assertAlmostEqual(a_abs, math.sqrt((L * D) ** 2 + (math.pi * D * D / 4) ** 2))
        self.assertAlmostEqual(a_fac, (math.pi * D * L + math.pi * D * D / 2) / 4)
        self.assertAlmostEqual(p, math.pi * (L + math.pi * D / 2) / 2)

    def test_rocket_body_is_cylinder_regardless_of_shape(self):
        r = generic_area("R/B", 2.0, 1.0, 10.0, "Box + 2 Pan")
        c = generic_area("PAY", 2.0, 1.0, None, "Cyl")
        self.assertEqual(r[3], "cylinder")
        self.assertAlmostEqual(r[0], c[0])           # span ignored for rocket bodies

    def test_box(self):
        L, D = 2.0, 1.0
        a_abs, a_fac, p, kind = generic_area("PAY", L, D, 2.0, "Box")
        self.assertEqual(kind, "box")
        self.assertAlmostEqual(a_abs, math.sqrt(2 * (L * D) ** 2 + D ** 4))
        self.assertAlmostEqual(a_fac, (2 * L * D + D * D) / 2)
        self.assertAlmostEqual(p, math.pi * (L + 2 * D) / 2)

    def test_flat_panel(self):
        a_abs, a_fac, p, kind = generic_area("PAY", 0.3, 4.0, 4.0, "Box")
        self.assertEqual(kind, "flat")
        self.assertAlmostEqual(a_abs, 8.0)
        self.assertAlmostEqual(a_fac, 8.0)
        self.assertAlmostEqual(p, 12.0)

    def test_flat_panel_with_arrays(self):
        # V2 Mini as GCAT records it: 0.3 x 4.1 m, 29.0 m span, "Box + pan".
        a_abs, a_fac, p, _ = generic_area("PAY", 0.3, 4.1, 29.0, "Box + pan")
        e, w = 29.0 - 4.1, 4.1 / 2
        self.assertAlmostEqual(a_abs, 4.1 ** 2 / 2 + e * w)
        self.assertAlmostEqual(a_fac, 4.1 ** 2 / 2 + 0.5 * e * w)
        self.assertAlmostEqual(p, 3 * 4.1 + 2 * e)

    def test_span_within_margin_adds_nothing(self):
        base = generic_area("PAY", 2.0, 1.0, None, "Box + pan")
        near = generic_area("PAY", 2.0, 1.0, 2.09, "Box + pan")
        self.assertAlmostEqual(base[0], near[0])

    def test_other_appendage(self):
        a_abs, a_fac, p, _ = generic_area("PAY", 1.6, 0.8, 7.0, "Cyl + Ant")
        body = generic_area("PAY", 1.6, 0.8, None, "Cyl")
        e = 7.0 - 1.6
        self.assertAlmostEqual(a_abs - body[0], 0.1 * e * 0.8)
        self.assertAlmostEqual(a_fac - body[1], 0.5 * 0.1 * e * 0.8)
        self.assertAlmostEqual(p - body[2], 2 * e)

    def test_missing_dimensions(self):
        self.assertIsNone(generic_area("DEB", 0.0, 0.0, 0.0, "-"))
        self.assertIsNone(generic_area("PAY", None, 1.0, None, "Box"))


class FallbackTests(unittest.TestCase):
    def test_rcs(self):
        a_abs, a_fac, p, src = fallback_area("DEB", 0.5)
        self.assertEqual((a_abs, a_fac, src), (0.5, 0.5, "rcs"))
        self.assertAlmostEqual(p, 2 * math.sqrt(math.pi * 0.5))

    def test_defaults(self):
        for otype, area in (("DEB", 0.1), ("PAY", 1.0), ("R/B", 10.0), ("UNK", 0.1)):
            a_abs, a_fac, p, src = fallback_area(otype, None)
            self.assertEqual((a_abs, a_fac, src), (area, area, "default"))
            self.assertAlmostEqual(p, circle_perimeter(area))
        self.assertEqual(fallback_area("PAY", 0.0)[3], "default")


class ApparentTests(unittest.TestCase):
    def test_three_sum_formula_equals_per_object_sum(self):
        objs = [(116.0, 63.56, 64.8, 480.0), (26.32, 14.98, 24.4, 550.0), (0.1, 0.1, 1.12, 900.0),
                (4300.0, 2560.0, 1180.0, 420.0), (40.0, 38.0, 25.0, 35786.0)]
        for seeing in (0.5, 1.0, 2.0, 5.0):
            theta = seeing * C.ARCSEC_RAD
            direct = 0.0
            for _, a_fac, p_fac, h_km in objs:
                h = h_km * 1000.0
                rho = h * theta / 2
                direct += (a_fac + p_fac * rho + math.pi * rho * rho) / (h * h)
            direct /= C.OMEGA_MOON_SR
            fac_A_h2 = sum(a / (h * 1e3) ** 2 for _, a, _, h in objs)
            fac_P_h = sum(p / (h * 1e3) for _, _, p, h in objs)
            self.assertAlmostEqual(C.apparent_toi(fac_A_h2, fac_P_h, len(objs), seeing) / direct, 1.0, places=12)

    def test_seeing_disc_per_object(self):
        self.assertAlmostEqual(C.apparent_toi(0.0, 0.0, 1, 2.0), 1.15e-6, delta=0.01e-6)


class HistoryTests(unittest.TestCase):
    def test_month_index(self):
        months = month_starts(__import__("datetime").date(2026, 10, 18))
        self.assertEqual(months[0].isoformat(), "1957-11-01")
        self.assertEqual(months[-1].isoformat(), "2026-10-01")
        n = len(months)
        D = __import__("datetime").date
        self.assertEqual(months[first_index_on_or_after(D(2020, 1, 1), n)], D(2020, 1, 1))
        self.assertEqual(months[first_index_on_or_after(D(2020, 1, 15), n)], D(2020, 2, 1))
        self.assertEqual(first_index_on_or_after(D(1950, 1, 1), n), 0)
        self.assertEqual(first_index_on_or_after(D(2030, 1, 1), n), n)

    def test_event_counting(self):
        D = __import__("datetime").date
        o = {"start": D(2020, 1, 15), "end": D(2020, 3, 1), "h_km": 500.0, "A_abs": 10.0,
             "A_fac": 5.0, "P_fac": 9.0, "design": None}
        rows = {r["date"]: r for r in reconstruct([], [o], D(2020, 6, 1))}
        self.assertEqual(rows["2020-01-01"]["n_objects"], 0)
        self.assertEqual(rows["2020-02-01"]["n_objects"], 1)
        self.assertEqual(rows["2020-03-01"]["n_objects"], 0)
        self.assertAlmostEqual(rows["2020-02-01"]["toi_abs"], 10.0 / 5e5 ** 2 / C.OMEGA_MOON_SR)

    def test_alt_history_rule(self):
        D = __import__("datetime").date
        v1 = {d.id: d for d in load_designs(BUSES)}["starlink-v1"].alt_history
        start = D(2020, 1, 1)
        self.assertEqual(altitude_at(D(2020, 1, 20), v1, start, None, 470.0, None, True), 350.0)
        self.assertEqual(altitude_at(D(2024, 10, 1), v1, start, None, 470.0, None, True), 550.0)
        self.assertEqual(altitude_at(D(2026, 10, 1), v1, start, None, 470.0, None, True), 470.0)
        mid = altitude_at(D(2026, 5, 17), v1, start, None, 470.0, None, True)
        self.assertTrue(470.0 < mid < 550.0)
        # decayed satellite, early-operations orbit 290 km: on station at the shell, in
        # transit near its decay
        self.assertEqual(altitude_at(D(2024, 1, 1), v1, start, D(2024, 10, 2), None, 290.0, False), 550.0)
        self.assertEqual(altitude_at(D(2024, 9, 1), v1, start, D(2024, 10, 2), None, 290.0, False), 290.0)


if __name__ == "__main__":
    unittest.main()
