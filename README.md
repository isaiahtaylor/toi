# Taylor Occlusion Index

How much of the sky do human-made objects in orbit cover, measured in full Moons?

I [coined the index](https://x.com/isaiah_p_taylor/status/1844164374845587514) in October
2024. This repository computes it every month from public satellite catalogs and
publishes it as a static site with the full method, data and math open for checking.

The index places every tracked object in Earth orbit directly overhead at its own
altitude, adds up the patches of sky they cover, and divides by the patch the full Moon
covers. It is reported three ways:

| Expression | Area per object |
|---|---|
| **Facing** (headline) | The orbit-averaged area each object presents to the ground in flight |
| **Absolute** | The largest silhouette: every object laid flat and face-on |
| **Apparent** | The facing silhouette blurred by atmospheric seeing (2″ by default) |

The full specification is in [`docs/methodology.md`](docs/methodology.md).

## Layout

| Path | What it is |
|---|---|
| `pipeline/` | Monthly data pipeline (Python standard library only). See [`pipeline/README.md`](pipeline/README.md). |
| `pipeline/buses.toml` | Hand-curated dimensions for the satellite designs that dominate the index, with sources |
| `data/` | The pipeline's output: `latest.json`, `objects.csv`, `buses.json`, `history.csv`, monthly snapshots |
| `web/` | The site: `src/` holds the HTML partials, `assets/` the CSS, JavaScript and vendored KaTeX, `build.py` assembles it |
| `docs/` | Methodology specification and data contract |
| `.github/workflows/site.yml` | Runs the pipeline on the 1st of each month and commits fresh data |
| `vercel.json` | Vercel build settings |

## Run it locally

```sh
python3 -m unittest discover -s pipeline/tests   # pipeline tests
python3 -m pipeline.run --cache .cache           # fetch catalogs and recompute data/
python3 web/build.py                             # assemble the site into dist/
python3 -m http.server 8000 -d dist              # open http://localhost:8000
```

Python 3.11 or newer; no packages to install. Please download the catalogs at most once
a day: CelesTrak blocks clients that download the same data repeatedly.

## How it updates

1. On the 1st of each month at 07:23 UTC, GitHub Actions runs the pipeline. It downloads
   CelesTrak's SATCAT and Jonathan McDowell's GCAT, recomputes `data/`, commits it to
   `main`, and attaches the exact input files to a `data-YYYY-MM` release.
2. Vercel deploys `main` on every push, so the data commit goes live within a minute.
3. If CelesTrak is unreachable, the run falls back to GCAT alone and the site says so. If
   GCAT is unreachable, the run fails without writing anything and the site keeps last
   month's numbers.

You can also start a run by hand: **Actions → site → Run workflow** on `main`.

## Data and credits

- Orbital data: USSPACECOM via Space-Track.org, distributed by
  [CelesTrak](https://celestrak.org/). Redistribution is approved with citation.
- Physical dimensions: [GCAT](https://planet4589.org/space/gcat/), Jonathan C. McDowell,
  CC BY 4.0. Areas for the dominant designs are modified using the published sources
  listed in `pipeline/buses.toml`.
- Math rendering: [KaTeX](https://katex.org/) (MIT), vendored in `web/assets/vendor/katex/`.
