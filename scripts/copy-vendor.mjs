/**
 * Kopiert Leaflet aus node_modules nach src/renderer/vendor/leaflet,
 * damit der Renderer ohne Build-Schritt und offline läuft.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', 'leaflet', 'dist');
const DST = path.join(ROOT, 'src', 'renderer', 'vendor', 'leaflet');

if (!fs.existsSync(SRC)) {
  console.error('leaflet nicht gefunden — erst `npm install` ausführen.');
  process.exit(1);
}
fs.mkdirSync(path.join(DST, 'images'), { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css']) {
  fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
}
for (const f of fs.readdirSync(path.join(SRC, 'images'))) {
  fs.copyFileSync(path.join(SRC, 'images', f), path.join(DST, 'images', f));
}
console.log('Leaflet nach', DST, 'kopiert.');
