/* ============================================================
   B-Kode — High-Resolution Land Cover demo.
   Real MapLibre map: overview of central Amsterdam with zoom
   capped to the modelled extent (meta.json's "full" bounds), the
   4 neighbourhoods outlined as clickable rectangles. Click one (or
   pick it from the selector) to open a detail map with its real
   2 m classification raster draped over a real OSM basemap — same
   overview -> detail pattern as the SOLWEIG demo.
   ============================================================ */

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
function boundsToBox(b){ return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]; }
function boundsToPolygonFeature(b, props){
  return { type: 'Feature', properties: props || {}, geometry: { type: 'Polygon', coordinates: [boundsToBox(b)] } };
}
function cornersFor(b){ return [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]]; }
/* The land-cover PNGs are now pre-reprojected to WGS84 (EPSG:4326) —
   see services/demo/landcover/meta.json — from the original UTM 31N
   source GeoTIFF, so meta.json's bounds can be fed to MapLibre's
   image source directly with no further correction; a lon/lat "image"
   source interpolates linearly, and a raster warped straight from
   UTM onto raw lon/lat corners would only approximately line up with
   a Mercator basemap (an earlier attempt to fix that by stretching
   the bounds post-hoc, rather than warping the pixels, wasn't a real
   fix — reprojecting the source data is). */

