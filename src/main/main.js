'use strict';
/**
 * PalPilot — Palworld Ingame-Map-Overlay
 *
 * Fenster-Modi:
 *   hidden — Overlay unsichtbar
 *   hud    — Click-Through-HUD (Minimap + Navigator) über dem Spiel
 *   map    — interaktive Vollbild-Karte (Maus/Tastatur aktiv)
 *
 * Standard-Hotkeys: F6 Karte, F7 HUD an/aus, F8 Schnell-Wegpunkt, F9 Navigation stoppen
 */
const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { JsonStore } = require('./store');
const { PositionEngine } = require('./position');
const { InventoryBridge } = require('./inventory');
const { trayIconPng } = require('./png');
const { detectPalworld, runSetup } = require('./setup');

const ROOT = path.join(__dirname, '..', '..');
const ARGS = new Set(process.argv.slice(1));
const IS_WINDOWED = ARGS.has('--windowed') || ARGS.has('--smoke');
const IS_MOCK = ARGS.has('--mock');
const IS_SMOKE = ARGS.has('--smoke');

const DEFAULT_SETTINGS = {
  hotkeys: {
    toggleMap: 'F6',
    toggleHud: 'F7',
    quickWaypoint: 'F8',
    stopNav: 'F9',
  },
  hud: {
    enabled: true,
    minimap: true,
    navBanner: true,
    corner: 'top-right',   // top-left | top-right | bottom-left | bottom-right
    size: 280,             // Minimap-Durchmesser px
    opacity: 0.95,
    zoom: 2.4,             // Minimap-Maßstab (Map-Pixel-Faktor)
    rotate: false,         // true: Karte dreht sich mit Blickrichtung
  },
  overlay: {
    dimBackground: 0.6,    // Abdunklung hinter der großen Karte (0..1)
  },
  position: {
    ue4ssFile: path.join(os.tmpdir(), 'pal_overlay_pos.json'),
    invFile: path.join(os.tmpdir(), 'pal_overlay_inv.json'),
    cmdFile: path.join(os.tmpdir(), 'pal_overlay_cmd.json'),
    rest: {
      enabled: false,
      host: '127.0.0.1',
      port: 8212,
      password: '',
      player: '',
      intervalMs: 2000,
    },
  },
  map: {
    region: 'palpagos',
    followPlayer: true,
    nav: { activeWaypointId: null, routeIds: [], autoAdvance: true },
    manualPos: null,       // { region, mx, my } — Fallback ohne Live-Quelle
  },
  game: {
    path: null,            // Palworld-Installationsordner (vom Setup gesetzt)
    setupDone: false,
  },
  firstRun: true,
};

let win = null;
let tray = null;
let mode = 'hud';
let settingsStore = null;
let waypointStore = null;
let engine = null;
let inventory = null;

// ---------------------------------------------------------------- Fenster

function overlayBounds() {
  return screen.getPrimaryDisplay().bounds;
}

function createWindow() {
  const common = {
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  };

  if (IS_WINDOWED) {
    win = new BrowserWindow({
      ...common,
      width: 1600,
      height: 920,
      minWidth: 1100,
      minHeight: 640,
      backgroundColor: '#070c14',
      title: 'PalPilot (Fenster-Modus)',
      autoHideMenuBar: true,
    });
  } else {
    const b = overlayBounds();
    win = new BrowserWindow({
      ...common,
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
    });
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    // Manche Spiele reißen den Fokus/Top-Status an sich — regelmäßig nachziehen.
    setInterval(() => {
      if (win && !win.isDestroyed() && win.isVisible()) {
        win.setAlwaysOnTop(true, 'screen-saver', 1);
      }
    }, 2000);
    screen.on('display-metrics-changed', () => {
      if (win && !win.isDestroyed()) win.setBounds(overlayBounds());
    });
  }

  const query = {};
  if (IS_MOCK) query.mock = '1';
  if (IS_WINDOWED) query.windowed = '1';
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'), { query });

  if (IS_SMOKE) {
    win.webContents.on('console-message', (e, _lvl, msg) => {
      console.log('[renderer]', e && typeof e === 'object' && 'message' in e ? e.message : msg);
    });
  }

  win.once('ready-to-show', () => {
    applyMode(IS_WINDOWED ? 'map' : 'hud');
  });

  win.on('closed', () => { win = null; });
}

