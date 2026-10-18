// The TOI drawn to scale beside the Moon. Each mark is a disc whose area relative to
// the Moon's disc equals the index, so its radius is R☾·√TOI.
//   facing:   solid dark disc that occludes the sky, crisp sodium rim
//   absolute: thin sodium ring over a faint tessellation of packed panels
//   apparent: soft sodium halo whose half-strength contour sits at its radius

import { smoothstep, lerp, rgba, TAU } from './noise.js';

export const NAMES = { absolute: 'ABSOLUTE', facing: 'FACING', apparent: 'APPARENT' };

export function markGeometry(moon, values) {
  const r = (v) => (Number.isFinite(v) && v > 0 ? moon.R * Math.sqrt(v) : 0);
  return {
    rAbs: r(values.absolute),
    rFac: r(values.facing),
    rApp: r(values.apparent),
  };
}

const HALO_OUTER = 1.42; // halo extent in units of the apparent radius

export function makeSprites(geom, P, dpr) {
  const sprites = {};
  if (geom.rApp > 0) {
    const outer = geom.rApp * HALO_OUTER;
    const size = Math.ceil(outer * 2 * dpr) + 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const h = size / 2;
    const gr = g.createRadialGradient(h, h, 0, h, h, outer * dpr);
    for (let i = 0; i <= 16; i++) {
      const s = i / 16;
      const rr = s * HALO_OUTER; // in units of rApp
      // Smooth falloff with exactly half strength at rr = 1.
      const a = 1 - smoothstep(0.58, HALO_OUTER, rr);
      gr.addColorStop(s, rgba(P.sodium, a));
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    sprites.halo = { canvas: c, size };
  }
  if (geom.rAbs > 0) {
    const r = geom.rAbs;
    const size = Math.ceil(r * 2 * dpr) + 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const h = size / 2;
    g.save();
    g.beginPath();
    g.arc(h, h, r * dpr, 0, TAU);
    g.clip();
    g.fillStyle = rgba(P.sodium, 0.16);
    g.fillRect(0, 0, size, size);
    // Packed solar panels, brick-bonded.
    const cw = Math.max(3.2, r / 4.6) * dpr;
    const ch = cw * 0.46;
    const gap = Math.max(1, dpr * 0.75);
    g.fillStyle = rgba(P.sodium, 0.5);
    let row = 0;
    for (let y = -ch; y < size + ch; y += ch + gap, row++) {
      const off = row % 2 ? (cw + gap) / 2 : 0;
      for (let x = -cw + off; x < size + cw; x += cw + gap) g.fillRect(x, y, cw, ch);
    }
    g.restore();
    sprites.panels = { canvas: c, size };
  }
  return sprites;
}

export function drawMarks(ctx, M, em, P, sprites, dpr) {
  const { tx, ty, rAbs, rFac, rApp } = M;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const X = tx * dpr;
  const Y = ty * dpr;

  if (sprites.halo) {
    ctx.globalAlpha = lerp(0.07, 0.42, em.apparent);
    ctx.drawImage(sprites.halo.canvas, Math.round(X - sprites.halo.size / 2), Math.round(Y - sprites.halo.size / 2));
  }
  if (sprites.panels) {
    ctx.globalAlpha = lerp(0.1, 0.34, em.absolute);
    ctx.drawImage(sprites.panels.canvas, Math.round(X - sprites.panels.size / 2), Math.round(Y - sprites.panels.size / 2));
  }
  ctx.restore();

  if (rFac > 0) {
    ctx.globalAlpha = lerp(0.42, 1, em.facing);
    ctx.fillStyle = rgba(P.sky0, 1);
    ctx.beginPath();
    ctx.arc(tx, ty, rFac, 0, TAU);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  if (rAbs > 0) {
    ctx.strokeStyle = rgba(P.sodium, lerp(0.34, 1, em.absolute));
    ctx.beginPath();
    ctx.arc(tx, ty, rAbs, 0, TAU);
    ctx.stroke();
  }
  if (rFac > 0) {
    ctx.strokeStyle = rgba(P.sodium, lerp(0.34, 1, em.facing));
    ctx.beginPath();
    ctx.arc(tx, ty, rFac, 0, TAU);
    ctx.stroke();
  }
  if (rApp > 0) {
    // Always faintly drawn, so the apparent leader lands on a visible boundary.
    ctx.setLineDash([1, 2.5]);
    ctx.strokeStyle = rgba(P.sodium, lerp(0.26, 0.8, em.apparent));
    ctx.beginPath();
    ctx.arc(tx, ty, rApp, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Leader lines and labels. Leaders leave each mark from its lower edge, drop to a
// shared label column to the right, and the labels stack smallest disc first.
export function drawLabels(ctx, M, em, P, values, moon, moonDeg, fmt) {
  const { tx, ty } = M;
  const fs = M.fs;
  const lh = Math.round(fs * 1.75);
  ctx.font = `500 ${fs}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(fs * 0.1).toFixed(2)}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const capMid = Math.round(fs * 0.36);

  const items = [
    { k: 'facing', r: M.rFac, ang: 76 },
    { k: 'absolute', r: M.rAbs, ang: 104 },
    { k: 'apparent', r: M.rApp, ang: 128 },
  ].filter((it) => it.r > 0);

  const anchorX = (it) => tx + it.r * Math.cos((it.ang * Math.PI) / 180);
  const xL = Math.max(...items.map(anchorX)) + Math.max(12, fs * 1.3);
  const y0 = M.labelY;
  const hair = Math.max(0.5, 1 / M.dpr);

  items.forEach((it, i) => {
    const e = em[it.k];
    const a = (it.ang * Math.PI) / 180;
    const ax = tx + it.r * Math.cos(a);
    const ay = ty + it.r * Math.sin(a);
    const ly = y0 + i * lh;
    const lineA = lerp(0.3, 0.8, e);
    ctx.strokeStyle = rgba(P.ink2, lineA);
    ctx.lineWidth = hair;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax, ly - capMid);
    ctx.lineTo(xL - 5, ly - capMid);
    ctx.stroke();
    ctx.fillStyle = rgba(e > 0.5 ? P.sodium : P.ink2, lerp(0.5, 1, e));
    ctx.beginPath();
    ctx.arc(ax, ay, lerp(1.1, 1.6, e), 0, TAU);
    ctx.fill();

    const val = fmt(values[it.k]);
    const sep = ' · ';
    ctx.fillStyle = rgba(P.sodium, lerp(0.42, 1, e));
    ctx.fillText(val, xL, ly);
    const w = ctx.measureText(val).width;
    ctx.fillStyle = rgba(e > 0.5 ? P.ink1 : P.ink2, lerp(0.42, 1, e));
    ctx.fillText(sep + NAMES[it.k], xL + w, ly);
  });

  // The unit, under the Moon.
  const deg = Number.isFinite(moonDeg) ? `${moonDeg.toFixed(3)}°` : '0.518°';
  const text = `1 MOON · ${deg}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = rgba(P.ink2, 0.9);
  ctx.fillText(text, moon.cx, moon.cy + moon.labelDy);
  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
