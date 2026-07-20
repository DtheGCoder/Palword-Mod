/**
 * Admin-Modus (versteckt, Passwort 0815): Live-Inventar-Editor.
 *
 * Versteckter Einstieg: 3× schnell aufs PalPilot-Logo klicken → Passwort-Dialog.
 * Wirkt ausschließlich auf den LOKALEN Spieler (dich/Host) — die UE4SS-Mod ruft
 * AddItem_ServerInternal / RequestConsumeInventoryItem nur auf deinem eigenen
 * Inventar-Objekt auf; Gäste auf deinem Server haben eigene Objekte und bleiben
 * unberührt. Das Passwort ist nur ein Sichtschutz, keine echte Sicherung.
 */
import { state, on, emit, asset } from './state.js';

const PASSWORD = '0815';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let itemMap = new Map();     // id → item
let pickerTarget = null;     // Slot-Index, von dem der Picker geöffnet wurde
let invFilter = '';

export function initAdmin() {
  state.admin = { unlocked: false, inv: null, status: 'off' };
  buildDom();

  // Versteckter Einstieg: Dreifachklick aufs Logo
  const brand = document.querySelector('#topbar .brand');
  if (brand) {
    let clicks = 0, timer = null;
    brand.style.cursor = 'default';
    brand.addEventListener('click', () => {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(() => { clicks = 0; }, 600);
      if (clicks >= 3) { clicks = 0; openGate(); }
    });
  }
  // Alternativer Einstieg: Strg+Shift+A
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); openGate(); }
  });

  // Item-Nachschlage-Map aufbauen
  on('dataLoaded', () => {
    itemMap = new Map((state.data.items || []).map((it) => [it.id, it]));
  });

  // Live-Inventar-Updates
  state.bridge.onInventory((inv) => {
    state.admin.inv = inv;
    if (isAdminOpen()) renderInventory();
    updateConnBadge();
  });
  state.bridge.onInvStatus((s) => {
    state.admin.status = s.inv;
    updateConnBadge();
  });
}

export function isAdminOpen() {
  return $('#adminModal')?.classList.contains('open');
}

// ------------------------------------------------------------ DOM-Gerüst

function buildDom() {
  const gate = document.createElement('div');
  gate.id = 'adminGate';
  gate.innerHTML = `
    <div class="gate-card">
      <div class="gate-icon">${lock()}</div>
      <h3>Admin-Bereich</h3>
      <p>Passwort eingeben</p>
      <input id="gatePw" type="password" inputmode="numeric" autocomplete="off" placeholder="••••">
      <div class="gate-err" id="gateErr"></div>
      <div class="gate-actions">
        <button class="btn" id="gateCancel">Abbrechen</button>
        <button class="btn btn-acc" id="gateOk">Entsperren</button>
      </div>
    </div>`;
  document.body.appendChild(gate);

  const modal = document.createElement('div');
  modal.id = 'adminModal';
  document.body.appendChild(modal);

  $('#gateCancel').onclick = closeGate;
  $('#gateOk').onclick = tryUnlock;
  $('#gatePw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryUnlock();
    if (e.key === 'Escape') closeGate();
  });
  gate.addEventListener('click', (e) => { if (e.target === gate) closeGate(); });
}

// ------------------------------------------------------------ Passwort-Gate

function openGate() {
  if (state.admin.unlocked) { openAdmin(); return; }
  $('#adminGate').classList.add('open');
  $('#gateErr').textContent = '';
  const pw = $('#gatePw');
  pw.value = '';
  setTimeout(() => pw.focus(), 50);
}

function closeGate() { $('#adminGate').classList.remove('open'); }

