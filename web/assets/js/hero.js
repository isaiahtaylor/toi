// Hero: the readout (HTML) and the night-survey canvas. The build fills every number
// into the HTML, so the page reads correctly before this runs; here we hydrate from
// data/latest.json, wire up the expression selector and start the canvas.

import { loadLatest, sig, intl, dateLong, prefersReducedMotion } from './toi.js';
import { createScene } from './hero/scene.js';

const KEYS = ['absolute', 'facing', 'apparent'];
// Must match the narrow media query in assets/css/hero.css. Short landscape screens
// (phones on their side) keep the side-by-side layout so the number stays on screen.
const NARROW = '(max-width: 599px), (max-width: 899px) and (min-height: 521px), (max-aspect-ratio: 10/11)';

const hero = document.querySelector('.hero');
if (hero) init(hero);

function percentOfMoon(x) {
  return `${sig(x * 100, 2)}%`;
}

function arcsec(x) {
  return `${Number(x).toString()}″`;
}

function sentence(key, v, seeing) {
  const p = percentOfMoon(v[key]);
  if (key === 'facing') {
    return `Every tracked object in orbit, directly overhead and facing the ground the way it flies, would cover ${p} of the full Moon.`;
  }
  if (key === 'apparent') {
    return `Through the atmosphere’s ${arcsec(seeing)} blur, each object smears over a wider patch of sky, and together they touch ${p} of the full Moon.`;
  }
  return `Every tracked object in orbit, laid flat directly overhead, would cover ${p} of the full Moon.`;
}

function monthYear(iso) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function init(hero) {
  const $ = (name) => hero.querySelector(`[data-hero="${name}"]`);
  const radios = [...hero.querySelectorAll('[role="radio"][data-expr]')];
  const num = $('value');
  const sent = $('sentence');
  const reduced = prefersReducedMotion();

  const ds = hero.dataset;
  let values = {
    absolute: parseFloat(ds.absolute),
    facing: parseFloat(ds.facing),
    apparent: parseFloat(ds.apparent),
  };
  let seeing = parseFloat(ds.seeing);
  let moonDeg = parseFloat(ds.moonDeg);
  let selected = (radios.find((r) => r.getAttribute('aria-checked') === 'true') || radios[0])?.dataset.expr || 'facing';

  let scene = null;
  const canvas = hero.querySelector('.hero__canvas');
  try {
    scene = createScene({
      canvas,
      hero,
      readout: hero.querySelector('.hero__readout'),
      nav: hero.querySelector('.hero__nav'),
      narrowQuery: window.matchMedia(NARROW),
      values,
      moonDeg,
      reduced,
      format: (x) => sig(x, 2),
    });
  } catch (err) {
    // The readout carries all the information; the canvas is decoration.
    canvas.hidden = true;
  }

  const waitFonts = Promise.all([
    document.fonts.load('500 11px "IBM Plex Mono"'),
    document.fonts.load('300 64px "Newsreader"'),
  ]).catch(() => null).then(() => document.fonts.ready);
  waitFonts.then(() => scene?.fontsLoaded());

  let swapTimer = 0;
  function render(animate) {
    const text = sig(values[selected], 2);
    const line = sentence(selected, values, seeing);
    if (!animate || reduced) {
      num.textContent = text;
      sent.textContent = line;
      return;
    }
    clearTimeout(swapTimer);
    num.classList.add('is-swapping');
    sent.classList.add('is-swapping');
    swapTimer = setTimeout(() => {
      num.textContent = text;
      sent.textContent = line;
      num.classList.remove('is-swapping');
      sent.classList.remove('is-swapping');
    }, 170);
  }

  function select(key, focus) {
    if (!KEYS.includes(key)) return;
    const changed = key !== selected;
    selected = key;
    for (const r of radios) {
      const on = r.dataset.expr === key;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
      if (on && focus) r.focus();
    }
    hero.dataset.selected = key;
    scene?.select(key);
    if (changed) render(true);
  }

  radios.forEach((r, i) => {
    r.addEventListener('click', () => select(r.dataset.expr, false));
    r.addEventListener('keydown', (e) => {
      const n = radios.length;
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j < 0) return;
      e.preventDefault();
      select(radios[j].dataset.expr, true);
    });
  });
  hero.dataset.selected = selected;

  loadLatest()
    .then((latest) => {
      const t = latest.toi || {};
      values = { absolute: t.absolute, facing: t.facing, apparent: t.apparent };
      const c = latest.constants || {};
      if (Number.isFinite(c.default_seeing_arcsec)) seeing = c.default_seeing_arcsec;
      if (Number.isFinite(c.moon_angular_diameter_deg)) moonDeg = c.moon_angular_diameter_deg;

      for (const k of KEYS) {
        const el = $(k);
        if (el && Number.isFinite(values[k])) el.textContent = sig(values[k], 2);
      }
      for (const el of hero.querySelectorAll('[data-hero="seeing"]')) el.textContent = arcsec(seeing);
      if (latest.catalog_date) {
        const month = $('month');
        if (month) month.textContent = monthYear(latest.catalog_date);
        $('date').textContent = dateLong(latest.catalog_date);
      }
      if (latest.counts && Number.isFinite(latest.counts.total)) $('count').textContent = intl(latest.counts.total);

      const notes = [];
      if (latest.status === 'degraded') {
        notes.push('The pipeline could not reach CelesTrak for this run, so the population and orbits come from GCAT alone.');
      }
      if (latest.fixture) notes.push('These are placeholder values. The monthly pipeline has not published a run yet.');
      const status = $('status');
      if (notes.length) {
        status.textContent = notes.join(' ');
        status.hidden = false;
      }

      render(false);
      scene?.setValues(values, moonDeg);
    })
    .catch(() => {
      // Keep the values the build wrote into the page.
    });
}
