// History: log-scale line chart of reconstructed TOI since 1957, with measured runs as rings.
import { el, sig, intl } from './format.js';
import { createTooltip } from './tooltip.js';
import { parseCSV } from './csv.js';

const NS = 'http://www.w3.org/2000/svg';
const SERIES = [
  { key: 'abs', col: 'toi_abs', label: 'Absolute' },
  { key: 'fac', col: 'toi_fac', label: 'Facing' },
  { key: 'app', col: 'toi_app', label: 'Apparent' },
];
const COLOR = { abs: 'var(--s-abs)', fac: 'var(--s-fac)', app: 'var(--s-app)' };
const EVENTS = [
  { date: '1960-08-12', label: 'Echo 1' },
  { date: '1998-11-20', label: 'ISS' },
  { date: '2019-05-24', label: 'First Starlinks' },
];
const TWEET = { date: '2024-10-09', value: 0.03 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const t = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const SUPER = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function powLabel(e) {
  if (e >= -3) return e >= 0 ? String(10 ** e) : (10 ** e).toFixed(-e);
  return `10${String(e).split('').map((c) => SUPER[c]).join('')}`;
}
function svg(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
}
function fmtDate(iso, kind) {
  const y = iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1;
  if (kind === 'measured') return `${+iso.slice(8, 10)} ${MONTHS_LONG[m]} ${y}`;
  return `1 ${MONTHS_LONG[m]} ${y}`;
}

export function parseHistory(text) {
  const { header, rows } = parseCSV(text);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return rows.filter((r) => r.length >= header.length).map((r) => ({
    date: r[idx.date],
    kind: r[idx.kind],
    t: t(r[idx.date]),
    toi_abs: +r[idx.toi_abs],
    toi_fac: +r[idx.toi_fac],
    toi_app: +r[idx.toi_app],
    n: +r[idx.n_objects],
    // Optional column: "degraded" marks a run made from GCAT alone (CelesTrak unreachable).
    degraded: idx.status != null && r[idx.status] === 'degraded',
  })).sort((a, b) => a.t - b.t);
}

export function renderHistory(root, rows, latest) {
  const host = root.querySelector('#history-chart');
  const tableHost = root.querySelector('#history-table');
  if (!host) return;
  const recon = rows.filter((r) => r.kind === 'reconstructed');
  const measured = rows.filter((r) => r.kind === 'measured');
  const all = rows;
  let range = 'all';
  let focusIdx = -1;
  const tip = createTooltip(host);

  function view() {
    const start = range === 'all' ? recon[0].t : t('2019-01-01');
    const pts = all.filter((r) => r.t >= start);
    return { start, pts };
  }

  function draw() {
    const width = Math.max(300, host.clientWidth);
    const narrow = width < 620;
    const height = Math.round(Math.min(460, Math.max(300, width * 0.46)));
    const m = { top: 20, right: narrow ? 14 : 136, bottom: 30, left: 50 };
    const { start, pts } = view();
    const end = t('2027-01-01');
    const vals = pts.flatMap((r) => [r.toi_abs, r.toi_fac, r.toi_app]).filter((v) => v > 0);
    let lo = Math.floor(Math.log10(Math.min(...vals)));
    let hi = Math.ceil(Math.log10(Math.max(...vals, TWEET.value)));
    if (hi - lo < 2) lo = hi - 2;
    const X = (tt) => m.left + ((tt - start) / (end - start)) * (width - m.left - m.right);
    const Y = (v) => m.top + ((hi - Math.log10(v)) / (hi - lo)) * (height - m.top - m.bottom);

    const s = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
    // grid and y ticks
    const tickEvery = hi - lo > 6 ? 2 : 1;
    for (let e = lo; e <= hi; e++) {
      const y = Y(10 ** e);
      s.append(svg('line', { x1: m.left, x2: width - m.right, y1: y, y2: y, class: e === lo ? 'h-axis' : 'h-grid' }));
      if ((hi - e) % tickEvery === 0) {
        const lab = svg('text', { x: m.left - 8, y: y + 3.5, 'text-anchor': 'end', class: 'h-tick' });
        lab.textContent = powLabel(e);
        s.append(lab);
      }
    }
    // x ticks
    const y0 = new Date(start).getUTCFullYear();
    const spanYears = 2027 - y0;
    const stepYears = spanYears > 40 ? 10 : spanYears > 15 ? 5 : 1;
    for (let yr = Math.ceil(y0 / stepYears) * stepYears; yr <= 2026; yr += stepYears) {
      const x = X(Date.UTC(yr, 0, 1));
      if (x < m.left - 1) continue;
      s.append(svg('line', { x1: x, x2: x, y1: height - m.bottom, y2: height - m.bottom + 4, class: 'h-axis' }));
      const lab = svg('text', { x, y: height - m.bottom + 17, 'text-anchor': 'middle', class: 'h-tick' });
      lab.textContent = String(yr);
      s.append(lab);
    }
    // events
    if (!narrow) {
      for (const ev of EVENTS) {
        const tt = t(ev.date);
        if (tt < start) continue;
        const x = X(tt);
        s.append(svg('line', { x1: x, x2: x, y1: height - m.bottom - 10, y2: height - m.bottom, class: 'h-event' }));
        const lab = svg('text', { x: x + 4, y: height - m.bottom - 4, class: 'h-note h-note--soft' });
        lab.textContent = ev.label;
        s.append(lab);
      }
    }
    // lines (reconstructed)
    const rv = recon.filter((r) => r.t >= start);
    for (const ser of SERIES) {
      const d = rv.map((r, i) => `${i ? 'L' : 'M'}${X(r.t).toFixed(1)},${Y(r[ser.col]).toFixed(1)}`).join('');
      s.append(svg('path', { d, class: `h-line h-line--${ser.key}` }));
    }
    // My October 2024 estimate: a dashed ring at ~0.03, labelled above the lines with a leader.
    const tx = X(t(TWEET.date));
    const ty = Y(TWEET.value);
    s.append(svg('circle', { cx: tx, cy: ty, r: 6.5, class: 'h-estimate' }));
    // Above the lines on wide charts; in the empty band below them on narrow ones.
    const ly = narrow ? Y(10 ** (lo + (hi - lo) * 0.36)) : Math.max(m.top + 12, Y(10 ** (hi - 0.35)));
    if (narrow) s.append(svg('line', { x1: tx, x2: tx, y1: ty + 8, y2: ly - 12, class: 'h-leader' }));
    else s.append(svg('line', { x1: tx, x2: tx, y1: ty - 8, y2: ly + 6, class: 'h-leader' }));
    const est = svg('text', { x: tx - 6, y: ly, 'text-anchor': 'end', class: 'h-note' });
    est.textContent = 'My estimate';
    const est2 = svg('text', { x: tx - 6, y: ly + 14, 'text-anchor': 'end', class: 'h-note h-note--soft' });
    est2.textContent = '~0.03, 9 Oct 2024';
    s.append(est, est2);
    // measured runs (on narrow screens, name the latest one at the top)
    if (narrow && measured.length) {
      const lastM = measured[measured.length - 1];
      const lab = svg('text', { x: X(lastM.t) - 8, y: m.top + 4, 'text-anchor': 'end', class: 'h-note' });
      lab.textContent = `Measured ${fmtDate(lastM.date, 'measured')}`;
      s.append(lab, svg('line', { x1: X(lastM.t), x2: X(lastM.t), y1: m.top + 8, y2: Y(lastM.toi_app) - 8, class: 'h-leader' }));
    }
    for (const r of measured) {
      for (const ser of SERIES) {
        s.append(svg('circle', { cx: X(r.t), cy: Y(r[ser.col]), r: 6, class: 'h-ring-gap' }));
        s.append(svg('circle', { cx: X(r.t), cy: Y(r[ser.col]), r: 4.5, class: `h-meas h-meas--${ser.key}${r.degraded ? ' h-meas--degraded' : ''}`, style: `fill: var(--sky-1); stroke: ${COLOR[ser.key]}; stroke-width: 2${r.degraded ? '; stroke-dasharray: 2.4 2' : ''}` }));
      }
    }
    // end labels with leaders
    if (!narrow) {
      const last = measured.length ? measured[measured.length - 1] : rv[rv.length - 1];
      const lx = X(last.t);
      const head = svg('text', { x: width - m.right + 14, y: m.top + 4, class: 'h-note' });
      head.textContent = measured.length ? 'Measured' : 'Latest month';
      const head2 = svg('text', { x: width - m.right + 14, y: m.top + 18, class: 'h-note h-note--soft' });
      head2.textContent = fmtDate(last.date, last.kind);
      s.append(head, head2);
      const labels = SERIES.map((ser) => ({ ser, y: Y(last[ser.col]), v: last[ser.col] })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].y, (labels[i - 1].ly ?? labels[i - 1].y) + 15);
      labels[0].ly = labels[0].y;
      for (const l of labels) {
        const x1 = lx + 9;
        const x2 = width - m.right + 14;
        s.append(svg('path', { d: `M${x1},${l.y} L${x2 - 6},${l.ly}`, class: 'h-event' }));
        const txt = svg('text', { x: x2, y: l.ly + 3.5, class: 'h-endlabel' });
        txt.textContent = `${l.ser.label} ${sig(l.v, 3)}`;
        s.append(txt);
      }
    }
    // crosshair layer
    const cross = svg('line', { y1: m.top, y2: height - m.bottom, class: 'h-cross', visibility: 'hidden' });
    const dots = SERIES.map((ser) => svg('circle', { r: 4, class: 'h-dot', style: `fill: ${COLOR[ser.key]}`, visibility: 'hidden' }));
    s.append(cross, ...dots);

    host.replaceChildren(s);
    host.append(tip.node);

    function showAt(i) {
      const r = pts[i];
      if (!r) return;
      focusIdx = i;
      const x = X(r.t);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      SERIES.forEach((ser, k) => {
        dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(r[ser.col])); dots[k].setAttribute('visibility', 'visible');
      });
      const note = r.kind === 'measured'
        ? (r.degraded ? 'Measured run from GCAT alone. CelesTrak was unreachable, and runs like this read high.' : 'Measured run')
        : (r.date === '2024-10-01' ? 'Reconstructed. I estimated ~0.03 on 9 October 2024.' : 'Reconstructed');
      tip.show({
        title: fmtDate(r.date, r.kind),
        rows: [
          { key: COLOR.app, label: 'Apparent', value: sig(r.toi_app, 3) },
          { key: COLOR.abs, label: 'Absolute', value: sig(r.toi_abs, 3) },
          { key: COLOR.fac, label: 'Facing', value: sig(r.toi_fac, 3) },
          { label: 'Objects', value: intl(r.n) },
        ],
        note,
      }, x, Math.min(Y(r.toi_app), Y(r.toi_abs)));
    }
    function hide() {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.hide();
    }
    function nearest(px) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.abs(X(pts[i].t) - px);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    host.onpointermove = (e) => {
      const rect = host.getBoundingClientRect();
      const px = e.clientX - rect.left;
      if (px < m.left - 10 || px > width - m.right + 10) { hide(); return; }
      showAt(nearest(px));
    };
    host.onpointerleave = hide;
    host.onfocus = () => showAt(focusIdx >= 0 && focusIdx < pts.length ? focusIdx : pts.length - 1);
    host.onblur = hide;
    host.onkeydown = (e) => {
      let i = focusIdx >= 0 ? focusIdx : pts.length - 1;
      if (e.key === 'ArrowLeft') i -= e.shiftKey ? 12 : 1;
      else if (e.key === 'ArrowRight') i += e.shiftKey ? 12 : 1;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = pts.length - 1;
      else if (e.key === 'Escape') { hide(); return; }
      else return;
      e.preventDefault();
      showAt(Math.max(0, Math.min(pts.length - 1, i)));
    };
  }

  // A legend entry for degraded runs, only when the file has one.
  const legend = root.querySelector('#history .m-legend--row');
  if (legend && measured.some((r) => r.degraded) && !legend.querySelector('.m-key--ring-degraded')) {
    legend.append(el('li', {}, el('span', { class: 'm-key m-key--ring m-key--ring-degraded', 'aria-hidden': 'true' }), 'GCAT-only run'));
  }

  draw();
  let lastW = host.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(host.clientWidth - lastW) < 2) return;
    lastW = host.clientWidth;
    draw();
  }).observe(host);

  root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    range = b.dataset.range;
    focusIdx = -1;
    root.querySelectorAll('[data-range]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    draw();
  }));

  if (tableHost) {
    const yearly = [];
    let lastYear = '';
    for (const r of recon) {
      const y = r.date.slice(0, 4);
      if (y !== lastYear) { yearly.push(r); lastYear = y; }
    }
    const lastRecon = recon[recon.length - 1];
    if (yearly[yearly.length - 1] !== lastRecon) yearly.push(lastRecon);
    const tableRows = [...yearly, ...measured].sort((a, b) => a.t - b.t);
    tableHost.replaceChildren(
      el('div', { class: 'm-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'TOI history, table' },
        el('table', { class: 'm-table m-table--num' },
          el('caption', { text: 'The first reconstructed month of each year, the latest reconstructed month and every measured run. All months are in history.csv.' }),
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col', text: 'Date' }), el('th', { scope: 'col', text: 'Kind' }),
            el('th', { scope: 'col', class: 'num', text: 'Absolute' }), el('th', { scope: 'col', class: 'num', text: 'Facing' }),
            el('th', { scope: 'col', class: 'num', text: 'Apparent' }), el('th', { scope: 'col', class: 'num', text: 'Objects' }))),
          el('tbody', {}, ...tableRows.map((r) => el('tr', {},
            el('th', { scope: 'row', text: r.date }),
            el('td', { text: r.degraded ? 'measured, GCAT only' : r.kind }),
            el('td', { class: 'num', text: sig(r.toi_abs, 3) }),
            el('td', { class: 'num', text: sig(r.toi_fac, 3) }),
            el('td', { class: 'num', text: sig(r.toi_app, 3) }),
            el('td', { class: 'num', text: intl(r.n) }),
          ))),
        )),
    );
  }

  const oct = recon.find((r) => r.date === '2024-10-01');
  return { oct2024abs: oct?.toi_abs, oct2024fac: oct?.toi_fac };
}

export { MONTHS };
