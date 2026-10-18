// The catalog explorer: objects.csv, loaded when the section nears the viewport, in a
// virtualized list with search, filters and sorting. Selecting a row opens the worked
// calculation (calc.js) for that object.
import { el, sig, intl, pct, trimNum, groupNum, bytes, micro } from './format.js';
import { parseCSV } from './csv.js';
import { renderCalc } from './calc.js';
import { whenKatex, renderFitted } from './math.js';
import { getSeeing, onSeeing } from './state.js';
import { setFileSize } from './verify.js';

const OVERSCAN = 8;
const AVG_ROW_BYTES = 176; // for the progress bar when the server compresses the file

const SORTS = {
  abs: { head: 'Abs. µmoon', cmp: (a, b) => b.tAbs - a.tAbs || a.i - b.i, val: (r) => micro(r.tAbs) },
  fac: { head: 'Fac. µmoon', cmp: (a, b) => b.tFac - a.tFac || a.i - b.i, val: (r) => micro(r.tFac) },
  'alt-asc': { head: 'Abs. µmoon', cmp: (a, b) => a.alt - b.alt || a.i - b.i, val: (r) => micro(r.tAbs) },
  'alt-desc': { head: 'Abs. µmoon', cmp: (a, b) => b.alt - a.alt || a.i - b.i, val: (r) => micro(r.tAbs) },
  area: { head: 'Facing m²', cmp: (a, b) => b.aFac - a.aFac || a.i - b.i, val: (r) => groupNum(r.aFac, 4) },
};

function toRows(header, raw) {
  const ix = Object.fromEntries(header.map((h, i) => [h, i]));
  const need = ['name', 'alt_km', 'A_abs_m2', 'A_fac_m2', 'P_fac_m', 'toi_abs', 'toi_fac', 'group', 'type', 'area_src'];
  for (const k of need) if (!(k in ix)) throw new Error(`objects.csv has no ${k} column`);
  const get = (r, k) => (k in ix ? r[ix[k]] ?? '' : '');
  const rows = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const o = {
      i,
      norad: get(r, 'norad'), name: get(r, 'name'), cospar: get(r, 'cospar'), type: get(r, 'type'),
      owner: get(r, 'owner'), launch_date: get(r, 'launch_date'), group: get(r, 'group'), bus: get(r, 'bus'),
      perigee_km: get(r, 'perigee_km'), apogee_km: get(r, 'apogee_km'), alt_km: get(r, 'alt_km'),
      orbit_src: get(r, 'orbit_src'), length_m: get(r, 'length_m'), diameter_m: get(r, 'diameter_m'),
      span_m: get(r, 'span_m'), shape: get(r, 'shape'), area_src: get(r, 'area_src'),
      A_abs_m2: get(r, 'A_abs_m2'), A_fac_m2: get(r, 'A_fac_m2'), P_fac_m: get(r, 'P_fac_m'),
      toi_abs_str: get(r, 'toi_abs'), toi_fac_str: get(r, 'toi_fac'), jcat: get(r, 'jcat'), regime: get(r, 'regime'),
    };
    o.key = o.norad || o.jcat || `${o.cospar}#${i}`;
    o.alt = +o.alt_km;
    o.aAbs = +o.A_abs_m2;
    o.aFac = +o.A_fac_m2;
    o.tAbs = +o.toi_abs_str;
    o.tFac = +o.toi_fac_str;
    o.hay = `${o.name}\u0001${o.norad}\u0001${o.cospar}\u0001${o.jcat}`.toLowerCase();
    rows[i] = o;
  }
  return rows;
}

