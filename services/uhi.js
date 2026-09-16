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
      <!-- Everything stacks top-left only — MapLibre's own controls
           own the other 3 corners (zoom top-right, scale
           bottom-left, attribution bottom-right) on this map. -->
      <div class="uhi-overlay-stack">
        <div class="uhi-time" data-time>&mdash;</div>
        <div class="uhi-stats">
          <div class="stat"><span class="lbl">City mean temperature</span><span class="val" data-citymean>&mdash;</span></div>
        </div>
        <div class="uhi-legend" data-legend>
          <span class="lbl" data-legendlabel>&mdash;</span>
          <div class="bar" data-legendbar></div>
          <div class="ticks"><span data-legendlo>&mdash;</span><span data-legendhi>&mdash;</span></div>
        </div>
        <div class="uhi-layers">
          <label><input type="checkbox" data-layer="buildings" checked /> Buildings</label>
          <label><input type="checkbox" data-layer="trees" checked /> Tree canopy</label>
          <label><input type="checkbox" data-layer="aoi" checked /> Modelled area</label>
        </div>
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

  /* Exact ramps from pipeline/build_forecast.py (RAMP / REDS), also
     mirrored in frontend/js/app.js — these are what the frame PNGs
     are actually coloured with. The earlier version of this legend
     used made-up placeholder colours that didn't match the pixels
     at all. "Absolute" is turbo (remapped) + a purple hot tail;
     "Heat contrast" is a blue->yellow->red diverging ramp. */
  const ABS_RAMP = [
    [0.00, [48, 18, 59]],   [0.05, [69, 76, 183]],   [0.10, [62, 136, 226]],
    [0.15, [51, 188, 217]], [0.20, [45, 217, 188]],  [0.25, [48, 237, 151]],
    [0.30, [87, 249, 108]], [0.35, [132, 253, 74]],  [0.40, [174, 248, 53]],
    [0.45, [207, 237, 45]], [0.50, [231, 220, 50]],  [0.55, [245, 198, 49]],
    [0.60, [253, 173, 44]], [0.65, [253, 145, 36]],  [0.70, [247, 115, 28]],
    [0.75, [236, 85, 20]],  [0.80, [217, 59, 13]],   [0.85, [177, 36, 6]],
    [0.90, [137, 20, 12]],  [0.95, [106, 17, 38]],   [1.00, [74, 13, 63]],
  ];
  const UHI_RAMP = [
    [0.000, [49, 54, 149]],   [0.125, [69, 117, 180]],  [0.250, [116, 173, 209]],
    [0.375, [171, 217, 233]], [0.500, [255, 255, 191]],  [0.625, [254, 224, 144]],
    [0.750, [253, 174, 97]],  [0.875, [244, 109, 67]],   [1.000, [215, 48, 39]],
  ];
  const rampCSS = stops => stops.map(([t, c]) =>
    `rgb(${c.join(',')}) ${(t * 100).toFixed(0)}%`).join(', ');

  function frameFile(i){
    const pattern = meta.layers[mode].file; // e.g. "frame_{k:03d}.png"
    const k = String(i).padStart(3, '0');
    return pattern.replace('{k:03d}', k);
  }

  // uhi.urban_mean_c/rural_mean_c/uhi_c are indexed over the FULL run
  // (meta.n_hours, e.g. 361h), not just the n_frames (72) shown as
  // map frames — meta.frame_start_index is where the shown window
  // starts inside that longer array. Indexing urban_mean_c directly
  // by the slider/frame position (0..71) silently read the wrong
  // hour's mean (off by frame_start_index), which is why it could
  // show a city-mean temperature outside the map's own colour range
  // for that hour — they were never talking about the same hour.
  const frameStart = meta.frame_start_index || 0;

  function renderStats(i){
    const fr = frames[i];
    $time.textContent = `${fr.local} local · day ${fr.day}`;
    const u = meta.uhi;
    const j = frameStart + i;
    if (u && u.urban_mean_c && u.urban_mean_c[j] != null) {
      $cityMean.textContent = u.urban_mean_c[j].toFixed(1) + ' °C';
    }
  }

  function renderLegend(i){
    if (mode === 'absolute') {
      const [lo, hi] = meta.layers.absolute.domain_c || meta.value_domain_c || [10, 20];
      $legendBar.style.background = `linear-gradient(to right, ${rampCSS(ABS_RAMP)})`;
      $legendLo.textContent = lo.toFixed(0) + ' °C';
      $legendHi.textContent = hi.toFixed(0) + ' °C';
      $legendLabel.textContent = 'Absolute air temperature';
    } else {
      const perFrame = meta.layers.uhi.per_frame_domain_c;
      const [lo, hi] = (perFrame && perFrame[i]) || [10, 12];
      $legendBar.style.background = `linear-gradient(to right, ${rampCSS(UHI_RAMP)})`;
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
