#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <Logger.h>

struct BMSConfig {
    // Supported types: "jk_bms" (JK-BMS via BLE or UART),
    //                 "daly"    (Daly BMS — UART only, future),
    //                 "ant"     (ANT BMS — UART, future),
    //                 "seplos"  (Seplos BMS — RS485, future)
    String type = "jk_bms";
    String protocol = "ble";        // "ble" or "uart"
    String bleName = "JK-BMS";
    String bleAddress = "";
    uint8_t uartRxPin = 16;
    uint8_t uartTxPin = 17;
    unsigned long uartBaud = 9600;
    uint16_t pollInterval = 30;     // seconds
};

struct ServerConfig {
    String url = "http://desmonitor.local:8000";
    String apiKey = "";
    uint16_t pushInterval = 30;     // seconds
    bool pushEnabled = true;
};

struct WiFiConfig {
    String ssid = "oooooio";
    String password = "pmgana921";
    String hostname = "desmonitor-bms";
};

struct LogConfig {
    String level = "info";          // debug, info, warn, error
    uint16_t uploadInterval = 300;  // seconds
    uint16_t maxEntries = 200;
};

struct DeviceConfig {
    bool enableOTA = true;
    String otaPassword = "";   // empty = no auth required for OTA
    uint16_t webPort = 80;
    bool apFallback = true;
    String apPassword = "config123";
};

struct Config {
    WiFiConfig wifi;
    ServerConfig server;
    BMSConfig bms;
    LogConfig logging;
    DeviceConfig device;
    bool configured = false;
    String deviceId = "";
};

class ConfigManager {
public:
    static ConfigManager& instance() {
        static ConfigManager inst;
        return inst;
    }

