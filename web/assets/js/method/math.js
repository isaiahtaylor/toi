// KaTeX rendering. Elements carry their TeX in data-tex and keep readable fallback text
// until KaTeX has loaded. Tokens {%path|fmt%} inside the TeX are filled from data.
import { formatPath } from './format.js';

const MACROS = { '\\moon': '\\text{☾}' };
const TOKEN = /\{%\s*([\w.[\]]+(?:\s*\|\s*\w+)?)\s*%\}/g;

let katexPromise = null;

export function whenKatex() {
  if (!katexPromise) {
    katexPromise = new Promise((resolve, reject) => {
      if (window.katex) { resolve(window.katex); return; }
      let tries = 0;
      const poll = () => {
        if (window.katex) resolve(window.katex);
        else if (++tries > 200) reject(new Error('KaTeX did not load'));
        else setTimeout(poll, 50);
      };
      if (document.readyState === 'complete') poll();
      else window.addEventListener('load', poll, { once: true });
    });
  }
  return katexPromise;
}

export function fillTokens(tex, ctx) {
  return tex.replace(TOKEN, (_, spec) => {
    const out = formatPath(ctx, spec);
    return out === null ? '\\text{?}' : out;
  });
}

// KaTeX has no metrics for the Moon symbol and says so on the console; the glyph still
// renders from the system font. Silence only that notice.
function quietly(fn) {
  const warn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('☾')) return;
    warn.apply(console, args);
  };
  try { return fn(); } finally { console.warn = warn; }
}

const OPTIONS = {
  throwOnError: false,
  macros: MACROS,
  strict: (code) => (code === 'unknownSymbol' ? 'ignore' : 'warn'),
  output: 'htmlAndMathml',
};

export function renderInto(katex, node, tex, displayMode = true) {
  quietly(() => katex.render(tex, node, { ...OPTIONS, displayMode }));
  node.classList.add('is-rendered');
}

export function renderToString(katex, tex, displayMode = true) {
  return quietly(() => katex.renderToString(tex, { ...OPTIONS, displayMode }));
}

// A multi-line version of a long one-line formula, for narrow columns: rows break at
// each top-level "=" (or at \quad between separate equations), aligned on the "=".
export function autoNarrow(tex) {
  if (!tex || tex.includes('\\begin{')) return null;
  // rows split at \quad / \qquad (depth 0)
  const rows = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '\\' && depth === 0 && /^\\q?quad/.test(tex.slice(i))) {
      rows.push(tex.slice(start, i).replace(/,\s*$/, ''));
      i += tex.slice(i).match(/^\\q?quad/)[0].length - 1;
      start = i + 1;
      continue;
    } else if (c === '\\') { i++; }
  }
  rows.push(tex.slice(start));
  const eqs = (row) => {
    const out = [];
    let d = 0;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') d++;
      else if (c === '}') d--;
      else if (c === '=' && d === 0 && !row.slice(0, i).endsWith('\\mathrel{+}')) out.push(i);
    }
    return out;
  };
  const lines = [];
  if (rows.length > 1) {
    for (const row of rows) {
      const e = eqs(row);
      lines.push(e.length ? `${row.slice(0, e[0])}&${row.slice(e[0])}` : `&${row}`);
    }
  } else {
    const row = rows[0];
    const e = eqs(row);
    if (e.length < 2) return null;
    lines.push(`${row.slice(0, e[0])}&${row.slice(e[0], e[1])}`);
    for (let k = 1; k < e.length; k++) lines.push(`&${row.slice(e[k], e[k + 1] ?? row.length)}`);
  }
  return `\\begin{aligned}${lines.join(' \\\\ ')}\\end{aligned}`;
}

// Fit a rendered display formula to its column: switch to the narrow (multi-line) TeX
// when one is given and the wide one overflows, then shrink to at most 72% before
// letting it scroll sideways.
const MIN_SCALE = 0.72;

// Layout is read in three batches for any number of formulas (render all, measure all,
// adjust all), so fitting a page of formulas costs a few layouts, not one per formula.
export function fitAll(katex, nodes) {
  const live = nodes.filter((n) => n.isConnected);
  for (const n of live) {
    n.style.fontSize = '';
    n.classList.remove('is-scroll');
    if (n._texNarrow && n._showing !== 'wide') { renderInto(katex, n, n._tex, true); n._showing = 'wide'; }
  }
  const over = (n) => n.scrollWidth > n.clientWidth + 1;
  const wideOver = live.filter((n) => n.clientWidth && over(n));
  for (const n of wideOver) {
    if (n._texNarrow) { renderInto(katex, n, n._texNarrow, true); n._showing = 'narrow'; }
  }
  const shrink = wideOver.filter(over).map((n) => [n, parseFloat(getComputedStyle(n).fontSize), n.clientWidth / n.scrollWidth]);
  for (const [n, base, ratio] of shrink) n.style.fontSize = `${(base * Math.max(MIN_SCALE, ratio * 0.98)).toFixed(2)}px`;
  const scroll = shrink.map(([n]) => n).filter(over);
  for (const n of scroll) n.classList.add('is-scroll');
}

export function fit(katex, node) {
  fitAll(katex, [node]);
}

const fitted = new Set();
let resizeTimer = 0;
let lastWidth = 0;
function watchResize(katex) {
  if (lastWidth) return;
  lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastWidth) < 2) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const n of fitted) if (!n.isConnected) fitted.delete(n);
      fitAll(katex, [...fitted]);
    }, 150);
  });
}

// Render display formulas that fit themselves to the column, now and on resize.
// items: [{ node, tex, narrow }]
export function renderFittedAll(katex, items) {
  if (fitted.size > 64) for (const n of fitted) if (!n.isConnected) fitted.delete(n);
  for (const { node, tex, narrow } of items) {
    node._tex = tex;
    node._texNarrow = narrow || autoNarrow(tex);
    renderInto(katex, node, tex, true);
    node._showing = 'wide';
    fitted.add(node);
  }
  watchResize(katex);
  fitAll(katex, items.map((it) => it.node));
}

export function renderFitted(katex, node, tex, narrowTex = null) {
  renderFittedAll(katex, [{ node, tex, narrow: narrowTex }]);
}

export function renderAll(katex, root, ctx) {
  const display = [];
  root.querySelectorAll('[data-tex]').forEach((node) => {
    const tex = fillTokens(node.dataset.tex, ctx);
    if (node.classList.contains('m-tex')) { renderInto(katex, node, tex, false); return; }
    const narrow = node.dataset.texNarrow ? fillTokens(node.dataset.texNarrow, ctx) : null;
    display.push({ node, tex, narrow });
  });
  renderFittedAll(katex, display);
}
