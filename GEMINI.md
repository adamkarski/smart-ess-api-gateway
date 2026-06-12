# Project Instructions: Desmonitor

## Architecture Overview
- **Backend:** Node.js + Fastify.
- **Automation Engine:** Background service running logic cycles every 10 minutes.
- **Nodes:**
    - `Weather`: Fetches from OpenWeather.
    - `Inverter`: Live data from DESS API.
    - `Tuya`: Local device control via `tuyapi`.
- **Persistence:** Automation state (rules/settings) stored in `data/automation.json`.
- **Service Management:** macOS `launchd` via `./manage.sh`.

## Frontend Conventions
- **Tabs:** Dashboard, Automation (Visual Canvas), Settings.
- **Styling:** Tailwind CSS + Vanilla JS.
- **Graphs:** Plotly.js.

## Developer Workflows
- **Build:** `npm run build` (tsc).
- **Service Restart:** `./manage.sh restart`.
- **API Endpoints:**
    - `/data`: Current inverter data.
    - `/automation/state`: Current automation engine state.
    - `/automation/settings`: POST to update API keys.
    - `/automation/rules`: POST to update logic rules.