function applyMode(next) {
  if (!win || win.isDestroyed()) return;
  mode = next;
  if (IS_WINDOWED) {
    // Im Fenster-Modus gibt es kein Click-Through — nur UI-Umschaltung.
    win.show();
    win.webContents.send('ui:mode', mode === 'hidden' ? 'hud' : mode);
    updateTray();
    return;
  }
  switch (mode) {
    case 'hidden':
      win.hide();
      break;
    case 'hud':
      win.setFocusable(false);
      win.setIgnoreMouseEvents(true, { forward: true });
      win.showInactive();
      break;
    case 'map':
      win.setFocusable(true);
      win.setIgnoreMouseEvents(false);
      win.show();
      win.focus();
      break;
  }
  win.webContents.send('ui:mode', mode);
  updateTray();
}

// ---------------------------------------------------------------- Hotkeys

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = settingsStore.data.hotkeys || {};
  const tryReg = (acc, fn, label) => {
    if (!acc) return;
    try {
      if (!globalShortcut.register(acc, fn)) {
        console.warn(`[hotkey] ${label} (${acc}) konnte nicht registriert werden (belegt?)`);
      }
    } catch (e) {
      console.warn(`[hotkey] ${label} (${acc}) ungültig:`, e.message);
    }
  };
  tryReg(hk.toggleMap, () => applyMode(mode === 'map' ? 'hud' : 'map'), 'Karte');
  tryReg(hk.toggleHud, () => applyMode(mode === 'hidden' ? 'hud' : 'hidden'), 'HUD');
  tryReg(hk.quickWaypoint, () => win && win.webContents.send('ui:hotkey', 'quick-waypoint'), 'Schnell-Wegpunkt');
  tryReg(hk.stopNav, () => win && win.webContents.send('ui:hotkey', 'stop-nav'), 'Navigation stoppen');
}

// ---------------------------------------------------------------- Tray

function updateTray() {
  if (!tray) return;
  const hk = settingsStore.data.hotkeys || {};
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'PalPilot — Palworld Overlay', enabled: false },
    { type: 'separator' },
    { label: `Karte öffnen/schließen\t${hk.toggleMap || ''}`, click: () => applyMode(mode === 'map' ? 'hud' : 'map') },
    { label: `HUD ein/aus\t${hk.toggleHud || ''}`, click: () => applyMode(mode === 'hidden' ? 'hud' : 'hidden') },
    { type: 'separator' },
    { label: 'Einstellungen…', click: () => { applyMode('map'); win && win.webContents.send('ui:hotkey', 'open-settings'); } },
    { label: 'Daten-Ordner öffnen', click: () => shell.openPath(path.join(ROOT, 'data')) },
    { label: 'Overlay neu laden', click: () => win && win.reload() },
    { type: 'separator' },
    { label: 'Beenden', click: () => app.quit() },
  ]));
  tray.setToolTip(`PalPilot — Modus: ${mode}`);
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromBuffer(trayIconPng()));
    tray.on('double-click', () => applyMode(mode === 'map' ? 'hud' : 'map'));
    updateTray();
  } catch (e) {
    console.warn('[tray]', e.message);
  }
}

