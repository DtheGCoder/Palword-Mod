/**
 * UI-Panels der großen Karte: Topbar (Suche/Regionen/Status), linkes Panel
 * (Ebenen + Pal-Browser), rechtes Panel (Navigation + Wegpunkte + Route),
 * Bottombar und Einstellungs-Dialog. Komplett deutsch.
 */
import { state, on, emit, saveWaypoints, patchSettings, asset } from './state.js';
import { fmtGame, fmtDist } from './transform.js';
import { svg, CATEGORIES, ELEMENTS, SPAWN_COLORS } from './icons.js';
import { setRegion, focusWorld, centerOnPlayer, addWaypointAt, startMeasure, clearMeasure, rebuildOverlays } from './mapview.js';
import { navigateToWaypoint, stopNav, startRoute, deleteWaypoint, navState } from './nav.js';
import { openSetup } from './setup.js';
import { toggleHudPlacement } from './hud.js';
import { runUpdateCheck } from './updater.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setOut = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

export function initPanels() {
  buildTopbar();
  buildLeftPanel();
  buildRightPanel();
  buildBottombar();
  buildSettings();

  on('waypoints', renderWaypointList);
  on('settings', () => renderRouteChips());
  on('regionChanged', () => { renderRegionTabs(); renderLayerChips(); renderPalList(); });
  on('posStatus', renderStatusChip);
  on('player', renderStatusChip);
  on('dataLoaded', () => { renderLayerChips(); renderPalList(); renderDataInfo(); });
}

// ------------------------------------------------------------ Topbar

function buildTopbar() {
  $('#topbar').innerHTML = `
    <div class="brand">${svg('sphere', 20)}<span>Pal<b>Pilot</b></span></div>
    <nav class="region-tabs" id="regionTabs"></nav>
    <div class="searchbox">
      ${svg('search', 16)}
      <input id="searchInput" type="text" placeholder="Pal, Ort, Wegpunkt oder „x, y" suchen…" autocomplete="off" spellcheck="false">
      <div class="search-results" id="searchResults"></div>
    </div>
    <div class="top-actions">
      <button class="status-chip" id="statusChip" title="Verbindungsstatus & Diagnose">${svg('crosshair', 14)}<span>–</span>${svg('chevD', 12)}</button>
      <button class="icon-btn" id="btnCenter" title="Auf Spieler zentrieren">${svg('target', 17)}</button>
      <button class="icon-btn" id="btnSettings" title="Einstellungen">${svg('gear', 17)}</button>
      <button class="icon-btn danger" id="btnClose" title="Karte schließen (F6)">${svg('x', 17)}</button>
    </div>
    <div class="diag-pop" id="diagPop"></div>`;

  renderRegionTabs();
  $('#btnCenter').onclick = () => centerOnPlayer();
  $('#btnSettings').onclick = () => toggleSettings(true);
  $('#btnClose').onclick = () => state.bridge.setMode('hud');
  $('#statusChip').onclick = (e) => { e.stopPropagation(); toggleDiag(); };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#diagPop') && !e.target.closest('#statusChip')) $('#diagPop')?.classList.remove('open');
  });
  on('player', () => { if ($('#diagPop')?.classList.contains('open')) renderDiag(); });
  on('posStatus', () => { if ($('#diagPop')?.classList.contains('open')) renderDiag(); });

  const input = $('#searchInput');
  input.addEventListener('input', () => renderSearch(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; renderSearch(''); input.blur(); }
    if (e.key === 'Enter') {
      const first = $('#searchResults .sr-item');
      if (first) first.click();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchbox')) $('#searchResults').classList.remove('open');
  });
}

function renderRegionTabs() {
  const tabs = $('#regionTabs');
  if (!state.data.regions) { tabs.innerHTML = ''; return; }
  tabs.innerHTML = Object.entries(state.data.regions).map(([id, cfg]) => `
    <button class="region-tab ${id === state.region ? 'active' : ''}" data-region="${id}">
      <b>${esc(cfg.title)}</b><small>${esc(cfg.subtitle || '')}</small>
    </button>`).join('');
  tabs.querySelectorAll('.region-tab').forEach((el) => {
    el.onclick = () => setRegion(el.dataset.region);
  });
}

function renderStatusChip() {
  const chip = $('#statusChip');
  if (!chip) return;
  const st = state.posStatus;
  const p = state.player;
  let cls = 'off', txt = 'Keine Position';
  if (st.ue4ss === 'ok') { cls = 'ok'; txt = 'Live · UE4SS'; }
  else if (st.rest === 'ok') { cls = 'ok'; txt = 'Live · Server'; }
  else if (p && p.source === 'manual') { cls = 'manual'; txt = 'Manuell'; }
  else if (p) { cls = 'stale'; txt = 'Signal verloren'; }
  chip.className = 'status-chip ' + cls;
  chip.innerHTML = `<span class="dot"></span><span>${txt}</span>${svg('chevD', 12)}`;
  chip.title = 'Verbindungsstatus & Diagnose';
}

function toggleDiag() {
  const pop = $('#diagPop');
  const open = !pop.classList.contains('open');
  pop.classList.toggle('open', open);
  if (open) renderDiag();
}

