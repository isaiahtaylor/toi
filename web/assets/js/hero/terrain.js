// The survey terrain: a tiling heightfield drawn as fixed scan lines receding to the
// horizon while the land drifts toward the viewer underneath them. Rows are painted
// far to near; each row fills the ground below its ridge line before stroking it, so
// nearer ridges hide whatever lies behind them.

import { perlin2, clamp, smoothstep } from './noise.js';

const LO_N = 256; // samples per tile edge, broad landforms
const LO_L = 128; // world units per tile
const HI_N = 256; // detail band
const HI_L = 24;

export const TERRAIN_SPEED = 0.42;
const CRESTS = [
  [0.78, 0.32],
  [1.35, 0.42],
]; // world units per second (camera height is 1)

function bake(N, period, seed, octaves, ridged) {
  const noise = perlin2(period, seed);
  const grid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i / N) * period;
      const y = (j / N) * period;
      let sum = 0;
      let amp = 1;
      let norm = 0;
      let f = 1;
      for (let o = 0; o < octaves; o++) {
        let n = noise(x * f + o * 5.31, y * f + o * 9.17);
        if (ridged) {
          n = 1 - Math.abs(n) * 1.45;
          n *= n;
        }
        sum += n * amp;
        norm += amp;
        amp *= 0.5;
        f *= 2;
      }
      grid[j * N + i] = sum / norm;
    }
  }
  return grid;
}

