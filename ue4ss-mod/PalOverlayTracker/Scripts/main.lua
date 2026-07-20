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
local INV_MS = 500

local function valid(o) return o and o.IsValid and o:IsValid() end
local function jesc(s) return tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"') end

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

local function getLocalInventoryData()
    local pc = getLocalController()
    if not valid(pc) then return nil end
    local ps = pc.PlayerState
    if not valid(ps) then return nil end
    local inv = ps.GetInventoryData and ps:GetInventoryData() or ps.InventoryData
    if valid(inv) then return inv, ps end
    return nil
end

-- ------------------------------------------------------------ Position

local function snapshotPos()
    local pc = getLocalController()
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

local function readInventory()
    local list, player = {}, "Spieler"
    local inv, ps = getLocalInventoryData()
    if not inv then return list, player, 0 end
    local okn, nm = pcall(function() return ps:GetPlayerName():ToString() end)
    if okn and nm and nm ~= "" then player = nm end

    local helper = inv.InventoryMultiHelper
    if not valid(helper) then return list, player, 0 end
    local containers = helper.Containers
    local running, capacity = 0, 0
    if containers then
        for ci = 1, #containers do
            local c = containers[ci]
            if valid(c) then
                local n = c.SlotNum or 0
                capacity = capacity + n
                for s = 0, n - 1 do
                    local ok, slot = pcall(function() return c:Get(s) end)
                    if ok and valid(slot) and not slot:IsEmpty() then
                        local okid, id = pcall(function() return slot:GetItemId().StaticId:ToString() end)
                        local okc, cnt = pcall(function() return slot:GetStackCount() end)
                        if okid and okc and id and id ~= "None" and cnt and cnt > 0 then
                            list[#list + 1] = { slot = running, id = id, count = cnt }
                        end
                    end
                    running = running + 1
                end
            end
        end
    end
    return list, player, (capacity > 0 and capacity or 42)
end

local function writeInventory()
    local ok, list, player, size = pcall(readInventory)
    if not ok or type(list) ~= "table" then return end
    local parts = {}
    for _, it in ipairs(list) do
        parts[#parts + 1] = string.format('{"slot":%d,"id":"%s","count":%d}', it.slot, jesc(it.id), it.count)
    end
    writeAtomic(OUT_INV, string.format(
        '{"player":"%s","size":%d,"slots":[%s],"t":%d}',
        jesc(player or "Spieler"), size or 42, table.concat(parts, ","), os.time()))
end

-- ------------------------------------------------------------ Befehle ausführen

-- Aktuelle Gesamtmenge eines Items (über alle Slots) ermitteln
local function currentCount(itemId)
    local total = 0
    local list = select(1, readInventory())
    for _, it in ipairs(list) do
        if it.id == itemId then total = total + it.count end
    end
    return total
end

local function addItem(inv, itemId, count)
    if count <= 0 then return end
    -- Palworld 1.0 (2026): 4 Parameter inkl. LogDelay; älterer Build: 3 Parameter.
    local ok = pcall(function() inv:AddItem_ServerInternal(FName(itemId), count, false, 0.0) end)
    if not ok then pcall(function() inv:AddItem_ServerInternal(FName(itemId), count, false) end) end
end

local function consumeItem(inv, itemId, count)
    if count <= 0 then return end
    local util = StaticFindObject("/Script/Pal.Default__PalUtility")
    if util then
        pcall(function() util:RequestConsumeInventoryItem(inv, FName(itemId), count) end)
    end
end

local function applyCommand(op, id, count)
    local inv = getLocalInventoryData()
    if not inv then return end
    if op == "add" then
        addItem(inv, id, count)
    elseif op == "set" then
        local cur = currentCount(id)
        if count > cur then addItem(inv, id, count - cur)
        elseif count < cur then consumeItem(inv, id, cur - count) end
    elseif op == "remove" then
        local cur = currentCount(id)
        if cur > 0 then consumeItem(inv, id, cur) end
    end
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

LoopAsync(POS_MS, function()
    ExecuteInGameThread(function()
        local ok, json = pcall(snapshotPos)
        if ok and json then writeAtomic(OUT_POS, json) end
    end)
    return false
end)

initSeq()
LoopAsync(INV_MS, function()
    pcall(processCommands)                 -- Befehle prüfen (Dateizugriff im Async-Thread ok)
    ExecuteInGameThread(function()
        pcall(writeInventory)              -- Inventar lesen im Game-Thread
    end)
    return false
end)

print("[PalOverlayTracker] aktiv — Position + Inventar-Bruecke fuer PalPilot laeuft.\n")
