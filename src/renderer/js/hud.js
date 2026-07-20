/**
 * Click-Through-HUD: runde Minimap + Navigationsbanner + Toasts.
 * Wird im HUD-Modus über dem Spiel angezeigt (Maus geht durchs Fenster hindurch).
 */
import { state, on } from './state.js';
import { fmtGame, fmtDist } from './transform.js';
import { smoothAngle } from './transform.js';
import { svg } from './icons.js';

let canvas, ctx, cluster, banner, arrowEl, nameEl, metaEl, statusDot, regionEl, coordsEl;
const images = {};       // regionId → HTMLImageElement
let timer = null;
let raf = 0;
let lastFrameAt = 0;
let lastDrawTs = 0;
let rp = null;           // interpolierte Kartenmitte + Blickrichtung (flüssiges Gleiten)
let vignette = null;     // gecachter Vignetten-Gradient (nur bei Größenänderung neu)
let vignetteR = 0;

export function initHud() {
  const root = document.getElementById('hudRoot');
  root.innerHTML = `
    <div id="hudCluster">
      <div id="minimapWrap">
        <canvas id="minimap"></canvas>
        <div id="hudStatus">
          <span class="dot" id="hudDot"></span>
          <span id="hudRegion">–</span>
          <span id="hudCoords" class="mono"></span>
        </div>
      </div>
      <div id="navBanner" class="hidden">
        <div class="nav-arrow" id="navArrow">${svg('arrow', 26)}</div>
        <div class="nav-info">
          <b id="navName">–</b>
          <div id="navMeta">–</div>
        </div>
      </div>
    </div>
    <div id="toastStack"></div>`;

  canvas = document.getElementById('minimap');
  ctx = canvas.getContext('2d');
  cluster = document.getElementById('hudCluster');
  banner = document.getElementById('navBanner');
  arrowEl = document.getElementById('navArrow');
  nameEl = document.getElementById('navName');
  metaEl = document.getElementById('navMeta');
  statusDot = document.getElementById('hudDot');
  regionEl = document.getElementById('hudRegion');
  coordsEl = document.getElementById('hudCoords');

  applyHudSettings();
  on('settings', applyHudSettings);
  on('toast', showToast);
  // Flüssiges Rendern via requestAnimationFrame, aber auf ~33 fps gedrosselt
  // (reicht mit der Positions-Interpolation völlig und spart auf 120/144-Hz-
  // Monitoren massiv Leistung). Watchdog-Timer zeichnet weiter, falls der
  // Compositor rAF pausiert (Overlay als „verdeckt" eingestuft).
  cancelAnimationFrame(raf);
  const frame = (ts) => {
    raf = requestAnimationFrame(frame);
    lastFrameAt = ts;
    if (ts - lastDrawTs >= 30) { lastDrawTs = ts; tick(); }
  };
  raf = requestAnimationFrame(frame);
  clearInterval(timer);
  timer = setInterval(() => { if (performance.now() - lastFrameAt > 120) tick(); }, 100);
}