async function initLandcoverDemo(el){
  let meta;
  const base = 'demo/landcover/';
  try { meta = await loadJSON(base + 'meta.json'); }
  catch (e) { return demoError(el); }

  const hoodOpts = meta.neighbourhoods.map(h => ({ v: h.id, t: h.label }));

  el.innerHTML = `
    <div class="lc-toolbar">
      ${field('Neighbourhood', 'lcHood', hoodOpts, meta.neighbourhoods[0].id)}
      <label class="lc-layer-toggle">
        <span class="lc-switch"><input type="checkbox" data-citylctoggle checked /><span class="lc-switch-track"></span></span>
        Land cover
      </label>
    </div>
    <div class="lc-stage">
      <div class="lc-map" data-citymap></div>
      <!-- Everything stacks top-left only — MapLibre's own controls
           own the other 3 corners (zoom top-right, scale
           bottom-left, attribution bottom-right). -->
      <div class="lc-overlay-stack">
        <div class="lc-hint">Full-city land cover, limited zoom. Click an outlined neighbourhood for its 2 m detail.</div>
        <div class="lc-legend lc-legend--overview" data-citylegend></div>
      </div>
    </div>
    <div class="lc-detail" data-detail hidden>
      <div class="lc-detail-head">
        <h3 data-detailtitle>—</h3>
        <button type="button" class="lc-close" data-close>Close &times;</button>
      </div>
      <div class="lc-detail-stage">
        <div class="lc-map lc-map--detail" data-detailmap></div>
      </div>
      <!-- Toggle lives BELOW the detail map, not on top of it. -->
      <label class="lc-layer-toggle lc-layer-toggle--detail">
        <span class="lc-switch"><input type="checkbox" data-detaillctoggle checked /><span class="lc-switch-track"></span></span>
        Land cover
      </label>
      <div class="lc-legend" data-legend></div>
    </div>`;

  const $hood = el.querySelector('#lcHood');
  const $cityMapEl = el.querySelector('[data-citymap]');
  const $detailMapEl = el.querySelector('[data-detailmap]');
  const $detail = el.querySelector('[data-detail]');
  const $detailTitle = el.querySelector('[data-detailtitle]');
  const $close = el.querySelector('[data-close]');
  const $legend = el.querySelector('[data-legend]');
  const $cityLegend = el.querySelector('[data-citylegend]');
  const $cityLcToggle = el.querySelector('[data-citylctoggle]');
  const $detailLcToggle = el.querySelector('[data-detaillctoggle]');

  const legendHTML = meta.classes.map(c =>
    `<span class="swatch"><span class="dot" style="background:${c.color}"></span>${c.label}</span>`).join('');
  $legend.innerHTML = legendHTML;
  $cityLegend.innerHTML = legendHTML;

  let cityMap = null, detailMap = null;
  const byId = {};
  meta.neighbourhoods.forEach(h => (byId[h.id] = h));

  function buildCityMap(){
    const [w, s, e, n] = meta.full.bounds;
    cityMap = new maplibregl.Map({
      container: $cityMapEl,
      style: JSON.parse(JSON.stringify(OSM_STYLE)),
      // Start noticeably more zoomed out than a tight fit to the
      // modelled extent — generous padding gives real context around
      // Amsterdam instead of cropping right to the data edge. maxZoom
      // is capped on this overview map on purpose (unlike the detail
      // map, which zooms freely) — this is a city-wide picture, not
      // a place to inspect individual pixels; click a neighbourhood
      // for that.
      bounds: [[w, s], [e, n]], fitBoundsOptions: { padding: 220 },
      maxBounds: [[w - 0.08, s - 0.08], [e + 0.08, n + 0.08]],
      minZoom: 9, maxZoom: 14,
      attributionControl: { compact: true }, dragRotate: false,
    });
    cityMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    cityMap.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    cityMap.on('load', () => {
      try { cityMap.setLayoutProperty('osm', 'visibility', 'visible'); } catch (e) {}

      // full-city land-cover overlay, under the neighbourhood outlines
      cityMap.addSource('lc-full', { type: 'image', url: base + meta.full.file, coordinates: cornersFor(meta.full.bounds) });
      cityMap.addLayer({ id: 'lc-full', type: 'raster', source: 'lc-full',
        paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest' } });

      const fc = { type: 'FeatureCollection',
        features: meta.neighbourhoods.map(h => boundsToPolygonFeature(h.bounds, { id: h.id, label: h.label })) };
      cityMap.addSource('hoods', { type: 'geojson', data: fc, promoteId: 'id' });
      cityMap.addLayer({ id: 'hood-fill', type: 'fill', source: 'hoods',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.06 } });
      cityMap.addLayer({ id: 'hood-glow', type: 'line', source: 'hoods',
        paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.5, 'line-blur': 1 } });
      cityMap.addLayer({ id: 'hood-line', type: 'line', source: 'hoods',
        paint: { 'line-color': '#0b0f15', 'line-width': 2.2 } });

      cityMap.on('mouseenter', 'hood-fill', () => (cityMap.getCanvas().style.cursor = 'pointer'));
      cityMap.on('mouseleave', 'hood-fill', () => (cityMap.getCanvas().style.cursor = ''));
      cityMap.on('click', 'hood-fill', (e) => {
        const f = e.features && e.features[0];
        if (f) openDetail(f.properties.id);
      });

      const pop = new maplibregl.Popup({ closeButton: false, closeOnMove: true, className: 'sw-pop' });
      cityMap.on('mousemove', 'hood-fill', (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        pop.setLngLat(e.lngLat).setHTML(`<b>${f.properties.label}</b> · click for 2 m detail`).addTo(cityMap);
      });
      cityMap.on('mouseleave', 'hood-fill', () => pop.remove());
    });
  }

  function openDetail(id){
    const h = byId[id];
    if (!h) return;
    $hood.value = id;
    $detail.hidden = false;
    $detailTitle.textContent = h.label;
    buildDetailMap(h);
    $detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function buildDetailMap(h){
    if (detailMap) { try { detailMap.remove(); } catch (e) {} detailMap = null; }
    const [w, s, e, n] = h.bounds;
    const dm = new maplibregl.Map({
      container: $detailMapEl,
      style: JSON.parse(JSON.stringify(OSM_STYLE)),
      bounds: [[w, s], [e, n]], fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true }, dragRotate: false,
    });
    dm.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    dm.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
    detailMap = dm;

    dm.on('load', () => {
      try { dm.setLayoutProperty('osm', 'visibility', 'visible'); } catch (e) {}
      dm.addSource('lc', { type: 'image', url: base + h.file, coordinates: cornersFor(h.bounds) });
      dm.addLayer({ id: 'lc', type: 'raster', source: 'lc',
        paint: { 'raster-opacity': 0.92, 'raster-resampling': 'nearest' } });
      dm.setLayoutProperty('lc', 'visibility', $detailLcToggle.checked ? 'visible' : 'none');
    });
  }

  $hood.addEventListener('change', () => openDetail($hood.value));
  $cityLcToggle.addEventListener('change', () => {
    try { cityMap.setLayoutProperty('lc-full', 'visibility', $cityLcToggle.checked ? 'visible' : 'none'); } catch (e) {}
  });
  $detailLcToggle.addEventListener('change', () => {
    try { detailMap.setLayoutProperty('lc', 'visibility', $detailLcToggle.checked ? 'visible' : 'none'); } catch (e) {}
  });
  $close.addEventListener('click', () => { $detail.hidden = true; });

  buildCityMap();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('landcoverDemo');
  if (el) initLandcoverDemo(el);
});
