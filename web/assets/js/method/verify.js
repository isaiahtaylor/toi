// Verify section: upstream inputs table, published file sizes, copy buttons.
import { el, intl, bytes } from './format.js';

function fmtUTC(iso) {
  if (!iso) return '–';
  return iso.replace('T', ' ').replace(/:\d\dZ$/, '').replace(/Z$/, '');
}

export function renderSources(root, latest) {
  const tbody = root.querySelector('[data-render="sources"] tbody');
  if (!tbody) return;
  tbody.replaceChildren(...latest.sources.map((s) => {
    const hash = el('span', { class: 'm-hash' },
      el('code', { title: s.sha256, text: `${s.sha256.slice(0, 12)}…` }),
      copyButton(s.sha256, `Copy the SHA-256 of ${s.label}`));
    return el('tr', {},
      el('th', { scope: 'row' }, el('a', { href: s.url, rel: 'noopener', text: s.label }), el('small', { text: s.publisher })),
      el('td', {}, fmtUTC(s.fetched_at), s.updated ? el('small', { text: `source stamp ${s.updated}` }) : null),
      el('td', { class: 'num', title: `${intl(s.bytes)} bytes`, text: bytes(s.bytes) }),
      el('td', {}, hash),
      el('td', { class: 'm-inputs__lic', text: s.license === 'CC-BY-4.0' ? 'CC BY 4.0' : s.license }),
    );
  }));
}

// Published file sizes. The build writes the exact sizes into the table (data-bytes);
// without them, files the page has fetched report their size through the Resource
// Timing API and objects.csv is sized by the explorer once it loads.
export function setFileSize(root, path, n, approx = false) {
  const cell = root.querySelector(`[data-size="${path}"]`);
  if (!cell || !Number.isFinite(n) || n <= 0 || +cell.dataset.bytes > 0) return;
  cell.textContent = approx ? `about ${bytes(n)}` : bytes(n);
  cell.title = approx ? 'Estimated from the row count until the catalog loads' : `${intl(n)} bytes`;
}

export function fillFileSizes(root, latest) {
  const entries = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
  root.querySelectorAll('[data-size]').forEach((cell) => {
    const path = cell.dataset.size;
    const hit = entries.filter((e) => new URL(e.name).pathname.endsWith(`/${path}`) && e.decodedBodySize > 0).pop();
    if (hit) setFileSize(root, path, hit.decodedBodySize);
    else if (path === (latest.files?.objects_csv || 'data/objects.csv') && cell.textContent.trim() === '–') {
      setFileSize(root, path, latest.counts.total * 176, true);
    }
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function flash(btn, ok) {
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  btn.textContent = ok ? 'Copied' : 'Select and copy';
  btn.classList.toggle('m-copied', ok);
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = label; btn.classList.remove('m-copied'); }, 1600);
}

function copyButton(text, label) {
  const b = el('button', { type: 'button', class: 'm-btn m-btn--small m-btn--icon', 'aria-label': label, text: 'Copy' });
  b.addEventListener('click', async () => flash(b, await copyText(text)));
  return b;
}

export function initCopy(root) {
  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const src = root.querySelector(btn.dataset.copy);
      if (!src) return;
      flash(btn, await copyText(src.textContent));
    });
  });
}
