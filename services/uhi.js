/* ============================================================
   B-Kode — Live & Predictive UHI Dashboard demo.
   Standalone (no build step, no map library): fetches
   demo/forecast/index.json + demo/forecast/<city>/forecast.json,
   scrubs through 12 six-hourly frames as a plain <img> swap
   (frame_NNN.png / frame_uhi_NNN.png), same dark-basemap + glass-
   overlay treatment as the SOLWEIG demo.
   ============================================================ */

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

async function initUhiDemo(el){
  let idx;
  try { idx = await loadJSON('demo/forecast/index.json'); }
  catch (e) { return demoError(el); }

  const cityOpts = idx.cities.map(c => ({ v: c.id, t: c.label }));

  el.innerHTML = `
    <div class="uhi-toolbar">
      ${field('City', 'uhiCity', cityOpts, idx.cities[0].id)}
      <div class="uhi-seg" data-mode>
        <button data-m="absolute" class="is-active">Absolute &deg;C</button>
        <button data-m="uhi">Heat contrast</button>
      </div>
    </div>
    <div class="uhi-figure">
      <img data-img alt="" />
      <div class="uhi-time" data-time>&mdash;</div>
      <div class="uhi-stats">
        <div class="stat"><span class="lbl">Urban mean</span><span class="val" data-urban>&mdash;</span></div>
        <div class="stat"><span class="lbl">Rural mean</span><span class="val" data-rural>&mdash;</span></div>
        <div class="stat"><span class="lbl">UHI</span><span class="val warm" data-uhi>&mdash;</span></div>
      </div>
    </div>
    <div class="uhi-scrub">
      <button type="button" data-play aria-label="Play / pause">&#9654;</button>
      <input type="range" data-slider min="0" max="11" value="0" step="1" />
    </div>`;

  const $city  = el.querySelector('#uhiCity');
  const $modeBtns = [...el.querySelectorAll('[data-mode] button')];
  const $img   = el.querySelector('[data-img]');
  const $time  = el.querySelector('[data-time]');
  const $urban = el.querySelector('[data-urban]');
  const $rural = el.querySelector('[data-rural]');
  const $uhi   = el.querySelector('[data-uhi]');
  const $slider = el.querySelector('[data-slider]');
  const $play  = el.querySelector('[data-play]');

  let fc = null, mode = 'absolute', playTimer = null;

  async function loadCity(){
    fc = await loadJSON(`demo/forecast/${$city.value}/forecast.json`);
    $slider.max = fc.frames.length - 1;
    $slider.value = 0;
    render();
  }

  function render(){
    const i = +$slider.value;
    const frame = fc.frames[i];
    const idxNum = fc.frame_idx[i];
    const padded = String(idxNum).padStart(3, '0');
    const file = mode === 'uhi' ? `frame_uhi_${padded}.png` : `frame_${padded}.png`;
    $img.src = `demo/forecast/${$city.value}/${file}`;
    $img.alt = `${fc.label} forecast, ${frame.local}`;
    $time.textContent = `${frame.local} local · day ${frame.day}`;
    $urban.textContent = fc.urban_mean_c[i].toFixed(1) + ' °C';
    $rural.textContent = fc.rural_mean_c[i].toFixed(1) + ' °C';
    $uhi.textContent = (fc.uhi_c[i] >= 0 ? '+' : '') + fc.uhi_c[i].toFixed(2) + ' °C';
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
      render();
    }, 900);
  }

  $city.addEventListener('change', () => { stopPlay(); loadCity(); });
  $modeBtns.forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m;
    $modeBtns.forEach(x => x.classList.toggle('is-active', x === b));
    render();
  }));
  $slider.addEventListener('input', () => { stopPlay(); render(); });
  $play.addEventListener('click', togglePlay);

  await loadCity();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('uhiDemo');
  if (el) initUhiDemo(el);
});
