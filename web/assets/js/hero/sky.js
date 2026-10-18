// Sky: the static backdrop (gradient, horizon glow, faint Milky Way, fixed stars,
// moon glow, instrument reticle and the Moon itself), plus the few things that move:
// twinkling stars and satellites in sodium amber.

import { mulberry32, perlin2, smoothstep, clamp, lerp, rgba, mix, TAU } from './noise.js';

// Stars, deterministic per viewport size so a reload shows the same sky.
export function makeStars(L) {
  const { W, horizonY, moon } = L;
  const rand = mulberry32(4242 + Math.round(W));
  const area = W * horizonY;
  const count = Math.round(area / (L.narrow ? 900 : 1150));
  const fixed = [];
  const twinkle = [];
  const band = L.milkyWay;
  const tints = [
    [236, 241, 255],
    [214, 226, 255],
    [255, 236, 214],
    [246, 246, 250],
  ];

  function place(x, y, mag) {
    let a = 0.12 + Math.pow(mag, 3.2) * 0.9;
    const r = 0.32 + Math.pow(mag, 7) * 1.25;
    const dm = Math.hypot(x - moon.cx, y - moon.cy);
    if (dm < moon.R * 1.15) return;
    a *= smoothstep(moon.R * 1.2, moon.R * 6, dm) * 0.85 + 0.15 * smoothstep(moon.R * 1.15, moon.R * 2, dm);
    a *= smoothstep(horizonY + 4, horizonY - L.H * 0.16, y) * 0.85 + 0.15;
    if (y > horizonY - 2) return;
    for (const b of L.navBoxes || []) if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return;
    const tint = tints[(rand() * tints.length) | 0];
    const s = { x, y, r, a, c: tint };
    if (mag > 0.8 && a > 0.25 && y > L.navH + 8) {
      s.w = 0.6 + rand() * 1.6;
      s.w2 = 0.23 + rand() * 0.5;
      s.p = rand() * TAU;
      s.p2 = rand() * TAU;
      twinkle.push(s);
    } else {
      fixed.push(s);
    }
  }

  for (let i = 0; i < count; i++) place(rand() * W, rand() * horizonY, rand());

  // Extra faint stars concentrated along the Milky Way band.
  if (band) {
    const extra = Math.round(count * 0.7);
    for (let i = 0; i < extra; i++) {
      const t = rand();
      const off = (rand() + rand() + rand() - 1.5) * band.width * 0.9;
      const x = lerp(band.x0, band.x1, t) + band.nx * off;
      const y = lerp(band.y0, band.y1, t) + band.ny * off;
      if (x < 0 || x > W || y < 0) continue;
      place(x, y, rand() * 0.72);
    }
  }
  return { fixed, twinkle };
}

