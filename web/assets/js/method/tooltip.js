// One floating tooltip per chart container. Content is built with textContent only.
import { el } from './format.js';

export function createTooltip(container) {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const tip = el('div', { class: 'm-tip', role: 'presentation', hidden: true });
  container.append(tip);

  function show({ title, rows = [], note }, x, y) {
    tip.replaceChildren();
    if (title) tip.append(el('p', { class: 'm-tip__title', text: title }));
    for (const r of rows) {
      const row = el('div', { class: 'm-tip__row' });
      if (r.key) row.append(el('span', { class: 'm-tip__key', style: `--key: ${r.key}` }));
      row.append(el('span', { text: r.label }), el('b', { text: r.value }));
      tip.append(row);
    }
    if (note) tip.append(el('p', { class: 'm-tip__note', text: note }));
    tip.hidden = false;
    place(x, y);
  }

  function place(x, y) {
    const cw = container.clientWidth;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = x + 16;
    if (left + tw > cw - 4) left = x - tw - 16;
    if (left < 4) left = Math.max(4, Math.min(cw - tw - 4, x - tw / 2));
    let top = y - th - 12;
    if (top < 4) top = y + 16;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function hide() { tip.hidden = true; }

  return { show, hide, node: tip };
}
