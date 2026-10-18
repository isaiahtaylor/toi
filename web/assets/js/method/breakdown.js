// Breakdown: group bar chart (absolute and facing), top objects, by type and by regime.
import { el, sig, intl, pct, micro, groupNum, trimNum, TYPE_KEY_LABEL } from './format.js';
import { createTooltip } from './tooltip.js';

const COLORS = { abs: 'var(--s-abs)', fac: 'var(--s-fac)', app: 'var(--s-app)' };

function niceStep(max, target = 4) {
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * mag;
}

export function renderGroups(root, latest) {
  const host = root.querySelector('#groups-chart');
  const tableHost = root.querySelector('#groups-table');
  if (!host) return;
  const groups = latest.groups;
  const facing = latest.toi.facing;
  const absolute = latest.toi.absolute;
  const maxAbs = Math.max(...groups.map((g) => g.toi_abs));
  const step = niceStep(maxAbs);
  const domain = Math.ceil(maxAbs / step) * step;
  const ticks = [];
  for (let t = 0; t <= domain + step / 2; t += step) ticks.push(t);
  const x = (v) => `${((v / domain) * 100).toFixed(3)}%`;

  const wrap = el('div', { class: 'm-bars' });
  const tickRow = el('div', { class: 'm-bars__ticks', 'aria-hidden': 'true' },
    ...ticks.map((t) => el('span', { style: `left:${x(t)}`, text: t === 0 ? '0' : sig(t, 2) })));
  wrap.append(el('div', { class: 'm-bars__axis' }, el('span'), tickRow, el('span')));

  const list = el('ul', { class: 'm-bars__rows', role: 'list', 'aria-label': 'TOI by group; use arrow keys to move between groups' });
  const tip = createTooltip(host);
  const items = groups.map((g, i) => {
    const share = g.toi_fac / facing;
    const label = `${g.label}: absolute ${sig(g.toi_abs, 3)} moons, facing ${sig(g.toi_fac, 3)} moons, ${pct(share, 1)} of the facing total, ${intl(g.n)} objects`;
    const track = el('div', { class: 'm-bars__track' },
      ...ticks.slice(1).map((t) => el('span', { class: 'm-bars__grid', style: `left:${x(t)}`, 'aria-hidden': 'true' })),
      el('span', { class: 'm-bars__bar m-bars__bar--abs', style: `width:${x(g.toi_abs)}` }),
      el('span', { class: 'm-bars__bar m-bars__bar--fac', style: `width:${x(g.toi_fac)}` }),
    );
    const li = el('li', { class: 'm-bars__row', tabindex: i === 0 ? '0' : '-1', 'aria-label': label },
      el('div', { class: 'm-bars__label' }, g.label, el('small', { text: `${intl(g.n)} objects · ${trimNum(g.median_alt_km, 4)} km` })),
      track,
      el('div', { class: 'm-bars__val', text: share < 0.001 ? pct(share, 2) : pct(share, 1) }),
    );
    const showTip = () => {
      const r = li.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const barEnd = track.getBoundingClientRect().left + track.clientWidth * (g.toi_abs / domain);
      tip.show({
        title: g.label,
        rows: [
          { key: COLORS.abs, label: 'Absolute', value: sig(g.toi_abs, 3) },
          { key: COLORS.fac, label: 'Facing', value: sig(g.toi_fac, 3) },
          { key: COLORS.app, label: `Apparent at ${latest.constants.default_seeing_arcsec}″`, value: g.toi_app != null ? sig(g.toi_app, 3) : '–' },
          { label: 'Objects', value: intl(g.n) },
          { label: 'Median altitude', value: `${trimNum(g.median_alt_km, 4)} km` },
          { label: 'Share of absolute', value: pct(g.toi_abs / absolute, 1) },
        ],
      }, Math.min(barEnd - h.left, h.width - 40), r.top - h.top + r.height / 2);
    };
    li.addEventListener('pointerenter', showTip);
    li.addEventListener('pointerleave', () => tip.hide());
    li.addEventListener('focus', showTip);
    li.addEventListener('blur', () => tip.hide());
    return li;
  });
  list.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    let j = i;
    if (e.key === 'ArrowDown') j = Math.min(items.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    else if (e.key === 'Escape') { tip.hide(); return; }
    else return;
    e.preventDefault();
    items[i].tabIndex = -1;
    items[j].tabIndex = 0;
    items[j].focus();
  });
  list.append(...items);
  wrap.append(list);
  host.replaceChildren(wrap);
  host.append(tip.node);

  if (tableHost) {
    tableHost.replaceChildren(el('div', { class: 'm-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'TOI by group, table' },
      el('table', { class: 'm-table m-table--num' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', text: 'Group' }), el('th', { scope: 'col', class: 'num', text: 'Objects' }),
          el('th', { scope: 'col', class: 'num', text: 'Median km' }), el('th', { scope: 'col', class: 'num', text: 'Absolute' }),
          el('th', { scope: 'col', class: 'num', text: 'Facing' }), el('th', { scope: 'col', class: 'num', text: 'Apparent' }),
          el('th', { scope: 'col', class: 'num', text: 'Share of facing' }))),
        el('tbody', {}, ...groups.map((g) => el('tr', {},
          el('th', { scope: 'row', text: g.label }),
          el('td', { class: 'num', text: intl(g.n) }),
          el('td', { class: 'num', text: trimNum(g.median_alt_km, 4) }),
          el('td', { class: 'num', text: sig(g.toi_abs, 3) }),
          el('td', { class: 'num', text: sig(g.toi_fac, 3) }),
          el('td', { class: 'num', text: g.toi_app != null ? sig(g.toi_app, 3) : '–' }),
          el('td', { class: 'num', text: pct(g.toi_fac / facing, 2) }),
        ))),
      )));
  }
}

