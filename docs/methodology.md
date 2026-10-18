# TOI methodology (specification)

This is the source of truth for how the Taylor Occlusion Index is computed. The
pipeline in `pipeline/` implements it, and the methodology section of the site explains
it. If the code and this document disagree, one of them is a bug.

## Origin

> I'm minting a new term: the Taylor Occlusion Index (TOI). TOI is the present
> cumulative amount of occlusion caused by manmade satellites in earth orbit. The unit
> is moons. Right now we're at .~03 moons.
>
> Isaiah Taylor, 9 October 2024

It quoted an earlier question (5 October 2024): "If you put every single satellite
currently in LEO right next to each other in the shape of a disc (perfect packing, no
gaps), how large would that disc appear in the sky?"

## The unit: one Moon

The Moon's mean solid angle, seen from Earth at its mean distance:

    α = asin(R☾ / d☾)          R☾ = 1737.4 km, d☾ = 384,400 km
    Ω☾ = 2π (1 − cos α)  ≈ 6.4177 × 10⁻⁵ sr     (angular diameter 2α ≈ 0.5179°)

A TOI of 1 means the objects cover as much sky as the full Moon.

## The index

Every tracked object *i* in Earth orbit is placed directly overhead at its own mean
altitude *hᵢ*, and the solid angles are summed. Objects are treated as separate (no
overlap) and small (small-angle approximation, A/h² ≪ 1).

    TOI = (1/Ω☾) · Σᵢ Aᵢ / hᵢ²

There are three expressions. They differ only in which area enters the sum.

| Expression | Area per object | Question it answers |
|---|---|---|
| **Absolute** | `A_abs`: the largest silhouette the object can present. For flat satellites, body plus every solar array, face-on. | Isaiah's packed disc: how much sky would the hardware cover if every piece were laid flat and faced us? |
| **Facing** | `A_fac`: the orbit-averaged area actually presented to the ground, given how objects are oriented. | How much sky does the hardware cover as it really faces Earth? |
| **Apparent** | `A_app = A_fac + P_fac·ρ + πρ²`, where ρ is the atmospheric blur radius at the object's distance. | How much sky does each satellite appear to touch once the atmosphere smears its silhouette? |

### Facing: orientation factors

- **Flat-panel satellites** (Starlink, most megaconstellations): the body's broad face
  points at Earth (the user antennas are on the underside), so the full body face counts.
- **Sun-tracking solar arrays** turn to face the Sun, not the ground. The area they show
  to a point directly below is `A·|cos ψ|`, where ψ is the angle between the Sun and the
  local vertical. Averaged over all Sun directions (isotropic), `⟨|cos ψ|⟩ = ½`. So
  sun-tracking arrays count at **½** their area.
- **Earth-facing arrays** (AST SpaceMobile BlueWalker/BlueBird: the solar cells are on
  the back of the nadir-facing antenna) count at **1**.
- **Objects with unknown attitude** (generic boxes, tumbling rocket bodies, debris) use
  Cauchy's theorem: the mean projected area of a convex body under random orientation is
  **S/4**, a quarter of its surface area.

### Apparent: why scattered satellites look bigger

Seen through the atmosphere, every point of the sky is blurred into a small disc (the
seeing disc). Its full width at half maximum is θ, typically about 2 arcseconds. Blurring
a silhouette of area A and perimeter P by a disc of radius ρ grows its footprint to the
Minkowski sum, whose area is given exactly, for a convex shape, by Steiner's formula:

    A_app = A + P·ρ + π ρ²          ρ = h · θ/2  (small angle)

If every satellite were packed edge to edge into one disc, only the disc's outer edge
would blur. Because they are scattered across the sky, every satellite carries its own
blurred rim. Total light blocked is unchanged (that is the facing TOI); the area of sky
whose light is touched grows. Substituting ρ = hθ/2:

    TOI_app(θ) = (1/Ω☾) · [ Σ A_fac,ᵢ/hᵢ²  +  (θ/2) · Σ P_fac,ᵢ/hᵢ  +  N · π (θ/2)² ]

The three sums (`fac_A_h2`, `fac_P_h`, `n`) are published in `data/latest.json`, so
anyone can recompute the apparent TOI for any θ. The default is **θ = 2″**.

Note the last term: each object, however small or distant, adds one seeing disc. At
θ = 2″ that is about 1.15 × 10⁻⁶ moons per object.

## Population

1. **CelesTrak SATCAT** rows with `DECAY_DATE` empty and `ORBIT_CENTER == "EA"`. Docked
   modules and visiting vehicles carry their host's catalog number in `ORBIT_CENTER`, so
   they are excluded and represented by the host (ISS 25544, Tiangong 48274).
