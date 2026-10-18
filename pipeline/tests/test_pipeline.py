"""Population rules, output contract, degraded mode and failure handling, on a tiny
synthetic catalog (pipeline/tests/fixtures.py)."""
import csv
import json
import re
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import fixtures  # noqa: E402
from pipeline import run as run_mod  # noqa: E402
from pipeline.toi import fetch  # noqa: E402
from pipeline.toi.designs import Matcher, load_designs  # noqa: E402
from pipeline.toi.model import build_current, build_decayed, load_catalogs  # noqa: E402

BUSES = ROOT / "pipeline" / "buses.toml"
CONTRACT = ROOT / "docs" / "data-contract.md"


def quiet(*_a, **_k):
    pass


def args_for(cache, out, offline=True, date="2026-10-18"):
    return SimpleNamespace(cache=str(cache), out=str(out), offline=offline, date=date,
                           buses=str(BUSES), max_age_hours=20.0)


class PopulationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cache = fixtures.write_cache(Path(cls.tmp.name) / "cache")
        inputs, ok, _ = fetch.fetch_all(cache, offline=True, log=quiet)
        cls.cats = load_catalogs(inputs, ok)
        cls.matcher = Matcher(load_designs(BUSES))
        cls.objs, cls.no_orbit, cls.gcat_only, cls.excluded = build_current(cls.cats, cls.matcher)
        cls.by_key = {(o["norad"] if o["from_celestrak"] else o["jcat"]): o for o in cls.objs}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_celestrak_population(self):
        counted = {o["norad"] for o in self.objs if o["from_celestrak"]}
        self.assertEqual(counted, fixtures.EXPECTED_CELESTRAK)
        self.assertNotIn(26400, counted)    # docked to the ISS (ORBIT_CENTER = 25544)
        self.assertNotIn(44713, counted)    # decayed
        self.assertNotIn(30000, counted)    # lunar orbit

    def test_gcat_only_additions(self):
        extra = {o["jcat"] for o in self.objs if not o["from_celestrak"]}
        self.assertEqual(extra, fixtures.EXPECTED_GCAT_ONLY)   # no dup, alias, attached or mistag entries
        self.assertEqual(self.gcat_only, len(fixtures.EXPECTED_GCAT_ONLY))
        self.assertEqual({o["jcat"] for o in self.no_orbit if not o["from_celestrak"]},
                         fixtures.EXPECTED_EXCLUDED_GCAT_ONLY_NO_ORBIT)
        self.assertEqual(self.by_key["S101000"]["group"], "starshield")
        self.assertEqual(self.by_key["A00001"]["type"], "DEB")

    def test_stacks_count_once(self):
        self.assertEqual({o["norad"] for o in self.excluded["stacked"]}, fixtures.EXPECTED_STACKED)
        self.assertEqual({o["jcat"] for o in self.excluded["stack_host"]}, fixtures.EXPECTED_STACK_HOSTS)
        counted = {o["jcat"] for o in self.objs}
        self.assertIn("S17369", counted)          # the catalogued payload represents the stack
        self.assertNotIn("A00004", counted)
        self.assertNotIn("S100600", counted)

    def test_temporary_objects_behind_unidentified_pieces(self):
        self.assertEqual({o["jcat"] for o in self.excluded["tmp_unidentified"]},
                         fixtures.EXPECTED_TMP_UNIDENTIFIED)

    def test_no_launch_mate_orbit_for_objects_gcat_says_came_down(self):
        gone = [o for o in self.no_orbit if o["norad"] == 20006]
        self.assertEqual(len(gone), 1)
        self.assertNotIn(20006, {o["norad"] for o in self.objs})

    def test_orbit_sources(self):
        self.assertEqual(self.by_key[25544]["orbit_src"], "celestrak")
        self.assertEqual(self.by_key[20003]["orbit_src"], "gcat")
        self.assertEqual(self.by_key[20004]["orbit_src"], "launch-mates")
        self.assertAlmostEqual(self.by_key[20004]["h_km"], (545 + 565) / 2)

    def test_areas_and_groups(self):
        self.assertEqual(self.by_key[25544]["group"], "iss")
        self.assertEqual(self.by_key[25544]["area_src"], "curated")
        self.assertEqual(self.by_key[55000]["group"], "starlink-v2-mini")
        self.assertAlmostEqual(self.by_key[55000]["A_abs"], 116.03, places=6)
        self.assertEqual(self.by_key[100500]["group"], "starlink-v2-mini-optimized")  # name regex
        self.assertEqual(self.by_key[20000]["area_src"], "rcs")
        self.assertEqual(self.by_key[20001]["area_src"], "default")
        self.assertAlmostEqual(self.by_key[20001]["A_abs"], 0.1)
        self.assertEqual(self.by_key[20002]["group"], "rocket-bodies")
        self.assertEqual(self.by_key[20002]["area_src"], "gcat")
        self.assertEqual(self.by_key[20005]["group"], "other-payloads")

    def test_decayed_objects_use_early_operations_orbit(self):
        decayed, _ = build_decayed(self.cats, self.matcher)
        sl = [o for o in decayed if o["norad"] == 44713]
        self.assertEqual(len(sl), 1)
        self.assertEqual(sl[0]["orbit_src"], "gcat")
        self.assertAlmostEqual(sl[0]["h_km"], 285.0)
        self.assertEqual(sl[0]["group"], "starlink-v1")


