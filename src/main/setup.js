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

// Findet die UE4SS-settings.ini (neues Layout: bin\ue4ss\, altes: bin\).
function ue4ssSettingsFile(bin) {
  for (const p of [path.join(bin, 'ue4ss', 'UE4SS-settings.ini'), path.join(bin, 'UE4SS-settings.ini')]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Schaltet das UE4SS-Konsolenfenster ein, damit der Nutzer sieht, ob UE4SS
// (und damit unsere Mod) überhaupt geladen wird. Ohne Konsole wirkt alles tot.
function enableUe4ssConsole(bin) {
  const ini = ue4ssSettingsFile(bin);
  if (!ini) return false;
  try {
    let text = fs.readFileSync(ini, 'utf8');
    const before = text;
    const setKey = (key, val) => {
      const re = new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, 'mi');
      if (re.test(text)) text = text.replace(re, `$1${val}`);
    };
    setKey('ConsoleEnabled', 1);
    setKey('GuiConsoleEnabled', 1);
    setKey('GuiConsoleVisible', 1);
    if (text !== before) {
      fs.copyFileSync(ini, ini + '.palpilot.bak');
      fs.writeFileSync(ini, text, 'utf8');
      return true;
    }
  } catch { /* egal — Konsole ist nur ein Komfort-Feature */ }
  return false;
}

// Prüft gründlich, ob UE4SS wirklich injiziert werden kann. Ohne die
// Loader-DLL neben Palworld-Win64-Shipping.exe startet UE4SS nie — dann läuft
// auch unsere Lua-Mod nicht und das Overlay bleibt „Mod nicht aktiv".
// @returns {{ok:boolean, bin:string, platform:string, loaderDll:string|null,
//            hasCore:boolean, modsDir:string|null, modInstalled:boolean,
//            modEnabled:boolean, wrongModDir:string|null, problems:string[]}}
function diagnoseUe4ss(bin, gamePath) {
  const problems = [];
  const platform = /WinGDK/i.test(bin) ? 'Xbox/GamePass (WinGDK)' : 'Steam (Win64)';

  // 1) Loader-DLL (Proxy) direkt neben der Spiel-EXE?
  const loaders = ['dwmapi.dll', 'ue4ss.dll', 'xinput1_3.dll', 'dinput8.dll', 'bitfix.dll'];
  const loaderDll = loaders.find((d) => fs.existsSync(path.join(bin, d))) || null;
  if (!loaderDll) {
    problems.push('Keine UE4SS-Loader-DLL (z. B. dwmapi.dll) neben Palworld-Win64-Shipping.exe — UE4SS wird so NICHT geladen.');
  }

  // 2) UE4SS-Kern vorhanden?
  const coreCandidates = [
    path.join(bin, 'ue4ss', 'UE4SS.dll'),
    path.join(bin, 'UE4SS.dll'),
    path.join(bin, 'ue4ss', 'dwmapi.dll'),
  ];
  const hasCore = coreCandidates.some((p) => fs.existsSync(p)) || fs.existsSync(path.join(bin, 'ue4ss'));
  if (!hasCore) problems.push('UE4SS-Kern (Ordner „ue4ss" / UE4SS.dll) fehlt im Binaries-Ordner.');

  // 3) Mods-Ordner + unsere Mod
  const modsDir = ue4ssModsDir(bin);
  let modInstalled = false, modEnabled = false;
  if (modsDir) {
    const md = path.join(modsDir, 'PalOverlayTracker');
    modInstalled = fs.existsSync(path.join(md, 'Scripts', 'main.lua'));
    modEnabled = fs.existsSync(path.join(md, 'enabled.txt'));
    if (modInstalled && !modEnabled) problems.push('Mod liegt da, ist aber nicht aktiviert (enabled.txt fehlt).');
  } else {
    problems.push('Kein UE4SS-Mods-Ordner (bin\\ue4ss\\Mods bzw. bin\\Mods) gefunden.');
  }

  // 4) Häufiger Fehler: Mod im FALSCHEN Ordner (Spielwurzel\Mods oder ~mods)
  let wrongModDir = null;
  const wrongCandidates = [
    path.join(gamePath || '', 'Mods', 'PalOverlayTracker'),
    path.join(gamePath || '', 'Pal', 'Content', 'Paks', '~mods', 'PalOverlayTracker'),
  ];
  for (const w of wrongCandidates) {
    if (fs.existsSync(w)) { wrongModDir = path.dirname(w); break; }
  }
  if (wrongModDir) {
    problems.push(`Mod liegt zusätzlich im FALSCHEN Ordner: ${wrongModDir} — dort lädt UE4SS keine Lua-Mods (das ist für Pak-Mods).`);
  }

  // 5) GamePass-Sonderfall
  if (platform.startsWith('Xbox') && !loaderDll) {
    problems.push('Xbox/Game-Pass-Version: Proxy-DLL-Injektion ist hier oft blockiert — evtl. UE4SS-Xbox-Variante/Workshop nötig.');
  }

  return {
    ok: problems.length === 0 && !!loaderDll && hasCore && modInstalled && modEnabled,
    bin, platform, loaderDll, hasCore, modsDir,
    modInstalled, modEnabled, wrongModDir, problems,
  };
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

  // 6) UE4SS-Konsole aktivieren (sichtbares Lade-Feedback beim Spielstart)
  try {
    if (enableUe4ssConsole(bin)) {
      prog('console', 'ok', 'UE4SS-Konsole aktiviert — beim Palworld-Start erscheint ein Konsolenfenster mit „[PalOverlayTracker] aktiv".');
    } else {
      prog('console', 'ok', 'UE4SS-Konsole bereits aktiv (oder Einstellung nicht gefunden).');
    }
  } catch { /* nicht kritisch */ }

  result.ok = true;
  return result;
}

/**
 * Still & bei jedem Start: sorgt dafür, dass die Mod im Spielordner aktuell,
 * aktiviert und mit den korrekten Pfaden versehen ist — SOFERN UE4SS bereits
 * installiert ist. Lädt NICHTS herunter und wirft nie. Für Auto-Refresh.
 * @returns {{ok:boolean, reason?:string, modsDir?:string, gamePath?:string, consoleOn?:boolean}}
 */
function ensureModInstalled(ROOT, gamePath, paths) {
  try {
    if (!gamePath) return { ok: false, reason: 'kein Spielpfad gesetzt' };
    const bin = binDir(gamePath);
    if (!bin) return { ok: false, reason: 'Pal\\Binaries nicht gefunden' };
    const mods = ue4ssModsDir(bin);
    if (!mods) return { ok: false, reason: 'UE4SS nicht installiert — bitte Setup ausführen', diag: diagnoseUe4ss(bin, gamePath) };

    const src = path.join(ROOT, 'ue4ss-mod', 'PalOverlayTracker');
    if (!fs.existsSync(src)) return { ok: false, reason: 'Mod-Quelle fehlt' };
    const dst = path.join(mods, 'PalOverlayTracker');
    copyDirSync(src, dst);
    patchModPaths(dst, paths);

    // enabled.txt sicherstellen (leere Datei aktiviert die Mod in UE4SS)
    try {
      const en = path.join(dst, 'enabled.txt');
      if (!fs.existsSync(en)) fs.writeFileSync(en, '', 'utf8');
    } catch { /* egal */ }

    // mods.txt-Eintrag ergänzen, falls vorhanden
    try {
      const modsTxt = path.join(mods, 'mods.txt');
      if (fs.existsSync(modsTxt)) {
        const t = fs.readFileSync(modsTxt, 'utf8');
        if (!/PalOverlayTracker/.test(t)) {
          fs.writeFileSync(modsTxt, t.replace(/\s*$/, '\r\n') + 'PalOverlayTracker : 1\r\n', 'utf8');
        }
      }
    } catch { /* egal */ }

    const consoleOn = enableUe4ssConsole(bin);
    const diag = diagnoseUe4ss(bin, gamePath);
    return { ok: true, modsDir: mods, gamePath, consoleOn, diag };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { detectPalworld, runSetup, ensureModInstalled, diagnoseUe4ss, binDir, ue4ssModsDir };

