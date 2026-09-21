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

/* Catmull-Rom -> cubic Bezier smoothing, so monthly points read as a
   climate curve rather than a jagged polyline. */
function smoothPath(pts){
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/* generic line/band chart (inline SVG, no libs) */
function lineChart(series, opt){
  opt = opt || {};
  const W = 760, H = 320, m = { l: 46, r: 18, t: 20, b: 38 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = series[0].values.length;
  let lo = Infinity, hi = -Infinity;
  series.forEach(s => {
    (s.area ? s.area.lo.concat(s.area.hi) : s.values).forEach(v => {
      if (v < lo) lo = v; if (v > hi) hi = v;
    });
  });
  if (opt.y0 != null) lo = Math.min(lo, opt.y0);
  const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
  const X = i => m.l + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const Y = v => m.t + ih * (1 - (v - lo) / (hi - lo));
  const pts = vals => vals.map((v, i) => [X(i), Y(v)]);

  const ticks = 4;
  const yGrid = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = lo + (hi - lo) * i / ticks;
    const y = Y(v).toFixed(1);
    return `<line class="sc-grid" x1="${m.l}" y1="${y}" x2="${W - m.r}" y2="${y}"/>
            <text class="sc-axis" x="${m.l - 10}" y="${y}" text-anchor="end" dominant-baseline="middle">${v.toFixed(0)}</text>`;
  }).join('');

  const xLabels = (opt.xLabels || []).map((lb, i) => lb == null ? '' :
    `<text class="sc-axis" x="${X(i).toFixed(1)}" y="${H - 12}" text-anchor="middle">${lb}</text>`
  ).join('');

  const defs = series.map((s, i) => `
    <linearGradient id="scFill${i}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${s.color}" stop-opacity="0.02"/>
    </linearGradient>`).join('');

  const areas = series.map((s, i) => {
    if (!s.area) return '';
    const top = smoothPath(pts(s.area.hi));
    const botPts = s.area.lo.map((v, j) => [X(n - 1 - j), Y(s.area.lo[n - 1 - j])]);
    const bot = smoothPath(botPts).replace(/^M/, 'L');
    return `<path class="sc-band" d="${top}${bot}Z" fill="url(#scFill${i})"/>`;
  }).join('');

  const lines = series.map(s =>
    `<path d="${smoothPath(pts(s.values))}" fill="none" stroke="${s.color}" stroke-width="2.75"
       ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('');

  const dots = series.map(s =>
    pts(s.values).map(([x, y]) =>
      `<circle class="sc-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.75" fill="#fff" stroke="${s.color}" stroke-width="2"/>`
    ).join('')
  ).join('');

  const legend = series.map((s, i) =>
    `<span class="sc-legend-item">
       <svg width="22" height="10" viewBox="0 0 22 10"><line x1="1" y1="5" x2="21" y2="5" stroke="${s.color}" stroke-width="3" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linecap="round"/></svg>
       <span>${s.name}</span>
     </span>`).join('');

  return `
    <div class="sc-legend">${legend}</div>
    <svg class="sc-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="${opt.aria || 'chart'}">
      <defs>${defs}</defs>
      ${yGrid}${areas}${lines}${dots}${xLabels}
      ${opt.yTitle ? `<text class="sc-ytitle" x="14" y="${m.t + ih / 2}" transform="rotate(-90 14 ${m.t + ih / 2})"
         text-anchor="middle">${opt.yTitle}</text>` : ''}
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

/* ============================================================
   Request form — free (historical) vs paid (future/CMIP6) split.
   Field logic ported from X-GenWeather-Portal's Streamlit form
   (github.com/JonasBlancke/X-GenWeather-Portal): historical AMY/TMY
   is free, future TMY/XMY needs a CMIP6 run and is paid, UHI
   correction needs an LCZ. No backend here, so submission builds a
   pre-filled mailto with the same structured summary that portal
   posted as YAML, instead of a Formspree endpoint.
   ============================================================ */
function initEpwRequestForm(form){
  const $amyYear = form.querySelector('#reqAmyYear');
  const $tmyStart = form.querySelector('#reqTmyStart');
  const $tmyEnd = form.querySelector('#reqTmyEnd');
  const $futStart = form.querySelector('#reqFutStart');
  const $futEnd = form.querySelector('#reqFutEnd');
  const $scenarioType = form.querySelector('#reqScenarioType');
  const $gwlField = form.querySelector('[data-gwl-field]');
  const $sspField = form.querySelector('[data-ssp-field]');
  const $histBoxes = [...form.querySelectorAll('[data-hist]')];
  const $futBoxes = [...form.querySelectorAll('[data-fut]')];
  const $amySub = form.querySelector('[data-amy-sub]');
  const $tmySub = form.querySelector('[data-tmy-sub]');
  const $xmyBox = form.querySelector('input[value="XMY"]');
  const $xmySub = form.querySelector('[data-xmy-sub]');
  const $uhi = form.querySelector('#reqUhi');
  const $lczField = form.querySelector('[data-lcz-field]');
  const $costNote = form.querySelector('[data-cost-note]');

  const thisYear = new Date().getFullYear();
  const years = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => to - i);
  $amyYear.innerHTML = years(1960, thisYear).map(y => `<option${y === thisYear - 1 ? ' selected' : ''}>${y}</option>`).join('');
  const fillYearSelect = ($sel, from, to, def) => {
    $sel.innerHTML = years(from, to).reverse().map(y => `<option${y === def ? ' selected' : ''}>${y}</option>`).join('');
  };
  fillYearSelect($tmyStart, 1960, thisYear, 1990);
  fillYearSelect($tmyEnd, 1960, thisYear, 2020);
  fillYearSelect($futStart, 2015, 2100, 2031);
  fillYearSelect($futEnd, 2015, 2100, 2050);

  function syncVisibility(){
    $amySub.hidden = !form.querySelector('input[value="AMY"]').checked;
    $tmySub.hidden = !form.querySelector('input[value="TMY"][data-hist]').checked;
    $gwlField.hidden = $scenarioType.value !== 'gwl';
    $sspField.hidden = $scenarioType.value === 'gwl';
    $xmySub.hidden = !$xmyBox.checked;
    $lczField.hidden = !$uhi.checked;
    updateCostNote();
  }

  function updateCostNote(){
    const histOn = $histBoxes.some(b => b.checked);
    const futOn = $futBoxes.some(b => b.checked);
    if (futOn && histOn) {
      $costNote.innerHTML = '<strong>Mixed request</strong> — historical part is free, future part is quoted after review.';
    } else if (futOn) {
      $costNote.innerHTML = '<strong>Paid request</strong> — future EPW needs a CMIP6 model run, quoted per city/scenario.';
    } else if (histOn) {
      $costNote.innerHTML = 'Historical-only request — <strong>free</strong>.';
    } else {
      $costNote.textContent = 'Select at least one historical or future output.';
    }
  }

  form.addEventListener('change', syncVisibility);
  syncVisibility();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = form.querySelector('#reqName').value.trim();
    const email = form.querySelector('#reqEmail').value.trim();
    const lat = form.querySelector('#reqLat').value.trim();
    const lon = form.querySelector('#reqLon').value.trim();
    const notes = form.querySelector('#reqNotes').value.trim();

    const histSel = $histBoxes.filter(b => b.checked).map(b => b.value);
    const futSel = $futBoxes.filter(b => b.checked).map(b => b.value);

    const lines = [
      `Project / client: ${name || '/'}`,
      `Email: ${email || '/'}`,
      `Location: ${lat || '?'}, ${lon || '?'}`,
      '',
      `Historical EPW (FREE): ${histSel.length ? histSel.join(', ') : 'none'}`,
    ];
    if (histSel.includes('AMY')) lines.push(`  AMY year: ${$amyYear.value}`);
    if (histSel.includes('TMY')) lines.push(`  TMY reference period: ${$tmyStart.value}-${$tmyEnd.value}`);

    lines.push('', `Future EPW (PAID): ${futSel.length ? futSel.join(', ') : 'none'}`);
    if (futSel.length) {
      if ($scenarioType.value === 'gwl') {
        lines.push(`  Scenario: GWL ${form.querySelector('#reqGwl').value}`);
      } else {
        lines.push(`  Scenario: ${form.querySelector('#reqSsp').value.toUpperCase()}, period ${$futStart.value}-${$futEnd.value}`);
      }
      if (futSel.includes('XMY')) {
        lines.push(`  Extreme metric: ${form.querySelector('#reqXmyMetric').value}, return period ${form.querySelector('#reqXmyReturn').value}y`);
      }
    }

    lines.push('', `UHI correction: ${$uhi.checked ? 'yes (LCZ ' + form.querySelector('#reqLcz').value + ')' : 'no'}`);
    if (notes) lines.push('', `Notes: ${notes}`);

    const subject = encodeURIComponent(`EPW request — ${name || 'unnamed project'}`);
    const body = encodeURIComponent(lines.join('\n'));
    window.location.href = `mailto:jonas@b-kode.be?subject=${subject}&body=${body}`;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('epwDemo');
  if (el) initEpwDemo(el);
  const form = document.getElementById('epwReqForm');
  if (form) initEpwRequestForm(form);
});
