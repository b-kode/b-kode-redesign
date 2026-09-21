/* ============================================================
   B-Kode — Heat Mapping Campaign demo.
   Same MapLibre pattern as solweig.js: one map, three INDEPENDENT
   layers the visitor can toggle —
     · predicted temperature (ML raster, image overlay, AOI-clipped)
     · recorded points (temp_norm, smoothed traverse readings)
     · satellite basemap
   the raster and the points share one colour scale (manifest.json's
   `range` + `ramp`), so a dot and a raster pixel always mean the same °C.
   ============================================================ */

// Same ramp as meteotracker's AOI_TEMP_CMAP / config.temp_cmap()
// (_AOI_TEMP_CMAP_COLORS / _AOI_TEMP_CMAP_STOPS): deep blue (cool) through
// pale yellow to deep red (hot) — matches export_web_heatmap.py's RAMP,
// which is what predicted.png is actually colourized with.
const HM_RAMP = [
  { t: 0.00, hex: '#313695' },
  { t: 0.22, hex: '#74add1' },
  { t: 0.48, hex: '#ffffbf' },
  { t: 0.68, hex: '#fdae61' },
  { t: 0.85, hex: '#d73027' },
  { t: 1.00, hex: '#a50026' },
];

const HM_OSM_STYLE = {
  version: 8,
  sources: {
    sat: {
      type: 'raster', tileSize: 256,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b0f15' } },
    { id: 'sat', type: 'raster', source: 'sat',
      paint: { 'raster-opacity': 0.85, 'raster-brightness-max': 0.75 } },
  ],
};

async function hmLoadJSON(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error('failed to load ' + url);
  return res.json();
}
function hmDemoError(el){
  el.innerHTML = `<p class="svc-demo-loading">Demo data needs a local server —
    run <code>python -m http.server</code> in the repo root and open it over
    <code>http://localhost:8000</code> (opening the file directly won't fetch the JSON).</p>`;
}
function hmField(label, id, options, sel){
  return `<div class="svc-field">
    <label for="${id}">${label}</label>
    <select id="${id}">${options.map(o =>
      `<option value="${o.v}"${o.v === sel ? ' selected' : ''}>${o.t}</option>`).join('')}</select>
  </div>`;
}
function hmRampExpr(range){
  const [lo, hi] = range || [20, 32];
  const stops = [];
  HM_RAMP.forEach(s => stops.push(lo + (hi - lo) * s.t, s.hex));
  return ['interpolate', ['linear'], ['get', 'temp'], ...stops];
}
function hmRampGradientCss(){
  return HM_RAMP.map(s => `${s.hex} ${(s.t * 100).toFixed(0)}%`).join(', ');
}
function hmCornersFor(b){ return [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]]; }

