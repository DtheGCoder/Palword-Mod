-- ============================================================
-- PalOverlayTracker — Brücke zwischen Palworld und dem PalPilot-Overlay
--
--   1) Position:  schreibt 5x/s  %TEMP%\pal_overlay_pos.json
--   2) Inventar:  schreibt 2x/s  %TEMP%\pal_overlay_inv.json  (Live-Replik)
--                 liest Befehle  %TEMP%\pal_overlay_cmd.json  (Admin-Editor)
--
-- Alles wirkt AUSSCHLIESSLICH auf den lokalen Spieler (dich/Host):
-- AddItem_ServerInternal / RequestConsumeInventoryItem werden nur auf DEINEM
-- eigenen Inventar-Objekt aufgerufen. Gäste auf deinem Server haben eigene
-- Inventar-Objekte und werden nie berührt. (Verifiziert gegen die Palworld-1.0-
-- Klassen APalPlayerState/UPalPlayerInventoryData.)
--
-- Auf einem echten Headless-Dedicated-Server gibt es keinen lokalen Spieler —
-- dort bleibt der Inventar-Teil inaktiv (Positions-/Kartenfunktionen des
-- Overlays laufen dann über die REST-API).
-- ============================================================
local TEMP = os.getenv("TEMP") or "C:\\Windows\\Temp"
local OUT_POS = TEMP .. "\\pal_overlay_pos.json"
local OUT_INV = TEMP .. "\\pal_overlay_inv.json"
local CMD     = TEMP .. "\\pal_overlay_cmd.json"

local POS_MS = 200

local function valid(o) return o and o.IsValid and o:IsValid() end
local function jesc(s) return tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"') end
local function log(s) print("[PalOverlayTracker] " .. tostring(s) .. "\n") end

local function writeAtomic(path, text)
    local tmp = path .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then return end
    f:write(text); f:close()
    os.remove(path)               -- Windows: rename scheitert, wenn Ziel existiert
    os.rename(tmp, path)
end

-- ------------------------------------------------------------ Lokaler Spieler

-- Liefert den APalPlayerController des LOKALEN Spielers (nicht von Gästen!).
-- Wichtig: IsPlayerController() ist für alle Spieler true — wir prüfen
-- ausdrücklich IsLocalPlayerController().
local function getLocalController()
    local pcs = FindAllOf("PalPlayerController") or FindAllOf("PlayerController")
    if not pcs then return nil end
    for _, pc in ipairs(pcs) do
        if valid(pc) and pc.IsLocalPlayerController and pc:IsLocalPlayerController() then
            return pc
        end
    end
    return nil
end

local function getLocalInventoryData(pc)
    pc = pc or getLocalController()
    if not valid(pc) then return nil end
    local ps = pc.PlayerState
    if not valid(ps) then return nil end
    -- Verschiedene Palworld-Builds legen die Inventardaten unterschiedlich ab.
    -- Alle Zugriffe defensiv (pcall), damit ein Fehlversuch nie die Schleife
    -- abbricht und das Schreiben der inv.json blockiert.
    local inv
    local ok = pcall(function()
        if ps.GetInventoryData then inv = ps:GetInventoryData() end
    end)
    if (not ok) or (not valid(inv)) then
        pcall(function() inv = ps.InventoryData end)
    end
    if valid(inv) then return inv, ps end
    return nil, ps
end

-- ------------------------------------------------------------ Position

local function snapshotPos(pc)
    pc = pc or getLocalController()
    if not valid(pc) then return nil end
    local pawn = pc.Pawn
    if not valid(pawn) then return nil end
    local loc = pawn:K2_GetActorLocation()
    local rot = pc:GetControlRotation()
    local lvl = "unknown"
    local ok, world = pcall(function() return pc:GetWorld() end)
    if ok and valid(world) then
        local ok2, name = pcall(function() return world:GetFName():ToString() end)
        if ok2 and name then lvl = name end
    end
    return string.format(
        '{"x":%.1f,"y":%.1f,"z":%.1f,"yaw":%.2f,"level":"%s","t":%d}',
        loc.X, loc.Y, loc.Z, rot.Yaw, jesc(lvl), os.time())
