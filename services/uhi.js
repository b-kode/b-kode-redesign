/* ============================================================
   B-Kode — Live & Predictive UHI Dashboard demo.
   Real MapLibre map, ported from the dashboard's own forecast view
   (frontend/js/app.js buildMap): a real OSM basemap with the hourly
   forecast raster draped on top, building/tree context layers, an
   AOI outline, and a scrub slider with play/pause. Absolute vs UHI-
   contrast layers toggle by swapping the overlay image.
   ============================================================ */

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

const OSM_STYLE_LIGHT = {
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
    { id: 'bg', type: 'background', paint: { 'background-color': '#eef1f4' } },
    { id: 'osm', type: 'raster', source: 'osm',
      paint: { 'raster-opacity': 0.9, 'raster-saturation': -0.55,
               'raster-contrast': -0.15, 'raster-brightness-min': 0.15 } },
  ],
};

async function initUhiDemo(el){
  let meta;
  const base = 'demo/forecast/dublin/';
  try { meta = await loadJSON(base + 'meta.json'); }
  catch (e) { return demoError(el); }

  const [w, s, e, n] = meta.overlay_bounds_wgs84;
  const box = [[w, n], [e, n], [e, s], [w, s]];
  const frames = meta.frames;
  const ctx = meta.context || {};

  el.innerHTML = `
    <div class="uhi-toolbar">
      <div class="uhi-seg" data-mode>
        <button data-m="absolute">Absolute &deg;C</button>
        <button data-m="uhi" class="is-active">Heat contrast</button>
      </div>
    </div>
    <div class="uhi-stage">
      <div class="uhi-map" data-map></div>
      <div class="uhi-layers">
        <label><input type="checkbox" data-layer="buildings" checked /> Buildings</label>
        <label><input type="checkbox" data-layer="trees" checked /> Tree canopy</label>
        <label><input type="checkbox" data-layer="aoi" checked /> Modelled area</label>
      </div>
      <div class="uhi-time" data-time>&mdash;</div>
      <div class="uhi-stats">
        <div class="stat"><span class="lbl">City mean temperature</span><span class="val" data-citymean>&mdash;</span></div>
      </div>
      <div class="uhi-legend" data-legend>
        <span class="lbl" data-legendlabel>&mdash;</span>
        <div class="bar" data-legendbar></div>
        <div class="ticks"><span data-legendlo>&mdash;</span><span data-legendhi>&mdash;</span></div>
      </div>
    </div>
    <div class="uhi-scrub">
      <button type="button" data-play aria-label="Play / pause">&#9654;</button>
      <input type="range" data-slider min="0" max="${frames.length - 1}" value="0" step="1" />
    </div>`;

  const $modeBtns = [...el.querySelectorAll('[data-mode] button')];
  const $mapEl = el.querySelector('[data-map]');
  const $time = el.querySelector('[data-time]');
  const $cityMean = el.querySelector('[data-citymean]');
  const $slider = el.querySelector('[data-slider]');
  const $play = el.querySelector('[data-play]');
  const $layerToggles = [...el.querySelectorAll('[data-layer]')];
  const $legendLabel = el.querySelector('[data-legendlabel]');
  const $legendBar = el.querySelector('[data-legendbar]');
  const $legendLo = el.querySelector('[data-legendlo]');
  const $legendHi = el.querySelector('[data-legendhi]');

  let mode = 'uhi', playTimer = null, map = null;

  const ABS_RAMP = ['#313695', '#4575b4', '#74add1', '#abd9e9', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'];
  const UHI_RAMP = ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#99000d'];

  function frameFile(i){
    const pattern = meta.layers[mode].file; // e.g. "frame_{k:03d}.png"
    const k = String(i).padStart(3, '0');
    return pattern.replace('{k:03d}', k);
  }

  function renderStats(i){
    const fr = frames[i];
    $time.textContent = `${fr.local} local · day ${fr.day}`;
    const u = meta.uhi;
    if (u && u.urban_mean_c && u.urban_mean_c[i] != null) {
      $cityMean.textContent = u.urban_mean_c[i].toFixed(1) + ' °C';
    }
  }

  function renderLegend(i){
    if (mode === 'absolute') {
      const [lo, hi] = meta.layers.absolute.domain_c || meta.value_domain_c || [10, 20];
      const grad = ABS_RAMP.map((c, k) => `${c} ${((k / (ABS_RAMP.length - 1)) * 100).toFixed(0)}%`).join(', ');
      $legendBar.style.background = `linear-gradient(to right, ${grad})`;
      $legendLo.textContent = lo.toFixed(0) + ' °C';
      $legendHi.textContent = hi.toFixed(0) + ' °C';
      $legendLabel.textContent = 'Absolute air temperature';
    } else {
      const perFrame = meta.layers.uhi.per_frame_domain_c;
      const [lo, hi] = (perFrame && perFrame[i]) || [10, 12];
      const grad = UHI_RAMP.map((c, k) => `${c} ${((k / (UHI_RAMP.length - 1)) * 100).toFixed(0)}%`).join(', ');
      $legendBar.style.background = `linear-gradient(to right, ${grad})`;
      $legendLo.textContent = lo.toFixed(1) + ' °C';
      $legendHi.textContent = hi.toFixed(1) + ' °C';
      $legendLabel.textContent = 'Heat contrast (coolest → warmest pixel, this hour)';
    }
  }

  function updateOverlay(){
    if (!map || !map.isStyleLoaded()) return;
    const i = +$slider.value;
    const url = base + frameFile(i);
    const src = map.getSource('forecast');
    if (src) src.updateImage({ url, coordinates: box });
    renderStats(i);
    renderLegend(i);
  }

  function stopPlay(){
    if (playTimer) { clearInterval(playTimer); playTimer = null; $play.innerHTML = '&#9654;'; }
  }
  function togglePlay(){
    if (playTimer) { stopPlay(); return; }
    $play.innerHTML = '&#10074;&#10074;';
    playTimer = setInterval(() => {
      let n = +$slider.value + 1;
      if (n > +$slider.max) n = 0;
      $slider.value = n;
      updateOverlay();
    }, 220);
  }

  function buildMap(){
    map = new maplibregl.Map({
      container: $mapEl,
      style: JSON.parse(JSON.stringify(OSM_STYLE_LIGHT)),
      bounds: [[w, s], [e, n]], fitBoundsOptions: { padding: 30 },
      attributionControl: { compact: true }, dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.addSource('forecast', { type: 'image', url: base + frameFile(0), coordinates: box });
      map.addLayer({ id: 'forecast', type: 'raster', source: 'forecast',
        paint: { 'raster-opacity': 0.85, 'raster-resampling': 'linear' } });

      for (const key of ['trees', 'buildings']) {
        if (!ctx[key]) continue;
        const id = 'ctx-' + key;
        map.addSource(id, { type: 'image', url: base + ctx[key].file, coordinates: box });
        map.addLayer({ id, type: 'raster', source: id,
          paint: { 'raster-opacity': key === 'trees' ? 0.7 : 0.9, 'raster-resampling': 'nearest' } });
      }

      loadJSON(base + 'aoi.geojson').then(aoi => {
        map.addSource('aoi', { type: 'geojson', data: aoi });
        map.addLayer({ id: 'aoi-halo', type: 'line', source: 'aoi',
          paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.6 } });
        map.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi',
          paint: { 'line-color': '#000000', 'line-width': 3 } });
      }).catch(() => {});

      renderStats(0);
      renderLegend(0);
    });
  }

  $modeBtns.forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m;
    $modeBtns.forEach(x => x.classList.toggle('is-active', x === b));
    updateOverlay();
  }));
  $slider.addEventListener('input', () => { stopPlay(); updateOverlay(); });
  $play.addEventListener('click', togglePlay);
  $layerToggles.forEach(cb => cb.addEventListener('change', () => {
    if (!map) return;
    const key = cb.dataset.layer;
    const id = key === 'aoi' ? null : 'ctx-' + key;
    try {
      if (key === 'aoi') {
        ['aoi-halo', 'aoi-line'].forEach(l =>
          map.getLayer(l) && map.setLayoutProperty(l, 'visibility', cb.checked ? 'visible' : 'none'));
      } else if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', cb.checked ? 'visible' : 'none');
      }
    } catch (err) {}
  }));

  buildMap();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('uhiDemo');
  if (el) initUhiDemo(el);
});