export function initExplorer(root, latest, busesPromise) {
  const box = root.querySelector('.m-explorer');
  if (!box) return { open() {} };
  const section = box.closest('section') || box;
  const $ = (sel) => box.querySelector(sel);
  const controls = {
    q: $('#ex-q'), group: $('#ex-group'), type: $('#ex-type'), src: $('#ex-src'), sort: $('#ex-sort'),
  };
  const list = $('[data-ex="list"]');
  const loadingBox = $('[data-ex="loading"]');
  const loadingText = $('[data-ex="loading-text"]');
  const loadBtn = $('[data-ex="load"]');
  const progress = $('[data-ex="progress"]');
  const summary = $('[data-ex="summary"]');
  const valHead = $('[data-ex="val-head"]');
  const calc = $('[data-ex="calc"]');
  const announce = $('[data-ex="announce"]');
  const groupLabels = Object.fromEntries(latest.groups.map((g) => [g.id, g.label]));
  const csvPath = latest.files?.objects_csv || 'data/objects.csv';

  let status = 'idle';
  let rows = [];
  let view = [];
  let active = -1;
  let selected = null;
  let designs = {};
  let katex = null;
  let pending = null;
  let rowH = 52;
  const inner = el('div', { class: 'm-vlist__inner' });
  const live = new Map();
  let raf = 0;

  busesPromise.then((b) => { designs = Object.fromEntries(b.map((d) => [d.id, d])); if (selected) showCalc(selected); }).catch(() => {});
  whenKatex().then((k) => { katex = k; paintTex(); }).catch(() => {});

  function setStatus(s) { status = s; box.dataset.state = s; }

  // ---- Loading ---------------------------------------------------------------------
  async function load() {
    if (status === 'loading' || status === 'ready') return;
    setStatus('loading');
    loadBtn.hidden = true;
    loadingText.textContent = 'Loading objects.csv…';
    progress.style.width = '0%';
    try {
      const res = await fetch(csvPath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const encoded = res.headers.get('content-encoding');
      const len = +res.headers.get('content-length') || 0;
      const expected = !encoded && len ? len : latest.counts.total * AVG_ROW_BYTES;
      let text = '';
      let got = 0;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const dec = new TextDecoder('utf-8');
        const parts = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.byteLength;
          parts.push(dec.decode(value, { stream: true }));
          const frac = Math.min(0.99, got / expected);
          progress.style.width = `${(frac * 100).toFixed(1)}%`;
          loadingText.textContent = `Loading objects.csv… ${bytes(got)} of about ${bytes(expected)}`;
        }
        parts.push(dec.decode());
        text = parts.join('');
      } else {
        text = await res.text();
        got = new Blob([text]).size;
      }
      progress.style.width = '100%';
      loadingText.textContent = 'Parsing…';
      await new Promise((r) => setTimeout(r, 0));
      const { header, rows: raw } = parseCSV(text);
      rows = toRows(header, raw);
      setFileSize(root, csvPath, got);
      ready();
    } catch (err) {
      setStatus('error');
      loadingText.textContent = `The catalog could not be loaded (${err.message}). You can download objects.csv from the Verify section and open it in a spreadsheet.`;
      loadBtn.textContent = 'Try again';
      loadBtn.hidden = false;
      status = 'idle';
    }
  }

  function ready() {
    setStatus('ready');
    const groupCounts = new Map();
    for (const r of rows) groupCounts.set(r.group, (groupCounts.get(r.group) || 0) + 1);
    controls.group.replaceChildren(el('option', { value: '', text: 'All groups' }),
      ...latest.groups.filter((g) => groupCounts.has(g.id)).map((g) => el('option', { value: g.id, text: `${g.label} (${intl(groupCounts.get(g.id))})` })));
    Object.values(controls).forEach((c) => { c.disabled = false; });
    loadingBox.remove();
    list.append(inner);
    rowH = parseFloat(getComputedStyle(box).getPropertyValue('--row-h')) || 52;
    applyFilters();
    if (pending) { const p = pending; pending = null; open(p); } else if (view.length) setActive(0, { select: true, scroll: false });
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '900px 0px' });
    io.observe(section);
  } else {
    load();
  }
  loadBtn.addEventListener('click', load);

  // ---- Filtering -------------------------------------------------------------------
  function applyFilters({ keepSelection = true } = {}) {
    const q = controls.q.value.trim().toLowerCase();
    const g = controls.group.value;
    const t = controls.type.value;
    const s = controls.src.value;
    const sortKey = controls.sort.value;
    const sort = SORTS[sortKey] || SORTS.abs;
    let out = rows;
    if (g || t || s || q) {
      out = rows.filter((r) => (!g || r.group === g) && (!t || r.type === t) && (!s || r.area_src === s) && (!q || r.hay.includes(q)));
    }
    out = out === rows ? rows.slice() : out;
    if (sortKey !== 'abs') out.sort(sort.cmp);
    if (q) {
      // Exact identifier matches go first.
      const exact = (r) => r.norad === q || r.cospar.toLowerCase() === q || r.jcat.toLowerCase() === q || r.name.toLowerCase() === q;
      const head = out.filter(exact);
      if (head.length) out = head.concat(out.filter((r) => !exact(r)));
    }
    view = out;
    valHead.replaceChildren(...sort.head.split(/(µ)/).filter(Boolean).map((part) => (part === 'µ' ? el('span', { class: 'm-nocase', text: 'µ' }) : part)));
    inner.style.height = `${view.length * rowH}px`;
    for (const node of live.values()) node.remove();
    live.clear();
    const idx = keepSelection && selected ? view.indexOf(selected) : -1;
    active = idx;
    list.scrollTop = 0;
    if (idx > 0) scrollToIndex(idx, 'center');
    renderRows();
    if (view.length) list.setAttribute('aria-activedescendant', idx >= 0 ? rowId(view[idx]) : '');
    else list.removeAttribute('aria-activedescendant');
    renderSummary(q || g || t || s);
    list.querySelector('.m-vlist__none')?.remove();
    if (!view.length) list.append(el('p', { class: 'm-vlist__none', text: 'No objects match. Clear the search or pick another filter.' }));
  }

  function renderSummary(filtered) {
    let sa = 0; let sf = 0;
    for (const r of view) { sa += r.tAbs; sf += r.tFac; }
    const n = view.length;
    if (!filtered) {
      summary.textContent = `All ${intl(n)} objects. Their contributions add up to ${sig(sa, 4)} moons absolute and ${sig(sf, 4)} facing, matching the published totals.`;
    } else if (!n) {
      summary.textContent = `No objects match.`;
    } else {
      summary.textContent = `${intl(n)} of ${intl(rows.length)} objects match. Together: ${sig(sa, 3)} moons absolute, ${sig(sf, 3)} facing (${pct(sf / latest.toi.facing, sf / latest.toi.facing < 0.001 ? 3 : 1)} of the facing total).`;
    }
  }

  let qTimer = 0;
  controls.q.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => applyFilters(), 120); });
  controls.q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && view.length) { e.preventDefault(); list.focus(); setActive(Math.max(0, active), { select: true }); }
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(qTimer); applyFilters(); if (view.length) setActive(0, { select: true }); }
  });
  for (const k of ['group', 'type', 'src', 'sort']) controls[k].addEventListener('change', () => applyFilters());

  // ---- Virtual list ----------------------------------------------------------------
  const rowId = (r) => `ex-row-${r.i}`;

  function rowNode(r, pos) {
    const sort = SORTS[controls.sort.value] || SORTS.abs;
    const ids = [r.norad || r.jcat, r.cospar, groupLabels[r.group] || r.group].filter(Boolean).join(' · ');
    const node = el('div', {
      class: 'm-vrow', role: 'option', id: rowId(r), 'aria-selected': String(r === selected),
      'aria-posinset': String(pos + 1), 'aria-setsize': String(view.length),
    },
    el('span', { class: 'm-vrow__rank', text: String(pos + 1) }),
    el('span', { class: 'm-vrow__name' }, el('b', { text: r.name || '(unnamed)' }), el('span', { text: ids })),
    el('span', { class: 'm-vrow__alt', text: trimNum(r.alt, 5) }),
    el('span', { class: 'm-vrow__val', text: sort.val(r) }));
    node.style.transform = `translateY(${pos * rowH}px)`;
    node.dataset.pos = String(pos);
    if (pos === active) node.classList.add('is-active');
    return node;
  }

  function renderRows() {
    raf = 0;
    if (!view.length) return;
    const top = list.scrollTop;
    const h = list.clientHeight || 500;
    const first = Math.max(0, Math.floor(top / rowH) - OVERSCAN);
    const last = Math.min(view.length - 1, Math.ceil((top + h) / rowH) + OVERSCAN);
    for (const [pos, node] of live) {
      if (pos < first || pos > last) { node.remove(); live.delete(pos); }
    }
    const frag = document.createDocumentFragment();
    for (let pos = first; pos <= last; pos++) {
      if (!live.has(pos)) {
        const node = rowNode(view[pos], pos);
        live.set(pos, node);
        frag.append(node);
      }
    }
    inner.append(frag);
  }

  list.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(renderRows); }, { passive: true });
  new ResizeObserver(() => { if (status === 'ready') renderRows(); }).observe(list);

  function scrollToIndex(pos, mode = 'nearest') {
    const top = pos * rowH;
    const h = list.clientHeight;
    if (mode === 'center') list.scrollTop = Math.max(0, top - (h - rowH) / 2);
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (top + rowH > list.scrollTop + h) list.scrollTop = top + rowH - h;
    renderRows();
  }

  function setActive(pos, { select = false, scroll = true } = {}) {
    if (!view.length) return;
    pos = Math.max(0, Math.min(view.length - 1, pos));
    live.get(active)?.classList.remove('is-active');
    active = pos;
    if (scroll) scrollToIndex(pos);
    else renderRows();
    live.get(active)?.classList.add('is-active');
    list.setAttribute('aria-activedescendant', rowId(view[pos]));
    if (select) selectRow(view[pos]);
  }

  function selectRow(r) {
    if (selected === r) return;
    selected = r;
    for (const node of live.values()) node.setAttribute('aria-selected', String(view[+node.dataset.pos] === r));
    showCalc(r);
    if (announce) announce.textContent = `${r.name}: absolute ${sig(r.tAbs * 1e6, 3)} micromoons, facing ${sig(r.tFac * 1e6, 3)} micromoons.`;
  }

  list.addEventListener('click', (e) => {
    const node = e.target.closest('.m-vrow');
    if (!node) return;
    setActive(+node.dataset.pos, { select: true, scroll: false });
    if (window.matchMedia('(max-width: 980px)').matches) {
      calc.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });

  list.addEventListener('keydown', (e) => {
    if (status !== 'ready' || !view.length) return;
    const page = Math.max(1, Math.floor(list.clientHeight / rowH) - 1);
    let pos = active < 0 ? -1 : active;
    switch (e.key) {
      case 'ArrowDown': pos += 1; break;
      case 'ArrowUp': pos -= 1; break;
      case 'PageDown': pos += page; break;
      case 'PageUp': pos -= page; break;
      case 'Home': pos = 0; break;
      case 'End': pos = view.length - 1; break;
      case 'Enter': case ' ': if (active >= 0) selectRow(view[active]); e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    setActive(pos, { select: true });
  });
  list.addEventListener('focus', () => { if (status === 'ready' && active < 0 && view.length) setActive(0); });

  // ---- Worked calculation ----------------------------------------------------------
  function showCalc(r) {
    const scroll = calc.scrollTop;
    renderCalc(calc, r, { latest, designs, groupLabels, seeing: getSeeing() });
    calc.querySelector('.m-calc__back')?.remove();
    const back = el('button', { type: 'button', class: 'm-btn m-btn--small m-calc__back', text: 'Back to the list' });
    back.addEventListener('click', () => { list.focus({ preventScroll: true }); list.scrollIntoView({ block: 'center' }); });
    calc.append(back);
    calc.scrollTop = scroll;
    paintTex();
  }

  function paintTex() {
    if (!katex) return;
    calc.querySelectorAll('[data-calc-tex]').forEach((n) => renderFitted(katex, n, n.dataset.calcTex));
  }

  let seeRaf = 0;
  onSeeing(() => {
    if (!selected) return;
    cancelAnimationFrame(seeRaf);
    seeRaf = requestAnimationFrame(() => showCalc(selected));
  });

  // ---- Open an object from elsewhere on the page ------------------------------------
  function open(target) {
    section.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (status !== 'ready') { pending = target; load(); return; }
    const match = (r) => (target.norad != null && target.norad !== '' ? r.norad === String(target.norad) : r.cospar === target.cospar && r.name === target.name);
    let pos = view.findIndex(match);
    if (pos < 0) {
      controls.q.value = ''; controls.group.value = ''; controls.type.value = ''; controls.src.value = '';
      applyFilters({ keepSelection: false });
      pos = view.findIndex(match);
    }
    if (pos >= 0) {
      scrollToIndex(pos, 'center');
      setActive(pos, { select: true, scroll: false });
    }
  }

  return { open, load };
}