2. Plus **GCAT** objects in Earth orbit (`Status` O or OX, free-flying: not attached,
   docked or inside another object; not alias, placeholder or "dup" entries) that are
   absent from CelesTrak, for example batches GCAT has catalogued ahead of public
   elements.
3. **Fallback (degraded mode):** if CelesTrak cannot be fetched, the population and
   orbits come from GCAT alone and `latest.json` reports `"status": "degraded"`.

Object types: payload, rocket body, debris (CelesTrak `DEB`, GCAT components and debris),
unknown.

## Altitude

`h = (perigee + apogee) / 2`, in km, from CelesTrak SATCAT. If missing: GCAT
`currentcat`. If still missing: median of objects from the same launch (COSPAR launch
prefix). Floor of 100 km. Objects with no orbit from any source are excluded and counted
in `status_notes`. Eccentric orbits are represented by their mean altitude; HEO objects
contribute about 0.01% so this choice does not matter at the reported precision.

## Areas

### Curated designs

The designs that dominate the index (Starlink versions, AST SpaceMobile, ISS, Tiangong,
and others) have published or estimated dimensions in `pipeline/buses.toml`, each with
citations and a confidence level (`published`, `estimated`, `assumed`, `proxy`). For a
flat-panel design with body face `a × b` and `n` arrays of `L × w`:

    A_abs = a·b + n·L·w + extra
    A_fac = a·b + f·n·L·w + extra          f = ½ (sun-tracking), 1 (Earth-facing), 0 (edge-on)
    P_fac = 2(a + b) + n·2(L + f·w) − 2n·min(f·w, b)

`P_fac` is the perimeter of the projected outline with arrays attached to the body's `b`
sides (the shared edges are subtracted). Designs whose shape does not fit this model (the
space stations) give `A_abs`, `A_fac` and `P_fac` directly, derived in the notes from their
documented components.

### Generic objects (GCAT dimensions)

GCAT gives `Length` (longest body dimension), `Diameter` (second longest), `Span`
(largest dimension across appendages, including solar arrays) and a free-text `Shape`.
Flat-panel satellites are recorded with their thickness as `Length` (`Length < Diameter`).

| Body | A_abs (largest silhouette) | A_fac | P_fac |
|---|---|---|---|
| Sphere, r = max(L,D)/2 | πr² | πr² | 2πr |
| Cylinder / cone, L ≥ D | √((LD)² + (πD²/4)²) | (πDL + πD²/2)/4 | π(L + πD/2)/2 |
| Box L×D×D, L ≥ D | √(2(LD)² + D⁴) | (2LD + D²)/2 | π(L + 2D)/2 |
| Flat panel (L < D), face D × D/2, faces Earth | D²/2 | D²/2 | 3D |

`P_fac` for unknown attitude uses the Cauchy–Barbier result: the mean perimeter of a
random projection of a convex body is π times its mean width.

**Solar arrays** (Shape mentions a panel, wing or array): extension `e = Span − body
extent` when Span exceeds the body by more than 5%; array area `e × w` with `w` the body
width; counted fully in `A_abs`, at ½ in `A_fac`; added to `P_fac` per the union formula.
**Other appendages** (antennas, booms): area `0.1 × e × min(L,D)`.

**Rocket bodies** use the cylinder row regardless of the shape string (tumbling).

**No dimensions** (`Length` or `Diameter` missing or 0, which is the case for almost all
debris): CelesTrak legacy radar cross-section (RCS, m²) if present, used as both `A_abs`
and `A_fac`, with `P_fac` the circumference of a circle of that area. Otherwise a default
by type: debris 0.1 m², payload 1 m², rocket body 10 m², unknown 0.1 m².

Every object records where its area came from (`area_src`: curated, gcat, rcs, default).

## History

- **Measured:** each monthly run appends one row to `data/history.csv`.
- **Reconstructed:** recomputed every run, monthly from 1957, using today's area model and
  each object's launch and decay dates. Altitudes: survivors use today's altitude;
  decayed objects use GCAT's early-operations orbit. Curated designs may give an
  `alt_history` (for example Starlink shells at ~550 km before the 2026 lowering to
  ~480 km). This is an approximation and is labelled as one; for instance the ISS is
  counted at full size from 1998.

## What this is not

TOI is an aggregate area index. Nothing in orbit is visible to the naked eye as a dark
silhouette (eye resolution is about 60″; a 30 m Starlink at 480 km spans 13″), and at any
moment only the objects above a given horizon count, at slant range. The sky actually
covered above one observer right now is roughly 250 times smaller than the absolute TOI.
