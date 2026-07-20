# ============================================================
# Kopiert die PalOverlayTracker-Mod in deine Palworld-Installation.
# Voraussetzung: UE4SS ist bereits installiert (Steam Workshop
# "UE4SS Experimental (Palworld)" ODER manuell — siehe ue4ss-mod\INSTALL.md).
#
# Aufruf:   Rechtsklick > "Mit PowerShell ausführen"
#           oder:  powershell -ExecutionPolicy Bypass -File scripts\install-mod.ps1
#           oder mit eigenem Pfad:  ... install-mod.ps1 -GamePath "D:\Games\Palworld"
# ============================================================
param(
    [string]$GamePath = ""
)

$ErrorActionPreference = 'Stop'
$modSource = Join-Path $PSScriptRoot "..\ue4ss-mod\PalOverlayTracker"

function Find-Palworld {
    if ($GamePath) { return $GamePath }
    $candidates = @()
    # Steam-Bibliotheken aus der Registry + libraryfolders.vdf
    try {
        $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
        if ($steam) {
            $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
            $candidates += (Join-Path $steam 'steamapps\common\Palworld')
            if (Test-Path $vdf) {
                foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
                    $lib = $m.Groups[1].Value -replace '\\\\', '\'
                    $candidates += (Join-Path $lib 'steamapps\common\Palworld')
                }
            }
        }
    } catch {}
    # Übliche Verdächtige
    foreach ($d in (Get-PSDrive -PSProvider FileSystem).Root) {
        $candidates += "${d}SteamLibrary\steamapps\common\Palworld"
        $candidates += "${d}Program Files (x86)\Steam\steamapps\common\Palworld"
        $candidates += "${d}XboxGames\Palworld\Content"
    }
    foreach ($c in $candidates | Select-Object -Unique) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

Write-Host "PalOverlayTracker-Mod installieren" -ForegroundColor Cyan
Write-Host "-----------------------------------"

if (-not (Test-Path $modSource)) {
    Write-Host "FEHLER: Mod-Quelle nicht gefunden: $modSource" -ForegroundColor Red
    exit 1
}

$game = Find-Palworld
if (-not $game) {
    Write-Host "Palworld wurde nicht gefunden." -ForegroundColor Yellow
    Write-Host 'Bitte Pfad angeben, z.B.:'
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\install-mod.ps1 -GamePath "D:\SteamLibrary\steamapps\common\Palworld"'
    exit 1
}
Write-Host "Palworld gefunden: $game"

# Binaries-Ordner (Steam: Win64, Game Pass: WinGDK)
$bin = @("$game\Pal\Binaries\Win64", "$game\Pal\Binaries\WinGDK") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bin) {
    Write-Host "FEHLER: Pal\Binaries\Win64 nicht gefunden — ist das wirklich der Palworld-Ordner?" -ForegroundColor Red
    exit 1
}

# UE4SS-Mods-Ordner finden (neues Layout: ue4ss\Mods, altes Layout: Mods)
$modsDir = @("$bin\ue4ss\Mods", "$bin\Mods") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $modsDir) {
    Write-Host ""
    Write-Host "UE4SS ist noch nicht installiert — lade es automatisch von GitHub..." -ForegroundColor Yellow
    try {
        $rel = Invoke-RestMethod 'https://api.github.com/repos/Okaetsu/RE-UE4SS/releases/tags/experimental-palworld' -Headers @{ 'User-Agent' = 'PalPilot-Setup' }
        $asset = $rel.assets | Where-Object { $_.name -eq 'UE4SS-Palworld.zip' } | Select-Object -First 1
        if (-not $asset) { throw 'UE4SS-Palworld.zip nicht im Release gefunden' }
        $zip = Join-Path $env:TEMP 'palpilot_ue4ss.zip'
        Write-Host ("  lade {0} ({1:N1} MB)..." -f $asset.name, ($asset.size / 1MB))
        Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers @{ 'User-Agent' = 'PalPilot-Setup' }
        Write-Host "  entpacke nach $bin ..."
        Expand-Archive -LiteralPath $zip -DestinationPath $bin -Force
        Remove-Item $zip -Force
        $modsDir = @("$bin\ue4ss\Mods", "$bin\Mods") | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $modsDir) { throw 'Nach dem Entpacken wurde kein Mods-Ordner gefunden' }
        Write-Host "  UE4SS installiert." -ForegroundColor Green
    } catch {
        Write-Host "Automatische UE4SS-Installation fehlgeschlagen: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Alternativen: Steam Workshop 'UE4SS Experimental (Palworld)' abonnieren"
        Write-Host "oder Zip manuell von https://github.com/Okaetsu/RE-UE4SS/releases nach $bin entpacken."
        Write-Host "Details: ue4ss-mod\INSTALL.md"
        exit 1
    }
}

# Mod kopieren
$target = Join-Path $modsDir 'PalOverlayTracker'
Copy-Item -Path $modSource -Destination $modsDir -Recurse -Force
Write-Host "Mod kopiert nach: $target" -ForegroundColor Green

# mods.txt-Eintrag ergänzen (optional, enabled.txt reicht eigentlich)
$modsTxt = Join-Path $modsDir 'mods.txt'
if ((Test-Path $modsTxt) -and -not (Select-String -Path $modsTxt -Pattern 'PalOverlayTracker' -Quiet)) {
    Add-Content -Path $modsTxt -Value "PalOverlayTracker : 1"
    Write-Host "Eintrag in mods.txt ergänzt."
}

Write-Host ""
Write-Host "Fertig! Palworld starten und im PalPilot-Overlay auf den" -ForegroundColor Green
Write-Host "gruenen Status 'Live · UE4SS' achten." -ForegroundColor Green
Write-Host "Check: Get-Content `$env:TEMP\pal_overlay_pos.json  (sollte sich beim Laufen aendern)"