export function paintBackdrop(L, P, moonSprite, stars) {
  const { W, H, dpr, horizonY, moon } = L;
  const c = document.createElement('canvas');
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Sky gradient: page ground at the zenith, a cool lift toward the horizon.
  const sky = g.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, rgba(P.sky0, 1));
  sky.addColorStop(0.42, rgba(mix(P.sky0, P.sky1, 0.7), 1));
  sky.addColorStop(0.78, rgba(mix(P.sky1, P.sky2, 0.55), 1));
  sky.addColorStop(1, rgba(P.horizon, 1));
  g.fillStyle = sky;
  g.fillRect(0, 0, W, horizonY + 1);
  g.fillStyle = rgba(P.haze, 1);
  g.fillRect(0, horizonY, W, H - horizonY);

  // Horizon glow, a little brighter below the Moon.
  g.globalCompositeOperation = 'lighter';
  const hg = g.createRadialGradient(moon.cx, horizonY, 0, moon.cx, horizonY, Math.max(W, H) * 0.75);
  hg.addColorStop(0, rgba(P.wire, 0.07));
  hg.addColorStop(0.4, rgba(P.wire, 0.03));
  hg.addColorStop(1, rgba(P.wire, 0));
  g.fillStyle = hg;
  g.save();
  g.translate(0, horizonY);
  g.scale(1, 0.32);
  g.translate(0, -horizonY);
  g.fillRect(0, horizonY - H * 2, W, H * 2);
  g.restore();

  // Milky Way: a faint, mottled band, rendered small and scaled up.
  if (L.milkyWay) paintMilkyWay(g, L, P);

  // Fixed stars.
  for (const s of stars.fixed) {
    g.globalAlpha = s.a;
    g.fillStyle = rgba(s.c, 1);
    g.beginPath();
    g.arc(s.x, s.y, s.r, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  // Moon glow: three soft layers, added.
  const R = moon.R;
  const layers = [
    [R * 0.98, R * 1.6, 0.36, 2.6],
    [R * 0.98, R * 3.4, 0.12, 2.2],
    [R * 1.0, R * 10, 0.06, 2.0],
  ];
  for (const [r0, r1, a, p] of layers) {
    const gr = g.createRadialGradient(moon.cx, moon.cy, r0, moon.cx, moon.cy, r1);
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      gr.addColorStop(s, rgba(P.moonGlow, a * Math.pow(1 - s, p)));
    }
    g.fillStyle = gr;
    g.beginPath();
    g.arc(moon.cx, moon.cy, r1, 0, TAU);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';

  // Instrument reticle around the Moon.
  g.strokeStyle = rgba(P.ink2, 0.2);
  g.lineWidth = 1 / dpr;
  g.beginPath();
  const rr = R + Math.max(9, R * 0.1);
  for (let d = 0; d < 360; d += 5) {
    const t = (d * Math.PI) / 180;
    const major = d % 45 === 0;
    const len = major ? Math.max(5, R * 0.06) : 2.2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    g.moveTo(moon.cx + ct * rr, moon.cy + st * rr);
    g.lineTo(moon.cx + ct * (rr + len), moon.cy + st * (rr + len));
  }
  g.stroke();

  // Dimension line under the Moon: one Moon diameter.
  const dy = moon.cy + moon.dimY;
  g.strokeStyle = rgba(P.ink2, 0.42);
  g.lineWidth = 1 / dpr;
  g.beginPath();
  g.moveTo(moon.cx - R, dy);
  g.lineTo(moon.cx + R, dy);
  g.moveTo(moon.cx - R, dy - 3);
  g.lineTo(moon.cx - R, dy + 3);
  g.moveTo(moon.cx + R, dy - 3);
  g.lineTo(moon.cx + R, dy + 3);
  g.stroke();

  // The Moon, pixel-aligned in device space.
  g.setTransform(1, 0, 0, 1, 0, 0);
  const mx = Math.round(moon.cx * dpr - moonSprite.size / 2);
  const my = Math.round(moon.cy * dpr - moonSprite.size / 2);
  g.drawImage(moonSprite.canvas, mx, my);

  // Fine grain over the sky, which also breaks up gradient banding.
  const tile = grainTile();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = g.createPattern(tile, 'repeat');
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  return c;
}

let grainCache = null;
function grainTile() {
  if (grainCache) return grainCache;
  const t = document.createElement('canvas');
  t.width = t.height = 128;
  const g = t.getContext('2d');
  const img = g.createImageData(128, 128);
  const rand = mulberry32(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rand() * 3.2) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v + ((rand() * 1.6) | 0);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainCache = t;
  return t;
}

function paintMilkyWay(g, L, P) {
  const band = L.milkyWay;
  const sc = 4;
  const w = Math.ceil(L.W / sc);
  const h = Math.ceil(L.horizonY / sc);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cg = c.getContext('2d');
  const img = cg.createImageData(w, h);
  const noise = perlin2(16, 314);
  const len = Math.hypot(band.x1 - band.x0, band.y1 - band.y0);
  const tx = (band.x1 - band.x0) / len;
  const ty = (band.y1 - band.y0) / len;
  const col = [168, 186, 222];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x * sc;
      const py = y * sc;
      const rx = px - band.x0;
      const ry = py - band.y0;
      const along = rx * tx + ry * ty;
      const across = rx * band.nx + ry * band.ny;
      const t = along / len;
      if (t < -0.1 || t > 1.1) continue;
      const wv = band.width * (0.8 + 0.4 * noise(t * 3 + 1, 2));
      const core = Math.exp(-((across / wv) ** 2));
      const n1 = noise(px / 140 + 3, py / 140 + 1) * 0.5 + noise(px / 60, py / 60 + 7) * 0.3 + noise(px / 24 + 5, py / 24) * 0.2;
      const dust = Math.max(0, noise(px / 90 + 11, py / 90 + 2) + 0.05) * Math.exp(-((across / (wv * 0.35)) ** 2));
      let v = core * (0.55 + n1 * 1.1) - dust * 0.9;
      v *= smoothstep(-0.1, 0.2, t) * smoothstep(1.1, 0.75, t);
      v *= smoothstep(L.horizonY, L.horizonY * 0.55, py) * 0.6 + 0.4;
      const dm = Math.hypot(px - L.moon.cx, py - L.moon.cy);
      v *= smoothstep(L.moon.R * 2, L.moon.R * 9, dm);
      v = clamp(v, 0, 1);
      const o = (y * w + x) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = v * 255 * 0.085;
    }
  }
  cg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, w * sc, h * sc);
}

