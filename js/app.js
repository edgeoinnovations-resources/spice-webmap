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
const REDUCE = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const NARROW = () => matchMedia('(max-width: 860px)').matches;
let stops = [];

function buildUI() {
  const tb = $('.topbar');
  const setTb = () => document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
  setTb(); new ResizeObserver(setTb).observe(tb);
  $$('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.addEventListener('keydown', e => {
    if (mode !== 'story' || !$('#cover').hidden || e.target.closest('input, dialog[open]')) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); go(current + 1); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1); }
  });
  const m = $('#month');
  m.addEventListener('input', () => { stopPlay(); setMonth(+m.value); });
  $('#play').addEventListener('click', () => playing ? stopPlay() : startPlay());
  $('#home').addEventListener('click', () => showCover(true));
  stops = [];
  D.cases.forEach(c => {
    if (c.id !== 'intro') stops.push({ type: 'case', id: 'case-' + c.id, c });
    D.steps.filter(s => s.case === c.id).forEach(s => stops.push({ type: 'step', id: 'step-' + s.id, s, c }));
  });
  buildCover();
  const hash = (location.hash || '').slice(1);
  setMode(hash in { explore: 1, evidence: 1 } ? hash : 'story', true);
  showCover(!(hash in { explore: 1, evidence: 1, story: 1 }));
}

/* ---------------- Opening page ---------------- */
function buildCover() {
  const cv = $('#cover'); cv.innerHTML = '';
  const hero = D.evById['resin-bowl'];
  const toc = h('ol', { class: 'cover-toc' });
  D.cases.forEach(c => {
    const first = stops.findIndex(st => st.c && st.c.id === c.id);
    toc.append(h('li', { style: `--era:${eraVar(c.era)}` },
      h('button', { onclick: () => { showCover(false); setMode('story'); setTimeout(() => go(first, true), 60); } },
        h('span', { class: 'toc-num' }, c.num || (c.id === 'intro' ? '•' : '•')),
        h('span', { class: 'toc-text' }, h('b', {}, c.title), h('small', {}, c.label)))));
  });
  cv.append(h('div', { class: 'cover-inner' },
    h('div', { class: 'cover-text' },
      h('p', { class: 'cover-kicker' }, 'A companion map to Spice, a book in progress by Marc Aronson and Marina Budhos'),
      h('h1', { id: 'cover-title' }, 'Spice Changed the World'),
      h('p', { class: 'cover-lede' }, 'Pepper, cloves, nutmeg, cinnamon, frankincense. For thousands of years these small, dried, fragrant things crossed deserts and oceans. They built cities, spread religions, launched voyages and started wars.'),
      h('p', {}, 'Yet the trade is hard to see today. Spices were eaten, burned or used up. The warehouses became shops and museums, and the objects scattered around the world. So this is a detective story. Marc and Marina have been travelling to find what’s left, and their photographs are your evidence.'),
      h('div', { class: 'cover-how' },
        h('div', {}, h('b', {}, 'Story'), h('span', {}, 'Scroll or press Next. The map moves with the text, case by case.')),
        h('div', {}, h('b', {}, 'Explore'), h('span', {}, 'Turn layers on and off and play the monsoon year.')),
        h('div', {}, h('b', {}, 'Evidence'), h('span', {}, 'Open every photo. Ask what it proves, what it can’t, and where it was really taken.'))),
      h('div', { class: 'cover-actions' },
        h('button', { class: 'btn primary big', id: 'begin', onclick: () => { showCover(false); setMode('story'); setTimeout(() => go(0, true), 60); } }, 'Begin the story'),
        h('button', { class: 'btn big', onclick: () => { showCover(false); setMode('evidence'); } }, 'Go to the evidence'))),
    h('div', { class: 'cover-side' },
      h('figure', { class: 'cover-fig' }, h('img', { src: `img/full/${hero.img}.jpg`, alt: 'A wooden bowl of frankincense grains for sale in Venice' }),
        h('figcaption', {}, 'Frankincense for sale in Venice, April 2026. ' + D.credit)),
      h('nav', { 'aria-label': 'Cases' }, h('h2', { class: 'toc-title' }, 'The cases'), toc))));
}
function showCover(on) {
  const cv = $('#cover'); cv.hidden = !on;
  document.body.classList.toggle('cover-open', on);
  if (on) { cv.scrollTop = 0; $('#begin').focus({ preventScroll: true }); if (map) travel({ center: [60, 18], zoom: 1.4 }); }
}