function sampler(grid, N, L) {
  const s = N / L;
  return function sample(x, z) {
    let fx = x * s;
    let fz = z * s;
    fx -= Math.floor(fx / N) * N;
    fz -= Math.floor(fz / N) * N;
    let i0 = fx | 0;
    let j0 = fz | 0;
    if (i0 >= N) i0 -= N;
    if (j0 >= N) j0 -= N;
    const tx = fx - i0;
    const tz = fz - j0;
    const i1 = i0 + 1 === N ? 0 : i0 + 1;
    const r0 = j0 * N;
    const r1 = (j0 + 1 === N ? 0 : j0 + 1) * N;
    const a = grid[r0 + i0];
    const b = grid[r0 + i1];
    const c = grid[r1 + i0];
    const d = grid[r1 + i1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
}

export function createTerrain(seed = 11) {
  const lo = sampler(bake(LO_N, 8, seed, 3, true), LO_N, LO_L);
  const hi = sampler(bake(HI_N, 8, seed + 101, 3, false), HI_N, HI_L);

  // A valley meanders along the direction of travel; the land rises into ridges on
  // either side. lod (0..1) fades out fine detail on distant rows, which are spaced
  // too far apart in depth to sample it without shimmer.
  function height(x, z, lod) {
    const path = 2.4 * Math.sin(z * 0.041) + 1.3 * Math.sin(z * 0.113 + 1.7);
    const d = Math.abs(x - path);
    let m = (d - 0.9) / 7;
    m = m < 0 ? 0 : m > 1 ? 1 : m;
    m = m * m * (3 - 2 * m);
    // The left flank (behind the readout) stays as low hills; mountains rise on the
    // right, below the Moon.
    const side = x < path ? 0.42 : 1;
    const big = lo(x, z);
    const h = 0.22 + big * (0.42 + 2.6 * m * m * side) + hi(x, z) * (0.16 + 0.26 * m) * lod;
    return h > 0 ? h : 0;
  }

  return { height };
}

// Precompute the fixed scan rows for a viewport. Rows are listed far to near.
export function layoutTerrain({ W, H, horizonY, vpX, narrow, palette }) {
  const f = H * 0.92; // focal length, px
  const camH = 1;
  // The valley floor sits about 0.25 above the base plane; start rows close enough
  // that the land reaches the bottom edge.
  const zNear = (f * (camH - 0.3)) / (H - horizonY + 6);
  const zFar = 84;
  const ratio = narrow ? 1.1 : 1.082;
  const step = narrow ? 5 : 6; // px between height samples along a row
  const margin = 12;

  const zs = [];
  for (let z = zNear; z < zFar; z *= ratio) zs.push(z);
  zs.reverse();

  const n = Math.ceil((W + 2 * margin) / step) + 1;
  const xs = new Float32Array(n);
  for (let i = 0; i < n; i++) xs[i] = -margin + i * step;

  const colStep = 0.9; // world units between longitudinal lines
  const rows = [];
  let prevBase = horizonY;
  for (const z of zs) {
    const k = f / z;
    const wx = new Float32Array(n);
    for (let i = 0; i < n; i++) wx[i] = (xs[i] - vpX) / k;
    const yBase = horizonY + camH * k;
    // Fog: lines fade with distance; ground fill lightens toward the horizon haze.
    const fog = 1 - Math.exp(-z / 15);
    const alpha = clamp(1.08 * Math.exp(-z / 24), 0, 0.86) * smoothstep(zFar, zFar * 0.62, z);
    const fill = [
      Math.round(palette.ground[0] + (palette.haze[0] - palette.ground[0]) * fog),
      Math.round(palette.ground[1] + (palette.haze[1] - palette.ground[1]) * fog),
      Math.round(palette.ground[2] + (palette.haze[2] - palette.ground[2]) * fog),
    ];
    let cols = null;
    let dots = null;
    if (z < 30) {
      const x0 = (-margin - vpX) / k;
      const x1 = (W + margin - vpX) / k;
      const c = [];
      for (let j = Math.ceil(x0 / colStep - 0.5); j <= Math.floor(x1 / colStep - 0.5); j++) c.push((j + 0.5) * colStep);
      cols = Float32Array.from(c);
      const d = [];
      const dotStep = colStep / 2;
      for (let j = Math.ceil(x0 / dotStep - 0.5); j <= Math.floor(x1 / dotStep - 0.5); j++) d.push((j + 0.5) * dotStep);
      dots = Float32Array.from(d);
    }
    rows.push({
      z,
      k,
      yBase,
      ybot: prevBase,
      wx,
      ys: new Float32Array(n),
      alpha,
      fill: `rgb(${fill[0]},${fill[1]},${fill[2]})`,
      lw: clamp(1.25 - z / 46, 0.55, 1.15),
      lod: clamp(1.35 - z / 34, 0.18, 1),
      cols,
      dots,
      dotR: clamp(1.25 - z / 26, 0.45, 1.1),
    });
    prevBase = yBase;
  }

  return { f, camH, xs, rows, zNear, zFar, horizonY, vpX };
}

// Draw the terrain for travel distance `travel`. `scanZ` (or null) brightens rows near
// that depth: a slow survey pulse sweeping toward the viewer.
export function drawTerrain(ctx, terrain, T, travel, wireStyle, crestStyle, scanZ) {
  const { xs, rows, horizonY, camH, vpX } = T;
  const n = xs.length;
  const hs = T.hs || (T.hs = new Float32Array(n));
  const height = terrain.height;
  let prev = null;
  const lnScan = scanZ ? Math.log(scanZ) : 0;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const { k, wx, ys, lod } = row;
    const zw = row.z + travel;
    for (let i = 0; i < n; i++) {
      const h = height(wx[i], zw, lod);
      hs[i] = h;
      ys[i] = horizonY + (camH - h) * k;
    }

    let boost = 0;
    if (scanZ) {
      const d = (Math.log(row.z) - lnScan) / 0.07;
      boost = Math.exp(-d * d) * 0.5;
    }
    const a = Math.min(1, row.alpha * (1 + boost * 1.6) + boost * 0.25);

    // Longitudinal lines between the previous (farther) row and this one. They are
    // drawn before this row's ground fill so a ridge here hides the parts behind it.
    // Near the camera the columns are hundreds of pixels apart and read as stray
    // diagonals, so they fade out there.
    const colA = a * 0.42 * smoothstep(3.2, 8, row.z);
    if (prev && row.cols && colA > 0.01) {
      const pk = prev.k;
      const pzw = prev.z + travel;
      ctx.beginPath();
      const cols = row.cols;
      for (let j = 0; j < cols.length; j++) {
        const x = cols[j];
        ctx.moveTo(vpX + x * pk, horizonY + (camH - height(x, pzw, prev.lod)) * pk);
        ctx.lineTo(vpX + x * k, horizonY + (camH - height(x, zw, lod)) * k);
      }
      ctx.globalAlpha = colA;
      ctx.lineWidth = row.lw * 0.75;
      ctx.strokeStyle = wireStyle;
      ctx.stroke();
    }

    // Ground below the ridge line, down to where the previous rows ended.
    const yb = row.ybot;
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(xs[i], ys[i] > yb ? ys[i] : yb);
    ctx.closePath();
    ctx.globalAlpha = 1;
    ctx.fillStyle = row.fill;
    ctx.fill();

    if (a > 0.01) {
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.globalAlpha = a * 0.72;
      ctx.lineWidth = row.lw;
      ctx.strokeStyle = wireStyle;
      ctx.stroke();

      // Moonlit crests: higher ground gets a second, lighter stroke, so the ridges
      // carry the light and the valley floor stays quiet.
      for (const [hMin, crestA] of CRESTS) {
        ctx.beginPath();
        let on = false;
        for (let i = 0; i < n; i++) {
          if (hs[i] > hMin) {
            if (on) ctx.lineTo(xs[i], ys[i]);
            else {
              ctx.moveTo(xs[i], ys[i]);
              on = true;
            }
          } else on = false;
        }
        ctx.globalAlpha = a * crestA;
        ctx.strokeStyle = crestStyle;
        ctx.stroke();
      }

      // Survey returns: small points on the lattice.
      if (row.dots) {
        const dots = row.dots;
        const s = row.dotR * (1 + boost);
        ctx.beginPath();
        for (let j = 0; j < dots.length; j++) {
          const x = dots[j];
          const px = vpX + x * k;
          const py = horizonY + (camH - height(x, zw, lod)) * k;
          ctx.rect(px - s, py - s, s * 2, s * 2);
        }
        ctx.globalAlpha = Math.min(1, a * 1.15);
        ctx.fillStyle = wireStyle;
        ctx.fill();
      }
    }
    prev = row;
  }
  ctx.globalAlpha = 1;
}
