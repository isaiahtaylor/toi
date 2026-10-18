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

export function renderAll(katex, root, ctx) {
  root.querySelectorAll('[data-tex]').forEach((node) => {
    const tex = fillTokens(node.dataset.tex, ctx);
    const display = !node.classList.contains('m-tex');
    renderInto(katex, node, tex, display);
  });
}
