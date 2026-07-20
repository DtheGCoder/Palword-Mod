'use strict';
/**
 * PositionEngine — sammelt die Live-Spielerposition aus zwei Quellen:
 *
 *  1) "ue4ss"  — eine kleine Lua-Mod im Spiel schreibt ~5x/s eine JSON-Datei
 *                (Echtzeit, funktioniert im Singleplayer & als Client).
 *  2) "rest"   — offizielle REST-API des Dedicated Servers
 *                (GET /v1/api/players, HTTP Basic auth).
 *
 * Die Engine wählt automatisch die frischeste Quelle und emittiert:
 *   'position' → { source, wx, wy, wz, yaw, level, at }
 *   'status'   → { ue4ss: 'ok'|'stale'|'off', rest: 'ok'|'error'|'off', active }
 */
const fs = require('fs');
const http = require('http');
const { EventEmitter } = require('events');

const UE4SS_FRESH_MS = 3500;

class PositionEngine extends EventEmitter {
  constructor(getConfig) {
    super();
    this._cfg = getConfig; // () => settings.position
    this._timers = [];
    this._ue4ss = { state: 'off', pos: null, mtime: 0, lastEmit: 0 };
    this._rest = { state: 'off', pos: null, at: 0, prev: null, inflight: false };
    this._active = null;
    this._lastStatusJson = '';
  }

  start() {
    this.stop();
    this._timers.push(setInterval(() => this._pollUe4ss(), 250));
    this._timers.push(setInterval(() => this._pollRest(), this._restInterval()));
    this._timers.push(setInterval(() => this._emitStatus(), 1000));
  }

  stop() {
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
  }

  restart() { this.start(); }

  _restInterval() {
    const cfg = this._cfg() || {};
    return Math.max(1000, (cfg.rest && cfg.rest.intervalMs) || 2000);
  }

  // ---------- UE4SS-Datei ----------
  async _pollUe4ss() {
    const cfg = this._cfg() || {};
    const file = cfg.ue4ssFile;
    if (!file) { this._ue4ss.state = 'off'; return; }
    let st;
    try {
      st = await fs.promises.stat(file);
    } catch {
      this._ue4ss.state = 'off';
      return;
    }
    const age = Date.now() - st.mtimeMs;
    if (age > UE4SS_FRESH_MS) {
      this._ue4ss.state = 'stale';
      return;
    }
    if (st.mtimeMs === this._ue4ss.mtime) {
      this._ue4ss.state = 'ok';
      return; // nichts Neues
    }
    try {
      const raw = await fs.promises.readFile(file, 'utf8');
      const j = JSON.parse(raw);
      if (typeof j.x !== 'number' || typeof j.y !== 'number') return;
      this._ue4ss.mtime = st.mtimeMs;
      this._ue4ss.state = 'ok';
      this._ue4ss.pos = {
        source: 'ue4ss',
        wx: j.x, wy: j.y, wz: typeof j.z === 'number' ? j.z : 0,
        yaw: typeof j.yaw === 'number' ? j.yaw : null,
        level: typeof j.level === 'string' ? j.level : null,
        at: Date.now(),
      };
      this._emitPosition(this._ue4ss.pos);
    } catch {
      // Datei war ggf. mitten im Schreiben — nächster Tick.
    }
  }

  // ---------- REST-API (Dedicated Server) ----------
  _pollRest() {
    const cfg = (this._cfg() || {}).rest || {};
    if (!cfg.enabled) { this._rest.state = 'off'; return; }
    if (this._rest.inflight) return;
    this._rest.inflight = true;

    const auth = 'Basic ' + Buffer.from(`admin:${cfg.password || ''}`).toString('base64');
    const req = http.request({
      host: cfg.host || '127.0.0.1',
      port: cfg.port || 8212,
      path: '/v1/api/players',
      method: 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
      timeout: 2500,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
      res.on('end', () => {
        this._rest.inflight = false;
        if (res.statusCode !== 200) {
          this._rest.state = 'error';
          this._rest.error = `HTTP ${res.statusCode}`;
          return;
        }
        try {
          const j = JSON.parse(body);
          const players = Array.isArray(j.players) ? j.players : [];
          const wanted = (cfg.player || '').trim().toLowerCase();
          const p = wanted
            ? players.find((q) => String(q.name || '').toLowerCase() === wanted) || players[0]
            : players[0];
          if (!p || typeof p.location_x !== 'number') {
            this._rest.state = players.length ? 'ok' : 'error';
            return;
          }
          const pos = {
            source: 'rest',
            wx: p.location_x, wy: p.location_y, wz: 0,
            yaw: null, level: null, at: Date.now(),
            playerName: p.name || null,
          };
          this._rest.state = 'ok';
          this._rest.prev = this._rest.pos;
          this._rest.pos = pos;
          // yaw aus Bewegungsvektor ableiten (Server liefert keine Blickrichtung)
          if (this._rest.prev) {
            const dx = pos.wx - this._rest.prev.wx;
            const dy = pos.wy - this._rest.prev.wy;
            if (Math.hypot(dx, dy) > 150) pos.yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
          }
          // UE4SS hat Vorrang, wenn frisch
          if (this._ue4ss.state !== 'ok') this._emitPosition(pos);
        } catch {
          this._rest.state = 'error';
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => {
      this._rest.inflight = false;
      this._rest.state = 'error';
    });
    req.end();
  }

  _emitPosition(pos) {
    this._active = pos.source;
    this.emit('position', pos);
  }

  _emitStatus() {
    const s = {
      ue4ss: this._ue4ss.state,
      rest: this._rest.state,
      active: this._active,
    };
    const j = JSON.stringify(s);
    if (j !== this._lastStatusJson) {
      this._lastStatusJson = j;
      this.emit('status', s);
    }
  }
}

module.exports = { PositionEngine };
