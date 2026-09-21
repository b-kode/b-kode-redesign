/* ============================================================
   B-Kode — SOLWEIG 2m Thermal Comfort demo.
   Real MapLibre map, ported from the dashboard's own pattern
   (frontend/js/app.js buildCityMap/openDetail): a city map with a
   hexbin UTCI choropleth (typical-day mean, per scenario) where the
   3 story neighbourhoods are outlined and clickable; clicking opens
   a 2 m SOLWEIG raster detail map with a dimmed OSM basemap
   underneath, matching frontend/'s look.
   ============================================================ */

const HEX_RAMP = ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c",
                  "#fc4e2a", "#e31a1c", "#bd0026", "#800026"];
const SCEN_LABEL = { present: 'Present', '2050': '2050', '2090': '2090' };
// Must match UTCI_GLOBAL_RANGE in pipeline/build_story.py — the fixed
// domain the ramp is stretched over everywhere, so a colour means the same
// °C in every scenario, neighbourhood, and city. Used as the fallback when
// a story.json predates this range (older demo data without hexRange/
// utciNaturalRange pinned to it).
const UTCI_GLOBAL_RANGE = [26, 46];

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
      layout: { visibility: 'none' },
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
function geojsonBounds(gj){
  const b = new maplibregl.LngLatBounds();
  (gj.features || [gj]).forEach(f => addCoordsToBounds(f.geometry.coordinates, b));
  return b;
}
function cornersFor(b){ return [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]]; }

function hexRampExpr(range, scen){
  const [lo, hi] = range || UTCI_GLOBAL_RANGE;
  const stops = [];
  HEX_RAMP.forEach((c, i) => stops.push(lo + ((hi - lo) * i) / (HEX_RAMP.length - 1), c));
  const val = ['coalesce', ['get', `utci_${scen}`], ['get', 'utci_present'], ['get', 'utci'], lo];
  return ['interpolate', ['linear'], val, ...stops];
}

