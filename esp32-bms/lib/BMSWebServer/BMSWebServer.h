#pragma once
#include <Arduino.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <Update.h>
#include <ConfigManager.h>
#include <Logger.h>
#include <WiFiManager.h>
#include <BMSInterface.h>

extern const char* FW_VERSION;
extern const char* FW_BUILD;

class BMSWebServer {
public:
    using BMSDataProvider = std::function<String()>;
    using BMSConfigUpdater = std::function<bool(const String&)>;
    using BMSConfigPicker = std::function<bool(const String&)>;
    using BMSResetFn = std::function<void()>;
    using BMSScanner = std::function<String(int timeoutSeconds)>;
    using BMSScannerAll = std::function<String(int timeoutSeconds)>;
    using BMSReconnector = std::function<bool()>;
    using BMSTester = std::function<bool()>;

    static BMSWebServer& instance() {
        static BMSWebServer inst;
        return inst;
    }

    void begin(uint16_t port = 80) {
        _server = new AsyncWebServer(port);
        _ws = new AsyncWebSocket("/ws");
        _ws->onEvent([this](AsyncWebSocket* server, AsyncWebSocketClient* client, AwsEventType type, void* arg, uint8_t* data, size_t len) {
            onWsEvent(server, client, type, arg, data, len);
        });
        _server->addHandler(_ws);
        _setupRoutes();
        _server->begin();
        LOG_INFO("[WebServer] Started on port " + String(port));
    }

    void setBMSDataProvider(BMSDataProvider provider) { _dataProvider = provider; }
    void setBMSConfigUpdater(BMSConfigUpdater updater) { _configUpdater = updater; }
    void setBMSConfigPicker(BMSConfigPicker picker) { _configPicker = picker; }
    void setBMSResetFn(BMSResetFn fn) { _resetFn = fn; }
    void setBMSScanner(BMSScanner scanner) { _scanner = scanner; }
    void setBMSScannerAll(BMSScannerAll scanner) { _scannerAll = scanner; }
    void setBMSReconnector(BMSReconnector reconnector) { _reconnector = reconnector; }
    void setBMSTester(BMSTester tester) { _tester = tester; }

    void broadcastWS(const String& msg) {
        if (_ws) _ws->textAll(msg);
    }

    void broadcastBMSData() {
        if (_dataProvider && _ws && _ws->count() > 0) {
            String data = _dataProvider();
            String wsMsg = "{\"type\":\"data\"," + data.substring(1);
            _ws->textAll(wsMsg);
        }
    }

    void broadcastStatus() {
        if (!_ws || _ws->count() == 0) return;
        JsonDocument doc;
        doc["type"] = "status";
        doc["firmware"] = FW_VERSION;
        doc["build"] = FW_BUILD;
        doc["wifi"] = WiFi.status() == WL_CONNECTED ? "online" : "offline";
        doc["ip"] = WiFi.localIP().toString();
        doc["rssi"] = WiFi.RSSI();
        doc["heap"] = ESP.getFreeHeap();
        doc["uptime"] = millis() / 1000;
        doc["ap_mode"] = WiFiManager::instance().isAPMode();
        String result;
        serializeJson(doc, result);
        _ws->textAll(result);
    }

    void broadcastLogs() {
        if (!_ws || _ws->count() == 0) return;
        String logs = Logger::instance().getTail(30);
        String msg = "{\"type\":\"logs\",\"data\":" + String("\"") + logs + String("\"") + "}";
        _ws->textAll(msg);
    }

    void cleanupClients() {
        if (_ws) _ws->cleanupClients();
    }

private:
    AsyncWebServer* _server = nullptr;
    AsyncWebSocket* _ws = nullptr;
    BMSDataProvider _dataProvider;
    BMSConfigUpdater _configUpdater;
    BMSConfigPicker _configPicker;
    BMSResetFn _resetFn;
    BMSScanner _scanner;
    BMSScannerAll _scannerAll;
    BMSReconnector _reconnector;
    BMSTester _tester;