// ---------------------------------------------------------------- IPC

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function setupIpc() {
  ipcMain.handle('state:get', () => ({
    settings: settingsStore.data,
    waypoints: waypointStore.data.list,
    mode,
    version: app.getVersion(),
    flags: { windowed: IS_WINDOWED, mock: IS_MOCK },
    paths: {
      root: ROOT,
      userData: app.getPath('userData'),
      ue4ssFile: settingsStore.data.position.ue4ssFile,
    },
  }));

  ipcMain.handle('data:get', () => ({
    regions: readJsonSafe(path.join(ROOT, 'data', 'regions.json')),
    pals: readJsonSafe(path.join(ROOT, 'data', 'pals.json')),
    markers: readJsonSafe(path.join(ROOT, 'data', 'markers.json')),
    spawns: readJsonSafe(path.join(ROOT, 'data', 'spawns.json')),
    items: readJsonSafe(path.join(ROOT, 'data', 'items.json')),
    meta: readJsonSafe(path.join(ROOT, 'data', 'meta.json')),
  }));

  ipcMain.handle('asset:url', (_e, rel) => {
    const abs = path.resolve(ROOT, String(rel || ''));
    if (!abs.startsWith(ROOT)) return null;
    return fs.existsSync(abs) ? pathToFileURL(abs).href : null;
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    const before = JSON.stringify(settingsStore.data.position) + JSON.stringify(settingsStore.data.hotkeys);
    const next = settingsStore.patch(patch);
    const after = JSON.stringify(next.position) + JSON.stringify(next.hotkeys);
    if (before !== after) {
      registerHotkeys();
      engine.restart();
    }
    if (win && !win.isDestroyed()) win.webContents.send('settings:changed', next);
    updateTray();
    return next;
  });

  ipcMain.handle('waypoints:set', (_e, list) => {
    waypointStore.set({ list: Array.isArray(list) ? list : [] });
    return true;
  });

  ipcMain.handle('mode:set', (_e, m) => {
    if (['hidden', 'hud', 'map'].includes(m)) applyMode(m);
    return mode;
  });

  // --- Automatisches Spiel-Setup ---
  ipcMain.handle('setup:detect', async () => {
    try { return await detectPalworld(); } catch { return []; }
  });
  ipcMain.handle('setup:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Palworld-Installationsordner wählen',
      properties: ['openDirectory'],
      message: 'Den Ordner wählen, der "Pal" und "Palworld.exe" enthält',
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('setup:run', async (_e, gamePath) => {
    const prog = (step, status, msg) => {
      if (win && !win.isDestroyed()) win.webContents.send('setup:progress', { step, status, msg });
    };
    let result;
    try {
      result = await runSetup(ROOT, gamePath, prog);
    } catch (e) {
      prog('validate', 'err', 'Unerwarteter Fehler: ' + e.message);
      result = { ok: false };
    }
    if (result.ok) {
      const next = settingsStore.patch({ game: { path: gamePath, setupDone: true } });
      if (win && !win.isDestroyed()) win.webContents.send('settings:changed', next);
    }
    return result;
  });

  // --- Admin-Inventar (nur lokaler Spieler) ---
  ipcMain.handle('inv:command', (_e, cmds) => inventory.sendCommands(cmds));

  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:devtools', () => win && win.webContents.toggleDevTools());
  ipcMain.handle('app:openPath', (_e, which) => {
    const map = {
      data: path.join(ROOT, 'data'),
      assets: path.join(ROOT, 'assets'),
      userData: app.getPath('userData'),
      ue4ss: path.dirname(settingsStore.data.position.ue4ssFile || os.tmpdir()),
    };
    if (map[which]) shell.openPath(map[which]);
  });
}

// ---------------------------------------------------------------- Start

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => applyMode('map'));

  app.whenReady().then(() => {
    app.setAppUserModelId('palpilot.overlay');

    settingsStore = new JsonStore(path.join(app.getPath('userData'), 'settings.json'), DEFAULT_SETTINGS);
    waypointStore = new JsonStore(path.join(app.getPath('userData'), 'waypoints.json'), { list: [] });
    settingsStore.load();
    waypointStore.load();

    engine = new PositionEngine(() => settingsStore.data.position);
    engine.on('position', (p) => { if (win && !win.isDestroyed()) win.webContents.send('pos:update', p); });
    engine.on('status', (s) => { if (win && !win.isDestroyed()) win.webContents.send('pos:status', s); });
    engine.start();

    inventory = new InventoryBridge(() => settingsStore.data.position);
    inventory.on('inventory', (inv) => { if (win && !win.isDestroyed()) win.webContents.send('inv:update', inv); });
    inventory.on('status', (s) => { if (win && !win.isDestroyed()) win.webContents.send('inv:status', s); });
    inventory.start();

    setupIpc();
    createWindow();
    createTray();
    if (!IS_WINDOWED) registerHotkeys();

    if (IS_SMOKE) {
      setTimeout(() => {
        console.log('[SMOKE] Fenster erstellt, Renderer geladen — OK');
        app.quit();
      }, 6000);
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (engine) engine.stop();
    if (inventory) inventory.stop();
    if (settingsStore) settingsStore.saveNow();
    if (waypointStore) waypointStore.saveNow();
  });

  app.on('window-all-closed', () => app.quit());
}
