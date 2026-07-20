'use strict';
/**
 * Minimaler JSON-Store mit atomarem Schreiben und Deep-Merge-Defaults.
 * Keine externen Abhängigkeiten.
 */
const fs = require('fs');
const path = require('path');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(base)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults || {};
    this._data = null;
    this._saveTimer = null;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this._data = deepMerge(this.defaults, JSON.parse(raw));
    } catch {
      this._data = deepMerge(this.defaults, {});
    }
    return this._data;
  }

  get data() {
    if (this._data === null) this.load();
    return this._data;
  }

  set(next) {
    this._data = next;
    this._scheduleSave();
  }

  patch(partial) {
    this._data = deepMerge(this.data, partial);
    this._scheduleSave();
    return this._data;
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 150);
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.rmSync(this.file, { force: true });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] Speichern fehlgeschlagen:', this.file, e.message);
    }
  }
}

module.exports = { JsonStore, deepMerge };
