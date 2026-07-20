/**
 * Navigations-Menü in der großen Karte: animierte Kompass-Karte bei aktiver
 * Navigation; im Leerlauf ein Ziel-Wähler (Auf-Karte-klicken + Ziel-Kategorien
 * mit nach Entfernung sortierten Zielen).
 */
import { state, on, emit } from './state.js';
import { fmtDist } from './transform.js';
import { distMeters } from './transform.js';
import { svg, CATEGORIES } from './icons.js';
import { navigateToWaypoint, stopNav, activeWaypoint } from './nav.js';
import { focusWorld, setNavClickMode } from './mapview.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PICKERS = [
  { key: 'map', label: 'Auf Karte', icon: 'crosshair' },
  { key: 'waypoints', label: 'Wegpunkte', icon: 'pin' },
  { key: 'fasttravel', label: 'Schnellreise', icon: 'statue' },
  { key: 'towers', label: 'Türme', icon: 'tower' },
  { key: 'bosses', label: 'Bosse', icon: 'skull' },
  { key: 'dungeons', label: 'Dungeons', icon: 'dungeon' },
];

export function initNavMenu() {
  state.ui.navPick = state.ui.navPick || 'waypoints';
  on('nav', render);
  on('player', () => { if (state.navInfo) updateCompass(); else updatePickerDistances(); });
  on('regionChanged', () => { lastSig = null; render(); });
  on('waypoints', () => { if (!state.navInfo) { lastSig = null; render(); } });
  render();
}

// Signatur dessen, was die DOM-STRUKTUR bestimmt. Nur bei Änderung wird die
// Karte neu aufgebaut — sonst nur Werte in-place aktualisiert (kein Flackern,
// keine neu startenden Einblend-Animationen).
let lastSig = null;
let pickerItems = [];

function render() {
  const card = $('#navCard');
  if (!card) return;
  const info = state.navInfo;
  const sig = info ? `a:${info.wp.id}:${info.sameRegion}` : `i:${state.ui.navPick}`;
  const structChanged = sig !== lastSig || card.childElementCount === 0;
  lastSig = sig;
  card.classList.toggle('has-target', !!info);

  if (info) {
    if (structChanged) {
      card.innerHTML = activeTemplate(info);
      $('#btnNavStop').onclick = () => stopNav();
      $('#btnNavShow') && ($('#btnNavShow').onclick = showTarget);
      const rt = state.settings.map.nav.routeIds || [];
      if (rt.length > 1) bindRouteProgress();
    }
    updateCompass();
  } else if (structChanged) {
    card.innerHTML = idleTemplate();
    PICKERS.forEach((p) => {
      const el = card.querySelector(`.np-tab[data-k="${p.key}"]`);
      if (el) el.onclick = () => selectPicker(p.key);
    });
    renderPickerList();
  }
}

function activeTemplate(info) {
  const eta = Number.isFinite(info.etaS)
    ? `${Math.floor(info.etaS / 60)}:${String(Math.round(info.etaS % 60)).padStart(2, '0')}`
    : '–';
  const near = info.dist < 60;
  return `
    <h3>${svg('compass', 15)} Navigation ${near ? '<span class="nav-arrive">Fast da!</span>' : ''}</h3>
    <div class="nav-hero ${near ? 'near' : ''}">
      <div class="compass" id="navCompass">
        <div class="compass-ring"></div>
        <span class="compass-n">N</span>
        <div class="compass-needle" id="navNeedle">${svg('arrow', 34)}</div>
        <div class="compass-dist" id="navDistBig">${fmtDist(info.dist)}</div>
      </div>
      <div class="nav-hero-info">
        <b class="nav-target-name">${esc(info.wp.name)}</b>
        <div class="nav-stat-row">
          <span class="nav-stat">${svg('ruler', 12)} <b id="navDist">${info.sameRegion ? fmtDist(info.dist) : '– '}</b></span>
          <span class="nav-stat">${svg('compass', 12)} <b id="navEta">${info.sameRegion ? eta + ' min' : 'andere Region'}</b></span>
        </div>
        <div class="nav-actions">
          <button class="btn sm" id="btnNavShow">${svg('eye', 12)} Zeigen</button>
          <button class="btn sm danger" id="btnNavStop">${svg('stop', 12)} Stopp <kbd>F9</kbd></button>
        </div>
      </div>
    </div>
    <div id="navRouteProg"></div>`;
}

function bindRouteProgress() {
  const rt = state.settings.map.nav.routeIds || [];
  const box = $('#navRouteProg');
  if (!box) return;
  const activeId = state.settings.map.nav.activeWaypointId;
  box.innerHTML = `<div class="route-prog">${rt.map((id, i) => {
    const wp = state.waypoints.find((w) => w.id === id);
    const done = rt.indexOf(activeId) > i;
    const cur = id === activeId;
    return `<span class="rp-node ${done ? 'done' : ''} ${cur ? 'cur' : ''}" style="--c:${wp?.color || '#46c8ff'}" title="${esc(wp?.name || '')}">${done ? svg('check', 11) : i + 1}</span>`;
  }).join('<span class="rp-line"></span>')}</div>`;
  $('#btnNavShow') && ($('#btnNavShow').onclick = showTarget);
}

function idleTemplate() {
  return `
    <h3>${svg('compass', 15)} Wohin willst du?</h3>
    <div class="np-tabs">
      ${PICKERS.map((p) => `<button class="np-tab ${state.ui.navPick === p.key ? 'active' : ''}" data-k="${p.key}">${svg(p.icon, 13)}<span>${p.label}</span></button>`).join('')}
    </div>
    <div class="np-body" id="npBody"></div>`;
}

