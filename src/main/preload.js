'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('palOverlay', {
  // Zustand & Daten
  getState: () => ipcRenderer.invoke('state:get'),
  getData: () => ipcRenderer.invoke('data:get'),
  assetUrl: (rel) => ipcRenderer.invoke('asset:url', rel),

  // Einstellungen & Wegpunkte
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setWaypoints: (list) => ipcRenderer.invoke('waypoints:set', list),

  // Fenster-Modus
  setMode: (mode) => ipcRenderer.invoke('mode:set', mode),

  // Admin-Inventar
  invCommand: (cmds) => ipcRenderer.invoke('inv:command', cmds),
  onInventory: (cb) => ipcRenderer.on('inv:update', (_e, d) => cb(d)),
  onInvStatus: (cb) => ipcRenderer.on('inv:status', (_e, d) => cb(d)),

  // Spiel-Setup
  setupDetect: () => ipcRenderer.invoke('setup:detect'),
  setupPick: () => ipcRenderer.invoke('setup:pick'),
  setupRun: (gamePath) => ipcRenderer.invoke('setup:run', gamePath),
  onSetupProgress: (cb) => ipcRenderer.on('setup:progress', (_e, d) => cb(d)),

  // App
  quit: () => ipcRenderer.invoke('app:quit'),
  openPath: (which) => ipcRenderer.invoke('app:openPath', which),
  toggleDevTools: () => ipcRenderer.invoke('app:devtools'),

  // Events vom Main-Prozess
  onPosition: (cb) => ipcRenderer.on('pos:update', (_e, d) => cb(d)),
  onStatus: (cb) => ipcRenderer.on('pos:status', (_e, d) => cb(d)),
  onMode: (cb) => ipcRenderer.on('ui:mode', (_e, m) => cb(m)),
  onHotkey: (cb) => ipcRenderer.on('ui:hotkey', (_e, k) => cb(k)),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
});
