#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <BMSInterface.h>
#include <ConfigManager.h>
#include <Logger.h>

class DesmonitorClient {
public:
    static DesmonitorClient& instance() {
        static DesmonitorClient inst;
        return inst;
    }

    void begin() {}

    bool pushSnapshot(const BMSSnapshot& snap) {
        const auto& cfg = ConfigManager::instance().get();
        if (!cfg.server.pushEnabled) return false;
        if (WiFi.status() != WL_CONNECTED) {
            LOG_DEBUG("[Desmonitor] Skip push — WiFi not connected");
            return false;
        }

        HTTPClient http;
        http.setTimeout(10000);
        http.setConnectTimeout(5000);

        String url = resolveUrl(cfg.server.url);
        if (url.length() == 0) return false;
        if (url.endsWith("/")) url.remove(url.length() - 1);
        url += "/api/bms/data";

        http.begin(url);
        http.addHeader("Content-Type", "application/json");

        if (cfg.server.apiKey.length() > 0) {
            http.addHeader("X-API-Key", cfg.server.apiKey);
        }

        JsonDocument doc;

        doc["deviceId"] = cfg.deviceId;
        doc["brand"] = "JK";
        doc["model"] = "B2A16S";
        doc["timestamp"] = snap.timestamp;

        doc["totalVoltage"] = snap.totalVoltage;
        doc["current"] = snap.current;
        doc["power"] = snap.power;
        doc["soc"] = snap.soc;
        doc["capacityRemainingAh"] = snap.capacityRemainingAh;
        doc["capacityFullAh"] = snap.capacityFullAh;
        doc["cycleCount"] = snap.cycleCount;
        doc["balancing"] = snap.balancing;
        doc["balancingCurrent"] = snap.balancingCurrent;
        doc["cellCount"] = snap.cellCount;
        doc["cellMinVoltage"] = snap.cellMinVoltage;
        doc["cellMaxVoltage"] = snap.cellMaxVoltage;
        doc["cellDelta"] = snap.cellDelta;

        JsonArray cells = doc["cellVoltages"].to<JsonArray>();
        for (float v : snap.cellVoltages) {
            cells.add(v);
        }

        JsonArray temps = doc["temperatures"].to<JsonArray>();
        for (float t : snap.temperatures) {
            temps.add(t);
        }

        String payload;
        serializeJson(doc, payload);

        LOG_DEBUG("[Desmonitor] POST " + url + " (" + String(payload.length()) + " bytes)");

        int httpCode = http.POST(payload);
        bool success = (httpCode >= 200 && httpCode < 300);

        if (success) {
            LOG_DEBUG("[Desmonitor] Data pushed successfully (" + String(httpCode) + ")");
        } else {
            LOG_WARN("[Desmonitor] Push failed: HTTP " + String(httpCode) + " - " + http.getString());
        }

        http.end();
        return success;
    }

    bool pushLogs(const String& logs) {
        const auto& cfg = ConfigManager::instance().get();
        if (WiFi.status() != WL_CONNECTED) return false;

        HTTPClient http;
        http.setTimeout(10000);

        String url = resolveUrl(cfg.server.url);
        if (url.length() == 0) return false;
        if (url.endsWith("/")) url.remove(url.length() - 1);
        url += "/api/bms/logs";

        http.begin(url);
        http.addHeader("Content-Type", "text/plain");

        if (cfg.server.apiKey.length() > 0) {
            http.addHeader("X-API-Key", cfg.server.apiKey);
        }

        JsonDocument doc;
        doc["deviceId"] = cfg.deviceId;
        doc["logs"] = logs;

        String payload;
        serializeJson(doc, payload);

        int httpCode = http.POST(payload);
        http.end();

        return (httpCode >= 200 && httpCode < 300);
    }

    bool fetchConfig() {
        const auto& cfg = ConfigManager::instance().get();
        if (WiFi.status() != WL_CONNECTED) return false;

        HTTPClient http;
        http.setTimeout(10000);

        String url = resolveUrl(cfg.server.url);
        if (url.length() == 0) return false;
        if (url.endsWith("/")) url.remove(url.length() - 1);
        url += "/api/bms/config";

        http.begin(url);

        if (cfg.server.apiKey.length() > 0) {
            http.addHeader("X-API-Key", cfg.server.apiKey);
        }

        int httpCode = http.GET();
        if (httpCode == 200) {
            String response = http.getString();
            JsonDocument doc;
            DeserializationError err = deserializeJson(doc, response);
            if (!err && doc.is<JsonObject>()) {
                ConfigManager::instance().update(doc);
                http.end();
                LOG_INFO("[Desmonitor] Config fetched from server");
                return true;
            }
        } else {
            LOG_WARN("[Desmonitor] Config fetch failed: HTTP " + String(httpCode));
        }

        http.end();
        return false;
    }

private:
    String _resolvedHost;
    unsigned long _resolvedAt = 0;
    static const unsigned long RESOLVE_INTERVAL = 300000;

    String resolveUrl(const String& url) {
        if (url.length() == 0) return url;

        int protoEnd = url.indexOf("://");
        if (protoEnd < 0) return url;
        String proto = url.substring(0, protoEnd);
        String rest = url.substring(protoEnd + 3);

        int slashPos = rest.indexOf('/');
        int colonPos = rest.indexOf(':');
        String host;
        String portAndPath;

        if (colonPos >= 0 && (slashPos < 0 || colonPos < slashPos)) {
            host = rest.substring(0, colonPos);
            portAndPath = rest.substring(colonPos);
        } else if (slashPos >= 0) {
            host = rest.substring(0, slashPos);
            portAndPath = rest.substring(slashPos);
        } else {
            host = rest;
            portAndPath = "";
        }

        if (host.endsWith(".local")) {
            String resolvedIp = resolveMDNS(host);
            if (resolvedIp.length() > 0) {
                return proto + "://" + resolvedIp + portAndPath;
            }
            LOG_WARN("[Desmonitor] mDNS resolve failed for " + host);
            return "";
        }

        return url;
    }

    String resolveMDNS(const String& hostname) {
        unsigned long now = millis();
        if (_resolvedHost.length() > 0 && now - _resolvedAt < RESOLVE_INTERVAL) {
            return _resolvedHost;
        }

        String bare = hostname;
        if (bare.endsWith(".local")) {
            bare.remove(bare.length() - 6);
        }

        LOG_DEBUG("[Desmonitor] Resolving mDNS: " + hostname);
        IPAddress ip = MDNS.queryHost(bare);
        if (ip != INADDR_NONE && ip != IPAddress(0, 0, 0, 0)) {
            _resolvedHost = ip.toString();
            _resolvedAt = now;
            LOG_INFO("[Desmonitor] mDNS " + hostname + " -> " + _resolvedHost);
            return _resolvedHost;
        }

        LOG_WARN("[Desmonitor] mDNS query failed for " + hostname);
        return _resolvedHost.length() > 0 ? _resolvedHost : "";
    }
};

static DesmonitorClient& desmonitor = DesmonitorClient::instance();