    void onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client, AwsEventType type, void* arg, uint8_t* data, size_t len) {
        if (type == WS_EVT_CONNECT) {
            LOG_DEBUG("[WS] Client connected: " + String(client->id()));
        } else if (type == WS_EVT_DISCONNECT) {
            LOG_DEBUG("[WS] Client disconnected: " + String(client->id()));
        } else if (type == WS_EVT_DATA) {
            AwsFrameInfo* info = (AwsFrameInfo*)arg;
            if (info->final && info->index == 0 && info->len == len) {
                String msg = String((char*)data).substring(0, len);
                JsonDocument doc;
                if (!deserializeJson(doc, msg)) {
String cmd = doc["cmd"].as<String>();
                    if (cmd == "scan" && _scanner) {
                        broadcastWS("{\"type\":\"scan_start\"}");
                        int timeout = doc.containsKey("timeout") ? doc["timeout"].as<int>() : 5;
                        String result = _scanner(timeout);
                        broadcastWS("{\"type\":\"scan_result\",\"data\":" + result + "}");
                    } else if (cmd == "scan_all" && _scannerAll) {
                        broadcastWS("{\"type\":\"scan_start\"}");
                        int timeout = doc.containsKey("timeout") ? doc["timeout"].as<int>() : 8;
                        String result = _scannerAll(timeout);
                        broadcastWS("{\"type\":\"scan_all_result\",\"data\":" + result + "}");
                    } else if (cmd == "logs") {
                        broadcastLogs();
                    }
                }
            }
        }
    }

    const String _dashboardHTML = R"rawliteral(
