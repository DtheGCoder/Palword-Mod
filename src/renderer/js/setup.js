/**
 * Spiel-Setup-Assistent: fragt nur nach dem Palworld-Ordner (oder findet ihn
 * selbst) und erledigt den Rest automatisch — UE4SS-Download, Mod-Installation,
 * Aktivierung, Fenstermodus. Öffnet sich beim ersten Start von selbst.
 */
import { state, emit } from './state.js';
import { svg } from './icons.js';

const STEPS = [
  ['validate', 'Spielordner prüfen'],
  ['ue4ss', 'UE4SS-Modloader (automatischer Download von GitHub)'],
  ['mod', 'Positions-Mod „PalOverlayTracker" installieren'],
  ['modstxt', 'Mod aktivieren'],
  ['ini', 'Palworld auf „Vollbild (Fenster)" stellen'],
];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let running = false;

export function initSetup() {
  $('#setupModal').innerHTML = `
    <div class="modal-card setup-card">
      <header>
        <h2>${svg('compass', 18)} Spiel-Setup — alles automatisch</h2>
        <button class="icon-btn" id="suClose">${svg('x', 16)}</button>
      </header>
      <div class="modal-body">
        <p class="hint" style="margin-bottom:14px">
          PalPilot richtet die <b>Live-Position</b> selbst ein: Modloader laden, Mod installieren,
          Fenstermodus umstellen. Du musst nur bestätigen, wo Palworld liegt.
        </p>
        <div class="set-row">
          <label style="min-width:auto">Palworld-Ordner</label>
          <input id="suPath" type="text" spellcheck="false" placeholder="z.B. C:\\Program Files (x86)\\Steam\\steamapps\\common\\Palworld">
          <button class="btn sm" id="suBrowse">${svg('folder', 12)} Durchsuchen…</button>
        </div>
        <div id="suFound" class="su-found"></div>
        <div class="su-steps" id="suSteps">
          ${STEPS.map(([id, label]) => `
            <div class="su-step" data-step="${id}">
              <span class="s-dot pending"></span>
              <div class="s-body"><span class="s-label">${label}</span><small class="s-msg"></small></div>
            </div>`).join('')}
        </div>
        <div id="suDone" class="su-done" style="display:none">
          ${svg('check', 18)} <div><b>Fertig!</b> Starte Palworld — sobald du im Spiel bist, wird der
          Status oben rechts grün: <b>„Live · UE4SS"</b>. Overlay-Karte: <kbd>F6</kbd>, HUD: <kbd>F7</kbd>.</div>
        </div>
        <div class="su-actions">
          <button class="btn" id="suLater">Später</button>
          <button class="btn btn-acc" id="suRun">${svg('play', 13)} Automatisch einrichten</button>
        </div>
      </div>
    </div>`;

  $('#suClose').onclick = () => closeSetup();
  $('#suLater').onclick = () => closeSetup();
  $('#setupModal').addEventListener('click', (e) => { if (e.target.id === 'setupModal') closeSetup(); });
  $('#suBrowse').onclick = async () => {
    const p = await state.bridge.setupPick();
    if (p) $('#suPath').value = p;
  };
  $('#suRun').onclick = runNow;

  state.bridge.onSetupProgress(applyProgress);

  // Beim ersten echten Start automatisch anbieten
  if (state.bridge.real && !state.settings.game?.setupDone) {
    setTimeout(() => openSetup(), 600);
  }
}

export async function openSetup() {
  const modal = $('#setupModal');
  modal.classList.add('open');
  resetSteps();
  $('#suDone').style.display = 'none';
  $('#suPath').value = state.settings.game?.path || '';
  const foundBox = $('#suFound');
  foundBox.innerHTML = '<small class="hint">Suche Palworld-Installationen…</small>';
  try {
    const found = await state.bridge.setupDetect();
    if (found.length) {
      if (!$('#suPath').value) $('#suPath').value = found[0];
      foundBox.innerHTML = '<small class="hint">Gefunden:</small> ' + found.map((p) =>
        `<button class="chip su-chip" data-p="${esc(p)}">${svg('folder', 12)}<span>${esc(p)}</span></button>`).join('');
      foundBox.querySelectorAll('.su-chip').forEach((el) => {
        el.onclick = () => { $('#suPath').value = el.dataset.p; };
      });
    } else {
      foundBox.innerHTML = '<small class="hint">Keine Installation automatisch gefunden — bitte Ordner wählen (der mit „Pal" und „Palworld.exe").</small>';
    }
  } catch {
    foundBox.innerHTML = '';
  }
}

export function closeSetup() {
  $('#setupModal').classList.remove('open');
}

export function isSetupOpen() {
  return $('#setupModal')?.classList.contains('open');
}

function resetSteps() {
  document.querySelectorAll('.su-step').forEach((el) => {
    el.querySelector('.s-dot').className = 's-dot pending';
    el.querySelector('.s-msg').textContent = '';
  });
}

function applyProgress({ step, status, msg }) {
  const el = document.querySelector(`.su-step[data-step="${step}"]`);
  if (!el) return;
  el.querySelector('.s-dot').className = 's-dot ' + status;
  el.querySelector('.s-msg').textContent = msg || '';
}

async function runNow() {
  if (running) return;
  const gamePath = $('#suPath').value.trim();
  if (!gamePath) {
    emit('toast', { icon: 'warn', msg: 'Bitte zuerst den Palworld-Ordner angeben' });
    return;
  }
  running = true;
  const btn = $('#suRun');
  btn.disabled = true;
  btn.innerHTML = `${svg('gear', 13)} Richte ein…`;
  resetSteps();
  $('#suDone').style.display = 'none';
  try {
    const result = await state.bridge.setupRun(gamePath);
    if (result?.ok) {
      $('#suDone').style.display = 'flex';
      emit('toast', { icon: 'check', msg: 'Spiel-Setup abgeschlossen — Palworld starten!' });
      btn.innerHTML = `${svg('check', 13)} Eingerichtet`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `${svg('play', 13)} Erneut versuchen`;
    }
  } catch (e) {
    emit('toast', { icon: 'warn', msg: 'Setup-Fehler: ' + (e?.message || e) });
    btn.disabled = false;
    btn.innerHTML = `${svg('play', 13)} Erneut versuchen`;
  }
  running = false;
}
