// The data section: coverage tables, status notes and the curated design table.
import { el, intl, pct, trimNum, groupNum, ORBIT_SRC_LABEL, AREA_SRC_LABEL } from './format.js';

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

const TRACKING = { sun: 'Sun-tracking', earth: 'Earth-facing', edge: 'edge-on' };

function dims(b) {
  if (b.area_model === 'gcat') return { body: 'GCAT, generic model', arrays: 'GCAT span' };
  if (!b.body && !b.arrays) return { body: 'Given directly', arrays: 'From parts' };
  const body = b.body ? `${trimNum(b.body.a_m)} × ${trimNum(b.body.b_m)} m` : 'none';
  const ar = b.arrays;
  const arrays = ar && ar.n
    ? `${ar.n} × ${trimNum(ar.length_m)} × ${trimNum(ar.width_m)} m, ${TRACKING[ar.tracking] || ar.tracking}`
    : 'none';
  return { body, arrays };
}

export function renderDesigns(root, buses, latest) {
  const tbody = root.querySelector('[data-render="designs"] tbody');
  if (!tbody) return;
  const facing = latest.toi.facing;
  const sorted = [...buses].sort((a, b) => b.toi_fac - a.toi_fac);
  const rows = [];
  sorted.forEach((b) => {
    const d = dims(b);
    const detailId = `design-detail-${b.id}`;
    const btn = el('button', {
      type: 'button', class: 'm-expand', 'aria-expanded': 'false', 'aria-controls': detailId,
      'aria-label': `Notes and sources for ${b.label}`, text: '+',
    });
    const tr = el('tr', { id: `design-${b.id}` },
      el('th', { scope: 'row' }, el('div', { class: 'm-designs__name' }, btn, el('span', { class: 'm-designs__label', text: b.label }))),
      el('td', {}, el('span', { class: `m-chip m-chip--${b.confidence}`, text: b.confidence })),
      el('td', { text: d.body, class: b.body ? null : 'm-dim' }),
      el('td', { text: d.arrays, class: b.arrays ? null : 'm-dim' }),
      el('td', { class: 'num', text: groupNum(b.A_abs_m2, 4) }),
      el('td', { class: 'num', text: groupNum(b.A_fac_m2, 4) }),
      el('td', { class: 'num', text: groupNum(b.P_fac_m, 4) }),
      el('td', { class: 'num', text: intl(b.n_on_orbit) }),
      el('td', { class: 'num', text: pct(b.toi_fac / facing, b.toi_fac / facing < 0.001 ? 2 : 1) }),
    );
    const meta = [`Median altitude ${trimNum(b.median_alt_km, 4)} km`];
    if (b.area_model === 'gcat') meta.push('Areas are medians over the matched objects');
    if (b.alt_history) {
      const ah = b.alt_history;
      meta.push(`History at ${trimNum(ah.shell_km)} km until ${ah.until}, then to today’s altitude by ${ah.ramp_until}`);
    }
    const detail = el('tr', { class: 'm-designs__detail', id: detailId, hidden: true },
      el('td', { colspan: '9' },
        el('p', { class: 'm-designs__notes', text: b.notes }),
        el('p', { class: 'm-designs__meta', text: meta.join(' · ') }),
        el('ol', { class: 'm-designs__sources' },
          ...b.sources.map((s) => el('li', {}, el('a', { href: s.url, rel: 'noopener', text: s.title })))),
      ),
    );
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      btn.textContent = open ? '+' : '−';
      detail.hidden = open;
    });
    rows.push(tr, detail);
  });
  tbody.replaceChildren(...rows);
}