function applyHudSettings() {
  const hud = state.settings?.hud || {};
  const size = Math.max(180, Math.min(460, hud.size || 280));
  cluster.style.setProperty('--size', size + 'px');
  cluster.style.opacity = hud.opacity ?? 0.95;
  if (hud.corner === 'custom' && hud.customPos) {
    cluster.className = 'corner-custom';
    cluster.style.left = Math.max(0, Math.min(window.innerWidth - size, hud.customPos.x)) + 'px';
    cluster.style.top = Math.max(0, Math.min(window.innerHeight - size, hud.customPos.y)) + 'px';
    cluster.style.right = cluster.style.bottom = 'auto';
  } else {
    cluster.className = 'corner-' + (hud.corner || 'top-right');
    cluster.style.left = cluster.style.top = cluster.style.right = cluster.style.bottom = '';
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vignette = null;   // Größe/Transform geändert → Gradient neu erzeugen
}

// Platzierungs-Modus: Minimap frei per Drag positionieren.
let placing = false;
export function toggleHudPlacement(on) {
  placing = on ?? !placing;
  state.placingHud = placing;
  document.body.classList.toggle('placing-hud', placing);
  let bar = document.getElementById('hudPlaceBar');
  if (placing) {
    if (!state.settings.hud.customPos) {
      const r = cluster.getBoundingClientRect();
      state.settings.hud.customPos = { x: r.left, y: r.top };
    }
    state.settings.hud.corner = 'custom';
    applyHudSettings();
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'hudPlaceBar';
      bar.innerHTML = `<span>${svg('target', 14)} Minimap ziehen zum Platzieren</span>
        <button class="btn sm" id="hudPlaceReset">Ecke oben-rechts</button>
        <button class="btn btn-acc sm" id="hudPlaceDone">Fertig</button>`;
      document.body.appendChild(bar);
      document.getElementById('hudPlaceDone').onclick = () => toggleHudPlacement(false);
      document.getElementById('hudPlaceReset').onclick = () => {
        state.bridge.setSettings({ hud: { corner: 'top-right', customPos: null } });
        state.settings.hud.corner = 'top-right'; state.settings.hud.customPos = null;
        applyHudSettings();
      };
    }
    attachDrag();
  } else {
    if (bar) bar.remove();
    // Position persistent speichern
    state.bridge.setSettings({ hud: { corner: 'custom', customPos: state.settings.hud.customPos } });
  }
}