    bool begin() {
        if (!LittleFS.begin(false)) {
            LOG_WARN("[Config] LittleFS mount failed, formatting...");
            if (!LittleFS.begin(true)) {
                LOG_ERROR("[Config] LittleFS format failed");
                return false;
            }
            LOG_INFO("[Config] LittleFS formatted");
        }

        if (!load()) {
            LOG_INFO("[Config] No saved config, saving defaults");
            saveDefaults();
        }

        // Generate unique device ID based on MAC
        if (_config.deviceId.length() == 0) {
            uint8_t mac[6];
            esp_efuse_mac_get_default(mac);
            char buf[13];
            snprintf(buf, sizeof(buf), "%02X%02X%02X%02X%02X%02X",
                     mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
            _config.deviceId = String(buf);
        }

        LOG_INFO("[Config] Device ID: " + _config.deviceId);
        return true;
    }

    const Config& get() const { return _config; }

    bool updateWiFi(const String& ssid, const String& password) {
        _config.wifi.ssid = ssid;
        _config.wifi.password = password;
        _config.configured = ssid.length() > 0;
        return save();
    }

    bool updateServer(const String& url, const String& apiKey) {
        _config.server.url = url;
        _config.server.apiKey = apiKey;
        return save();
    }

    bool updateBMS(const BMSConfig& bms) {
        _config.bms = bms;
        return save();
    }

    bool update(const JsonDocument& doc) {
        if (doc["wifi"]["ssid"].is<String>())
            _config.wifi.ssid = doc["wifi"]["ssid"].as<String>();
        if (doc["wifi"]["password"].is<String>())
            _config.wifi.password = doc["wifi"]["password"].as<String>();
        if (doc["server"]["url"].is<String>())
            _config.server.url = doc["server"]["url"].as<String>();
        if (doc["server"]["apiKey"].is<String>())
            _config.server.apiKey = doc["server"]["apiKey"].as<String>();

        if (doc["bms"]["type"].is<String>())
            _config.bms.type = doc["bms"]["type"].as<String>();
        if (doc["bms"]["protocol"].is<String>())
            _config.bms.protocol = doc["bms"]["protocol"].as<String>();
        if (doc["bms"]["bleName"].is<String>())
            _config.bms.bleName = doc["bms"]["bleName"].as<String>();
        if (doc["bms"]["bleAddress"].is<String>())
            _config.bms.bleAddress = doc["bms"]["bleAddress"].as<String>();
        if (doc["bms"]["pollInterval"].is<uint16_t>())
            _config.bms.pollInterval = doc["bms"]["pollInterval"];

        _config.configured = _config.wifi.ssid.length() > 0;
        return save();
    }

    bool factoryReset() {
        LittleFS.remove("/config.json");
        _config = Config();
        saveDefaults();
        return true;
    }

bool save() {
        JsonDocument doc;

        doc["deviceId"] = _config.deviceId;

        doc["wifi"]["ssid"] = _config.wifi.ssid;
        doc["wifi"]["password"] = _config.wifi.password;
        doc["wifi"]["hostname"] = _config.wifi.hostname;

        doc["server"]["url"] = _config.server.url;
        doc["server"]["apiKey"] = _config.server.apiKey;
        doc["server"]["pushInterval"] = _config.server.pushInterval;
        doc["server"]["pushEnabled"] = _config.server.pushEnabled;

        doc["bms"]["type"] = _config.bms.type;
        doc["bms"]["protocol"] = _config.bms.protocol;
        doc["bms"]["bleName"] = _config.bms.bleName;
        doc["bms"]["bleAddress"] = _config.bms.bleAddress;
        doc["bms"]["uartRxPin"] = _config.bms.uartRxPin;
        doc["bms"]["uartTxPin"] = _config.bms.uartTxPin;
        doc["bms"]["uartBaud"] = _config.bms.uartBaud;
        doc["bms"]["pollInterval"] = _config.bms.pollInterval;

        doc["logging"]["level"] = _config.logging.level;
        doc["logging"]["uploadInterval"] = _config.logging.uploadInterval;
        doc["logging"]["maxEntries"] = _config.logging.maxEntries;

        doc["device"]["enableOTA"] = _config.device.enableOTA;
        doc["device"]["otaPassword"] = _config.device.otaPassword;
        doc["device"]["webPort"] = _config.device.webPort;
        doc["device"]["apFallback"] = _config.device.apFallback;
        doc["device"]["apPassword"] = _config.device.apPassword;

        File file = LittleFS.open("/config.json", "w");
        if (!file) {
            LOG_ERROR("[Config] Failed to open config file for writing");
            return false;
        }
        serializeJson(doc, file);
        file.close();
        LOG_INFO("[Config] Saved (ssid=" + _config.wifi.ssid + ")");
        return true;
    }

    bool load() {
        File file = LittleFS.open("/config.json", "r");
        if (!file) return false;

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, file);
        file.close();

        if (err) return false;

        if (doc["deviceId"].is<String>())
            _config.deviceId = doc["deviceId"].as<String>();

        if (doc["wifi"]["ssid"].is<String>())
            _config.wifi.ssid = doc["wifi"]["ssid"].as<String>();
        if (doc["wifi"]["password"].is<String>())
            _config.wifi.password = doc["wifi"]["password"].as<String>();
        if (doc["wifi"]["hostname"].is<String>())
            _config.wifi.hostname = doc["wifi"]["hostname"].as<String>();

        if (doc["server"]["url"].is<String>())
            _config.server.url = doc["server"]["url"].as<String>();
        if (doc["server"]["apiKey"].is<String>())
            _config.server.apiKey = doc["server"]["apiKey"].as<String>();
        if (doc["server"]["pushInterval"].is<uint16_t>())
            _config.server.pushInterval = doc["server"]["pushInterval"];
        if (doc["server"]["pushEnabled"].is<bool>())
            _config.server.pushEnabled = doc["server"]["pushEnabled"];

        if (doc["bms"]["type"].is<String>())
            _config.bms.type = doc["bms"]["type"].as<String>();
        if (doc["bms"]["protocol"].is<String>())
            _config.bms.protocol = doc["bms"]["protocol"].as<String>();
        if (doc["bms"]["bleName"].is<String>())
            _config.bms.bleName = doc["bms"]["bleName"].as<String>();
        if (doc["bms"]["bleAddress"].is<String>())
            _config.bms.bleAddress = doc["bms"]["bleAddress"].as<String>();
        if (doc["bms"]["uartRxPin"].is<uint8_t>())
            _config.bms.uartRxPin = doc["bms"]["uartRxPin"];
        if (doc["bms"]["uartTxPin"].is<uint8_t>())
            _config.bms.uartTxPin = doc["bms"]["uartTxPin"];
        if (doc["bms"]["uartBaud"].is<unsigned long>())
            _config.bms.uartBaud = doc["bms"]["uartBaud"];
        if (doc["bms"]["pollInterval"].is<uint16_t>())
            _config.bms.pollInterval = doc["bms"]["pollInterval"];

        if (doc["device"]["enableOTA"].is<bool>())
            _config.device.enableOTA = doc["device"]["enableOTA"];
        if (doc["device"]["webPort"].is<uint16_t>())
            _config.device.webPort = doc["device"]["webPort"];
        if (doc["device"]["apFallback"].is<bool>())
            _config.device.apFallback = doc["device"]["apFallback"];

        _config.configured = _config.wifi.ssid.length() > 0;
        return true;
    }

    String toJSON() {
        JsonDocument doc;
        doc["deviceId"] = _config.deviceId;
        doc["wifi"]["ssid"] = _config.wifi.ssid;
        doc["wifi"]["hostname"] = _config.wifi.hostname;
        doc["server"]["url"] = _config.server.url;
        doc["server"]["pushInterval"] = _config.server.pushInterval;
        doc["server"]["pushEnabled"] = _config.server.pushEnabled;
        doc["bms"]["type"] = _config.bms.type;
        doc["bms"]["protocol"] = _config.bms.protocol;
        doc["bms"]["bleName"] = _config.bms.bleName;
        doc["bms"]["pollInterval"] = _config.bms.pollInterval;
        doc["logging"]["level"] = _config.logging.level;
        doc["logging"]["uploadInterval"] = _config.logging.uploadInterval;
        doc["device"]["enableOTA"] = _config.device.enableOTA;
        doc["device"]["apFallback"] = _config.device.apFallback;
        doc["configured"] = _config.configured;

        String result;
        serializeJson(doc, result);
        return result;
    }

private:
    Config _config;

    void saveDefaults() {
        save();
    }
};
