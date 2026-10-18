// The worked calculation for one object: the area model ported from pipeline/toi/areas.py
// and designs.py, with this object's numbers substituted into each formula.
import { ARCSEC } from '../toi.js';
import { el, sig, intl, pct, texSci, texNum, trimNum, groupNum, arcsec, confidenceChip, TYPE_LABEL, ORBIT_SRC_LABEL } from './format.js';

// --- Model (keep identical to pipeline/toi/areas.py) ------------------------------------
const SPHERE = /sphere|ball|\bico|geodesic/;
const CYLINDER = /cyl|cone|frust|disk|disc|torus|tank|nozzle|rod|tube|ring|\bell|drum/;
const PANEL = /pan|wing|array/;
// A tether is millimeters thick; when the shape mentions one, the span is the tether length.
const TETHER = /tether/;
const ARRAY_SPAN_MARGIN = 1.05;
const APPENDAGE_WIDTH_FACTOR = 0.1;
const APPENDAGE_FACING_FACTOR = 0.5;
const SUN_TRACKING_FACTOR = 0.5;
const TRACKING_FACTORS = { sun: 0.5, earth: 1, edge: 0 };
export const DEFAULT_AREA_M2 = { DEB: 0.1, PAY: 1, 'R/B': 10, UNK: 0.1 };

export function bodyKind(type, L, D, shape) {
  if (type === 'R/B') return { kind: 'cylinder', why: 'Rocket bodies tumble, so they always use the cylinder row.' };
  const primary = (shape || '').toLowerCase().split('+')[0];
  let m = primary.match(SPHERE);
  if (m) return { kind: 'sphere', why: `The shape “${shape}” starts with a sphere keyword (“${m[0]}”).` };
  m = primary.match(CYLINDER);
  if (m) return { kind: 'cylinder', why: `The shape “${shape}” starts with a cylinder keyword (“${m[0]}”).` };
  if (L < D) return { kind: 'flat', why: `L < D, so GCAT recorded a flat panel with its thickness as the length.` };
  return { kind: 'box', why: shape ? `The shape “${shape}” names no sphere or cylinder, and L ≥ D, so the box row applies.` : 'No shape is given and L ≥ D, so the box row applies.' };
}

