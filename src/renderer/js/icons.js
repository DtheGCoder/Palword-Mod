/**
 * Inline-SVG-Icons (24x24, currentColor) — keine externen Assets nötig.
 */
const P = {
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 4.9 5.4 10.6 6.6 11.8a.55.55 0 0 0 .8 0C13.6 19.6 19 13.9 19 9a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>',
  flag: '<path d="M5 3a1 1 0 0 1 1 1v.4c1.2-.5 2.6-.9 4.2-.6 1.9.3 3.2 1.5 4.9 1.7 1.1.2 2.3 0 3.9-.9v9.1c-1.6.9-3.1 1.2-4.5 1-1.9-.3-3.2-1.5-4.9-1.7-1.1-.2-2.3 0-3.6.7V21H4V4a1 1 0 0 1 1-1z"/>',
  statue: '<path d="M12 2l2.2 3.4L18 4l-1.6 3.6L20 9.8l-3.8.9.5 3.9-3.4-1.9L12 16l-1.3-3.3-3.4 1.9.5-3.9L4 9.8l3.6-2.2L6 4l3.8 1.4zM9 17h6l1 5H8z"/>',
  tower: '<path d="M7 3h2v2h2V3h2v2h2V3h2v5l-1.5 1.5V19H18v2H6v-2h1.5V9.5L6 8V3zm3 9h4v7h-4z"/>',
  skull: '<path d="M12 2a8 8 0 0 0-8 8c0 2.9 1.6 5.5 4 6.9V20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3.1c2.4-1.4 4-4 4-6.9a8 8 0 0 0-8-8zM9 12.5A1.75 1.75 0 1 1 9 9a1.75 1.75 0 0 1 0 3.5zm6 0A1.75 1.75 0 1 1 15 9a1.75 1.75 0 0 1 0 3.5zM12 13l1.2 2.6h-2.4z"/>',
  dungeon: '<path d="M12 3C7 3 4 7 4 11v10h4v-6a4 4 0 0 1 8 0v6h4V11c0-4-3-8-8-8zm0 4.5A1.5 1.5 0 1 1 12 4.5a1.5 1.5 0 0 1 0 3z"/>',
  effigy: '<path d="M12 2l4 5-4 15-4-15zm0 3.2L10.2 7 12 13.6 13.8 7z"/>',
  chest: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4h-7v-1h-2v1H4zm0 6h7v1.5h2V12h7v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  egg: '<path d="M12 2c3.5 0 7 5.5 7 11a7 7 0 0 1-14 0C5 7.5 8.5 2 12 2z"/>',
  fruit: '<path d="M15.5 4c-1.2 0-2.4.5-3.5 1.6C10.9 4.5 9.7 4 8.5 4 5.5 4 4 6.7 4 9.5 4 15 9 21 12 21s8-6 8-11.5C20 6.7 18.5 4 15.5 4zM12 3.5c.4-1 1.4-1.7 2.6-1.5-.2 1.1-1 1.9-2.2 2z"/>',
  merchant: '<path d="M12 2a4 4 0 0 1 4 4h2a1 1 0 0 1 1 1l-1.2 12.4A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.6L5 7a1 1 0 0 1 1-1h2a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2h4a2 2 0 0 0-2-2z"/>',
  predator: '<path d="M4 4c3 1 5 2 6.5 4.5L8 11c2 .5 3.5 1.5 5 3l-2 2c2 .8 3.6 1.9 5 4l4-4c-1.7-6.5-7.4-11.4-16-12z"/>',
  oilrig: '<path d="M11 3h2l1 7h3l2 11h-2l-1.6-9H12.7l.8 9h-2l-.8-9H8.6L7 21H5L7 10h3z"/>',
  sanctuary: '<path d="M13 3c3 0 6 2 7 5-2-.8-4-.8-5.5 0C16 10 16 12 15 14h-2c.5-3-.5-5-2.5-6.5C9 6 8 5.5 6 5.5 8 3.7 10.5 3 13 3zM4 21c1-4 4-6 8-6s7 2 8 6z"/>',
  raid: '<path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
  compass: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.5 5.5L14 14l-6.5 2.5L10 10zM12 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>',
  gear: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4a7.8 7.8 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2-1.2L16.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7.9 7.9 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"/>',
  search: '<path d="M10 3a7 7 0 1 0 4.2 12.6l4.6 4.6 1.6-1.6-4.6-4.6A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zm-6.5 8.6L12 15l6.5-3.4L21 13l-9 5-9-5zm0 4L12 19l6.5-3.4L21 17l-9 5-9-5z"/>',
  x: '<path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
  route: '<path d="M6 3a3 3 0 0 1 3 3c0 1.4-1 2.6-2 4l-1-1.4C5.4 7.7 5 7 5 6a1 1 0 0 1 2 0zm12 8a3 3 0 0 1 3 3c0 2-3 5-3 5s-3-3-3-5a3 3 0 0 1 3-3zM6 12h7a2 2 0 1 1 0 4H9a4 4 0 0 0 0 8H6v-2h3a2 2 0 1 0 0-4h4a4 4 0 0 0 0-8H6z"/>',
  target: '<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3z"/>',
  eye: '<path d="M12 5c5 0 9.3 3.1 11 7-1.7 3.9-6 7-11 7S2.7 15.9 1 12c1.7-3.9 6-7 11-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>',
  eyeOff: '<path d="M3.3 2.3l18.4 18.4-1.4 1.4-3.2-3.2c-1.6.7-3.3 1.1-5.1 1.1-5 0-9.3-3.1-11-7 .8-1.9 2.2-3.6 3.9-4.9L1.9 3.7zM12 5c5 0 9.3 3.1 11 7-.7 1.6-1.8 3-3.2 4.2l-2.9-2.9A4 4 0 0 0 12 8c-.5 0-.9.1-1.3.2L8.6 6.1C9.7 5.4 10.8 5 12 5z"/>',
  folder: '<path d="M4 4h6l2 2h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>',
  download: '<path d="M11 3h2v9l3-3 1.4 1.4L12 15.8 6.6 10.4 8 9l3 3zM5 19h14v2H5z"/>',
  upload: '<path d="M12 3l5.4 5.4L16 9.8l-3-3V16h-2V6.8l-3 3L6.6 8.4zM5 19h14v2H5z"/>',
  copy: '<path d="M8 3h11a1 1 0 0 1 1 1v13h-2V5H8zm-3 4h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
  trash: '<path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z"/>',
  edit: '<path d="M4 16l10-10 4 4L8 20H4zm13-13l3 3 1.3-1.3a1 1 0 0 0 0-1.4L19.7 1.7a1 1 0 0 0-1.4 0z"/>',
  crosshair: '<path d="M12 2a1 1 0 0 1 1 1v1.1A8 8 0 0 1 19.9 11H21a1 1 0 0 1 0 2h-1.1A8 8 0 0 1 13 19.9V21a1 1 0 0 1-2 0v-1.1A8 8 0 0 1 4.1 13H3a1 1 0 0 1 0-2h1.1A8 8 0 0 1 11 4.1V3a1 1 0 0 1 1-1zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>',
  ruler: '<path d="M2 16L16 2l6 6L8 22zm5.3-1.9l1.4 1.4 1.4-1.4-1.4-1.4zm3-3l1.4 1.4L13 11.4 11.7 10zm3-3l1.4 1.4 1.4-1.4-1.4-1.4z"/>',
  grid: '<path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>',
  check: '<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  arrow: '<path d="M12 2l7 18-7-4-7 4z"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  sphere: '<path d="M12 2a10 10 0 0 1 10 10h-6.2a3.8 3.8 0 0 0-7.6 0H2A10 10 0 0 1 12 2zm-10 11h6.3a3.8 3.8 0 0 0 7.4 0H22A10 10 0 0 1 2 13zm10-2.6a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z"/>',
  info: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v2h-2zm0 4h2v6h-2z"/>',
  warn: '<path d="M12 2l11 19H1zm-1 7h2v6h-2zm0 7h2v2h-2z"/>',
  rock: '<path d="M12 3l6.5 3.5L21 13l-4 7H7l-4-7 2.5-6.5zm0 2.3L9 8l1.5 4.5L12 17l1.5-4.5L15 8z"/>',
  fish: '<path d="M2 12s3.5-5.5 9-5.5c4 0 7 2.5 8.5 4L22 8v8l-2.5-2.5c-1.5 1.5-4.5 4-8.5 4-5.5 0-9-5.5-9-5.5zm9 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>',
  tent: '<path d="M12 3l10 18h-7l-3-6-3 6H2zm0 4.5L5.5 19h3L12 12l3.5 7h3z"/>',
  supply: '<path d="M12 2a7 7 0 0 1 7 7h-4l2 3h-3v2h-4v-2H7l2-3H5a7 7 0 0 1 7-7zm-3 14h6v6H9z"/>',
};

