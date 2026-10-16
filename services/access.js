/* ============================================================
   B-Kode — 3-30-300 demo (Warangal, India).
   Real MapLibre map over the interactive viewer's results:
     · zoomed out  — average score per area (3 aggregation levels)
     · zoomed in   — every building (174,395) from a vector-tile
                     pyramid, coloured by its class on the chosen rule
   Switch between the overall score and each rule (3 / 30 / 300);
   click a building or area for its details.
   ============================================================ */

const BASE = 'demo/access/';
// amber (worst) -> teal (best), same classes as the interactive viewer
const CLASS_COLORS = ["#a4691b", "#d1a559", "#edd9a8", "#c6f2ec", "#6edfd5", "#009b8e"];
const CLASS_LABELS = ["Very very bad", "Very bad", "Bad", "Good", "Very good", "Excellent"];

const RULES = [
  { id: 'total', label: 'Overall' },
  { id: '3',   label: 'Rule 3 · trees',  long: 'Rule 3 — trees nearby',          cls: 'c3',   val: 'v3',   rank: 'rank_3'   },
  { id: '30',  label: 'Rule 30 · canopy', long: 'Rule 30 — canopy cover',        cls: 'c30',  val: 'v30',  rank: 'rank_30'  },
  { id: '300', label: 'Rule 300 · parks', long: 'Rule 300 — distance to a park', cls: 'c300', val: 'v300', rank: 'rank_300' },
];
const RULE_FMT = {
  '3':   v => `${Math.round(v)} trees nearby`,
  '30':  v => `${(+v).toFixed(0)}% canopy cover`,
  '300': v => v < 10 ? 'park next door' : `${Math.round(v)} m to the nearest park`,
};

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
      paint: { 'raster-opacity': 0.5, 'raster-saturation': -0.7,
               'raster-brightness-max': 0.5 } },
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

/* colour of a 0..1 position on the amber->teal ramp, as a MapLibre stop list */
function rampStops(lo, hi){
  const out = [];
  CLASS_COLORS.forEach((c, i) => out.push(lo + ((hi - lo) * i) / (CLASS_COLORS.length - 1), c));
  return out;
}

