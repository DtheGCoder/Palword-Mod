/**
 * Interaktive Vollbild-Karte (Leaflet, CRS.Simple).
 * Welt-cm → Bildpixel → LatLng: ll = (-py, px)
 */
/* global L */
import { state, on, emit, saveWaypoints, newWaypointId, patchSettings } from './state.js';
import { RegionMath, regionForWorld, fmtGame, fmtDist, distMeters } from './transform.js';
import { svg, CATEGORIES, SPAWN_COLORS } from './icons.js';
import { navigateToPoint, navigateToWaypoint, stopNav } from './nav.js';

let map = null;
let imageLayer = null;
let gridLayer = null;
let markerLayer = null;
let spawnLayer = null;
let spawnRenderer = null;
let waypointLayer = null;
let trailLine = null;
let navLine = null;
let playerMarker = null;
let measureLayer = null;
const viewByRegion = {};   // regionId → {center, zoom}
let suspendFollow = false;
let lastPan = 0;
let imgUrlCache = {};
let navClickMode = false;

export function setNavClickMode(on) {
  navClickMode = !!on;
  const el = document.getElementById('map');
  if (el) el.classList.toggle('nav-click', navClickMode);
}

const ll = (px, py) => L.latLng(-py, px);

function rm() { return state.math[state.region]; }

function worldToLl(wx, wy, region = state.region) {
  const m = state.math[region];
  const { px, py } = m.worldToPx(wx, wy);
  return ll(px, py);
}

function llToWorld(latlng) {
  return rm().pxToWorld(latlng.lng, -latlng.lat);
}

// ------------------------------------------------------------ Aufbau

export async function initMap() {
  map = L.map('map', {
    crs: L.CRS.Simple,
    zoomControl: false,
    attributionControl: false,
    minZoom: -4,
    maxZoom: 2.5,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 110,
    doubleClickZoom: false,
    boxZoom: false,
  });
  spawnRenderer = L.canvas({ padding: 0.4 });

  map.on('mousemove', (e) => {
    const w = llToWorld(e.latlng);
    const g = rm().worldToGame(w.wx, w.wy);
    const el = document.getElementById('cursorCoords');
    if (el) el.textContent = fmtGame(g);
  });
  map.on('dragstart', () => { suspendFollow = true; updateFollowBtn(); });
  map.on('contextmenu', (e) => openContextMenu(e));
  map.on('click', (e) => {
    closeContextMenu();
    if (state.measure) { measureClick(e); return; }
    if (navClickMode) {
      const w = llToWorld(e.latlng);
      navigateToPoint(w.wx, w.wy, state.region, 'Kartenziel');
      setNavClickMode(false);
      return;
    }
  });
  map.on('zoomend', () => document.body.style.setProperty('--map-zoom', map.getZoom()));

  await setRegion(state.region, { fit: true });

  on('player', onPlayer);
  on('nav', drawNavLine);
  on('waypoints', drawWaypoints);
  on('filters', rebuildOverlays);
  on('region', () => rebuildOverlays());
  window.addEventListener('resize', () => map && map.invalidateSize());
}

export function getMap() { return map; }

export async function setRegion(regionId, opts = {}) {
  if (!state.data.regions || !state.data.regions[regionId]) return;
  if (map && state.region && map._loaded) {
    viewByRegion[state.region] = { center: map.getCenter(), zoom: map.getZoom() };
  }
  state.region = regionId;
  const cfg = state.data.regions[regionId];

  if (imageLayer) { imageLayer.remove(); imageLayer = null; }
  const bounds = L.latLngBounds(ll(0, cfg.height), ll(cfg.width, 0));
  map.setMaxBounds(bounds.pad(0.25));
  document.getElementById('map').style.background = cfg.seaColor || '#0a1622';

  if (!imgUrlCache[regionId]) {
    imgUrlCache[regionId] = await state.bridge.assetUrl(cfg.image);
  }
  const url = imgUrlCache[regionId];
  if (url) {
    imageLayer = L.imageOverlay(url, bounds, { className: 'region-image' }).addTo(map);
    imageLayer.on('error', () => showMapMissing(cfg));
  } else {
    showMapMissing(cfg);
  }

  const saved = viewByRegion[regionId];
  if (saved && !opts.fit) {
    map.setView(saved.center, saved.zoom, { animate: false });
  } else {
    map.fitBounds(bounds, { animate: false });
  }
  rebuildOverlays();
  emit('regionChanged', regionId);
}

