/* ============================================================
   B-Kode — Access to Green & Blue (3-30-300) demo.
   Real MapLibre map: the real scored-buildings dataset (2,718
   buildings over Bruges) rendered as a fill layer coloured by
   total access score, on a real OSM basemap. Click a building to
   open a five-rule pentagon radar panel against the city average.
   Ported from the standalone Leaflet/flatgeobuf prototype
   (mockups/b-kode-services/demo/accessibilty/interactive_map.html)
   onto the same MapLibre/OSM pattern as the other product demos.
   ============================================================ */

const RULE_DEFS = [
  { key: 'p3',   label: 'Rule 3 · canopy visible' },
  { key: 'p30',  label: 'Rule 30 · 30% canopy in 30 m' },
  { key: 'p300', label: 'Rule 300 · park within 300 m' },
  { key: 'pdw',  label: 'Drinking water nearby' },
  { key: 'pwf',  label: 'Water fountain nearby' },
];
const SCORE_COLORS = ['#d9534f', '#f0ad4e', '#5cb85c', '#1a9e6f'];

const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster', tileSize: 256,
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      attribution: '© OpenStreetMap',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b0f15' } },
    { id: 'osm', type: 'raster', source: 'osm',
      paint: { 'raster-opacity': 0.55, 'raster-saturation': -0.6,
               'raster-brightness-max': 0.55 } },
  ],
};

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
function addCoordsToBounds(c, b){
  if (typeof c[0] === 'number') b.extend(c);
  else c.forEach(x => addCoordsToBounds(x, b));
}

/* 5-point radar/pentagon, values 0..1 */
function radarSVG(values, opt){
  opt = opt || {};
  const W = 260, H = 260, cx = W / 2, cy = H / 2, R = 90;
  const n = values.length;
  const angle = i => -Math.PI / 2 + i * (2 * Math.PI / n);
  const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];

  const rings = [0.25, 0.5, 0.75, 1].map(f => {
    const pts = values.map((_, i) => pt(i, R * f).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
  }).join('');
  const spokes = values.map((_, i) => {
    const [x, y] = pt(i, R);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
  }).join('');
  const shapePts = values.map((v, i) => pt(i, R * Math.max(0, Math.min(1, v))).join(',')).join(' ');
  const shape = `<polygon points="${shapePts}" fill="#f98780" fill-opacity="0.32" stroke="#f98780" stroke-width="2"/>`;
  const labels = values.map((_, i) => {
    const [x, y] = pt(i, R + 20);
    const anchor = Math.abs(Math.cos(angle(i))) < 0.2 ? 'middle' : (Math.cos(angle(i)) > 0 ? 'start' : 'end');
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle"
              font-size="9" fill="rgba(255,255,255,0.7)">${opt.labels ? opt.labels[i] : ''}</text>`;
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
  const byId = {};
  buildings.forEach(b => (byId[b.id] = b));
  const cityAvgTotal = buildings.reduce((s, b) => s + b.total, 0) / buildings.length;
  const maxTotal = Math.max(...buildings.map(b => b.total)) || 5;

  el.innerHTML = `
    <div class="acc-stage">
      <div class="acc-map" data-map></div>
      <div class="acc-hint">Click any coloured building for its 5-rule pentagon.</div>
      <div class="acc-legend">
        <span>Total access score</span>
        <div class="bar"></div>
        <div class="ticks"><span>Worst</span><span>Best</span></div>
      </div>
    </div>
    <div class="acc-detail" data-detail hidden>
      <div class="acc-detail-head">
        <h3 data-detailtitle>—</h3>
        <button type="button" class="acc-close" data-close>Close &times;</button>
      </div>
      <div class="acc-detail-body">
        <div class="acc-radar" data-radar></div>
        <div class="acc-score">
          <span class="total-lbl">Total score</span>
          <div class="total-val" data-total>—</div>
          <div class="total-of">out of 5.0</div>
          <ul class="rule-list" data-rules></ul>
        </div>
      </div>
    </div>
    <p class="acc-avg-note">City average total score across all
      <strong>${buildings.length.toLocaleString()}</strong> scored buildings:
      <strong>${cityAvgTotal.toFixed(2)} / 5.0</strong>.</p>`;

  const $mapEl = el.querySelector('[data-map]');
  const $detail = el.querySelector('[data-detail]');
  const $detailTitle = el.querySelector('[data-detailtitle]');
  const $radar = el.querySelector('[data-radar]');
  const $total = el.querySelector('[data-total]');
  const $rules = el.querySelector('[data-rules]');
  const $close = el.querySelector('[data-close]');

  function showBuilding(id){
    const b = byId[id];
    if (!b) return;
    $detail.hidden = false;
    $detailTitle.textContent = `Building #${b.id}`;
    const values = RULE_DEFS.map(r => b[r.key]);
    $radar.innerHTML = radarSVG(values, { labels: RULE_DEFS.map(r => r.label), aria: `Access pentagon for building ${b.id}` });
    $total.textContent = b.total.toFixed(1);
    $rules.innerHTML = RULE_DEFS.map(r =>
      `<li><span>${r.label}</span><span class="rule-val">${(b[r.key] * 100).toFixed(0)}%</span></li>`).join('');
    $detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $close.addEventListener('click', () => { $detail.hidden = true; });

  const map = new maplibregl.Map({
    container: $mapEl,
    style: JSON.parse(JSON.stringify(OSM_STYLE)),
    attributionControl: { compact: true }, dragRotate: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

  map.on('load', () => {
    try { map.setLayoutProperty('osm', 'visibility', 'visible'); } catch (e) {}
    map.addSource('buildings', { type: 'geojson', data, promoteId: 'id' });
    map.addLayer({ id: 'bld-fill', type: 'fill', source: 'buildings',
      paint: {
        'fill-color': ['interpolate', ['linear'], ['/', ['get', 'total'], maxTotal],
          0, SCORE_COLORS[0], 0.33, SCORE_COLORS[1], 0.66, SCORE_COLORS[2], 1, SCORE_COLORS[3]],
        'fill-opacity': 0.85,
      } });
    map.addLayer({ id: 'bld-line', type: 'line', source: 'buildings',
      paint: { 'line-color': '#0b0f15', 'line-opacity': 0.4, 'line-width': 0.4 } });
    map.addLayer({ id: 'bld-hover', type: 'line', source: 'buildings',
      filter: ['==', ['get', 'id'], -1],
      paint: { 'line-color': '#ffffff', 'line-width': 2.5 } });

    map.on('mouseenter', 'bld-fill', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'bld-fill', () => {
      map.getCanvas().style.cursor = '';
      map.setFilter('bld-hover', ['==', ['get', 'id'], -1]);
    });
    map.on('mousemove', 'bld-fill', (e) => {
      const f = e.features && e.features[0];
      if (f) map.setFilter('bld-hover', ['==', ['get', 'id'], f.properties.id]);
    });
    map.on('click', 'bld-fill', (e) => {
      const f = e.features && e.features[0];
      if (f) showBuilding(f.properties.id);
    });

    const b = new maplibregl.LngLatBounds();
    data.features.forEach(ft => addCoordsToBounds(ft.geometry.coordinates, b));
    if (!b.isEmpty()) map.fitBounds(b, { padding: 30, duration: 0 });
  });

  showBuilding(buildings[0].id);
  $detail.hidden = true;
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('accessDemo');
  if (el) initAccessDemo(el);
});
