@echo off
title PalPilot Overlay
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt! Bitte von https://nodejs.org installieren ^(LTS^) und nochmal starten.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Erste Einrichtung: installiere Abhaengigkeiten...
  echo Hinweis: Electron laedt dabei EINMALIG ca. 100 MB - bitte warten.
  call npm install --no-audit --no-fund
)

if not exist "assets\map\palpagos.webp" (
  echo Lade Kartendaten, Pal-Spawns und Icons ^(einmalig, ~30 MB^)...
  call npm run fetch-assets
)

echo Starte PalPilot... ^(Overlay laeuft im Tray weiter — F6 = Karte, F7 = HUD^)
call npm start
