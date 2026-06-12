# desmonitor — Project Context

## Overview
Serwerowa automatyzacja Tuya z flow wizualnym i dashboardem PV. Działa jako launchd service (`com.desmonitor`), tick co 30s. Ocenia cyklicznie warunki, ustawia stany urządzeń bez zbędnego ruchu sieciowego.

## Commands
- **Build**: `npx tsc` (TypeScript → dist/)
- **Restart**: `launchctl kickstart -k gui/$(id -u)/com.desmonitor`
- **Plist**: `~/Library/LaunchAgents/com.desmonitor.plist` — entry point to fix if path changes
- **Logs**: `logs/stdout.log`
- **Run server directly**: `node dist/server.js`

## Architecture
- **Backend**: TypeScript Express server (`src/`), Tuya Python helpers (`tuya/`)
- **Frontend**: Plain JS + Tailwind, served from `public/`
- **Automation engine**: `src/automation/engine/automation-engine.ts` — tick every 30s, evaluates flow graph
- **Stats**: `src/stats/daily-stats.ts` — hourly PV/load/grid/battery accumulation, persist to `data/stats/daily-stats.json`, 30d retention

## Automation Flow
- Nodes: inverter, weather, tuya, logic, timer, action, else, label
- Connections (links) between nodes form a directed graph
- Engine evaluates nodes in dependency order each tick
- Tuya actions send commands only when DPS differs from current state
- Timer modes: countdown (z opóźnieniem), schedule (o godzinie), window (zakres godzin)

## Tuya Integration
- Local control (192.168.8.x), fallback to cloud
- DPS mapping with product-specific overrides in `tuya.node.ts`
- Cloud shadow API for devices without local IP

## Key Decisions
- `#automation-svg` (z-index:5, pointer-events:none) for visible lines
- `#automation-hits` (SVG inside `#automation-nodes`, pointer-events:all) for clickable hit areas
- `renderAutomationCanvas()` does `nodesContainer.innerHTML = ''` — must recreate `#automation-hits` after clearing
- `drawConnections()` creates line paths in main SVG and hit paths in hits SVG; `linkElements` cache tracks DOM refs
- Node positions: `transform: translate3d(x, y, 0)` not left/top
- Label groups: parent label has children[]; grouplocked toggle (🔒/🔓)
- Sync: `fetchAutomationState()` → `renderAutomationCanvas()` → `drawConnections()`

## Timer Window Mode
- `mode === 'window'` in engine: checks if current time is between `window_start` and `window_end` (HH:MM)
- Handles overnight windows (start > end, e.g. 22:00-06:00)
- When within: result=true, display="ACTIVE"
- When outside: result=false, display=countdown to next window
- Inherently daily-repeat (no loop needed)

## External Access
- **Tailscale Funnel URL**: `https://imac-tosh.tail1ed606.ts.net` (public HTTPS)
- **Tailscale IP**: `100.99.45.107` (private, requires Tailscale client)
- **Funnel service**: `com.tailscale.funnel` (LaunchAgent, `tailscale funnel 8000`)
- **Tailscale daemon**: `com.tailscale.tailscaled` (LaunchDaemon, `/Library/LaunchDaemons/`)
- **Auth check**: `tailscale status`

## Power Management
- Desmonitor runs under `caffeinate -i` (prevent idle sleep)
- Plist: `~/Library/LaunchAgents/com.desmonitor.plist` wraps `/usr/bin/caffeinate -i /usr/local/bin/node ...`
- After wake from sleep, desmonitor resumes automatically via launchd KeepAlive

## Files
- `src/automation/engine/automation-engine.ts` — engine logic
- `src/automation/nodes/tuya.node.ts` — DPS mappers, cloud fallback
- `src/automation/types.ts` — TypeScript types
- `public/js/automation.js` — flow canvas, drag, connections, timer display
- `public/js/devices.js` — device tab
- `public/css/style.css` — styles
- `public/index.html` — main HTML
- `tuya/tuya_client.py` — Tuya cloud Python client
