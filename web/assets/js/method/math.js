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

export function fit(katex, node) {
  if (!node.isConnected || !node.clientWidth) return;
  const wide = node._tex;
  const narrow = node._texNarrow;
  node.style.fontSize = '';
  node.classList.remove('is-scroll');
  if (narrow && node._showing !== 'wide') { renderInto(katex, node, wide, true); node._showing = 'wide'; }
  const over = () => node.scrollWidth > node.clientWidth + 1;
  if (over() && narrow) { renderInto(katex, node, narrow, true); node._showing = 'narrow'; }
  if (over()) {
    const base = parseFloat(getComputedStyle(node).fontSize);
    const ratio = Math.max(MIN_SCALE, (node.clientWidth / node.scrollWidth) * 0.98);
    node.style.fontSize = `${(base * ratio).toFixed(2)}px`;
    if (over()) node.classList.add('is-scroll');
  }
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
      for (const n of fitted) { if (n.isConnected) fit(katex, n); else fitted.delete(n); }
    }, 150);
  });
}

// Render a display formula that fits itself to the column, now and on resize.
export function renderFitted(katex, node, tex, narrowTex = null) {
  node._tex = tex;
  node._texNarrow = narrowTex || autoNarrow(tex);
  node._showing = null;
  renderInto(katex, node, tex, true);
  node._showing = 'wide';
  fitted.add(node);
  watchResize(katex);
  fit(katex, node);
}

export function renderAll(katex, root, ctx) {
  root.querySelectorAll('[data-tex]').forEach((node) => {
    const tex = fillTokens(node.dataset.tex, ctx);
    if (node.classList.contains('m-tex')) { renderInto(katex, node, tex, false); return; }
    const narrow = node.dataset.texNarrow ? fillTokens(node.dataset.texNarrow, ctx) : null;
    renderFitted(katex, node, tex, narrow);
  });
}
