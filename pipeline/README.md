# TOI pipeline

The monthly backend for the Taylor Occlusion Index. It downloads two public catalogs,
computes the three TOI expressions (absolute, facing, apparent) and a reconstructed history
back to 1957, and writes the files the site reads. It uses only the Python standard
library (Python 3.11 or newer; the workflow uses 3.13).

- Specification: [`docs/methodology.md`](../docs/methodology.md)
- Output schema: [`docs/data-contract.md`](../docs/data-contract.md)
- Curated satellite designs: [`buses.toml`](buses.toml)

## Run it locally

From the repository root:

```sh
python3 -m pipeline.run                      # download into .cache/inputs, write data/
python3 -m pipeline.run --offline --cache DIR   # use files already in DIR, no network
python3 -m pipeline.run --out /tmp/toi-data  # write somewhere else
python3 -m pipeline.run --date 2026-10-18    # record a specific catalog date
```

A run takes about 5 to 10 seconds once the inputs are on disk. It writes:

| File | Contents |
|---|---|
| `data/latest.json` | Headline values, the sums behind them, groups, coverage, sources |
| `data/objects.csv` | One row per counted object, with its orbit, area and contribution |
| `data/buses.json` | The curated designs, resolved, with counts and contributions |
| `data/history.csv` | Reconstructed monthly rows from 1957-11-01, plus one measured row per run |
| `data/snapshots/YYYY-MM.json` | A copy of `latest.json` for the month |

All files are written to temporary names and renamed at the end, so a failed run leaves
the previous month's data in place.

### Inputs and fetch policy

| Cache file | Source | License |
|---|---|---|
| `gcat_satcat.tsv` | https://planet4589.org/space/gcat/tsv/cat/satcat.tsv | CC-BY-4.0 |
| `gcat_satcat100k.tsv` | https://planet4589.org/space/gcat/tsv/cat/satcat100k.tsv | CC-BY-4.0 |
| `gcat_tmpcat.tsv` | https://planet4589.org/space/gcat/tsv/cat/tmpcat.tsv | CC-BY-4.0 |
| `gcat_auxcat.tsv` | https://planet4589.org/space/gcat/tsv/cat/auxcat.tsv | CC-BY-4.0 |
| `gcat_currentcat.tsv` | https://planet4589.org/space/gcat/tsv/derived/currentcat.tsv | CC-BY-4.0 |
| `celestrak_satcat.csv` | https://celestrak.org/pub/satcat.csv | USSPACECOM basic SSA data, redistribution approved with citation |

- Every request sends `User-Agent: TOI-tracker/1.0 (+https://github.com/isaiahtaylor/toi)`.
- One GET per file per run, 120 s timeout. Connection errors are retried at most twice
  (after 10 s and 30 s). An HTTP error status is never retried.
- GCAT is fetched first. If any GCAT file fails, the run exits with status 2, writes
  nothing, and does not contact CelesTrak. The site keeps last month's data.
- CelesTrak is fetched once, last. Any non-200 answer stops CelesTrak queries for the run
  and switches to degraded mode: population and orbits from GCAT alone,
  `"status": "degraded"`, and a note in `status_notes`. CelesTrak firewalls clients that
  download the same file repeatedly, so never loop on it.
- Each download gets a `.meta.json` sidecar (URL, time, size, SHA-256, Last-Modified).
  A file fetched less than 20 hours ago is reused, so a same-day rerun downloads nothing.