export function renderTopObjects(root, latest, onOpen) {
  const tbody = root.querySelector('[data-render="top-objects"] tbody');
  if (!tbody) return;
  const labels = Object.fromEntries(latest.groups.map((g) => [g.id, g.label]));
  tbody.replaceChildren(...latest.top_objects.map((o, i) => {
    const key = o.norad != null ? String(o.norad) : o.cospar;
    const name = el('button', { type: 'button', class: 'm-linkbtn', text: o.name, 'data-open': key });
    name.addEventListener('click', () => onOpen && onOpen({ norad: o.norad, cospar: o.cospar, name: o.name }));
    const ids = [o.norad != null ? o.norad : null, o.cospar].filter(Boolean).join(' · ');
    return el('tr', {},
      el('td', { class: 'num m-dim', text: String(i + 1) }),
      el('th', { scope: 'row' }, name, el('small', { class: 'm-top__ids', text: ids })),
      el('td', { text: labels[o.group] || o.group }),
      el('td', { class: 'num', text: trimNum(o.alt_km, 4) }),
      el('td', { class: 'num', text: groupNum(o.A_abs_m2, 4) }),
      el('td', { class: 'num', text: groupNum(o.A_fac_m2, 4) }),
      el('td', { class: 'num', text: micro(o.toi_abs) }),
      el('td', { class: 'num', text: micro(o.toi_fac) }),
    );
  }));
}

const REGIME_LABEL = { LEO: 'Low Earth orbit', MEO: 'Medium Earth orbit', GEO: 'Geostationary', HEO: 'High and eccentric' };

function smallTOI(x) {
  if (x >= 0.001) return sig(x, 3);
  return sig(x, 2);
}

export function renderSummaries(root, latest) {
  const t = root.querySelector('[data-render="by-type"] tbody');
  if (t) {
    t.replaceChildren(...latest.by_type.map((r) => el('tr', {},
      el('th', { scope: 'row', text: TYPE_KEY_LABEL[r.type] || r.type }),
      el('td', { class: 'num', text: intl(r.n) }),
      el('td', { class: 'num', text: smallTOI(r.toi_abs) }),
      el('td', { class: 'num', text: smallTOI(r.toi_fac) }),
      el('td', { class: 'num', text: r.toi_app != null ? smallTOI(r.toi_app) : '–' }),
    )));
  }
  const g = root.querySelector('[data-render="by-regime"] tbody');
  if (g) {
    g.replaceChildren(...latest.by_regime.map((r) => el('tr', {},
      el('th', { scope: 'row' }, el('abbr', { title: REGIME_LABEL[r.regime] || r.regime, text: r.regime })),
      el('td', { class: 'num', text: intl(r.n) }),
      el('td', { class: 'num', text: smallTOI(r.toi_abs) }),
      el('td', { class: 'num', text: smallTOI(r.toi_fac) }),
      el('td', { class: 'num', text: r.toi_app != null ? smallTOI(r.toi_app) : '–' }),
    )));
  }
}