function renderDiag() {
  const pop = $('#diagPop');
  if (!pop) return;
  const st = state.posStatus;
  const p = state.player;
  const now = Date.now();
  const dot = (s) => `<span class="dot ${s}"></span>`;
  const ago = (t) => {
    if (!t) return 'nie';
    const s = (now - t) / 1000;
    return s < 1.5 ? 'gerade eben' : s < 60 ? `vor ${s.toFixed(0)} s` : `vor ${(s / 60).toFixed(0)} min`;
  };
  const ue = st.ue4ss, re = st.rest;
  const src = state.mock ? 'Demo (simuliert)' : (st.ue4ss === 'ok' ? 'UE4SS-Mod' : st.rest === 'ok' ? 'Server (REST)' : p?.source === 'manual' ? 'Manuell' : '—');

  // Konkreter, umsetzbarer Hinweis je nach Zustand
  let hint, hintCls = 'info';
  if (state.mock) { hint = 'Demo-Modus: simulierte Position. Im echten Overlay kommt sie aus der Mod/REST.'; }
  else if (ue === 'ok' || re === 'ok') { hint = 'Alles läuft — Position wird live empfangen.'; hintCls = 'ok'; }
  else if (ue === 'stale') { hint = 'Es kamen zuletzt Daten, jetzt nicht mehr. Läuft Palworld noch? Im Hauptmenü/Ladescreen gibt es keine Position.'; hintCls = 'warn'; }
  else if (re === 'error') { hint = 'REST-API antwortet nicht — Host/Port/AdminPassword in den Einstellungen prüfen.'; hintCls = 'warn'; }
  else {
    hint = state.settings.game?.setupDone
      ? 'Mod installiert, aber keine Daten. Starte Palworld — sobald du im Spiel bist, wird’s grün. Läuft UE4SS? (Ladescreen zählt nicht.)'
      : 'Noch nicht eingerichtet. Klicke „Spiel-Setup" — Ordner wählen, Rest läuft automatisch.';
    hintCls = 'warn';
  }

  const g = p ? state.math[p.region]?.worldToGame(p.wx, p.wy) : null;
  pop.innerHTML = `
    <div class="diag-title">${svg('crosshair', 14)} Positions-Diagnose</div>
    <div class="diag-row">${dot(ue === 'ok' ? 'ok' : ue === 'stale' ? 'stale' : 'off')} UE4SS-Mod <b>${ue === 'ok' ? 'verbunden' : ue === 'stale' ? 'keine frischen Daten' : 'nicht aktiv'}</b></div>
    <div class="diag-row">${dot(re === 'ok' ? 'ok' : re === 'error' ? 'err' : 'off')} Server-REST <b>${re === 'ok' ? 'verbunden' : re === 'error' ? 'Fehler' : 'aus'}</b></div>
    <div class="diag-sep"></div>
    <div class="diag-kv"><span>Quelle</span><b>${esc(src)}</b></div>
    <div class="diag-kv"><span>Letzte Position</span><b>${ago(p?.at)}</b></div>
    <div class="diag-kv"><span>Region</span><b>${p ? esc(state.data.regions?.[p.region]?.title || p.region) : '—'}</b></div>
    <div class="diag-kv"><span>Level (Spiel)</span><b class="mono">${esc(p?.level || '—')}</b></div>
    <div class="diag-kv"><span>Koordinaten</span><b class="mono">${g ? fmtGame(g) : '—'}</b></div>
    <div class="diag-hint ${hintCls}">${esc(hint)}</div>
    <div class="diag-actions">
      <button class="btn sm btn-acc" id="diagSetup">${svg('compass', 12)} Spiel-Setup</button>
      <button class="btn sm" id="diagSettings">${svg('gear', 12)} Einstellungen</button>
      <button class="btn sm" id="diagFolder">${svg('folder', 12)} Datei-Ordner</button>
    </div>`;
  $('#diagSetup').onclick = () => { pop.classList.remove('open'); openSetup(); };
  $('#diagSettings').onclick = () => { pop.classList.remove('open'); toggleSettings(true); };
  $('#diagFolder').onclick = () => state.bridge.openPath('ue4ss');
}

// ------------------------------------------------------------ Suche

