'use strict';
/**
 * InventoryBridge — Datei-IPC zwischen Overlay und der UE4SS-Inventar-Mod.
 *
 *   Spiel → Overlay:  Mod schreibt inv.json (Live-Replik des Inventars von
 *                     Spieler 0 = du/Host). Wir pollen die Datei.
 *   Overlay → Spiel:  Wir schreiben cmd.json mit fortlaufender seq-Nummer.
 *                     Die Mod führt nur neue seq aus (idempotent) und wirkt
 *                     ausschließlich auf den lokalen Spieler — Gäste bleiben
 *                     unberührt (eigene Inventar-Objekte im Spiel).
 *
 * inv.json  : { t, player, size, slots:[{slot,id,count}] }
 * cmd.json  : { seq, ts, cmds:[{op:'add'|'set'|'remove', id?, slot?, count}] }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const FRESH_MS = 4000;

class InventoryBridge extends EventEmitter {
  constructor(getConfig) {
    super();
    this._cfg = getConfig;       // () => settings.position
    this._timer = null;
    this._invMtime = 0;
    this._state = 'off';         // off | ok | stale
    this._seq = Date.now() % 100000;
    this._lastStatus = '';
  }

  start() {
    this.stop();
    this._timer = setInterval(() => this._poll(), 400);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  restart() { this.start(); }

  _invPath() {
    const cfg = this._cfg() || {};
    return cfg.invFile || path.join(os.tmpdir(), 'pal_overlay_inv.json');
  }

  _cmdPath() {
    const cfg = this._cfg() || {};
    return cfg.cmdFile || path.join(os.tmpdir(), 'pal_overlay_cmd.json');
  }

  async _poll() {
    let st;
    try {
      st = await fs.promises.stat(this._invPath());
    } catch {
      this._setState('off');
      return;
    }
    if (Date.now() - st.mtimeMs > FRESH_MS) { this._setState('stale'); return; }
    this._setState('ok');
    if (st.mtimeMs === this._invMtime) return;   // nichts Neues
    try {
      const j = JSON.parse(await fs.promises.readFile(this._invPath(), 'utf8'));
      this._invMtime = st.mtimeMs;
      this.emit('inventory', {
        player: j.player || null,
        size: j.size || (Array.isArray(j.slots) ? j.slots.length : 0),
        slots: Array.isArray(j.slots) ? j.slots : [],
        at: Date.now(),
      });
    } catch {
      // Datei wurde evtl. mitten im Schreiben gelesen — nächster Tick.
    }
  }

  _setState(s) {
    this._state = s;
    const j = JSON.stringify({ inv: s });
    if (j !== this._lastStatus) {
      this._lastStatus = j;
      this.emit('status', { inv: s });
    }
  }

  /**
   * Schreibt einen Befehl atomar. cmds ist eine Liste von Operationen
   * (item-ID-basiert, passend zu den Palworld-Funktionen):
   *   { op:'add', id, count }     AddItem_ServerInternal(id, count)
   *   { op:'set', id, count }     Zielmenge setzen (Mod bildet die Differenz)
   *   { op:'remove', id }         gesamte Menge dieses Items entfernen
   */
  sendCommands(cmds) {
    // Einfaches, Lua-freundliches Zeilenformat (kein JSON-Parser in der Mod nötig):
    //   Zeile 1: <seq>
    //   danach:  <op>|<id>|<count>
    const seq = ++this._seq;
    const list = Array.isArray(cmds) ? cmds : [cmds];
    const lines = [String(seq)];
    for (const c of list) {
      const id = String(c.id || '').replace(/[|\r\n]/g, '');
      lines.push(`${c.op}|${id}|${Math.max(0, Math.round(c.count || 0))}`);
    }
    const file = this._cmdPath();
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf8');
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
      return { ok: true, seq };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { InventoryBridge };