function setMode(m, initial) {
  mode = m;
  $$('.modes button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === m));
  const p = $('#panel'); p.innerHTML = ''; p.scrollTop = 0;
  moveToken++; clearTimeout(schedTimer); clearSpot();
  if (m === 'story') renderStory(p);
  if (m === 'explore') renderExplore(p);
  if (m === 'evidence') renderEvidence(p);
  if (m !== 'story') $('#mapnote').hidden = true;
}

function eraVar(era) { return `var(--era-${era})`; }

function renderStory(p) {
  const prog = h('div', { class: 'progress', role: 'navigation', 'aria-label': 'Jump to a case' });
  D.cases.forEach(c => {
    const first = stops.findIndex(st => st.c && st.c.id === c.id);
    prog.append(h('button', { class: 'seg', 'data-case': c.id, style: `--era:${eraVar(c.era)}`, title: `${c.label}: ${c.title}`, 'aria-label': `${c.label}: ${c.title}`, onclick: () => go(first) }, h('span', {})));
  });
  p.append(h('div', { class: 'storyhead' }, prog, h('div', { class: 'nowcase', id: 'nowcase', 'aria-live': 'polite' })));
  let wrap = null;
  stops.forEach((st, i) => {
    const c = st.c;
    if (st.type === 'case' || (st.type === 'step' && c.id === 'intro' && !wrap)) {
      wrap = h('section', { class: 'chapter', style: `--era:${eraVar(c.era)}`, 'aria-label': `${c.label}: ${c.title}` });
      p.append(wrap);
    }
    if (st.type === 'case') {
      const n = D.steps.filter(s => s.case === c.id).length;
      wrap.append(h('header', { class: 'chapter-card stop', id: st.id, 'data-i': i, tabindex: '-1' },
        h('div', { class: 'chapter-num', 'aria-hidden': 'true' }, c.num || '∴'),
        h('div', { class: 'chapter-label' }, c.label),
        h('h2', {}, c.title),
        c.question ? h('p', { class: 'question' }, c.question) : null,
        h('p', { class: 'chapter-meta' }, `${n} stops · scroll or press Next`)));
      return;
    }
    const s = st.s;
    const card = h('article', { class: 'step stop', id: st.id, 'data-i': i, tabindex: '-1', 'aria-labelledby': 'h-' + s.id },
      s.spot ? h('div', { class: 'step-place' }, s.spot.label) : null,
      h('h3', { id: 'h-' + s.id }, s.title), ...s.body.map(t => h('p', {}, t)));
    const tags = [];
    if (s.certainty) tags.push(h('span', { class: 'chip cert-' + s.certainty }, h('span', { class: 'dot' }), 'Certainty: ' + CERT[s.certainty]));
    if (s.monsoon) tags.push(h('span', { class: 'chip' }, 'Month dial on the map'));
    if (tags.length) card.append(h('div', { class: 'tags' }, tags));
    if (s.evidence) card.append(h('div', { class: 'thumbs' }, s.evidence.map(id => { const e = D.evById[id]; return h('button', { class: 'thumb', onclick: () => openEvidence(id), 'aria-label': 'Open evidence: ' + e.title }, h('img', { src: `img/thumb/${e.img}.jpg`, alt: '', loading: 'lazy' })); })));
    wrap.append(card);
  });
  p.append(h('div', { class: 'story-end' }, 'Draft built from the authors’ March 2026 proposal and travel photographs. Text will change as the book is written.'));
  p.append(h('nav', { class: 'stepnav', 'aria-label': 'Story steps' },
    h('button', { class: 'btn', onclick: () => go(current - 1), 'aria-label': 'Previous stop' }, '↑ Back'),
    h('span', { id: 'stepcount' }, ''),
    h('button', { class: 'btn primary', onclick: () => go(current + 1), 'aria-label': 'Next stop' }, 'Next ↓')));
  const io = new IntersectionObserver(entries => {
    entries.filter(e => e.isIntersecting).forEach(e => schedule(+e.target.dataset.i));
  }, { root: null, rootMargin: NARROW() ? '-70% 0px -18% 0px' : '-40% 0px -50% 0px' });
  $$('.stop', p).forEach(el => io.observe(el));
  current = -1;
  activate(0);
}

let goingTo = null, schedTimer = null;
function go(i, instant) {
  i = Math.max(0, Math.min(stops.length - 1, i));
  const el = $('#' + stops[i].id);
  if (!el) return;
  goingTo = i;
  const behavior = REDUCE() || instant ? 'auto' : 'smooth';
  if (NARROW()) {
    const top = $('.topbar').offsetHeight + $('.map-wrap').offsetHeight + 14;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - top, behavior });
  } else el.scrollIntoView({ block: 'center', behavior });
  clearTimeout(schedTimer);
  activate(i);
  el.focus({ preventScroll: true });
  setTimeout(() => { goingTo = null; }, 1200);
}
// While the reader scrolls, wait until they settle before moving the map.
function schedule(i) {
  if (goingTo !== null) return;
  clearTimeout(schedTimer);
  schedTimer = setTimeout(() => activate(i), 350);
}