export function svg(name, size = 18, cls = '') {
  const body = P[name] || P.pin;
  const stroke = name === 'chevD' ? ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' : ' fill="currentColor"';
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24"${stroke} aria-hidden="true">${body}</svg>`;
}

/** Kategorie-Metadaten für POI-Ebenen. */
export const CATEGORIES = {
  fasttravel: { label: 'Schnellreise', icon: 'statue', color: '#46c8ff' },
  towers: { label: 'Syndikat-Türme', icon: 'tower', color: '#ff6b7a' },
  bosses: { label: 'Alpha-Bosse', icon: 'skull', color: '#ff9f43' },
  dungeons: { label: 'Dungeons', icon: 'dungeon', color: '#b98cff' },
  effigies: { label: 'Lifmunk-Effigien', icon: 'effigy', color: '#5fe0a0' },
  chests: { label: 'Truhen', icon: 'chest', color: '#ffd34d' },
  eggs: { label: 'Eier', icon: 'egg', color: '#ffc1e3' },
  fruits: { label: 'Skillfrucht-Bäume', icon: 'fruit', color: '#9be15d' },
  merchants: { label: 'Händler & NPCs', icon: 'merchant', color: '#e8c39e' },
  predators: { label: 'Raubtier-Pals', icon: 'predator', color: '#ff5252' },
  raids: { label: 'Raid-Bosse', icon: 'raid', color: '#ff77ff' },
  sanctuaries: { label: 'Pal-Schutzgebiete', icon: 'sanctuary', color: '#7fe3ff' },
  oilrigs: { label: 'Ölplattformen', icon: 'oilrig', color: '#c9d4e0' },
  ores: { label: 'Erze & Ressourcen', icon: 'rock', color: '#d9a066' },
  fishing: { label: 'Angelplätze', icon: 'fish', color: '#5cb8ff' },
  camps: { label: 'Syndikat-Camps', icon: 'tent', color: '#ff8a5c' },
  supply: { label: 'Supply-Drops', icon: 'supply', color: '#9be15d' },
};

/** Element-Farben & deutsche Labels für Pals. */
export const ELEMENTS = {
  neutral: { label: 'Neutral', color: '#c9d4e0' },
  fire: { label: 'Feuer', color: '#ff8a5c' },
  water: { label: 'Wasser', color: '#5cb8ff' },
  grass: { label: 'Gras', color: '#8ee06e' },
  electric: { label: 'Elektro', color: '#ffe45c' },
  ice: { label: 'Eis', color: '#a5ecff' },
  ground: { label: 'Boden', color: '#d9a066' },
  dark: { label: 'Dunkel', color: '#b98cff' },
  dragon: { label: 'Drache', color: '#ff7ad9' },
};

/** Farbpalette für aktivierte Pal-Spawn-Ebenen. */
export const SPAWN_COLORS = ['#46c8ff', '#ffd34d', '#5fe0a0', '#ff6b7a', '#b98cff', '#ff9f43', '#7fe3ff', '#9be15d', '#ffc1e3', '#e8c39e'];
