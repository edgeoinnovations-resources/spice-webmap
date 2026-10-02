(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
const MONTH = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const KIND = { standing: 'Still standing, trade gone', moved: 'Moved away', alive: 'Still alive, changed', medicine: 'Medicine and secrets' };
const CERT = { located: 'Located', approximate: 'Approximate', symbolic: 'Symbolic', uncertain: 'Uncertain' };
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let D, map, mapReady = false, current = -1, mode = 'story', month = 8, playing = null;
const visible = new Set();
const placeMarkers = {}, fuzzyMarkers = [];

Promise.all(['data/spice.json', 'data/land.json', 'data/borders.json'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })))
  .then(([data, land, borders]) => { D = data; D.evById = Object.fromEntries(D.evidence.map(e => [e.id, e])); buildUI(); buildMap(land, borders); })
  .catch(err => { $('#panel').innerHTML = '<div class="section"><h2>Map data did not load</h2><p>Reload the page. If it keeps happening, the data files are missing from the site.</p></div>'; console.error(err); });

/* ---------------- UI ---------------- */
function buildUI() {
  $$('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.addEventListener('keydown', e => {
    if (mode !== 'story' || e.target.closest('input, dialog[open]')) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); go(current + 1); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(current - 1); }
  });
  const m = $('#month');
  m.addEventListener('input', () => { stopPlay(); setMonth(+m.value); });
  $('#play').addEventListener('click', () => playing ? stopPlay() : startPlay());
  setMode((location.hash || '').replace('#', '') in { story: 1, explore: 1, evidence: 1 } ? location.hash.slice(1) : 'story', true);
}

