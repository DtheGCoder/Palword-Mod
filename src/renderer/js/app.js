/**
 * Bootstrap: Bridge → Daten → Karte/HUD/Panels → Live-Events.
 */
import { createBridge } from './bridge.js';
import { state, on, emit, patchSettings } from './state.js';
import { RegionMath, regionForWorld, yawToBearing, smoothAngle, bearingWorld, distMeters } from './transform.js';
import { initMap, getMap, setRegion, closeContextMenu, clearMeasure } from './mapview.js';
import { initHud } from './hud.js';
import { initPanels, toggleSettings } from './panels.js';
import { initNavMenu } from './navmenu.js';
import { initNav, quickWaypointAtPlayer, stopNav } from './nav.js';
import { initSetup, openSetup, closeSetup, isSetupOpen } from './setup.js';
import { initAdmin, isAdminOpen, closeAdmin } from './admin.js';

let lastLive = null;
let lastPlayerRegion = null;
let loggedFirstPos = false;

async function main() {
  const bridge = await createBridge();
  state.bridge = bridge;

  const st = await bridge.getState();
  state.settings = st.settings;
  state.waypoints = st.waypoints || [];
  state.version = st.version;
  state.windowed = !!st.flags?.windowed;
  state.mock = !!st.flags?.mock || new URLSearchParams(location.search).has('mock');
  state.completed = st.settings.map?.completed || {};
  const root = st.paths?.root;
  state.assetBase = root ? 'file:///' + String(root).replace(/\\/g, '/').replace(/\/$/, '') + '/' : '../../';
  document.body.classList.toggle('windowed', state.windowed);
  document.body.style.setProperty('--dim', st.settings.overlay?.dimBackground ?? 0.6);

  const data = await bridge.getData();
  state.data = {
    regions: data.regions || {},
    pals: data.pals || [],
    markers: data.markers || {},
    spawns: data.spawns || null,
    items: data.items || [],
    meta: data.meta || null,
  };
  for (const [id, cfg] of Object.entries(state.data.regions)) {
    state.math[id] = new RegionMath(cfg);
  }
  state.region = state.data.regions[st.settings.map?.region] ? st.settings.map.region : Object.keys(state.data.regions)[0] || 'palpagos';

  applyMode(st.mode || 'map');
  initNav();
  await initMap();
  window.__ppMap = getMap();
  initHud();
  initPanels();
  initNavMenu();
  initSetup();
  initAdmin();
  emit('dataLoaded');

  // Region-Wahl persistieren
  on('regionChanged', (id) => {
    if (state.settings.map.region !== id) patchSettings({ map: { region: id } });
  });

  // Live-Events vom Main-Prozess (oder Mock)
  bridge.onMode((m) => applyMode(m));
  bridge.onSettings((s) => { state.settings = s; emit('settings'); });
  bridge.onHotkey((k) => handleHotkey(k));
  bridge.onStatus((s) => { state.posStatus = s; emit('posStatus'); });
  bridge.onPosition((d) => handlePosition(d));
  on('manualPos', (p) => setManualPosition(p));

  // Manuelle Position aus letzter Sitzung wiederherstellen (bis Live-Daten kommen)
  if (st.settings.map?.manualPos && !state.player) {
    setManualPosition(st.settings.map.manualPos, true);
  }

  // Tastatur im Kartenmodus
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const gate = document.getElementById('adminGate');
      if (gate?.classList.contains('open')) { gate.classList.remove('open'); return; }
      if (isAdminOpen()) { closeAdmin(); return; }
      if (isSetupOpen()) { closeSetup(); return; }
      const modal = document.getElementById('settingsModal');
      if (modal?.classList.contains('open')) { toggleSettings(false); return; }
      if (state.measure) { clearMeasure(); return; }
      closeContextMenu();
      if (!state.windowed && state.mode === 'map') bridge.setMode('hud');
    }
  });

  // Watchdog: Position als veraltet markieren, wenn 6s nichts kommt
  setInterval(() => {
    if (state.player && state.player.source !== 'manual' && state.player.fresh && Date.now() - state.player.at > 6000) {
      state.player.fresh = false;
      emit('player');
      emit('posStatus');
    }
  }, 1500);

  // Debug-Handle (Konsole): window.__pp.state, __pp.api.…
  const mapApi = await import('./mapview.js');
  const navApi = await import('./nav.js');
  const panelApi = await import('./panels.js');
  window.__pp = {
    state, emit,
    api: {
      addWaypointAt: mapApi.addWaypointAt,
      setRegion: mapApi.setRegion,
      focusWorld: mapApi.focusWorld,
      centerOnPlayer: mapApi.centerOnPlayer,
      navigateToWaypoint: navApi.navigateToWaypoint,
      navigateToPoint: navApi.navigateToPoint,
      stopNav: navApi.stopNav,
      quickWaypointAtPlayer: navApi.quickWaypointAtPlayer,
      togglePalSpawn: panelApi.togglePalSpawn,
      openSetup,
    },
  };
  if (new URLSearchParams(location.search).has('still')) {
    const s = document.createElement('style');
    s.textContent = '*{animation:none!important;transition:none!important}';
    document.head.appendChild(s);
  }

  console.log('[PalPilot] bereit —', state.mock ? 'Mock-Modus' : 'Live-Modus');
}

