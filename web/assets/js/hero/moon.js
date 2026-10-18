// The full Moon, rendered once per size to an offscreen canvas: near-side maria in
// roughly their true places, highland mottling, bright ray craters (Tycho, Copernicus,
// Kepler), gentle limb darkening, and a fine ordered dither that reads as digital up
// close without dimming the disc.

import { perlin2, mulberry32, clamp, smoothstep, TAU } from './noise.js';

// Near-side maria as caps on the sphere: [latitude°, longitude° (east +), angular
// radius°, darkness]. Centres and sizes follow the IAU selenographic catalogue;
// irregular maria are built from several caps. Rendered in orthographic projection,
// north up, so the shapes foreshorten toward the limb as they do from Earth.
const MARIA = [
  // Imbrium and Sinus Iridum
  [32.8, -15.6, 16.5, 1.0], [36, -22, 10, 1.0], [44.1, -31.5, 4.8, 0.95], [27, -8, 7, 0.95],
  // Serenitatis, Lacus Somniorum
  [28, 17.5, 10.2, 1.02], [37, 29, 4.5, 0.7], [18, 24, 4.5, 0.95],
  // Tranquillitatis
  [8.5, 31.4, 10, 0.96], [4, 24, 6.5, 0.94], [13, 37, 6, 0.92], [1, 40, 5, 0.9], [-1, 45, 4, 0.9],
  // Crisium, Undarum, Spumans
  [17, 59.1, 8.6, 1.08], [7, 68.6, 2.6, 0.7], [1, 65, 2.4, 0.7],
  // Fecunditatis, Nectaris
  [-5, 51, 7.5, 0.92], [-12, 49, 6.5, 0.9], [-2, 58, 5, 0.9], [-15.2, 35.5, 5.4, 0.96],
  // Frigoris
  [58, -38, 4, 0.86], [57, -22, 4.3, 0.88], [56, -6, 4.3, 0.88], [55.5, 9, 4.2, 0.88], [55.5, 24, 3.8, 0.85], [54.5, 37, 3.2, 0.8],
  [53, -50, 4, 0.82],
  // Oceanus Procellarum and Sinus Roris: broad and a little lighter than Imbrium
  [26, -54, 13, 0.8], [11, -58, 13, 0.8], [-4, -54, 11.5, 0.8], [-14, -47, 8, 0.78], [36, -46, 9, 0.8],
  [44, -58, 7, 0.78], [2, -41, 8.5, 0.76], [18, -41, 8.5, 0.78], [-1, -68, 8, 0.8],
  [28, -36, 7.5, 0.8], [12, -46, 10, 0.78], [-8, -38, 7.5, 0.76], [-6, -30, 5, 0.76], [33, -62, 9, 0.8],
  // Insularum, Cognitum, Nubium, Humorum
  [7.5, -30.9, 6.5, 0.82], [-10, -23.1, 5.6, 0.86], [-21.3, -16.6, 9.5, 0.9], [-17, -10, 5, 0.85], [-24.4, -38.6, 6.2, 1.0],
  // Vaporum, Sinus Medii, Sinus Aestuum
  [13.3, 3.6, 4, 0.86], [2.4, 1.7, 2.8, 0.72], [10.9, -8.8, 3.4, 0.8],
  // Limb maria: Marginis, Smythii, Australe, Humboldtianum
  [13.3, 86.1, 5, 0.72], [1.3, 87.5, 5.5, 0.76], [-40, 82, 5, 0.55], [-46, 70, 3.5, 0.5], [56.8, 81.5, 4.2, 0.62],
];

const RAY_CRATERS = [
  { x: -0.141, y: 0.686, len: 0.9, amp: 0.085, spot: 0.03, seed: 3, collar: 0.08 }, // Tycho
  { x: -0.339, y: -0.167, len: 0.36, amp: 0.075, spot: 0.028, seed: 5, collar: 0.0 }, // Copernicus
  { x: -0.61, y: -0.141, len: 0.22, amp: 0.08, spot: 0.02, seed: 7, collar: 0.0 }, // Kepler
  { x: -0.674, y: -0.402, len: 0.08, amp: 0.05, spot: 0.016, seed: 9, collar: 0.0 }, // Aristarchus
  { x: 0.7, y: -0.277, len: 0.18, amp: 0.06, spot: 0.014, seed: 11, collar: 0.0 }, // Proclus
];

