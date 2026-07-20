/**
 * Renderer-Seite des Auto-Updaters: beim Start prüfen, Fortschritt als Toast,
 * bei installiertem Update ein Overlay „Neustart…". Manuell aus den Settings.
 */
import { state, emit } from './state.js';
import { svg } from './icons.js';

export function initUpdater() {
  state.bridge.onUpdateProgress((d) => emit('toast', { icon: 'download', msg: d.msg }));
  // Automatische Prüfung beim Start (nur echte App, nicht Demo)
  if (state.bridge.real && state.settings.updates?.auto !== false) {
    setTimeout(() => runUpdateCheck({ auto: true }), 1500);
  }
}

export async function runUpdateCheck(opts = {}) {
  let res;
  try {
    res = await state.bridge.updateCheck(opts);
  } catch (e) {
    if (opts.manual) emit('toast', { icon: 'warn', msg: 'Update-Prüfung fehlgeschlagen: ' + (e?.message || e) });
    return;
  }
  if (!res) return;

  if (res.updated) {
    showUpdatingOverlay(res);
  } else if (res.mode === 'manual' && res.latest) {
    emit('toast', { icon: 'info', msg: `Neue Version v${res.latest} verfügbar — Repo im Browser öffnen und aktualisieren.`, sticky: true });
  } else if (res.upToDate) {
    if (opts.manual) emit('toast', { icon: 'check', msg: `PalPilot ist aktuell (v${res.current}).` });
  } else if (res.skipped) {
    if (opts.manual) emit('toast', { icon: 'warn', msg: `Update übersprungen: ${res.reason || 'unbekannt'}` });
  }
}

function showUpdatingOverlay(res) {
  let el = document.getElementById('updateOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'updateOverlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="upd-card">
      <div class="upd-spin">${svg('download', 30)}</div>
      <h2>Update installiert</h2>
      <p>Version <b>${res.from} → ${res.to}</b>${res.depsChanged ? ' · Abhängigkeiten aktualisiert' : ''}</p>
      <p class="upd-sub">PalPilot startet gleich neu…</p>
    </div>`;
  el.classList.add('open');
}
