// Shared page state: the seeing width chosen with the slider (arcseconds).
const listeners = new Set();
let seeing = 2;

export function getSeeing() { return seeing; }

export function setSeeing(value, source) {
  if (!Number.isFinite(value) || value <= 0 || value === seeing) return;
  seeing = value;
  listeners.forEach((fn) => fn(seeing, source));
}

export function onSeeing(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
