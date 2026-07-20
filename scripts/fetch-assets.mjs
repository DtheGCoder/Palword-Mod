/**
 * Lädt alle Karten- und Spieldaten für PalPilot (einmalig, danach offline):
 *
 *   1. Kartenbilder 8192px (Palpagos inkl. Sunreach/Feybreak + Weltenbaum)
 *      aus github.com/oMaN-Rod/palworld-save-pal (Spiel-Extrakte, 1.0)
 *   2. Pal-Spawns aus github.com/Awy64/palworld-atlas-data (MIT, autom.
 *      aus dem offiziellen Dedicated-Server extrahiert, 1.0-Build)
 *   3. POIs (Schnellreise, Effigien, Dungeons …) aus save-pal +
 *      optionale Extras (Truhen, Eier, Erze …) von paldb.cc
 *   4. Pal-Metadaten (deutsche Namen!) + runde Paldeck-Icons
 *   5. Item-Masterliste (deutsche Namen!) + Item-Icons (für Admin-Inventar)
 *
 * Aufruf:  npm run fetch-assets            (überspringt Vorhandenes)
 *          npm run fetch-assets -- --force (lädt alles neu)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');
const UA = 'PalPilot-Overlay/1.0 (persoenliches Community-Tool)';

const SAVE_PAL = 'https://raw.githubusercontent.com/oMaN-Rod/palworld-save-pal/main';
const ATLAS = 'https://awy64.github.io/palworld-atlas-data/v1';
const PALDB_MAPDATA = 'https://paldb.cc/js/map_data_en.js';
const PALDB_ICON = (key) => `https://cdn.paldb.cc/image/Pal/Texture/PalIcon/Normal/T_${key}_icon_normal.webp`;

// Ingame-Koordinaten ↔ Welt (identisch zu src/renderer/js/transform.js)
const ING = { scale: 459, offY: 157935, offX: 123930 };
const gameToWorld = (gx, gy) => ({ wy: gx * ING.scale + ING.offY, wx: gy * ING.scale - ING.offX });

const stats = { downloaded: 0, skipped: 0, failed: [] };

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function fetchBuf(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    // Firmenproxy/TLS-Probleme → curl.exe als Fallback (Windows bringt es mit)
    try {
      return execFileSync('curl.exe', ['-skL', '--max-time', '300', '-A', UA, url], {
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch {
      throw e;
    }
  }
}

async function download(url, dest, label) {
  const rel = path.relative(ROOT, dest);
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    stats.skipped++;
    return true;
  }
  try {
    const buf = await fetchBuf(url);
    if (!buf || buf.length < 16) throw new Error('leere Antwort');
    // Blockseiten-Erkennung: HTML statt Binärdaten/JSON
    const head = buf.subarray(0, 60).toString('utf8').toLowerCase();
    if ((dest.endsWith('.webp') || dest.endsWith('.png')) && head.includes('<!doctype')) {
      throw new Error('HTML-Blockseite statt Bild');
    }
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buf);
    stats.downloaded++;
    console.log(`  ✓ ${label || rel}  (${(buf.length / 1024).toFixed(0)} kB)`);
    return true;
  } catch (e) {
    stats.failed.push(`${label || rel}: ${e.message}`);
    console.warn(`  ✗ ${label || rel}: ${e.message}`);
    return false;
  }
}

async function getJson(url, label) {
  const buf = await fetchBuf(url);
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error(`${label || url}: keine gültige JSON-Antwort`);
  }
}

function writeJson(rel, obj) {
  const dest = path.join(ROOT, rel);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, JSON.stringify(obj));
  console.log(`  → ${rel} geschrieben (${(fs.statSync(dest).size / 1024).toFixed(0)} kB)`);
}

const prettyId = (id) => String(id || '')
  .replace(/[_-]+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim();

// ---------------------------------------------------------------- Schritte

async function stepMaps() {
  console.log('\n[1/5] Kartenbilder (2× 8192px)…');
  await download(`${SAVE_PAL}/ui/src/lib/assets/img/t_worldmap.webp`, path.join(ROOT, 'assets/map/palpagos.webp'), 'Palpagos-Karte');
  await download(`${SAVE_PAL}/ui/src/lib/assets/img/t_treemap.webp`, path.join(ROOT, 'assets/map/tree.webp'), 'Weltenbaum-Karte');
}

async function stepSpawns() {
  console.log('\n[2/5] Pal-Spawns (palworld-atlas-data)…');
  const latest = await getJson(`${ATLAS}/latest.json`, 'latest.json');
  const build = latest.steamBuildId || 'unknown';
  const base = `${ATLAS}/${latest.buildPath || 'builds/' + build}`;
  console.log(`  Spieldaten-Build: ${build}`);

  const spawnsOut = {};   // palId → { region → [[wx,wy,minLv,maxLv,avail], …] }
  const alphaBosses = [];
  const availCode = { both: 0, day: 1, night: 2 };

  for (const region of ['palpagos', 'tree']) {
    let data;
    try {
      data = await getJson(`${base}/maps/${region}/spawns.json`, `${region}/spawns.json`);
    } catch (e) {
      stats.failed.push(`Spawns ${region}: ${e.message}`);
      console.warn(`  ✗ Spawns ${region}: ${e.message}`);
      continue;
    }
    let wild = 0;
    for (const s of data.spawns || []) {
      if (typeof s.worldX !== 'number' || typeof s.worldY !== 'number') continue;
      if (s.kind === 'alpha') {
        alphaBosses.push({
          id: s.id || `alpha_${alphaBosses.length}`,
          region,
          wx: Math.round(s.worldX), wy: Math.round(s.worldY),
          name: `${s.palName || s.palId} (Alpha)`,
          level: s.maxLevel || s.minLevel || null,
          palId: s.palId,
        });
        continue;
      }
      const palId = s.palId;
      if (!palId) continue;
      (spawnsOut[palId] ??= {});
      (spawnsOut[palId][region] ??= []).push([
        Math.round(s.worldX), Math.round(s.worldY),
        s.minLevel ?? 0, s.maxLevel ?? 0,
        availCode[s.availability] ?? 0,
      ]);
      wild++;
    }
    console.log(`  ✓ ${region}: ${wild.toLocaleString('de')} Wild-Spawns`);
  }
  writeJson('data/spawns.json', spawnsOut);
  console.log(`  ✓ ${alphaBosses.length} Alpha-Bosse`);
  return { build, alphaBosses, spawnPalIds: Object.keys(spawnsOut) };
}

async function stepPois(alphaBosses) {
  console.log('\n[3/5] POIs (save-pal + paldb)…');
  const markers = {
    fasttravel: [], towers: [], bosses: alphaBosses, dungeons: [], effigies: [],
    chests: [], eggs: [], fruits: [], merchants: [], predators: [], raids: [],
    sanctuaries: [], oilrigs: [], ores: [], fishing: [], camps: [], supply: [],
  };
  const regionOf = (wx, wy) =>
    (wx >= 347351.5 && wx <= 689148.5 && wy >= -818197 && wy <= -476400) ? 'tree' : 'palpagos';

  // --- save-pal: Schnellreise & Türme
  try {
    const ft = await getJson(`${SAVE_PAL}/data/json/fast_travel_points.json`, 'fast_travel_points');
    for (const [guid, p] of Object.entries(ft)) {
      if (typeof p?.x !== 'number') continue;
      const rawId = String(p.id || guid);
      const entry = {
        id: `ft_${rawId}`,
        region: regionOf(p.x, p.y),
        wx: Math.round(p.x), wy: Math.round(p.y),
      };
      // Syndikat-Türme heißen "Tower_…"; die neuen 1.0-Wachtürme ("WatchTower_…")
      // nutzen zwar dieselbe UE-Klasse, sind aber normale Schnellreisepunkte.
      if (/^Tower_?/i.test(rawId)) {
        entry.name = `Syndikat-Turm – ${prettyId(rawId.replace(/^Tower_?/i, ''))}`;
        markers.towers.push(entry);
      } else {
        if (/watchtower/i.test(rawId)) entry.name = `Wachturm ${rawId.replace(/\D+/g, '')}`.trim();
        else if (/skyisland/i.test(rawId)) entry.name = `Schnellreise – Sunreach ${rawId.replace(/^SkyIsland_?/i, '')}`;
        else entry.name = `Schnellreise – ${prettyId(rawId)}`;
        markers.fasttravel.push(entry);
      }
    }
    console.log(`  ✓ ${markers.fasttravel.length} Schnellreisepunkte, ${markers.towers.length} Türme`);
  } catch (e) { stats.failed.push('fast_travel: ' + e.message); console.warn('  ✗ fast_travel:', e.message); }

  // (Effigien kommen aus den paldb-Extras — die enthalten auch die neuen
  //  1.0-Pal-Effigien wie Rooby/Munchill/… mit richtigen Namen.)

  // --- save-pal: Dungeons u.a.
  try {
    const mo = await getJson(`${SAVE_PAL}/data/json/map_objects.json`, 'map_objects');
    const list = Array.isArray(mo) ? mo : Object.values(mo);
    let i = 0;
    for (const p of list) {
      if (typeof p?.x !== 'number') continue;
      const t = String(p.type || '').toLowerCase();
      if (t.includes('dungeon')) {
        markers.dungeons.push({ id: `dg_sp_${i++}`, region: regionOf(p.x, p.y), wx: Math.round(p.x), wy: Math.round(p.y), name: 'Dungeon' });
      }
    }
    console.log(`  ✓ ${markers.dungeons.length} Dungeons (save-pal)`);
  } catch (e) { console.warn('  – map_objects übersprungen:', e.message); }

  // --- paldb: Extras (Truhen, Eier, Erze, Angeln, Camps, Supply, Händler …)
  try {
    const js = (await fetchBuf(PALDB_MAPDATA)).toString('utf8');
    if (js.length < 10000) throw new Error('Antwort zu klein (Blockseite?)');
    const sandbox = { window: {}, document: { addEventListener() {} }, console: { log() {}, warn() {}, error() {} } };
    vm.createContext(sandbox);
    vm.runInContext(js.replace(/^﻿/, ''), sandbox, { timeout: 8000 });
    const buckets = [];
    for (const key of ['extras', 'extrasIngame', 'fixedDungeon']) {
      const v = sandbox[key] ?? sandbox.window[key];
      if (v) buckets.push([key, v]);
    }
    const catFor = (t) => {
      if (/watchtower/.test(t)) return null;                    // hat save-pal schon
      if (/effigy/.test(t)) return 'effigies';
      if (/treasure|salvage|chest|junk/.test(t)) return 'chests';
      if (/egg/.test(t)) return 'eggs';
      if (/ore|coal|sulfur|quartz|soralite|chromite|nightstar|paldium|stone|crystal|crude.?oil|gold.?vein|metal/.test(t)) return 'ores';
      if (/fishing/.test(t)) return 'fishing';
      if (/dungeon|cave/.test(t)) return 'dungeons';
      if (/camp|outpost/.test(t)) return 'camps';
      if (/supply|drop/.test(t)) return 'supply';
      if (/fruit/.test(t)) return 'fruits';
      if (/merchant|marketeer|vendor|trader|npc|pal.?dealer/.test(t)) return 'merchants';
      if (/predator/.test(t)) return 'predators';
      if (/raid/.test(t)) return 'raids';
      if (/warp|altar/.test(t)) return 'fasttravel';            // Sunreach-Portale
      if (/oil.?rig/.test(t)) return 'oilrigs';
      if (/sanctuar/.test(t)) return 'sanctuaries';
      return null;
    };
    // Anzeigename: "item" ist bei paldb das Label ("Deserted Islet", "Lamball Effigy"),
    // bei Loot aber eine interne ID ("grass_grade_01") — die filtern wir raus.
    const niceName = (node, type) => {
      const item = String(node.item || '');
      if (item && /^[A-Z]/.test(item) && !/_/.test(item) && !/^BOSS/i.test(item)) return item;
      return prettyId(type);
    };
    let added = 0, idc = 0;
    const paldbFT = [];
    const walk = (node, typeHint) => {
      if (!node) return;
      if (Array.isArray(node)) { for (const item of node) walk(item, typeHint); return; }
      if (typeof node !== 'object') return;
      const pos = node.pos || node.Pos;
      const ipos = node.ipos || node.iPos;
      const type = String(node.type || node.Type || node.name || node.Name || typeHint || '');
      if (pos && typeof pos.X === 'number') {
        push(type, pos.X, pos.Y, node);
      } else if (ipos && typeof ipos.X === 'number') {
        const w = gameToWorld(ipos.X, ipos.Y);
        push(type, w.wx, w.wy, node);
      } else {
        for (const [k, v] of Object.entries(node)) {
          if (v && typeof v === 'object') walk(v, node.type || node.name || k);
        }
      }
    };
    const push = (type, wx, wy, node) => {
      const tl = type.toLowerCase();
      if (/^fast.?travel$/.test(tl)) {
        paldbFT.push({ wx, wy, name: String(node.item || '') });
        return;
      }
      const cat = catFor(tl);
      if (!cat) return;
      const entry = {
        id: `pd_${cat}_${idc++}`,
        region: regionOf(wx, wy),
        wx: Math.round(wx), wy: Math.round(wy),
        name: niceName(node, type),
      };
      if (node.lv) entry.level = node.lv;
      if (node.cooldown) entry.info = `Respawn: ${node.cooldown}`;
      markers[cat].push(entry);
      added++;
    };
    for (const [key, bucket] of buckets) walk(bucket, key);

    // Schnellreise-Namen anreichern (paldb kennt die echten Ortsnamen) und
    // Syndikat-Türme anhand des Namens in die eigene Kategorie verschieben.
    if (paldbFT.length) {
      let named = 0;
      for (const ft of markers.fasttravel) {
        if (ft.name.startsWith('Wachturm')) continue; // haben schon gute Namen
        let best = null, bestD = 250 * 100; // 250 m Suchradius (Welt-cm)
        for (const q of paldbFT) {
          const d = Math.hypot(q.wx - ft.wx, q.wy - ft.wy);
          if (d < bestD) { bestD = d; best = q; }
        }
        if (best && best.name) { ft.name = best.name; named++; }
      }
      const isTower = (n) => /tower entrance$/i.test(n);
      markers.towers = markers.fasttravel.filter((f) => isTower(f.name));
      markers.fasttravel = markers.fasttravel.filter((f) => !isTower(f.name));
      console.log(`  ✓ ${named} Schnellreise-Namen übernommen, ${markers.towers.length} Türme erkannt`);
    }
    // Dedupe nah beieinanderliegender Doppel-Einträge
    // (grobes Raster für einmalige POIs, feines für dichte Ressourcen-Nodes)
    const dedupeGrid = { dungeons: 5000, fasttravel: 5000, towers: 5000, merchants: 3000 };
    for (const cat of Object.keys(markers)) {
      const grid = dedupeGrid[cat] || 1000;
      const seen = new Set();
      markers[cat] = markers[cat].filter((m) => {
        const k = `${Math.round(m.wx / grid)}:${Math.round(m.wy / grid)}:${m.name}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    console.log(`  ✓ paldb-Extras: ${added.toLocaleString('de')} Marker übernommen`);
  } catch (e) {
    console.warn('  – paldb-Extras übersprungen (optional):', e.message);
  }

  writeJson('data/markers.json', markers);
  const total = Object.values(markers).reduce((a, l) => a + l.length, 0);
  console.log(`  → insgesamt ${total.toLocaleString('de')} POIs`);
}

async function stepPals(spawnPalIds) {
  console.log('\n[4/5] Pal-Metadaten (deutsch)…');
  const [raw, de, en] = await Promise.all([
    getJson(`${SAVE_PAL}/data/json/pals.json`, 'pals.json'),
    getJson(`${SAVE_PAL}/data/json/l10n/de/pals.json`, 'l10n de').catch(() => ({})),
    getJson(`${SAVE_PAL}/data/json/l10n/en/pals.json`, 'l10n en').catch(() => ({})),
  ]);
  const out = [];
  const spawnSet = new Set(spawnPalIds);
  for (const [key, p] of Object.entries(raw)) {
    if (!p || typeof p !== 'object') continue;
    if (/^(BOSS|GYM|RAID|SUMMON|Quest)_/i.test(key)) continue;
    const deck = p.pal_deck_index ?? p.paldeck_index ?? p.zukan_index ?? null;
    const hasSpawn = spawnSet.has(key);
    if ((deck == null || deck < 0) && !hasSpawn) continue;
    const name = de[key]?.localized_name || en[key]?.localized_name || prettyId(key);
    if (!name || /^en_text|_name/i.test(name)) continue;
    out.push({
      id: key,
      num: deck,
      name,
      nameEn: en[key]?.localized_name || null,
      elements: (p.element_types || p.elements || []).map((e) => String(e).toLowerCase()),
      nocturnal: !!p.nocturnal,
      rarity: p.rarity ?? null,
      icon: `assets/icons/pals/${key.toLowerCase()}.webp`,
      hasSpawns: hasSpawn,
    });
  }
  out.sort((a, b) => (a.num ?? 9999) - (b.num ?? 9999) || a.name.localeCompare(b.name, 'de'));
  writeJson('data/pals.json', out);
  console.log(`  ✓ ${out.length} Pals (davon ${out.filter((p) => p.hasSpawns).length} mit Spawn-Daten)`);
  return out;
}

// Kategorie type_a → deutsches Label + Sortier-Reihenfolge
const ITEM_CATEGORIES = {
  SpecialWeapon: 'Sphären',
  Material: 'Materialien',
  Consume: 'Verbrauchsgüter',
  Food: 'Nahrung',
  Weapon: 'Waffen',
  Ammo: 'Munition',
  Armor: 'Rüstung',
  Accessory: 'Accessoires',
  Glider: 'Gleiter',
  SphereModule: 'Sphären-Module',
  MonsterEquipWeapon: 'Pal-Waffen',
  Essential: 'Wichtige Gegenstände',
  Blueprint: 'Baupläne',
  None: 'Sonstige',
};

async function stepItems() {
  console.log('\n[5/6] Item-Masterliste (deutsch)…');
  const [raw, de, en] = await Promise.all([
    getJson(`${SAVE_PAL}/data/json/items.json`, 'items.json'),
    getJson(`${SAVE_PAL}/data/json/l10n/de/items.json`, 'l10n de items').catch(() => ({})),
    getJson(`${SAVE_PAL}/data/json/l10n/en/items.json`, 'l10n en items').catch(() => ({})),
  ]);
  const out = [];
  for (const [key, it] of Object.entries(raw)) {
    if (!it || typeof it !== 'object' || it.disabled) continue;
    const cat = it.type_a || 'None';
    if (cat === 'Blueprint') continue; // Baupläne/Schemata: für Inventar-Injektion uninteressant
    const name = de[key]?.localized_name || en[key]?.localized_name;
    if (!name || /^en_text|^\s*$|_Name$/i.test(name)) continue; // ohne echten Namen überspringen
    out.push({
      id: key,
      name,
      nameEn: en[key]?.localized_name || null,
      cat,
      catLabel: ITEM_CATEGORIES[cat] || cat,
      rank: it.rank ?? 0,
      rarity: it.rarity ?? 0,
      maxStack: it.max_stack_count ?? 9999,
      weight: it.weight ?? 0,
      sort: it.sort_id ?? 99999,
      iconKey: it.icon || null,
      icon: it.icon ? `assets/icons/items/${it.icon}.webp` : null,
    });
  }
  out.sort((a, b) => (a.catLabel).localeCompare(b.catLabel, 'de') || a.sort - b.sort || a.name.localeCompare(b.name, 'de'));
  writeJson('data/items.json', out);
  const byCat = {};
  for (const i of out) byCat[i.catLabel] = (byCat[i.catLabel] || 0) + 1;
  console.log(`  ✓ ${out.length} Items — ${Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join(', ')}`);
  return out;
}

async function stepItemIcons(items) {
  console.log('\n[6/6] Item-Icons…');
  // Nach Icon-Dateiname deduplizieren (viele Items teilen sich Icons)
  const byIcon = new Map();
  for (const it of items) {
    if (it.iconKey && !byIcon.has(it.iconKey)) byIcon.set(it.iconKey, it.icon);
  }
  const todo = [...byIcon.entries()].filter(([, rel]) => {
    const dest = path.join(ROOT, rel);
    return FORCE || !fs.existsSync(dest) || fs.statSync(dest).size === 0;
  });
  if (!todo.length) { console.log('  ✓ alle Item-Icons bereits vorhanden'); return; }
  console.log(`  lade ${todo.length} eindeutige Icons (für ${items.length} Items)…`);
  let ok = 0, fail = 0;
  const queue = [...todo];
  const workers = Array.from({ length: 10 }, async () => {
    while (queue.length) {
      const [iconKey, rel] = queue.shift();
      const dest = path.join(ROOT, rel);
      const good = await downloadQuiet(`${SAVE_PAL}/ui/src/lib/assets/img/${iconKey}.webp`, dest);
      good ? ok++ : fail++;
      if ((ok + fail) % 120 === 0) console.log(`  … ${ok + fail}/${todo.length}`);
    }
  });
  await Promise.all(workers);
  console.log(`  ✓ ${ok} Item-Icons geladen${fail ? `, ${fail} fehlen (Platzhalter)` : ''}`);
}

async function stepIcons(pals) {
  console.log('\n[4b/6] Pal-Icons…');
  const todo = pals.filter((p) => {
    const dest = path.join(ROOT, p.icon);
    return FORCE || !fs.existsSync(dest) || fs.statSync(dest).size === 0;
  });
  if (!todo.length) { console.log('  ✓ alle Icons bereits vorhanden'); return; }
  console.log(`  lade ${todo.length} Icons…`);
  let ok = 0, fail = 0;
  const queue = [...todo];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const dest = path.join(ROOT, p.icon);
      const primary = `${SAVE_PAL}/ui/src/lib/assets/img/t_${p.id.toLowerCase()}_icon_normal.webp`;
      let good = await downloadQuiet(primary, dest);
      if (!good) good = await downloadQuiet(PALDB_ICON(p.id), dest);
      good ? ok++ : fail++;
      if ((ok + fail) % 40 === 0) console.log(`  … ${ok + fail}/${todo.length}`);
    }
  });
  await Promise.all(workers);
  console.log(`  ✓ ${ok} Icons geladen${fail ? `, ${fail} fehlen (Platzhalter wird angezeigt)` : ''}`);
}

async function downloadQuiet(url, dest) {
  try {
    const buf = await fetchBuf(url);
    if (!buf || buf.length < 100) return false;
    if (buf.subarray(0, 20).toString('utf8').toLowerCase().includes('<!doc')) return false;
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Ablauf

console.log('PalPilot Asset-Downloader — Quellen: github (save-pal, atlas-data), paldb.cc');
const t0 = Date.now();
try {
  await stepMaps();
  const { build, alphaBosses, spawnPalIds } = await stepSpawns();
  await stepPois(alphaBosses);
  const pals = await stepPals(spawnPalIds);
  await stepIcons(pals);
  const items = await stepItems();
  await stepItemIcons(items);
  writeJson('data/meta.json', {
    build,
    fetchedAt: new Date().toISOString(),
    itemCount: items.length,
    sources: ['github.com/oMaN-Rod/palworld-save-pal', 'github.com/Awy64/palworld-atlas-data (MIT)', 'paldb.cc'],
  });
} catch (e) {
  console.error('\nFEHLER:', e.message);
  process.exitCode = 1;
}
console.log(`\nFertig in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${stats.downloaded} geladen, ${stats.skipped} übersprungen, ${stats.failed.length} Fehler.`);
if (stats.failed.length) {
  console.log('Fehlgeschlagen:');
  for (const f of stats.failed.slice(0, 20)) console.log('  -', f);
}
