#include <Arduino.h>
#include <Logger.h>
#include <ConfigManager.h>
#include <WiFiManager.h>
#include <DesmonitorClient.h>
#include <OTAManager.h>
#include <BMSWebServer.h>
#include <BMSFactory.h>

const char* FW_VERSION = "2.0.1";
const char* FW_BUILD = __DATE__ " " __TIME__;

BMSInterface* bms = nullptr;

unsigned long lastBMSPoll = 0;
unsigned long lastPush = 0;
unsigned long lastLogUpload = 0;
unsigned long lastStatusPush = 0;

BMSSnapshot latestSnapshot;
bool hasSnapshot = false;
bool _bmsConnectPending = false;

void pollBMS();
void pushData();
void onWiFiConnect(bool success);
String getBMSDataJSON();
String scanBMSJSON(int timeoutSeconds);
String scanAllBLEJSON(int timeoutSeconds);
bool reconnectBMS();
bool testBMS();
bool updateBMSConfig(const String& body);
bool pickBMSDevice(const String& body);

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n\n=== Desmonitor BMS Bridge ===\n");

    Logger::instance().begin(200);
    Logger::instance().setMinLevel(Logger::INFO);
    ConfigManager::instance().begin();

    LOG_INFO("[Main] Device ID: " + ConfigManager::instance().get().deviceId);
    LOG_INFO("[Main] FW Version: " + String(FW_VERSION) + " (" + String(FW_BUILD) + ")");

    WiFiManager::instance().begin(onWiFiConnect);

    BMSWebServer::instance().begin(ConfigManager::instance().get().device.webPort);
    BMSWebServer::instance().setBMSDataProvider(getBMSDataJSON);
    BMSWebServer::instance().setBMSScanner(scanBMSJSON);
    BMSWebServer::instance().setBMSScannerAll(scanAllBLEJSON);
    BMSWebServer::instance().setBMSTester(testBMS);
    BMSWebServer::instance().setBMSReconnector(reconnectBMS);
    BMSWebServer::instance().setBMSConfigUpdater(updateBMSConfig);
    BMSWebServer::instance().setBMSConfigPicker(pickBMSDevice);

    OTAManager::instance().begin();

    const auto& cfg = ConfigManager::instance().get();
    bms = BMSFactory::create(cfg.bms.type);

    LOG_INFO("[Main] Setup complete!");
}

void loop() {
    unsigned long now = millis();

    WiFiManager::instance().loop();
    OTAManager::instance().loop();

    if (bms) {
        bms->loop();
    }

    if (_bmsConnectPending && bms) {
        _bmsConnectPending = false;
        LOG_INFO("[Main] Starting BLE connect (deferred)...");
        bms->connect();
        LOG_INFO("[Main] BLE connect attempt done");
    }

    BMSWebServer::instance().cleanupClients();

    const auto& cfg = ConfigManager::instance().get();
    if (bms && bms->isConnected() && now - lastBMSPoll >= (unsigned long)(cfg.bms.pollInterval * 1000)) {
        lastBMSPoll = now;
        pollBMS();

        if (hasSnapshot) {
            BMSWebServer::instance().broadcastBMSData();
        }
    }

    if (cfg.server.pushEnabled && hasSnapshot &&
        now - lastPush >= (unsigned long)(cfg.server.pushInterval * 1000)) {
        lastPush = now;
        pushData();
    }

    if (cfg.server.pushEnabled && now - lastLogUpload >= (unsigned long)(cfg.logging.uploadInterval * 1000)) {
        lastLogUpload = now;
        if (WiFi.status() == WL_CONNECTED && Logger::instance().count() > 0) {
            String recentLogs = Logger::instance().getTail(20);
            DesmonitorClient::instance().pushLogs(recentLogs);
        }
    }

    if (now - lastStatusPush >= 10000) {
        lastStatusPush = now;
        BMSWebServer::instance().broadcastStatus();
    }

    yield();
}

void pollBMS() {
    if (!bms || !bms->isConnected()) return;
    LOG_DEBUG("[Main] Polling BMS...");
    BMSSnapshot snap;
    if (bms->readSnapshot(snap)) {
        latestSnapshot = snap;
        hasSnapshot = true;

        LOG_INFO("[Main] BMS: " +
            String(snap.totalVoltage, 2) + "V, " +
            String(snap.current, 2) + "A, " +
            String(snap.soc, 1) + "% SoC, " +
            String(snap.cellCount) + " cells");

        if (snap.cellDelta > 0.2) {
            LOG_WARN("[Main] Large cell delta: " + String(snap.cellDelta, 3) + "V");
        }
        if (snap.balancing) {
            LOG_DEBUG("[Main] Balancing active: " + String(snap.balancingCurrent, 2) + "A");
        }
    } else {
        LOG_WARN("[Main] BMS read failed: " + bms->getStatusString());
    }
}

void pushData() {
    if (WiFi.status() != WL_CONNECTED) return;

    bool ok = DesmonitorClient::instance().pushSnapshot(latestSnapshot);
    if (ok) {
        LOG_DEBUG("[Main] Data pushed to server");
    } else {
        LOG_WARN("[Main] Data push failed");
    }
}