function renderSearch(q) {
  const box = $('#searchResults');
  q = q.trim();
  if (!q) { box.classList.remove('open'); box.innerHTML = ''; return; }

  const results = [];
  const coordMatch = q.match(/^(-?\d{1,4})[,;\s]+(-?\d{1,4})$/);
  if (coordMatch) {
    results.push({
      group: 'Koordinaten', icon: 'crosshair', label: `Gehe zu (${coordMatch[1]}, ${coordMatch[2]})`,
      action: () => {
        const m = state.math[state.region];
        const w = m.gameToWorld(Number(coordMatch[1]), Number(coordMatch[2]));
        focusWorld(w.wx, w.wy, state.region, 0);
      },
    });
  }
  const ql = q.toLowerCase();
  for (const pal of state.data.pals || []) {
    if (results.length > 18) break;
    if (pal.name.toLowerCase().includes(ql) || (pal.nameEn || '').toLowerCase().includes(ql)) {
      results.push({
        group: 'Pals', iconImg: asset(pal.icon), icon: 'sphere',
        label: pal.name, sub: (pal.elements || []).map((e) => ELEMENTS[e]?.label || e).join(' · '),
        action: () => { togglePalSpawn(pal.id, true); flyToPalSpawn(pal.id); },
      });
    }
  }
  for (const [cat, list] of Object.entries(state.data.markers || {})) {
    for (const mk of list || []) {
      if (results.length > 26) break;
      if ((mk.name || '').toLowerCase().includes(ql)) {
        results.push({
          group: CATEGORIES[cat]?.label || cat, icon: CATEGORIES[cat]?.icon || 'pin',
          label: mk.name, sub: fmtGame(state.math[mk.region || 'palpagos'].worldToGame(mk.wx, mk.wy)),
          action: () => {
            state.filters.cats.add(cat);
            emit('filters');
            focusWorld(mk.wx, mk.wy, mk.region || 'palpagos', 0.5);
          },
        });
      }
    }
  }
  for (const wp of state.waypoints) {
    if (wp.name.toLowerCase().includes(ql)) {
      results.push({
        group: 'Wegpunkte', icon: 'pin', label: wp.name,
        action: () => focusWorld(wp.wx, wp.wy, wp.region, 0.5),
      });
    }
  }

  if (!results.length) {
    box.innerHTML = `<div class="sr-empty">Nichts gefunden${state.data.pals?.length ? '' : ' — Daten fehlen (npm run fetch-assets)'}</div>`;
    box.classList.add('open');
    return;
  }
  let lastGroup = null;
  box.innerHTML = results.map((r, i) => {
    const head = r.group !== lastGroup ? `<div class="sr-group">${esc(r.group)}</div>` : '';
    lastGroup = r.group;
    const ic = r.iconImg ? `<img src="${esc(r.iconImg)}" loading="lazy" onerror="this.remove()">` : svg(r.icon, 15);
    return `${head}<button class="sr-item" data-i="${i}">${ic}<span>${esc(r.label)}</span><small>${esc(r.sub || '')}</small></button>`;
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.sr-item').forEach((el) => {
    el.onclick = () => {
      results[Number(el.dataset.i)].action();
      box.classList.remove('open');
    };
  });
}

function flyToPalSpawn(palId) {
  const byRegion = state.data.spawns?.[palId];
  if (!byRegion) return;
  const pts = byRegion[state.region] && byRegion[state.region].length
    ? { region: state.region, list: byRegion[state.region] }
    : Object.entries(byRegion).map(([region, list]) => ({ region, list })).find((e) => e.list.length);
  if (!pts || !pts.list.length) return;
  const mid = pts.list[Math.floor(pts.list.length / 2)];
  focusWorld(mid[0], mid[1], pts.region, -0.5);
}

// ------------------------------------------------------------ Linkes Panel

function buildLeftPanel() {
  $('#leftPanel').innerHTML = `
    <section class="panel-section">
      <h3>${svg('layers', 15)} Kartenebenen</h3>
      <div class="chip-grid" id="layerChips"></div>
    </section>
    <section class="panel-section grow">
      <h3>${svg('search', 15)} Pals & Spawns <span class="hint" id="spawnHint"></span></h3>
      <div class="pal-search">
        ${svg('search', 14)}
        <input id="palSearch" type="text" placeholder="Pal filtern…" spellcheck="false">
      </div>
      <div class="active-pals" id="activePals"></div>
      <div class="pal-list" id="palList"></div>
    </section>`;
  $('#palSearch').addEventListener('input', () => renderPalList());
  renderLayerChips();
  renderPalList();
}

function renderLayerChips() {
  const grid = $('#layerChips');
  if (!grid) return;
  const markers = state.data.markers || {};
  grid.innerHTML = Object.entries(CATEGORIES).map(([cat, c]) => {
    const count = (markers[cat] || []).filter((m) => (m.region || 'palpagos') === state.region).length;
    if (!count && !state.filters.cats.has(cat)) return '';
    const active = state.filters.cats.has(cat);
    return `<button class="chip ${active ? 'active' : ''}" data-cat="${cat}" style="--c:${c.color}">
      ${svg(c.icon, 14)}<span>${c.label}</span><small>${count}</small>
    </button>`;
  }).join('') || '<div class="hint">Noch keine POI-Daten — „npm run fetch-assets" ausführen.</div>';
  grid.querySelectorAll('.chip').forEach((el) => {
    el.onclick = () => {
      const cat = el.dataset.cat;
      if (state.filters.cats.has(cat)) state.filters.cats.delete(cat);
      else state.filters.cats.add(cat);
      emit('filters');
      renderLayerChips();
    };
  });
}

export function togglePalSpawn(palId, forceOn = false) {
  const pals = state.filters.pals;
  if (pals.has(palId) && !forceOn) {
    pals.delete(palId);
  } else if (!pals.has(palId)) {
    const used = new Set(pals.values());
    let idx = 0;
    while (used.has(idx) && idx < SPAWN_COLORS.length) idx++;
    pals.set(palId, idx % SPAWN_COLORS.length);
  }
  emit('filters');
  renderActivePals();
  renderPalList();
}