function selectPicker(key) {
  state.ui.navPick = key;
  render();
  if (key === 'map') {
    setNavClickMode(true);
    emit('toast', { icon: 'crosshair', msg: 'Klicke auf die Karte, um dorthin zu navigieren' });
  } else {
    setNavClickMode(false);
  }
}

function renderPickerList() {
  const body = $('#npBody');
  if (!body) return;
  const key = state.ui.navPick;

  if (key === 'map') {
    body.innerHTML = `<div class="np-hint">${svg('crosshair', 26)}
      <p>Klick-Modus aktiv.<br>Klicke irgendwo auf die Karte — die Navigation startet sofort dorthin.</p>
      <small>Tipp: Rechtsklick bietet zusätzlich „Wegpunkt hier".</small></div>`;
    return;
  }

  const p = state.player;
  let dests = [];
  if (key === 'waypoints') {
    dests = state.waypoints.filter((w) => !w.temp).map((w) => ({
      id: w.id, name: w.name, wx: w.wx, wy: w.wy, region: w.region, color: w.color, icon: 'sphere', kind: 'wp',
    }));
  } else {
    const list = state.data.markers?.[key] || [];
    dests = list.map((m, i) => ({
      id: `${key}_${i}`, name: m.name || CATEGORIES[key]?.label, wx: m.wx, wy: m.wy,
      region: m.region || 'palpagos', color: CATEGORIES[key]?.color, icon: CATEGORIES[key]?.icon, kind: 'poi',
    }));
  }

  // Nach Entfernung zum Spieler sortieren (falls Position bekannt)
  if (p) {
    for (const d of dests) d._dist = d.region === p.region ? distMeters(p, d) : Infinity + 1;
    dests.sort((a, b) => (a._dist ?? 9e15) - (b._dist ?? 9e15));
  } else {
    dests.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  if (!dests.length) {
    body.innerHTML = `<div class="np-hint"><p>${key === 'waypoints' ? 'Noch keine Wegpunkte gesetzt.' : 'Keine Ziele in dieser Kategorie.'}</p></div>`;
    return;
  }

  const shown = dests.slice(0, 60);
  pickerItems = shown;
  body.innerHTML = `<div class="np-list">${shown.map((d, i) => `
    <button class="np-item" data-i="${i}" style="--c:${d.color || '#46c8ff'};--delay:${Math.min(i * 22, 500)}ms">
      <span class="np-ico">${svg(d.icon || 'pin', 15)}</span>
      <span class="np-name">${esc(d.name)}</span>
      <span class="np-dist">${d._dist != null && Number.isFinite(d._dist) ? fmtDist(d._dist) : (d.region !== (p?.region) && p ? state.data.regions?.[d.region]?.title || '' : '')}</span>
      <span class="np-go">${svg('flag', 13)}</span>
    </button>`).join('')}</div>
    ${dests.length > shown.length ? `<div class="np-more">+ ${dests.length - shown.length} weitere — nutze die Suche oben</div>` : ''}`;

  body.querySelectorAll('.np-item').forEach((el) => {
    const d = shown[Number(el.dataset.i)];
    el.onclick = () => startNavTo(d);
  });
}

// Aktualisiert nur die Distanz-Zahlen im Ziel-Wähler in-place (kein Neuaufbau,
// keine neu startenden Animationen) — sorgt für ruhige, flackerfreie Anzeige.
function updatePickerDistances() {
  const body = $('#npBody');
  if (!body || state.ui.navPick === 'map') return;
  const p = state.player;
  if (!p) return;
  body.querySelectorAll('.np-item').forEach((el) => {
    const d = pickerItems[Number(el.dataset.i)];
    if (!d) return;
    const dm = d.region === p.region ? distMeters(p, d) : Infinity;
    const span = el.querySelector('.np-dist');
    if (span) span.textContent = Number.isFinite(dm) ? fmtDist(dm) : (state.data.regions?.[d.region]?.title || '');
  });
}

function startNavTo(d) {
  if (d.kind === 'wp') {
    navigateToWaypoint(d.id);
  } else {
    // POI → temporäres Ziel
    import('./nav.js').then((m) => m.navigateToPoint(d.wx, d.wy, d.region, d.name));
  }
  focusWorld(d.wx, d.wy, d.region, 0.2);
}

function showTarget() {
  const wp = activeWaypoint();
  if (wp) focusWorld(wp.wx, wp.wy, wp.region, 0.5);
}

// Sanfte Live-Aktualisierung von Nadel/Distanz ohne Neuaufbau
function updateCompass() {
  const info = state.navInfo;
  if (!info) return;
  const needle = $('#navNeedle');
  if (needle) needle.style.transform = `rotate(${info.rel}deg)`;
  const dist = $('#navDist'); if (dist && info.sameRegion) dist.textContent = fmtDist(info.dist);
  const distBig = $('#navDistBig'); if (distBig && info.sameRegion) distBig.textContent = fmtDist(info.dist);
  const eta = $('#navEta');
  if (eta && info.sameRegion) {
    eta.textContent = Number.isFinite(info.etaS)
      ? `${Math.floor(info.etaS / 60)}:${String(Math.round(info.etaS % 60)).padStart(2, '0')} min` : '– min';
  }
  const hero = document.querySelector('.nav-hero');
  if (hero) hero.classList.toggle('near', info.dist < 60);
}