def contract_latest_keys():
    text = CONTRACT.read_text(encoding="utf-8")
    block = text.split("## `data/latest.json`", 1)[1].split("```jsonc", 1)[1].split("```", 1)[0]
    block = re.sub(r"//.*", "", block)
    return set(re.findall(r'"(\w+)"\s*:', block))


def contract_header(section):
    text = CONTRACT.read_text(encoding="utf-8")
    block = text.split(section, 1)[1].split("```", 2)[1]
    return block.strip().splitlines()[0].strip().split(",")


def all_keys(obj, acc=None):
    acc = set() if acc is None else acc
    if isinstance(obj, dict):
        for k, v in obj.items():
            acc.add(k)
            all_keys(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            all_keys(v, acc)
    return acc


class PipelineRunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_offline_run_writes_contract(self):
        cache = fixtures.write_cache(self.dir / "cache")
        out = self.dir / "out"
        self.assertEqual(run_mod.run(args_for(cache, out), log=quiet), 0)
        latest = json.loads((out / "latest.json").read_text())
        missing = contract_latest_keys() - all_keys(latest)
        self.assertFalse(missing, f"latest.json lacks contract keys: {sorted(missing)}")
        self.assertFalse(latest["fixture"])
        self.assertEqual(latest["status"], "ok")
        self.assertEqual(latest["catalog_date"], "2026-10-18")
        self.assertEqual(latest["next_update"], "2026-11-01")
        s, om = latest["sums"], latest["constants"]["omega_moon_sr"]
        self.assertAlmostEqual(latest["toi"]["absolute"], s["abs_A_h2"] / om, places=15)
        self.assertEqual(latest["counts"]["total"], s["n"])
        self.assertEqual(sum(g["n"] for g in latest["groups"]), s["n"])
        self.assertEqual({e["regime"] for e in latest["by_regime"]}, {"LEO", "MEO", "GEO", "HEO"})
        self.assertEqual(len(latest["sources"]), 6)
        for src in latest["sources"]:
            self.assertEqual(len(src["sha256"]), 64)
        gcat = [x for x in latest["sources"] if x["id"] == "gcat-satcat"][0]
        self.assertEqual(gcat["updated"], "2026 Oct 17 1832:50")
        self.assertEqual(gcat["license"], "CC-BY-4.0")
        with open(out / "objects.csv", newline="") as f:
            rows = list(csv.reader(f))
        header = contract_header("## `data/objects.csv`")
        self.assertEqual(rows[0][:len(header)], header)
        self.assertEqual(len(rows) - 1, s["n"])
        with open(out / "history.csv", newline="") as f:
            hist = list(csv.DictReader(f))
        self.assertEqual(list(hist[0].keys()), contract_header("## `data/history.csv`"))
        self.assertEqual(hist[0]["date"], "1957-11-01")
        self.assertEqual(hist[-1]["kind"], "measured")
        buses = json.loads((out / "buses.json").read_text())
        for key in ("id", "label", "family", "confidence", "match", "body", "arrays", "extra_area_m2",
                    "A_abs_m2", "A_fac_m2", "P_fac_m", "n_on_orbit", "toi_abs", "toi_fac", "sources", "notes"):
            self.assertIn(key, buses[0])
        self.assertTrue((out / "snapshots" / "2026-10.json").exists())

    def test_measured_rows_are_kept(self):
        cache = fixtures.write_cache(self.dir / "cache")
        out = self.dir / "out"
        out.mkdir()
        (out / "history.csv").write_text(
            "date,kind,toi_abs,toi_fac,toi_app,n_objects\n"
            "2026-09-18,measured,0.08,0.044,0.19,35400\n"
            "2026-10-18,measured,1,1,1,1\n")
        run_mod.run(args_for(cache, out), log=quiet)
        with open(out / "history.csv", newline="") as f:
            measured = [r for r in csv.DictReader(f) if r["kind"] == "measured"]
        self.assertEqual([r["date"] for r in measured], ["2026-09-18", "2026-10-18"])
        self.assertEqual(measured[0]["toi_abs"], "0.08")
        self.assertNotEqual(measured[1]["toi_abs"], "1")

    def _serving_opener(self, celestrak_error=None, gcat_error=None, calls=None):
        contents = fixtures.file_contents()
        by_url = {s.url: contents[s.filename].encode() for s in fetch.SOURCES}

        def opener(url, timeout):
            if calls is not None:
                calls.append(url)
            if "celestrak" in url and celestrak_error:
                raise celestrak_error
            if "planet4589" in url and gcat_error:
                raise gcat_error
            return by_url[url], {}
        return opener

    def test_degraded_mode_when_celestrak_fails(self):
        calls = []
        err = urllib.error.HTTPError("https://celestrak.org/pub/satcat.csv", 403, "Forbidden", {}, None)
        out = self.dir / "out"
        args = args_for(self.dir / "cache", out, offline=False)
        code = run_mod.run(args, opener=self._serving_opener(celestrak_error=err, calls=calls),
                           sleep=lambda s: None, log=quiet)
        self.assertEqual(code, 0)
        self.assertEqual(sum("celestrak" in u for u in calls), 1)    # one request, no retry
        latest = json.loads((out / "latest.json").read_text())
        self.assertEqual(latest["status"], "degraded")
        self.assertTrue(any("CelesTrak" in n and "403" in n for n in latest["status_notes"]))
        self.assertNotIn("celestrak-satcat", {s["id"] for s in latest["sources"]})
        # GCAT-only population: the ISS composite is still counted once, docked modules are not
        names = {o["norad"] for o in latest["top_objects"]}
        self.assertIn(25544, names)
        self.assertNotIn(26400, names)
        self.assertGreater(latest["sums"]["n"], 5)

    def test_no_output_when_gcat_fails(self):
        out = self.dir / "out"
        err = urllib.error.HTTPError("https://planet4589.org/x", 500, "Server Error", {}, None)
        calls = []
        code = run_mod.run(args_for(self.dir / "cache", out, offline=False),
                           opener=self._serving_opener(gcat_error=err, calls=calls),
                           sleep=lambda s: None, log=quiet)
        self.assertEqual(code, 2)
        self.assertFalse(out.exists() and any(out.iterdir()))
        self.assertFalse(any("celestrak" in u for u in calls))     # CelesTrak is not queried

    def test_degraded_mode_when_celestrak_serves_html(self):
        cache = fixtures.write_cache(self.dir / "cache")
        (cache / "celestrak_satcat.csv").write_text("<html><body>Service unavailable</body></html>\n")
        out = self.dir / "out"
        self.assertEqual(run_mod.run(args_for(cache, out), log=quiet), 0)
        latest = json.loads((out / "latest.json").read_text())
        self.assertEqual(latest["status"], "degraded")
        self.assertNotIn("celestrak-satcat", {s["id"] for s in latest["sources"]})

    def test_degraded_mode_when_celestrak_is_truncated(self):
        cache = fixtures.write_cache(self.dir / "cache")
        lines = (cache / "celestrak_satcat.csv").read_text().splitlines()
        (cache / "celestrak_satcat.csv").write_text("\n".join(lines[:4]) + "\n")
        out = self.dir / "out"
        self.assertEqual(run_mod.run(args_for(cache, out), log=quiet), 0)
        latest = json.loads((out / "latest.json").read_text())
        self.assertEqual(latest["status"], "degraded")
        self.assertTrue(any("incomplete" in n for n in latest["status_notes"]))
        self.assertNotIn("celestrak-satcat", {s["id"] for s in latest["sources"]})

    def test_no_output_when_gcat_is_malformed_or_truncated(self):
        for name, mangle in (("html", lambda text: "<html>Not Found</html>\n"),
                             ("truncated", lambda text: "\n".join(text.splitlines()[:4]) + "\n")):
            with self.subTest(name):
                cache = fixtures.write_cache(self.dir / name / "cache")
                path = cache / "gcat_satcat.tsv"
                path.write_text(mangle(path.read_text()))
                out = self.dir / name / "out"
                self.assertEqual(run_mod.run(args_for(cache, out), log=quiet), 2)
                self.assertFalse(out.exists())

    def test_malformed_rows_are_skipped(self):
        cache = fixtures.write_cache(self.dir / "cache")
        with open(cache / "celestrak_satcat.csv", "a") as f:
            f.write("BROKEN,,notanumber,PAY,,,,,,,,abc,def,,,EA,ORB\n")
            f.write("SHORT ROW,2020-009A\n")
        with open(cache / "gcat_currentcat.tsv", "a") as f:
            f.write("A99999\tjunk\n\n")
        out = self.dir / "out"
        self.assertEqual(run_mod.run(args_for(cache, out), log=quiet), 0)
        latest = json.loads((out / "latest.json").read_text())
        self.assertEqual(latest["status"], "ok")
        self.assertEqual(latest["sums"]["n"], len(fixtures.EXPECTED_CELESTRAK) + len(fixtures.EXPECTED_GCAT_ONLY))

    def test_no_output_when_gcat_missing_offline(self):
        cache = fixtures.write_cache(self.dir / "cache", skip=("gcat_currentcat.tsv",))
        out = self.dir / "out"
        self.assertEqual(run_mod.run(args_for(cache, out), log=quiet), 2)
        self.assertFalse(out.exists())

    def test_connection_errors_retry_twice_then_fail(self):
        calls = []
        err = urllib.error.URLError("connection refused")
        code = run_mod.run(args_for(self.dir / "cache", self.dir / "out", offline=False),
                           opener=self._serving_opener(gcat_error=err, calls=calls),
                           sleep=lambda s: None, log=quiet)
        self.assertEqual(code, 2)
        self.assertEqual(len(calls), 3)          # first attempt plus two retries

    def test_fresh_cache_is_reused(self):
        calls = []
        opener = self._serving_opener(calls=calls)
        args = args_for(self.dir / "cache", self.dir / "out", offline=False)
        run_mod.run(args, opener=opener, sleep=lambda s: None, log=quiet)
        self.assertEqual(len(calls), 6)          # one GET per file
        run_mod.run(args, opener=opener, sleep=lambda s: None, log=quiet)
        self.assertEqual(len(calls), 6)          # a same-day rerun downloads nothing


if __name__ == "__main__":
    unittest.main()