function activate(i) {
  if (i === current || !stops[i]) return;
  current = i;
  const st = stops[i];
  $$('.stop').forEach(el => el.classList.toggle('active', +el.dataset.i === i));
  const sc = $('#stepcount'); if (sc) sc.textContent = `${i + 1} of ${stops.length}`;
  $$('.progress .seg').forEach(b => { const ci = D.cases.findIndex(c => c.id === b.dataset.case), cur = D.cases.findIndex(c => c.id === st.c.id); b.classList.toggle('done', ci < cur); b.classList.toggle('now', ci === cur); });
  const nc = $('#nowcase'); if (nc) { nc.style.setProperty('--era', eraVar(st.c.era)); nc.textContent = `${st.c.label} · ${st.c.title}`; }
  if (!mapReady) { pendingStep = st; return; }
  applyStop(st);
}
let pendingStep = null;

/* ---------------- Map choreography ----------------
   1. Clear what the last stop showed.
   2. Travel: if the jump is long, pull back until both places are in view, pause, then fly in.
   3. Only once the camera has arrived, draw the layers, the spotlight and the evidence. */
let moveToken = 0;
function applyStop(st) {
  const token = ++moveToken;
  setLayers(new Set()); setEvidencePoints([]); clearSpot(); showDial(false);
  $('#mapnote').hidden = true;
  if (st.type === 'case') {
    travel(st.c.camera, token).then(ok => { if (!ok) return; showCaseNote(st.c); });
    return;
  }
  const s = st.s;
  travel(s.camera, token).then(ok => {
    if (!ok) return;
    if (s.spot) setSpot(s.spot);
    setLayers(new Set(s.layers || []), true);
    setEvidencePoints(s.evidence || []);
    showDial(!!s.monsoon);
    const note = $('#mapnote');
    if (s.layers && s.layers.length) {
      const L = D.layers[s.layers[0]];
      note.hidden = false; note.style.setProperty('--era', eraVar(L.era));
      note.innerHTML = ''; note.append(h('b', {}, L.title), L.legend || '');
    }
  });
}
function showCaseNote(c) {
  const note = $('#mapnote'); note.hidden = false; note.style.setProperty('--era', eraVar(c.era));
  note.innerHTML = ''; note.append(h('b', {}, `${c.label}: ${c.title}`), c.question || '');
}

const wait = ms => new Promise(r => setTimeout(r, ms));
function moveEnd(token) { return new Promise(r => { const done = () => r(token === moveToken); map.once('moveend', done); }); }
function kmBetween(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
async function travel(cam, token = ++moveToken) {
  const zoom = cam.zoom - (NARROW() ? 0.7 : 0);
  const target = { center: cam.center, zoom };
  if (REDUCE()) { map.jumpTo(target); return token === moveToken; }
  map.stop();
  const from = map.getCenter().toArray(), z0 = map.getZoom();
  const km = kmBetween(from, cam.center);
  const close = Math.min(z0, zoom) > 3.2;
  if (km > 600 && (z0 > 3.4 || zoom > 3.4)) {
    // Stage 1: pull back so both places are on screen.
    const b = new maplibregl.LngLatBounds(from, from).extend(cam.center);
    const fit = map.cameraForBounds(b, { padding: NARROW() ? 40 : 110 });
    const outZoom = Math.min(fit ? fit.zoom : 2, z0, zoom, 4.2);
    if (z0 - outZoom > 0.6) {
      map.easeTo({ center: fit ? fit.center : from, zoom: outZoom, duration: 1700, easing: t => 1 - Math.pow(1 - t, 3) });
      if (!(await moveEnd(token))) return false;
      await wait(450); if (token !== moveToken) return false;
    }
    map.flyTo({ ...target, duration: 2600, curve: 1.2, essential: true });
  } else {
    const d = Math.min(2600, Math.max(1300, km * 0.6 + Math.abs(z0 - zoom) * 260));
    map.flyTo({ ...target, duration: d, curve: 1.3, essential: true });
  }
  return moveEnd(token);
}

/* Spotlight on a single place */
let spotMarker = null;
function setSpot(sp) {
  clearSpot();
  const el = h('div', { class: 'spot', 'aria-hidden': 'true' }, h('span', { class: 'spot-ring' }), h('span', { class: 'spot-label' }, sp.label));
  spotMarker = new maplibregl.Marker({ element: el }).setLngLat([sp.lon, sp.lat]).addTo(map);
}
function clearSpot() { if (spotMarker) { spotMarker.remove(); spotMarker = null; } }

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
    if (pendingStep) { applyStop(pendingStep); pendingStep = null; }
    else if (mode === 'explore') setEvidencePoints(D.evidence.map(e => e.id));
    else if (mode === 'evidence') setEvidencePoints(D.evidence.map(e => e.id));
    watchTheme();
  });
}

