// Shared data loading, formulas and number formatting for the hero and methodology.
// The formulas mirror docs/methodology.md; keep them identical to pipeline/.

export const ARCSEC = Math.PI / 180 / 3600;

let latestPromise = null;

export function loadLatest() {
  if (!latestPromise) {
    latestPromise = fetch('data/latest.json', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`data/latest.json: HTTP ${r.status}`);
      return r.json();
    });
  }
  return latestPromise;
}

// Moon solid angle (sr) from radius and distance: Ω = 2π(1 − cos(asin(R/d))).
export function moonSolidAngle(radiusKm = 1737.4, distanceKm = 384400) {
  return 2 * Math.PI * (1 - Math.cos(Math.asin(radiusKm / distanceKm)));
}

// Apparent TOI for a seeing FWHM θ (arcsec), from published sums (all objects or one group):
//   (fac_A_h2 + (θ/2)·fac_P_h + n·π·(θ/2)²) / Ω☾
export function apparentTOI(sums, omega, seeingArcsec) {
  const half = (seeingArcsec * ARCSEC) / 2;
  return (sums.fac_A_h2 + half * sums.fac_P_h + sums.n * Math.PI * half * half) / omega;
}

// The three terms of the apparent TOI separately (moons), for explaining the sum.
export function apparentTerms(sums, omega, seeingArcsec) {
  const half = (seeingArcsec * ARCSEC) / 2;
  return {
    area: sums.fac_A_h2 / omega,
    rim: (half * sums.fac_P_h) / omega,
    disc: (sums.n * Math.PI * half * half) / omega,
  };
}

// Round to n significant figures, no exponent: sig(0.08317, 2) → "0.083".
export function sig(x, n = 2) {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const decimals = Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(x))));
  return x.toFixed(Math.min(decimals, 20));
}

// Scientific notation with Unicode superscripts: sci(6.4177e-5, 4) → "6.418 × 10⁻⁵".
export function sci(x, n = 4) {
  if (!Number.isFinite(x)) return '–';
  const [mant, exp] = x.toExponential(n - 1).split('e');
  const sup = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const e = String(parseInt(exp, 10)).split('').map((c) => sup[c]).join('');
  return `${mant} × 10${e}`;
}

export function pct(x, decimals = 1) {
  return `${(x * 100).toFixed(decimals)}%`;
}

export function intl(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function dateLong(iso) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
