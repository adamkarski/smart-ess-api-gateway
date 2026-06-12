#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <DNSServer.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ConfigManager.h>
#include <Logger.h>

class WiFiManager {
public:
    static WiFiManager& instance() {
        static WiFiManager inst;
        return inst;
    }

    using ConnectCallback = std::function<void(bool success)>;

    void begin(ConnectCallback cb = nullptr) {
        _connectCb = cb;
        _config = &ConfigManager::instance().get();

        if (_config->wifi.ssid.length() > 0) {
            tryConnect();
        }

        if (_config->device.apFallback && WiFi.status() != WL_CONNECTED) {
            startAP();
        }
    }

    void loop() {
        if (_apMode) {
            _dnsServer.processNextRequest();
        }

        if (!_apMode && WiFi.status() != WL_CONNECTED) {
            static unsigned long lastReconnect = 0;
            if (millis() - lastReconnect > 30000) {
                lastReconnect = millis();
                LOG_WARN("[WiFi] Connection lost, reconnecting...");
                WiFi.reconnect();
            }
        }

        if (_mdnsPending && WiFi.status() == WL_CONNECTED) {
            static unsigned long lastMdnsAttempt = 0;
            if (millis() - lastMdnsAttempt > 10000) {
                lastMdnsAttempt = millis();
                if (MDNS.begin(_config->wifi.hostname.c_str())) {
                    MDNS.addService("http", "tcp", 80);
                    LOG_INFO("[WiFi] mDNS started (retry): " + _config->wifi.hostname + ".local");
                    _mdnsPending = false;
                }
            }
        }
    }

    bool isConnected() { return WiFi.status() == WL_CONNECTED; }
    bool isAPMode() { return _apMode; }
    String getLocalIP() { return WiFi.localIP().toString(); }

    void startAP() {
        String apName = "Desmonitor-BMS-" + String((uint32_t)ESP.getEfuseMac(), HEX);
        apName = apName.substring(0, 20);

        LOG_INFO("[WiFi] Starting AP: " + apName);

        WiFi.mode(WIFI_AP);
        WiFi.softAP(apName.c_str(), _config->device.apPassword.c_str());
        delay(500);

        _dnsServer.start(53, "*", WiFi.softAPIP());
        _apMode = true;

        LOG_INFO("[WiFi] AP IP: " + WiFi.softAPIP().toString());
    }

    void stopAP() {
        _dnsServer.stop();
        _apMode = false;
    }

    bool tryConnect() {
        if (_config->wifi.ssid.length() == 0) return false;

        LOG_INFO("[WiFi] Connecting to " + _config->wifi.ssid);

        WiFi.mode(WIFI_STA);
        WiFi.setHostname(_config->wifi.hostname.c_str());
        WiFi.begin(_config->wifi.ssid.c_str(), _config->wifi.password.c_str());

        int attempts = 0;
        while (WiFi.status() != WL_CONNECTED && attempts < 40) {
            delay(500);
            yield();
            attempts++;
        }

        if (WiFi.status() == WL_CONNECTED) {
            LOG_INFO("[WiFi] Connected! IP: " + WiFi.localIP().toString());

            if (!MDNS.begin(_config->wifi.hostname.c_str())) {
                LOG_WARN("[WiFi] mDNS begin failed");
            } else {
                MDNS.addService("http", "tcp", 80);
                LOG_INFO("[WiFi] mDNS started: " + _config->wifi.hostname + ".local");
            }

            if (_connectCb) _connectCb(true);
            return true;
        }

        LOG_ERROR("[WiFi] Failed to connect");
        if (_connectCb) _connectCb(false);
        return false;
    }

    String scanNetworks() {
        int n = WiFi.scanComplete();
        if (n == -2) {
            WiFi.scanNetworks(true);
            return "{}";
        }

        JsonDocument doc;
        JsonArray networks = doc.to<JsonArray>();

        for (int i = 0; i < n; i++) {
            JsonObject net = networks.add<JsonObject>();
            net["ssid"] = WiFi.SSID(i);
            net["rssi"] = WiFi.RSSI(i);
            net["encrypted"] = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
        }

        WiFi.scanDelete();
        String result;
        serializeJson(doc, result);
        return result;
    }

private:
    const Config* _config = nullptr;
    ConnectCallback _connectCb;
    DNSServer _dnsServer;
    bool _apMode = false;
    bool _mdnsPending = false;
};