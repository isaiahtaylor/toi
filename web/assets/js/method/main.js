// Methodology section entry point. Everything here renders on load from the published
// data files; only the catalog explorer waits until its section nears the viewport.
import { loadLatest } from '../toi.js';
import { fillAll } from './format.js';
import { whenKatex, renderAll } from './math.js';
import { initSeeing } from './seeing.js';
import { renderCoverage, renderDesigns, openDesign } from './designs.js';
import { renderGroups, renderTopObjects, renderSummaries } from './breakdown.js';
import { parseHistory, renderHistory } from './history.js';
import { initExplorer } from './explorer.js';
import { renderSources, fillFileSizes, initCopy } from './verify.js';
import { moonScale } from './scale.js';

function attempt(name, fn) {
  try { return fn(); } catch (err) {
    console.error(`methodology: ${name} failed`, err);
    return undefined;
  }
}

function fetchFile(path, kind) {
  return fetch(path, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return kind === 'json' ? r.json() : r.text();
  });
}

// Values that are not plain paths into latest.json, for [data-fill] and {%…%} tokens.
function context(latest) {
  const by = (list, key) => Object.fromEntries((list || []).map((r) => [r[key], r]));
  const area = by(latest.coverage.area_source, 'source');
  const orbit = Object.fromEntries((latest.coverage.orbit_source || []).map((r) => [r.source, r.n]));
  const starlink = latest.groups.filter((g) => g.family === 'Starlink').reduce((s, g) => s + g.toi_fac, 0);
  return {
    ...latest,
    area,
    orbit,
    derived: { starlinkShare: starlink / latest.toi.facing, debrisShare: latest.counts.debris / latest.counts.total },
  };
}

function initViewToggles(root) {
  root.querySelectorAll('[data-view-toggle]').forEach((btn) => {
    const fig = btn.closest('figure');
    btn.addEventListener('click', () => {
      const table = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(table));
      btn.textContent = table ? 'Chart' : 'Table';
      fig.querySelectorAll('[data-view="chart"]').forEach((n) => { n.hidden = table; });
      fig.querySelectorAll('[data-view="table"]').forEach((n) => { n.hidden = !table; });
      fig.querySelectorAll('[data-chart-only]').forEach((n) => { n.hidden = table; });
    });
  });
}

function showError(root, err) {
  const note = root.querySelector('[data-load-error]');
  if (note) {
    note.hidden = false;
    note.textContent = `The page could not load its data files (${err.message}). The numbers in the text come from the last build. The charts and tables need data/latest.json.`;
  }
}

// A deep link (#explore, #verify, …) resolves before the data-driven blocks above its
// target render, and they then push the target thousands of pixels down. While the page
// settles, keep the target aligned each time the methodology changes size; let go as
// soon as the reader scrolls, clicks or types, or after ten seconds.
function keepHashTarget(root) {
  if (!('ResizeObserver' in window)) return;
  let target = null;
  let until = 0;
  const pick = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    target = id ? document.getElementById(id) : null;
    until = performance.now() + 10000;
  };
  const release = () => { target = null; };
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
    window.addEventListener(type, release, { passive: true, capture: true });
  }
  window.addEventListener('hashchange', pick);
  pick();
  new ResizeObserver(() => {
    if (!target || !target.isConnected || performance.now() > until) return;
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }).observe(root);
}

async function main() {
  const root = document.getElementById('method');
  if (!root) return;
  keepHashTarget(root);
  initCopy(root);
  initViewToggles(root);

  let latest;
  try {
    latest = await loadLatest();
  } catch (err) {
    showError(root, err);
    return;
  }
  const ctx = context(latest);
  const busesPromise = fetchFile(latest.files?.buses_json || 'data/buses.json', 'json');
  const historyPromise = fetchFile(latest.files?.history_csv || 'data/history.csv', 'text');

  attempt('fill', () => fillAll(root, ctx));
  attempt('seeing', () => initSeeing(root, latest));
  attempt('coverage', () => renderCoverage(root, latest));
  attempt('groups', () => renderGroups(root, latest));
  attempt('summaries', () => renderSummaries(root, latest));
  attempt('sources', () => renderSources(root, latest));
  const explorer = attempt('explorer', () => initExplorer(root, latest, busesPromise)) || { open() {} };
  attempt('top objects', () => renderTopObjects(root, latest, (o) => explorer.open(o)));
  attempt('scale', () => moonScale(root, latest));

  whenKatex()
    .then((katex) => attempt('math', () => renderAll(katex, root, ctx)))
    .catch(() => { /* fallback text stays */ });

  // Links to a curated design open its notes as well as scrolling to it.
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#design-"]');
    if (a) openDesign(root, a.getAttribute('href').slice('#design-'.length));
  });

  Promise.allSettled([busesPromise, historyPromise]).then(() => setTimeout(() => fillFileSizes(root, latest), 0));

  busesPromise
    .then((buses) => attempt('designs', () => renderDesigns(root, buses, latest)))
    .catch((err) => {
      const cell = root.querySelector('[data-render="designs"] .m-empty');
      if (cell) cell.textContent = `The design table did not load (${err.message}).`;
    });

  historyPromise
    .then((text) => {
      const rows = parseHistory(text);
      const derived = attempt('history', () => renderHistory(root, rows, latest));
      if (derived) {
        ctx.derived = { ...ctx.derived, ...derived };
        root.querySelectorAll('[data-fill^="derived."]').forEach((n) => fillAll(n.parentElement, ctx));
      }
    })
    .catch((err) => {
      const host = root.querySelector('#history-chart');
      if (host) host.textContent = `The history did not load (${err.message}).`;
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
else main();
