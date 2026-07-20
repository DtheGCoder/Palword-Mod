/**
 * Koordinatensysteme:
 *   world — Unreal-Engine-Weltkoordinaten in cm (kanonisches Format der App;
 *           +X = Norden/oben, +Y = Osten/rechts auf der Karte)
 *   game  — Ingame-Map-Koordinaten, wie Palworld sie anzeigt (z.B. "337, -395")
 *   px    — Pixel des 8192er-Kartenbildes (Ursprung oben links)
 *
 * Konstanten stammen aus den Spieldaten (DT_WorldMapUIData, via
 * palworld-save-pal ui/src/lib/components/map/utils.ts):
 *   MainMap: worldX ∈ [-1099400, 349400], worldY ∈ [-724400, 724400]
 *   Tree:    worldX ∈ [347351.5, 689148.5], worldY ∈ [-818197, -476400]
 *   Ingame:  mapX = (worldY - 157935)/459 ;  mapY = -(worldX + 123930)/459
 */

export const INGAME = { scale: 459, offY: 157935, offX: 123930 };

export class RegionMath {
  constructor(cfg) {
    this.cfg = cfg;
    this.w = cfg.width || 8192;
    this.h = cfg.height || 8192;
    const b = cfg.worldBounds;
    this.b = b;
    this.cmPerPx = (b.maxX - b.minX) / this.h;
  }

  contains(wx, wy) {
    const b = this.b;
    return wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY;
  }

  worldToPx(wx, wy) {
    return {
      px: (wy - this.b.minY) / this.cmPerPx,
      py: this.h - (wx - this.b.minX) / this.cmPerPx,
    };
  }

  pxToWorld(px, py) {
    return {
      wx: this.b.minX + (this.h - py) * this.cmPerPx,
      wy: this.b.minY + px * this.cmPerPx,
    };
  }

  // Rechenprobe (palworld-coord README): Anubis Welt(-167230, 96430) → Karte(-134, -94) ✓
  worldToGame(wx, wy) {
    return {
      gx: (wy - INGAME.offY) / INGAME.scale,
      gy: (wx + INGAME.offX) / INGAME.scale,
    };
  }

  gameToWorld(gx, gy) {
    return {
      wy: gx * INGAME.scale + INGAME.offY,
      wx: gy * INGAME.scale - INGAME.offX,
    };
  }
}

/** Distanz zweier Welt-Punkte in Metern (UE rechnet in cm). */
export function distMeters(a, b) {
  return Math.hypot(a.wx - b.wx, a.wy - b.wy) / 100;
}

/**
 * Kartenrichtung (0° = Norden/oben, im Uhrzeigersinn) von a nach b.
 * Da +X Norden und +Y Osten ist, entspricht das exakt atan2(dy, dx) —
 * und damit auch dem UE-Yaw des Spielers.
 */
export function bearingWorld(a, b) {
  return (Math.atan2(b.wy - a.wy, b.wx - a.wx) * 180 / Math.PI + 360) % 360;
}

/** UE-Yaw → Kartenrichtung (identisch, nur normalisiert). */
export function yawToBearing(yawDeg) {
  return ((yawDeg % 360) + 360) % 360;
}

/** Region anhand von Weltkoordinaten bestimmen (höchste Priorität gewinnt). */
export function regionForWorld(mathByRegion, wx, wy) {
  let best = null, bestPrio = -Infinity;
  for (const [id, rm] of Object.entries(mathByRegion)) {
    const prio = rm.cfg.priority || 0;
    if (rm.contains(wx, wy) && prio > bestPrio) { best = id; bestPrio = prio; }
  }
  return best || 'palpagos';
}

/** Kleinster Winkelunterschied a→b in Grad (-180..180). */
export function angleDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}

/** Exponentielle Winkelglättung über den kürzesten Bogen. */
export function smoothAngle(prev, next, alpha) {
  if (prev == null || Number.isNaN(prev)) return next;
  return (prev + angleDelta(prev, next) * alpha + 360) % 360;
}

export function fmtGame(g) {
  return `${Math.round(g.gx)}, ${Math.round(g.gy)}`;
}

export function fmtDist(m) {
  if (!Number.isFinite(m)) return '–';
  if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km';
  return Math.round(m) + ' m';
}