function tryUnlock() {
  const val = $('#gatePw').value.trim();
  if (val === PASSWORD) {
    state.admin.unlocked = true;
    closeGate();
    openAdmin();
  } else {
    const err = $('#gateErr');
    err.textContent = 'Falsches Passwort';
    const card = $('#adminGate .gate-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    $('#gatePw').value = '';
    $('#gatePw').focus();
  }
}

// ------------------------------------------------------------ Admin-Panel

export function openAdmin() {
  const modal = $('#adminModal');
  modal.classList.add('open');
  modal.innerHTML = `
    <div class="modal-card admin-card">
      <header>
        <h2>${shield()} Admin · Inventar-Editor</h2>
        <div class="admin-head-right">
          <span class="conn-badge" id="connBadge"></span>
          <button class="icon-btn" id="adminClose">${x()}</button>
        </div>
      </header>
      <div class="admin-warn">
        ${info()}
        <div>Änderungen wirken <b>nur bei dir</b> (lokaler Spieler/Host). Andere Spieler auf deinem
        Server sind nie betroffen. <span id="adminModeNote"></span></div>
      </div>
      <div class="admin-toolbar">
        <button class="btn btn-acc" id="btnAddItem">${plus()} Item hinzufügen</button>
        <div class="admin-search">
          ${search()}
          <input id="invFilter" type="text" placeholder="Inventar filtern…" spellcheck="false">
        </div>
        <span class="admin-player" id="adminPlayer"></span>
      </div>
      <div class="inv-grid" id="invGrid"></div>
    </div>
    <div id="itemPicker" class="item-picker"></div>`;

  $('#adminClose').onclick = closeAdmin;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAdmin(); });
  $('#btnAddItem').onclick = () => openPicker(null);
  $('#invFilter').addEventListener('input', (e) => { invFilter = e.target.value.trim().toLowerCase(); renderInventory(); });

  updateConnBadge();
  renderInventory();
}

export function closeAdmin() {
  $('#adminModal')?.classList.remove('open');
  closePicker();
}

function updateConnBadge() {
  const badge = $('#connBadge');
  if (!badge) return;
  const s = state.admin.status;
  const map = {
    ok: ['ok', 'Verbunden — Live'],
    stale: ['stale', 'Keine frischen Daten'],
    off: ['off', state.mock ? 'Demo-Inventar' : 'Mod nicht verbunden'],
  };
  const [cls, txt] = map[s] || map.off;
  badge.className = 'conn-badge ' + cls;
  badge.innerHTML = `<span class="dot"></span>${txt}`;
  const note = $('#adminModeNote');
  if (note) note.textContent = state.mock ? '(Demo-Modus: Änderungen sind simuliert.)' : (s === 'off' ? '— starte Palworld mit der Inventar-Mod, um live zu bearbeiten.' : '');
  const player = $('#adminPlayer');
  if (player) player.textContent = state.admin.inv?.player ? `Spieler: ${state.admin.inv.player}` : '';
}

// ------------------------------------------------------------ Inventar-Grid

function renderInventory() {
  const grid = $('#invGrid');
  if (!grid) return;
  const inv = state.admin.inv;
  const size = Math.max(inv?.size || 42, (inv?.slots || []).reduce((m, s) => Math.max(m, s.slot + 1), 0));
  const bySlot = new Map((inv?.slots || []).map((s) => [s.slot, s]));

  const cells = [];
  for (let i = 0; i < size; i++) {
    const s = bySlot.get(i);
    if (s) {
      const it = itemMap.get(s.id);
      const name = it?.name || s.id;
      if (invFilter && !name.toLowerCase().includes(invFilter) && !s.id.toLowerCase().includes(invFilter)) continue;
      const iconUrl = it?.icon ? asset(it.icon) : '';
      const icon = iconUrl
        ? `<img src="${esc(iconUrl)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'inv-ph',textContent:'${esc((name[0] || '?'))}'}))">`
        : `<span class="inv-ph">${esc(name[0] || '?')}</span>`;
      cells.push(`
        <div class="inv-slot filled" data-id="${esc(s.id)}" title="${esc(s.id)}">
          <div class="inv-ico">${icon}</div>
          <div class="inv-name">${esc(name)}</div>
          <button class="inv-count" data-act="edit">${fmtCount(s.count)}</button>
          <div class="inv-hover">
            <button data-act="max" title="Auf Maximum">${up()}</button>
            <button data-act="del" title="Entfernen">${trash()}</button>
          </div>
        </div>`);
    } else {
      if (invFilter) continue;
      cells.push(`<button class="inv-slot empty" data-slot="${i}" title="Leerer Platz — Item hinzufügen">${plus()}</button>`);
    }
  }
  grid.innerHTML = cells.join('') || `<div class="inv-empty">Kein Treffer für „${esc(invFilter)}"</div>`;

  grid.querySelectorAll('.inv-slot.empty').forEach((el) => {
    el.onclick = () => openPicker(Number(el.dataset.slot));
  });
  grid.querySelectorAll('.inv-slot.filled').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('[data-act="edit"]').onclick = () => startCountEdit(el, id);
    el.querySelector('[data-act="max"]').onclick = () => {
      const max = itemMap.get(id)?.maxStack || 9999;
      sendCmd({ op: 'set', id, count: max }, `${itemMap.get(id)?.name || id} → ${fmtCount(max)}`);
    };
    el.querySelector('[data-act="del"]').onclick = () => sendCmd({ op: 'remove', id }, `${itemMap.get(id)?.name || id} entfernt`);
  });
}

