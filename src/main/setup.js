'use strict';
/**
 * Automatisches Spiel-Setup:
 *   1. Palworld-Installation finden/prüfen
 *   2. UE4SS (Okaetsu-Build für Palworld) herunterladen & entpacken — falls nicht vorhanden
 *   3. PalOverlayTracker-Mod hineinkopieren + in mods.txt eintragen
 *   4. Fenstermodus des Spiels auf "Vollbild (Fenster)" stellen (Backup wird angelegt)
 *
 * Alle Schritte melden Fortschritt über einen Callback: prog(stepId, status, msg)
 *   stepId: validate | ue4ss | mod | modstxt | ini
 *   status: run | ok | warn | err
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const UE4SS_RELEASE_API = 'https://api.github.com/repos/Okaetsu/RE-UE4SS/releases/tags/experimental-palworld';

function execP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

// ------------------------------------------------------------ Erkennung

async function detectPalworld() {
  const found = [];
  const tryAdd = (p) => {
    try {
      const r = path.resolve(p);
      if (fs.existsSync(path.join(r, 'Pal', 'Binaries')) && !found.includes(r)) found.push(r);
    } catch { /* egal */ }
  };

  const libs = [];
  try {
    const out = await execP('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
    const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
    if (m) {
      const steam = m[1].trim().replace(/\//g, '\\');
      libs.push(steam);
      try {
        const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const mm of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(mm[1].replace(/\\\\/g, '\\'));
      } catch { /* keine vdf */ }
    }
  } catch { /* kein Steam in Registry */ }

  for (const d of 'CDEFGSTUVW') {
    libs.push(`${d}:\\SteamLibrary`, `${d}:\\Steam`, `${d}:\\Program Files (x86)\\Steam`, `${d}:\\Games\\Steam`);
  }
  for (const lib of libs) tryAdd(path.join(lib, 'steamapps', 'common', 'Palworld'));
  for (const d of 'CDEF') tryAdd(`${d}:\\XboxGames\\Palworld\\Content`);
  return found;
}

function binDir(gamePath) {
  for (const b of ['Win64', 'WinGDK']) {
    const p = path.join(gamePath, 'Pal', 'Binaries', b);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function ue4ssModsDir(bin) {
  for (const m of [path.join(bin, 'ue4ss', 'Mods'), path.join(bin, 'Mods')]) {
    if (fs.existsSync(m)) return m;
  }
  return null;
}

// ------------------------------------------------------------ UE4SS-Download

async function fetchWithUa(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PalPilot-Setup/1.0', Accept: 'application/octet-stream, application/vnd.github+json' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  return res;
}

async function installUe4ss(bin, prog) {
  prog('ue4ss', 'run', 'Suche aktuellen UE4SS-Palworld-Build auf GitHub…');
  const rel = await (await fetchWithUa(UE4SS_RELEASE_API)).json();
  const assets = rel.assets || [];
  const asset = assets.find((a) => /^UE4SS-Palworld\.zip$/i.test(a.name))
    || assets.find((a) => /UE4SS.*\.zip$/i.test(a.name) && !/zDev/i.test(a.name));
  if (!asset) throw new Error('UE4SS-Palworld.zip im Release nicht gefunden — bitte manuell installieren (INSTALL.md)');

  prog('ue4ss', 'run', `Lade ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)…`);
  const res = await fetchWithUa(asset.browser_download_url);
  const zipPath = path.join(os.tmpdir(), 'palpilot_ue4ss.zip');
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

  prog('ue4ss', 'run', 'Entpacke in den Spielordner…');
  await execP('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${bin}" -Force`,
  ]);
  fs.rmSync(zipPath, { force: true });

  const mods = ue4ssModsDir(bin);
  if (!mods) throw new Error('Entpacken ok, aber kein Mods-Ordner gefunden — Zip-Struktur unerwartet');
  return { mods, version: rel.name || rel.tag_name || 'experimental-palworld' };
}

// ------------------------------------------------------------ Mod & Config

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Ersetzt die Pfad-Konstanten in main.lua durch absolute Pfade, die exakt den
// Overlay-Leseorten entsprechen. So passen Spiel-Schreibort und Overlay-Leseort
// garantiert zusammen, egal wie TEMP im Spielprozess aufgelöst wird.
function patchModPaths(modDir, paths) {
  if (!paths) return false;
  const luaEsc = (p) => String(p).replace(/\\/g, '\\\\');
  const file = path.join(modDir, 'Scripts', 'main.lua');
  try {
    let lua = fs.readFileSync(file, 'utf8');
    const block =
      'local TEMP = os.getenv("TEMP") or "C:\\\\Windows\\\\Temp"\n' +
      `local OUT_POS = "${luaEsc(paths.ue4ssFile)}"\n` +
      `local OUT_INV = "${luaEsc(paths.invFile)}"\n` +
      `local CMD     = "${luaEsc(paths.cmdFile)}"`;
    // Ersetzt den ursprünglichen 4-Zeilen-Pfadblock (TEMP + drei Ableitungen)
    const re = /local TEMP = os\.getenv\("TEMP"\)[^\n]*\nlocal OUT_POS[^\n]*\nlocal OUT_INV[^\n]*\nlocal CMD[^\n]*/;
    if (!re.test(lua)) return false;
    lua = lua.replace(re, block);
    fs.writeFileSync(file, lua, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function patchGameUserSettings(prog) {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Pal', 'Saved', 'Config', 'Windows', 'GameUserSettings.ini'),
    path.join(process.env.LOCALAPPDATA || '', 'Pal', 'Saved', 'Config', 'WinGDK', 'GameUserSettings.ini'),
  ];
  const ini = candidates.find((c) => fs.existsSync(c));
  if (!ini) {
    prog('ini', 'warn', 'Spiel-Config noch nicht vorhanden (Palworld einmal starten). Bitte im Spiel: Optionen → Grafik → „Vollbild (Fenster)".');
    return false;
  }
  let text = fs.readFileSync(ini, 'utf8');
  const before = text;
  // UE-Standard: 0 = exklusives Vollbild, 1 = randlos, 2 = Fenster
  text = text.replace(/^(\s*(?:FullscreenMode|LastConfirmedFullscreenMode|PreferredFullscreenMode)\s*=\s*)[02]\s*$/gmi, '$11');
  // Palworld-eigene Screenmode-Strings (falls vorhanden)
  text = text.replace(/=\s*FullScreen\s*$/gmi, (m) => m.replace(/FullScreen/i, 'WindowFullScreen'));
  if (text === before) {
    prog('ini', 'ok', 'Fenstermodus passt bereits (oder Einstellung nicht in der Config — im Zweifel im Spiel prüfen).');
    return true;
  }
  fs.copyFileSync(ini, ini + '.palpilot.bak');
  fs.writeFileSync(ini, text, 'utf8');
  prog('ini', 'ok', 'Fenstermodus auf „Vollbild (Fenster)" gestellt (Backup: GameUserSettings.ini.palpilot.bak).');
  return true;
}

// ------------------------------------------------------------ Gesamtablauf

/**
 * @param {string} ROOT Projektwurzel (enthält ue4ss-mod/PalOverlayTracker)
 * @param {string} gamePath z.B. D:\SteamLibrary\steamapps\common\Palworld
 * @param {(step:string,status:string,msg:string)=>void} prog
 */
async function runSetup(ROOT, gamePath, prog, paths) {
  const result = { ok: false, gamePath, modsDir: null, warnings: 0 };
  const warn = (step, msg) => { result.warnings++; prog(step, 'warn', msg); };

  // 1) Validieren
  prog('validate', 'run', 'Prüfe Spielordner…');
  const bin = binDir(gamePath || '');
  if (!bin) {
    prog('validate', 'err', 'Das ist kein Palworld-Ordner (Pal\\Binaries\\Win64 fehlt). Bitte den Ordner wählen, der „Pal" und „Palworld.exe" enthält.');
    return result;
  }
  prog('validate', 'ok', `Spiel gefunden: ${bin}`);

  // 2) UE4SS
  let mods = ue4ssModsDir(bin);
  if (mods) {
    prog('ue4ss', 'ok', `UE4SS ist bereits installiert (${path.relative(bin, mods)}) — Download übersprungen.`);
  } else {
    try {
      const r = await installUe4ss(bin, prog);
      mods = r.mods;
      prog('ue4ss', 'ok', `UE4SS installiert (${r.version}).`);
    } catch (e) {
      prog('ue4ss', 'err', `UE4SS-Installation fehlgeschlagen: ${e.message}. Alternative: Steam-Workshop „UE4SS Experimental (Palworld)" abonnieren, dann Setup erneut ausführen.`);
      return result;
    }
  }
  result.modsDir = mods;

  // 3) Mod kopieren + Dateipfade auf die EXAKTEN Overlay-Pfade patchen
  //    (verhindert TEMP-Mismatch zwischen Spiel-Prozess und Overlay → „Mod nicht verbunden")
  prog('mod', 'run', 'Kopiere PalOverlayTracker-Mod…');
  try {
    const src = path.join(ROOT, 'ue4ss-mod', 'PalOverlayTracker');
    const dst = path.join(mods, 'PalOverlayTracker');
    copyDirSync(src, dst);
    const patched = patchModPaths(dst, paths);
    prog('mod', 'ok', `Mod installiert${patched ? ' (Pfade fest verdrahtet)' : ''}: ${dst}`);
  } catch (e) {
    prog('mod', 'err', `Kopieren fehlgeschlagen: ${e.message}${/EPERM|EACCES/.test(String(e.code)) ? ' — Ordner ist schreibgeschützt, PalPilot einmal als Administrator starten.' : ''}`);
    return result;
  }

  // 4) mods.txt
  try {
    const modsTxt = path.join(mods, 'mods.txt');
    if (fs.existsSync(modsTxt)) {
      const t = fs.readFileSync(modsTxt, 'utf8');
      if (!/PalOverlayTracker/.test(t)) {
        fs.writeFileSync(modsTxt, t.replace(/\s*$/, '\r\n') + 'PalOverlayTracker : 1\r\n', 'utf8');
        prog('modstxt', 'ok', 'In mods.txt eingetragen.');
      } else {
        prog('modstxt', 'ok', 'mods.txt-Eintrag war schon da.');
      }
    } else {
      prog('modstxt', 'ok', 'Keine mods.txt nötig — enabled.txt der Mod übernimmt die Aktivierung.');
    }
  } catch (e) {
    warn('modstxt', `mods.txt nicht anpassbar (${e.message}) — enabled.txt der Mod reicht normalerweise.`);
  }

  // 5) Fenstermodus
  try {
    patchGameUserSettings(prog);
  } catch (e) {
    warn('ini', `Config nicht anpassbar (${e.message}) — bitte im Spiel „Vollbild (Fenster)" wählen.`);
  }

  result.ok = true;
  return result;
}

module.exports = { detectPalworld, runSetup, binDir, ue4ssModsDir };