export function drawTwinkle(ctx, stars, t, still) {
  for (const s of stars.twinkle) {
    const tw = still ? 0.9 : 0.8 + 0.2 * Math.sin(t * s.w + s.p) * (0.6 + 0.4 * Math.sin(t * s.w2 + s.p2));
    const a = s.a * tw;
    ctx.fillStyle = rgba(s.c, 1);
    if (s.r > 0.9) {
      ctx.globalAlpha = a * 0.12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Satellites: tiny sodium points crossing slowly. Some fade into Earth's shadow
// mid-sky, and now and then one catches the Sun and glints.
export function createSatellites(seed = 7) {
  const rand = mulberry32(seed);
  let list = [];
  let L = null;

  function spawn(age0 = 0) {
    const fromLeft = rand() < 0.5;
    const yTop = L.navH + 10;
    const y = lerp(yTop, L.horizonY * 0.82, rand());
    const ang = (rand() - 0.5) * 0.7;
    const speed = L.W * (0.007 + rand() * 0.006);
    const dir = fromLeft ? 1 : -1;
    const s = {
      x: fromLeft ? -6 : L.W + 6,
      y,
      vx: Math.cos(ang) * speed * dir,
      vy: Math.sin(ang) * speed,
      age: 0,
      b: 0.5 + rand() * 0.35,
      glint: 5 + rand() * 30,
      shadow: rand() < 0.4 ? 18 + rand() * 50 : Infinity,
    };
    // Pre-advance so the first frame does not start with every satellite on an edge.
    const pre = age0 * rand();
    s.x += s.vx * pre;
    s.y += s.vy * pre;
    s.age = pre;
    return s;
  }

  return {
    layout(layout) {
      L = layout;
      // The still frame picks a few streaks that stay clear of the Moon, the marks
      // and the readout, from a larger pool of candidates.
      const n = L.still ? 14 : L.narrow ? 3 : 5;
      list = [];
      for (let i = 0; i < n; i++) list.push(spawn(90));
    },
    update(dt) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const gone = s.x < -10 || s.x > L.W + 10 || s.y > L.horizonY || s.y < 0 || s.age > s.shadow + 3;
        if (gone) list[i] = spawn(0);
      }
    },
    draw(ctx, P, still) {
      let drawn = 0;
      const clear = (x, y) => !(L.avoid || []).some((b) => x > b[0] && x < b[2] && y > b[1] && y < b[3]);
      for (const s of list) {
        if (still) {
          if (drawn >= (L.narrow ? 2 : 3)) break;
          const x0 = s.x - s.vx * 4.5;
          const y0 = s.y - s.vy * 4.5;
          if (!clear(s.x, s.y) || !clear(x0, y0) || !clear((s.x + x0) / 2, (s.y + y0) / 2)) continue;
          if (s.y > L.horizonY - 30 || s.y < L.navH + 10 || s.x < 4 || s.x > L.W - 4) continue;
        }
        let a = s.b * smoothstep(0, 3, s.age) * smoothstep(L.horizonY, L.horizonY - 40, s.y) * smoothstep(L.navH - 6, L.navH + 24, s.y);
        if (s.shadow !== Infinity) a *= smoothstep(s.shadow + 2.5, s.shadow, s.age);
        if (a <= 0.01) continue;
        if (still) {
          // Long-exposure look for the still frame: a short streak.
          const len = 4.5;
          const g = ctx.createLinearGradient(s.x - s.vx * len, s.y - s.vy * len, s.x, s.y);
          g.addColorStop(0, rgba(P.sodium, 0));
          g.addColorStop(1, rgba(P.sodium, a * 0.75));
          ctx.strokeStyle = g;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(s.x - s.vx * len, s.y - s.vy * len);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
          drawn++;
          continue;
        }
        const gd = (s.age - s.glint) / 0.32;
        const gl = Math.exp(-gd * gd);
        if (s.age > s.glint + 2) s.glint = s.age + 12 + Math.random() * 30;
        ctx.fillStyle = rgba(P.sodium, 1);
        ctx.globalAlpha = Math.min(1, (0.1 + gl * 0.3) * (a + gl));
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.6 + gl * 7, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = Math.min(1, a + gl * 0.6);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 0.95 + gl * 1.2, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}
