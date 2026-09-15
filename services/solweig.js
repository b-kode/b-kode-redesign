/* ============================================================
   B-Kode — SOLWEIG 2m Thermal Comfort demo.
   Standalone (no build step, no map library): fetches
   demo/solweig/index.json and swaps a static UTCI raster <img> by
   city / neighbourhood / climate slice (present, 2050, 2090).
   Ported from mockups/b-kode-services/services.js (map version).
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

async function initSolweigDemo(el){
  let idx;
  try { idx = await loadJSON('demo/solweig/index.json'); }
  catch (e) { return demoError(el); }

  const cityOpts = idx.cities.map(c => ({ v: c.id, t: c.label }));
  const firstCity = idx.cities[0];

  el.innerHTML = `
    <div class="svc-demo-controls">
      ${field('City', 'swCity', cityOpts, firstCity.id)}
      ${field('Neighbourhood', 'swHood',
        firstCity.neighbourhoods.map(n => ({ v: n.id, t: n.label })),
        firstCity.neighbourhoods[0].id)}
    </div>
    <div class="solweig-seg" data-seg>
      <button data-s="present" class="is-active">Present</button>
      <button data-s="2050">2050</button>
      <button data-s="2090">2090</button>
    </div>
    <p class="solweig-blurb" data-blurb></p>
    <div class="solweig-figure">
      <img data-img alt="" />
      <div class="solweig-stats">
        <div class="stat"><span class="lbl">Climate slice</span><span class="val" data-slice-val>—</span></div>
        <div class="stat"><span class="lbl">UTCI range</span><span class="val warm" data-range>—</span></div>
      </div>
    </div>`;

  const $city  = el.querySelector('#swCity');
  const $hood  = el.querySelector('#swHood');
  const $blurb = el.querySelector('[data-blurb]');
  const $img   = el.querySelector('[data-img]');
  const $sliceVal = el.querySelector('[data-slice-val]');
  const $range = el.querySelector('[data-range]');
  const $segBtns = [...el.querySelectorAll('[data-seg] button')];

  let slice = 'present';
  let curHood = null;

  function refreshHoods(){
    const c = idx.cities.find(c => c.id === $city.value);
    $hood.innerHTML = c.neighbourhoods.map(n =>
      `<option value="${n.id}">${n.label}</option>`).join('');
  }
  function curSlice(){
    return curHood.slices.find(s => s.id === slice) || curHood.slices[0];
  }
  function render(){
    const c = idx.cities.find(c => c.id === $city.value);
    curHood = c.neighbourhoods.find(n => n.id === $hood.value) || c.neighbourhoods[0];
    if (curHood.blurb) $blurb.textContent = curHood.blurb;
    const sc = curSlice();
    $img.src = `demo/solweig/${c.id}/${curHood.id}/${sc.file}`;
    $img.alt = `${curHood.label} — ${sc.epoch}`;
    $sliceVal.textContent = sc.epoch;
    $range.textContent = sc.range ? `${sc.range[0].toFixed(1)}–${sc.range[1].toFixed(1)} °C` : '—';
    $segBtns.forEach(b => b.classList.toggle('is-active', b.dataset.s === slice));
  }

  $city.addEventListener('change', () => { refreshHoods(); render(); });
  $hood.addEventListener('change', render);
  $segBtns.forEach(b => b.addEventListener('click', () => { slice = b.dataset.s; render(); }));

  render();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('solweigDemo');
  if (el) initSolweigDemo(el);
});
