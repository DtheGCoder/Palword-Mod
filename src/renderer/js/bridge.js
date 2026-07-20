/**
 * Bridge zum Main-Prozess. Läuft der Renderer ohne Electron (Dev-Server im
 * Browser), springt ein Mock ein: simulierter Spieler, localStorage-Persistenz,
 * F6–F9 als normale Tastatur-Events.
 */
import { RegionMath, bearingWorld } from './transform.js';

const MOCK_SETTINGS = {
  hotkeys: { toggleMap: 'F6', toggleHud: 'F7', quickWaypoint: 'F8', stopNav: 'F9' },
  hud: { enabled: true, minimap: true, navBanner: true, corner: 'top-right', size: 280, opacity: 0.95, zoom: 2.4, rotate: false },
  overlay: { dimBackground: 0.6 },
  position: {
    ue4ssFile: 'C:\\Users\\…\\Temp\\pal_overlay_pos.json',
    rest: { enabled: false, host: '127.0.0.1', port: 8212, password: '', player: '', intervalMs: 2000 },
  },
  map: {
    region: 'palpagos',
    followPlayer: true,
    nav: { activeWaypointId: null, routeIds: [], autoAdvance: true },
    manualPos: null,
  },
  firstRun: true,
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])
      ? deepMerge(out[k], v) : v;
  }
  return out;
}

export async function createBridge() {
  if (window.palOverlay) {
    const b = window.palOverlay;
    const urlCache = new Map();
    return {
      real: true,
      getState: () => b.getState(),
      getData: () => b.getData(),
      assetUrl: async (rel) => {
        if (!urlCache.has(rel)) urlCache.set(rel, await b.assetUrl(rel));
        return urlCache.get(rel);
      },
      setSettings: (p) => b.setSettings(p),
      setWaypoints: (l) => b.setWaypoints(JSON.parse(JSON.stringify(l))),
      setMode: (m) => b.setMode(m),
      quit: () => b.quit(),
      openPath: (w) => b.openPath(w),
      toggleDevTools: () => b.toggleDevTools(),
      setupDetect: () => b.setupDetect(),
      setupPick: () => b.setupPick(),
      setupRun: (p) => b.setupRun(p),
      onSetupProgress: (cb) => b.onSetupProgress(cb),
      invCommand: (cmds) => b.invCommand(cmds),
      onInventory: (cb) => b.onInventory(cb),
      onInvStatus: (cb) => b.onInvStatus(cb),
      onPosition: (cb) => b.onPosition(cb),
      onStatus: (cb) => b.onStatus(cb),
      onMode: (cb) => b.onMode(cb),
      onHotkey: (cb) => b.onHotkey(cb),
      onSettings: (cb) => b.onSettings(cb),
    };
  }
  return createMock();
}

// ------------------------------------------------------------------ Mock

