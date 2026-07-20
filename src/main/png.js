'use strict';
/**
 * Winziger PNG-Encoder (RGBA, Filter 0) — nur für das Tray-Icon,
 * damit keine Binärdatei im Repo liegen muss.
 */
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array der Länge w*h*4 */
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // Filter 0
    rgba.subarray ? raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1)
                  : raw.set(rgba.slice(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Zeichnet das PalPilot-Tray-Icon (Kompass-Punkt in Ring) als 32x32-PNG. */
function trayIconPng() {
  const w = 32, h = 32;
  const px = new Uint8Array(w * h * 4);
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    const ea = a / 255, oa = px[i + 3] / 255;
    const na = ea + oa * (1 - ea);
    if (na <= 0) return;
    px[i] = Math.round((r * ea + px[i] * oa * (1 - ea)) / na);
    px[i + 1] = Math.round((g * ea + px[i + 1] * oa * (1 - ea)) / na);
    px[i + 2] = Math.round((b * ea + px[i + 2] * oa * (1 - ea)) / na);
    px[i + 3] = Math.round(na * 255);
  };
  const cx = 15.5, cy = 15.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const aa = (edge, dist) => Math.max(0, Math.min(1, edge - dist + 0.5));
      // dunkle Scheibe
      if (d < 15) put(x, y, 13, 24, 38, 255 * aa(15, d));
      // cyan Ring
      const ring = Math.abs(d - 13);
      if (ring < 1.8) put(x, y, 70, 200, 255, 255 * aa(1.8, ring));
    }
  }
  // Heading-Keil (Norden)
  for (let y = 6; y <= 16; y++) {
    const half = ((16 - y) / 10) * 4.2;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      put(x, y, 255, 211, 77, 235);
    }
  }
  // Spieler-Punkt
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy - 3);
      if (d < 4) put(x, y, 70, 200, 255, 255 * Math.max(0, Math.min(1, 4 - d + 0.5)));
    }
  }
  return encodePng(w, h, px);
}

module.exports = { encodePng, trayIconPng };
