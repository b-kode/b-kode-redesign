/* ============================================================
   B-Kode — Access to Green & Blue (3-30-300) demo.
   Standalone (no build step, no map library): loads the real
   scored-buildings dataset (buildings.geojson, 2,700+ features)
   and renders a 5-rule pentagon radar (inline SVG) for a picked
   building, against the city average.
   ============================================================ */

const RULE_DEFS = [
  { key: 'p3',   label: 'Rule 3 · canopy visible' },
  { key: 'p30',  label: 'Rule 30 · 30% canopy in 30 m' },
  { key: 'p300', label: 'Rule 300 · park within 300 m' },
  { key: 'pdw',  label: 'Drinking water nearby' },
  { key: 'pwf',  label: 'Water fountain nearby' },
];

async function loadJSON(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error('failed to load ' + url);
  return res.json();
}

function demoError(el){
  el.innerHTML = `<p class="svc-demo-loading">Demo data needs a local server —
    run <code>python -m http.server</code> in the repo root and open it over
    <code>http://localhost:8000</code> (opening the file directly won't fetch the JSON).</p>`;
}

/* 5-point radar/pentagon, values 0..1 */
function radarSVG(values, opt){
  opt = opt || {};
  const W = 280, H = 280, cx = W / 2, cy = H / 2, R = 100;
  const n = values.length;
  const angle = i => -Math.PI / 2 + i * (2 * Math.PI / n);
  const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];

  const rings = [0.25, 0.5, 0.75, 1].map(f => {
    const pts = values.map((_, i) => pt(i, R * f).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="#eee" stroke-width="1"/>`;
  }).join('');

  const spokes = values.map((_, i) => {
    const [x, y] = pt(i, R);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#eee" stroke-width="1"/>`;
  }).join('');

  const shapePts = values.map((v, i) => pt(i, R * Math.max(0, Math.min(1, v))).join(',')).join(' ');
  const shape = `<polygon points="${shapePts}" fill="#e97770" fill-opacity="0.28" stroke="#e97770" stroke-width="2"/>`;

  const labels = values.map((_, i) => {
    const [x, y] = pt(i, R + 22);
    const anchor = Math.abs(Math.cos(angle(i))) < 0.2 ? 'middle' : (Math.cos(angle(i)) > 0 ? 'start' : 'end');
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle"
              font-size="9" fill="#919499">${opt.labels ? opt.labels[i] : ''}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opt.aria || 'Access score pentagon'}">
    ${rings}${spokes}${shape}${labels}
  </svg>`;
}

async function initAccessDemo(el){
  let data;
  try { data = await loadJSON('demo/access/buildings.geojson'); }
  catch (e) { return demoError(el); }

  const buildings = data.features.map(f => f.properties);
  const cityAvgTotal = buildings.reduce((s, b) => s + b.total, 0) / buildings.length;

  el.innerHTML = `
    <div class="access-toolbar">
      <div class="svc-field">
        <label for="accessBuilding">Building</label>
        <select id="accessBuilding"></select>
      </div>
      <button type="button" data-random>Random building</button>
    </div>
    <div class="access-card">
      <div class="access-radar" data-radar></div>
      <div class="access-score">
        <span class="total-lbl">Total score</span>
        <div class="total-val" data-total>—</div>
        <div class="total-of">out of 5.0</div>
        <ul class="rule-list" data-rules></ul>
      </div>
    </div>
    <p class="access-avg-note">City average total score across all
      <strong>${buildings.length.toLocaleString()}</strong> scored buildings:
      <strong>${cityAvgTotal.toFixed(2)} / 5.0</strong>.</p>`;

  const $sel = el.querySelector('#accessBuilding');
  const $radar = el.querySelector('[data-radar]');
  const $total = el.querySelector('[data-total]');
  const $rules = el.querySelector('[data-rules]');
  const $random = el.querySelector('[data-random]');

  // Populate the picker with a manageable sample, sorted by id.
  const sample = buildings
    .filter((_, i) => i % 37 === 0)
    .slice(0, 60)
    .sort((a, b) => a.id - b.id);
  $sel.innerHTML = sample.map(b =>
    `<option value="${b.id}">Building #${b.id} — score ${b.total.toFixed(1)}</option>`).join('');

  function render(id){
    const b = buildings.find(x => x.id === id) || sample[0];
    const values = RULE_DEFS.map(r => b[r.key]);
    $radar.innerHTML = radarSVG(values, {
      labels: RULE_DEFS.map(r => r.label),
      aria: `Access pentagon for building ${b.id}`,
    });
    $total.textContent = b.total.toFixed(1);
    $rules.innerHTML = RULE_DEFS.map(r =>
      `<li><span>${r.label}</span><span class="rule-val">${(b[r.key] * 100).toFixed(0)}%</span></li>`).join('');
    $sel.value = String(b.id);
  }

  $sel.addEventListener('change', () => render(+$sel.value));
  $random.addEventListener('click', () => {
    const b = buildings[Math.floor(Math.random() * buildings.length)];
    if (!sample.find(x => x.id === b.id)) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `Building #${b.id} — score ${b.total.toFixed(1)}`;
      $sel.appendChild(opt);
    }
    render(b.id);
  });

  render(sample[0].id);
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('accessDemo');
  if (el) initAccessDemo(el);
});
