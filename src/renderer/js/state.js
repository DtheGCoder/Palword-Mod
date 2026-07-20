/**
 * Zentraler App-Zustand + Mini-Eventbus.
 */
export const state = {
  bridge: null,
  mode: 'map',              // hidden | hud | map
  windowed: false,
  mock: false,
  settings: null,
  waypoints: [],
  data: { regions: null, pals: [], markers: {}, spawns: {} },
  math: {},                 // regionId → RegionMath
  region: 'palpagos',       // aktuell angezeigte Region
  player: null,             // { region, gx, gy, headingDeg, source, at, fresh }
  trail: [],                // [{gx,gy,at,region}]
  posStatus: { ue4ss: 'off', rest: 'off', active: null },
  filters: {
    cats: new Set(['fasttravel', 'towers', 'bosses']),
    pals: new Map(),        // palId → farbindex
  },
  completed: {},            // markerId → true (Bosse/Türme abgehakt)
  measure: null,            // { a:{gx,gy}, b:{gx,gy}|null }
  ui: { search: '', ctxOpen: false, settingsOpen: false, leftTab: 'layers' },
};

const listeners = new Map();

export function on(evt, cb) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(cb);
  return () => listeners.get(evt).delete(cb);
}

export function emit(evt, payload) {
  const set = listeners.get(evt);
  if (set) for (const cb of [...set]) {
    try { cb(payload); } catch (e) { console.error(`[state] Listener-Fehler bei "${evt}":`, e); }
  }
}

/** Wegpunkte persistieren (debounced durch Main-Store). */
export function saveWaypoints() {
  state.bridge.setWaypoints(state.waypoints);
  emit('waypoints');
}

export function patchSettings(patch) {
  state.bridge.setSettings(patch).then((next) => {
    if (next) state.settings = next;
    emit('settings');
  });
  // lokal sofort anwenden für flüssiges UI
  deepApply(state.settings, patch);
  emit('settings');
}

function deepApply(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepApply(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

let wpSeq = 0;
export function newWaypointId() {
  return 'wp_' + Date.now().toString(36) + '_' + (wpSeq++).toString(36);
}

/** Synchroner Asset-URL (funktioniert in Electron via file:// und im Browser-Mock). */
export function asset(rel) {
  if (!rel) return '';
  return (state.assetBase || '../../') + rel;
}