function renderActivePals() {
  const box = $('#activePals');
  if (!box) return;
  const items = [...state.filters.pals.entries()];
  box.innerHTML = items.map(([palId, colorIdx]) => {
    const pal = (state.data.pals || []).find((p) => p.id === palId);
    return `<button class="active-pal" data-pal="${esc(palId)}" style="--c:${SPAWN_COLORS[colorIdx % SPAWN_COLORS.length]}">
      <span class="swatch"></span>${esc(pal?.name || palId)}${svg('x', 12)}
    </button>`;
  }).join('');
  box.style.display = items.length ? 'flex' : 'none';
  box.querySelectorAll('.active-pal').forEach((el) => {
    el.onclick = () => togglePalSpawn(el.dataset.pal);
  });
}

function renderPalList() {
  const list = $('#palList');
  if (!list) return;
  const q = ($('#palSearch')?.value || '').trim().toLowerCase();
  const pals = (state.data.pals || [])
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.nameEn || '').toLowerCase().includes(q))
    .slice(0, 400);
  $('#spawnHint').textContent = state.data.spawns ? '' : '(Daten fehlen)';
  if (!pals.length) {
    list.innerHTML = `<div class="hint" style="padding:10px">${q ? 'Kein Pal gefunden.' : 'Keine Pal-Daten — „npm run fetch-assets" ausführen.'}</div>`;
    renderActivePals();
    return;
  }
  list.innerHTML = pals.map((p) => {
    const active = state.filters.pals.has(p.id);
    const els = (p.elements || []).map((e) => {
      const el = ELEMENTS[e] || { label: e, color: '#888' };
      return `<span class="el-badge" style="--c:${el.color}" title="${esc(el.label)}"></span>`;
    }).join('');
    const icon = p.icon
      ? `<img class="pal-ico" src="${esc(asset(p.icon))}" loading="lazy" onerror="this.outerHTML='<span class=\\'pal-ico ph\\'>${esc(p.name[0])}</span>'">`
      : `<span class="pal-ico ph">${esc(p.name[0] || '?')}</span>`;
    return `<button class="pal-row ${active ? 'active' : ''}" data-pal="${esc(p.id)}">
      ${icon}
      <span class="pal-name">${esc(p.name)}${p.nocturnal ? ' <i title="nachtaktiv">🌙</i>' : ''}</span>
      <span class="pal-els">${els}</span>
      <span class="pal-num">#${p.num ?? '–'}</span>
    </button>`;
  }).join('');
  list.querySelectorAll('.pal-row').forEach((el) => {
    el.onclick = () => togglePalSpawn(el.dataset.pal);
  });
  renderActivePals();
}

// ------------------------------------------------------------ Rechtes Panel

function buildRightPanel() {
  $('#rightPanel').innerHTML = `
    <section class="panel-section" id="navCard"></section>
    <section class="panel-section grow">
      <h3>${svg('pin', 15)} Wegpunkte
        <span class="h-actions">
          <button class="icon-btn sm" id="btnWpCenter" title="Wegpunkt in Kartenmitte">${svg('plus', 14)}</button>
          <button class="icon-btn sm" id="btnWpImport" title="Importieren (JSON)">${svg('upload', 14)}</button>
          <button class="icon-btn sm" id="btnWpExport" title="Exportieren (JSON)">${svg('download', 14)}</button>
        </span>
      </h3>
      <div class="wp-list" id="wpList"></div>
    </section>
    <section class="panel-section" id="routeSection">
      <h3>${svg('route', 15)} Route</h3>
      <div class="route-chips" id="routeChips"></div>
      <div class="route-actions">
        <button class="btn btn-acc sm" id="btnRouteStart">${svg('play', 12)} Starten</button>
        <button class="btn sm" id="btnRouteReverse">Umkehren</button>
        <button class="btn sm" id="btnRouteClear">Leeren</button>
      </div>
    </section>
    <input type="file" id="wpFileInput" accept=".json" style="display:none">`;

  $('#btnWpCenter').onclick = () => {
    const c = window.__ppMap.getCenter();
    const m = state.math[state.region];
    const w = m.pxToWorld(c.lng, -c.lat);
    addWaypointAt(w.wx, w.wy);
  };
  $('#btnWpExport').onclick = exportWaypoints;
  $('#btnWpImport').onclick = () => $('#wpFileInput').click();
  $('#wpFileInput').addEventListener('change', importWaypoints);
  $('#btnRouteStart').onclick = () => startRoute(navState().routeIds);
  $('#btnRouteReverse').onclick = () => {
    patchSettings({ map: { nav: { routeIds: [...navState().routeIds].reverse() } } });
    renderRouteChips();
  };
  $('#btnRouteClear').onclick = () => {
    patchSettings({ map: { nav: { routeIds: [] } } });
    renderRouteChips();
  };

  renderWaypointList();
  renderRouteChips();
}

