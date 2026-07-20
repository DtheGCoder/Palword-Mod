'use strict';
/**
 * Auto-Updater: Beim Start prüfen, ob auf GitHub eine neue Version liegt,
 * und (bei git-Installation) automatisch per `git pull --ff-only` aktualisieren.
 *
 *  - git-Klon:  fetch → vergleichen → ff-pull → (npm install, falls Deps sich
 *               änderten) → App neu starten.
 *  - ZIP/kein git:  Version aus GitHub-raw package.json mit lokaler vergleichen
 *               und nur einen Hinweis + Link zurückgeben (kein Selbst-Update).
 *
 * Bricht NIE den Start ab: jeder Fehler (offline, kein git …) → { skipped }.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_RAW = 'https://raw.githubusercontent.com/DtheGCoder/Palword-Mod/main/package.json';
const REPO_URL = 'https://github.com/DtheGCoder/Palword-Mod';

function git(ROOT, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT, timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err || '').trim() });
    });
  });
}

function isGitRepo(ROOT) {
  return fs.existsSync(path.join(ROOT, '.git'));
}

async function remoteVersion() {
  try {
    const res = await fetch(REPO_RAW, { headers: { 'User-Agent': 'PalPilot-Updater' } });
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} ROOT Projektwurzel
 * @param {(step:string, msg:string)=>void} prog
 * @returns {Promise<{mode,updated,upToDate,skipped,reason,from,to,current,latest,url}>}
 */
async function checkAndUpdate(ROOT, prog = () => {}) {
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch { return {}; } })();
  const current = pkg.version || '?';

  if (!isGitRepo(ROOT)) {
    prog('check', 'Prüfe auf neue Version…');
    const latest = await remoteVersion();
    if (latest && latest !== current) {
      return { mode: 'manual', updated: false, current, latest, url: REPO_URL };
    }
    return { mode: 'manual', updated: false, upToDate: true, current };
  }

  // git-Installation
  if (!(await git(ROOT, ['--version'])).ok) return { skipped: true, reason: 'git fehlt' };
  const branchRes = await git(ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.ok ? branchRes.out : 'main';

  prog('fetch', 'Suche nach Updates auf GitHub…');
  const fetched = await git(ROOT, ['fetch', '--quiet', 'origin', branch], 25000);
  if (!fetched.ok) return { skipped: true, reason: 'offline oder kein Zugriff' };

  const local = (await git(ROOT, ['rev-parse', 'HEAD'])).out;
  const remote = (await git(ROOT, ['rev-parse', `origin/${branch}`])).out;
  if (!local || !remote) return { skipped: true, reason: 'Vergleich fehlgeschlagen' };
  if (local === remote) return { updated: false, upToDate: true, current };

  // Nur aktualisieren, wenn wir sauber vorspulen können (keine lokalen Änderungen überschreiben)
  const canFF = (await git(ROOT, ['merge-base', '--is-ancestor', 'HEAD', `origin/${branch}`])).ok;
  if (!canFF) return { skipped: true, reason: 'lokale Änderungen/Divergenz — bitte manuell `git pull`', current };

  const lockBefore = readIfExists(path.join(ROOT, 'package-lock.json'));
  prog('pull', 'Lade neue Version…');
  const pulled = await git(ROOT, ['pull', '--ff-only', 'origin', branch], 60000);
  if (!pulled.ok) return { skipped: true, reason: 'Pull fehlgeschlagen: ' + pulled.err };

  const lockAfter = readIfExists(path.join(ROOT, 'package-lock.json'));
  let depsChanged = lockBefore !== lockAfter;
  if (depsChanged) {
    prog('npm', 'Aktualisiere Abhängigkeiten…');
    await npmInstall(ROOT);
  }
  const newVer = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return current; } })();
  return { updated: true, from: local.slice(0, 7), to: remote.slice(0, 7), current, latest: newVer, depsChanged };
}

function readIfExists(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function npmInstall(ROOT) {
  return new Promise((resolve) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFile(npm, ['install', '--no-audit', '--no-fund'], { cwd: ROOT, timeout: 180000, windowsHide: true }, () => resolve());
  });
}

module.exports = { checkAndUpdate, isGitRepo };