function showMapMissing(cfg) {
  emit('toast', {
    icon: 'warn',
    msg: `Kartenbild „${cfg.image}" fehlt — bitte einmal „npm run fetch-assets" ausführen`,
    sticky: true,
  });
}

// ------------------------------------------------------------ Overlays

export function rebuildOverlays() {
  if (!map) return;
  drawGrid();
  drawMarkers();
  drawSpawns();
  drawWaypoints();
  drawNavLine();
  drawPlayer(true);
}

function drawGrid() {
  if (gridLayer) { gridLayer.remove(); gridLayer = null; }
  if (!state.settings?.map?.showGrid) return;
  const m = rm();
  gridLayer = L.layerGroup([], { pane: 'overlayPane' });
  const b = m.cfg.worldBounds;
  const gMin = m.worldToGame(b.minX, b.minY);
  const gMax = m.worldToGame(b.maxX, b.maxY);
  const [gx0, gx1] = [Math.min(gMin.gx, gMax.gx), Math.max(gMin.gx, gMax.gx)];
  const [gy0, gy1] = [Math.min(gMin.gy, gMax.gy), Math.max(gMin.gy, gMax.gy)];
  const style = { color: '#7fbfff', weight: 0.5, opacity: 0.18, interactive: false };
  for (let gx = Math.ceil(gx0 / 100) * 100; gx <= gx1; gx += 100) {
    const a = m.gameToWorld(gx, gy0), c = m.gameToWorld(gx, gy1);
    gridLayer.addLayer(L.polyline([worldToLl(a.wx, a.wy), worldToLl(c.wx, c.wy)], style));
  }
  for (let gy = Math.ceil(gy0 / 100) * 100; gy <= gy1; gy += 100) {
    const a = m.gameToWorld(gx0, gy), c = m.gameToWorld(gx1, gy);
    gridLayer.addLayer(L.polyline([worldToLl(a.wx, a.wy), worldToLl(c.wx, c.wy)], style));
  }
  gridLayer.addTo(map);
}

