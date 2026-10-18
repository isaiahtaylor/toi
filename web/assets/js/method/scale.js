// Fig. 1: discs at the same scale as the Moon. A disc's area is the expression's share
// of the Moon's area, so its radius is R·√TOI.
import { resolvePath } from './format.js';

export function moonScale(root, latest) {
  root.querySelectorAll('[data-scale]').forEach((c) => {
    const ref = c.parentNode.querySelector('.m-scale__ref');
    const R = ref ? +ref.getAttribute('r') : 80;
    const v = +resolvePath(latest, c.dataset.scale);
    if (Number.isFinite(v) && v >= 0) c.setAttribute('r', (R * Math.sqrt(v)).toFixed(2));
  });
}
