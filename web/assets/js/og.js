// The social preview card (og-card.html): the hero scene in card mode, one still
// frame at 1200×630. web/og/render.py screenshots it into data/og.png.
//
// The build writes every number into the page, so this reads them from the markup
// instead of fetching data/latest.json. Once the fonts are in and the frame is drawn,
// it sets data-ready on the card. Opened as og-card.html?render, it also posts what
// it drew to the renderer's local server (og-ready), so the renderer can check the
// fonts loaded and the viewport covered the whole card before it trusts the PNG.

import { sig } from './toi.js';
import { createScene } from './hero/scene.js';

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message || e.type)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

const card = document.querySelector('.hero[data-mode="card"]');
if (card) init(card);

function fontLoaded(family) {
  return [...document.fonts].some((f) => f.family.replace(/["']/g, '') === family && f.status === 'loaded');
}

function init(card) {
  const ds = card.dataset;
  const canvas = card.querySelector('.hero__canvas');
  let scene = null;
  try {
    scene = createScene({
      canvas,
      hero: card,
      readout: card.querySelector('.hero__readout'),
      nav: null,
      narrowQuery: { matches: false },
      values: { absolute: parseFloat(ds.absolute), facing: parseFloat(ds.facing), apparent: parseFloat(ds.apparent) },
      moonDeg: parseFloat(ds.moonDeg),
      reduced: true,
      format: (x) => sig(x, 2),
    });
  } catch (err) {
    errors.push(String(err && err.stack ? err.stack : err));
  }

  Promise.all([
    document.fonts.load('500 15px "IBM Plex Mono"'),
    document.fonts.load('250 176px "Newsreader"'),
    document.fonts.load('400 30px "Newsreader"'),
  ])
    .catch(() => null)
    .then(() => document.fonts.ready)
    .then(() => {
      scene?.fontsLoaded();
      ds.ready = 'true';
      report();
    });

  function report() {
    if (!new URLSearchParams(location.search).has('render')) return;
    const body = {
      viewport: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      card: [card.offsetWidth, card.offsetHeight],
      fonts: { newsreader: fontLoaded('Newsreader'), plexMono: fontLoaded('IBM Plex Mono') },
      scene: Boolean(scene),
      geometry: canvas.dataset.geometry ? JSON.parse(canvas.dataset.geometry) : null,
      errors,
    };
    fetch('og-ready', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }
}