const DARK_FLOORS = [
  { x: -0.102, y: -0.784, r: 0.03 }, // Plato
  { x: -0.925, y: 0.091, r: 0.03 }, // Grimaldi
];

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

export function renderMoon(diameterCss, dpr, color, seed = 1969) {
  const Rd = (diameterCss * dpr) / 2; // radius in device px
  const size = Math.ceil(Rd * 2) + 4;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const data = img.data;
  const cx = size / 2;
  const cy = size / 2;
  const noise = perlin2(32, seed);
  const rays = RAY_CRATERS.map((cr) => ({ ...cr, n: perlin2(64, seed + cr.seed) }));
  const lum = new Float32Array(size * size);
  const mareBuf = new Float32Array(size * size);
  const cell = Math.max(1, Math.round(dpr));
  const edge = 1 + 1.5 / Rd;
  const D2R = Math.PI / 180;
  const maria = MARIA.map(([lat, lon, r, k]) => {
    const la = lat * D2R;
    const lo = lon * D2R;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo), r * D2R, k];
  });
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5 - cy) / Rd;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5 - cx) / Rd;
      const r2 = u * u + v * v;
      if (r2 > edge * edge) continue;
      const z = Math.sqrt(Math.max(0, 1 - r2));
      // Texture coordinates on the sphere, so mottling foreshortens toward the limb.
      const lon = Math.atan2(u, Math.max(z, 1e-3));
      const lat = Math.asin(clamp(v, -1, 1));
      const sx = lon * 3 + 9;
      const sy = lat * 3 + 9;

      // Maria: a soft union of caps (smooth minimum of signed angular distance), the
      // sphere point warped at low frequency so the caps lose their circular outlines.
      // Darkness comes from a separate smooth field so overlapping caps leave no seams.
      const X = u + noise(sx * 1.6 + 3, sy * 1.6 + 1) * 0.032;
      const Y = -v + noise(sx * 1.6 + 7, sy * 1.6 + 5) * 0.032;
      let acc = 0;
      let kw = 0;
      let ww = 0;
      for (let m = 0; m < maria.length; m++) {
        const M = maria[m];
        const dot = X * M[0] + Y * M[1] + z * M[2];
        if (dot < 0.55) continue;
        const ang = Math.acos(Math.min(1, dot));
        acc += Math.exp(-(ang - M[3]) / 0.014);
        const wgt = Math.exp(-((ang / M[3]) ** 2));
        kw += wgt * M[4];
        ww += wgt;
      }
      const dist = acc > 0 ? -0.014 * Math.log(acc) : 1;
      const edgeN = noise(sx * 3.1 + 11, sy * 3.1 + 4) * 0.03 + noise(sx * 8, sy * 8 + 2) * 0.01;
      const dark = ww > 1e-4 ? kw / ww : 0.85;
      const mare = (1 - smoothstep(-0.03, 0.01, dist + edgeN)) * dark;

      const mottle = noise(sx, sy) * 0.5 + noise(sx * 2.3 + 3, sy * 2.3) * 0.3 + noise(sx * 5.1, sy * 5.1 + 4) * 0.2;
      const fine = noise(sx * 12 + 1, sy * 12 + 7) * 0.6 + noise(sx * 25, sy * 25 + 3) * 0.4;
      // Southern highlands are brighter; the limb regions a touch greyer.
      let L = 0.99 + mottle * 0.1 + fine * 0.05 * (1 - mare * 0.6) + smoothstep(0.1, 0.8, v) * 0.03;
      // Maria: darker, with their own internal variation (younger flows darker).
      L -= mare * (0.3 + noise(sx * 2.7 + 13, sy * 2.7 + 1) * 0.14 + noise(sx * 8 + 3, sy * 8) * 0.04);

      for (let k = 0; k < rays.length; k++) {
        const cr = rays[k];
        const dx = u - cr.x;
        const dy = v - cr.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > cr.len * 1.3) continue;
        const a = Math.atan2(dy, dx);
        // Angular streak pattern, softened; rays thin and fade with distance.
        const aw = a + noise(d * 4 + k, k * 3.1) * 0.08;
        const ray = cr.n(Math.cos(aw) * 4.5 + 20, Math.sin(aw) * 4.5 + 20) + cr.n(Math.cos(aw) * 9 + 5, Math.sin(aw) * 9 + 5) * 0.35;
        const streak = smoothstep(0.1, 0.55, ray);
        const fall = Math.exp(-d / (cr.len * 0.38)) * smoothstep(cr.spot, cr.spot * 3.5, d);
        L += cr.amp * streak * fall * (1 - mare * 0.3);
        // Bright ejecta blanket and crater, with a darker collar around Tycho.
        L += cr.amp * 1.6 * Math.exp(-(d * d) / (cr.spot * cr.spot * 2.5));
        if (cr.collar) L -= cr.collar * Math.exp(-(((d - cr.spot * 1.9) / (cr.spot * 0.9)) ** 2));
      }

      for (let k = 0; k < DARK_FLOORS.length; k++) {
        const df = DARK_FLOORS[k];
        const dx = u - df.x;
        const dy = v - df.y;
        L -= 0.2 * Math.exp(-(dx * dx + dy * dy) / (df.r * df.r));
      }

      const i = py * size + px;
      lum[i] = L;
      mareBuf[i] = mare;
    }
  }

  // Small fresh craters read as faint bright specks at full Moon.
  const rand = mulberry32(seed + 77);
  const specks = Math.round(160 * Math.min(1, Rd / 200) + 40);
  for (let k = 0; k < specks; k++) {
    const ang = rand() * TAU;
    const rad = Math.sqrt(rand()) * 0.97;
    const u0 = Math.cos(ang) * rad;
    const v0 = Math.sin(ang) * rad;
    const rr = Math.max(0.6 * dpr, (0.003 + Math.pow(rand(), 4) * 0.012) * Rd);
    const amp = 0.04 + Math.pow(rand(), 2) * 0.16;
    const pxc = cx + u0 * Rd;
    const pyc = cy + v0 * Rd;
    const ext = Math.ceil(rr * 3);
    for (let py = Math.max(0, Math.floor(pyc - ext)); py < Math.min(size, Math.ceil(pyc + ext)); py++) {
      for (let px = Math.max(0, Math.floor(pxc - ext)); px < Math.min(size, Math.ceil(pxc + ext)); px++) {
        const i = py * size + px;
        if (!lum[i]) continue;
        const dx = (px + 0.5 - pxc) / rr;
        const dy = (py + 0.5 - pyc) / rr;
        lum[i] += amp * Math.exp(-(dx * dx + dy * dy)) * (1 - mareBuf[i] * 0.5);
      }
    }
  }

  const levels = 34; // quantisation step for the ordered dither
  const hi = color;
  const lo = [color[0] * 0.93, color[1] * 0.95, color[2] * 0.99]; // cooler, greyer maria
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5 - cy) / Rd;
    const by = ((py / cell) | 0) & 7;
    for (let px = 0; px < size; px++) {
      const i = py * size + px;
      const L0 = lum[i];
      if (!L0) continue;
      const u = (px + 0.5 - cx) / Rd;
      const r2 = u * u + v * v;
      const r = Math.sqrt(r2);
      const z = Math.sqrt(Math.max(0, 1 - r2));
      const limb = 0.86 + 0.14 * Math.pow(z, 0.5);
      const mare = mareBuf[i];
      let L = L0 * limb;
      const bx = ((px / cell) | 0) & 7;
      const th = (BAYER8[by * 8 + bx] + 0.5) / 64 - 0.5;
      L = Math.round(L * levels + th) / levels;
      const o = i * 4;
      const over = Math.max(0, L - 1) * 0.6; // highlights run toward white
      data[o] = clamp((hi[0] + (lo[0] - hi[0]) * mare) * L + over * 40, 0, 255);
      data[o + 1] = clamp((hi[1] + (lo[1] - hi[1]) * mare) * L + over * 50, 0, 255);
      data[o + 2] = clamp((hi[2] + (lo[2] - hi[2]) * mare) * L + over * 70, 0, 255);
      data[o + 3] = clamp((1 - r) * Rd + 0.5, 0, 1) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, size, Rd };
}
