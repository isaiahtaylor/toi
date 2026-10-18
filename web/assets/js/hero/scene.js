// The hero canvas: lays out the night survey for the current viewport, keeps the
// static parts in an offscreen backdrop, and animates the rest. Pauses when the hero
// is off screen or the tab is hidden; with reduced motion it renders one still frame.
// With data-mode="card" on the hero (web/src/og.html) it renders the social preview
// card instead: one still frame at a fixed size, a larger Moon, and a label on the
// selected mark only.

import { clamp, easeInOutCubic, rgba } from './noise.js';
import { createTerrain, layoutTerrain, drawTerrain, TERRAIN_SPEED } from './terrain.js';
import { renderMoon } from './moon.js';
import { makeStars, paintBackdrop, drawTwinkle, createSatellites } from './sky.js';
import { markGeometry, makeSprites, drawMarks, drawLabels } from './marks.js';

const KEYS = ['absolute', 'facing', 'apparent'];
const FADE_MS = 400;

function parseColor(s, fallback) {
  s = (s || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) return m[1].split(',').slice(0, 3).map((v) => Math.round(parseFloat(v)));
  return fallback;
}

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fb) => parseColor(cs.getPropertyValue(name), fb);
  const sky0 = get('--sky-0', [3, 5, 11]);
  const sky1 = get('--sky-1', [7, 12, 24]);
  const sky2 = get('--sky-2', [13, 21, 38]);
  return {
    sky0,
    sky1,
    sky2,
    horizon: [20, 33, 56],
    haze: [12, 21, 37],
    ground: [3, 6, 12],
    wire: get('--wire', [143, 183, 216]),
    sodium: get('--sodium', [255, 173, 77]),
    moon: get('--moon', [244, 236, 214]),
    moonGlow: get('--moon-glow', [255, 232, 179]),
    ink1: get('--ink-1', [232, 236, 245]),
    ink2: get('--ink-2', [170, 179, 200]),
    ink3: get('--ink-3', [126, 136, 162]),
  };
}