void onWiFiConnect(bool success) {
    if (success) {
        LOG_INFO("[Main] WiFi connected");

        DesmonitorClient::instance().fetchConfig();

        if (bms) {
            const auto& cfg = ConfigManager::instance().get();
            bms->setUseBLE(cfg.bms.protocol == "ble");
            if (cfg.bms.protocol == "uart") {
                bms->setSerialPins(cfg.bms.uartRxPin, cfg.bms.uartTxPin, cfg.bms.uartBaud);
            } else {
                bms->setTargetName(cfg.bms.bleName);
                if (cfg.bms.bleAddress.length() > 0) {
                    bms->setTargetAddress(cfg.bms.bleAddress);
                }
            }
            bms->begin();
            if (cfg.bms.protocol == "ble") {
                LOG_INFO("[Main] Deferring BLE connect to first loop iteration");
                _bmsConnectPending = true;
            } else {
                bms->connect();
            }
        }
    } else {
        LOG_INFO("[Main] WiFi in AP mode — skip BLE, config at http://192.168.4.1");
    }
}

String getBMSDataJSON() {
    if (!hasSnapshot) {
        return "{\"error\":\"No BMS data yet\"}";
    }

    JsonDocument doc;
    const auto& s = latestSnapshot;

    doc["timestamp"] = s.timestamp;
    doc["totalVoltage"] = s.totalVoltage;
    doc["current"] = s.current;
    doc["power"] = s.power;
    doc["soc"] = s.soc;
    doc["cellCount"] = s.cellCount;
    doc["cellMinVoltage"] = s.cellMinVoltage;
    doc["cellMaxVoltage"] = s.cellMaxVoltage;
    doc["cellDelta"] = s.cellDelta;
    doc["balancing"] = s.balancing;
    doc["balancingCurrent"] = s.balancingCurrent;
    doc["cycleCount"] = s.cycleCount;
    doc["capacityRemainingAh"] = s.capacityRemainingAh;
    doc["capacityFullAh"] = s.capacityFullAh;

    JsonArray cells = doc["cellVoltages"].to<JsonArray>();
    for (float v : s.cellVoltages) cells.add(v);

    JsonArray temps = doc["temperatures"].to<JsonArray>();
    for (float t : s.temperatures) temps.add(t);

    doc["bmsStatus"] = bms->getStatusString();
    doc["bmsProtocol"] = bms->getProtocolName();
    doc["deviceId"] = ConfigManager::instance().get().deviceId;

    String result;
    serializeJson(doc, result);
    return result;
}

String scanBMSJSON(int timeoutSeconds) {
    if (!bms) return "[]";
    bool wasConnected = bms->isConnected();
    if (wasConnected) {
        bms->disconnect();
    }
    String result = bms->scanForMatches(timeoutSeconds);
    if (wasConnected) {
        bms->connect();
    }
    return result;
}

String scanAllBLEJSON(int timeoutSeconds) {
    if (!bms) return "[]";
    bool wasConnected = bms->isConnected();
    if (wasConnected) {
        bms->disconnect();
    }
    String result = bms->scanAll(timeoutSeconds);
    if (wasConnected) {
        bms->connect();
    }
    return result;
}

bool reconnectBMS() {
    if (!bms) return false;
    LOG_INFO("[Main] Force BMS reconnect requested");
    bms->disconnect();
    return bms->connect();
}

bool testBMS() {
    if (!bms) return false;
    LOG_INFO("[Main] BMS connection test");
    if (!bms->isConnected()) return false;
    BMSSnapshot snap;
    return bms->readSnapshot(snap);
}

bool updateBMSConfig(const String& body) {
    JsonDocument doc;
    if (deserializeJson(doc, body)) {
        LOG_WARN("[Main] updateBMSConfig: invalid JSON");
        return false;
    }
    if (!bms) return false;
    const auto& cfg = ConfigManager::instance().get();
    if (doc["bms"]["type"].is<String>() ||
        doc["bms"]["protocol"].is<String>() || doc["bms"]["bleName"].is<String>() ||
        doc["bms"]["bleAddress"].is<String>() || doc["bms"]["uartRxPin"].is<uint8_t>() ||
        doc["bms"]["uartTxPin"].is<uint8_t>() || doc["bms"]["uartBaud"].is<unsigned long>()) {
        bms->disconnect();
        bms->setUseBLE(cfg.bms.protocol == "ble");
        if (cfg.bms.protocol == "uart") {
            bms->setSerialPins(cfg.bms.uartRxPin, cfg.bms.uartTxPin, cfg.bms.uartBaud);
        } else {
            bms->setTargetName(cfg.bms.bleName);
            bms->setTargetAddress(cfg.bms.bleAddress);
        }
        LOG_INFO("[Main] BMS config reloaded from settings");
    }
    return true;
}

bool pickBMSDevice(const String& body) {
    if (!bms) return false;
    JsonDocument doc;
    if (deserializeJson(doc, body)) {
        LOG_WARN("[Main] pickBMSDevice: invalid JSON");
        return false;
    }
    String address = doc["address"].as<String>();
    String name = doc["name"].as<String>();
    if (address.length() == 0) {
        LOG_WARN("[Main] pickBMSDevice: missing address");
        return false;
    }

    JsonDocument cfgDoc;
    cfgDoc["bms"]["bleAddress"] = address;
    if (name.length() > 0) cfgDoc["bms"]["bleName"] = name;
    ConfigManager::instance().update(cfgDoc);

    bms->disconnect();
    bms->setUseBLE(true);
    bms->setTargetAddress(address);
    if (name.length() > 0) bms->setTargetName(name);

    LOG_INFO("[Main] BMS picked: " + name + " [" + address + "]");
    bms->connect();
    return true;
}