async function initAccessDemo(el){
  let meta, aggs;
  try {
    meta = await loadJSON(BASE + 'meta.json');
    aggs = await Promise.all(meta.levels.map(l => loadJSON(`${BASE}agg_${l.id}.geojson`)));
  } catch (e) { return demoError(el); }

  const root = new URL(BASE, location.href).href;
  const compl = meta.compliance;

  el.innerHTML = `
    <div class="acc-seg" data-seg></div>
    <div class="acc-stage">
      <div class="acc-map" data-map></div>
      <div class="acc-overlay-stack">
        <div class="acc-hint" data-hint></div>
        <div class="acc-legend" data-legend></div>
        <label class="acc-parks"><input type="checkbox" data-parks checked /> Parks (&gt; 0.5 ha)</label>
      </div>
    </div>
    <div class="acc-detail" data-detail hidden>
      <div class="acc-detail-head">
        <h3 data-detailtitle>—</h3>
        <button type="button" class="acc-close" data-close>Close &times;</button>
      </div>
      <div class="acc-bars" data-bars></div>
    </div>
    <div class="acc-compl">
      <div class="acc-compl-head">Warangal in numbers — buildings meeting the 3-30-300 rules
        <span>(rated Good or better, out of ${meta.buildings.toLocaleString()} buildings)</span></div>
      <div class="acc-compl-bar">
        ${compl.map((c, i) => `<span style="flex:${c.pct};background:${CLASS_COLORS[[0, 2, 4, 5][i]]}" title="${c.rules} of 3 rules"></span>`).join('')}
      </div>
      <div class="acc-compl-lbl">${compl.map((c, i) =>
        `<span><i style="background:${CLASS_COLORS[[0, 2, 4, 5][i]]}"></i><b>${c.pct.toFixed(0)}%</b> meet ${c.rules} of 3 rules</span>`).join('')}</div>
    </div>`;

  const $seg = el.querySelector('[data-seg]');
  const $map = el.querySelector('[data-map]');
  const $hint = el.querySelector('[data-hint]');
  const $legend = el.querySelector('[data-legend]');
  const $parks = el.querySelector('[data-parks]');
  const $detail = el.querySelector('[data-detail]');
  const $title = el.querySelector('[data-detailtitle]');
  const $bars = el.querySelector('[data-bars]');
  const $close = el.querySelector('[data-close]');

  let rule = 'total', map = null;
  const rdef = () => RULES.find(r => r.id === rule);

  // value range per level, for stretching the area colours (like the viewer)
  const levelRange = aggs.map(g => {
    const out = {};
    ['t', 'rank_3', 'rank_30', 'rank_300'].forEach(k => {
      const v = g.features.map(f => f.properties[k]);
      out[k] = [Math.min(...v), Math.max(...v)];
    });
    return out;
  });

  function areaKey(){ return rule === 'total' ? 't' : rdef().rank; }

  function renderSeg(){
    $seg.innerHTML = RULES.map(r =>
      `<button data-rule="${r.id}" class="${r.id === rule ? 'is-active' : ''}">${r.label}</button>`).join('');
    $seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      rule = b.dataset.rule; renderSeg(); applyRule();
    }));
  }

  function buildingColor(){
    if (rule === 'total') return ['interpolate', ['linear'], ['get', 't'], ...rampStops(0, 3)];
    const c = rdef().cls;
    return ['match', ['get', c], 0, CLASS_COLORS[0], 1, CLASS_COLORS[1], 2, CLASS_COLORS[2],
            3, CLASS_COLORS[3], 4, CLASS_COLORS[4], CLASS_COLORS[5]];
  }

  function applyRule(){
    renderLegend();
    if (!map || !map.getLayer('bld')) return;
    map.setPaintProperty('bld', 'fill-color', buildingColor());
    meta.levels.forEach((l, i) => {
      const [lo, hi] = levelRange[i][areaKey()];
      map.setPaintProperty('agg-' + l.id, 'fill-color',
        ['interpolate', ['linear'], ['get', areaKey()], ...rampStops(lo, hi === lo ? lo + 1e-6 : hi)]);
    });
    updateHint();
  }

  function renderLegend(){
    const zoomed = map && map.getZoom() >= meta.buildingsMinZoom;
    const grad = `linear-gradient(to right, ${CLASS_COLORS.join(', ')})`;
    if (zoomed && rule !== 'total') {
      $legend.innerHTML = `<span class="lbl">${rdef().long}</span>` +
        CLASS_LABELS.map((l, i) => `<div class="row"><i style="background:${CLASS_COLORS[i]}"></i>${l}</div>`).reverse().join('');
    } else {
      const title = rule === 'total'
        ? (zoomed ? 'Overall score (sum of the 3 rules)' : 'Average overall score per area')
        : 'Average ' + rdef().long.toLowerCase() + ' per area';
      $legend.innerHTML = `<span class="lbl">${title}</span><div class="bar" style="background:${grad}"></div>
        <div class="ticks"><span>Worst</span><span>Best</span></div>`;
    }
  }

  function updateHint(){
    const z = map ? map.getZoom() : 0;
    $hint.textContent = z >= meta.buildingsMinZoom
      ? 'Click a building for its scores.'
      : 'Zoom in to see individual buildings (or click an area).';
    renderLegend();
  }

  function showBuilding(p){
    $detail.hidden = false;
    $title.textContent = `Building #${p.id}`;
    $bars.innerHTML = [RULES[1], RULES[2], RULES[3]].map(r => {
      const c = +p[r.cls], frac = c / 5;
      return `<div class="acc-bar-row">
        <div class="acc-bar-lbl"><b>${r.long}</b><span>${RULE_FMT[r.id](+p[r.val])}</span></div>
        <div class="acc-bar-track"><span style="width:${Math.max(4, frac * 100)}%;background:${CLASS_COLORS[c]}"></span></div>
        <div class="acc-bar-cls" style="color:${CLASS_COLORS[c]}">${CLASS_LABELS[c]}</div></div>`;
    }).join('') + `<div class="acc-bar-total">Overall score <b>${(+p.t).toFixed(1)}</b> / 3.0</div>`;
    $detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function areaPopup(p){
    return `<b>${(+p.t).toFixed(2)} / 3.0</b> average · ${(+p.n).toLocaleString()} buildings<br>
      ${(+p.val_3).toFixed(1)} trees · ${(+p.val_30).toFixed(0)}% canopy · ${Math.round(+p.val_300)} m to park`;
  }

  function buildMap(){
    map = new maplibregl.Map({
      container: $map, style: JSON.parse(JSON.stringify(OSM_STYLE)),
      bounds: [[meta.bounds[0], meta.bounds[1]], [meta.bounds[2], meta.bounds[3]]],
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true }, dragRotate: false, maxZoom: 19,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    map.on('load', async () => {
      const parks = await loadJSON(BASE + 'parks.geojson');
      map.addSource('parks', { type: 'geojson', data: parks });
      map.addLayer({ id: 'parks', type: 'fill', source: 'parks',
        paint: { 'fill-color': '#2ecc71', 'fill-opacity': 0.3, 'fill-outline-color': '#1b7a3d' } });

      meta.levels.forEach((l, i) => {
        map.addSource('agg-' + l.id, { type: 'geojson', data: aggs[i] });
        map.addLayer({ id: 'agg-' + l.id, type: 'fill', source: 'agg-' + l.id,
          ...(l.minzoom != null ? { minzoom: l.minzoom } : {}),
          maxzoom: l.maxzoom,
          paint: { 'fill-color': '#888', 'fill-opacity': 0.8, 'fill-outline-color': 'rgba(11,15,21,0.5)' } });
      });

      map.addSource('bld', { type: 'vector', tiles: [root + 'tiles/{z}/{x}/{y}.pbf'],
        minzoom: 13, maxzoom: 16, bounds: meta.bounds });
      map.addLayer({ id: 'bld', type: 'fill', source: 'bld', 'source-layer': 'b',
        minzoom: meta.buildingsMinZoom,
        paint: { 'fill-color': '#888', 'fill-opacity': 0.9 } });
      map.addLayer({ id: 'bld-line', type: 'line', source: 'bld', 'source-layer': 'b',
        minzoom: meta.buildingsMinZoom,
        paint: { 'line-color': '#0b0f15', 'line-opacity': 0.35, 'line-width': 0.3 } });

      const pop = new maplibregl.Popup({ closeButton: false, className: 'sw-pop', maxWidth: '18em' });
      meta.levels.forEach(l => {
        const id = 'agg-' + l.id;
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; pop.remove(); });
        map.on('mousemove', id, e => {
          const f = e.features && e.features[0];
          if (f) pop.setLngLat(e.lngLat).setHTML(areaPopup(f.properties)).addTo(map);
        });
      });
      map.on('mouseenter', 'bld', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'bld', () => (map.getCanvas().style.cursor = ''));
      map.on('click', 'bld', e => { const f = e.features && e.features[0]; if (f) showBuilding(f.properties); });
      map.on('zoom', updateHint);

      applyRule();
    });
  }

  $parks.addEventListener('change', () => {
    if (map && map.getLayer('parks')) map.setLayoutProperty('parks', 'visibility', $parks.checked ? 'visible' : 'none');
  });
  $close.addEventListener('click', () => { $detail.hidden = true; });

  renderSeg();
  renderLegend();
  updateHint();
  buildMap();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('accessDemo');
  if (el) initAccessDemo(el);
});
