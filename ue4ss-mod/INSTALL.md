# UE4SS-Mod installieren (Live-Position im Singleplayer/Koop)

> **Kurzweg:** Das alles macht der **Setup-Assistent im Overlay** automatisch
> (öffnet sich beim ersten Start bzw. über Einstellungen → „Spiel-Setup starten").
> Diese Anleitung braucht ihr nur für Sonderfälle oder zum Nachvollziehen.

Die Mod `PalOverlayTracker` macht zwei Dinge:
- **Position** (5×/s) → `%TEMP%\pal_overlay_pos.json` — für Live-Marker & Navigator.
- **Inventar** (2×/s) → `%TEMP%\pal_overlay_inv.json` und liest Befehle aus
  `pal_overlay_cmd.json` — für den Admin-Inventar-Editor.

PalPilot liest diese Dateien automatisch — sobald die Mod läuft, springt der Status
im Overlay auf **„Live · UE4SS"**.

**Nur du bist betroffen:** Der Inventar-Editor ruft `AddItem_ServerInternal` /
`RequestConsumeInventoryItem` ausschließlich auf dem Inventar-Objekt deines **lokalen
Spielers** (Host) auf. Jeder Mitspieler hat im Spiel ein eigenes Inventar-Objekt und
wird nie verändert — auch wenn du lokal einen Koop-/Server hostest. Auf einem echten
Headless-Dedicated-Server (ohne lokalen Spieler) bleibt der Inventar-Teil inaktiv.

Es gibt **zwei Wege**, UE4SS zu installieren. **Nutze nur EINEN davon** —
beide gleichzeitig führen zu Crashes (doppelte Injektion)!

---

## Weg A: Steam Workshop (empfohlen, seit Palworld 1.0 offiziell)

1. Im Steam Workshop das Item **„UE4SS Experimental (Palworld)"** abonnieren
   (Workshop-ID `3625223587`).
2. Palworld starten → `Optionen → Mod-Verwaltung` → UE4SS aktivieren.
3. Herausfinden, wohin der Workshop-Loader den `ue4ss\Mods`-Ordner legt
   (üblicherweise unter `…\Palworld\Pal\Binaries\Win64\ue4ss\Mods`).
4. Den Ordner **`PalOverlayTracker`** (aus diesem Verzeichnis hier) dort hineinkopieren.
   Die enthaltene leere `enabled.txt` aktiviert die Mod automatisch.
5. Spiel neu starten. In der UE4SS-Konsole erscheint:
   `[PalOverlayTracker] aktiv — schreibt nach …\pal_overlay_pos.json`

## Weg B: Manuell (Okaetsu-Build für Palworld)

1. Von https://github.com/Okaetsu/RE-UE4SS/releases die Datei **`UE4SS-Palworld.zip`**
   des neuesten `experimental-palworld`-Releases herunterladen
   (Stand 19.07.2026 ist der Build 1.0-kompatibel).
2. Zip **in den Spielordner** entpacken: `…\Steam\steamapps\common\Palworld\Pal\Binaries\Win64\`
   (Game-Pass-Version: `…\Pal\Binaries\WinGDK\`).
   Danach liegt dort `dwmapi.dll` sowie ein `ue4ss\`-Ordner — **exakt die Struktur
   aus dem Zip beibehalten** (Anleitung im Release beachten).
3. Den Ordner **`PalOverlayTracker`** nach `…\Win64\ue4ss\Mods\` kopieren.
4. Optional zusätzlich in `…\ue4ss\Mods\mods.txt` eintragen: `PalOverlayTracker : 1`
   (nicht nötig, die `enabled.txt` reicht).
5. Spiel starten — fertig.

---

## Prüfen, ob es läuft

- PowerShell: `Get-Content $env:TEMP\pal_overlay_pos.json` → sollte eine frische
  JSON-Zeile mit `x/y/z/yaw` zeigen, die sich beim Laufen ändert.
- Im PalPilot-Overlay: Status-Chip oben rechts wird grün: **„Live · UE4SS"**.

## Deinstallieren

Ordner `PalOverlayTracker` löschen (bzw. Workshop-Item deabonnieren / `dwmapi.dll`
und `ue4ss\` entfernen).

## Hinweise

- UE4SS ist das Standard-Modding-Framework der Palworld-Community; Pocketpair
  unterstützt Modding seit 1.0 offiziell über die Mod-Verwaltung. Auf **offiziellen
  Servern mit Anti-Cheat-Regeln** trotzdem keine Mods verwenden — für Singleplayer,
  eigenen Koop und eigene Server ist es unproblematisch.
- Nach großen Palworld-Patches kann UE4SS kurzzeitig inkompatibel sein, bis die
  Community den Build aktualisiert (siehe Okaetsu-Releases bzw. Workshop-Updates).
- Die Mod liest nur deine eigene Position aus und schreibt eine lokale Datei —
  sie verändert nichts am Spiel.
