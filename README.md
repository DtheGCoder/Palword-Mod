# PalPilot — Palworld Ingame-Map-Overlay

Ein transparentes Ingame-Overlay für **Palworld 1.0** mit kompletter interaktiver Karte
(Palpagos-Inseln inkl. Sakurajima, Feybreak & Sunreach + Weltenbaum), **Live-Spielerposition**,
**Wegpunkten mit Navigator**, Pal-Spawn-Suche wie auf palworld.gg — direkt über dem Spiel.

![Modi](https://img.shields.io/badge/F6-Karte-46c8ff) ![HUD](https://img.shields.io/badge/F7-HUD-46c8ff) ![WP](https://img.shields.io/badge/F8-Wegpunkt-ffd34d) ![Stop](https://img.shields.io/badge/F9-Stopp-ff6b7a)

## Features

- 🗺️ **Komplette 1.0-Karte** — beide Original-Spielkarten in 8192px (Palpagos + Weltenbaum), Regionswechsel per Klick, automatisch beim Betreten
- 📍 **Live-Position** — pulsierender Spieler-Marker mit Blickrichtungskegel, Bewegungsspur, „Karte folgt Spieler"
- 🧭 **Navigator mit Ziel-Menü** — in der großen Karte ein „Wohin willst du?"-Menü: Ziel per Kategorie (Schnellreise/Türme/Bosse/Dungeons/Wegpunkte, nach Entfernung sortiert), per „Auf Karte klicken" oder per Suche wählen → animierter Kompass mit Richtungsnadel (relativ zur Blickrichtung), Distanz & ETA; Routen mit mehreren Stationen, Fortschrittsanzeige und Auto-Weiterschaltung
- 🎯 **Wegpunkte** — per Rechtsklick oder **F8** (an der Spielerposition, ohne das Spiel zu verlassen), umbenennen, einfärben, verschieben, Import/Export als JSON
- 🐾 **Pal-Spawns** — alle Pals mit deutschen Namen, Paldeck-Icons und Element-Anzeige; mehrere Pals gleichzeitig farbcodiert auf der Karte (64.000+ Spawn-Punkte, 1.0-Datenstand inkl. Weltenbaum)
- 🏰 **POI-Ebenen** — Schnellreise-Statuen, Syndikat-Türme, Alpha-Bosse, Dungeons, Lifmunk-Effigien, Truhen, Eier, Erze (inkl. Soralite/Hexolite), Angelplätze, Camps, Supply-Drops … einzeln zuschaltbar, mit „Erledigt"-Haken für Bosse/Türme/Effigien/Truhen
- 🔍 **Universalsuche** — Pal, Ort, Wegpunkt oder direkt Koordinaten („337, -395") eingeben
- ⭕ **Rundes Minimap-HUD** — click-through über dem Spiel, wahlweise mitdrehend, Größe/Zoom/Ecke/Deckkraft einstellbar
- 📏 Extras: Mess-Werkzeug, Koordinatenraster, Koordinaten kopieren, manuelle Position („Ich stehe hier"), Bewegungsspur, Demo-Modus

## Schnellstart — alles automatisch

1. [Node.js LTS](https://nodejs.org) installieren (einmalig).
2. Doppelklick auf **`start.bat`** — installiert beim ersten Start Abhängigkeiten und
   lädt Karten/Spawns/Icons (~30 MB) automatisch.
3. Beim ersten Start öffnet sich der **Setup-Assistent**: Er findet deine
   Palworld-Installation selbst (sonst einmal Ordner wählen) und erledigt den Rest
   automatisch — **UE4SS-Download von GitHub, Positions-Mod installieren, aktivieren
   und Palworld auf „Vollbild (Fenster)" stellen**. Ein Klick, fertig.
4. Palworld starten → Status-Chip wird grün: **„Live · UE4SS"**. Position, Minimap
   und Navigator aktualisieren sich **live, 5× pro Sekunde**.

Der Assistent ist jederzeit erneut erreichbar: Einstellungen (Zahnrad) →
„Spiel-Setup starten". CLI-Alternative ohne GUI: `scripts\install-mod.ps1`
(lädt UE4SS ebenfalls automatisch). Terminal-Weg statt start.bat:

```powershell
npm install && npm run fetch-assets && npm start
```

> Der Fenstermodus „Vollbild (Fenster)" ist Pflicht — über exklusivem Vollbild kann
> kein Overlay liegen (bei Discord & Co. genauso). Der Assistent stellt das
> automatisch um (Backup: `GameUserSettings.ini.palpilot.bak`).

Zum Ausprobieren **ohne Palworld**:

```powershell
npm start -- --windowed --mock    # normales Fenster mit simuliertem Spieler
```

## Hotkeys (global, auch im Spiel)

| Taste | Funktion |
|---|---|
| **F6** | Große Karte öffnen/schließen (Maus aktiv) |
| **F7** | HUD (Minimap + Navigator) ein-/ausblenden |
| **F8** | Schnell-Wegpunkt an der aktuellen Spielerposition |
| **F9** | Navigation beenden |
| **Esc** | Karte schließen / Menüs schließen |

Anpassbar in `settings.json` (Einstellungen → „Einstellungs-Ordner").

## Live-Position einrichten (eine von drei Quellen)

| Quelle | Für wen | Genauigkeit |
|---|---|---|
| **UE4SS-Mod** | Singleplayer & lokaler Koop | Echtzeit (5 Hz) inkl. Blickrichtung |
| **REST-API** | Eigener Dedicated Server | alle ~2 s, Position |
| **Manuell** | ohne alles | Rechtsklick → „Ich stehe hier" |

1. **UE4SS-Mod (empfohlen):** Anleitung in [ue4ss-mod/INSTALL.md](ue4ss-mod/INSTALL.md) —
   Mod-Ordner kopieren, Spiel starten, fertig. Status springt auf „Live · UE4SS".
2. **Dedicated Server:** In `PalWorldSettings.ini` des Servers `RESTAPIEnabled=True` setzen
   und ein `AdminPassword` vergeben. Dann im Overlay: Einstellungen → REST-API aktivieren,
   Host/Port/Passwort (+ eigenen Spielernamen) eintragen.
3. **Manuell:** funktioniert immer — Position per Rechtsklick setzen, Navigator zeigt trotzdem Richtung & Distanz.

## Admin-Modus (versteckt) — Live-Inventar-Editor

Ein versteckter Editor, der dein Inventar **live** spiegelt und bearbeitet.

- **Öffnen:** 3× schnell auf das **PalPilot-Logo** oben links klicken (oder `Strg+Shift+A`) → Passwort **`0815`**.
- **Inventar-Grid:** zeigt deine Slots als Live-Replik. Menge anklicken → direkt ändern; über „Maximum" auf Stack-Limit setzen; Papierkorb entfernt das Item.
- **Item hinzufügen:** leeren Slot (oder „Item hinzufügen") anklicken → aus **allen 1.700+ Items** suchen (deutsche Namen, Icons, Kategorien) → Menge wählen → hinzufügen.
- Alle Änderungen erscheinen sofort in deinem echten Spiel-Inventar.

> **Wirkt nur bei dir.** Die Änderungen laufen ausschließlich über das Inventar-Objekt
> deines lokalen Spielers (Host). Andere Spieler auf deinem selbst gehosteten Server sind
> **nie** betroffen. Voraussetzung ist die UE4SS-Mod (dieselbe wie für die Live-Position);
> ohne sie zeigt der Editor ein Demo-Inventar. Das Passwort ist nur ein Sichtschutz, keine
> echte Sicherung. Nutze das nur in deinem eigenen Spiel/Server — nicht auf fremden Servern.

## Projektstruktur

```
PAL Overlay/
├─ src/main/          Electron: Overlay-Fenster, Hotkeys, Tray, Positions-Engine
├─ src/renderer/      UI: Leaflet-Karte, HUD, Panels (alles offline, kein Build-Schritt)
├─ scripts/           fetch-assets (Daten-Download), dev-server, copy-vendor
├─ ue4ss-mod/         Lua-Mod für die Live-Position + INSTALL.md
├─ data/              regions/pals/markers/spawns (von fetch-assets erzeugt)
└─ assets/            Kartenbilder + Pal-Icons (von fetch-assets erzeugt)
```

## Datenquellen & Dank

- Kartenbilder & Spieldaten-JSONs: [oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal) (Spiel-Extrakte, 1.0)
- Spawn-Daten: [Awy64/palworld-atlas-data](https://github.com/Awy64/palworld-atlas-data) (MIT, automatisch aus dem offiziellen Dedicated Server extrahiert)
- Zusätzliche POIs: [paldb.cc](https://paldb.cc) · Koordinaten-Formeln: `DT_WorldMapUIData` via save-pal, [palworld-coord](https://github.com/palworldlol/palworld-coord)
- UE4SS: [Okaetsu/RE-UE4SS](https://github.com/Okaetsu/RE-UE4SS) / UE4SS-RE-Team

Alle Assets stammen aus dem Spiel bzw. Community-Datenbanken und sind **nur für den
privaten Gebrauch** gedacht. Palworld © Pocketpair.

## Troubleshooting

- **Overlay unsichtbar über dem Spiel** → Spiel auf „Vollbild (Fenster)" stellen; F7 drücken (HUD evtl. ausgeblendet).
- **Status bleibt „Keine Position"** → `Get-Content $env:TEMP\pal_overlay_pos.json` prüfen (UE4SS-Mod aktiv?); REST: Host/Port/Passwort prüfen (`http://host:8212/v1/api/players`).
- **Karte fehlt / Platzhalter** → `npm run fetch-assets` erneut ausführen (Firewall/Proxy? Das Skript nutzt automatisch curl.exe als Fallback).
- **Hotkeys reagieren nicht** → anderes Tool belegt F6–F9? In `settings.json` umbelegen, Overlay per Tray-Menü neu laden.
- **Nach Palworld-Patch keine Position** → UE4SS-Build aktualisieren (siehe INSTALL.md); Karten/Daten mit `npm run fetch-assets -- --force` auffrischen.
