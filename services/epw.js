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
       <svg width="18" height="8" viewBox="0 0 18 8"><line x1="1" y1="4" x2="17" y2="4" stroke="${s.color}" stroke-width="1.25" ${s.dash ? `stroke-dasharray="2.5 2.5"` : ''} stroke-linecap="butt"/></svg>
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
   (AMY = one specific year, TMY = a reference period) for any
   coordinate; future TMY/DSY/XTMY/XDSY from CMIP6 for a GHSL city only
   (a global warming level, default 3 °C, or SSP2-4.5 / SSP3-7.0 / SSP5-8.5);
   UHI correction needs an LCZ. Submits to Formspree (see
   EPW_FORMSPREE_ENDPOINT below); falls back to a pre-filled mailto if
   that isn't configured.
   ============================================================ */
// Formspree endpoint for the EPW request form (form id myknozkr,
// https://formspree.io/forms/myknozkr/overview) — submissions POST here
// and land in the inbox configured on that Formspree form.
const EPW_FORMSPREE_ENDPOINT = 'https://formspree.io/f/myknozkr';

/* Pick-a-point map for the optional "custom location" (historical files
   only). It is created the first time the panel is shown (a map inside a
   hidden box has no size), click/drag a marker and the #reqLat/#reqLon
   inputs follow; typing coordinates moves the marker too. */
function initLocationMap(form){
  const mapEl = form.querySelector('#reqLocMap');
  if (!mapEl || typeof maplibregl === 'undefined') return { ensure(){} };
  const $lat = form.querySelector('#reqLat');
  const $lon = form.querySelector('#reqLon');
  let map = null, marker = null;

  function placeMarker(lng, lat, { fly = false } = {}){
    if (marker) marker.setLngLat([lng, lat]);
    else {
      marker = new maplibregl.Marker({ draggable: true, color: '#e97770' }).setLngLat([lng, lat]).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        $lat.value = p.lat.toFixed(4);
        $lon.value = p.lng.toFixed(4);
      });
    }
    if (fly) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 8) });
  }

  function syncFromInputs(){
    const lat = parseFloat($lat.value), lon = parseFloat($lon.value);
    if (map && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      placeMarker(lon, lat, { fly: true });
    }
  }
  $lat.addEventListener('change', syncFromInputs);
  $lon.addEventListener('change', syncFromInputs);

  function create(){
    map = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster', tileSize: 256,
            tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'],
            attribution: '\u00a9 OpenStreetMap',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [10, 40], zoom: 1.4,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', e => {
      $lat.value = e.lngLat.lat.toFixed(4);
      $lon.value = e.lngLat.lng.toFixed(4);
      placeMarker(e.lngLat.lng, e.lngLat.lat);
    });
    if ($lat.value && $lon.value) map.once('load', syncFromInputs);   // e.g. browser autofill
  }

  return { ensure(){ if (!map) create(); else map.resize(); } };
}

/* City picker for future files: the CMIP6 archive only exists for the GHSL
   urban centres (demo/epw/cities.json, id = GHS-UCDB ID_UC_G0, sorted by
   population). Free text never reaches the request — a city only counts as
   chosen once picked from the list, and editing the text clears it again. */
