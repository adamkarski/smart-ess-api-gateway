#pragma once
#include <Arduino.h>
#include <ArduinoOTA.h>
#include <ConfigManager.h>
#include <Logger.h>

class OTAManager {
public:
    static OTAManager& instance() {
        static OTAManager inst;
        return inst;
    }

    void begin() {
        const auto& cfg = ConfigManager::instance().get();
        if (!cfg.device.enableOTA) {
            LOG_INFO("[OTA] Disabled");
            _enabled = false;
            return;
        }

        ArduinoOTA.setHostname(cfg.wifi.hostname.c_str());
        if (cfg.device.otaPassword.length() > 0) {
            ArduinoOTA.setPassword(cfg.device.otaPassword.c_str());
        }
        // When password is empty, ArduinoOTA accepts uploads without auth

        ArduinoOTA.onStart([]() {
            LOG_INFO("[OTA] Update started");
        });

        ArduinoOTA.onEnd([]() {
            LOG_INFO("[OTA] Update complete");
        });

        ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
            static int lastPct = -1;
            int pct = progress * 100 / total;
            if (pct % 10 == 0 && pct != lastPct) {
                lastPct = pct;
                LOG_INFO("[OTA] Progress: " + String(pct) + "%");
            }
        });

        ArduinoOTA.onError([](ota_error_t error) {
            String err;
            if (error == OTA_AUTH_ERROR) err = "Auth failed";
            else if (error == OTA_BEGIN_ERROR) err = "Begin failed";
            else if (error == OTA_CONNECT_ERROR) err = "Connect failed";
            else if (error == OTA_RECEIVE_ERROR) err = "Receive failed";
            else if (error == OTA_END_ERROR) err = "End failed";
            LOG_ERROR("[OTA] Error: " + err);
        });

        ArduinoOTA.begin();
        _enabled = true;
        LOG_INFO("[OTA] Ready");
    }

    void loop() {
        if (_enabled) {
            ArduinoOTA.handle();
        }
    }

    bool isOTAActive() {
        return _enabled;
    }

private:
    bool _enabled = false;
};