<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desmonitor BMS Bridge</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 16px; }
  h1 { font-size: 1.2rem; margin-bottom: 16px; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
  h2 { font-size: 1rem; margin: 12px 0 8px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
  .card { background: #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 12px; border-left: 3px solid transparent; }
  .card.alert { border-left-color: #f87171; background: #2d1f1f; }
  .card.warn { border-left-color: #facc15; background: #2d2818; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .value { font-size: 1.4rem; font-weight: 700; }
  .value.sm { font-size: 1rem; }
  .label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; }
  .good { color: #4ade80; }
  .warn { color: #facc15; }
  .bad { color: #f87171; }
  .info { color: #38bdf8; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.85rem; }
  .cell-bar { height: 24px; border-radius: 4px; background: #334155; margin: 2px 0; position: relative; }
  .cell-bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #3b82f6, #38bdf8); transition: width 0.3s; }
  .cell-bar-text { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 0.7rem; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
  .cell-bar-num { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 0.7rem; color: #cbd5e1; }
  #log { font-family: monospace; font-size: 0.7rem; color: #94a3b8; max-height: 200px; overflow-y: auto; white-space: pre-wrap; background: #0f172a; padding: 8px; border-radius: 4px; }
  .nav { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .nav a { padding: 6px 12px; background: #1e293b; border-radius: 8px; text-decoration: none; color: #94a3b8; font-size: 0.8rem; }
  .nav a.active { background: #38bdf8; color: #0f172a; font-weight: 600; }
  .btn { padding: 8px 16px; border: none; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 600; }
  .btn-sm { padding: 4px 10px; font-size: 0.75rem; }
  .btn-primary { background: #38bdf8; color: #0f172a; }
  .btn-danger { background: #f87171; color: #fff; }
  .btn-warning { background: #facc15; color: #0f172a; }
  .btn-secondary { background: #475569; color: #e2e8f0; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  input[type=text], input[type=password], input[type=number] { width: 100%; padding: 8px; background: #334155; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0; margin: 4px 0; }
  select { width: 100%; padding: 8px; background: #334155; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0; margin: 4px 0; }
  .page { display: none; }
  .page.active { display: block; }
  .conn-dot { width: 10px; height: 10px; border-radius: 50%; background: #64748b; flex-shrink: 0; }
  .conn-dot.online { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
  .conn-dot.offline { background: #f87171; }
  .conn-dot.warn { background: #facc15; }
  .conn-text { font-size: 0.75rem; color: #94a3b8; margin-left: 8px; }
  .alert-banner { display: none; padding: 8px 12px; background: #7f1d1d; color: #fff; border-radius: 8px; margin-bottom: 8px; font-size: 0.85rem; font-weight: 600; }
  .alert-banner.show { display: block; }
  .alert-banner.warn { background: #713f12; }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .scan-list { margin-top: 8px; }
  .scan-item { display: flex; justify-content: space-between; padding: 6px 8px; background: #0f172a; border-radius: 4px; margin: 2px 0; font-size: 0.8rem; }
  .scan-item .rssi { color: #94a3b8; font-family: monospace; }
  .rssi-bar { display: inline-block; height: 4px; background: #4ade80; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  .loading-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15,23,42,0.85); z-index: 100; align-items: center; justify-content: center; }
  .loading-overlay.show { display: flex !important; }
  .loading-box { background: #1e293b; border-radius: 12px; padding: 24px; text-align: center; }
  .spinner { width: 32px; height: 32px; border: 3px solid #334155; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<h1><span>🔋 Desmonitor BMS Bridge</span><span class="conn-dot" id="conn-dot"></span><span class="conn-text" id="conn-text">Connecting...</span></h1>
<div id="alert-banner" class="alert-banner"></div>

<div id="loading-overlay" class="loading-overlay">
  <div class="loading-box">
    <div class="spinner"></div>
    <div id="loading-text" style="color:#38bdf8;font-weight:600;">Scanning BLE...</div>
    <div style="color:#94a3b8;font-size:0.8rem;margin-top:8px;">WiFi may be slow during scan</div>
  </div>
</div>

<div class="nav">
  <a href="#" data-page="dashboard" class="active">Dashboard</a>
  <a href="#" data-page="cells">Cells</a>
  <a href="#" data-page="config">Config</a>
  <a href="#" data-page="logs">Logs</a>
  <a href="#" data-page="status">Status</a>
</div>

<div id="page-dashboard" class="page active">
  <div class="card">
    <div class="grid">
      <div><div class="label">Voltage</div><div class="value info" id="d-voltage">--</div></div>
      <div><div class="label">Current</div><div class="value" id="d-current">--</div></div>
      <div><div class="label">SoC</div><div class="value good" id="d-soc">--</div></div>
      <div><div class="label">Power</div><div class="value" id="d-power">--</div></div>
    </div>
  </div>
  <div class="card" id="card-cells">
    <h2>Cells</h2>
    <div class="grid">
      <div><div class="label">Min</div><div class="value warn" id="d-cell-min">--</div></div>
      <div><div class="label">Max</div><div class="value warn" id="d-cell-max">--</div></div>
      <div><div class="label">Delta</div><div class="value bad" id="d-cell-delta">--</div></div>
      <div><div class="label">Balancing</div><div id="d-balancing" class="value sm">--</div></div>
    </div>
  </div>
  <div class="card" id="card-capacity">
    <h2>Capacity &amp; Health</h2>
    <div class="grid">
      <div><div class="label">Capacity</div><div class="value sm" id="d-capacity">--</div></div>
      <div><div class="label">Cycles</div><div class="value sm" id="d-cycles">--</div></div>
      <div><div class="label">Temps</div><div class="value sm" id="d-temps">--</div></div>
    </div>
  </div>
  <div class="card">
    <h2>BMS Actions</h2>
    <div class="btn-row">
      <button class="btn btn-primary btn-sm" id="btn-test" onclick="testBMS()">Test Connection</button>
      <button class="btn btn-warning btn-sm" id="btn-reconnect" onclick="reconnectBMS()">Reconnect</button>
      <button class="btn btn-secondary btn-sm" id="btn-scan" onclick="scanBMS()">Scan JK/BMS</button>
      <button class="btn btn-secondary btn-sm" id="btn-scan-all" onclick="scanAllBMS()">Scan all BLE</button>
    </div>
    <div id="bms-scan-result" class="scan-list"></div>
  </div>
</div>

<div id="page-cells" class="page">
  <div class="card" id="cells-container"></div>
</div>

<div id="page-config" class="page">
  <div class="card">
    <h2>WiFi</h2>
    <input type="text" id="cfg-wifi-ssid" placeholder="SSID">
    <input type="password" id="cfg-wifi-pass" placeholder="Password">
    <h2>Server</h2>
    <input type="text" id="cfg-server-url" placeholder="http://desmonitor.local:8000">
    <input type="text" id="cfg-server-apikey" placeholder="API Key (optional)">
    <h2>BMS</h2>
    <select id="cfg-bms-protocol">
      <option value="ble">BLE (Bluetooth)</option>
      <option value="uart">UART (Serial)</option>
    </select>
    <input type="text" id="cfg-bms-ble-name" placeholder="BLE device name (e.g. JK-BMS)">
    <input type="text" id="cfg-bms-ble-addr" placeholder="BLE address (optional)">
    <input type="number" id="cfg-bms-poll" placeholder="Poll interval (s)">
    <div class="btn-row">
      <button class="btn btn-primary" onclick="saveConfig()">Save</button>
      <button class="btn btn-danger" onclick="factoryReset()">Factory Reset</button>
      <button class="btn btn-warning" onclick="restartDevice()">Restart</button>
    </div>
    <h2>Firmware Update</h2>
    <input type="file" id="fw-file" accept=".bin" style="margin:8px 0">
    <div class="btn-row">
      <button class="btn btn-primary" id="fw-btn" onclick="uploadFW()">Upload & Reboot</button>
    </div>
    <div id="fw-progress" style="display:none;margin-top:8px">
      <div style="background:#334155;border-radius:8px;overflow:hidden;height:24px">
        <div id="fw-bar" style="height:100%;background:#4ade80;border-radius:8px;width:0%;transition:width 0.3s"></div>
      </div>
      <div id="fw-status" style="font-size:0.8rem;margin-top:4px;color:#94a3b8"></div>
    </div>
  </div>
</div>

<div id="page-logs" class="page">
  <div class="card">
    <div class="btn-row">
      <button class="btn btn-primary btn-sm" onclick="refreshLogs()">Refresh</button>
      <input type="number" id="log-count" value="100" min="10" max="500" style="width:100px">
    </div>
    <div id="log">Loading...</div>
  </div>
</div>

<div id="page-status" class="page">
  <div class="card" id="status-container"></div>
</div>

<script>
let ws;
let wsReconnectDelay = 1000;
let scanning = false;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');
  ws.onopen = () => {
    setConn('online', 'Connected');
    wsReconnectDelay = 1000;
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'data') updateDashboard(msg);
      else if (msg.type === 'status') updateStatusUI(msg);
      else if (msg.type === 'logs') {
        const logEl = document.getElementById('log');
        if (logEl && document.getElementById('page-logs').classList.contains('active')) {
          logEl.textContent = msg.data || '';
          logEl.scrollTop = logEl.scrollHeight;
        }
      }
      else if (msg.type === 'scan_start') {
        scanning = true;
        showLoading('Scanning BLE...');
      }
      else if (msg.type === 'scan_result') { hideLoading(); scanning = false; showScanResults(msg.data); }
      else if (msg.type === 'scan_all_result') { hideLoading(); scanning = false; showScanResults(msg.data, true); }
    } catch(err) {}
  };
  ws.onclose = () => {
    setConn('offline', 'Reconnecting...');
    setTimeout(connectWS, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 10000);
  };
  ws.onerror = () => { ws.close(); };
}

function setConn(state, text) {
  const dot = document.getElementById('conn-dot');
  dot.className = 'conn-dot ' + state;
  document.getElementById('conn-text').textContent = text;
}

function showAlert(msg, warn) {
  const b = document.getElementById('alert-banner');
  b.textContent = msg;
  b.className = 'alert-banner show' + (warn ? ' warn' : '');
}

function hideAlert() { document.getElementById('alert-banner').className = 'alert-banner'; }

function showLoading(text) {
  document.getElementById('loading-text').textContent = text || 'Scanning BLE...';
  document.getElementById('loading-overlay').className = 'loading-overlay show';
}

function hideLoading() {
  document.getElementById('loading-overlay').className = 'loading-overlay';
}

function updateDashboard(d) {
  if (!d || d.error) {
    setConn('offline', d && d.error ? d.error : 'No data');
    return;
  }
  setConn('online', 'Online');
  document.getElementById('d-voltage').textContent = d.totalVoltage ? d.totalVoltage.toFixed(3) + 'V' : '--';
  document.getElementById('d-current').textContent = d.current != null ? d.current.toFixed(2) + 'A' : '--';
  document.getElementById('d-soc').textContent = d.soc != null ? d.soc.toFixed(1) + '%' : '--';
  document.getElementById('d-soc').className = 'value ' + (d.soc < 20 ? 'bad' : 'good');
  document.getElementById('d-power').textContent = d.power != null ? d.power.toFixed(0) + 'W' : '--';
  document.getElementById('d-cell-min').textContent = d.cellMinVoltage ? d.cellMinVoltage.toFixed(3) + 'V' : '--';
  document.getElementById('d-cell-max').textContent = d.cellMaxVoltage ? d.cellMaxVoltage.toFixed(3) + 'V' : '--';
  const delta = d.cellDelta || 0;
  document.getElementById('d-cell-delta').textContent = delta.toFixed(3) + 'V';
  document.getElementById('d-cell-delta').className = 'value ' + (delta >= 0.05 ? 'bad' : 'good');
  document.getElementById('d-balancing').textContent = d.balancing ? 'Active (' + (d.balancingCurrent || 0).toFixed(2) + 'A)' : 'Inactive';
  document.getElementById('d-balancing').className = 'value sm ' + (d.balancing ? 'good' : '');
  document.getElementById('d-capacity').textContent = (d.capacityRemainingAh || 0).toFixed(2) + '/' + (d.capacityFullAh || 0).toFixed(2) + ' Ah';
  document.getElementById('d-cycles').textContent = d.cycleCount || 0;
  const temps = d.temperatures || [];
  document.getElementById('d-temps').textContent = temps.length ? temps.map(t => t.toFixed(1) + '\u00B0C').join(' | ') : '--';
  document.getElementById('card-cells').className = 'card ' + (delta >= 0.05 ? 'alert' : '');
  const alerts = [];
  if (delta >= 0.05) alerts.push('Cell delta ' + delta.toFixed(3) + 'V');
  if (temps.some(t => t >= 45)) alerts.push('High temp ' + Math.max(...temps).toFixed(1) + '\u00B0C');
  if (d.soc < 20 && d.soc > 0) alerts.push('Low SoC ' + d.soc.toFixed(0) + '%');
  alerts.length ? showAlert('\u26A0 ' + alerts.join(' \u2022 ')) : hideAlert();
}

function updateStatusUI(d) {
  const c = document.getElementById('status-container');
  let html = '<h2>Status</h2>';
  
  if (d.firmware) {
    html += '<div class="row" style="background:#1e40af;padding:12px;border-radius:8px;margin-bottom:8px">';
    html += '<span style="color:#93c5fd;font-weight:600">Firmware</span>';
    html += '<span style="color:#fff;font-weight:700;font-size:1.1em">' + d.firmware + '</span></div>';
  }
  if (d.build) {
    html += '<div class="row" style="background:#1e3a8a;padding:8px;border-radius:8px;margin-bottom:12px">';
    html += '<span style="color:#93c5fd">Build</span>';
    html += '<span style="color:#cbd5e1;font-size:0.9em">' + d.build + '</span></div>';
  }
  
  for (const [k, v] of Object.entries(d)) {
    if (k === 'type' || k === 'firmware' || k === 'build') continue;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    html += '<div class="row"><span>' + k + '</span><span>' + val + '</span></div>';
  }
  c.innerHTML = html;
}

document.querySelectorAll('.nav a').forEach(a => {
  a.onclick = e => {
    e.preventDefault();
    document.querySelectorAll('.nav a, .page').forEach(el => el.classList.remove('active'));
    a.classList.add('active');
    document.getElementById('page-' + a.dataset.page).classList.add('active');
    if (a.dataset.page === 'cells') loadCells();
    if (a.dataset.page === 'logs') { refreshLogs(); startLogStream(); }
    else { stopLogStream(); }
    if (a.dataset.page === 'config') loadConfig();
    if (a.dataset.page === 'status') loadStatus();
  };
});

async function fetchJSON(url) {
  try { const r = await fetch(url); return await r.json(); }
  catch(e) { return null; }
}

async function loadCells() {
  const d = await fetchJSON('/api/bms/data');
  const c = document.getElementById('cells-container');
  if (!d || !d.cellVoltages || d.cellVoltages.length === 0) {
    c.innerHTML = '<h2>Cell Voltages</h2><div class="label">No data</div>'; return;
  }
  const cells = d.cellVoltages.filter(v => v > 0);
  if (cells.length === 0) { c.innerHTML = '<h2>Cell Voltages</h2><div class="label">No valid cells</div>'; return; }
  const min = Math.min(...cells), max = Math.max(...cells), range = max - min;
  let html = '<h2>Cell Voltages (' + cells.length + ' cells)</h2>';
  html += '<div class="row"><span>Range</span><span class="' + (range >= 0.05 ? 'bad' : 'good') + '">' + min.toFixed(3) + ' \u2013 ' + max.toFixed(3) + ' V (\u0394 ' + range.toFixed(3) + ' V)</span></div>';
  d.cellVoltages.forEach((v, i) => {
    if (v <= 0) return;
    const offset = v - min, width = range > 0 ? (offset / range) * 100 : 50;
    const cls = v === min ? 'bad' : (v === max ? 'good' : 'info');
    html += '<div class="cell-bar"><div class="cell-bar-fill" style="width:' + Math.max(8, width) + '%; background: ' + (v === min ? '#f87171' : (v === max ? '#4ade80' : 'linear-gradient(90deg, #3b82f6, #38bdf8)')) + '"></div><span class="cell-bar-text">Cell ' + (i+1) + '</span><span class="cell-bar-num">' + v.toFixed(3) + 'V</span></div>';
  });
  c.innerHTML = html;
}

async function loadConfig() {
  const d = await fetchJSON('/api/bms/config');
  if (!d) return;
  document.getElementById('cfg-wifi-ssid').value = d.wifi?.ssid || '';
  document.getElementById('cfg-server-url').value = d.server?.url || '';
  document.getElementById('cfg-server-apikey').value = d.server?.apiKey || '';
  document.getElementById('cfg-bms-protocol').value = d.bms?.protocol || 'ble';
  document.getElementById('cfg-bms-ble-name').value = d.bms?.bleName || 'JK-BMS';
  document.getElementById('cfg-bms-ble-addr').value = d.bms?.bleAddress || '';
  document.getElementById('cfg-bms-poll').value = d.bms?.pollInterval || 30;
}

async function saveConfig() {
  const body = {
    wifi: { ssid: document.getElementById('cfg-wifi-ssid').value, password: document.getElementById('cfg-wifi-pass').value },
    server: { url: document.getElementById('cfg-server-url').value, apiKey: document.getElementById('cfg-server-apikey').value },
    bms: { protocol: document.getElementById('cfg-bms-protocol').value, bleName: document.getElementById('cfg-bms-ble-name').value, bleAddress: document.getElementById('cfg-bms-ble-addr').value, pollInterval: parseInt(document.getElementById('cfg-bms-poll').value) || 30 }
  };
  try {
    const r = await fetch('/api/bms/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const res = await r.json();
    alert(res.success ? 'Saved! Restarting...' : 'Error: ' + (res.error || 'unknown'));
    if (res.success) setTimeout(() => fetch('/api/restart'), 500);
  } catch(e) { alert('Error: ' + e); }
}

async function factoryReset() {
  if (!confirm('Factory reset? This will erase all settings.')) return;
  await fetch('/api/factory-reset');
  alert('Reset done. Device will restart in AP mode.');
}

async function restartDevice() {
  if (!confirm('Restart device?')) return;
  await fetch('/api/restart');
}

function uploadFW() {
  const file = document.getElementById('fw-file').files[0];
  if (!file) { alert('Select a .bin file first'); return; }
  if (!confirm('Upload firmware? The device will reboot.')) return;
  const btn = document.getElementById('fw-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  document.getElementById('fw-progress').style.display = 'block';
  const xhr = new XMLHttpRequest();
  xhr.upload.onprogress = e => {
    if (e.lengthComputable) {
      const pct = (e.loaded / e.total * 100).toFixed(0);
      document.getElementById('fw-bar').style.width = pct + '%';
      document.getElementById('fw-status').textContent = 'Uploading ' + pct + '%...';
    }
  };
  xhr.onload = () => {
    document.getElementById('fw-bar').style.width = '100%';
    document.getElementById('fw-status').textContent = 'Done! Rebooting...';
    btn.textContent = 'Rebooting...';
    setTimeout(() => { window.location.reload(); }, 10000);
  };
  xhr.onerror = () => {
    document.getElementById('fw-status').textContent = 'Upload failed!';
    btn.disabled = false;
    btn.textContent = 'Upload & Reboot';
  };
  xhr.open('POST', '/update');
  const fd = new FormData();
  fd.append('firmware', file);
  xhr.send(fd);
  document.getElementById('fw-status').textContent = 'Uploading...';
}

async function refreshLogs() {
  const count = document.getElementById('log-count').value || 100;
  fetch('/api/logs?count=' + count).then(r => r.text()).then(t => {
    document.getElementById('log').textContent = t;
  });
}

let _logsInterval = null;
let _lastLogCount = 30;

async function loadStatus() { const d = await fetchJSON('/api/status'); if (d) updateStatusUI(d); }

function startLogStream() {
  stopLogStream();
  refreshLogs();
  _logsInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({cmd: 'logs'}));
    } else {
      refreshLogs();
    }
  }, 3000);
}

function stopLogStream() {
  if (_logsInterval) { clearInterval(_logsInterval); _logsInterval = null; }
}

async function testBMS() {
  const r = await fetchJSON('/api/bms/test');
  showAlert(r && r.success ? '\u2713 BMS OK' : '\u2717 BMS FAIL', r && r.success);
  setTimeout(hideAlert, 3000);
}

async function reconnectBMS() {
  document.getElementById('btn-reconnect').disabled = true;
  const r = await fetch('/api/bms/reconnect', { method: 'POST' });
  const j = await r.json();
  document.getElementById('btn-reconnect').disabled = false;
  showAlert(j.success ? '\u2713 Reconnect initiated' : '\u2717 Reconnect failed', j.success);
  setTimeout(hideAlert, 3000);
}

function scanBMS() {
  if (scanning) return;
  scanning = true;
  showLoading('Scanning JK/BMS (5s)...');
  setScanBtns(true);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({cmd: 'scan', timeout: 5}));
  } else {
    fetch('/api/bms/scan?timeout=5').then(r => r.json()).then(d => {
      hideLoading(); scanning = false; setScanBtns(false);
      showScanResults(d);
    }).catch(() => { hideLoading(); scanning = false; setScanBtns(false); });
  }
}

function scanAllBMS() {
  if (scanning) return;
  scanning = true;
  showLoading('Scanning all BLE (5s)...');
  setScanBtns(true);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({cmd: 'scan_all', timeout: 5}));
  } else {
    fetch('/api/bms/scan-all?timeout=5').then(r => r.json()).then(d => {
      hideLoading(); scanning = false; setScanBtns(false);
      showScanResults(d, true);
    }).catch(() => { hideLoading(); scanning = false; setScanBtns(false); });
  }
}

function setScanBtns(disabled) {
  document.getElementById('btn-scan').disabled = disabled;
  document.getElementById('btn-scan-all').disabled = disabled;
}

function showScanResults(devices, isAll) {
  setScanBtns(false);
  const target = document.getElementById('bms-scan-result');
  if (!devices || !Array.isArray(devices) || devices.length === 0) {
    target.innerHTML = '<div class="label">No devices found</div>'; return;
  }
  let html = '<h2>Found ' + devices.length + ' device(s)</h2>';
  devices.forEach(d => {
    const rssiWidth = Math.max(5, Math.min(100, (d.rssi + 100) * 2));
    const extra = isAll ? ((d.serviceCount > 0 ? ' \u2022 ' + d.serviceCount + ' svc' : '') + (d.hasManufacturerData ? ' \u2022 mfg' : '')) : '';
    html += '<div class="scan-item" style="cursor:pointer" onclick="pickDevice(\'' + d.address + '\', \'' + (d.name || '').replace(/'/g, '') + '\')"><span>' + (d.name || '<unnamed>') + ' <span class="label">' + d.address + extra + '</span></span><span><span class="rssi-bar" style="width:' + rssiWidth + 'px"></span><span class="rssi">' + d.rssi + 'dBm</span></span></div>';
  });
  target.innerHTML = html;
}

async function pickDevice(address, name) {
  if (!confirm('Pick this device?\n\n' + (name || '<unnamed>') + '\n' + address)) return;
  const r = await fetch('/api/bms/pick', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ address: address, name: name }) });
  const j = await r.json();
  showAlert(j.success ? '\u2713 Picked: ' + (name || address) : '\u2717 Pick failed', j.success);
  setTimeout(hideAlert, 3000);
}

connectWS();
</script>
</body>
</html>
)rawliteral";

    void _setupRoutes() {
        _server->on("/", HTTP_GET, [this](AsyncWebServerRequest* request) {
            request->send(200, "text/html", _dashboardHTML);
        });

        _server->on("/api/bms/data", HTTP_GET, [this](AsyncWebServerRequest* request) {
            if (_dataProvider) {
                request->send(200, "application/json", _dataProvider());
            } else {
                request->send(503, "application/json", "{\"error\":\"BMS not initialized\"}");
            }
        });

        _server->on("/api/bms/config", HTTP_GET, [this](AsyncWebServerRequest* request) {
            String json = ConfigManager::instance().toJSON();
            request->send(200, "application/json", json);
        });

        _server->on("/api/bms/config", HTTP_POST, [](AsyncWebServerRequest* request) {
        }, nullptr, [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            String body = String((char*)data).substring(0, len);
            JsonDocument doc;
            DeserializationError err = deserializeJson(doc, body);
            if (err) {
                request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
                return;
            }

            bool ok = ConfigManager::instance().update(doc);

            if (ok && _configUpdater) {
                _configUpdater(body);
            }

            request->send(200, "application/json", ok ? "{\"success\":true}" : "{\"success\":false}");
        });

        _server->on("/api/status", HTTP_GET, [this](AsyncWebServerRequest* request) {
            JsonDocument doc;
            doc["firmware"] = FW_VERSION;
            doc["build"] = FW_BUILD;
            doc["status"] = WiFi.status() == WL_CONNECTED ? "online" : "offline";
            doc["wifi_ssid"] = WiFi.SSID();
            doc["ip"] = WiFi.localIP().toString();
            doc["rssi"] = WiFi.RSSI();
            doc["uptime"] = String(millis() / 1000) + "s";
            doc["heap"] = ESP.getFreeHeap();
            doc["deviceId"] = ConfigManager::instance().get().deviceId;
            doc["ap_mode"] = WiFiManager::instance().isAPMode();

            String result;
            serializeJson(doc, result);
            request->send(200, "application/json", result);
        });

        _server->on("/api/logs", HTTP_GET, [this](AsyncWebServerRequest* request) {
            String count = request->hasParam("count") ? request->getParam("count")->value() : "100";
            request->send(200, "text/plain", Logger::instance().getTail(count.toInt()));
        });

        _server->on("/api/wifi/scan", HTTP_GET, [this](AsyncWebServerRequest* request) {
            String networks = WiFiManager::instance().scanNetworks();
            request->send(200, "application/json", networks);
        });

        _server->on("/api/restart", HTTP_GET, [this](AsyncWebServerRequest* request) {
            request->send(200, "application/json", "{\"success\":true}");
            delay(500);
            ESP.restart();
        });

        _server->on("/api/factory-reset", HTTP_GET, [this](AsyncWebServerRequest* request) {
            ConfigManager::instance().factoryReset();
            request->send(200, "application/json", "{\"success\":true}");
            delay(500);
            ESP.restart();
        });

        _server->on("/api/bms/scan", HTTP_GET, [this](AsyncWebServerRequest* request) {
            int timeout = 5;
            if (request->hasParam("timeout")) {
                timeout = request->getParam("timeout")->value().toInt();
                if (timeout < 1) timeout = 1;
                if (timeout > 10) timeout = 10;
            }
            if (_scanner) {
                request->send(200, "application/json", _scanner(timeout));
            } else {
                request->send(503, "application/json", "{\"error\":\"scanner not available\"}");
            }
        });

        _server->on("/api/bms/scan-all", HTTP_GET, [this](AsyncWebServerRequest* request) {
            int timeout = 8;
            if (request->hasParam("timeout")) {
                timeout = request->getParam("timeout")->value().toInt();
                if (timeout < 1) timeout = 1;
                if (timeout > 10) timeout = 10;
            }
            if (_scannerAll) {
                request->send(200, "application/json", _scannerAll(timeout));
            } else {
                request->send(503, "application/json", "{\"error\":\"scanner not available\"}");
            }
        });

        _server->on("/api/bms/test", HTTP_GET, [this](AsyncWebServerRequest* request) {
            bool ok = false;
            if (_tester) {
                ok = _tester();
            }
            JsonDocument doc;
            doc["success"] = ok;
            doc["status"] = ok ? "OK" : "FAIL";
            String result;
            serializeJson(doc, result);
            request->send(ok ? 200 : 503, "application/json", result);
        });

        _server->on("/api/bms/reconnect", HTTP_POST, [this](AsyncWebServerRequest* request) {
            bool ok = false;
            if (_reconnector) {
                ok = _reconnector();
            }
            JsonDocument doc;
            doc["success"] = ok;
            String result;
            serializeJson(doc, result);
            request->send(ok ? 200 : 500, "application/json", result);
        });

        _server->on("/api/bms/pick", HTTP_POST, [](AsyncWebServerRequest* request) {
        }, nullptr, [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            String body = String((char*)data).substring(0, len);
            bool ok = false;
            if (_configPicker) {
                ok = _configPicker(body);
            }
            JsonDocument doc;
            doc["success"] = ok;
            String result;
            serializeJson(doc, result);
            request->send(ok ? 200 : 400, "application/json", result);
        });

        _server->on("/update", HTTP_POST, 
            [](AsyncWebServerRequest* request) {
                bool success = !Update.hasError();
                JsonDocument doc;
                doc["success"] = success;
                doc["message"] = success ? "Firmware updated. Rebooting..." : String("Update failed: ") + Update.errorString();
                String result;
                serializeJson(doc, result);
                request->send(success ? 200 : 500, "application/json", result);
                if (success) {
                    delay(500);
                    ESP.restart();
                }
            },
            [](AsyncWebServerRequest* request, String filename, size_t index, uint8_t* data, size_t len, bool final) {
                if (!index) {
                    LOG_INFO("[OTA] Update Start: " + filename);
                    if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
                        LOG_WARN("[OTA] Not enough space to begin OTA");
                        Update.abort();
                    }
                }
                if (Update.write(data, len) != len) {
                    LOG_WARN("[OTA] Error writing data");
                    Update.abort();
                }
                if (final) {
                    if (Update.end(true)) {
                        LOG_INFO("[OTA] Update Success: " + String(index + len) + " bytes");
                    } else {
                        LOG_WARN("[OTA] Update failed: " + String(Update.errorString()));
                    }
                }
            }
        );

        _server->on("/update", HTTP_GET, [](AsyncWebServerRequest* request) {
            String html = R"rawliteral(
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OTA Update</title><style>body{font-family:monospace;background:#0f172a;color:#e2e8f0;padding:24px;text-align:center}
.btn{padding:12px 24px;background:#38bdf8;color:#0f172a;border:none;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer;margin:8px}
.progress{width:80%;height:24px;background:#334155;border-radius:12px;margin:16px auto;overflow:hidden}
.progress-bar{height:100%;background:#4ade80;border-radius:12px;transition:width 0.3s;width:0%}
#status{margin:16px 0;font-size:1.1rem}</style></head>
<body><h2>OTA Firmware Update</h2><div id="status"></div>
<div class="progress"><div class="progress-bar" id="bar"></div></div>
<input type="file" id="file" accept=".bin"><br>
<button class="btn" onclick="upload()">Upload & Reboot</button>
<script>function upload(){const f=document.getElementById('file').files[0];if(!f){document.getElementById('status').textContent='Select a .bin file';return;}
const x=new XMLHttpRequest();x.upload.onprogress=e=>{if(e.lengthComputable){const p=e.loaded/e.total*100;document.getElementById('bar').style.width=p+'%';document.getElementById('status').textContent='Uploading '+p.toFixed(0)+'%...';}};
x.onload=()=>{document.getElementById('status').textContent='Done! Rebooting...';document.getElementById('bar').style.width='100%';};
x.onerror=()=>{document.getElementById('status').textContent='Upload failed';};
x.open('POST','/update');const fd=new FormData();fd.append('firmware',f);x.send(fd);document.getElementById('status').textContent='Uploading...';}
</script></body></html>)rawliteral";
            request->send(200, "text/html", html);
        });
    }
};