function createMock() {
  const L = { pos: [], status: [], mode: [], hotkey: [], settings: [], inv: [], invstatus: [] };
  const last = {};
  const fire = (kind, payload) => { last[kind] = payload; L[kind].forEach((cb) => cb(payload)); };

  // Demo-Inventar (simuliert das, was die UE4SS-Mod aus dem Spiel liefern würde)
  const INV_SIZE = 42;
  let mockSeq = 0;
  let mockInvStarted = true;
  const mockInv = {
    player: 'Demo-Spieler',
    slots: [
      { slot: 0, id: 'PalSphere', count: 20 },
      { slot: 1, id: 'Wood', count: 350 },
      { slot: 2, id: 'Stone', count: 480 },
      { slot: 3, id: 'Fiber', count: 66 },
      { slot: 4, id: 'Ingot', count: 128 },
      { slot: 5, id: 'Bullet', count: 240 },
      { slot: 8, id: 'MegaSphere', count: 5 },
    ],
  };
  const firstFreeSlot = () => {
    const used = new Set(mockInv.slots.map((s) => s.slot));
    for (let i = 0; i < INV_SIZE; i++) if (!used.has(i)) return i;
    return null;
  };
  const invSnapshot = () => ({
    player: mockInv.player,
    size: INV_SIZE,
    slots: mockInv.slots.map((s) => ({ ...s })),
    at: Date.now(),
  });
  const emitInv = () => { last.inv = invSnapshot(); L.inv.forEach((cb) => cb(last.inv)); };

  let settings = deepMerge(MOCK_SETTINGS, readLs('palpilot.settings'));
  let waypoints = readLs('palpilot.waypoints') || [];
  let mode = 'map';
  let simStarted = false;

  function readLs(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function writeLs(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* egal */ }
  }

  // Simulierter Spieler: läuft Ziele im Startgebiet ab.
  function startSim(regions) {
    if (simStarted || !regions || !regions.palpagos) return;
    simStarted = true;
    const rm = new RegionMath(regions.palpagos);
    let pos = rm.gameToWorld(180, -390);       // Nähe Startplateau
    let yaw = 0;
    if (new URLSearchParams(location.search).has('still')) {
      // Standbild für Screenshots/Debugging: eine Position, keine Bewegung
      fire('status', { ue4ss: 'ok', rest: 'off', active: 'ue4ss' });
      setTimeout(() => fire('pos', { source: 'ue4ss', wx: pos.wx, wy: pos.wy, wz: 0, yaw: 40, level: 'MainWorld5', at: Date.now() }), 300);
      return;
    }
    let target = null;
    let pauseUntil = 0;

    const pickTarget = () => {
      const g = { gx: -250 + Math.random() * 700, gy: -560 + Math.random() * 700 };
      target = rm.gameToWorld(g.gx, g.gy);
    };
    pickTarget();

    fire('status', { ue4ss: 'ok', rest: 'off', active: 'ue4ss' });

    setInterval(() => {
      const now = Date.now();
      if (now < pauseUntil) {
        fire('pos', { source: 'ue4ss', wx: pos.wx, wy: pos.wy, wz: 0, yaw, level: 'MainWorld5', at: now });
        return;
      }
      const dist = Math.hypot(target.wx - pos.wx, target.wy - pos.wy);
      if (dist < 800) { pickTarget(); pauseUntil = now + 1200 + Math.random() * 1800; return; }
      const want = bearingWorld({ wx: pos.wx, wy: pos.wy }, { wx: target.wx, wy: target.wy });
      const delta = ((want - yaw + 540) % 360) - 180;
      yaw = (yaw + Math.max(-14, Math.min(14, delta)) + 360) % 360;
      const speed = 1050; // cm/s ~ Reittier
      const step = speed * 0.125;
      const r = (yaw * Math.PI) / 180;
      pos = { wx: pos.wx + Math.cos(r) * step, wy: pos.wy + Math.sin(r) * step };
      fire('pos', { source: 'ue4ss', wx: pos.wx, wy: pos.wy, wz: 0, yaw: yaw + Math.sin(now / 900) * 4, level: 'MainWorld5', at: now });
    }, 125);
  }

  // Hotkeys als normale Tasten im Browser
  window.addEventListener('keydown', (e) => {
    const map = { F6: 'toggle-map', F7: 'toggle-hud', F8: 'quick-waypoint', F9: 'stop-nav' };
    if (!map[e.key]) return;
    e.preventDefault();
    if (e.key === 'F6') { mode = mode === 'map' ? 'hud' : 'map'; fire('mode', mode); }
    else if (e.key === 'F7') { mode = mode === 'hidden' ? 'hud' : 'hidden'; fire('mode', mode); }
    else fire('hotkey', map[e.key]);
  });

  return {
    real: false,
    getState: async () => ({
      settings, waypoints, mode,
      version: 'dev-mock',
      flags: { windowed: true, mock: true },
      paths: { root: '', userData: '(Browser-Mock)', ue4ssFile: settings.position.ue4ssFile },
    }),
    getData: async () => {
      const load = (f) => fetch(`../../data/${f}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const [regions, pals, markers, spawns, items, meta] = await Promise.all(
        ['regions', 'pals', 'markers', 'spawns', 'items', 'meta'].map(load));
      startSim(regions);
      return { regions, pals, markers, spawns, items, meta };
    },
    assetUrl: async (rel) => '../../' + rel,
    setSettings: async (p) => { settings = deepMerge(settings, p); writeLs('palpilot.settings', settings); L.settings.forEach((cb) => cb(settings)); return settings; },
    setWaypoints: async (l) => { waypoints = l; writeLs('palpilot.waypoints', l); return true; },
    setMode: async (m) => { mode = m; fire('mode', m); return m; },
    quit: async () => console.log('[mock] quit'),
    openPath: async (w) => console.log('[mock] openPath', w),
    toggleDevTools: async () => {},
    // Setup-Simulation für die Demo
    setupDetect: async () => ['D:\\SteamLibrary\\steamapps\\common\\Palworld (Demo)'],
    setupPick: async () => 'D:\\SteamLibrary\\steamapps\\common\\Palworld (Demo)',
    setupRun: async (p) => {
      const steps = [
        ['validate', 'run', 'Prüfe Spielordner…', 350],
        ['validate', 'ok', `Spiel gefunden: ${p}\\Pal\\Binaries\\Win64`, 500],
        ['ue4ss', 'run', 'Lade UE4SS-Palworld.zip (6,9 MB)…', 1400],
        ['ue4ss', 'ok', 'UE4SS installiert (experimental-palworld).', 400],
        ['mod', 'run', 'Kopiere PalOverlayTracker-Mod…', 500],
        ['mod', 'ok', 'Mod installiert.', 300],
        ['modstxt', 'ok', 'In mods.txt eingetragen.', 300],
        ['ini', 'ok', 'Fenstermodus auf „Vollbild (Fenster)" gestellt.', 200],
      ];
      for (const [step, status, msg, wait] of steps) {
        L.setup?.forEach((cb) => cb({ step, status, msg }));
        await new Promise((r) => setTimeout(r, wait));
      }
      settings = deepMerge(settings, { game: { path: p, setupDone: true } });
      writeLs('palpilot.settings', settings);
      L.settings.forEach((cb) => cb(settings));
      return { ok: true, gamePath: p, warnings: 0 };
    },
    onSetupProgress: (cb) => { (L.setup ??= []).push(cb); },

    // --- Mock-Inventar (Demo): simuliert die UE4SS-Inventar-Bridge ---
    invCommand: async (cmds) => {
      const list = Array.isArray(cmds) ? cmds : [cmds];
      for (const c of list) {
        const ex = mockInv.slots.find((s) => s.id === c.id);
        if (c.op === 'add') {
          if (ex) ex.count += c.count;
          else { const f = firstFreeSlot(); if (f != null) mockInv.slots.push({ slot: f, id: c.id, count: c.count }); }
        } else if (c.op === 'set') {
          if (ex) { ex.count = c.count; if (ex.count <= 0) mockInv.slots = mockInv.slots.filter((x) => x !== ex); }
          else if (c.count > 0) { const f = firstFreeSlot(); if (f != null) mockInv.slots.push({ slot: f, id: c.id, count: c.count }); }
        } else if (c.op === 'remove') {
          mockInv.slots = mockInv.slots.filter((x) => x.id !== c.id);
        }
      }
      setTimeout(emitInv, 180); // simuliert Spiel→Datei→Overlay-Latenz
      return { ok: true, seq: ++mockSeq };
    },
    onInventory: (cb) => { L.inv.push(cb); if (mockInvStarted) cb(invSnapshot()); },
    onInvStatus: (cb) => { L.invstatus.push(cb); cb({ inv: 'ok' }); },
    onPosition: (cb) => { L.pos.push(cb); if (last.pos) cb(last.pos); },
    onStatus: (cb) => { L.status.push(cb); if (last.status) cb(last.status); },
    onMode: (cb) => L.mode.push(cb),
    onHotkey: (cb) => L.hotkey.push(cb),
    onSettings: (cb) => L.settings.push(cb),
  };
}