function applyMode(m) {
  state.mode = m;
  document.body.classList.remove('mode-map', 'mode-hud', 'mode-hidden');
  document.body.classList.add('mode-' + m);
  if (m === 'map') setTimeout(() => getMap()?.invalidateSize(), 60);
  emit('mode');
}

function handleHotkey(k) {
  if (k === 'quick-waypoint') quickWaypointAtPlayer();
  else if (k === 'stop-nav') stopNav();
  else if (k === 'open-settings') toggleSettings(true);
}

function handlePosition(d) {
  if (typeof d.wx !== 'number' || typeof d.wy !== 'number') return;
  const region = regionForWorld(state.math, d.wx, d.wy);
  if (!loggedFirstPos) {
    loggedFirstPos = true;
    const g = state.math[region]?.worldToGame(d.wx, d.wy);
    console.log(`[PalPilot] erste Live-Position: Quelle=${d.source} Region=${region} Ingame=(${Math.round(g?.gx)}, ${Math.round(g?.gy)})`);
  }
  let heading = state.player?.headingDeg ?? null;
  let speed = state.player?.speedMps ?? 0;

  if (d.yaw != null) {
    heading = smoothAngle(heading, yawToBearing(d.yaw), 0.55);
  }
  if (lastLive) {
    const dt = (d.at - lastLive.at) / 1000;
    if (dt > 0.02 && dt < 10) {
      const dist = distMeters(d, lastLive);
      speed = speed * 0.65 + (dist / dt) * 0.35;
      if (d.yaw == null && dist > 1.2) {
        heading = smoothAngle(heading, bearingWorld(lastLive, d), 0.45);
      }
    }
  }
  lastLive = { wx: d.wx, wy: d.wy, at: d.at };

  state.player = {
    region,
    wx: d.wx, wy: d.wy, wz: d.wz || 0,
    headingDeg: heading ?? 0,
    speedMps: speed,
    source: d.source,
    level: d.level || null,
    at: d.at || Date.now(),
    fresh: true,
  };

  const lastT = state.trail[state.trail.length - 1];
  if (!lastT || lastT.region !== region || distMeters(lastT, state.player) > 5 || state.player.at - lastT.at > 2500) {
    state.trail.push({ wx: d.wx, wy: d.wy, at: state.player.at, region });
    if (state.trail.length > 700) state.trail.splice(0, 150);
  }

  // Nur wenn der SPIELER die Region wechselt (Weltenbaum-Portal etc.) die
  // Karte mitnehmen — manuelles Stöbern in der anderen Region bleibt möglich.
  if (region !== lastPlayerRegion) {
    const isTransition = lastPlayerRegion !== null;
    lastPlayerRegion = region;
    if (isTransition && region !== state.region && state.settings.map?.followPlayer && state.mode !== 'hidden') {
      setRegion(region);
      emit('toast', { icon: 'compass', msg: `Region gewechselt: ${state.data.regions[region]?.title || region}` });
    }
  }
  emit('player');
}

function setManualPosition(p, silent = false) {
  const region = p.region || regionForWorld(state.math, p.wx, p.wy);
  state.player = {
    region,
    wx: p.wx, wy: p.wy, wz: 0,
    headingDeg: state.player?.headingDeg ?? 0,
    speedMps: 0,
    source: 'manual',
    at: Date.now(),
    fresh: false,
  };
  patchSettings({ map: { manualPos: { wx: p.wx, wy: p.wy, region } } });
  if (!silent) emit('toast', { icon: 'crosshair', msg: 'Manuelle Position gesetzt' });
  emit('player');
  emit('posStatus');
}

main().catch((e) => {
  console.error('[PalPilot] Startfehler:', e);
  document.body.innerHTML = `<div style="color:#ff8a9a;font:14px 'Segoe UI';padding:40px">
    <h2>PalPilot konnte nicht starten</h2><pre>${String(e?.stack || e)}</pre></div>`;
});
