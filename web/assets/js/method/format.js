// Number formatting for the methodology section (text and TeX).
import { sig, sci, pct, intl } from '../toi.js';

export { sig, sci, pct, intl };

// TeX scientific notation: texSci(5.2948e-6, 4) → "5.295\times10^{-6}"
export function texSci(x, n = 4) {
  if (!Number.isFinite(x)) return '\\text{–}';
  if (x === 0) return '0';
  const [mant, exp] = x.toExponential(n - 1).split('e');
  const e = parseInt(exp, 10);
  if (e === 0) return mant;
  return `${mant}\\times10^{${e}}`;
}

// TeX integer with thin-space thousands: 35537 → "35\,537"
export function texInt(n) {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, '\\,');
}

// TeX decimal that keeps thousands readable: 384400.5 → "384\,400.5"
export function texNum(x, maxSig = 6) {
  if (!Number.isFinite(x)) return '\\text{–}';
  const s = trimNum(x, maxSig);
  const [i, f] = s.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '\\,');
  return f ? `${grouped}.${f}` : grouped;
}

// Plain number with up to n significant figures, trailing zeros removed, grouped thousands.
export function trimNum(x, n = 4) {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(x)));
  const decimals = Math.max(0, n - 1 - mag);
  let s = x.toFixed(Math.min(decimals, 12));
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s;
}

export function groupNum(x, n = 4) {
  const s = trimNum(x, n);
  const [i, f] = s.split('.');
  const neg = i.startsWith('-');
  const digits = neg ? i.slice(1) : i;
  const g = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + g + (f ? `.${f}` : '');
}

// Micro-moons for table columns: 3.798e-4 moons → "379.8"
export function micro(x, n = 3) {
  if (!Number.isFinite(x)) return '–';
  const v = x * 1e6;
  if (v === 0) return '0';
  if (v >= 1000) return groupNum(v, 4);
  return sig(v, n);
}

export function bytes(n) {
  if (!Number.isFinite(n)) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function arcsec(theta) {
  if (theta < 1) return `${theta.toFixed(2)}″`;
  if (theta < 10) return `${theta.toFixed(1)}″`;
  return `${Math.round(theta)}″`;
}

// Format by name, for data-fill="path|fmt" and TeX tokens {%path|fmt%}.
export const FORMATS = {
  raw: (v) => String(v),
  sig2: (v) => sig(+v, 2),
  sig3: (v) => sig(+v, 3),
  sig4: (v) => sig(+v, 4),
  sig5: (v) => sig(+v, 5),
  int: (v) => intl(+v),
  pct0: (v) => pct(+v, 0),
  pct1: (v) => pct(+v, 1),
  sci3: (v) => sci(+v, 3),
  sci4: (v) => sci(+v, 4),
  tex3: (v) => texSci(+v, 3),
  tex4: (v) => texSci(+v, 4),
  tex5: (v) => texSci(+v, 5),
  texint: (v) => texInt(+v),
  micro: (v) => micro(+v),
};

export function resolvePath(obj, path) {
  let cur = obj;
  for (const part of path.match(/[^.[\]]+/g) || []) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function formatPath(ctx, spec) {
  const [path, fmt = 'raw'] = spec.split('|').map((s) => s.trim());
  const v = resolvePath(ctx, path);
  if (v === undefined || v === null) return null;
  const f = FORMATS[fmt] || FORMATS.raw;
  return f(v);
}

// Fill every [data-fill] in root from ctx. Elements whose path is missing keep their text.
export function fillAll(root, ctx) {
  root.querySelectorAll('[data-fill]').forEach((el) => {
    const out = formatPath(ctx, el.dataset.fill);
    if (out !== null) el.textContent = out;
  });
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const TYPE_LABEL = { PAY: 'Payload', 'R/B': 'Rocket body', DEB: 'Debris', UNK: 'Unknown' };
export const TYPE_KEY_LABEL = { payload: 'Payloads', rocket_body: 'Rocket bodies', debris: 'Debris', unknown: 'Unknown' };
export const ORBIT_SRC_LABEL = { celestrak: 'CelesTrak SATCAT', gcat: 'GCAT current orbit', 'launch-mates': 'Median of launch-mates' };
export const AREA_SRC_LABEL = { curated: 'Curated design', gcat: 'GCAT dimensions, generic model', rcs: 'Radar cross-section', default: 'Default by type' };