let dragAttached = false;
function attachDrag() {
  if (dragAttached) return;   // nur einmal registrieren
  dragAttached = true;
  let sx, sy, ox, oy, dragging = false;
  const down = (e) => {
    if (!placing) return;
    dragging = true;
    const r = cluster.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    e.preventDefault();
  };
  const move = (e) => {
    if (!dragging || !placing) return;
    const size = parseInt(cluster.style.getPropertyValue('--size')) || 280;
    const x = Math.max(0, Math.min(window.innerWidth - size, ox + e.clientX - sx));
    const y = Math.max(0, Math.min(window.innerHeight - size, oy + e.clientY - sy));
    state.settings.hud.customPos = { x, y };
    cluster.style.left = x + 'px'; cluster.style.top = y + 'px';
    cluster.style.right = cluster.style.bottom = 'auto';
  };
  const up = () => { dragging = false; };
  cluster.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

async function regionImage(regionId) {
  if (images[regionId] !== undefined) return images[regionId];
  images[regionId] = null; // markiert „lädt"
  const cfg = state.data.regions?.[regionId];
  if (!cfg) return null;
  const url = await state.bridge.assetUrl(cfg.image);
  if (!url) return null;
  const img = new Image();
  img.src = url;
  img.onload = () => { images[regionId] = img; };
  img.onerror = () => { images[regionId] = null; };
  return null;
}

function tick() {
  const hud = state.settings?.hud || {};
  const show = (state.mode === 'hud' && hud.enabled !== false) || state.placingHud;
  cluster.style.display = show ? 'flex' : 'none';
  if (!show || hud.minimap === false) return;
  draw();
  updateBanner();
  updateStatus();
}

function draw() {
  const hud = state.settings.hud;
  const size = parseInt(cluster.style.getPropertyValue('--size')) || 280;
  const R = size / 2;
  ctx.clearRect(0, 0, size, size);

  const p = state.player;
  ctx.save();
  ctx.beginPath();
  ctx.arc(R, R, R - 3, 0, Math.PI * 2);
  ctx.clip();

  // Hintergrund
  ctx.fillStyle = '#0a1420';
  ctx.fillRect(0, 0, size, size);

  if (!p) {
    ctx.restore();
    drawWaiting(R);
    return;
  }

  const rm = state.math[p.region];
  const img = images[p.region];
  if (img === undefined || (img === null && !images['__req_' + p.region])) {
    images['__req_' + p.region] = true;
    regionImage(p.region);
  }

  // Sanfte Interpolation von Kartenmitte + Blickrichtung. Die Live-Position
  // kommt nur ~5×/s — durch das Nachziehen pro Frame gleitet die Karte flüssig,
  // ohne höhere Datenrate und ohne Mehrkosten (nur eine Lerp).
  if (!rp || rp.region !== p.region) rp = { wx: p.wx, wy: p.wy, heading: p.headingDeg || 0, region: p.region };
  else if (Math.hypot(p.wx - rp.wx, p.wy - rp.wy) > 20000) { rp.wx = p.wx; rp.wy = p.wy; } // Teleport/Schnellreise → sofort springen
  rp.wx += (p.wx - rp.wx) * 0.22;
  rp.wy += (p.wy - rp.wy) * 0.22;
  rp.heading = smoothAngle(rp.heading, p.headingDeg || 0, 0.22);

  const coverM = 620 / (hud.zoom || 2.4);              // Radius-Abdeckung in Metern
  const radiusImgPx = (coverM * 100) / rm.cmPerPx;
  const k = (R - 3) / radiusImgPx;                     // Screen-px pro Bild-px
  const pp = rm.worldToPx(rp.wx, rp.wy);
  const rot = hud.rotate ? (-(rp.heading || 0) * Math.PI) / 180 : 0;

  if (img) {
    ctx.save();
    ctx.translate(R, R);
    if (rot) ctx.rotate(rot);
    ctx.scale(k, k);
    ctx.translate(-pp.px, -pp.py);
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    // Vignette (gecachter Gradient — nur bei Größenänderung neu erzeugen)
    if (!vignette || vignetteR !== R) {
      vignette = ctx.createRadialGradient(R, R, R * 0.55, R, R, R);
      vignette.addColorStop(0, 'rgba(5,10,18,0)');
      vignette.addColorStop(1, 'rgba(5,10,18,0.55)');
      vignetteR = R;
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = '#122132';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(160,190,220,0.5)';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Karte lädt…', R, R + 30);
  }

  const toScreen = (wx, wy) => {
    const q = rm.worldToPx(wx, wy);
    let dx = (q.px - pp.px) * k, dy = (q.py - pp.py) * k;
    if (rot) {
      const c = Math.cos(rot), s = Math.sin(rot);
      [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    }
    return { x: R + dx, y: R + dy, dist: Math.hypot(dx, dy) };
  };

  // Spur
  const trail = state.settings.map?.showTrail ? state.trail : [];
  if (trail.length > 1) {
    ctx.strokeStyle = 'rgba(70,200,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const t of trail) {
      if (t.region !== p.region) continue;
      const s = toScreen(t.wx, t.wy);
      if (!started) { ctx.moveTo(s.x, s.y); started = true; } else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
  }

  // Wegpunkte
  const activeId = state.settings?.map?.nav?.activeWaypointId;
  for (const wp of state.waypoints) {
    if ((wp.region || 'palpagos') !== p.region) continue;
    const s = toScreen(wp.wx, wp.wy);
    const isActive = wp.id === activeId;
    if (s.dist < R - 14) {
      ctx.fillStyle = wp.color || '#46c8ff';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, isActive ? 6 : 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (isActive) {
        ctx.strokeStyle = wp.color || '#ffd34d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 9 + Math.sin(performance.now() / 220) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (isActive) {
      // Pfeil am Rand Richtung Ziel
      const ang = Math.atan2(s.y - R, s.x - R);
      const ex = R + Math.cos(ang) * (R - 16);
      const ey = R + Math.sin(ang) * (R - 16);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = wp.color || '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(7, 7); ctx.lineTo(-7, 7); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Navigationslinie
  const info = state.navInfo;
  if (info && info.sameRegion) {
    const t = toScreen(info.wp.wx, info.wp.wy);
    ctx.strokeStyle = 'rgba(255,211,77,0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(R, R);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Spieler (Mitte)
  const headScreen = hud.rotate ? 0 : ((rp.heading || 0) * Math.PI) / 180;
  ctx.save();
  ctx.translate(R, R);
  ctx.rotate(headScreen);
  const cone = ctx.createLinearGradient(0, -26, 0, 0);
  cone.addColorStop(0, 'rgba(70,200,255,0)');
  cone.addColorStop(1, 'rgba(70,200,255,0.45)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-11, -26); ctx.lineTo(11, -26); ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = p.fresh ? '#46c8ff' : '#8ba3c0';
  ctx.strokeStyle = '#eaf6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(R, R, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Nord-Marker
  const nAng = rot;
  const nx = R + Math.sin(nAng) * (R - 13) * 0 + Math.cos(nAng - Math.PI / 2) * (R - 13);
  const ny = R + Math.sin(nAng - Math.PI / 2) * (R - 13);
  ctx.fillStyle = 'rgba(232,242,255,0.9)';
  ctx.font = 'bold 11px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', nx, ny);

  ctx.restore();

  // Maßstabsring-Label
  ctx.fillStyle = 'rgba(180,205,230,0.55)';
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`⌀ ${fmtDist(coverM * 2)}`, R, size - 12);
}

function drawWaiting(R) {
  const t = performance.now() / 1000;
  ctx.strokeStyle = `rgba(70,200,255,${0.5 + Math.sin(t * 3) * 0.3})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(R, R, 14 + Math.sin(t * 3) * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,220,240,0.75)';
  ctx.font = '12px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Warte auf Spielerposition…', R, R + 38);
  ctx.fillStyle = 'rgba(140,165,190,0.6)';
  ctx.font = '10px "Segoe UI", sans-serif';
  const st = state.posStatus || {};
  let hint;
  if (st.ue4ss === 'stale') hint = 'Läuft Palworld noch? (Menü/Ladescreen zählt nicht)';
  else if (st.rest === 'error') hint = 'REST-API prüfen (Host/Port/Passwort)';
  else if (state.settings?.game?.setupDone) hint = 'Starte Palworld mit der Mod';
  else hint = 'F6 → Status oben → „Spiel-Setup"';
  ctx.fillText(hint, R, R + 54);
}

function updateBanner() {
  const info = state.navInfo;
  const show = !!info && state.settings?.hud?.navBanner !== false;
  banner.classList.toggle('hidden', !show);
  if (!show) return;
  nameEl.textContent = info.wp.name;
  const eta = Number.isFinite(info.etaS)
    ? `${Math.floor(info.etaS / 60)}:${String(Math.round(info.etaS % 60)).padStart(2, '0')} min`
    : '–';
  metaEl.textContent = info.sameRegion
    ? `${fmtDist(info.dist)} · ${eta}`
    : 'Ziel in anderer Region';
  arrowEl.style.transform = `rotate(${info.rel}deg)`;
  arrowEl.classList.toggle('near', info.dist < 60);
}

function updateStatus() {
  const p = state.player;
  const st = state.posStatus;
  const cls = st.ue4ss === 'ok' || st.rest === 'ok' ? 'ok' : (p ? 'stale' : 'off');
  statusDot.className = 'dot ' + cls;
  const cfg = p ? state.data.regions?.[p.region] : null;
  regionEl.textContent = cfg ? cfg.title : 'Keine Position';
  if (p) {
    const g = state.math[p.region].worldToGame(p.wx, p.wy);
    coordsEl.textContent = fmtGame(g);
  } else {
    coordsEl.textContent = '';
  }
}

// ------------------------------------------------------------ Toasts

function showToast({ icon = 'info', msg, sticky = false }) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${svg(icon, 15)}<span>${escapeHtml(msg)}</span>`;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, sticky ? 9000 : 3500);
  while (stack.children.length > 4) stack.firstChild.remove();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
