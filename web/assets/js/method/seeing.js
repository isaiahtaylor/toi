// The seeing slider: live apparent TOI and its three terms from the published sums.
import { apparentTerms, ARCSEC } from '../toi.js';
import { sig, texSci, texInt, arcsec } from './format.js';
import { getSeeing, setSeeing, onSeeing } from './state.js';
import { whenKatex, renderFitted } from './math.js';

const MIN = 0.25;
const MAX = 60;
const SPAN = Math.log(MAX / MIN);
const toSlider = (theta) => Math.round((1000 * Math.log(theta / MIN)) / SPAN);
const fromSlider = (v) => MIN * Math.exp((v / 1000) * SPAN);

export function initSeeing(root, latest) {
  const range = root.querySelector('#seeing-range');
  if (!range) return;
  const out = root.querySelector('#seeing-out');
  const presets = [...root.querySelectorAll('.m-preset')];
  const fields = {
    total: root.querySelector('[data-seeing="total"]'),
    ratio: root.querySelector('[data-seeing="ratio"]'),
    area: root.querySelector('[data-seeing="area"]'),
    rim: root.querySelector('[data-seeing="rim"]'),
    disc: root.querySelector('[data-seeing="disc"]'),
  };
  const segs = Object.fromEntries([...root.querySelectorAll('[data-seg]')].map((s) => [s.dataset.seg, s]));
  const segPct = Object.fromEntries([...root.querySelectorAll('[data-seg-pct]')].map((s) => [s.dataset.segPct, s]));
  const note = root.querySelector('[data-seeing-note]');
  const texNode = root.querySelector('[data-seeing-tex]');
  const omega = latest.constants.omega_moon_sr;
  const sums = latest.sums;
  const facing = latest.toi.facing;

  let katex = null;
  let raf = 0;
  whenKatex().then((k) => { katex = k; paintTex(); }).catch(() => {});

  function paintTex() {
    if (!katex || !texNode) return;
    const theta = getSeeing();
    const half = (theta * ARCSEC) / 2;
    const t = apparentTerms(sums, omega, theta);
    const th = arcsec(theta).replace('″', '');
    const head = `\\text{TOI}_\\text{app}(${th}^{\\prime\\prime})`;
    const inv = `\\frac{1}{${texSci(omega, 5)}}`;
    const t1 = texSci(sums.fac_A_h2, 4);
    const t2 = `${texSci(half, 4)}\\times${sig(sums.fac_P_h, 5)}`;
    const t3 = `${texInt(sums.n)}\\,\\pi\\,(${texSci(half, 4)})^2`;
    const sum = `${sig(t.area, 3)} + ${sig(t.rim, 3)} + ${sig(t.disc, 3)} = ${sig(t.area + t.rim + t.disc, 4)}\\ \\text{moons}`;
    const tex = `\\begin{aligned}${head} &= ${inv}\\Big[\\,${t1} + ${t2} + ${t3}\\Big] \\\\ &= ${sum}\\end{aligned}`;
    const narrow = `\\begin{aligned}${head} = {}&${inv}\\Big[\\,${t1} \\\\ &+ ${t2} \\\\ &+ ${t3}\\Big] \\\\ = {}&${sig(t.area, 3)} + ${sig(t.rim, 3)} + ${sig(t.disc, 3)} \\\\ = {}&${sig(t.area + t.rim + t.disc, 4)}\\ \\text{moons}\\end{aligned}`;
    renderFitted(katex, texNode, tex, narrow);
  }

  function paint(theta) {
    const t = apparentTerms(sums, omega, theta);
    const total = t.area + t.rim + t.disc;
    out.textContent = arcsec(theta);
    range.setAttribute('aria-valuetext', `${sig(theta, 2)} arcseconds`);
    const v = toSlider(theta);
    if (+range.value !== v) range.value = String(v);
    range.style.setProperty('--fill', `${(v / 10).toFixed(1)}%`);
    fields.total.textContent = sig(total, total < 1 ? 3 : 4);
    fields.ratio.textContent = `${sig(total / facing, 3)} times the facing TOI`;
    fields.area.textContent = sig(t.area, 3);
    fields.rim.textContent = sig(t.rim, 3);
    fields.disc.textContent = sig(t.disc, 3);
    for (const k of ['area', 'rim', 'disc']) {
      const share = t[k] / total;
      if (segs[k]) {
        segs[k].style.flexBasis = `calc(${(share * 100).toFixed(2)}% - 2px)`;
        segs[k].title = `${k === 'area' ? 'Area' : k === 'rim' ? 'Rims' : 'Discs'}: ${sig(t[k], 3)} moons (${Math.round(share * 100)}%)`;
      }
      if (segPct[k]) segPct[k].textContent = `${share < 0.01 ? '<1' : Math.round(share * 100)}%`;
    }
    presets.forEach((b) => {
      const p = +b.dataset.seeing;
      b.setAttribute('aria-pressed', String(Math.abs(p - theta) / p < 0.015));
    });
    if (note) {
      const rho = 480e3 * (theta * ARCSEC) / 2;
      const discMoons = (Math.PI * ((theta * ARCSEC) / 2) ** 2) / omega;
      note.textContent = `At ${arcsec(theta)}, a satellite 480 km up is blurred by ρ = ${sig(rho, rho < 10 ? 3 : 2)} m on every edge, and each object adds a seeing disc worth ${sig(discMoons * 1e6, 3)} millionths of a Moon.`;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(paintTex);
  }

  range.addEventListener('input', () => setSeeing(fromSlider(+range.value), 'slider'));
  presets.forEach((b) => b.addEventListener('click', () => setSeeing(+b.dataset.seeing, 'preset')));
  onSeeing((theta) => paint(theta));

  const start = latest.constants.default_seeing_arcsec || 2;
  setSeeing(start, 'init');
  paint(getSeeing());
}
