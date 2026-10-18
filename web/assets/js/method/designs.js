// The data section: coverage tables, status notes and the curated design table.
import { el, intl, pct, trimNum, groupNum, confidenceChip, ORBIT_SRC_LABEL, AREA_SRC_LABEL } from './format.js';

export function renderCoverage(root, latest) {
  const orbit = root.querySelector('[data-render="orbit-sources"] tbody');
  if (orbit) {
    const total = latest.coverage.orbit_source.reduce((s, r) => s + r.n, 0);
    orbit.replaceChildren(...latest.coverage.orbit_source.map((r) => el('tr', {},
      el('th', { scope: 'row', text: ORBIT_SRC_LABEL[r.source] || r.source }),
      el('td', { class: 'num', text: intl(r.n) }),
      el('td', { class: 'num', text: pct(r.n / total, 1) }),
    )));
  }
  const area = root.querySelector('[data-render="area-sources"] tbody');
  if (area) {
    area.replaceChildren(...latest.coverage.area_source.map((r) => el('tr', {},
      el('th', { scope: 'row', text: AREA_SRC_LABEL[r.source] || r.source }),
      el('td', { class: 'num', text: intl(r.n) }),
      el('td', { class: 'num', text: sharePct(r.share_abs) }),
      el('td', { class: 'num', text: sharePct(r.share_fac) }),
    )));
  }
  const notes = root.querySelector('[data-render="status-notes"]');
  if (notes) {
    const items = [...(latest.status_notes || [])];
    if (latest.status === 'degraded') items.unshift('CelesTrak could not be reached for this run, so the population and orbits come from GCAT alone.');
    if (!items.length) items.push('Nothing unusual this month.');
    notes.replaceChildren(...items.map((t) => el('li', { text: t })));
  }
}

function sharePct(x) {
  if (x >= 0.001) return pct(x, 1);
  if (x >= 0.0001) return pct(x, 2);
  return pct(x, 3);
}

const TRACKING = { sun: 'Sun-tracking', earth: 'faces Earth', edge: 'edge-on' };

function dims(b) {
  if (b.area_model === 'gcat') return [el('span', { class: 'm-dim', text: 'GCAT dimensions, generic model.' }), el('span', { class: 'm-dim', text: 'Areas are medians.' })];
  if (!b.body && !b.arrays) return [el('span', { class: 'm-dim', text: 'Given directly, from' }), el('span', { class: 'm-dim', text: 'documented parts' })];
  const out = [];
  if (b.body) out.push(el('span', {}, el('i', { text: 'Body ' }), `${trimNum(b.body.a_m)} × ${trimNum(b.body.b_m)} m`));
  const ar = b.arrays;
  if (ar && ar.n) {
    const what = ar.n === 1 ? (b.body ? 'Array ' : 'Array only ') : `${ar.n} arrays `;
    out.push(el('span', {}, el('i', { text: what }), `${trimNum(ar.length_m)} × ${trimNum(ar.width_m)} m, ${TRACKING[ar.tracking] || ar.tracking}`));
  }
  if (+b.extra_area_m2) out.push(el('span', {}, el('i', { text: 'Extra ' }), `${trimNum(b.extra_area_m2)} m²`));
  return out;
}

export function renderDesigns(root, buses, latest) {
  const tbody = root.querySelector('[data-render="designs"] tbody');
  if (!tbody) return;
  const facing = latest.toi.facing;
  const sorted = [...buses].sort((a, b) => b.toi_fac - a.toi_fac);
  const rows = [];
  sorted.forEach((b) => {
    const detailId = `design-detail-${b.id}`;
    const btn = el('button', {
      type: 'button', class: 'm-expand', 'aria-expanded': 'false', 'aria-controls': detailId,
      'aria-label': `Notes and sources for ${b.label}`,
    });
    const share = b.toi_fac / facing;
    const tr = el('tr', { id: `design-${b.id}` },
      el('th', { scope: 'row' }, el('div', { class: 'm-designs__name' }, btn,
        el('div', {}, el('span', { class: 'm-designs__label', text: b.label }), confidenceChip(b.confidence)))),
      el('td', { class: 'm-designs__dims' }, ...dims(b)),
      el('td', { class: 'num', text: groupNum(b.A_abs_m2, 4) }),
      el('td', { class: 'num', text: groupNum(b.A_fac_m2, 4) }),
      el('td', { class: 'num', text: groupNum(b.P_fac_m, 4) }),
      el('td', { class: 'num', text: intl(b.n_on_orbit) }),
      el('td', { class: 'num', text: pct(share, share < 0.001 ? 2 : 1) }),
    );
    const meta = [`Median altitude ${trimNum(b.median_alt_km, 4)} km`];
    if (b.area_model === 'gcat') meta.push('areas are medians over the matched objects');
    if (b.alt_history) {
      const ah = b.alt_history;
      meta.push(`history at ${trimNum(ah.shell_km)} km until ${ah.until}, then moving to today’s altitude by ${ah.ramp_until}`);
    }
    const detail = el('tr', { class: 'm-designs__detail', id: detailId, hidden: true },
      el('td', { colspan: '7' },
        el('p', { class: 'm-designs__notes', text: b.notes }),
        el('p', { class: 'm-designs__meta', text: meta.join(' · ') }),
        el('ol', { class: 'm-designs__sources' },
          ...b.sources.map((s) => el('li', {}, el('a', { href: s.url, rel: 'noopener', text: s.title })))),
      ),
    );
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      detail.hidden = open;
    });
    rows.push(tr, detail);
  });
  tbody.replaceChildren(...rows);
}

// Open a design's notes row (used by links from the explorer).
export function openDesign(root, id) {
  const btn = root.querySelector(`#design-${CSS.escape(id)} .m-expand`);
  if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
}