async function initSolweigDemo(el){
  let idx;
  try { idx = await loadJSON('demo/solweig/index.json'); }
  catch (e) { return demoError(el); }

  const cityOpts = idx.cities.map(c => ({ v: c.id, t: c.label }));

  el.innerHTML = `
    <div class="sw-city-select">
      ${field('City', 'swCity', cityOpts, idx.cities[0].id)}
    </div>
    <div class="sw-stage">
      <div class="sw-map" data-citymap></div>
      <!-- All overlay cards stack top-left only — MapLibre's own
           controls own the other 3 corners (zoom top-right, scale
           bottom-left, attribution bottom-right), so nothing here
           ever fights them for space. -->
      <div class="sw-overlay-stack">
        <div class="sw-stats" data-citystats hidden>
          <span class="lbl">Typical-day mean UTCI</span>
          <span data-cityrange>—</span>
        </div>
        <div class="sw-legend" data-legend hidden>
          <span class="lbl" data-legendlabel>UTCI · typical day</span>
          <div class="bar" data-legendbar></div>
          <div class="ticks"><span data-legendlo>—</span><span data-legendhi>—</span></div>
        </div>
      </div>
    </div>
    <!-- Scenario picker lives BELOW the map, never on top of it. -->
    <div class="sw-city-scenario-seg" data-cityscenarioseg></div>
      <div class="sw-detail" data-detail hidden>
        <div class="sw-detail-head">
          <h3 data-detailtitle>—</h3>
          <button type="button" class="sw-close" data-close>Close &times;</button>
        </div>
        <p class="sw-detail-blurb" data-detailblurb></p>
        <div class="sw-detail-stage">
          <div class="sw-map" data-detailmap></div>
          <div class="sw-overlay-stack">
            <label class="sw-layer-toggle">
              <input type="checkbox" data-utcitoggle checked /> UTCI layer
            </label>
            <div class="sw-legend sw-legend--detail" data-detaillegend>
              <span class="lbl" data-detaillabel>UTCI · this scenario</span>
              <div class="bar" data-detaillegendbar></div>
              <div class="ticks"><span data-detaillegendlo>—</span><span data-detaillegendhi>—</span></div>
            </div>
          </div>
        </div>
        <!-- Scenario picker lives BELOW the map, never on top of it —
             same pattern as the city overview's picker above. -->
        <div class="sw-scenario-seg" data-scenarioseg></div>
      </div>
    </div>`;

  const $city = el.querySelector('#swCity');
  const $cityMapEl = el.querySelector('[data-citymap]');
  const $detailMapEl = el.querySelector('[data-detailmap]');
  const $detail = el.querySelector('[data-detail]');
  const $detailTitle = el.querySelector('[data-detailtitle]');
  const $detailBlurb = el.querySelector('[data-detailblurb]');
  const $cityScenarioSeg = el.querySelector('[data-cityscenarioseg]');
  const $scenarioSeg = el.querySelector('[data-scenarioseg]');
  const $close = el.querySelector('[data-close]');
  const $cityStats = el.querySelector('[data-citystats]');
  const $cityRange = el.querySelector('[data-cityrange]');
  const $legend = el.querySelector('[data-legend]');
  const $legendLabel = el.querySelector('[data-legendlabel]');
  const $legendBar = el.querySelector('[data-legendbar]');
  const $legendLo = el.querySelector('[data-legendlo]');
  const $legendHi = el.querySelector('[data-legendhi]');
  const $utciToggle = el.querySelector('[data-utcitoggle]');
  const $detailLabel = el.querySelector('[data-detaillabel]');
  const $detailLegendBar = el.querySelector('[data-detaillegendbar]');
  const $detailLegendLo = el.querySelector('[data-detaillegendlo]');
  const $detailLegendHi = el.querySelector('[data-detaillegendhi]');

  // Two independent scenario choices: the city-wide hexbin overview
  // (cityScenarioId) and the open neighbourhood's 2 m detail
  // (detailScenarioId) — picking present/2050/2090 in one must not
  // change the other, since they answer different questions (city
  // typical-day pattern vs one neighbourhood's hot-day raster).
  let story = null, cityMap = null, detailMap = null, openHood = null;
  let cityScenarioId = 'present', detailScenarioId = 'present';
  let utciVisible = true;

  function base(){ return `demo/solweig/${$city.value}/`; }

  async function loadCity(){
    story = await loadJSON(base() + 'story.json');
    cityScenarioId = story.scenarios[0];
    $detail.hidden = true;
    openHood = null;
    renderCityScenarioSeg();
    await buildCityMap();
  }

  function renderCityScenarioSeg(){
    $cityScenarioSeg.innerHTML = story.scenarios.map(id =>
      `<button data-scen="${id}" class="${id === cityScenarioId ? 'is-active' : ''}">${SCEN_LABEL[id] || id}</button>`).join('');
    $cityScenarioSeg.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => {
        cityScenarioId = b.dataset.scen;
        $cityScenarioSeg.querySelectorAll('button').forEach(x => x.classList.toggle('is-active', x === b));
        try { cityMap.setPaintProperty('hex-fill', 'fill-color', hexRampExpr(story.hexRange, cityScenarioId)); } catch (e) {}
        renderLegend();
      }));
  }

  function renderLegend(){
    // story.hexRange is the FIXED global range the map is painted on
    // (same for every scenario/hood/city — see UTCI_GLOBAL_RANGE in
    // build_story.py), so the legend ticks always match what the
    // colours actually mean, and stay identical across scenarios.
    const [lo, hi] = story.hexRange || UTCI_GLOBAL_RANGE;
    const grad = HEX_RAMP.map((c, i) => `${c} ${((i / (HEX_RAMP.length - 1)) * 100).toFixed(0)}%`).join(', ');
    $legendBar.style.background = `linear-gradient(to right, ${grad})`;
    $legendLo.textContent = lo.toFixed(0) + ' °C';
    $legendHi.textContent = hi.toFixed(0) + ' °C';
    $legendLabel.textContent = `UTCI · typical day · ${SCEN_LABEL[cityScenarioId] || cityScenarioId}`;
    $legend.hidden = false;
    $cityStats.hidden = false;
    $cityRange.textContent = `${lo.toFixed(0)}–${hi.toFixed(0)} °C · ${SCEN_LABEL[cityScenarioId] || cityScenarioId}`;
  }

  async function buildCityMap(){
    if (cityMap) { try { cityMap.remove(); } catch (e) {} cityMap = null; }
    const [hexGeo, streetGeo] = await Promise.all([
      loadJSON(base() + story.cityHexes),
      story.cityStreets ? loadJSON(base() + story.cityStreets).catch(() => null) : null,
    ]);
    const sel = new Set(story.neighbourhoods.map(h => h.hexId));

    const map = new maplibregl.Map({
      container: $cityMapEl,
      style: JSON.parse(JSON.stringify(OSM_STYLE)),
      center: story.center, zoom: 10.5,
      attributionControl: { compact: true }, dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
    cityMap = map;

    map.on('load', () => {
      try { map.setLayoutProperty('osm', 'visibility', 'visible'); } catch (e) {}
      map.addSource('hexes', { type: 'geojson', data: hexGeo, promoteId: 'hex_id' });
      map.addLayer({ id: 'hex-fill', type: 'fill', source: 'hexes',
        paint: { 'fill-color': hexRampExpr(story.hexRange, cityScenarioId), 'fill-opacity': 0.75 } });
      map.addLayer({ id: 'hex-edge', type: 'line', source: 'hexes',
        paint: { 'line-color': '#22303c', 'line-opacity': 0.4, 'line-width': 0.4 } });
      map.addLayer({ id: 'hex-sel-glow', type: 'line', source: 'hexes',
        filter: ['in', ['get', 'hex_id'], ['literal', [...sel]]],
        paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.55, 'line-blur': 1 } });
      map.addLayer({ id: 'hex-sel', type: 'line', source: 'hexes',
        filter: ['in', ['get', 'hex_id'], ['literal', [...sel]]],
        paint: { 'line-color': '#0b0f15', 'line-width': 2.2 } });

      const byId = {};
      story.neighbourhoods.forEach(h => (byId[h.hexId] = h));
      map.on('mouseenter', 'hex-sel', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'hex-sel', () => (map.getCanvas().style.cursor = ''));
      map.on('click', 'hex-fill', (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        const h = byId[f.properties.hex_id];
        if (h) openDetail(h);
      });

      const pop = new maplibregl.Popup({ closeButton: false, closeOnMove: true, className: 'sw-pop' });
      map.on('mousemove', 'hex-fill', (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        const p = f.properties;
        const v = p[`utci_${cityScenarioId}`] ?? p.utci_present ?? p.utci;
        pop.setLngLat(e.lngLat)
          .setHTML(`<b>${v == null ? '—' : (+v).toFixed(1) + ' °C'}</b>` +
            (byId[p.hex_id] ? ' · click for 2 m detail' : ''))
          .addTo(map);
      });
      map.on('mouseleave', 'hex-fill', () => pop.remove());

      if (streetGeo && streetGeo.features && streetGeo.features.length) {
        map.addSource('cstreets', { type: 'geojson', data: streetGeo });
        map.addLayer({ id: 'cstreets', type: 'line', source: 'cstreets',
          paint: { 'line-color': '#e9edf3', 'line-opacity': 0.3,
                   'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 15, 1.6] } });
      }

      const b = new maplibregl.LngLatBounds();
      (hexGeo.features || []).forEach(ft => addCoordsToBounds(ft.geometry.coordinates, b));
      if (!b.isEmpty()) map.fitBounds(b, { padding: 40, duration: 0 });

      renderLegend();
    });
  }

  async function openDetail(h){
    openHood = h;
    $detail.hidden = false;
    $detailTitle.textContent = h.name;
    $detailBlurb.textContent = h.blurb;
    detailScenarioId = h.scenarios[0].id;
    renderScenarioSeg(h);
    await buildDetailMap(h);
    $detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // This is the neighbourhood detail's OWN present/2050/2090 choice —
  // deliberately independent of the city overview's cityScenarioId
  // (picked via $cityScenarioSeg above). Switching one must never
  // move the other's map or legend.
  function renderScenarioSeg(h){
    $scenarioSeg.innerHTML = h.scenarios.map(sc =>
      `<button data-scen="${sc.id}" class="${sc.id === detailScenarioId ? 'is-active' : ''}">${sc.label}</button>`).join('');
    $scenarioSeg.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => {
        detailScenarioId = b.dataset.scen;
        $scenarioSeg.querySelectorAll('button').forEach(x => x.classList.toggle('is-active', x === b));
        applyDetailRaster(h);
      }));
  }

  async function buildDetailMap(h){
    if (detailMap) { try { detailMap.remove(); } catch (e) {} detailMap = null; }
    const [hexGeo, streetGeo] = await Promise.all([
      loadJSON(base() + h.hex),
      h.streets ? loadJSON(base() + h.streets).catch(() => null) : null,
    ]);

    const dm = new maplibregl.Map({
      container: $detailMapEl,
      style: JSON.parse(JSON.stringify(OSM_STYLE)),
      bounds: geojsonBounds(hexGeo), fitBoundsOptions: { padding: 34 },
      attributionControl: { compact: true }, dragRotate: false,
    });
    dm.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    dm.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
    detailMap = dm;

    dm.on('load', () => {
      try { dm.setLayoutProperty('osm', 'visibility', 'visible'); } catch (e) {}
      applyDetailRaster(h);
      if (streetGeo && streetGeo.features && streetGeo.features.length) {
        dm.addSource('streets', { type: 'geojson', data: streetGeo });
        dm.addLayer({ id: 'streets-casing', type: 'line', source: 'streets',
          paint: { 'line-color': '#0b0f15', 'line-opacity': 0.4,
                   'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.4, 17, 4.5] } });
        dm.addLayer({ id: 'streets', type: 'line', source: 'streets',
          paint: { 'line-color': '#f2f5f9', 'line-opacity': 0.85,
                   'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 2.2] } });
      }
      dm.addSource('hex', { type: 'geojson', data: hexGeo });
      dm.addLayer({ id: 'hex-line', type: 'line', source: 'hex',
        paint: { 'line-color': '#000000', 'line-width': 4 } });
      dm.addLayer({ id: 'hex-halo', type: 'line', source: 'hex',
        paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.6 } });
    });
  }

  function applyDetailRaster(h){
    const dm = detailMap;
    if (!dm) return;
    const sc = h.scenarios.find(s => s.id === detailScenarioId) || h.scenarios[0];
    if (!sc.utci || !sc.utciBounds) return;
    const url = base() + sc.utci;
    const coords = cornersFor(sc.utciBounds);
    const draw = () => {
      const src = dm.getSource('utci');
      if (src) src.updateImage({ url, coordinates: coords });
      else {
        dm.addSource('utci', { type: 'image', url, coordinates: coords });
        const before = dm.getLayer('streets-casing') ? 'streets-casing'
          : dm.getLayer('hex-line') ? 'hex-line' : undefined;
        dm.addLayer({ id: 'utci', type: 'raster', source: 'utci',
          paint: { 'raster-opacity': 0.9, 'raster-resampling': 'nearest' } }, before);
      }
      try { dm.setLayoutProperty('utci', 'visibility', utciVisible ? 'visible' : 'none'); } catch (e) {}
    };
    if (dm.isStyleLoaded()) draw(); else dm.once('load', draw);
    renderDetailLegend(h, sc);
  }

  function renderDetailLegend(h, sc){
    // h.utciRange is the FIXED global range the PNG was actually painted
    // on (see UTCI_GLOBAL_RANGE in build_story.py) — show that, not
    // sc.utciNaturalRange (the scenario's own 2–98 percentile), so the
    // legend always matches what the colours mean and stays identical
    // across scenarios/neighbourhoods/cities.
    const range = h.utciRange || sc.utciNaturalRange || UTCI_GLOBAL_RANGE;
    const [lo, hi] = range;
    const grad = HEX_RAMP.map((c, i) => `${c} ${((i / (HEX_RAMP.length - 1)) * 100).toFixed(0)}%`).join(', ');
    $detailLegendBar.style.background = `linear-gradient(to right, ${grad})`;
    $detailLegendLo.textContent = lo.toFixed(0) + ' °C';
    $detailLegendHi.textContent = hi.toFixed(0) + ' °C';
    $detailLabel.textContent = `UTCI · ${sc.label}`;
  }

  $city.addEventListener('change', loadCity);
  $close.addEventListener('click', () => { $detail.hidden = true; openHood = null; });
  $utciToggle.addEventListener('change', () => {
    utciVisible = $utciToggle.checked;
    try { detailMap && detailMap.setLayoutProperty('utci', 'visibility', utciVisible ? 'visible' : 'none'); } catch (e) {}
    $detailLegendBar.parentElement.style.opacity = utciVisible ? '1' : '0.35';
  });

  await loadCity();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('solweigDemo');
  if (el) initSolweigDemo(el);
});
