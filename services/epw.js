/* ============================================================
   B-Kode — EPW Scenario Generator demo.
   Standalone (no build step): fetches demo/epw/epw_demo.json and
   renders a monthly climate band chart as inline SVG, no chart lib.
   Ported from mockups/b-kode-services/services.js.
   ============================================================ */

const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];

async function loadJSON(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error('failed to load ' + url);
  return res.json();
}

function field(label, id, options, sel){
  return `<div class="svc-field">
    <label for="${id}">${label}</label>
    <select id="${id}">${options.map(o =>
      `<option value="${o.v}"${o.v === sel ? ' selected' : ''}>${o.t}</option>`).join('')}</select>
  </div>`;
}

const fmt1 = n => (n >= 0 ? '' : '−') + Math.abs(n).toFixed(1);

/* generic line/band chart (inline SVG, no libs) */
function lineChart(series, opt){
  opt = opt || {};
  const W = 760, H = 300, m = { l: 44, r: 14, t: 14, b: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = series[0].values.length;
  let lo = Infinity, hi = -Infinity;
  series.forEach(s => {
    (s.area ? s.area.lo.concat(s.area.hi) : s.values).forEach(v => {
      if (v < lo) lo = v; if (v > hi) hi = v;
    });
  });
  if (opt.y0 != null) lo = Math.min(lo, opt.y0);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const X = i => m.l + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const Y = v => m.t + ih * (1 - (v - lo) / (hi - lo));
  const path = vals => vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');

  const ticks = 4;
  const yGrid = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = lo + (hi - lo) * i / ticks;
    return `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${W - m.r}" y2="${Y(v).toFixed(1)}" stroke="#eee"/>
            <text x="${m.l - 8}" y="${Y(v).toFixed(1)}" text-anchor="end" dominant-baseline="middle"
                  font-size="11" fill="#919499">${v.toFixed(0)}</text>`;
  }).join('');

  const xLabels = (opt.xLabels || []).map((lb, i) => lb == null ? '' :
    `<text x="${X(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#919499">${lb}</text>`
  ).join('');

  const areas = series.filter(s => s.area).map(s => {
    const top = s.area.hi.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const bot = s.area.lo.map((v, i) => `L${X(n - 1 - i).toFixed(1)},${Y(s.area.lo[n - 1 - i]).toFixed(1)}`).join('');
    return `<path d="${top}${bot}Z" fill="${s.color}" opacity="0.13"/>`;
  }).join('');

  const lines = series.map(s =>
    `<path d="${path(s.values)}" fill="none" stroke="${s.color}" stroke-width="2.5"
       ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>`
  ).join('');

  const legend = series.map((s, i) =>
    `<g transform="translate(${m.l + i * 150},0)">
       <line x1="0" y1="6" x2="22" y2="6" stroke="${s.color}" stroke-width="3" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>
       <text x="28" y="10" font-size="12" fill="#484d55">${s.name}</text>
     </g>`).join('');

  return `
    <div class="svc-legend"><svg viewBox="0 0 ${W} 16" width="100%" height="16">${legend}</svg></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="${opt.aria || 'chart'}">
      ${yGrid}${areas}${lines}${xLabels}
      ${opt.yTitle ? `<text x="12" y="${m.t + ih / 2}" transform="rotate(-90 12 ${m.t + ih / 2})"
         text-anchor="middle" font-size="11" fill="#919499">${opt.yTitle}</text>` : ''}
    </svg>`;
}

function demoError(el){
  el.innerHTML = `<p class="svc-demo-loading">Demo data needs a local server —
    run <code>python -m http.server</code> in the repo root and open it over
    <code>http://localhost:8000</code> (opening the file directly won't fetch the JSON).</p>`;
}