function startCountEdit(cell, id) {
  const btn = cell.querySelector('.inv-count');
  const cur = state.admin.inv?.slots.find((s) => s.id === id)?.count ?? 0;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'inv-count-edit';
  input.value = cur;
  input.min = 0;
  input.max = itemMap.get(id)?.maxStack || 9999;
  btn.replaceWith(input);
  input.focus();
  input.select();
  const commit = (apply) => {
    if (apply) {
      const n = Math.max(0, Math.min(Number(input.value) || 0, itemMap.get(id)?.maxStack || 9999));
      const name = itemMap.get(id)?.name || id;
      if (n === 0) sendCmd({ op: 'remove', id }, `${name} entfernt`);
      else sendCmd({ op: 'set', id, count: n }, `${name} → ${fmtCount(n)}`);
    } else {
      renderInventory();
    }
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
  };
  input.onblur = () => commit(true);
}

// ------------------------------------------------------------ Item-Picker

function openPicker(slot) {
  pickerTarget = slot;
  const p = $('#itemPicker');
  p.classList.add('open');
  p.innerHTML = `
    <div class="picker-head">
      <b>${plus()} Item auswählen</b>
      <button class="icon-btn sm" id="pickClose">${x()}</button>
    </div>
    <div class="picker-search">
      ${search()}
      <input id="pickSearch" type="text" placeholder="Item suchen (Name)…" spellcheck="false" autocomplete="off">
    </div>
    <div class="picker-cats" id="pickCats"></div>
    <div class="picker-list" id="pickList"></div>
    <div class="picker-foot" id="pickFoot"></div>`;

  $('#pickClose').onclick = closePicker;
  const cats = ['Alle', ...uniqueCats()];
  $('#pickCats').innerHTML = cats.map((c, i) =>
    `<button class="pick-cat ${i === 0 ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('#pickCats').querySelectorAll('.pick-cat').forEach((el) => {
    el.onclick = () => {
      $('#pickCats .pick-cat.active')?.classList.remove('active');
      el.classList.add('active');
      renderPickList();
    };
  });
  $('#pickSearch').addEventListener('input', renderPickList);
  setTimeout(() => $('#pickSearch').focus(), 50);
  renderPickList();
}

function closePicker() {
  const p = $('#itemPicker');
  if (p) { p.classList.remove('open'); p.innerHTML = ''; }
  pickerTarget = null;
}

function uniqueCats() {
  const set = new Set((state.data.items || []).map((it) => it.catLabel).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

function renderPickList() {
  const list = $('#pickList');
  if (!list) return;
  const q = ($('#pickSearch')?.value || '').trim().toLowerCase();
  const cat = $('#pickCats .pick-cat.active')?.dataset.cat || 'Alle';
  let items = state.data.items || [];
  if (cat !== 'Alle') items = items.filter((it) => it.catLabel === cat);
  if (q) items = items.filter((it) => it.name.toLowerCase().includes(q) || (it.nameEn || '').toLowerCase().includes(q) || it.id.toLowerCase().includes(q));
  const shown = items.slice(0, 200);
  if (!shown.length) {
    list.innerHTML = `<div class="pick-empty">${state.data.items?.length ? 'Kein Item gefunden.' : 'Keine Item-Daten — „npm run fetch-assets" ausführen.'}</div>`;
    return;
  }
  list.innerHTML = shown.map((it) => {
    const iconUrl = it.icon ? asset(it.icon) : '';
    const icon = iconUrl
      ? `<img src="${esc(iconUrl)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'inv-ph sm',textContent:'${esc(it.name[0] || '?')}'}))">`
      : `<span class="inv-ph sm">${esc(it.name[0] || '?')}</span>`;
    return `<button class="pick-item" data-id="${esc(it.id)}">
      <span class="pick-ico">${icon}</span>
      <span class="pick-name">${esc(it.name)}</span>
      <span class="pick-cat-tag">${esc(it.catLabel || '')}</span>
    </button>`;
  }).join('');
  list.querySelectorAll('.pick-item').forEach((el) => {
    el.onclick = () => selectItem(el.dataset.id);
  });
  const foot = $('#pickFoot');
  if (foot) foot.textContent = items.length > shown.length ? `${shown.length} von ${items.length} — weiter eingrenzen` : `${shown.length} Items`;
}

function selectItem(id) {
  const it = itemMap.get(id);
  const list = $('#pickList');
  const max = it?.maxStack || 9999;
  list.innerHTML = `
    <div class="pick-confirm">
      <div class="pc-head">
        ${it?.icon ? `<img src="${esc(asset(it.icon))}" onerror="this.style.display='none'">` : ''}
        <div><b>${esc(it?.name || id)}</b><small>${esc(it?.catLabel || '')} · max. ${fmtCount(max)}</small></div>
      </div>
      <label>Menge</label>
      <div class="pc-qty">
        <button data-q="1">1</button>
        <button data-q="10">10</button>
        <button data-q="100">100</button>
        <button data-q="999">999</button>
        <button data-q="${max}">Max</button>
        <input id="pcCount" type="number" value="1" min="1" max="${max}">
      </div>
      <div class="pc-actions">
        <button class="btn" id="pcBack">Zurück</button>
        <button class="btn btn-acc" id="pcAdd">${plus()} Hinzufügen</button>
      </div>
    </div>`;
  const countInput = $('#pcCount');
  list.querySelectorAll('.pc-qty button').forEach((b) => {
    b.onclick = () => { countInput.value = b.dataset.q; countInput.focus(); };
  });
  $('#pcBack').onclick = renderPickList;
  const doAdd = () => {
    const n = Math.max(1, Math.min(Number(countInput.value) || 1, max));
    sendCmd({ op: 'add', id, count: n }, `${fmtCount(n)}× ${it?.name || id} hinzugefügt`);
    closePicker();
  };
  $('#pcAdd').onclick = doAdd;
  countInput.onkeydown = (e) => { if (e.key === 'Enter') doAdd(); };
  countInput.focus();
  countInput.select();
}

// ------------------------------------------------------------ Befehl senden

async function sendCmd(cmd, toastMsg) {
  try {
    const res = await state.bridge.invCommand(cmd);
    if (res && res.ok === false) {
      emit('toast', { icon: 'warn', msg: 'Befehl fehlgeschlagen: ' + (res.error || '?') });
    } else if (toastMsg) {
      emit('toast', { icon: 'check', msg: toastMsg });
    }
  } catch (e) {
    emit('toast', { icon: 'warn', msg: 'Befehl fehlgeschlagen: ' + (e?.message || e) });
  }
}

// ------------------------------------------------------------ Helfer

function fmtCount(n) {
  return Number(n).toLocaleString('de');
}

// Inline-SVGs (unabhängig von icons.js, damit Admin autark bleibt)
const lock = () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3zm3 4a1.5 1.5 0 0 1 .9 2.7V19h-1.8v-2.3A1.5 1.5 0 0 1 12 14z"/></svg>`;
const shield = () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5zm0 2.2L6 6.4V11c0 3.9 2.5 7.4 6 8.8 3.5-1.4 6-4.9 6-8.8V6.4z"/></svg>`;
const x = () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>`;
const plus = () => `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`;
const trash = () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z"/></svg>`;
const up = () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l7 7-1.4 1.4L13 7.8V20h-2V7.8L6.4 12.4 5 11z"/></svg>`;
const info = () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v2h-2zm0 4h2v6h-2z"/></svg>`;
const search = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 3a7 7 0 1 0 4.2 12.6l4.6 4.6 1.6-1.6-4.6-4.6A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>`;