function setMode(m, initial) {
  mode = m;
  $$('.modes button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === m));
  const p = $('#panel'); p.innerHTML = ''; p.scrollTop = 0;
  if (m === 'story') renderStory(p);
  if (m === 'explore') renderExplore(p);
  if (m === 'evidence') renderEvidence(p);
  if (!initial && map) { if (m !== 'story') { $('#mapnote').hidden = true; } }
}

function eraVar(era) { return `var(--era-${era})`; }

function renderStory(p) {
  let lastCase = null;
  D.steps.forEach((s, i) => {
    const c = D.cases.find(c => c.id === s.case);
    if (s.case !== lastCase) {
      lastCase = s.case;
      p.append(h('header', { class: 'case-head', style: `--era:${eraVar(c.era)}` },
        h('div', { class: 'label' }, c.label), h('h2', {}, c.title), c.question ? h('p', { class: 'question' }, c.question) : null));
    }
    const card = h('article', { class: 'step', id: 'step-' + s.id, 'data-i': i, style: `--era:${eraVar(c.era)}`, tabindex: '-1', 'aria-labelledby': 'h-' + s.id },
      h('h3', { id: 'h-' + s.id }, s.title), ...s.body.map(t => h('p', {}, t)));
    const tags = [];
    if (s.certainty) tags.push(h('span', { class: 'chip cert-' + s.certainty }, h('span', { class: 'dot' }), 'Certainty: ' + CERT[s.certainty]));
    if (s.monsoon) tags.push(h('span', { class: 'chip' }, 'Month dial on the map'));
    if (tags.length) card.append(h('div', { class: 'tags' }, tags));
    if (s.evidence) card.append(h('div', { class: 'thumbs' }, s.evidence.map(id => { const e = D.evById[id]; return h('button', { class: 'thumb', onclick: () => openEvidence(id), 'aria-label': 'Open evidence: ' + e.title }, h('img', { src: `img/thumb/${e.img}.jpg`, alt: '', loading: 'lazy' })); })));
    p.append(card);
  });
  p.append(h('div', { class: 'story-end' }, 'Draft built from the authors’ March 2026 proposal and travel photographs. Text will change as the book is written.'));
  p.append(h('nav', { class: 'stepnav', 'aria-label': 'Story steps' },
    h('button', { class: 'btn', onclick: () => go(current - 1), 'aria-label': 'Previous step' }, '↑ Back'),
    h('span', { id: 'stepcount', 'aria-live': 'polite' }, ''),
    h('button', { class: 'btn primary', onclick: () => go(current + 1), 'aria-label': 'Next step' }, 'Next ↓')));
  const narrow = matchMedia('(max-width: 860px)').matches;
  const io = new IntersectionObserver(entries => {
    entries.filter(e => e.isIntersecting).forEach(e => activate(+e.target.dataset.i));
  }, { root: null, rootMargin: narrow ? '-62% 0px -30% 0px' : '-35% 0px -55% 0px' });
  $$('.step', p).forEach(el => io.observe(el));
  current = -1;
  activate(0);
}

function go(i) {
  i = Math.max(0, Math.min(D.steps.length - 1, i));
  const el = $('#step-' + D.steps[i].id);
  if (!el) return;
  el.scrollIntoView({ block: matchMedia('(max-width: 860px)').matches ? 'start' : 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  activate(i);
  el.focus({ preventScroll: true });
}

function activate(i) {
  if (i === current || !D.steps[i]) return;
  current = i;
  const s = D.steps[i];
  $$('.step').forEach(el => el.classList.toggle('active', +el.dataset.i === i));
  const sc = $('#stepcount'); if (sc) sc.textContent = `${i + 1} of ${D.steps.length}`;
  if (!mapReady) { pendingStep = s; return; }
  applyStep(s);
}
let pendingStep = null;

function applyStep(s) {
  const c = D.cases.find(c => c.id === s.case);
  setLayers(new Set(s.layers || []));
  setEvidencePoints(s.evidence || []);
  showDial(!!s.monsoon);
  Object.entries(placeMarkers).forEach(([id, m]) => m.getElement().firstChild.classList.toggle('hl', (s.highlight || []).includes(id)));
  const note = $('#mapnote');
  if (s.layers && s.layers.length) {
    const L = D.layers[s.layers[0]];
    note.hidden = false; note.style.setProperty('--era', eraVar(L.era));
    note.innerHTML = ''; note.append(h('b', {}, L.title), L.legend || '');
  } else note.hidden = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  map[reduce ? 'jumpTo' : 'flyTo']({ center: s.camera.center, zoom: s.camera.zoom - (innerWidth < 860 ? 0.6 : 0), speed: 0.9, curve: 1.4, essential: true });
}

function renderExplore(p) {
  const sec = h('div', { class: 'section' }, h('h2', {}, 'Explore the layers'), h('p', {}, 'Turn layers on and off, then use the month dial to see how the monsoon set the rhythm of the trade.'));
  D.cases.filter(c => c.id !== 'intro').forEach(c => {
    const ids = Object.keys(D.layers).filter(k => D.layers[k].case === c.id && D.layers[k].legend !== '');
    if (!ids.length) return;
    sec.append(h('div', { class: 'layer-group', style: `--era:${eraVar(c.era)}` }, `${c.label} · ${c.title}`));
    ids.forEach(id => {
      const L = D.layers[id];
      const box = h('input', { type: 'checkbox', id: 'lyr-' + id, checked: visible.has(id) });
      box.addEventListener('change', () => { const set = new Set(visible); box.checked ? set.add(id) : set.delete(id); if (id === 'hubs' && box.checked) set.add('hub-points'); if (id === 'hubs' && !box.checked) set.delete('hub-points'); setLayers(set); });
      sec.append(h('label', { class: 'layer-row', for: 'lyr-' + id, style: `--era:${eraVar(L.era)}` }, box,
        h('span', { class: 'swatch ' + (L.kind === 'fuzzy' ? 'fuzzy' : L.kind === 'points' ? 'points' : L.dashed ? 'dashed' : '') }),
        h('span', {}, h('strong', {}, L.title), L.legend ? h('small', {}, L.legend) : null)));
    });
  });
  p.append(sec);
  p.append(h('div', { class: 'section' }, h('h2', {}, 'Pins'), h('div', { class: 'legend-places' },
    h('span', {}, h('span', { class: 'pin', style: 'display:inline-block' }), 'Places the authors have visited'),
    h('span', {}, h('span', { class: 'pin planned', style: 'display:inline-block' }), 'Still searching: places they hope to visit'),
    h('span', {}, h('span', { class: 'pin next', style: 'display:inline-block' }), 'Next stop: Wadi Dawkah, Oman'))));
  showDial(true);
  setEvidencePoints(D.evidence.map(e => e.id));
  if (map) map.flyTo({ center: [60, 15], zoom: innerWidth < 860 ? 1 : 1.7 });
}

let evFilter = 'all';
function renderEvidence(p) {
  const head = h('div', { class: 'section' }, h('h2', {}, 'The evidence locker'), h('p', {}, `${D.evidence.length} photographs from the authors’ travels. Open one to see what it proves, what it can’t, and where it was really taken.`));
  const f = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by kind of evidence' });
  [['all', 'All'], ...Object.entries(KIND)].forEach(([k, label]) => f.append(h('button', { 'aria-pressed': evFilter === k, onclick: () => { evFilter = k; renderEvGrid(); $$('button', f).forEach(b => b.setAttribute('aria-pressed', b.textContent === label)); } }, label)));
  head.append(f); p.append(head);
  const grid = h('div', { class: 'ev-grid', id: 'evgrid' }); p.append(grid);
  renderEvGrid();
  showDial(false); setLayers(new Set());
  setEvidencePoints(D.evidence.map(e => e.id));
  $('#mapnote').hidden = true;
  if (map) map.flyTo({ center: [30, 35], zoom: innerWidth < 860 ? 0.9 : 1.6 });
}
function renderEvGrid() {
  const g = $('#evgrid'); if (!g) return; g.innerHTML = '';
  D.evidence.filter(e => evFilter === 'all' || e.kind === evFilter).forEach(e => g.append(
    h('button', { class: 'ev-card', onclick: () => openEvidence(e.id) }, h('img', { src: `img/thumb/${e.img}.jpg`, alt: '', loading: 'lazy' }),
      h('span', {}, h('b', {}, e.title), h('small', {}, KIND[e.kind])))));
}

/* ---------------- Evidence dialog ---------------- */
function openEvidence(id) {
  const e = D.evById[id]; const dlg = $('#evdialog'); dlg.innerHTML = '';
  const img = h('img', { src: `img/full/${e.img}.jpg`, alt: `${e.title}. ${e.now}` });
  const fig = h('figure', { class: 'ev-fig' }, img, h('figcaption', {}, D.credit));
  if (e.flip) {
    const fb = h('button', { class: 'btn flip', 'aria-pressed': 'false' }, 'Turn north up');
    fb.addEventListener('click', () => { const on = img.classList.toggle('flipped'); fb.setAttribute('aria-pressed', on); fb.textContent = on ? 'Show as it hangs (south up)' : 'Turn north up'; });
    fig.append(fb);
  }
  const meta = h('div', { class: 'meta' },
    h('div', {}, `Taken ${new Date(e.taken + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`),
    h('div', {}, `GPS ${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`));
  if (e.mismatch) {
    meta.prepend(h('div', {}, `File name: ${e.mismatch.filename}`));
    const found = h('div', { class: 'found', hidden: true, 'aria-live': 'polite' }, `Caught it. The file name suggests ${e.mismatch.claimed}. ${e.mismatch.actual}`);
    meta.append(h('button', { class: 'btn reveal', onclick: ev => { found.hidden = false; ev.currentTarget.remove(); } }, 'Does the file name match the GPS?'), found);
  }
  const text = h('div', { class: 'ev-text' },
    h('div', { class: 'tags', style: 'display:flex;gap:6px;flex-wrap:wrap' },
      h('span', { class: 'chip' }, KIND[e.kind]),
      h('span', { class: 'chip cert-' + e.certainty }, h('span', { class: 'dot' }), CERT[e.certainty])),
    h('h2', { id: 'evtitle' }, e.title), h('p', { class: 'site' }, e.site),
    h('div', { class: 'tng' },
      h('div', { class: 'then' }, h('h4', {}, 'Then'), h('p', {}, e.then)),
      h('div', { class: 'now' }, h('h4', {}, 'Now'), h('p', {}, e.now)),
      h('div', { class: 'gone' }, h('h4', {}, 'Gone'), h('p', {}, e.gone))),
    h('h4', { style: 'margin:0 0 4px;font:500 .72rem/1 var(--f-mono);letter-spacing:.1em;text-transform:uppercase' }, e.id === 'fra-mauro' ? 'SCRAP / OPTIC questions' : 'OPTIC questions'),
    h('ul', { class: 'optic' }, e.optic.map(q => h('li', {}, q))),
    meta,
    h('div', { class: 'ev-actions' },
      h('button', { class: 'btn primary', onclick: () => { dlg.close(); showOnMap(e); } }, 'Show on map'),
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close')));
  dlg.append(h('button', { class: 'close', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'), h('div', { class: 'ev-body' }, fig, text));
  dlg.setAttribute('aria-labelledby', 'evtitle');
  dlg.showModal();
}
function showOnMap(e) {
  const same = D.evidence.filter(x => x.place === e.place).map(x => x.id);
  setEvidencePoints(same, e.id);
  const pl = D.places.find(p => p.id === e.place);
  map.flyTo({ center: [pl.lon, pl.lat], zoom: 7.5, speed: 1.2 });
  if (innerWidth < 860) $('.map-wrap').scrollIntoView({ behavior: 'smooth' });
}

/* ---------------- Map ---------------- */
function buildMap(land, borders) {
  map = new maplibregl.Map({
    container: 'map', center: [60, 18], zoom: 1.6, minZoom: 0.6, maxZoom: 17.5, attributionControl: false, dragRotate: false, pitchWithRotate: false,
    style: { version: 8, sources: {}, layers: [{ id: 'sea', type: 'background', paint: { 'background-color': css('--sea') } }] }
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Basemap: Natural Earth · Photos: M. Aronson and M. Budhos' }));
  map.on('load', () => {
    map.addSource('land', { type: 'geojson', data: land });
    map.addSource('borders', { type: 'geojson', data: borders });
    map.addLayer({ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': css('--land') } });
    map.addLayer({ id: 'coast', type: 'line', source: 'land', paint: { 'line-color': css('--border-c'), 'line-width': ['interpolate', ['linear'], ['zoom'], 1, .5, 6, 1.2] } });
    map.addLayer({ id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': css('--line'), 'line-width': .6, 'line-dasharray': [2, 2] } });
    addMonsoon();
    Object.entries(D.layers).forEach(([id, L]) => addStoryLayer(id, L));
    addEvidenceLayer();
    addPlaces();
    mapReady = true;
    if (pendingStep) { applyStep(pendingStep); pendingStep = null; }
    else if (mode === 'explore') setEvidencePoints(D.evidence.map(e => e.id));
    else if (mode === 'evidence') setEvidencePoints(D.evidence.map(e => e.id));
    watchTheme();
  });
}

function addStoryLayer(id, L) {
  map.addSource(id, { type: 'geojson', data: L.data });
  const color = css('--era-' + L.era);
  const vis = 'none';
  if (L.kind === 'fuzzy') {
    map.addLayer({ id: id + '-fill', type: 'fill', source: id, layout: { visibility: vis }, paint: { 'fill-color': color, 'fill-opacity': .16 } });
    map.addLayer({ id: id + '-edge', type: 'line', source: id, layout: { visibility: vis }, paint: { 'line-color': color, 'line-width': 10, 'line-blur': 9, 'line-opacity': .55 } });
    L.data.features.forEach(f => {
      const ring = f.geometry.coordinates[0]; const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length, lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
      const el = h('div', { class: 'fuzzy-label' }, f.properties.name);
      const m = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]);
      fuzzyMarkers.push({ layer: id, m });
    });
  }
  const lineFeatures = L.kind === 'route' || L.kind === 'network' || L.kind === 'converge';
  if (lineFeatures) {
    map.addLayer({ id: id + '-line', type: 'line', source: id, filter: ['==', ['geometry-type'], 'LineString'], layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': L.kind === 'network' ? 1.4 : ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 3.5], 'line-opacity': L.kind === 'network' ? .7 : .95, ...(L.dashed ? { 'line-dasharray': [1.5, 1.5] } : {}) } });
  }
  if (L.kind === 'points' || L.kind === 'converge') {
    map.addLayer({ id: id + '-pt', type: 'circle', source: id, filter: ['==', ['geometry-type'], 'Point'], layout: { visibility: vis },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 8], 'circle-color': color, 'circle-stroke-color': css('--bg'), 'circle-stroke-width': 2 } });
  }
  const hit = [id + '-pt', id + '-line', id + '-fill'].filter(l => map.getLayer(l));
  hit.forEach(l => {
    map.on('click', l, ev => {
      const p = ev.features[0].properties; if (!p.name) return;
      new maplibregl.Popup({ closeButton: false, maxWidth: '260px' }).setLngLat(ev.lngLat).setHTML(`<b>${esc(p.name)}</b>${p.where ? '<br>' + esc(p.where) : ''}`).addTo(map);
    });
    map.on('mouseenter', l, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', l, () => map.getCanvas().style.cursor = '');
  });
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setLayers(set) {
  visible.clear(); set.forEach(id => visible.add(id));
  if (!map || !map.getStyle()) return;
  Object.keys(D.layers).forEach(id => ['-fill', '-edge', '-line', '-pt'].forEach(sfx => { if (map.getLayer(id + sfx)) map.setLayoutProperty(id + sfx, 'visibility', set.has(id) ? 'visible' : 'none'); }));
  fuzzyMarkers.forEach(({ layer, m }) => set.has(layer) ? m.addTo(map) : m.remove());
}

let evMarkers = [], evAlways = true;
function addEvidenceLayer() {
  map.on('zoom', () => { const show = evAlways || map.getZoom() >= 3.5; evMarkers.forEach(m => m.getElement().hidden = !show); });
}
function setEvidencePoints(ids, focus) {
  evMarkers.forEach(m => m.remove()); evMarkers = [];
  if (!map) return;
  evAlways = mode === 'story';
  const groups = {};
  ids.map(id => D.evById[id]).forEach(e => (groups[e.place] = groups[e.place] || []).push(e));
  Object.entries(groups).forEach(([pid, list]) => {
    const pl = D.places.find(p => p.id === pid);
    const n = list.length, r = n === 1 ? 44 : 40 + n * 7;
    list.forEach((e, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
      const btn = h('button', { class: 'ev-pin' + (focus === e.id ? ' hl' : ''), 'aria-label': 'Evidence: ' + e.title, title: e.title, onclick: () => openEvidence(e.id) },
        h('img', { src: `img/thumb/${e.img}.jpg`, alt: '' }));
      const m = new maplibregl.Marker({ element: btn, offset: [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))] }).setLngLat([pl.lon, pl.lat]).addTo(map);
      btn.hidden = !(evAlways || map.getZoom() >= 3.5);
      evMarkers.push(m);
    });
  });
}

function addPlaces() {
  D.places.forEach(pl => {
    const btn = h('button', { class: 'pin ' + pl.status, 'aria-label': `${pl.name}: ${pl.status === 'visited' ? 'visited by the authors' : pl.status === 'next' ? 'the authors’ next stop' : 'still searching'}` });
    const wrap = h('div', { class: 'pin-wrap' }, btn);
    const lbl = h('span', { class: 'pin-label', hidden: true }, pl.name);
    wrap.append(lbl);
    btn.addEventListener('mouseenter', () => lbl.hidden = false); btn.addEventListener('mouseleave', () => lbl.hidden = true);
    btn.addEventListener('focus', () => lbl.hidden = false); btn.addEventListener('blur', () => lbl.hidden = true);
    btn.addEventListener('click', () => {
      const evs = D.evidence.filter(e => e.place === pl.id);
      const status = pl.status === 'visited' ? 'Visited by the authors' : pl.status === 'next' ? 'Next stop' : 'Still searching';
      const html = `<b>${esc(pl.name)}</b><br><span style="font-size:.8rem">${status}</span>${pl.note ? '<br>' + esc(pl.note) : ''}${evs.length ? `<br><button class="btn" data-zoom="${pl.id}" style="margin-top:6px">See ${evs.length} piece${evs.length > 1 ? 's' : ''} of evidence</button>` : ''}`;
      const pop = new maplibregl.Popup({ offset: 14, maxWidth: '260px' }).setLngLat([pl.lon, pl.lat]).setHTML(html).addTo(map);
      const z = pop.getElement().querySelector('[data-zoom]');
      if (z) z.addEventListener('click', () => { pop.remove(); setEvidencePoints(evs.map(e => e.id)); map.flyTo({ center: [pl.lon, pl.lat], zoom: 7.5 }); });
    });
    placeMarkers[pl.id] = new maplibregl.Marker({ element: wrap }).setLngLat([pl.lon, pl.lat]).addTo(map);
  });
}

/* ---------------- Monsoon ---------------- */
function arrowFeatures(dir) {
  const feats = [];
  D.monsoon.paths.forEach(path => {
    const pts = dir === 'ne' ? [...path].reverse() : path;
    feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 1.6, w = 0.55;
    const left = [b[0] - L * Math.cos(ang - w), b[1] - L * Math.sin(ang - w)], right = [b[0] - L * Math.cos(ang + w), b[1] - L * Math.sin(ang + w)];
    feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[b, left, right, b]] } });
  });
  return { type: 'FeatureCollection', features: feats };
}
function addMonsoon() {
  map.addSource('monsoon', { type: 'geojson', data: arrowFeatures('sw') });
  const c = css('--era-water');
  map.addLayer({ id: 'monsoon-line', type: 'line', source: 'monsoon', filter: ['==', ['geometry-type'], 'LineString'], layout: { visibility: 'none', 'line-cap': 'round' }, paint: { 'line-color': c, 'line-width': 4, 'line-opacity': .55 } });
  map.addLayer({ id: 'monsoon-head', type: 'fill', source: 'monsoon', filter: ['==', ['geometry-type'], 'Polygon'], layout: { visibility: 'none' }, paint: { 'fill-color': c, 'fill-opacity': .75 } });
  setMonth(month);
}
function setMonth(m) {
  month = m; const info = D.monsoon.months[m - 1];
  const r = $('#month'); r.value = m; r.setAttribute('aria-valuetext', `${MONTH[m - 1]}: ${info.text}`);
  $('#monthname').textContent = MONTH[m - 1];
  $('#monthtext').textContent = info.text;
  if (!map || !map.getSource('monsoon')) return;
  if (info.wind !== 'calm') map.getSource('monsoon').setData(arrowFeatures(info.wind));
  const op = info.wind === 'calm' ? .15 : .55;
  map.setPaintProperty('monsoon-line', 'line-opacity', op);
  map.setPaintProperty('monsoon-head', 'fill-opacity', info.wind === 'calm' ? .2 : .75);
  map.setPaintProperty('monsoon-line', 'line-dasharray', info.wind === 'calm' ? [1, 2] : [1, 0]);
}
function showDial(on) {
  $('#dial').hidden = !on;
  if (!on) stopPlay();
  if (map && map.getLayer('monsoon-line')) ['monsoon-line', 'monsoon-head'].forEach(l => map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'));
}
function startPlay() { $('#play').textContent = 'Pause'; $('#play').setAttribute('aria-pressed', 'true'); playing = setInterval(() => setMonth(month % 12 + 1), 1600); }
function stopPlay() { if (playing) clearInterval(playing); playing = null; const b = $('#play'); if (b) { b.textContent = 'Play the year'; b.setAttribute('aria-pressed', 'false'); } }

/* ---------------- Theme ---------------- */
function watchTheme() {
  const repaint = () => {
    if (!map.getLayer('land')) return;
    map.setPaintProperty('sea', 'background-color', css('--sea'));
    map.setPaintProperty('land', 'fill-color', css('--land'));
    map.setPaintProperty('coast', 'line-color', css('--border-c'));
    map.setPaintProperty('borders', 'line-color', css('--line'));
    Object.entries(D.layers).forEach(([id, L]) => {
      const c = css('--era-' + L.era);
      if (map.getLayer(id + '-fill')) map.setPaintProperty(id + '-fill', 'fill-color', c);
      if (map.getLayer(id + '-edge')) map.setPaintProperty(id + '-edge', 'line-color', c);
      if (map.getLayer(id + '-line')) map.setPaintProperty(id + '-line', 'line-color', c);
      if (map.getLayer(id + '-pt')) { map.setPaintProperty(id + '-pt', 'circle-color', c); map.setPaintProperty(id + '-pt', 'circle-stroke-color', css('--bg')); }
    });
    ['monsoon-line'].forEach(l => map.setPaintProperty(l, 'line-color', css('--era-water')));
    map.setPaintProperty('monsoon-head', 'fill-color', css('--era-water'));
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
  new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
})();