// Returns { kind, why, steps: [{tex}], A_abs, A_fac, P_fac }
export function genericArea(type, L, D, span, shape) {
  if (!(L > 0) || !(D > 0)) return null;
  const { kind, why } = bodyKind(type, L, D, shape);
  const n = (x) => texNum(x, 6);
  const steps = [];
  let aAbs; let aFac; let pFac; let extent; let width;
  if (kind === 'sphere') {
    const r = Math.max(L, D) / 2;
    aAbs = aFac = Math.PI * r * r;
    pFac = 2 * Math.PI * r;
    extent = width = 2 * r;
    steps.push(`r = \\max(L,D)/2 = ${n(r)}\\ \\text{m}`);
    steps.push(`A_\\text{abs} = A_\\text{fac} = \\pi r^2 = ${n(aAbs)}\\ \\text{m}^2`);
    steps.push(`P_\\text{fac} = 2\\pi r = ${n(pFac)}\\ \\text{m}`);
  } else if (kind === 'cylinder') {
    aAbs = Math.sqrt((L * D) ** 2 + (Math.PI * D * D / 4) ** 2);
    aFac = (Math.PI * D * L + Math.PI * D * D / 2) / 4;
    pFac = Math.PI * (L + Math.PI * D / 2) / 2;
    extent = Math.max(L, D); width = D;
    steps.push(`A_\\text{abs} = \\sqrt{(LD)^2 + (\\pi D^2/4)^2} = \\sqrt{(${n(L)}\\times${n(D)})^2 + (\\pi\\times${n(D)}^2/4)^2} = ${n(aAbs)}\\ \\text{m}^2`);
    steps.push(`A_\\text{fac} = \\tfrac14(\\pi DL + \\pi D^2/2) = ${n(aFac)}\\ \\text{m}^2`);
    steps.push(`P_\\text{fac} = \\tfrac{\\pi}{2}(L + \\pi D/2) = ${n(pFac)}\\ \\text{m}`);
  } else if (kind === 'box') {
    aAbs = Math.sqrt(2 * (L * D) ** 2 + D ** 4);
    aFac = (2 * L * D + D * D) / 2;
    pFac = Math.PI * (L + 2 * D) / 2;
    extent = L; width = D;
    steps.push(`A_\\text{abs} = \\sqrt{2(LD)^2 + D^4} = \\sqrt{2(${n(L)}\\times${n(D)})^2 + ${n(D)}^4} = ${n(aAbs)}\\ \\text{m}^2`);
    steps.push(`A_\\text{fac} = \\tfrac12(2LD + D^2) = ${n(aFac)}\\ \\text{m}^2`);
    steps.push(`P_\\text{fac} = \\tfrac{\\pi}{2}(L + 2D) = ${n(pFac)}\\ \\text{m}`);
  } else {
    aAbs = aFac = D * D / 2;
    pFac = 3 * D;
    extent = D; width = D / 2;
    steps.push(`A_\\text{abs} = A_\\text{fac} = D^2/2 = ${n(D)}^2/2 = ${n(aAbs)}\\ \\text{m}^2`);
    steps.push(`P_\\text{fac} = 3D = ${n(pFac)}\\ \\text{m}`);
  }
  let append = null;
  const shapeLc = (shape || '').toLowerCase();
  const tether = TETHER.test(shapeLc);
  if (type !== 'R/B' && span && span > ARRAY_SPAN_MARGIN * extent && !tether) {
    const e = span - extent;
    const isPanel = PANEL.test(shapeLc);
    if (isPanel) {
      const arr = e * width;
      const dP = 2 * (e + SUN_TRACKING_FACTOR * width) - 2 * Math.min(SUN_TRACKING_FACTOR * width, width);
      append = { panel: true, e, w: width, area: arr, dP };
      steps.push(`e = \\text{span} - ${n(extent)} = ${n(span)} - ${n(extent)} = ${n(e)}\\ \\text{m},\\quad w = ${n(width)}\\ \\text{m}`);
      steps.push(`A_\\text{abs} \\mathrel{+}= e\\,w = ${n(arr)},\\quad A_\\text{fac} \\mathrel{+}= \\tfrac12 e\\,w = ${n(arr / 2)},\\quad P_\\text{fac} \\mathrel{+}= 2e = ${n(dP)}`);
      aAbs += arr; aFac += SUN_TRACKING_FACTOR * arr; pFac += dP;
    } else {
      const w = APPENDAGE_WIDTH_FACTOR * Math.min(L, D);
      const arr = e * w;
      const dP = 2 * (e + APPENDAGE_FACING_FACTOR * w) - 2 * Math.min(APPENDAGE_FACING_FACTOR * w, w);
      append = { panel: false, e, w, area: arr, dP };
      steps.push(`e = \\text{span} - ${n(extent)} = ${n(e)}\\ \\text{m},\\quad w = 0.1\\min(L,D) = ${n(w)}\\ \\text{m}`);
      steps.push(`A_\\text{abs} \\mathrel{+}= e\\,w = ${n(arr)},\\quad A_\\text{fac} \\mathrel{+}= \\tfrac12 e\\,w = ${n(arr / 2)},\\quad P_\\text{fac} \\mathrel{+}= 2e = ${n(dP)}`);
      aAbs += arr; aFac += APPENDAGE_FACING_FACTOR * arr; pFac += dP;
    }
  }
  return { kind, why, steps, append, tether: tether && span > ARRAY_SPAN_MARGIN * extent, extent, width, A_abs: aAbs, A_fac: aFac, P_fac: pFac };
}