function initCityPicker(form){
  const $input = form.querySelector('#reqCity');
  const $list = form.querySelector('#reqCityList');
  const $picked = form.querySelector('[data-city-picked]');
  if (!$input || !$list) return { get: () => null, clear(){} };

  let cities = null, loading = null, selected = null, active = -1, shown = [];

  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const label = c => c.name + ', ' + c.country;

  function load(){
    if (!loading) {
      loading = loadJSON('demo/epw/cities.json').then(d => {
        cities = d.cities.map(r => ({ id: r[0], name: r[1], country: r[2], lat: r[3], lon: r[4],
          key: norm(r[1] + ' ' + r[2]), nameKey: norm(r[1]) }));
      }).catch(() => { loading = null; });
    }
    return loading;
  }

  function close(){
    $list.hidden = true;
    $input.setAttribute('aria-expanded', 'false');
    active = -1;
  }

  function render(){
    $list.innerHTML = '';
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'is-empty';
      li.textContent = cities ? 'No matching city in the GHSL list' : 'Loading city list…';
      $list.appendChild(li);
    }
    shown.forEach((c, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === active ? 'true' : 'false');
      li.append(c.name);
      const small = document.createElement('small');
      small.textContent = c.country;
      li.appendChild(small);
      // mousedown (not click) so the choice lands before the input loses focus
      li.addEventListener('mousedown', e => { e.preventDefault(); choose(c); });
      $list.appendChild(li);
    });
    $list.hidden = false;
    $input.setAttribute('aria-expanded', 'true');
  }

  function search(){
    const q = norm($input.value.trim());
    if (!cities || !q) { shown = []; return; }
    const starts = [], inside = [];
    for (const c of cities) {
      if (c.nameKey.startsWith(q)) starts.push(c);
      else if (c.key.includes(q)) inside.push(c);
      if (starts.length >= 8) break;
    }
    shown = starts.concat(inside).slice(0, 8);
  }

  function choose(c){
    selected = c;
    $input.value = label(c);
    $picked.hidden = false;
    $picked.textContent = `GHSL urban centre ${c.id} · ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`;
    close();
    form.dispatchEvent(new Event('change'));
  }

  function clear(){
    selected = null;
    $picked.hidden = true;
    $picked.textContent = '';
  }

  $input.addEventListener('focus', () => { load().then(() => { if ($input.value.trim() && !selected) { search(); render(); } }); });
  $input.addEventListener('input', () => {
    if (selected) { clear(); form.dispatchEvent(new Event('change')); }
    load().then(() => { search(); if ($input.value.trim()) { active = shown.length ? 0 : -1; render(); } else close(); });
    if (!cities) { shown = []; render(); }
  });
  $input.addEventListener('keydown', e => {
    if ($list.hidden || !shown.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % shown.length; render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + shown.length) % shown.length; render(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { choose(shown[active]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  $input.addEventListener('blur', () => {
    close();
    // unfinished text is not a valid choice — don't leave it looking like one
    if (!selected) $input.value = '';
  });
  form.addEventListener('reset', () => { clear(); close(); });

  return { get: () => selected, clear };
}

/* Year limits mirror the back end (free_requests settings.py / validator.py): historical
   1960..2024 (ERA5-Land, last full year), TMY and future periods span at least 10 years, a TMY at most 45
   (and AMY + TMY together at most 45 years), future files 2025..2099. The selects only offer valid
   combinations, so an impossible request cannot be built. */
const HIST_MIN = 1960, HIST_MAX = 2024, FUT_MIN = 2025, FUT_MAX = 2099, MIN_SPAN = 10, MAX_UNION = 45;

function fillYears($sel, from, to, want, desc){
  const keep = Number.isFinite(want) ? Math.min(Math.max(want, from), to) : to;
  const list = [];
  for (let y = from; y <= to; y++) list.push(y);
  if (desc) list.reverse();
  $sel.innerHTML = '';
  list.forEach(y => {
    const o = document.createElement('option');
    o.value = o.textContent = y;
    if (y === keep) { o.selected = true; o.setAttribute('selected', ''); }   // attribute: form.reset() keeps it
    $sel.appendChild(o);
  });
}
// the end year can only be start+9 .. (start+maxSpan-1 | max): invalid ranges are not offered
function refreshEnd($start, $end, max, maxSpan, want){
  const s = +$start.value;
  fillYears($end, s + MIN_SPAN - 1, Math.min(max, maxSpan ? s + maxSpan - 1 : max), want);
}

function initEpwRequestForm(form){
  const cityPicker = initCityPicker(form);
  const locationMap = initLocationMap(form);
  const $lat = form.querySelector('#reqLat');
  const $lon = form.querySelector('#reqLon');
  const $custom = form.querySelector('#reqCustomLoc');
  const $customWrap = form.querySelector('[data-custom-wrap]');
  const $customPanel = form.querySelector('[data-custom-panel]');
  const $cityField = form.querySelector('[data-city-field]');
  const $futSub = form.querySelector('[data-fut-sub]');
  const $futCol = form.querySelector('[data-fut]').closest('.svc-req-col');
  const $futLocked = form.querySelector('[data-fut-locked]');
  const $futMode = form.querySelector('#reqFutMode');
  const $gwlSub = form.querySelector('[data-gwl-sub]');
  const $sspSub = form.querySelector('[data-ssp-sub]');
  const $amyYear = form.querySelector('#reqAmyYear');
  const $tmyStart = form.querySelector('#reqTmyStart');
  const $tmyEnd = form.querySelector('#reqTmyEnd');
  const $futStart = form.querySelector('#reqFutStart');
  const $futEnd = form.querySelector('#reqFutEnd');
  const $histBoxes = [...form.querySelectorAll('[data-hist]')];
  const $futBoxes = [...form.querySelectorAll('[data-fut]')];
  const $amySub = form.querySelector('[data-amy-sub]');
  const $tmySub = form.querySelector('[data-tmy-sub]');
  // XTMY / XDSY are the "extreme" variants of TMY/DSY — either one needs
  // the extreme-metric + return-period sub-fields; plain TMY/DSY don't.
  const $xmyBoxes = [...form.querySelectorAll('input[value="XTMY"], input[value="XDSY"]')];
  const $xmySub = form.querySelector('[data-xmy-sub]');
  const $uhi = form.querySelector('#reqUhi');
  const $lczField = form.querySelector('[data-lcz-field]');
  const $costNote = form.querySelector('[data-cost-note]');
  const $allCheckboxes = [...form.querySelectorAll('.svc-req-check input[type="checkbox"]')];

  function initYears(){
    fillYears($amyYear, HIST_MIN, HIST_MAX, HIST_MAX, true);              // newest first, 2024 selected
    fillYears($tmyStart, HIST_MIN, HIST_MAX - (MIN_SPAN - 1), 1990);
    refreshEnd($tmyStart, $tmyEnd, HIST_MAX, MAX_UNION, 2020);
    fillYears($futStart, FUT_MIN, FUT_MAX - (MIN_SPAN - 1), 2031);
    refreshEnd($futStart, $futEnd, FUT_MAX, null, 2050);
  }
  $tmyStart.addEventListener('change', () => refreshEnd($tmyStart, $tmyEnd, HIST_MAX, MAX_UNION, +$tmyEnd.value));
  $futStart.addEventListener('change', () => refreshEnd($futStart, $futEnd, FUT_MAX, null, +$futEnd.value));
  initYears();

  function syncVisibility(){
    // A custom (map) location has no CMIP6 city behind it, so future files are
    // switched off and locked while it is on.
    const customOn = $custom.checked;
    $futBoxes.forEach(b => { if (customOn) b.checked = false; b.disabled = customOn; });
    $futCol.classList.toggle('is-disabled', customOn);
    $futLocked.hidden = !customOn;
    const histOn = $histBoxes.some(b => b.checked);
    const futOn = $futBoxes.some(b => b.checked);
    $gwlSub.hidden = $futMode.value !== 'gwl';
    $sspSub.hidden = $futMode.value !== 'ssp';
    $amySub.hidden = !form.querySelector('input[value="AMY"]').checked;
    $tmySub.hidden = !form.querySelector('input[value="TMY"][data-hist]').checked;
    $xmySub.hidden = !$xmyBoxes.some(b => b.checked);
    $lczField.hidden = !$uhi.checked;
    // A city is the default for everything. A custom location (map) is an opt-in
    // for historical files: future files only exist for the GHSL cities.
    $customWrap.hidden = false;
    $customPanel.hidden = !customOn;
    $cityField.hidden = customOn;
    if (customOn) locationMap.ensure();               // after un-hiding: a map needs a visible box
    // :has() row-tint is CSS-native in current browsers; this class
    // toggle is the fallback for anything older so "checked" is never
    // silently invisible.
    $allCheckboxes.forEach(cb =>
      cb.closest('.svc-req-check').classList.toggle('is-checked', cb.checked));
    updateCostNote();
  }

  function updateCostNote(){
    const histOn = $histBoxes.some(b => b.checked);
    const futOn = $futBoxes.some(b => b.checked);
    if (futOn && histOn) {
      $costNote.textContent = 'Historical and future files for the chosen city.';
    } else if (futOn) {
      $costNote.textContent = 'Future request for the chosen city.';
    } else if (histOn) {
      $costNote.textContent = 'Historical-only request.';
    } else {
      $costNote.textContent = 'Select at least one historical or future output.';
    }
  }

  form.addEventListener('change', syncVisibility);
  syncVisibility();

  const $submitBtn = form.querySelector('.svc-req-submit');
  const $submitRow = form.querySelector('.svc-req-submit-row');
  let $formStatus = form.querySelector('[data-form-status]');
  if (!$formStatus) {
    $formStatus = document.createElement('p');
    $formStatus.className = 'svc-req-status';
    $formStatus.setAttribute('data-form-status', '');
    $formStatus.hidden = true;
    $submitRow.after($formStatus);
  }

  function buildRequestLines(){
    const name = form.querySelector('#reqName').value.trim();
    const email = form.querySelector('#reqEmail').value.trim();
    const notes = form.querySelector('#reqNotes').value.trim();

    const histSel = $histBoxes.filter(b => b.checked).map(b => b.value);
    const futSel = $futBoxes.filter(b => b.checked).map(b => b.value);
    const city = cityPicker.get();

    // Location stays the first-class line the back end already parses. A
    // future-only request has no typed coordinates, so it carries the
    // city's point instead.
    const customOn = $custom.checked;
    let lat = '', lon = '';
    if (customOn) { lat = $lat.value.trim(); lon = $lon.value.trim(); }
    else if (city) { lat = city.lat.toFixed(4); lon = city.lon.toFixed(4); }

    const lines = [
      `Project / client: ${name || '/'}`,
      `Email: ${email || '/'}`,
      `Location: ${lat || '?'}, ${lon || '?'}`,
      ...(!customOn && city ? [`City: ${city.name}, ${city.country} (GHSL ID ${city.id})`] : []),
      '',
      `Historical EPW (FREE): ${histSel.length ? histSel.join(', ') : 'none'}`,
    ];
    if (histSel.includes('AMY')) lines.push(`  AMY year: ${$amyYear.value}`);
    if (histSel.includes('TMY')) lines.push(`  TMY reference period: ${$tmyStart.value}-${$tmyEnd.value}`);

    // intake.py accepts both "(FREE)" and the old "(PAID)" label; deploy this
    // together with that back end (an old back end only knows "(PAID)").
    lines.push('', `Future EPW (FREE): ${futSel.length ? futSel.join(', ') : 'none'}`);
    if (futSel.length) {
      if ($futMode.value === 'gwl') lines.push(`  Scenario: GWL ${form.querySelector('#reqGwl').value} °C`);
      else lines.push(`  Scenario: ${form.querySelector('#reqSsp').value.toUpperCase()}, period ${$futStart.value}-${$futEnd.value}`);
      if (futSel.includes('XTMY') || futSel.includes('XDSY')) {
        lines.push(`  Extreme metric: ${form.querySelector('#reqXmyMetric').value}, return period ${form.querySelector('#reqXmyReturn').value}y`);
      }
    }

    lines.push('', `UHI correction: ${$uhi.checked ? 'yes (LCZ ' + form.querySelector('#reqLcz').value + ')' : 'no'}`);
    if (notes) lines.push('', `Notes: ${notes}`);

    return { name, email, lat, lon, notes, histSel, futSel, city, customOn, lines };
  }

  function setStatus(kind, msg){
    $formStatus.hidden = false;
    $formStatus.textContent = msg;
    $formStatus.className = 'svc-req-status svc-req-status--' + kind;
  }

  // a validation message is stale as soon as the user changes anything
  form.addEventListener('change', () => {
    if ($formStatus.classList.contains('svc-req-status--error')) $formStatus.hidden = true;
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const { name, email, lines, histSel, futSel, city, customOn, lat, lon } = buildRequestLines();

    if (!histSel.length && !futSel.length) {
      setStatus('error', 'Select at least one historical or future output.');
      return;
    }
    if (customOn) {
      const la = parseFloat(lat), lo = parseFloat(lon);
      if (!(Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180)) {
        setStatus('error', 'Enter valid coordinates, or drop a pin on the map.');
        form.querySelector('#reqLat').focus();
        return;
      }
    } else if (!city) {
      setStatus('error', 'Pick a city from the list' +
        ' (or tick "Use a custom location" for a map).');
      form.querySelector('#reqCity').focus();
      return;
    }
    const years = [];
    if (histSel.includes('AMY')) years.push(+$amyYear.value);
    if (histSel.includes('TMY')) years.push(+$tmyStart.value, +$tmyEnd.value);
    if (years.length && Math.max(...years) - Math.min(...years) + 1 > MAX_UNION) {
      setStatus('error', `The historical years you picked span more than ${MAX_UNION} years: bring the AMY year closer to the TMY period.`);
      return;
    }

    // No Formspree endpoint configured yet — fall back to the mailto:
    // draft-opener so the form still does SOMETHING useful meanwhile.
    if (!EPW_FORMSPREE_ENDPOINT) {
      const subject = encodeURIComponent(`EPW request — ${name || 'unnamed project'}`);
      const body = encodeURIComponent(lines.join('\n'));
      window.location.href = `mailto:jonas@b-kode.be?subject=${subject}&body=${body}`;
      return;
    }

    $submitBtn.disabled = true;
    $submitBtn.textContent = 'Sending…';
    setStatus('pending', 'Sending your request…');

    // Built explicitly (not FormData(form)) — this form's fields are
    // plain #ids without name= attributes, so FormData(form) would pick
    // up nothing; Formspree just needs a plain JSON payload.
    const payload = {
      _subject: `EPW request — ${name || 'unnamed project'}`,
      name, email,
      message: lines.join('\n'),
    };

    try {
      const res = await fetch(EPW_FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('request failed');
      // The confirmation lives OUTSIDE the form: the in-form status element is hidden together
      // with the form, which used to leave the user with an empty page after a successful send.
      form.hidden = true;
      $formStatus.hidden = true;
      const $thanks = document.createElement('p');
      $thanks.className = 'svc-req-status svc-req-status--ok';
      $thanks.setAttribute('data-form-thanks', '');
      $thanks.append(
        `Thanks${name ? ', ' + name : ''} — your EPW request has been sent. We'll follow up at ${email || 'the email you provided'} shortly. `);
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'svc-req-again';
      again.textContent = 'Send another request';
      again.addEventListener('click', () => {
        $thanks.remove();
        form.reset();
        initYears();
        syncVisibility();
        form.hidden = false;
        $formStatus.hidden = true;
        $submitBtn.disabled = false;
        $submitBtn.textContent = 'Send request →';
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $thanks.appendChild(again);
      form.after($thanks);
      $thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      $submitBtn.disabled = false;
      $submitBtn.textContent = 'Send request →';
      setStatus('error', `Something went wrong sending the request — email us directly instead: `);
      const a = document.createElement('a');
      a.href = `mailto:jonas@b-kode.be?subject=${encodeURIComponent('EPW request — ' + (name || 'unnamed project'))}&body=${encodeURIComponent(lines.join('\n'))}`;
      a.textContent = 'jonas@b-kode.be';
      $formStatus.appendChild(a);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('epwDemo');
  if (el) initEpwDemo(el);
  const form = document.getElementById('epwReqForm');
  if (form) initEpwRequestForm(form);
});