function addStoryLayer(id, L) {
  map.addSource(id, { type: 'geojson', data: L.data, lineMetrics: true });
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
      paint: { 'line-color': color, 'line-width': L.kind === 'network' ? 1.4 : ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 3.5], 'line-opacity': L.kind === 'network' ? .7 : .95, 'line-opacity-transition': { duration: 900 }, ...(L.dashed ? { 'line-dasharray': [1.5, 1.5] } : { 'line-gradient': grad(color, 1) }) } });
  }
  if (L.kind === 'points' || L.kind === 'converge') {
    map.addLayer({ id: id + '-pt', type: 'circle', source: id, filter: ['==', ['geometry-type'], 'Point'], layout: { visibility: vis },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 8], 'circle-opacity-transition': { duration: 700 }, 'circle-stroke-opacity-transition': { duration: 700 }, 'circle-color': color, 'circle-stroke-color': css('--bg'), 'circle-stroke-width': 2 } });
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

const grad = (color, p) => p >= 1 ? ['step', ['line-progress'], color, 1, color] : ['step', ['line-progress'], color, Math.max(0.0001, p), 'rgba(0,0,0,0)'];
let revealRaf = null;
// animate = draw routes from start to end and fade points in, once the camera has arrived
function setLayers(set, animate) {
  visible.clear(); set.forEach(id => visible.add(id));
  if (!map || !map.getStyle()) return;
  cancelAnimationFrame(revealRaf);
  const anim = animate && !REDUCE();
  Object.keys(D.layers).forEach(id => {
    const on = set.has(id), L = D.layers[id], color = css('--era-' + L.era);
    ['-fill', '-edge', '-line', '-pt'].forEach(sfx => { if (map.getLayer(id + sfx)) map.setLayoutProperty(id + sfx, 'visibility', on ? 'visible' : 'none'); });
    if (map.getLayer(id + '-line') && !L.dashed) map.setPaintProperty(id + '-line', 'line-gradient', grad(color, on && anim ? 0 : 1));
    if (map.getLayer(id + '-pt')) { const o = on && anim ? 0 : 1; map.setPaintProperty(id + '-pt', 'circle-opacity', o); map.setPaintProperty(id + '-pt', 'circle-stroke-opacity', o); }
  });
  fuzzyMarkers.forEach(({ layer, m }) => set.has(layer) ? m.addTo(map) : m.remove());
  if (!anim) return;
  const ids = [...set].filter(id => D.layers[id]);
  const t0 = performance.now(), dur = 2400;
  const tick = now => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 2);
    ids.forEach(id => { const L = D.layers[id]; if (map.getLayer(id + '-line') && !L.dashed) map.setPaintProperty(id + '-line', 'line-gradient', grad(css('--era-' + L.era), e)); });
    if (t < 1) revealRaf = requestAnimationFrame(tick);
  };
  revealRaf = requestAnimationFrame(tick);
  setTimeout(() => ids.forEach(id => { if (map.getLayer(id + '-pt')) { map.setPaintProperty(id + '-pt', 'circle-opacity', 1); map.setPaintProperty(id + '-pt', 'circle-stroke-opacity', 1); } }), 500);
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
      if (map.getLayer(id + '-line')) { map.setPaintProperty(id + '-line', 'line-color', c); if (!L.dashed) map.setPaintProperty(id + '-line', 'line-gradient', grad(c, 1)); }
      if (map.getLayer(id + '-pt')) { map.setPaintProperty(id + '-pt', 'circle-color', c); map.setPaintProperty(id + '-pt', 'circle-stroke-color', css('--bg')); }
    });
    ['monsoon-line'].forEach(l => map.setPaintProperty(l, 'line-color', css('--era-water')));
    map.setPaintProperty('monsoon-head', 'fill-color', css('--era-water'));
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
  new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
})();