export function flatPanel(design) {
  const b = design.body || { a_m: 0, b_m: 0 };
  const ar = design.arrays || { n: 0, length_m: 0, width_m: 0, tracking: 'sun' };
  const f = TRACKING_FACTORS[ar.tracking] ?? 0.5;
  const a = +b.a_m; const bb = +b.b_m; const nA = +ar.n; const L = +ar.length_m; const w = +ar.width_m;
  const extra = +design.extra_area_m2 || 0;
  const body = a * bb;
  const arrays = nA * L * w;
  return {
    a, b: bb, n: nA, L, w, f, extra, body, arrays,
    A_abs: body + arrays + extra,
    A_fac: body + f * arrays + extra,
    P_fac: 2 * (a + bb) + nA * 2 * (L + f * w) - 2 * nA * Math.min(f * w, bb),
  };
}

export function circlePerimeter(area) { return 2 * Math.sqrt(Math.PI * area); }

// Agreement with the file value at the precision the file keeps (6 significant figures).
// Contributions are recomputed from the rounded areas, so they get twice the tolerance.
export function agrees(model, fileValue, tol = 6e-6) {
  if (!Number.isFinite(model) || !Number.isFinite(fileValue)) return false;
  if (fileValue === 0) return Math.abs(model) < 1e-12;
  return Math.abs(model - fileValue) / Math.abs(fileValue) < tol;
}

// --- Rendering --------------------------------------------------------------------------
function texLine(tex) { return el('div', { class: 'm-math', 'data-calc-tex': tex }, tex.replace(/\\[a-z]+|[{}]/gi, ' ')); }

function step(num, title, ...children) {
  return el('section', { class: 'm-calc__step' }, el('h4', {}, el('span', { text: num }), title), ...children);
}

function checkLine(label, model, fileStr, key, tol) {
  const ok = agrees(model, +fileStr, tol);
  return el('p', { class: 'm-calc__check', 'data-check': key, 'data-model': String(model), 'data-file': fileStr, 'data-ok': String(ok) },
    `${label}: model `, el('b', { text: groupNum(model, 6) }), ', file ', el('b', { text: fileStr }),
    ok ? ', in agreement' : ', different');
}