- `latest.json` records the URL, fetch time, size, SHA-256 and the source's own update
  stamp (GCAT's `# Updated ...` header line) for every input.

## The monthly job

[`.github/workflows/site.yml`](../.github/workflows/site.yml) runs at 07:23 UTC on the
first of each month, and on demand from the Actions tab (from the default branch only; a
manual run from any other branch does nothing). Its one job:

1. runs the tests;
2. runs the pipeline with the download cache in the runner's temp directory;
3. builds the site as a smoke test;
4. commits `data/` as `github-actions[bot]` with the message
   `data: monthly update <catalog_date>` and pushes it to the default branch;
5. publishes a GitHub release `data-YYYY-MM` (the catalog month), tagged on that commit,
   with the input files, their `.meta.json` sidecars and the output files attached. A
   second run in the same month replaces that month's release. If the release cannot be
   published, the job still succeeds, because the data is already pushed.

Vercel deploys the site on every push to the default branch (see `vercel.json`), so the
data commit is deployed by Vercel, not by this workflow.

If GCAT is unavailable, the pipeline exits with status 2, the job fails, and nothing is
committed, so the site keeps last month's data. If CelesTrak is unavailable or its file
looks truncated, the run continues in degraded mode and labels its output as such.

GitHub turns off scheduled workflows in public repositories after 60 days without
activity. If that happens (for example after GCAT is down for two months running),
re-enable the workflow in the Actions tab.

## Verify the numbers yourself

Everything needed to check the headline values is in `data/`.

1. **From the sums.** `latest.json` gives `sums.abs_A_h2`, `sums.fac_A_h2`, `sums.fac_P_h`
   and `sums.n` (h in metres). Then
   `absolute = abs_A_h2 / omega_moon_sr`, `facing = fac_A_h2 / omega_moon_sr`, and for a
   seeing width θ in radians
   `apparent = (fac_A_h2 + (θ/2)·fac_P_h + n·π·(θ/2)²) / omega_moon_sr`.
2. **From the objects.** Sum `toi_abs` and `toi_fac` over `objects.csv`; they match
   `toi.absolute` and `toi.facing`. Each row also has `A_abs_m2`, `A_fac_m2`, `P_fac_m`
   and `alt_km`, so every contribution can be recomputed as `A / (alt_km·1000)² / Ω☾`.
   For example:

   ```sh
   python3 -c "import csv; r=list(csv.DictReader(open('data/objects.csv'))); print(sum(float(x['toi_abs']) for x in r), sum(float(x['toi_fac']) for x in r))"
   ```

3. **From the inputs.** Download the release `data-YYYY-MM`, which holds the exact input
   files with their `.meta.json` sidecars (the SHA-256 sums are also in `latest.json`),
   put them in one folder and run
   `python3 -m pipeline.run --offline --cache <folder> --out /tmp/check --date <catalog_date>`
   with the `pipeline/` code from the release's tagged commit.
   The output matches the published files apart from `generated_at`. (`history.csv` in
   the release holds earlier measured rows too; a fresh output folder has only this run's.)
4. **The formulas.** `python3 -m unittest discover -s pipeline/tests` checks the Moon's
   solid angle, the curated and generic area formulas, the apparent-TOI identity, the
   population rules on a small synthetic catalog, the output contract, degraded mode and
   the GCAT-failure path.

## Add a curated design when a new satellite version appears

A design needs curating when it carries a noticeable share of the index. The pipeline
prints `review:` lines for any uncurated GCAT bus, or any group of uncurated payloads
from one launch, that carries 0.5% or more of the facing TOI.

1. Find how the catalogs name it. Look the new objects up in `objects.csv` (the `bus`
   column holds the GCAT Bus string) or in GCAT's `satcat100k.tsv`. Note the CelesTrak
   name pattern for launches GCAT has not catalogued yet.
2. Add a `[[design]]` block to `buses.toml`:
   - `id` (lowercase, hyphenated), `label`, `family`, `confidence`
     (`published`, `estimated`, `assumed` or `proxy`).
   - `match`: `gcat_bus` with the exact Bus strings, and a `name_regex` for objects GCAT
     does not have yet (tried case-insensitively on both the CelesTrak and GCAT names).
     Use `norad` for single objects such as a station.
   - The areas: `body = { a_m, b_m }` and `arrays = { n, length_m, width_m, tracking }`
     (`tracking` is `sun`, `earth` or `edge`), or `direct = { A_abs_m2, A_fac_m2, P_fac_m }`,
     or `area_model = "gcat"` to keep GCAT's dimensions with the generic model while
     giving the design its own display group.
   - `alt_history` if the design changed altitude in a way the reconstruction should know
     about.
   - `sources` (title and URL for each figure) and `notes` explaining how the numbers were
     derived. Cite primary sources such as operator statements, FCC filings and papers.
     Never cite Gunter's Space Page; its terms forbid reuse.
3. Run the tests and the pipeline. Check the new group in `latest.json` and the
   reconstructed history for jumps.

Starlink V3 is the design most likely to need an update: its entry uses the full-size
Gen2 dimensions from SpaceX's 2022 FCC filing as a proxy until SpaceX publishes figures.

## Layout

```
pipeline/
  run.py          entry point (python3 -m pipeline.run)
  buses.toml      curated designs
  toi/
    constants.py  Moon, seeing, defaults, regimes, apparent-TOI formula
    fetch.py      downloads, cache reuse, source metadata
    catalogs.py   CelesTrak and GCAT readers, GCAT vague dates
    designs.py    buses.toml loader, flat-panel formula, matching
    areas.py      generic area model, RCS and default fallbacks
    model.py      population, orbits, areas, decayed objects
    history.py    event-based monthly reconstruction, history.csv merge
    report.py     latest.json, buses.json and objects.csv assembly
    output.py     atomic file writes
  tests/          python3 -m unittest discover -s pipeline/tests
```