function poiIcon(cat, done) {
  const c = CATEGORIES[cat] || CATEGORIES.fasttravel;
  return L.divIcon({
    className: 'poi-wrap',
    html: `<div class="poi ${done ? 'done' : ''}" style="--c:${c.color}">${svg(c.icon, 15)}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function drawMarkers() {
  if (markerLayer) { markerLayer.remove(); }
  markerLayer = L.layerGroup();
  const markers = state.data.markers || {};
  for (const cat of Object.keys(CATEGORIES)) {
    if (!state.filters.cats.has(cat)) continue;
    for (const mk of markers[cat] || []) {
      if ((mk.region || 'palpagos') !== state.region) continue;
      const done = !!state.completed[mk.id];
      const marker = L.marker(worldToLl(mk.wx, mk.wy), {
        icon: poiIcon(cat, done),
        title: '',
        riseOnHover: true,
      });
      marker.bindTooltip(escapeHtml(mk.name || CATEGORIES[cat].label), { direction: 'top', offset: [0, -12], className: 'pp-tip' });
      marker.on('click', () => openPoiCard(marker, cat, mk));
      markerLayer.addLayer(marker);
    }
  }
  markerLayer.addTo(map);
}

function openPoiCard(marker, cat, mk) {
  const c = CATEGORIES[cat];
  const g = rm().worldToGame(mk.wx, mk.wy);
  const done = !!state.completed[mk.id];
  const lvl = mk.level ? `<span class="badge">Lv. ${mk.level}</span>` : '';
  const checkable = cat === 'towers' || cat === 'bosses' || cat === 'effigies' || cat === 'chests';
  const html = `
    <div class="card-head" style="--c:${c.color}">${svg(c.icon, 16)}<b>${escapeHtml(mk.name || c.label)}</b>${lvl}</div>
    <div class="card-sub">${c.label}${mk.info ? ' · ' + escapeHtml(mk.info) : ''} · <span class="mono">${fmtGame(g)}</span></div>
    <div class="card-actions">
      <button class="btn btn-acc" data-act="nav">${svg('flag', 13)} Navigieren</button>
      <button class="btn" data-act="wp">${svg('pin', 13)} Wegpunkt</button>
      ${checkable ? `<button class="btn" data-act="done">${svg('check', 13)} ${done ? 'Offen' : 'Erledigt'}</button>` : ''}
    </div>`;
  const popup = L.popup({ className: 'pp-popup', closeButton: true, offset: [0, -10], autoPan: true })
    .setLatLng(marker.getLatLng()).setContent(html).openOn(map);
  const root = popup.getElement();
  root.querySelector('[data-act="nav"]').onclick = () => { navigateToPoint(mk.wx, mk.wy, mk.region || state.region, mk.name || c.label); map.closePopup(); };
  root.querySelector('[data-act="wp"]').onclick = () => { addWaypointAt(mk.wx, mk.wy, mk.name || c.label); map.closePopup(); };
  const doneBtn = root.querySelector('[data-act="done"]');
  if (doneBtn) doneBtn.onclick = () => {
    state.completed[mk.id] = !state.completed[mk.id];
    patchSettings({ map: { completed: state.completed } });
    map.closePopup();
    drawMarkers();
  };
}

function drawSpawns() {
  if (spawnLayer) { spawnLayer.remove(); }
  spawnLayer = L.layerGroup();
  const spawns = state.data.spawns || {};
  for (const [palId, colorIdx] of state.filters.pals) {
    const color = SPAWN_COLORS[colorIdx % SPAWN_COLORS.length];
    const byRegion = spawns[palId] || {};
    const pts = byRegion[state.region] || [];
    for (const p of pts) {
      // p = [wx, wy, minLv, maxLv, night(0|1|2)]
      spawnLayer.addLayer(L.circleMarker(worldToLl(p[0], p[1]), {
        renderer: spawnRenderer, radius: 9, stroke: false, fillColor: color, fillOpacity: 0.10, interactive: false,
      }));
      spawnLayer.addLayer(L.circleMarker(worldToLl(p[0], p[1]), {
        renderer: spawnRenderer, radius: 3.4, stroke: false, fillColor: color, fillOpacity: 0.85, interactive: false,
      }));
    }
  }
  spawnLayer.addTo(map);
}

function waypointIcon(wp, active) {
  return L.divIcon({
    className: 'wp-wrap',
    html: `<div class="wp ${active ? 'active' : ''} ${wp.temp ? 'temp' : ''}" style="--c:${wp.color || '#46c8ff'}">
             ${svg(wp.temp ? 'flag' : 'sphere', 15)}
           </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function drawWaypoints() {
  if (waypointLayer) { waypointLayer.remove(); }
  waypointLayer = L.layerGroup();
  const activeId = state.settings?.map?.nav?.activeWaypointId;
  for (const wp of state.waypoints) {
    if ((wp.region || 'palpagos') !== state.region) continue;
    const marker = L.marker(worldToLl(wp.wx, wp.wy), {
      icon: waypointIcon(wp, wp.id === activeId),
      draggable: !wp.temp,
      autoPan: true,
    });
    marker.bindTooltip(escapeHtml(wp.name), { direction: 'top', offset: [0, -14], className: 'pp-tip' });
    marker.on('dragend', () => {
      const w = llToWorld(marker.getLatLng());
      wp.wx = w.wx; wp.wy = w.wy;
      saveWaypoints();
      emit('nav');
    });
    marker.on('click', () => openWaypointCard(marker, wp));
    waypointLayer.addLayer(marker);
  }
  waypointLayer.addTo(map);
  drawNavLine();
}

function openWaypointCard(marker, wp) {
  const g = rm().worldToGame(wp.wx, wp.wy);
  const isActive = state.settings?.map?.nav?.activeWaypointId === wp.id;
  const html = `
    <div class="card-head" style="--c:${wp.color || '#46c8ff'}">${svg('sphere', 16)}<b>${escapeHtml(wp.name)}</b></div>
    <div class="card-sub">Wegpunkt · <span class="mono">${fmtGame(g)}</span></div>
    <div class="card-actions">
      ${isActive
        ? `<button class="btn" data-act="stop">${svg('stop', 13)} Stopp</button>`
        : `<button class="btn btn-acc" data-act="nav">${svg('flag', 13)} Navigieren</button>`}
      <button class="btn" data-act="del">${svg('trash', 13)} Löschen</button>
    </div>`;
  const popup = L.popup({ className: 'pp-popup', offset: [0, -10] })
    .setLatLng(marker.getLatLng()).setContent(html).openOn(map);
  const root = popup.getElement();
  const navBtn = root.querySelector('[data-act="nav"]');
  if (navBtn) navBtn.onclick = () => { navigateToWaypoint(wp.id); map.closePopup(); };
  const stopBtn = root.querySelector('[data-act="stop"]');
  if (stopBtn) stopBtn.onclick = () => { stopNav(); map.closePopup(); };
  root.querySelector('[data-act="del"]').onclick = () => {
    import('./nav.js').then((m) => m.deleteWaypoint(wp.id));
    map.closePopup();
  };
}

export function addWaypointAt(wx, wy, name = null) {
  const n = state.waypoints.filter((w) => !w.temp).length + 1;
  const wp = {
    id: newWaypointId(),
    name: name || `Wegpunkt ${n}`,
    wx, wy,
    region: regionForWorld(state.math, wx, wy),
    color: SPAWN_COLORS[(n - 1) % SPAWN_COLORS.length],
    createdAt: Date.now(),
  };
  state.waypoints.push(wp);
  saveWaypoints();
  emit('toast', { icon: 'pin', msg: `„${wp.name}" gesetzt` });
  return wp;
}

// ------------------------------------------------------------ Spieler

function playerIcon() {
  return L.divIcon({
    className: 'player-wrap',
    html: `<div class="player"><div class="pulse"></div><div class="wedge"></div><div class="dot"></div></div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  });
}

function onPlayer() {
  drawPlayer(false);
  drawTrail();
}

function drawPlayer(force) {
  const p = state.player;
  if (!p || p.region !== state.region) {
    if (playerMarker) { playerMarker.remove(); playerMarker = null; }
    return;
  }
  const pos = worldToLl(p.wx, p.wy);
  if (!playerMarker) {
    playerMarker = L.marker(pos, { icon: playerIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
  } else {
    playerMarker.setLatLng(pos);
  }
  const el = playerMarker.getElement();
  if (el) {
    const wedge = el.querySelector('.wedge');
    if (wedge) wedge.style.transform = `rotate(${p.headingDeg || 0}deg)`;
    el.classList.toggle('stale', !p.fresh);
  }
  // Follow-Modus
  const now = Date.now();
  if (state.settings?.map?.followPlayer && !suspendFollow && state.mode === 'map' && now - lastPan > 700) {
    lastPan = now;
    if (!map.getBounds().pad(-0.35).contains(pos)) map.panTo(pos, { animate: true, duration: 0.5 });
  }
  const el2 = document.getElementById('playerCoords');
  if (el2) {
    const g = rm().worldToGame(p.wx, p.wy);
    el2.textContent = fmtGame(g);
  }
  if (force) drawTrail();
}

function drawTrail() {
  const pts = state.trail.filter((t) => t.region === state.region);
  if (trailLine) { trailLine.remove(); trailLine = null; }
  if (pts.length < 2) return;
  trailLine = L.polyline(pts.map((t) => worldToLl(t.wx, t.wy)), {
    color: '#46c8ff', weight: 2, opacity: 0.35, dashArray: '1 6', interactive: false, lineCap: 'round',
  }).addTo(map);
}

function drawNavLine() {
  if (navLine) { navLine.remove(); navLine = null; }
  const info = state.navInfo;
  const p = state.player;
  if (!info || !p || !info.sameRegion || p.region !== state.region) return;
  navLine = L.polyline([worldToLl(p.wx, p.wy), worldToLl(info.wp.wx, info.wp.wy)], {
    color: '#ffd34d', weight: 2.5, opacity: 0.85, dashArray: '6 8', interactive: false,
  }).addTo(map);
}

export function centerOnPlayer() {
  suspendFollow = false;
  updateFollowBtn();
  const p = state.player;
  if (!p) return;
  if (p.region !== state.region) setRegion(p.region);
  else map.panTo(worldToLl(p.wx, p.wy), { animate: true });
}

function updateFollowBtn() {
  const b = document.getElementById('btnCenter');
  if (b) b.classList.toggle('attention', suspendFollow);
}

export function focusWorld(wx, wy, region, zoom = 0) {
  const go = () => map.setView(worldToLl(wx, wy, region || state.region), Math.max(map.getZoom(), zoom), { animate: true });
  if (region && region !== state.region) setRegion(region).then(go);
  else go();
  suspendFollow = true;
}

// ------------------------------------------------------------ Kontextmenü

function openContextMenu(e) {
  const menu = document.getElementById('ctxMenu');
  const w = llToWorld(e.latlng);
  const g = rm().worldToGame(w.wx, w.wy);
  menu.innerHTML = `
    <div class="ctx-coords mono">${fmtGame(g)}</div>
    <button data-act="wp">${svg('pin', 14)} Wegpunkt hier</button>
    <button data-act="nav">${svg('flag', 14)} Hierhin navigieren</button>
    <button data-act="measure">${svg('ruler', 14)} Von hier messen</button>
    <button data-act="manual">${svg('crosshair', 14)} Ich stehe hier (manuelle Position)</button>
    <button data-act="copy">${svg('copy', 14)} Koordinaten kopieren</button>`;
  menu.style.left = Math.min(e.containerPoint.x, window.innerWidth - 260) + 'px';
  menu.style.top = Math.min(e.containerPoint.y, window.innerHeight - 230) + 'px';
  menu.classList.add('open');
  menu.querySelector('[data-act="wp"]').onclick = () => { addWaypointAt(w.wx, w.wy); closeContextMenu(); };
  menu.querySelector('[data-act="nav"]').onclick = () => { navigateToPoint(w.wx, w.wy, state.region); closeContextMenu(); };
  menu.querySelector('[data-act="measure"]').onclick = () => { startMeasure(w); closeContextMenu(); };
  menu.querySelector('[data-act="manual"]').onclick = () => { emit('manualPos', { wx: w.wx, wy: w.wy, region: state.region }); closeContextMenu(); };
  menu.querySelector('[data-act="copy"]').onclick = () => {
    navigator.clipboard?.writeText(fmtGame(g));
    emit('toast', { icon: 'copy', msg: `Koordinaten ${fmtGame(g)} kopiert` });
    closeContextMenu();
  };
}

export function closeContextMenu() {
  document.getElementById('ctxMenu')?.classList.remove('open');
}

// ------------------------------------------------------------ Messen

export function startMeasure(startWorld = null) {
  clearMeasure();
  state.measure = { a: startWorld, b: null };
  emit('toast', { icon: 'ruler', msg: startWorld ? 'Zweiten Punkt anklicken' : 'Ersten Punkt anklicken' });
  emit('measure');
}

export function clearMeasure() {
  state.measure = null;
  if (measureLayer) { measureLayer.remove(); measureLayer = null; }
  emit('measure');
}

function measureClick(e) {
  const w = llToWorld(e.latlng);
  if (!state.measure.a) {
    state.measure.a = w;
    emit('toast', { icon: 'ruler', msg: 'Zweiten Punkt anklicken' });
    return;
  }
  state.measure.b = w;
  if (measureLayer) measureLayer.remove();
  const a = state.measure.a, b = state.measure.b;
  const d = distMeters({ wx: a.wx, wy: a.wy }, { wx: b.wx, wy: b.wy });
  const mid = { wx: (a.wx + b.wx) / 2, wy: (a.wy + b.wy) / 2 };
  measureLayer = L.layerGroup([
    L.polyline([worldToLl(a.wx, a.wy), worldToLl(b.wx, b.wy)], { color: '#5fe0a0', weight: 2, dashArray: '4 6' }),
    L.marker(worldToLl(mid.wx, mid.wy), {
      interactive: false,
      icon: L.divIcon({ className: 'measure-label-wrap', html: `<div class="measure-label">${fmtDist(d)}</div>`, iconSize: [90, 24], iconAnchor: [45, 12] }),
    }),
  ]).addTo(map);
  state.measure = { a: null, b: null, done: true };
  emit('measure');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