async function initHeatmappingDemo(el){
  let idx;
  try { idx = await hmLoadJSON('demo/heatmapping/index.json'); }
  catch (e) { return hmDemoError(el); }

  const campaignOpts = idx.cities.map(c => ({ v: c.id, t: c.label }));

  el.innerHTML = `
    <div class="sw-city-select">
      ${hmField('Campaign', 'hmCampaign', campaignOpts, idx.cities[0].id)}
    </div>
    <div class="sw-stage">
      <div class="sw-map" data-hmmap></div>
      <div class="sw-overlay-stack">
        <div class="hm-layers">
          <span class="hm-layers-title">Layers</span>
          <label class="hm-layer-toggle">
            <input type="checkbox" data-hmpredtoggle checked />
            <span class="hm-swatch hm-swatch--raster"></span>
            Predicted temperature
          </label>
          <label class="hm-layer-toggle">
            <input type="checkbox" data-hmpointtoggle checked />
            <span class="hm-swatch hm-swatch--points"></span>
            Recorded points (smoothed)
          </label>
          <label class="hm-layer-toggle">
            <input type="checkbox" data-hmbasemaptoggle checked />
            <span class="hm-swatch hm-swatch--basemap"></span>
            Satellite basemap
          </label>
        </div>
        <div class="sw-legend" data-hmlegend hidden>
          <span class="lbl" data-hmlegendlabel>Air temperature (°C)</span>
          <div class="bar" data-hmlegendbar></div>
          <div class="ticks"><span data-hmlegendlo>—</span><span data-hmlegendhi>—</span></div>
        </div>
        <div class="sw-stats" data-hmstats hidden>
          <span class="lbl">Recorded points</span>
          <span data-hmcount>—</span>
          <span class="lbl" style="margin-top:0.5em">Traverse time</span>
          <span data-hmtime>—</span>
        </div>
      </div>
    </div>`;

  const $campaign = el.querySelector('#hmCampaign');
  const $mapEl = el.querySelector('[data-hmmap]');
  const $predToggle = el.querySelector('[data-hmpredtoggle]');
  const $pointToggle = el.querySelector('[data-hmpointtoggle]');
  const $basemapToggle = el.querySelector('[data-hmbasemaptoggle]');
  const $legend = el.querySelector('[data-hmlegend]');
  const $legendLabel = el.querySelector('[data-hmlegendlabel]');
  const $legendBar = el.querySelector('[data-hmlegendbar]');
  const $legendLo = el.querySelector('[data-hmlegendlo]');
  const $legendHi = el.querySelector('[data-hmlegendhi]');
  const $stats = el.querySelector('[data-hmstats]');
  const $count = el.querySelector('[data-hmcount]');
  const $time = el.querySelector('[data-hmtime]');

  let map = null, manifest = null;
  let predVisible = true, pointsVisible = true, basemapVisible = true;

  function base(){ return `demo/heatmapping/${$campaign.value}/`; }

  function renderLegend(){
    const [lo, hi] = manifest.range || [20, 32];
    $legendBar.style.background = `linear-gradient(to right, ${hmRampGradientCss()})`;
    $legendLo.textContent = lo.toFixed(0) + ' °C';
    $legendHi.textContent = hi.toFixed(0) + ' °C';
    $legendLabel.textContent = `Air temperature · ${manifest.label}`;
    $legend.hidden = false;
    $stats.hidden = false;
    $count.textContent = `${manifest.nPoints} · ${manifest.range[0].toFixed(0)}–${manifest.range[1].toFixed(0)} °C`;
    $time.textContent = manifest.localTimeRange
      ? `${manifest.localTimeRange} local time` : '—';
  }

  function addCoordsToBounds(c, b){
    if (typeof c[0] === 'number') b.extend(c);
    else c.forEach(x => addCoordsToBounds(x, b));
  }

  async function loadCampaign(){
    manifest = await hmLoadJSON(base() + 'manifest.json');
    const [aoiGeo, pointsGeo] = await Promise.all([
      hmLoadJSON(base() + manifest.aoi),
      hmLoadJSON(base() + manifest.points),
    ]);

    if (map) { try { map.remove(); } catch (e) {} map = null; }
    const m = new maplibregl.Map({
      container: $mapEl,
      style: JSON.parse(JSON.stringify(HM_OSM_STYLE)),
      center: manifest.center, zoom: 13,
      attributionControl: { compact: true }, dragRotate: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
    map = m;

    m.on('load', () => {
      m.setLayoutProperty('sat', 'visibility', basemapVisible ? 'visible' : 'none');

      const coords = hmCornersFor(manifest.predictedBounds);
      m.addSource('hm-predicted', { type: 'image', url: base() + manifest.predicted, coordinates: coords });
      m.addLayer({ id: 'hm-predicted', type: 'raster', source: 'hm-predicted',
        paint: { 'raster-opacity': 0.88, 'raster-resampling': 'nearest' } });
      m.setLayoutProperty('hm-predicted', 'visibility', predVisible ? 'visible' : 'none');

      m.addSource('hm-points', { type: 'geojson', data: pointsGeo });
      m.addLayer({ id: 'hm-points', type: 'circle', source: 'hm-points',
        paint: {
          'circle-radius': 2.6,
          'circle-color': hmRampExpr(manifest.range),
          'circle-opacity': 0.9,
        } });
      m.setLayoutProperty('hm-points', 'visibility', pointsVisible ? 'visible' : 'none');

      const pop = new maplibregl.Popup({ closeButton: false, closeOnMove: true, className: 'sw-pop' });
      m.on('mousemove', 'hm-points', (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        pop.setLngLat(e.lngLat)
          .setHTML(`<b>${(+f.properties.temp).toFixed(1)} °C</b> · recorded`)
          .addTo(m);
      });
      m.on('mouseleave', 'hm-points', () => pop.remove());
      m.on('mouseenter', 'hm-points', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'hm-points', () => (m.getCanvas().style.cursor = ''));

      const b = new maplibregl.LngLatBounds();
      (aoiGeo.features || []).forEach(ft => addCoordsToBounds(ft.geometry.coordinates, b));
      if (!b.isEmpty()) m.fitBounds(b, { padding: 30, duration: 0 });

      renderLegend();
    });
  }

  $campaign.addEventListener('change', loadCampaign);
  $predToggle.addEventListener('change', () => {
    predVisible = $predToggle.checked;
    try { map && map.setLayoutProperty('hm-predicted', 'visibility', predVisible ? 'visible' : 'none'); } catch (e) {}
  });
  $pointToggle.addEventListener('change', () => {
    pointsVisible = $pointToggle.checked;
    try { map && map.setLayoutProperty('hm-points', 'visibility', pointsVisible ? 'visible' : 'none'); } catch (e) {}
  });
  $basemapToggle.addEventListener('change', () => {
    basemapVisible = $basemapToggle.checked;
    try { map && map.setLayoutProperty('sat', 'visibility', basemapVisible ? 'visible' : 'none'); } catch (e) {}
  });

  await loadCampaign();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('heatmappingDemo');
  if (el) initHeatmappingDemo(el);
});