function renderWaypointList() {
  const list = $('#wpList');
  if (!list) return;
  const wps = state.waypoints.filter((w) => !w.temp);
  const activeId = navState()?.activeWaypointId;
  if (!wps.length) {
    list.innerHTML = `<div class="hint" style="padding:10px">Noch keine Wegpunkte.<br>Rechtsklick auf die Karte oder <b>F8</b> im Spiel.</div>`;
    renderRouteChips();
    return;
  }
  list.innerHTML = wps.map((wp) => {
    const g = state.math[wp.region || 'palpagos']?.worldToGame(wp.wx, wp.wy);
    const inRoute = navState().routeIds.includes(wp.id);
    return `<div class="wp-row ${wp.id === activeId ? 'active' : ''}" data-id="${wp.id}">
      <button class="swatch" title="Farbe ändern" style="--c:${wp.color || '#46c8ff'}"></button>
      <div class="wp-meta">
        <span class="wp-name" title="Doppelklick: umbenennen">${esc(wp.name)}</span>
        <small class="mono">${g ? fmtGame(g) : ''} · ${esc(state.data.regions?.[wp.region]?.title || '')}</small>
      </div>
      <button class="icon-btn sm" data-act="route" title="${inRoute ? 'Aus Route entfernen' : 'Zur Route hinzufügen'}">${svg('route', 13)}</button>
      <button class="icon-btn sm" data-act="nav" title="Navigieren">${svg('flag', 13)}</button>
      <button class="icon-btn sm danger" data-act="del" title="Löschen">${svg('trash', 13)}</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.wp-row').forEach((row) => {
    const id = row.dataset.id;
    const wp = state.waypoints.find((w) => w.id === id);
    row.querySelector('[data-act="nav"]').onclick = () => navigateToWaypoint(id);
    row.querySelector('[data-act="del"]').onclick = () => deleteWaypoint(id);
    row.querySelector('[data-act="route"]').onclick = () => {
      const ids = navState().routeIds.includes(id)
        ? navState().routeIds.filter((r) => r !== id)
        : [...navState().routeIds, id];
      patchSettings({ map: { nav: { routeIds: ids } } });
      renderWaypointList();
      renderRouteChips();
    };
    row.querySelector('.swatch').onclick = () => {
      const idx = (SPAWN_COLORS.indexOf(wp.color) + 1) % SPAWN_COLORS.length;
      wp.color = SPAWN_COLORS[idx];
      saveWaypoints();
    };
    const nameEl = row.querySelector('.wp-name');
    nameEl.ondblclick = () => {
      const input = document.createElement('input');
      input.value = wp.name;
      input.className = 'wp-rename';
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => { wp.name = input.value.trim() || wp.name; saveWaypoints(); };
      input.onblur = commit;
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = wp.name; input.blur(); } };
    };
    row.querySelector('.wp-meta').onclick = (e) => {
      if (e.target.tagName === 'INPUT') return;
      focusWorld(wp.wx, wp.wy, wp.region, 0.5);
    };
  });
  renderRouteChips();
}

function renderRouteChips() {
  const box = $('#routeChips');
  if (!box) return;
  const ids = navState()?.routeIds || [];
  const sec = $('#routeSection');
  sec.style.display = ids.length ? 'block' : 'none';
  box.innerHTML = ids.map((id, i) => {
    const wp = state.waypoints.find((w) => w.id === id);
    return wp ? `<span class="route-chip" style="--c:${wp.color}">${i + 1}. ${esc(wp.name)}</span>` : '';
  }).join(svg('chevD', 12, 'route-sep'));
}

function exportWaypoints() {
  const data = JSON.stringify({ palpilotWaypoints: 1, list: state.waypoints.filter((w) => !w.temp) }, null, 2);
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(data);
  a.download = 'palpilot-wegpunkte.json';
  a.click();
  emit('toast', { icon: 'download', msg: 'Wegpunkte exportiert' });
}

function importWaypoints(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const j = JSON.parse(reader.result);
      const list = Array.isArray(j) ? j : j.list;
      let n = 0;
      for (const w of list || []) {
        if (typeof w.wx === 'number' && typeof w.wy === 'number') {
          state.waypoints.push({
            id: 'wp_imp_' + Date.now().toString(36) + '_' + n,
            name: String(w.name || `Import ${++n}`),
            wx: w.wx, wy: w.wy,
            region: w.region || 'palpagos',
            color: w.color || SPAWN_COLORS[n % SPAWN_COLORS.length],
            createdAt: Date.now(),
          });
          n++;
        }
      }
      saveWaypoints();
      emit('toast', { icon: 'check', msg: `${n} Wegpunkte importiert` });
    } catch {
      emit('toast', { icon: 'warn', msg: 'Import fehlgeschlagen — ungültiges JSON' });
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ------------------------------------------------------------ Bottombar

function buildBottombar() {
  $('#bottombar').innerHTML = `
    <div class="bb-group">
      <span class="bb-label">Cursor</span><span class="mono" id="cursorCoords">–</span>
      <span class="bb-sep"></span>
      <span class="bb-label">Spieler</span><span class="mono" id="playerCoords">–</span>
    </div>
    <div class="bb-group">
      <button class="bb-btn" id="bbFollow">${svg('target', 13)} Folgen</button>
      <button class="bb-btn" id="bbGrid">${svg('grid', 13)} Raster</button>
      <button class="bb-btn" id="bbMeasure">${svg('ruler', 13)} Messen</button>
    </div>
    <div class="bb-group hotkeys">
      <span><b>F6</b> Karte</span><span><b>F7</b> HUD</span><span><b>F8</b> Wegpunkt</span><span><b>F9</b> Stopp</span>
      <span id="mockBadge" class="mock-badge" style="display:none">DEMO</span>
    </div>`;

  const syncBtns = () => {
    $('#bbFollow').classList.toggle('active', !!state.settings?.map?.followPlayer);
    $('#bbGrid').classList.toggle('active', !!state.settings?.map?.showGrid);
    $('#bbMeasure').classList.toggle('active', !!state.measure);
  };
  $('#bbFollow').onclick = () => { patchSettings({ map: { followPlayer: !state.settings.map.followPlayer } }); syncBtns(); };
  $('#bbGrid').onclick = () => { patchSettings({ map: { showGrid: !state.settings.map.showGrid } }); rebuildOverlays(); syncBtns(); };
  $('#bbMeasure').onclick = () => { state.measure ? clearMeasure() : startMeasure(); syncBtns(); };
  on('measure', syncBtns);
  on('settings', syncBtns);
  if (state.mock) $('#mockBadge').style.display = 'inline-flex';
  syncBtns();
}

// ------------------------------------------------------------ Einstellungen

function buildSettings() {
  $('#settingsModal').innerHTML = `
    <div class="modal-card settings-card">
      <header>
        <h2>${svg('gear', 18)} Einstellungen</h2>
        <button class="icon-btn" id="setClose">${svg('x', 16)}</button>
      </header>
      <div class="settings-layout">
        <nav class="settings-nav" id="settingsNav">
          <button class="snav active" data-panel="position">${svg('crosshair', 16)}<span>Position</span></button>
          <button class="snav" data-panel="hud">${svg('eye', 16)}<span>HUD & Minimap</span></button>
          <button class="snav" data-panel="map">${svg('layers', 16)}<span>Karte</span></button>
          <button class="snav" data-panel="keys">${svg('gear', 16)}<span>Hotkeys</span></button>
          <button class="snav" data-panel="data">${svg('folder', 16)}<span>Daten</span></button>
          <button class="snav" data-panel="about">${svg('info', 16)}<span>Über & Updates</span></button>
        </nav>
        <div class="settings-content">

          <div class="spanel active" data-panel="position">
            <h4>${svg('crosshair', 14)} Live-Position einrichten</h4>
            <p class="set-lead">Wähle deinen Palworld-Ordner — der Assistent lädt UE4SS, installiert die Mod und stellt den Fenstermodus ein. Alles automatisch.</p>
            <button class="btn btn-acc" id="setOpenSetup">${svg('compass', 13)} Spiel-Setup starten</button>
            <div class="set-card" style="margin-top:14px">
              <div class="set-status" id="setUe4ss"><span class="dot"></span> UE4SS-Mod (Echtzeit · Singleplayer & Koop)</div>
              <div class="set-status" id="setRest" style="margin-top:8px"><span class="dot"></span> Dedicated-Server REST-API</div>
            </div>
            <h5>Dedicated-Server (optional)</h5>
            <label class="check big"><input type="checkbox" id="setRestOn"> REST-API verwenden</label>
            <div class="set-grid2">
              <label>Host <input id="setRestHost" type="text" placeholder="127.0.0.1"></label>
              <label>Port <input id="setRestPort" type="number" placeholder="8212" min="1" max="65535"></label>
              <label>AdminPassword <input id="setRestPass" type="password" placeholder="•••••"></label>
              <label>Spieler <input id="setRestPlayer" type="text" placeholder="leer = erster"></label>
            </div>
            <details class="set-advanced">
              <summary>Erweitert: Positionsdatei</summary>
              <div class="set-row">
                <input id="setUeFile" type="text" spellcheck="false">
                <button class="btn sm" id="setUeOpen">${svg('folder', 12)} Ordner</button>
              </div>
            </details>
            <p class="hint">Ohne Live-Quelle: Rechtsklick auf die Karte → „Ich stehe hier".</p>
          </div>

          <div class="spanel" data-panel="hud">
            <h4>${svg('eye', 14)} HUD im Spiel</h4>
            <div class="set-toggles">
              <label class="check big"><input type="checkbox" id="setHudMini"> Minimap anzeigen</label>
              <label class="check big"><input type="checkbox" id="setHudBanner"> Navigations-Banner</label>
              <label class="check big"><input type="checkbox" id="setHudRotate"> Karte dreht mit Blickrichtung</label>
            </div>
            <h5>Position & Größe</h5>
            <div class="set-row">
              <button class="btn btn-acc" id="setHudPlace">${svg('target', 13)} Minimap frei positionieren</button>
              <span class="hint" id="setHudPosNote"></span>
            </div>
            <div class="set-field"><label>Standard-Ecke</label>
              <select id="setHudCorner">
                <option value="top-right">oben rechts</option>
                <option value="top-left">oben links</option>
                <option value="bottom-right">unten rechts</option>
                <option value="bottom-left">unten links</option>
              </select>
            </div>
            <div class="set-field"><label>Größe</label><input type="range" id="setHudSize" min="200" max="440" step="10"><output id="outHudSize"></output></div>
            <div class="set-field"><label>Zoom</label><input type="range" id="setHudZoom" min="1" max="5" step="0.2"><output id="outHudZoom"></output></div>
            <div class="set-field"><label>Deckkraft</label><input type="range" id="setHudOpacity" min="0.4" max="1" step="0.05"><output id="outHudOpacity"></output></div>
          </div>

          <div class="spanel" data-panel="map">
            <h4>${svg('layers', 14)} Große Karte</h4>
            <div class="set-toggles">
              <label class="check big"><input type="checkbox" id="setFollow"> Karte folgt dem Spieler</label>
              <label class="check big"><input type="checkbox" id="setTrail"> Bewegungsspur anzeigen</label>
              <label class="check big"><input type="checkbox" id="setGrid2"> Koordinatenraster</label>
            </div>
            <div class="set-field"><label>Abdunklung hinter der Karte</label><input type="range" id="setDim" min="0" max="0.9" step="0.05"><output id="outDim"></output></div>
          </div>

          <div class="spanel" data-panel="keys">
            <h4>${svg('gear', 14)} Tastenkürzel</h4>
            <div class="hotkey-list" id="setHotkeys"></div>
            <p class="hint">Belegung änderbar in <b>settings.json</b> (Tab „Daten" → Einstellungs-Ordner).</p>
          </div>

          <div class="spanel" data-panel="data">
            <h4>${svg('folder', 14)} Daten & Ordner</h4>
            <div class="set-card" id="setDataInfo"></div>
            <div class="set-row" style="margin-top:12px">
              <button class="btn sm" id="setOpenData">${svg('folder', 12)} Daten-Ordner</button>
              <button class="btn sm" id="setOpenUser">${svg('folder', 12)} Einstellungs-Ordner</button>
            </div>
          </div>

          <div class="spanel" data-panel="about">
            <h4>${svg('info', 14)} Über PalPilot</h4>
            <div class="set-card" id="setAbout"></div>
            <h5>Updates</h5>
            <label class="check big"><input type="checkbox" id="setAutoUpd"> Beim Start automatisch von GitHub aktualisieren</label>
            <div class="set-row" style="margin-top:12px">
              <button class="btn btn-acc sm" id="setUpdNow">${svg('download', 12)} Jetzt nach Updates suchen</button>
            </div>
            <div class="set-row" style="margin-top:20px">
              <button class="btn sm danger" id="setQuit">${svg('x', 12)} Overlay beenden</button>
            </div>
          </div>

        </div>
      </div>
    </div>`;

  // Tab-Umschaltung
  $('#settingsNav').querySelectorAll('.snav').forEach((btn) => {
    btn.onclick = () => {
      $('#settingsNav .snav.active')?.classList.remove('active');
      btn.classList.add('active');
      document.querySelectorAll('.spanel').forEach((p) => p.classList.toggle('active', p.dataset.panel === btn.dataset.panel));
    };
  });

  $('#setClose').onclick = () => toggleSettings(false);
  $('#settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') toggleSettings(false);
  });
  $('#setOpenSetup').onclick = () => { toggleSettings(false); openSetup(); };
  $('#setHudPlace').onclick = () => {
    toggleSettings(false);
    if (state.mode !== 'map') state.bridge.setMode('map');
    toggleHudPlacement(true);
    emit('toast', { icon: 'target', msg: 'Minimap ziehen zum Platzieren, dann „Fertig"' });
  };
  $('#setUeOpen').onclick = () => state.bridge.openPath('ue4ss');
  $('#setOpenData').onclick = () => state.bridge.openPath('data');
  $('#setOpenUser').onclick = () => state.bridge.openPath('userData');
  $('#setQuit').onclick = () => state.bridge.quit();
  $('#setUpdNow').onclick = () => { emit('toast', { icon: 'download', msg: 'Suche nach Updates…' }); runUpdateCheck({ manual: true }); };

  const bind = (id, get, set, evt = 'change') => {
    const el = $(id);
    el.addEventListener(evt, () => set(el));
    return el;
  };
  bind('#setUeFile', null, (el) => patchSettings({ position: { ue4ssFile: el.value.trim() } }));
  bind('#setRestOn', null, (el) => patchSettings({ position: { rest: { enabled: el.checked } } }));
  bind('#setRestHost', null, (el) => patchSettings({ position: { rest: { host: el.value.trim() } } }));
  bind('#setRestPort', null, (el) => patchSettings({ position: { rest: { port: Number(el.value) || 8212 } } }));
  bind('#setRestPass', null, (el) => patchSettings({ position: { rest: { password: el.value } } }));
  bind('#setRestPlayer', null, (el) => patchSettings({ position: { rest: { player: el.value.trim() } } }));
  bind('#setHudMini', null, (el) => patchSettings({ hud: { minimap: el.checked } }));
  bind('#setHudBanner', null, (el) => patchSettings({ hud: { navBanner: el.checked } }));
  bind('#setHudRotate', null, (el) => patchSettings({ hud: { rotate: el.checked } }));
  bind('#setHudCorner', null, (el) => patchSettings({ hud: { corner: el.value } }));
  bind('#setHudSize', null, (el) => { patchSettings({ hud: { size: Number(el.value) } }); setOut('outHudSize', el.value + ' px'); }, 'input');
  bind('#setHudZoom', null, (el) => { patchSettings({ hud: { zoom: Number(el.value) } }); setOut('outHudZoom', Number(el.value).toFixed(1) + '×'); }, 'input');
  bind('#setHudOpacity', null, (el) => { patchSettings({ hud: { opacity: Number(el.value) } }); setOut('outHudOpacity', Math.round(el.value * 100) + ' %'); }, 'input');
  bind('#setFollow', null, (el) => patchSettings({ map: { followPlayer: el.checked } }));
  bind('#setTrail', null, (el) => { patchSettings({ map: { showTrail: el.checked } }); rebuildOverlays(); });
  bind('#setGrid2', null, (el) => { patchSettings({ map: { showGrid: el.checked } }); rebuildOverlays(); });
  bind('#setAutoUpd', null, (el) => patchSettings({ updates: { auto: el.checked } }));
  bind('#setDim', null, (el) => {
    patchSettings({ overlay: { dimBackground: Number(el.value) } });
    document.body.style.setProperty('--dim', el.value);
    setOut('outDim', Math.round(el.value * 100) + ' %');
  }, 'input');

  on('posStatus', renderSettingsStatus);
}

export function toggleSettings(openState) {
  const modal = $('#settingsModal');
  const open = openState ?? !modal.classList.contains('open');
  modal.classList.toggle('open', open);
  if (open) syncSettingsForm();
}

function syncSettingsForm() {
  const s = state.settings;
  $('#setUeFile').value = s.position.ue4ssFile || '';
  $('#setRestOn').checked = !!s.position.rest.enabled;
  $('#setRestHost').value = s.position.rest.host || '';
  $('#setRestPort').value = s.position.rest.port || 8212;
  $('#setRestPass').value = s.position.rest.password || '';
  $('#setRestPlayer').value = s.position.rest.player || '';
  $('#setHudMini').checked = s.hud.minimap !== false;
  $('#setHudBanner').checked = s.hud.navBanner !== false;
  $('#setHudRotate').checked = !!s.hud.rotate;
  $('#setHudCorner').value = s.hud.corner === 'custom' ? 'top-right' : (s.hud.corner || 'top-right');
  $('#setHudSize').value = s.hud.size || 280;
  $('#setHudZoom').value = s.hud.zoom || 2.4;
  $('#setHudOpacity').value = s.hud.opacity ?? 0.95;
  $('#setHudPosNote').textContent = s.hud.corner === 'custom' && s.hud.customPos ? 'aktuell: frei platziert' : '';
  $('#setFollow').checked = !!s.map.followPlayer;
  $('#setTrail').checked = s.map.showTrail !== false;
  $('#setGrid2').checked = !!s.map.showGrid;
  $('#setDim').value = s.overlay.dimBackground ?? 0.6;
  $('#setHotkeys').innerHTML = Object.entries(s.hotkeys).map(([k, v]) => {
    const labels = { toggleMap: 'Karte öffnen/schließen', toggleHud: 'HUD ein/aus', quickWaypoint: 'Schnell-Wegpunkt', stopNav: 'Navigation stoppen' };
    return `<div class="hotkey-row"><span>${labels[k] || k}</span><kbd>${esc(v)}</kbd></div>`;
  }).join('');
  $('#setAutoUpd').checked = s.updates?.auto !== false;
  setOut('outHudSize', (s.hud.size || 280) + ' px');
  setOut('outHudZoom', Number(s.hud.zoom || 2.4).toFixed(1) + '×');
  setOut('outHudOpacity', Math.round((s.hud.opacity ?? 0.95) * 100) + ' %');
  setOut('outDim', Math.round((s.overlay.dimBackground ?? 0.6) * 100) + ' %');
  $('#setAbout').innerHTML = `<b>PalPilot</b> v${esc(state.version || '?')}<br>Modus: ${state.mock ? 'Demo (Mock)' : (state.windowed ? 'Fenster' : 'Overlay')}`;
  renderSettingsStatus();
  renderDataInfo();
}

function renderSettingsStatus() {
  const st = state.posStatus;
  const map = { ok: 'verbunden', stale: 'keine frischen Daten', off: 'inaktiv', error: 'Fehler' };
  const ue = $('#setUe4ss'), re = $('#setRest');
  if (!ue) return;
  ue.querySelector('.dot').className = 'dot ' + (st.ue4ss === 'ok' ? 'ok' : st.ue4ss === 'stale' ? 'stale' : 'off');
  ue.childNodes[1].textContent = ` UE4SS-Mod (Echtzeit) — ${map[st.ue4ss] || st.ue4ss}`;
  re.querySelector('.dot').className = 'dot ' + (st.rest === 'ok' ? 'ok' : st.rest === 'error' ? 'err' : 'off');
  re.childNodes[1].textContent = ` Dedicated-Server REST-API — ${map[st.rest] || st.rest}`;
}

function renderDataInfo() {
  const el = $('#setDataInfo');
  if (!el) return;
  const d = state.data;
  const spawnCount = d.spawns ? Object.values(d.spawns).reduce((a, r) => a + Object.values(r).reduce((x, l) => x + l.length, 0), 0) : 0;
  const markerCount = d.markers ? Object.values(d.markers).reduce((a, l) => a + (l?.length || 0), 0) : 0;
  el.innerHTML = d.pals?.length
    ? `${d.pals.length} Pals · ${markerCount.toLocaleString('de')} POIs · ${spawnCount.toLocaleString('de')} Spawn-Punkte${d.meta?.build ? ` · Spieldaten-Build ${esc(String(d.meta.build))}` : ''}`
    : 'Noch keine Daten geladen. Im Projektordner <b>npm run fetch-assets</b> ausführen (lädt Karte, Pals, Spawns, POIs — einmalig, danach offline).';
}
