/* ============================================================
   B-Kode — Thermal Comfort Maps demo.
   MapLibre map per demo city with two switchable resolutions of
   the same SOLWEIG result (typical day, present climate, 24 h mean):
     · hexagon mean  — GeoJSON choropleth
     · 2 m           — pre-rendered web-tile pyramid (z8–z16)
   Each city carries its own metric (UTCI or WBGT) and colour range.
   ============================================================ */

const RAMP = ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c",
              "#fc4e2a", "#e31a1c", "#bd0026", "#800026"];

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
function field(label, id, options, sel){
  return `<div class="svc-field">
    <label for="${id}">${label}</label>
    <select id="${id}">${options.map(o =>
      `<option value="${o.v}"${o.v === sel ? ' selected' : ''}>${o.t}</option>`).join('')}</select>
  </div>`;
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

function rampExpr(range){
  const [lo, hi] = range;
  const stops = [];
  RAMP.forEach((c, i) => stops.push(lo + ((hi - lo) * i) / (RAMP.length - 1), c));
  return ['interpolate', ['linear'], ['get', 'v'], ...stops];
}

async function initSolweigDemo(el){
  let idx;
  try { idx = await loadJSON('demo/solweig/index.json'); }
  catch (e) { return demoError(el); }

  const cityOpts = idx.cities.map(c => ({ v: c.id, t: c.label }));

  el.innerHTML = `
    <div class="sw-city-select">
      ${field('Demo city', 'swCity', cityOpts, idx.cities[0].id)}
    </div>
    <div class="sw-stage">
      <div class="sw-map" data-map></div>
      <div class="sw-overlay-stack">
        <div class="sw-stats">
          <span class="lbl" data-statlabel>—</span>
          <span data-statvalue>—</span>
        </div>
        <div class="sw-legend">
          <span class="lbl" data-legendlabel>—</span>
          <div class="bar" data-legendbar></div>
          <div class="ticks"><span data-legendlo>—</span><span data-legendhi>—</span></div>
        </div>
      </div>
    </div>
    <div class="sw-city-scenario-seg" data-resseg></div>
    <p class="sw-note" data-note></p>`;

  const $city = el.querySelector('#swCity');
  const $map = el.querySelector('[data-map]');
  const $seg = el.querySelector('[data-resseg]');
  const $note = el.querySelector('[data-note]');
  const $statLabel = el.querySelector('[data-statlabel]');
  const $statValue = el.querySelector('[data-statvalue]');
  const $legendLabel = el.querySelector('[data-legendlabel]');
  const $legendBar = el.querySelector('[data-legendbar]');
  const $legendLo = el.querySelector('[data-legendlo]');
  const $legendHi = el.querySelector('[data-legendhi]');

  let meta = null, map = null, mode = 'hex';

  const MODES = [
    { id: 'hex', label: 'Hexagon mean' },
    { id: 'px',  label: '2 m resolution' },
  ];

  function renderSeg(){
    $seg.innerHTML = MODES.map(m =>
      `<button data-mode="${m.id}" class="${m.id === mode ? 'is-active' : ''}">${m.label}</button>`).join('');
    $seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      $seg.querySelectorAll('button').forEach(x => x.classList.toggle('is-active', x === b));
      applyMode();
    }));
  }

  function renderLegend(){
    const [lo, hi] = meta.range;
    const grad = RAMP.map((c, i) => `${c} ${((i / (RAMP.length - 1)) * 100).toFixed(0)}%`).join(', ');
    $legendBar.style.background = `linear-gradient(to right, ${grad})`;
    $legendLo.textContent = lo.toFixed(0) + ' °C';
    $legendHi.textContent = hi.toFixed(0) + ' °C';
    $legendLabel.textContent = `${meta.metric} · typical day, 24 h mean`;
    $statLabel.textContent = `Mean ${meta.metric} · present climate`;
    $statValue.textContent = `${meta.cityMean.toFixed(1)} °C city average (${meta.hexMin.toFixed(1)}–${meta.hexMax.toFixed(1)} °C across hexagons)`;
    $note.textContent = meta.note || '';
  }

  function applyMode(){
    if (!map || !map.isStyleLoaded()) return;
    const hex = mode === 'hex';
    map.setLayoutProperty('hex-fill', 'visibility', hex ? 'visible' : 'none');
    map.setLayoutProperty('hex-edge', 'visibility', hex ? 'visible' : 'none');
    map.setLayoutProperty('px', 'visibility', hex ? 'none' : 'visible');
  }

  async function loadCity(){
    const entry = idx.cities.find(c => c.id === $city.value);
    meta = await loadJSON(`demo/solweig/${entry.id}/meta.json`);
    const root = new URL(`demo/solweig/${entry.id}/`, location.href).href;
    const hexGeo = await loadJSON(root + meta.hex);
    renderLegend();
    renderSeg();

    if (map) { try { map.remove(); } catch (e) {} map = null; }
    const b = new maplibregl.LngLatBounds();
    hexGeo.features.forEach(f => addCoordsToBounds(f.geometry.coordinates, b));

    map = new maplibregl.Map({
      container: $map, style: JSON.parse(JSON.stringify(OSM_STYLE)),
      bounds: b, fitBoundsOptions: { padding: 30 },
      attributionControl: { compact: true }, dragRotate: false, maxZoom: 18.5,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.addSource('px', {
        type: 'raster', tileSize: 256, tiles: [root + meta.tiles],
        minzoom: meta.minzoom, maxzoom: meta.maxzoom, bounds: meta.bounds,
      });
      map.addLayer({ id: 'px', type: 'raster', source: 'px',
        paint: { 'raster-opacity': 0.9, 'raster-resampling': 'nearest' } });
      map.addSource('hexes', { type: 'geojson', data: hexGeo });
      map.addLayer({ id: 'hex-fill', type: 'fill', source: 'hexes',
        paint: { 'fill-color': rampExpr(meta.range), 'fill-opacity': 0.8 } });
      map.addLayer({ id: 'hex-edge', type: 'line', source: 'hexes',
        paint: { 'line-color': '#22303c', 'line-opacity': 0.35, 'line-width': 0.4 } });

      const pop = new maplibregl.Popup({ closeButton: false, closeOnMove: true, className: 'sw-pop' });
      map.on('mousemove', 'hex-fill', (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        pop.setLngLat(e.lngLat)
          .setHTML(`<b>${(+f.properties.v).toFixed(1)} °C</b> ${meta.metric}`).addTo(map);
      });
      map.on('mouseleave', 'hex-fill', () => pop.remove());
      applyMode();
    });
  }

  $city.addEventListener('change', loadCity);
  await loadCity();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('solweigDemo');
  if (el) initSolweigDemo(el);
});