end

-- ------------------------------------------------------------ Inventar lesen

local MAX_CONTAINERS = 12      -- Sicherheitskappe gegen fehlerhafte Array-Längen
local MAX_SLOTS_PER   = 300     -- Sicherheitskappe pro Container

local function readInventory(pc)
    local list, player = {}, "Spieler"
    local inv, ps = getLocalInventoryData(pc)
    if valid(ps) then
        local okn, nm = pcall(function() return ps:GetPlayerName():ToString() end)
        if okn and nm and nm ~= "" then player = nm end
    end
    if not valid(inv) then return list, player, 0 end

    -- InventoryMultiHelper defensiv holen (Property ODER Getter, je nach Build).
    local helper
    pcall(function() helper = inv.InventoryMultiHelper end)
    if not valid(helper) then
        pcall(function() if inv.GetInventoryMultiHelper then helper = inv:GetInventoryMultiHelper() end end)
    end
    if not valid(helper) then return list, player, 0 end

    local containers
    pcall(function() containers = helper.Containers end)
    if not containers then
        pcall(function() if helper.GetContainers then containers = helper:GetContainers() end end)
    end
    if not containers then return list, player, 0 end

    local ccount = 0
    pcall(function() ccount = #containers end)
    if type(ccount) ~= "number" or ccount < 0 then ccount = 0 end
    if ccount > MAX_CONTAINERS then ccount = MAX_CONTAINERS end

    local running, capacity = 0, 0
    for ci = 1, ccount do
        local c
        pcall(function() c = containers[ci] end)
        if valid(c) then
            -- Slot-Anzahl: korrekte API ist UPalItemContainer:Num().
            local n = 0
            pcall(function() n = c:Num() end)
            if type(n) ~= "number" or n <= 0 then
                pcall(function() n = c.ItemSlotArray and #c.ItemSlotArray or 0 end)
            end
            if type(n) ~= "number" or n < 0 then n = 0 end
            if n > MAX_SLOTS_PER then n = MAX_SLOTS_PER end
            capacity = capacity + n
            for s = 0, n - 1 do
                local ok, slot = pcall(function() return c:Get(s) end)
                if ok and valid(slot) then
                    local empty = true
                    pcall(function() empty = slot:IsEmpty() end)
                    if not empty then
                        local okid, id = pcall(function() return slot:GetItemId().StaticId:ToString() end)
                        local okc, cnt = pcall(function() return slot:GetStackCount() end)
                        if okid and okc and id and id ~= "None" and cnt and cnt > 0 then
                            list[#list + 1] = { slot = running, id = id, count = cnt }
                        end
                    end
                end
                running = running + 1
            end
        end
    end
    return list, player, (capacity > 0 and capacity or 42)
end

local function writeInventory(pc)
    -- IMMER schreiben — auch wenn (noch) kein Inventar lesbar ist. Nur so bleibt
    -- die Datei „frisch" und der Admin-Editor zeigt „Verbunden" statt „keine
    -- frischen Daten". Ein leeres Grid ist trotzdem nutzbar (Items hinzufügen).
    local ok, list, player, size = pcall(readInventory, pc)
    if not ok or type(list) ~= "table" then list = {}; player = "Spieler"; size = 42 end
    local readable = (ok and type(list) == "table") and 1 or 0
    local parts = {}
    for _, it in ipairs(list) do
        parts[#parts + 1] = string.format('{"slot":%d,"id":"%s","count":%d}', it.slot, jesc(it.id), it.count)
    end
    writeAtomic(OUT_INV, string.format(
        '{"player":"%s","size":%d,"ok":%d,"slots":[%s],"t":%d}',
        jesc(player or "Spieler"), size or 42, readable, table.concat(parts, ","), os.time()))
    return ok
end

-- ------------------------------------------------------------ Befehle ausführen

-- Aktuelle Gesamtmenge eines Items — bevorzugt die native Zählfunktion,
-- sonst Fallback über das gelesene Inventar.
local function currentCount(itemId)
    local inv = getLocalInventoryData()
    if valid(inv) then
        local ok, n = pcall(function() return inv:CountItemNum(FName(itemId)) end)
        if ok and type(n) == "number" then return n end
    end
    local total = 0
    local list = select(1, readInventory())
    for _, it in ipairs(list) do
        if it.id == itemId then total = total + it.count end
    end
    return total
end

-- Methoden zum HINZUFÜGEN. RequestAddItem_ForDebug meldet auf manchen Builds
-- „ok", ändert aber NICHTS — deshalb wird der Erfolg unten per Bestand
-- VERIFIZIERT und notfalls die nächste Methode probiert.
local ADD_METHODS = {
    { "AddItem_ServerInternal(5)", function(inv, fid, n) inv:AddItem_ServerInternal(fid, n, false, 0.0, true) end },
    { "AddItem_ServerInternal(4)", function(inv, fid, n) inv:AddItem_ServerInternal(fid, n, false, 0.0) end },
    { "AddItem_ServerInternal(3)", function(inv, fid, n) inv:AddItem_ServerInternal(fid, n, false) end },
    { "RequestAddItem_ForDebug",   function(inv, fid, n) inv:RequestAddItem_ForDebug(fid, n, false) end },
}

-- Methoden zum ENTFERNEN.
local REMOVE_METHODS = {
    { "IncidentBase:Consume", function(inv, fid, n)
        local inc = StaticFindObject("/Script/Pal.Default__PalIncidentBase")
        if inc then inc:RequestConsumeInventoryItem(inv, fid, n) end
    end },
    { "AddItem_ServerInternal(-,5)", function(inv, fid, n) inv:AddItem_ServerInternal(fid, -n, false, 0.0, true) end },
    { "RequestAddItem_ForDebug(-)",  function(inv, fid, n) inv:RequestAddItem_ForDebug(fid, -n, false) end },
}

-- Ausstehender Wunsch-Bestand für EIN Item. Wird jeden Tick verifiziert und
-- notfalls mit der nächsten Methode nachgebessert — solange bis CountItemNum
-- den Zielwert bestätigt. So ist es egal, welche Funktion der jeweilige
-- Palworld-Build tatsächlich akzeptiert.
local pending = nil
local PENDING_WAIT = 3      -- ~0.6 s Wartezeit pro Versuch (safeTick alle 200 ms)
local PENDING_MAXTRIES = 8

local function processPending()
    if not pending then return end
    local inv = getLocalInventoryData()
    if not valid(inv) then return end
    local cur = currentCount(pending.id)
    if cur == pending.target then
        log(string.format("OK: %s ist jetzt %d (Ziel erreicht).", pending.id, cur))
        pending = nil
        pcall(writeInventory)
        return
    end
    if pending.wait and pending.wait > 0 then pending.wait = pending.wait - 1; return end
    pending.total = (pending.total or 0) + 1
    if pending.total > PENDING_MAXTRIES then
        log(string.format("Aufgegeben: %s bleibt bei %d (Ziel %d) — keine Methode wirkte.", pending.id, cur, pending.target))
        pending = nil
        pcall(writeInventory)
        return
    end
    local delta = pending.target - cur
    local methods = (delta > 0) and ADD_METHODS or REMOVE_METHODS
    pending.idx = (pending.idx or 0) + 1
    if pending.idx > #methods then pending.idx = 1 end   -- zyklisch erneut
    local m = methods[pending.idx]
    local ok, err = pcall(function() m[2](inv, FName(pending.id), math.abs(delta)) end)
    log(string.format("%s %s x%d via %s -> %s (ist %d, Ziel %d)",
        delta > 0 and "ADD" or "REMOVE", tostring(pending.id), math.abs(delta), m[1],
        ok and "ok" or ("FEHLER " .. tostring(err)), cur, pending.target))
    pending.wait = PENDING_WAIT
end

-- Nimmt einen Befehl entgegen und setzt daraus einen Ziel-Bestand. Ausführung
-- + Verifikation übernimmt processPending() pro Tick.
local function applyCommand(op, id, count)
    local inv = getLocalInventoryData()
    if not valid(inv) then log("BEFEHL ignoriert — kein lokales Inventar (in der Welt sein!)"); return end
    local cur = currentCount(id)
    local target
    if op == "add" then target = cur + count
    elseif op == "set" then target = count
    elseif op == "remove" then target = 0
    else return end
    if target < 0 then target = 0 end
    log(string.format("BEFEHL %s id=%s count=%s | ist=%d ziel=%d", tostring(op), tostring(id), tostring(count), cur, target))
    if target == cur then pcall(writeInventory); return end
    pending = { id = id, target = target, idx = 0, wait = 0, total = 0 }
end

-- cmd-Datei: Zeile 1 = seq, danach "op|id|count"
local lastSeq = nil
local function initSeq()
    local f = io.open(CMD, "r")
    if f then
        local first = f:read("*l"); f:close()
        lastSeq = first and tonumber(first) or nil  -- alte Befehle beim Start ignorieren
    end
end

local function processCommands()
    local f = io.open(CMD, "r")
    if not f then return end
    local content = f:read("*a"); f:close()
    if not content or content == "" then return end
    local lines = {}
    for line in content:gmatch("[^\r\n]+") do lines[#lines + 1] = line end
    if #lines == 0 then return end
    local seq = tonumber(lines[1])
    if not seq or seq == lastSeq then return end
    lastSeq = seq
    log("Befehlsdatei gelesen (seq=" .. tostring(seq) .. ", " .. tostring(#lines - 1) .. " Befehl(e))")
    for i = 2, #lines do
        local op, id, cnt = lines[i]:match("^(%a+)|([^|]*)|(%-?%d+)$")
        if op and id then
            ExecuteInGameThread(function()
                pcall(applyCommand, op, id, tonumber(cnt) or 0)
            end)
        end
    end
end

-- ------------------------------------------------------------ Schleifen

-- EIN gemeinsamer Game-Thread-Tick. Zuerst wird der lokale Controller EINMAL
-- aufgelöst. Ist er nicht (voll) gültig — z. B. Ladescreen, Menü, Level-/
-- Weltenwechsel — wird NICHTS am Spielobjekt angefasst. Genau in diesem Fenster
-- („Signal verloren") ist das Spiel zuvor abgestürzt. So kann das nicht mehr
-- passieren: keine Inventar-/Positionszugriffe auf halb-zerstörte Objekte.

local INV_EVERY  = 5     -- Inventar nur jede 5. Runde lesen (~1x pro Sekunde)
local INV_MAXERR = 4     -- nach so vielen Lesefehlern: Inventar-Lesen abschalten

local tickN      = 0
local invErrors  = 0
local invEnabled = true

local function safeTick()
    local pc = getLocalController()
    if not valid(pc) then return end          -- Transition/Menü → nichts anfassen

    -- Position (bewährt, günstig)
    local okp, json = pcall(snapshotPos, pc)
    if okp and json then writeAtomic(OUT_POS, json) end

    -- Ausstehende Inventar-Befehle ausführen & verifizieren (selbstkorrigierend)
    pcall(processPending)

    -- Inventar NUR lesen, wenn die Position gerade sauber ging (Pawn ist in der
    -- Welt, kein Ladescreen/Menü). Seltener + mit Not-Aus. So werden Inventar-
    -- Objekte nie in einem instabilen Zustand angefasst.
    if not (okp and json) then return end
    tickN = tickN + 1
    if invEnabled and (tickN % INV_EVERY == 0) then
        local ok = pcall(writeInventory, pc)
        if not ok then
            invErrors = invErrors + 1
            if invErrors >= INV_MAXERR then
                invEnabled = false
                print("[PalOverlayTracker] Inventar-Lesen nach mehreren Fehlern deaktiviert — Position/Karte laufen weiter.\n")
            end
        end
    end
end

LoopAsync(POS_MS, function()
    ExecuteInGameThread(function() pcall(safeTick) end)
    return false
end)

initSeq()
LoopAsync(250, function()
    pcall(processCommands)                 -- Admin-Befehle (Dateizugriff im Async-Thread)
    return false
end)

print("[PalOverlayTracker] aktiv — Position + Inventar-Bruecke fuer PalPilot laeuft.\n")
