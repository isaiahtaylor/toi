// Small deterministic helpers for the hero canvas: a seeded PRNG, periodic Perlin
// noise, and the usual scalar easing functions. No dependencies.

export const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D gradient noise that repeats every `period` lattice cells in both axes.
// Returns values in roughly [-0.7, 0.7]. Sampling at (x·2^k, y·2^k) keeps the same
// period, so octave sums tile seamlessly.
export function perlin2(period, seed) {
  const rand = mulberry32(seed);
  const n = period * period;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rand() * TAU;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    let x0 = xi % period; if (x0 < 0) x0 += period;
    let y0 = yi % period; if (y0 < 0) y0 += period;
    const x1 = x0 + 1 === period ? 0 : x0 + 1;
    const y1 = y0 + 1 === period ? 0 : y0 + 1;
    const i00 = y0 * period + x0;
    const i10 = y0 * period + x1;
    const i01 = y1 * period + x0;
    const i11 = y1 * period + x1;
    const d00 = gx[i00] * xf + gy[i00] * yf;
    const d10 = gx[i10] * (xf - 1) + gy[i10] * yf;
    const d01 = gx[i01] * xf + gy[i01] * (yf - 1);
    const d11 = gx[i11] * (xf - 1) + gy[i11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = d00 + (d10 - d00) * u;
    const b = d01 + (d11 - d01) * u;
    return a + (b - a) * v;
  };
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function rgba(c, a) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export function mix(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}
