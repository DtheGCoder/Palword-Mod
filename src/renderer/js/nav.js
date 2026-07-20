/**
 * Navigations-Logik: aktives Ziel, Routen, Distanz/Peilung/ETA, Ankunft.
 */
import { state, on, emit, saveWaypoints, newWaypointId, patchSettings } from './state.js';
import { distMeters, bearingWorld, angleDelta } from './transform.js';
import { SPAWN_COLORS } from './icons.js';

const ARRIVE_M = 28;
let lastArrivedId = null;

export function initNav() {
  on('player', recompute);
  on('waypoints', recompute);
  on('settings', recompute);
}

export function navState() {
  return state.settings.map.nav;
}

export function activeWaypoint() {
  const id = navState().activeWaypointId;
  return id ? state.waypoints.find((w) => w.id === id) || null : null;
}

export function navigateToWaypoint(id) {
  lastArrivedId = null;
  patchSettings({ map: { nav: { activeWaypointId: id, routeIds: navState().routeIds } } });
  emit('toast', { icon: 'flag', msg: 'Navigation gestartet' });
}

/** Direktes "Gehe zu Punkt" — legt einen temporären Zielmarker an. */
export function navigateToPoint(wx, wy, region, name = 'Ziel') {
  // alten Temp-Marker entfernen
  state.waypoints = state.waypoints.filter((w) => !w.temp);
  const wp = {
    id: newWaypointId(), name, wx, wy, region,
    color: '#46c8ff', temp: true, createdAt: Date.now(),
  };
  state.waypoints.push(wp);
  saveWaypoints();
  navigateToWaypoint(wp.id);
}

export function stopNav(silent = false) {
  const hadTemp = state.waypoints.some((w) => w.temp);
  if (hadTemp) {
    state.waypoints = state.waypoints.filter((w) => !w.temp);
    saveWaypoints();
  }
  patchSettings({ map: { nav: { activeWaypointId: null, routeIds: [] } } });
  state.navInfo = null;
  if (!silent) emit('toast', { icon: 'stop', msg: 'Navigation beendet' });
  emit('nav');
}

/** Route = geordnete Wegpunkt-Kette. */
export function startRoute(ids) {
  if (!ids || !ids.length) return;
  lastArrivedId = null;
  patchSettings({ map: { nav: { activeWaypointId: ids[0], routeIds: ids } } });
  emit('toast', { icon: 'route', msg: `Route mit ${ids.length} Stationen gestartet` });
}

export function quickWaypointAtPlayer() {
  const p = state.player;
  if (!p) {
    emit('toast', { icon: 'warn', msg: 'Keine Spielerposition bekannt' });
    return;
  }
  const n = state.waypoints.filter((w) => !w.temp).length + 1;
  const t = new Date();
  const wp = {
    id: newWaypointId(),
    name: `Wegpunkt ${n} (${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')})`,
    wx: p.wx, wy: p.wy, region: p.region,
    color: SPAWN_COLORS[(n - 1) % SPAWN_COLORS.length],
    createdAt: Date.now(),
  };
  state.waypoints.push(wp);
  saveWaypoints();
  emit('toast', { icon: 'pin', msg: `${wp.name} gesetzt` });
}

export function deleteWaypoint(id) {
  if (navState().activeWaypointId === id) stopNav(true);
  state.waypoints = state.waypoints.filter((w) => w.id !== id);
  const routeIds = navState().routeIds.filter((r) => r !== id);
  patchSettings({ map: { nav: { routeIds } } });
  saveWaypoints();
}

function recompute() {
  const wp = activeWaypoint();
  const p = state.player;
  if (!wp || !p) {
    if (state.navInfo) { state.navInfo = null; emit('nav'); }
    return;
  }
  const sameRegion = !wp.region || wp.region === p.region;
  const dist = distMeters(p, wp);
  const bearing = bearingWorld(p, wp);
  const rel = angleDelta(p.headingDeg ?? bearing, bearing);
  // ETA über die ANNÄHERUNGSGESCHWINDIGKEIT: die Bewegungsgeschwindigkeit auf
  // die Richtung zum Ziel projiziert (v · cos(Winkel Blick↔Ziel)). Läuft man vom
  // Ziel weg, ist sie ≤ 0 → keine sinnvolle Ankunftszeit (statt fälschlich zu
  // sinken). Leicht geglättet gegen Zittern.
  const speedMag = Math.max(0, p.speedMps || 0);
  const closing = speedMag * Math.cos(((rel || 0) * Math.PI) / 180);
  const prevClosing = state.navInfo && state.navInfo.wp && state.navInfo.wp.id === wp.id
    ? (state.navInfo._closing ?? closing) : closing;
  const closingS = prevClosing * 0.7 + closing * 0.3;
  const etaS = closingS > 0.5 ? dist / closingS : Infinity;
  state.navInfo = { wp, dist, bearing, rel, etaS, sameRegion, _closing: closingS };

  if (sameRegion && dist < ARRIVE_M && lastArrivedId !== wp.id) {
    lastArrivedId = wp.id;
    const route = navState().routeIds;
    const idx = route.indexOf(wp.id);
    if (idx >= 0 && idx < route.length - 1 && navState().autoAdvance) {
      patchSettings({ map: { nav: { activeWaypointId: route[idx + 1] } } });
      emit('toast', { icon: 'check', msg: `„${wp.name}" erreicht — weiter zur nächsten Station` });
    } else {
      emit('toast', { icon: 'check', msg: `Ziel erreicht: „${wp.name}"` });
      if (wp.temp) { stopNav(true); } else {
        patchSettings({ map: { nav: { activeWaypointId: null, routeIds: [] } } });
      }
    }
  }
  emit('nav');
}