async function initEpwDemo(el){
  let data;
  try { data = await loadJSON('demo/epw/epw_demo.json'); }
  catch (e) { return demoError(el); }

  const varOpts = Object.entries(data.vars).map(([v, o]) => ({ v, t: o.label }));
  const cityOpts = data.cities.map(c => ({ v: c.id, t: c.label }));

  el.innerHTML = `
    <div class="svc-demo-controls">
      ${field('City', 'epwCity', cityOpts, data.cities[0].id)}
      ${field('EPW type', 'epwType', [{v:'TMY',t:'TMY — Typical Meteorological Year'},{v:'DSY',t:'DSY — Design Summer Year'}], 'TMY')}
      ${field('Variable', 'epwVar', varOpts, 'tdb')}
      <div class="svc-field">
        <label for="epwFut">Future scenario</label>
        <select id="epwFut"></select>
      </div>
    </div>
    <div class="svc-demo-figure">
      <div data-fig></div>
      <div class="svc-demo-caption" data-cap></div>
    </div>`;

  const $city = el.querySelector('#epwCity');
  const $type = el.querySelector('#epwType');
  const $var  = el.querySelector('#epwVar');
  const $fut  = el.querySelector('#epwFut');
  const $fig  = el.querySelector('[data-fig]');
  const $cap  = el.querySelector('[data-cap]');

  function futures(){
    const yt = data.cities.find(c => c.id === $city.value).yearTypes[$type.value];
    return (yt && yt.future) || [];
  }
  function refreshFutures(){
    const fs = futures();
    const prev = $fut.value;
    $fut.innerHTML = fs.map((f, i) =>
      `<option value="${i}">${f.scenarioLabel} · ${f.periodLabel.replace('_', '–')}</option>`).join('');
    const def = fs.findIndex(f => f.scenario === 'ssp245' && f.period === '2031_2050');
    $fut.value = prev && prev < fs.length ? prev : (def >= 0 ? def : 0);
  }

  function render(){
    const city = data.cities.find(c => c.id === $city.value);
    const yt = city.yearTypes[$type.value];
    const vn = $var.value;
    const unit = data.vars[vn].unit;
    if (!yt || !yt.historical || !yt.historical.monthly[vn]) {
      $fig.innerHTML = `<p class="svc-demo-loading">No ${$type.value} profile for ${city.label}.</p>`;
      $cap.textContent = '';
      return;
    }
    const mkBand = src => ({
      lo: src.monthly[vn].map(m => m.p10),
      hi: src.monthly[vn].map(m => m.p90),
      med: src.monthly[vn].map(m => m.p50),
    });
    const h = mkBand(yt.historical);
    const series = [{
      name: 'Historical 1991–2020', color: '#717479',
      values: h.med, area: { lo: h.lo, hi: h.hi }, dash: '5 4',
    }];
    let capExtra = '';
    const fut = futures()[+$fut.value];
    if (fut && fut.monthly[vn]) {
      const f = mkBand(fut);
      series.push({
        name: fut.scenarioLabel + ' ' + fut.periodLabel.replace('_', '–'),
        color: '#e97770', values: f.med, area: { lo: f.lo, hi: f.hi },
      });
      const dP99 = fut.stats[vn].p99 - yt.historical.stats[vn].p99;
      capExtra = ` &nbsp;·&nbsp; P99 shifts <strong>${fmt1(dP99)} ${unit}</strong> ` +
                 `(${yt.historical.stats[vn].p99.toFixed(1)} → ${fut.stats[vn].p99.toFixed(1)} ${unit}).`;
    }
    $fig.innerHTML = lineChart(series, {
      xLabels: MONTHS, yTitle: data.vars[vn].label + ' (' + unit + ')',
      aria: data.vars[vn].label + ' by month for ' + city.label,
    });
    $cap.innerHTML = `<strong>${city.label}</strong> — ${data.vars[vn].label}, ` +
      `${$type.value} file, monthly P10–P90 band.` + capExtra;
  }
  [$city, $type].forEach(s => s.addEventListener('change', () => { refreshFutures(); render(); }));
  [$var, $fut].forEach(s => s.addEventListener('change', render));
  refreshFutures();
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('epwDemo');
  if (el) initEpwDemo(el);
});
