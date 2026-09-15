/* ============================================================
   B-Kode — High-Resolution Land Cover demo.
   Standalone (no build step, no map library): fetches
   demo/landcover/meta.json and swaps a static 2 m classification
   raster <img> by neighbourhood, with a class-colour legend.
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

async function initLandcoverDemo(el){
  let meta;
  try { meta = await loadJSON('demo/landcover/meta.json'); }
  catch (e) { return demoError(el); }

  const hoodOpts = meta.neighbourhoods.map(h => ({ v: h.id, t: h.label }));

  el.innerHTML = `
    <div class="svc-demo-controls">
      ${field('Neighbourhood', 'lcHood', hoodOpts, meta.neighbourhoods[0].id)}
    </div>
    <div class="lc-figure">
      <img data-img alt="" />
      <div class="lc-legend">
        ${meta.classes.map(c =>
          `<span class="swatch"><span class="dot" style="background:${c.color}"></span>${c.label}</span>`).join('')}
      </div>
    </div>`;

  const $hood = el.querySelector('#lcHood');
  const $img  = el.querySelector('[data-img]');

  function render(){
    const h = meta.neighbourhoods.find(x => x.id === $hood.value) || meta.neighbourhoods[0];
    $img.src = `demo/landcover/${h.file}`;
    $img.alt = `2 m land-cover classification — ${h.label} (${h.resolution_m} m resolution)`;
  }

  $hood.addEventListener('change', render);
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('landcoverDemo');
  if (el) initLandcoverDemo(el);
});
