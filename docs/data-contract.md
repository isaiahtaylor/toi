# Data contract (schema version 1)

The pipeline writes these files to `data/`. The site reads them. Every field below is
required unless marked optional. Units are SI unless the name says otherwise (`_km`, `_m2`,
`_m`, `_arcsec`). TOI values are in moons.

## `data/latest.json`

```jsonc
{
  "schema_version": 1,
  "fixture": false,                     // true only for hand-made placeholder data
  "generated_at": "2026-10-18T18:04:11Z",
  "catalog_date": "2026-10-18",         // date the input catalogs were fetched
  "next_update": "2026-11-01",          // first day of next month
  "status": "ok",                       // "ok" | "degraded" (CelesTrak unavailable, GCAT-only)
  "status_notes": [],                   // human-readable strings

  "constants": {
    "moon_radius_km": 1737.4,
    "moon_distance_km": 384400,
    "moon_angular_diameter_deg": 0.51790,
    "omega_moon_sr": 6.4177e-5,
    "default_seeing_arcsec": 2.0,
    "sun_tracking_factor": 0.5,
    "min_altitude_km": 100
  },

  "toi": { "absolute": 0.0832, "facing": 0.0459, "apparent": 0.180 },   // apparent at default seeing

  // Sums over all objects, so the site (and anyone) can recompute every expression.
  //   absolute = abs_A_h2 / omega
  //   facing   = fac_A_h2 / omega
  //   apparent(θ) = (fac_A_h2 + (θ/2)·fac_P_h + n·π·(θ/2)²) / omega   (θ in radians)
  "sums": { "n": 35524, "abs_A_h2": 5.340e-6, "fac_A_h2": 2.946e-6, "fac_P_h": 1.234 },

  "counts": { "total": 35524, "payload": 20101, "rocket_body": 2143, "debris": 13225, "unknown": 55 },

  "coverage": {
    "area_source":  [ { "source": "curated", "n": 11800, "share_abs": 0.94, "share_fac": 0.93 },
                      { "source": "gcat",    "n": 12000, "share_abs": 0.058, "share_fac": 0.068 },
                      { "source": "rcs",     "n": 8400,  "share_abs": 0.0002, "share_fac": 0.0004 },
                      { "source": "default", "n": 3300,  "share_abs": 0.00003, "share_fac": 0.00005 } ],
    "orbit_source": [ { "source": "celestrak", "n": 34900 }, { "source": "gcat", "n": 550 },
                      { "source": "launch-mates", "n": 74 } ],
    "gcat_guess_share_abs": 0.98          // share of absolute TOI from GCAT dims flagged "?" (before curation)
  },

  // Display groups, sorted by facing contribution, descending. Group sums use the same
  // field names as "sums" so apparent TOI can be recomputed per group.
  "groups": [
    { "id": "starlink-v2-mini-optimized", "label": "Starlink V2 Mini Optimized", "family": "Starlink",
      "bus_id": "starlink-v2-mini-optimized",   // curated design id, or null for generic groups
      "n": 4789, "median_alt_km": 468.0,
      "toi_abs": 0.0381, "toi_fac": 0.0209,
      "abs_A_h2": 2.445e-6, "fac_A_h2": 1.341e-6, "fac_P_h": 0.66 }
    // ... generic groups at the end: "other-payloads", "rocket-bodies", "debris"
  ],

  "by_type":   [ { "type": "payload", "n": 20101, "toi_abs": 0.0823, "toi_fac": 0.0452 } ],
  "by_regime": [ { "regime": "LEO", "n": 31000, "toi_abs": 0.08318, "toi_fac": 0.04589 } ],  // LEO, MEO, GEO, HEO

  "top_objects": [   // top 25 by absolute contribution
    { "norad": 25544, "name": "ISS (ZARYA)", "group": "iss", "alt_km": 418.0,
      "A_abs_m2": 4000.0, "A_fac_m2": 2000.0, "toi_abs": 3.6e-4, "toi_fac": 1.8e-4 }
  ],

  "sources": [
    { "id": "celestrak-satcat", "label": "CelesTrak SATCAT", "url": "https://celestrak.org/pub/satcat.csv",
      "publisher": "CelesTrak, from USSPACECOM data via Space-Track.org",
      "license": "USSPACECOM basic SSA data: redistribution approved with citation",
      "fetched_at": "2026-10-18T18:00:03Z", "bytes": 6775419, "sha256": "…",
      "updated": null }                     // source's own update stamp when it has one (GCAT: "2026 Oct 17 1832:50")
  ],

  "files": { "objects_csv": "data/objects.csv", "buses_json": "data/buses.json",
             "history_csv": "data/history.csv" }
}
```

## `data/objects.csv`

One row per counted object, sorted by `toi_abs` descending. Header:

```
norad,name,cospar,type,owner,launch_date,group,bus,perigee_km,apogee_km,alt_km,orbit_src,length_m,diameter_m,span_m,shape,area_src,A_abs_m2,A_fac_m2,P_fac_m,toi_abs,toi_fac
```

- `norad`: catalog number (empty for GCAT-only objects without one; then `cospar` identifies it)
- `type`: `PAY`, `R/B`, `DEB`, `UNK`
- `group`: a `groups[].id`
- `bus`: curated design id, or the GCAT `Bus` string, or empty
- `orbit_src`: `celestrak`, `gcat`, `launch-mates`
- `length_m,diameter_m,span_m,shape`: GCAT values as given (empty if none)
- `area_src`: `curated`, `gcat`, `rcs`, `default`
- `toi_abs = A_abs_m2 / (alt_km·1000)² / omega_moon_sr`; `toi_fac` likewise with `A_fac_m2`

## `data/buses.json`

The curated design table, resolved:

```jsonc
[ { "id": "starlink-v2-mini", "label": "Starlink V2 Mini", "family": "Starlink",
    "confidence": "published",               // published | estimated | assumed | proxy
    "match": { "gcat_bus": ["Starlink V2M"], "norad": [], "name_regex": null },
    "body": { "a_m": 2.7, "b_m": 4.1 },      // null for directly specified designs
    "arrays": { "n": 2, "length_m": 12.8, "width_m": 4.1, "tracking": "sun" },   // or null
    "extra_area_m2": 0.0,
    "A_abs_m2": 116.0, "A_fac_m2": 63.6, "P_fac_m": 64.8,
    "n_on_orbit": 2561, "toi_abs": 0.0189, "toi_fac": 0.0104,
    "sources": [ { "title": "Mallama et al. 2023, The Brightness of Starlink V2 Mini satellites", "url": "https://arxiv.org/abs/2309.14152" } ],
    "notes": "…" } ]
```

## `data/history.csv`

```
date,kind,toi_abs,toi_fac,toi_app,n_objects
1957-11-01,reconstructed,…
2026-10-18,measured,0.0832,0.0459,0.180,35524
```

`kind` is `reconstructed` (regenerated every run, first of each month from 1957-11) or
`measured` (one row appended per monthly run, never rewritten). `toi_app` uses the default
seeing.

## `data/snapshots/YYYY-MM.json`

A copy of `latest.json` for each monthly run.