export function renderCalc(container, obj, ctx) {
  const { latest, designs, groupLabels, seeing } = ctx;
  const omega = latest.constants.omega_moon_sr;
  const design = obj.bus && designs[obj.bus] && obj.area_src === 'curated' ? designs[obj.bus] : null;
  const groupDesign = designs[obj.group] || null;
  const nodes = [];

  // Header
  const ids = [
    obj.norad ? `NORAD ${obj.norad}` : null,
    obj.cospar ? `COSPAR ${obj.cospar}` : null,
    obj.jcat ? `GCAT ${obj.jcat}` : null,
  ].filter(Boolean).join(' · ');
  const meta = [
    TYPE_LABEL[obj.type] || obj.type,
    obj.owner ? `owner ${obj.owner}` : null,
    obj.launch_date ? `launched ${obj.launch_date}` : null,
    obj.regime,
    groupLabels[obj.group] || obj.group,
  ].filter(Boolean).join(' · ');
  nodes.push(el('p', { class: 'm-calc__name', text: obj.name || '(unnamed)' }));
  nodes.push(el('p', { class: 'm-calc__ids' }, ids, el('br'), meta));

  // 1 · Orbit
  const hasOrbit = obj.perigee_km !== '' && obj.apogee_km !== '' && Number.isFinite(+obj.perigee_km) && Number.isFinite(+obj.apogee_km);
  const peri = +obj.perigee_km; const apo = +obj.apogee_km;
  const mean = (peri + apo) / 2;
  // The altitude used: the mean of perigee and apogee (as the pipeline computes it, before
  // the file rounds alt_km), raised to the 100 km floor.
  const h = hasOrbit ? Math.max(100, mean) : +obj.alt_km;
  const orbitText = {
    celestrak: 'Perigee and apogee from CelesTrak’s catalog.',
    gcat: 'CelesTrak has no orbit for this object, so GCAT’s current orbit is used.',
    'launch-mates': `Neither catalog has an orbit, so the median perigee and apogee of the counted objects from launch ${obj.cospar ? obj.cospar.slice(0, 8) : 'mates'} stand in.`,
  }[obj.orbit_src] || `Orbit from ${obj.orbit_src}.`;
  const orbitKids = [el('p', { text: orbitText })];
  if (hasOrbit) {
    let tex = `h = \\frac{${texNum(peri)} + ${texNum(apo)}}{2} = ${texNum(mean)}\\ \\text{km}`;
    if (mean < 100) tex += `\\ \\to\\ 100\\ \\text{km (floor)}`;
    orbitKids.push(texLine(tex));
  } else {
    orbitKids.push(texLine(`h = ${texNum(h)}\\ \\text{km}`));
  }
  orbitKids.push(el('p', { class: 'm-calc__check', 'data-check': 'alt', 'data-model': String(h), 'data-file': obj.alt_km, 'data-ok': String(agrees(h, +obj.alt_km, 1e-3)) },
    'Altitude used: ', el('b', { text: `${trimNum(h, 8)} km` }), ` · file alt_km ${obj.alt_km} · source: ${ORBIT_SRC_LABEL[obj.orbit_src] || obj.orbit_src}`));
  nodes.push(step('1', 'Orbit', ...orbitKids));

  // 2 · Area
  const areaKids = [];
  let model = null;
  if (obj.area_src === 'curated' && design) {
    const chip = confidenceChip(design.confidence);
    areaKids.push(el('p', {}, 'Curated design ', el('a', { href: `#design-${design.id}`, text: design.label }), ' ', chip));
    if (design.body || design.arrays) {
      const fp = flatPanel(design);
      model = fp;
      const trk = design.arrays ? ({ sun: 'Sun-tracking, f = ½', earth: 'Earth-facing, f = 1', edge: 'edge-on, f = 0' }[design.arrays.tracking]) : null;
      areaKids.push(el('dl', { class: 'm-calc__kv' },
        el('dt', { text: 'Body a × b' }), el('dd', { text: design.body ? `${trimNum(fp.a)} × ${trimNum(fp.b)} m` : 'none (the array is the whole silhouette)' }),
        el('dt', { text: 'Arrays n × L × w' }), el('dd', { text: design.arrays ? `${fp.n} × ${trimNum(fp.L)} × ${trimNum(fp.w)} m, ${trk}` : 'none' }),
      ));
      const fTex = fp.f === 0.5 ? '\\tfrac12' : texNum(fp.f);
      areaKids.push(texLine(`A_\\text{abs} = ab + nLw = ${texNum(fp.a)}\\times${texNum(fp.b)} + ${fp.n}\\times${texNum(fp.L)}\\times${texNum(fp.w)} = ${texNum(fp.A_abs, 7)}\\ \\text{m}^2`));
      areaKids.push(texLine(`A_\\text{fac} = ab + f\\,nLw = ${texNum(fp.body, 7)} + ${fTex}\\times${texNum(fp.arrays, 7)} = ${texNum(fp.A_fac, 7)}\\ \\text{m}^2`));
      areaKids.push(texLine(`P_\\text{fac} = 2(a+b) + 2n(L + fw) - 2n\\min(fw, b) = ${texNum(fp.P_fac, 7)}\\ \\text{m}`));
    } else {
      model = { A_abs: design.A_abs_m2, A_fac: design.A_fac_m2, P_fac: design.P_fac_m };
      areaKids.push(el('p', { text: 'The station’s areas are given directly, from its documented parts:' }));
      areaKids.push(texLine(`A_\\text{abs} = ${texNum(design.A_abs_m2)}\\ \\text{m}^2,\\quad A_\\text{fac} = ${texNum(design.A_fac_m2)}\\ \\text{m}^2,\\quad P_\\text{fac} = ${texNum(design.P_fac_m)}\\ \\text{m}`));
      areaKids.push(el('p', { text: design.notes }));
    }
    if (design.sources?.length) {
      areaKids.push(el('p', {}, 'Sources: ', ...design.sources.flatMap((s, i) => [i ? '; ' : '', el('a', { href: s.url, rel: 'noopener', text: s.title })])));
    }
  } else if (obj.area_src === 'gcat') {
    const L = +obj.length_m; const D = +obj.diameter_m; const span = obj.span_m === '' ? 0 : +obj.span_m;
    const g = genericArea(obj.type, L, D, span, obj.shape);
    model = g;
    if (groupDesign && groupDesign.area_model === 'gcat') {
      areaKids.push(el('p', {}, `${groupDesign.label} has no published dimensions, so GCAT’s dimensions go through the generic model. `, el('a', { href: `#design-${groupDesign.id}`, text: 'Design notes' })));
    }
    areaKids.push(el('dl', { class: 'm-calc__kv' },
      el('dt', { text: 'GCAT L × D' }), el('dd', { text: `${obj.length_m} × ${obj.diameter_m} m` }),
      el('dt', { text: 'Span' }), el('dd', { text: obj.span_m ? `${obj.span_m} m` : 'not given' }),
      el('dt', { text: 'Shape' }), el('dd', { text: obj.shape || 'not given' }),
      el('dt', { text: 'Body row' }), el('dd', { text: g ? { sphere: 'sphere', cylinder: 'cylinder', box: 'box', flat: 'flat panel' }[g.kind] : '–' }),
    ));
    if (g) {
      areaKids.push(el('p', { text: g.why }));
      g.steps.forEach((s) => areaKids.push(texLine(s)));
      if (g.append) {
        areaKids.push(el('p', { text: g.append.panel
          ? 'The span exceeds the body by more than 5% and the shape mentions panels, so the extra length counts as solar arrays.'
          : 'The span exceeds the body by more than 5% with no panels in the shape, so the extra length counts as a thin appendage.' }));
      } else if (g.tether) {
        areaKids.push(el('p', { text: 'The shape names a tether, so the span is the tether’s length. A tether is millimeters thick, so nothing is added for it.' }));
      } else if (obj.type !== 'R/B' && span) {
        areaKids.push(el('p', { text: 'The span does not exceed the body by more than 5%, so nothing is added for appendages.' }));
      }
      areaKids.push(texLine(`A_\\text{abs} = ${texNum(g.A_abs)},\\quad A_\\text{fac} = ${texNum(g.A_fac)},\\quad P_\\text{fac} = ${texNum(g.P_fac)}`));
    }
  } else if (obj.area_src === 'rcs') {
    const A = +obj.A_abs_m2;
    model = { A_abs: A, A_fac: A, P_fac: circlePerimeter(A) };
    areaKids.push(el('p', { text: `GCAT has no dimensions for this object. CelesTrak’s radar cross-section of ${obj.A_abs_m2} m² stands in for both areas, and the perimeter is that of a circle of the same area.` }));
    areaKids.push(texLine(`A_\\text{abs} = A_\\text{fac} = ${texNum(A)}\\ \\text{m}^2,\\quad P_\\text{fac} = 2\\sqrt{\\pi A} = ${texNum(model.P_fac)}\\ \\text{m}`));
  } else {
    const A = DEFAULT_AREA_M2[obj.type] ?? 0.1;
    model = { A_abs: A, A_fac: A, P_fac: circlePerimeter(A) };
    areaKids.push(el('p', { text: `No dimensions and no radar cross-section. The default for ${(TYPE_LABEL[obj.type] || 'this type').toLowerCase()} objects is ${A} m², with the perimeter of a circle of that area.` }));
    areaKids.push(texLine(`A_\\text{abs} = A_\\text{fac} = ${texNum(A)}\\ \\text{m}^2,\\quad P_\\text{fac} = 2\\sqrt{\\pi A} = ${texNum(model.P_fac)}\\ \\text{m}`));
  }
  if (model) {
    areaKids.push(checkLine('A_abs', model.A_abs, obj.A_abs_m2, 'A_abs'));
    areaKids.push(checkLine('A_fac', model.A_fac, obj.A_fac_m2, 'A_fac'));
    areaKids.push(checkLine('P_fac', model.P_fac, obj.P_fac_m, 'P_fac'));
  }
  const areaTitle = { curated: 'Area · curated design', gcat: 'Area · GCAT dimensions', rcs: 'Area · radar cross-section', default: 'Area · type default' }[obj.area_src] || 'Area';
  nodes.push(step('2', areaTitle, ...areaKids));

  // 3 · Contribution
  const hm = h * 1000;
  const aAbs = +obj.A_abs_m2; const aFac = +obj.A_fac_m2; const pFac = +obj.P_fac_m;
  const cAbs = aAbs / (hm * hm) / omega;
  const cFac = aFac / (hm * hm) / omega;
  const half = (seeing * ARCSEC) / 2;
  const cApp = (aFac / (hm * hm) + half * pFac / hm + Math.PI * half * half) / omega;
  const hTex = `(${texNum(hm, 7)}\\ \\text{m})^2`;
  const contrib = [
    texLine(`\\text{abs} = \\frac{A_\\text{abs}}{h^2\\,\\Omega_\\moon} = \\frac{${texNum(aAbs)}}{${hTex}\\times${texSci(omega, 5)}} = ${texSci(cAbs, 4)}\\ \\text{moons}`),
    texLine(`\\text{fac} = \\frac{A_\\text{fac}}{h^2\\,\\Omega_\\moon} = \\frac{${texNum(aFac)}}{${hTex}\\times${texSci(omega, 5)}} = ${texSci(cFac, 4)}\\ \\text{moons}`),
    texLine(`\\text{app}(${arcsec(seeing).replace('″', '')}^{\\prime\\prime}) = \\frac{1}{\\Omega_\\moon}\\Big[\\frac{A_\\text{fac}}{h^2} + \\frac{\\theta}{2}\\frac{P_\\text{fac}}{h} + \\pi\\Big(\\frac{\\theta}{2}\\Big)^2\\Big] = \\frac{${texSci(aFac / (hm * hm), 4)} + ${texSci(half * pFac / hm, 4)} + ${texSci(Math.PI * half * half, 4)}}{${texSci(omega, 5)}} = ${texSci(cApp, 4)}`),
  ];
  const res = (series, label, v, total) => el('div', { class: 'm-calc__res', 'data-series': series },
    el('span', { class: 'label', text: label }),
    el('b', { text: `${sig(v * 1e6, 4)} µmoon`, 'data-k': `c_${series}`, 'data-v': String(v) }),
    el('small', { text: `${pct(v / total, v / total < 0.0001 ? 4 : 3)} of the total` }));
  contrib.push(el('div', { class: 'm-calc__result' },
    res('abs', 'Absolute', cAbs, latest.toi.absolute),
    res('fac', 'Facing', cFac, latest.toi.facing),
    res('app', `Apparent at ${arcsec(seeing)}`, cApp, appTotal(latest, seeing)),
  ));
  contrib.push(checkLine('toi_abs', cAbs, obj.toi_abs_str, 'toi_abs', 1.2e-5));
  contrib.push(checkLine('toi_fac', cFac, obj.toi_fac_str, 'toi_fac', 1.2e-5));
  contrib.push(el('p', {}, 'The apparent value follows the seeing slider in ', el('a', { href: '#apparent', text: 'Apparent' }), '. One µmoon is a millionth of a Moon.'));
  nodes.push(step('3', 'Contribution', ...contrib));

  const title = container.querySelector('.m-calc__title');
  container.replaceChildren(title, ...nodes);
  container.dataset.norad = obj.norad || '';
  container.dataset.key = obj.key;
  return { cAbs, cFac, cApp, model };
}

function appTotal(latest, seeing) {
  const s = latest.sums;
  const half = (seeing * ARCSEC) / 2;
  return (s.fac_A_h2 + half * s.fac_P_h + s.n * Math.PI * half * half) / latest.constants.omega_moon_sr;
}

export { intl };