export function createScene({ canvas, hero, readout, nav, narrowQuery, values, moonDeg, reduced, format }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  const card = hero.dataset.mode === 'card';
  const still = reduced || card;

  const P = readPalette();
  const terrain = createTerrain(11);
  const sats = createSatellites(7);
  let vals = { ...values };
  let deg = moonDeg;
  let L = null; // layout
  let backdrop = null;
  let moonCache = null;
  let sprites = {};
  let stars = null;
  let wireStyle = null;
  let crestStyle = null;
  let fade = null;
  let fontsReady = false;
  let selected = KEYS.includes(hero.dataset.selected) ? hero.dataset.selected : 'facing';
  const em = { absolute: 0, facing: 0, apparent: 0, [selected]: 1 };
  let tween = null; // { from, to, t0 }
  let raf = 0;
  let inView = true;
  let last = 0;
  let clock = 0; // animation time in seconds, advances only while running
  const STILL_T = 37; // time used for the still frame (reduced motion, card)

  function layout() {
    const rect = hero.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width));
    const H = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const narrow = narrowQuery.matches;
    const navH = nav ? nav.getBoundingClientRect().bottom - rect.top : 0;
    // Keep stars out from behind the nav text.
    const navBoxes = nav
      ? [...nav.querySelectorAll('.hero__wordmark, .hero__links')].map((a) => {
          const r = a.getBoundingClientRect();
          return [r.left - rect.left - 8, r.top - rect.top - 6, r.right - rect.left + 8, r.bottom - rect.top + 6];
        })
      : [];
    const ro = readout.getBoundingClientRect();
    const roRight = ro.right - rect.left;
    const roTop = ro.top - rect.top;
    const sApp = Math.sqrt(Math.max(vals.apparent || 0, vals.absolute || 0, 0.01));

    let D;
    let cx;
    let cy;
    let horizonY;
    let vpX;
    const fs = card ? 16 : narrow ? 9.5 : 10.5;
    let gapK = 1; // gap between the Moon and the outer mark, in Moon diameters
    // Horizontal room the Moon and the marks need, for a Moon of diameter D.
    const span = (D) => D * 0.5 + D * gapK + D * 0.5 * sApp * 1.42 + D * 0.5 + D * 0.16;
    if (card) {
      // A fixed frame (1200×630): the Moon a third of the height, set high on the
      // right, the marks between it and the readout, the land in the lower quarter
      // so the ridges stay clear of the Moon's label.
      horizonY = Math.round(H * 0.74);
      D = Math.round(H * 0.33);
      const availL = roRight + W * 0.05;
      const availR = W - W * 0.06;
      const avail = availR - availL;
      if (span(D) > avail) gapK = Math.max(0.6, 1 - (span(D) - avail) / D);
      if (span(D) > avail) D = Math.max(96, D * (avail / span(D)));
      cx = availR - D * 0.5;
      cy = Math.round(H * 0.32);
      vpX = W * 0.56;
    } else if (!narrow) {
      const short = H <= 520; // phones on their side
      horizonY = Math.round(H * (short ? 0.74 : 0.62));
      D = clamp(Math.min(H * 0.235, W * 0.16), Math.min(120, H * 0.26), 260);
      const padR = Math.max(16, W * 0.05);
      const availL = roRight + W * 0.04;
      const availR = W - padR;
      const avail = availR - availL;
      // Marks sit a gap of one Moon diameter to the Moon's left. When space is short
      // the gap closes first (to under half a diameter), then the Moon shrinks.
      if (span(D) > avail) gapK = Math.max(0.45, 1 - (span(D) - avail) / D);
      if (span(D) > avail) D = Math.max(64, D * (avail / span(D)));
      const right = D * 0.66;
      const slack = Math.max(0, availR - availL - span(D));
      cx = availR - right - slack * 0.3;
      cy = clamp(H * 0.31, navH + D * 0.85, horizonY - D * 1.35);
      vpX = W * 0.56;
    } else {
      // Must match the padding-top of .hero__body in the narrow block of hero.css.
      D = clamp(Math.min(W * 0.28, H * 0.21), 84, 200);
      const padR = Math.max(16, W * 0.05);
      cx = W - padR - D * 0.62;
      cy = navH + D * 0.8;
      horizonY = 0; // set below, once the label stack is known
      vpX = W * 0.5;
    }
    const R = D / 2;
    const geom = markGeometry({ R }, vals);
    const gap = D * gapK; // normally one Moon diameter between the Moon's edge and the outer mark
    const tx = cx - R - gap - geom.rApp;
    const ty = cy;
    const dimY = R + Math.max(16, R * 0.2);
    const labelDy = dimY + Math.round(fs * 1.9);
    const moon = { cx, cy, R, D, dimY, labelDy };
    // The mark labels start one line lower when they would otherwise run into the
    // Moon's label on the same baseline (always on narrow screens, and on short
    // landscape screens where the Moon sits close to the marks).
    const labelX0 = tx + geom.rFac * Math.cos((76 * Math.PI) / 180) + Math.max(12, fs * 1.3);
    const labelsRight = labelX0 + fs * 0.72 * 18;
    const moonLabelLeft = cx - (fs * 0.72 * 17) / 2;
    const dropLabels = narrow || labelsRight + fs > moonLabelLeft;
    const labelY = cy + labelDy + (dropLabels ? Math.round(fs * 1.75) : 0);
    if (narrow) {
      // Let a band of ridges show between the label stack and the readout.
      const labelsBottom = labelY + Math.round(fs * 1.75) * 2 + 10;
      horizonY = Math.round(clamp(roTop - 8, labelsBottom + 18, H * 0.62));
    }

    const band = narrow
      ? null
      : {
          x0: W * 0.04,
          y0: horizonY * 1.02,
          x1: W * 0.5,
          y1: -H * 0.08,
          width: Math.min(W, H) * 0.075,
        };
    if (band) {
      const len = Math.hypot(band.x1 - band.x0, band.y1 - band.y0);
      band.nx = -(band.y1 - band.y0) / len;
      band.ny = (band.x1 - band.x0) / len;
    }

    L = {
      W,
      H,
      dpr,
      narrow,
      navH,
      navBoxes,
      horizonY,
      vpX,
      moon,
      milkyWay: band,
      // The card labels only the selected mark, so it still reads at thumbnail size.
      marks: { tx, ty, ...geom, fs, dpr, labelY, only: card ? [selected] : null },
    };
    const lh = Math.round(fs * 1.75);
    L.still = still;
    L.avoid = [
      [cx - R * 1.5, cy - R * 1.5, cx + R * 1.5, cy + labelDy + 12],
      [tx - geom.rApp * 1.6, ty - geom.rApp * 1.6, tx + geom.rApp + fs * 14, labelY + lh * 3],
      [ro.left - rect.left - 12, ro.top - rect.top - 12, roRight + 12, ro.bottom - rect.top + 12],
    ];
    // Stars stay out from behind the canvas labels.
    const xL = tx + geom.rFac * Math.cos((76 * Math.PI) / 180) + Math.max(12, fs * 1.3);
    const labelW = fs * 0.72 * 18;
    const moonLabelW = fs * 0.72 * 17;
    L.navBoxes.push(
      [xL - 6, labelY - fs - 4, xL + labelW, labelY + lh * 2 + 4],
      [cx - moonLabelW / 2, cy + labelDy - fs - 4, cx + moonLabelW / 2, cy + labelDy + 4],
      // and from behind the readout, where a star can pass for punctuation.
      [ro.left - rect.left - 10, ro.top - rect.top - 10, roRight + 16, ro.bottom - rect.top + 10],
    );
    L.terrain = layoutTerrain({ W, H, horizonY, vpX, narrow, palette: P });

    const moonKey = `${D.toFixed(2)}|${dpr}`;
    if (!moonCache || moonCache.key !== moonKey) moonCache = { key: moonKey, sprite: renderMoon(D, dpr, P.moon) };
    const moonSprite = moonCache.sprite;
    stars = makeStars(L);
    backdrop = paintBackdrop(L, P, moonSprite, stars);
    sprites = makeSprites(geom, P, dpr);
    sats.layout(L);

    // Wire colour: cool, lifted and warmed in a column below the Moon, and dimmed
    // behind the readout so the text stays clear.
    const wg = ctx.createLinearGradient(0, 0, W, 0);
    const lift = P.wire.map((c, i) => Math.round(c * 0.5 + 0.5 * [226, 226, 228][i]));
    const dimTo = narrow ? 1 : clamp(roRight / W, 0.2, 0.7);
    const dim = narrow ? 0.5 : 0.42;
    const stops = [];
    const add = (x, col, a) => stops.push([clamp(x, 0, 1), col, a]);
    const mx = cx / W;
    const w = narrow ? 0.3 : 0.2;
    add(0, P.wire, dim);
    add(dimTo * 0.85, P.wire, dim);
    add(dimTo + 0.08, P.wire, 1);
    add(mx - w, P.wire, 1);
    add(mx, lift, 1);
    add(mx + w, P.wire, 1);
    add(1, P.wire, 1);
    stops.sort((a, b) => a[0] - b[0]);
    for (const [x, col, a] of stops) wg.addColorStop(x, rgba(col, a));
    wireStyle = wg;
    const cg = ctx.createLinearGradient(0, 0, W, 0);
    for (const [x, col, a] of stops) cg.addColorStop(x, rgba(col.map((c) => Math.round(c + (240 - c) * 0.45)), a));
    crestStyle = cg;

    fade = ctx.createLinearGradient(0, H * 0.84, 0, H);
    fade.addColorStop(0, rgba(P.sky0, 0));
    fade.addColorStop(0.55, rgba(P.sky0, 0.6));
    fade.addColorStop(1, rgba(P.sky0, 1));

    canvas.dataset.geometry = JSON.stringify({
      moonDiameter: +D.toFixed(3),
      absoluteDiameter: +(2 * geom.rAbs).toFixed(3),
      facingDiameter: +(2 * geom.rFac).toFixed(3),
      apparentDiameter: +(2 * geom.rApp).toFixed(3),
      moonCenter: [+cx.toFixed(1), +cy.toFixed(1)],
      marksCenter: [+tx.toFixed(1), +ty.toFixed(1)],
    });
  }

  function updateEmphasis(now) {
    if (!tween) return false;
    const p = clamp((now - tween.t0) / FADE_MS, 0, 1);
    const e = easeInOutCubic(p);
    for (const k of KEYS) em[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * e;
    if (p >= 1) tween = null;
    return true;
  }

  function draw(now) {
    if (!L) return;
    updateEmphasis(now);
    const t = still ? STILL_T : clock;
    const { dpr } = L;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(backdrop, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawTwinkle(ctx, stars, t, still);
    sats.draw(ctx, P, still);
    drawMarks(ctx, L.marks, em, P, sprites, dpr);

    // A survey pulse sweeps toward the viewer every 11 s.
    let scanZ = null;
    if (!still) {
      const period = 11;
      const ph = (t % period) / 7;
      if (ph < 1) scanZ = L.terrain.zFar * Math.pow(L.terrain.zNear / L.terrain.zFar, ph);
    }
    drawTerrain(ctx, terrain, L.terrain, t * TERRAIN_SPEED, wireStyle, crestStyle, scanZ);

    ctx.fillStyle = fade;
    ctx.fillRect(0, L.H * 0.84, L.W, L.H * 0.16 + 1);

    if (fontsReady) drawLabels(ctx, L.marks, em, P, vals, L.moon, deg, format);
  }

  function tick(now) {
    raf = 0;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!still) {
      clock += dt;
      sats.update(dt);
    }
    draw(now);
    if (shouldRun() || tween) raf = requestAnimationFrame(tick);
    else last = 0;
  }

  function shouldRun() {
    return !still && inView && !document.hidden;
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function select(key) {
    if (!KEYS.includes(key) || key === selected) return;
    selected = key;
    const to = { absolute: 0, facing: 0, apparent: 0, [key]: 1 };
    if (still) {
      Object.assign(em, to);
      tween = null;
      draw(performance.now());
      return;
    }
    tween = { from: { ...em }, to, t0: performance.now() };
    kick();
  }

  function relayout() {
    layout();
    if (still || !raf) draw(performance.now());
  }

  // The card has a fixed size and never animates, so it needs none of these. Leaving
  // out the resize observer also keeps its frame the same on every render: each layout
  // draws new satellites from a seeded stream, so the number of layouts must not
  // depend on timing.
  if (!card) {
    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayout, 150);
    });
    ro.observe(hero);

    const io = new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      if (shouldRun()) kick();
    });
    io.observe(hero);

    document.addEventListener('visibilitychange', () => {
      if (shouldRun()) kick();
    });
  }

  layout();
  draw(performance.now());
  if (shouldRun()) kick();

  return {
    select,
    setValues(next, nextDeg) {
      const changed = KEYS.some((k) => next[k] !== vals[k]) || nextDeg !== deg;
      vals = { ...vals, ...next };
      deg = nextDeg;
      if (changed) relayout();
    },
    fontsLoaded() {
      fontsReady = true;
      relayout();
    },
  };
}
