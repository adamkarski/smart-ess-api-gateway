#include <JKBMS.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include "esp_coexist.h"

JKBMS::JKBMS() {}

JKBMS::~JKBMS() {
    disconnect();
}

uint8_t JKBMS::crc8(const uint8_t* data, uint16_t len) {
    uint8_t crc = 0;
    for (uint16_t i = 0; i < len; i++) {
        crc = crc + data[i];
    }
    return crc;
}

uint16_t JKBMS::get16le(const uint8_t* data, size_t i) {
    return (uint16_t)data[i] | ((uint16_t)data[i + 1] << 8);
}

uint32_t JKBMS::get32le(const uint8_t* data, size_t i) {
    return (uint32_t)get16le(data, i) | ((uint32_t)get16le(data, i + 2) << 16);
}

void JKBMS::handleNotification(NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t len, bool isNotify) {
    (void)pChar; (void)isNotify;
    if (!data || len == 0) return;

    if (_frameBuffer.size() > MAX_RESPONSE_SIZE) {
        LOG_WARN("[JKBMS] Frame buffer overflow, clearing");
        _frameBuffer.clear();
    }

    if (len >= 4 && data[0] == 0x55 && data[1] == 0xAA && data[2] == 0xEB && data[3] == 0x90) {
        _frameBuffer.clear();
    }

    _frameBuffer.insert(_frameBuffer.end(), data, data + len);

    if (_frameBuffer.size() >= MIN_RESPONSE_SIZE) {
        uint8_t computedCrc = crc8(_frameBuffer.data(), MIN_RESPONSE_SIZE - 1);
        uint8_t remoteCrc = _frameBuffer[MIN_RESPONSE_SIZE - 1];

        if (computedCrc != remoteCrc) {
            LOG_WARN("[JKBMS] CRC mismatch: calc=0x" + String(computedCrc, HEX) + " got=0x" + String(remoteCrc, HEX));
            _frameBuffer.clear();
            return;
        }

        size_t copyLen = _frameBuffer.size();
        if (copyLen > NOTIFY_BUF_SIZE) copyLen = NOTIFY_BUF_SIZE;
        memcpy(_notifyBuf, _frameBuffer.data(), copyLen);
        _notifyLen = copyLen;
        _notifyReady = true;
        _frameBuffer.clear();
    }
}

bool JKBMS::initBLE() {
    if (_bleInitialized) return true;
    LOG_INFO("[JKBMS] Initializing NimBLE...");

    NimBLEDevice::init("DesmonitorBMS");
    NimBLEDevice::setPower(ESP_PWR_LVL_P18);
    NimBLEDevice::setSecurityAuth(false, false, false);

    delay(500);

    _bleInitialized = true;
    LOG_INFO("[JKBMS] NimBLE initialized OK, power=18dBm");
    return true;
}

bool JKBMS::begin() {
    LOG_INFO("[JKBMS] begin()");
    if (_useBLE) {
        initBLE();
    }
    return true;
}

bool JKBMS::connect() {
    if (_useBLE) {
        return connectBLE();
    } else {
        return connectSerial();
    }
}

bool JKBMS::disconnect() {
    if (_bleConnected) {
        if (_bleClient) {
            _bleClient->disconnect();
        }
        _bleConnected = false;
        _writeChar = nullptr;
        _notifyChar = nullptr;
        _frameBuffer.clear();
        LOG_INFO("[JKBMS] BLE disconnected");
#if CONFIG_SW_COEXIST_ENABLE
        esp_coex_preference_set((esp_coex_prefer_t)2);
#endif
    }
    return true;
}

bool JKBMS::isConnected() {
    if (_useBLE) {
        return _bleConnected && _bleClient && _bleClient->isConnected();
    }
    return _serialConfigured && _serial != nullptr;
}

String JKBMS::getStatusString() {
    return _lastStatus;
}

String JKBMS::getProtocolName() {
    if (_useBLE) {
        return _protocolVersion == PROTOCOL_JK02_32S ? "JK02_32S_BLE" : "JK02_24S_BLE";
    }
    return "JK_UART";
}

bool JKBMS::configure(const String& json) {
    return true;
}

bool JKBMS::connectBLE() {
    if (_bleConnected && _bleClient && _bleClient->isConnected()) return true;

    initBLE();

#if CONFIG_SW_COEXIST_ENABLE
    esp_coex_preference_set((esp_coex_prefer_t)1);
    LOG_INFO("[JKBMS] Coex: prefer BT");
#endif

    LOG_INFO("[JKBMS] Scanning for '" + _bleName + "' (8s)...");

    NimBLEScan* scanner = NimBLEDevice::getScan();
    scanner->stop();
    scanner->clearResults();
    scanner->setActiveScan(true);
    scanner->setInterval(48);
    scanner->setWindow(36);

    NimBLEScanResults results = scanner->getResults(8);
    scanner->stop();

    int totalDevices = results.getCount();
    LOG_INFO("[JKBMS] Connect scan: " + String(totalDevices) + " devices found");

    String foundAddr;
    String foundName;
    int foundRssi = -999;
    bool found = false;

    for (int i = 0; i < totalDevices; i++) {
        const NimBLEAdvertisedDevice* dev = results.getDevice(i);
        if (!dev) continue;

        String name = String(dev->getName().c_str());
        String addr = String(dev->getAddress().toString().c_str());
        int rssi = dev->getRSSI();

        LOG_INFO("[JKBMS]   device: name='" + name + "' addr=" + addr + " rssi=" + String(rssi));

        bool nameMatch = name.length() > 0 && (name.indexOf("JK") >= 0 || name.indexOf("jk") >= 0);
        bool addrMatch = _bleAddress.length() > 0 && addr.equalsIgnoreCase(_bleAddress);

        if ((nameMatch || addrMatch) && rssi > foundRssi) {
            foundAddr = addr;
            foundName = name;
            foundRssi = rssi;
            found = true;
        }
    }

    scanner->clearResults();

    if (!found) {
        _lastStatus = "BLE_SCAN_FAIL";
        LOG_WARN("[JKBMS] No JK-BMS device found");
#if CONFIG_SW_COEXIST_ENABLE
        esp_coex_preference_set((esp_coex_prefer_t)2);
#endif
        return false;
    }

    LOG_INFO("[JKBMS] Found: " + foundName + " [" + foundAddr + "] RSSI=" + String(foundRssi));

    if (_bleClient) {
        if (_bleClient->isConnected()) _bleClient->disconnect();
        NimBLEDevice::deleteClient(_bleClient);
        _bleClient = nullptr;
    }

    _bleClient = NimBLEDevice::createClient();
    _bleClient->setConnectTimeout(5);

    NimBLEAddress addr(foundAddr.c_str(), BLE_ADDR_PUBLIC);
    if (!_bleClient->connect(addr)) {
        NimBLEAddress addrRandom(foundAddr.c_str(), BLE_ADDR_RANDOM);
        if (!_bleClient->connect(addrRandom)) {
            _lastStatus = "BLE_CONNECT_FAIL";
            LOG_WARN("[JKBMS] Connect failed to " + foundAddr);
#if CONFIG_SW_COEXIST_ENABLE
            esp_coex_preference_set((esp_coex_prefer_t)2);
#endif
            return false;
        }
    }

    LOG_INFO("[JKBMS] Connected to " + foundAddr);

    NimBLERemoteService* pSvc = _bleClient->getService(JK_BMS_SERVICE_UUID);
    if (!pSvc) {
        LOG_WARN("[JKBMS] Service 0xFFE0 not found");
        _bleClient->disconnect();
        _lastStatus = "BLE_NO_SERVICE";
#if CONFIG_SW_COEXIST_ENABLE
        esp_coex_preference_set((esp_coex_prefer_t)2);
#endif
        return false;
    }

    const auto& chars = pSvc->getCharacteristics(false);
    LOG_INFO("[JKBMS] Found " + String(chars.size()) + " characteristics in 0xFFE0");

    _writeChar = nullptr;
    _notifyChar = nullptr;

    NimBLEUUID targetUUID(JK_BMS_CHARACTERISTIC_UUID);

    for (auto* chr : chars) {
        if (chr->getUUID() != targetUUID) continue;

        uint16_t handle = chr->getHandle();
        LOG_INFO("[JKBMS]   0xFFE1 handle=0x" + String(handle, HEX) +
                 " canWrite=" + String(chr->canWrite()) +
                 " canWriteNoResponse=" + String(chr->canWriteNoResponse()) +
                 " canNotify=" + String(chr->canNotify()));

        if (chr->canWrite() || chr->canWriteNoResponse()) {
            _writeChar = chr;
        }
        if (chr->canNotify()) {
            _notifyChar = chr;
        }
    }

    if (!_writeChar && !_notifyChar) {
        for (auto* chr : chars) {
            if (chr->getUUID() == targetUUID) {
                _writeChar = chr;
                _notifyChar = chr;
                LOG_INFO("[JKBMS] Using single 0xFFE1 char for both write and notify");
                break;
            }
        }
    }

    if (!_writeChar) {
        LOG_WARN("[JKBMS] No writable characteristic found");
        _bleClient->disconnect();
        _lastStatus = "BLE_NO_WRITE_CHAR";
#if CONFIG_SW_COEXIST_ENABLE
        esp_coex_preference_set((esp_coex_prefer_t)2);
#endif
        return false;
    }

    if (!_notifyChar) {
        _notifyChar = _writeChar;
        LOG_INFO("[JKBMS] No separate notify char, using write char");
    }

    resetNotifyBuffer();
    _frameBuffer.clear();

    if (_notifyChar->canNotify()) {
        if (!_notifyChar->subscribe(true, [this](NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t len, bool isNotify) {
            this->handleNotification(pChar, data, len, isNotify);
        })) {
            LOG_WARN("[JKBMS] Failed to subscribe to notifications");
        } else {
            LOG_INFO("[JKBMS] Subscribed to notifications");
        }
    } else if (_notifyChar->canIndicate()) {
        if (!_notifyChar->subscribe(false, [this](NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t len, bool isNotify) {
            this->handleNotification(pChar, data, len, isNotify);
        })) {
            LOG_WARN("[JKBMS] Failed to subscribe to indications");
        }
    }

    _bleConnected = true;
    _lastStatus = "BLE_CONNECTED";
    _bleAddress = foundAddr;
    if (foundName.length() > 0) _bleName = foundName;

    if (foundName.indexOf("PB") >= 0 || foundName.indexOf("32S") >= 0) {
        _protocolVersion = PROTOCOL_JK02_32S;
        LOG_INFO("[JKBMS] Detected JK02_32S protocol");
    } else {
        _protocolVersion = PROTOCOL_JK02_24S;
        LOG_INFO("[JKBMS] Using JK02_24S protocol");
    }

    LOG_INFO("[JKBMS] BLE ready");
    return true;
}

bool JKBMS::readBLE(uint8_t* response, size_t& respLen, unsigned long timeout) {
    if (!_bleConnected) return false;

    _frameBuffer.clear();
    resetNotifyBuffer();
    unsigned long start = millis();
    while (millis() - start < timeout) {
        if (_notifyReady && _notifyLen > 0) {
            respLen = _notifyLen;
            memcpy(response, _notifyBuf, _notifyLen);
            resetNotifyBuffer();
            return true;
        }
        delay(5);
        yield();
    }
    return false;
}

bool JKBMS::connectSerial() {
    LOG_INFO("[JKBMS] Connecting via UART...");
    if (!_serial) {
        _serial = new HardwareSerial(1);
    }
    _serial->begin(_uartBaud, SERIAL_8N1, _uartRx, _uartTx);
    delay(100);

    uint8_t response[512];
    size_t respLen = 0;
    if (sendCommand(COMMAND_CELL_INFO, response, respLen)) {
        _serialConfigured = true;
        _lastStatus = "UART_CONNECTED";
        LOG_INFO("[JKBMS] UART connected successfully");
        return true;
    }

    _lastStatus = "UART_CONNECT_FAIL";
    LOG_WARN("[JKBMS] UART test failed");
    return false;
}

bool JKBMS::readSerial(uint8_t* response, size_t& respLen, unsigned long timeout) {
    if (!_serialConfigured || !_serial) return false;

    _frameBuffer.clear();
    unsigned long start = millis();
    while (millis() - start < timeout) {
        while (_serial->available()) {
            uint8_t b = _serial->read();
            _frameBuffer.push_back(b);

            if (_frameBuffer.size() >= 4 &&
                _frameBuffer[0] == 0x55 && _frameBuffer[1] == 0xAA &&
                _frameBuffer[2] == 0xEB && _frameBuffer[3] == 0x90) {
            }

            if (_frameBuffer.size() > MAX_RESPONSE_SIZE) {
                _frameBuffer.clear();
            }
        }

        if (_frameBuffer.size() >= MIN_RESPONSE_SIZE) {
            uint8_t computedCrc = crc8(_frameBuffer.data(), MIN_RESPONSE_SIZE - 1);
            uint8_t remoteCrc = _frameBuffer[MIN_RESPONSE_SIZE - 1];

            if (computedCrc == remoteCrc) {
                respLen = _frameBuffer.size();
                if (respLen > 512) respLen = 512;
                memcpy(response, _frameBuffer.data(), respLen);
                _frameBuffer.clear();
                return true;
            } else if (_frameBuffer.size() >= MAX_RESPONSE_SIZE) {
                _frameBuffer.clear();
            }
        }
        delay(5);
    }
    respLen = 0;
    return false;
}

std::array<uint8_t, 20> JKBMS::buildFrame(uint8_t commandType, uint32_t value, uint8_t length) {
    std::array<uint8_t, 20> frame{};
    frame[0] = 0xAA;
    frame[1] = 0x55;
    frame[2] = 0x90;
    frame[3] = 0xEB;
    frame[4] = commandType;
    frame[5] = length;
    frame[6] = value & 0xFF;
    frame[7] = (value >> 8) & 0xFF;
    frame[8] = (value >> 16) & 0xFF;
    frame[9] = (value >> 24) & 0xFF;
    frame[19] = crc8(frame.data(), 19);
    return frame;
}

bool JKBMS::sendCommand(uint8_t cmd, uint8_t* response, size_t& respLen) {
    LOG_DEBUG("[JKBMS] Sending cmd 0x" + String(cmd, HEX));

    auto frame = buildFrame(cmd, 0, 0);

    if (_useBLE && _bleConnected && _writeChar) {
        bool success = false;
        if (_writeChar->canWriteNoResponse()) {
            success = _writeChar->writeValue(frame.data(), 20, false);
        } else {
            success = _writeChar->writeValue(frame.data(), 20, true);
        }
        if (!success) {
            LOG_WARN("[JKBMS] BLE write failed");
            return false;
        }
        delay(100);
        return readBLE(response, respLen, 5000);
    } else if (!_useBLE && _serialConfigured && _serial) {
        _serial->write(frame.data(), 20);
        _serial->flush();
        return readSerial(response, respLen, 5000);
    }

    return false;
}

bool JKBMS::decodeJK02CellInfo(const uint8_t* data, size_t len, BMSSnapshot& snapshot) {
    if (len < MIN_RESPONSE_SIZE) {
        LOG_WARN("[JKBMS] Frame too short: " + String(len));
        return false;
    }

    uint8_t frameType = data[4];
    if (frameType != 0x02) {
        LOG_WARN("[JKBMS] Not cell info frame (type=0x" + String(frameType, HEX) + ")");
        return false;
    }

    uint8_t offset = 0;
    if (_protocolVersion == PROTOCOL_JK02_32S) {
        offset = 16;
    }

    uint8_t maxCells = 24 + (offset / 2);
    if (maxCells > _maxCells) maxCells = _maxCells;

    snapshot.timestamp = millis();
    snapshot.cellVoltages.clear();
    snapshot.cellMinVoltage = 100.0f;
    snapshot.cellMaxVoltage = 0;
    snapshot.cellCount = 0;

    for (uint8_t i = 0; i < maxCells; i++) {
        float cellVoltage = (float)get16le(data, i * 2 + 6) * 0.001f;
        if (cellVoltage > 0) {
            snapshot.cellVoltages.push_back(cellVoltage);
            snapshot.cellCount++;
            if (cellVoltage < snapshot.cellMinVoltage) snapshot.cellMinVoltage = cellVoltage;
            if (cellVoltage > snapshot.cellMaxVoltage) snapshot.cellMaxVoltage = cellVoltage;
        }
    }

    if (snapshot.cellCount == 0) {
        snapshot.cellMinVoltage = 0;
    }
    snapshot.cellDelta = snapshot.cellMaxVoltage - snapshot.cellMinVoltage;

    uint8_t doubledOffset = offset * 2;

    float totalVoltage = (float)get32le(data, 118 + doubledOffset) * 0.001f;
    snapshot.totalVoltage = totalVoltage;

    int32_t currentRaw = (int32_t)get32le(data, 126 + doubledOffset);
    float current = (float)currentRaw * 0.001f;
    snapshot.current = current;

    snapshot.power = totalVoltage * current;

    snapshot.temperatures.clear();
    float temp1 = (float)((int16_t)get16le(data, 130 + doubledOffset)) * 0.1f;
    float temp2 = (float)((int16_t)get16le(data, 132 + doubledOffset)) * 0.1f;
    snapshot.temperatures.push_back(temp1);
    snapshot.temperatures.push_back(temp2);

    float mosfetTemp = 0;
    if (_protocolVersion == PROTOCOL_JK02_32S) {
        mosfetTemp = (float)((int16_t)get16le(data, 112 + offset)) * 0.1f;
    } else {
        mosfetTemp = (float)((int16_t)get16le(data, 134 + doubledOffset)) * 0.1f;
    }
    snapshot.temperatures.push_back(mosfetTemp);
    snapshot.tempSensorCount = 3;

    int16_t balanceCurrentRaw = (int16_t)get16le(data, 138 + doubledOffset);
    snapshot.balancingCurrent = (float)balanceCurrentRaw * 0.001f;

    uint8_t balancingAction = data[140 + doubledOffset];
    snapshot.balancing = (balancingAction != 0);

    snapshot.soc = (float)data[141 + doubledOffset];

    uint32_t capacityRemainingRaw = get32le(data, 142 + doubledOffset);
    snapshot.capacityRemainingAh = (float)capacityRemainingRaw * 0.001f;

    uint32_t fullChargeCapacityRaw = get32le(data, 146 + doubledOffset);
    snapshot.capacityFullAh = (float)fullChargeCapacityRaw * 0.001f;

    uint32_t cycleCountRaw = get32le(data, 150 + doubledOffset);
    snapshot.cycleCount = (uint16_t)cycleCountRaw;

    _lastStatus = "OK V=" + String(snapshot.totalVoltage, 2) + "V SoC=" + String(snapshot.soc, 1) +
                  "% I=" + String(snapshot.current, 2) + "A Cells=" + String(snapshot.cellCount);
    return true;
}

bool JKBMS::parseResponse(const uint8_t* data, size_t len, BMSSnapshot& snapshot) {
    if (len < MIN_RESPONSE_SIZE) {
        LOG_WARN("[JKBMS] Response too short: " + String(len) + " bytes");
        return false;
    }

    if (data[0] != 0x55 || data[1] != 0xAA || data[2] != 0xEB || data[3] != 0x90) {
        LOG_WARN("[JKBMS] Invalid frame header");
        return false;
    }

    uint8_t frameType = data[4];
    if (frameType == 0x02) {
        return decodeJK02CellInfo(data, len, snapshot);
    }

    LOG_WARN("[JKBMS] Unexpected frame type: 0x" + String(frameType, HEX));
    return false;
}

bool JKBMS::readSnapshot(BMSSnapshot& snapshot) {
    if (!isConnected()) return false;

    uint8_t response[512];
    size_t respLen = 0;

    if (!sendCommand(COMMAND_CELL_INFO, response, respLen)) {
        LOG_WARN("[JKBMS] Read command failed");
        disconnect();
        return false;
    }

    if (!parseResponse(response, respLen, snapshot)) {
        LOG_WARN("[JKBMS] Response parsing failed (" + String(respLen) + " bytes)");
        return false;
    }

    if (_dataCallback) {
        _dataCallback(snapshot);
    }

    return true;
}

void JKBMS::loop() {
}

String JKBMS::scanForMatches(int timeoutSeconds) {
    if (!initBLE()) {
        LOG_WARN("[JKBMS] scanForMatches: BLE init failed");
        return "[]";
    }

    int t = timeoutSeconds;
    if (t < 1) t = 1;
    if (t > 10) t = 10;
    LOG_INFO("[JKBMS] scanForMatches(" + String(t) + "s) starting...");

#if CONFIG_SW_COEXIST_ENABLE
    esp_coex_preference_set((esp_coex_prefer_t)1);
    LOG_DEBUG("[JKBMS] Coex: prefer BT for scan");
#endif

    NimBLEScan* scanner = NimBLEDevice::getScan();
    if (!scanner) {
        LOG_WARN("[JKBMS] scanForMatches: getScan() returned null!");
        return "[]";
    }

    scanner->stop();
    scanner->clearResults();
    scanner->setActiveScan(true);
    scanner->setInterval(48);
    scanner->setWindow(36);

    LOG_INFO("[JKBMS] Starting scan for " + String(t) + "s...");
    NimBLEScanResults results = scanner->getResults(t);
    LOG_INFO("[JKBMS] Scan completed");

    scanner->stop();

#if CONFIG_SW_COEXIST_ENABLE
    esp_coex_preference_set((esp_coex_prefer_t)2);
    LOG_DEBUG("[JKBMS] Coex: prefer balance");
#endif

    int totalDevices = results.getCount();
    LOG_INFO("[JKBMS] scanForMatches: " + String(totalDevices) + " devices found");

    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();

    for (int i = 0; i < totalDevices; i++) {
        const NimBLEAdvertisedDevice* dev = results.getDevice(i);
        if (!dev) continue;

        String name = String(dev->getName().c_str());
        String addr = String(dev->getAddress().toString().c_str());
        int rssi = dev->getRSSI();

        bool match = name.length() > 0 && (name.indexOf("JK") >= 0 || name.indexOf("jk") >= 0);
        bool addrKnown = _bleAddress.length() > 0 && addr.equalsIgnoreCase(_bleAddress);

        LOG_DEBUG("[JKBMS]   '" + name + "' " + addr + " RSSI=" + String(rssi) + (match ? " [MATCH]" : ""));

        if (match || addrKnown) {
            JsonObject o = arr.add<JsonObject>();
            o["name"] = name;
            o["address"] = addr;
            o["rssi"] = rssi;
        }
    }

    scanner->clearResults();
    String result;
    serializeJson(doc, result);
    LOG_INFO("[JKBMS] scanForMatches: " + String(arr.size()) + " matches");
    return result;
}

String JKBMS::scanAll(int timeoutSeconds) {
    if (!initBLE()) {
        LOG_WARN("[JKBMS] scanAll: BLE init failed");
        return "[]";
    }

    int t = timeoutSeconds;
    if (t < 1) t = 1;
    if (t > 10) t = 10;
    LOG_INFO("[JKBMS] scanAll(" + String(t) + "s) starting...");

#if CONFIG_SW_COEXIST_ENABLE
    esp_coex_preference_set((esp_coex_prefer_t)1);
    LOG_DEBUG("[JKBMS] Coex: prefer BT for scan");
#endif

    NimBLEScan* scanner = NimBLEDevice::getScan();
    if (!scanner) {
        LOG_WARN("[JKBMS] scanAll: getScan() returned null!");
        return "[]";
    }

    scanner->stop();
    scanner->clearResults();
    scanner->setActiveScan(true);
    scanner->setInterval(48);
    scanner->setWindow(36);

    LOG_INFO("[JKBMS] Starting scan for " + String(t) + "s...");
    NimBLEScanResults results = scanner->getResults(t);
    LOG_INFO("[JKBMS] Scan completed");

    scanner->stop();

#if CONFIG_SW_COEXIST_ENABLE
    esp_coex_preference_set((esp_coex_prefer_t)2);
    LOG_DEBUG("[JKBMS] Coex: prefer balance");
#endif

    int totalDevices = results.getCount();
    LOG_INFO("[JKBMS] scanAll: " + String(totalDevices) + " devices found");

    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();

    for (int i = 0; i < totalDevices; i++) {
        const NimBLEAdvertisedDevice* dev = results.getDevice(i);
        if (!dev) continue;

        String name = String(dev->getName().c_str());
        String addr = String(dev->getAddress().toString().c_str());
        int rssi = dev->getRSSI();

        JsonObject o = arr.add<JsonObject>();
        o["name"] = name;
        o["address"] = addr;
        o["rssi"] = rssi;
        o["serviceCount"] = (int)dev->getServiceDataCount();
        o["hasManufacturerData"] = dev->haveManufacturerData();

        LOG_DEBUG("[JKBMS]   Device: '" + name + "' " + addr + " RSSI=" + String(rssi));
    }

    scanner->clearResults();
    String result;
    serializeJson(doc, result);
    LOG_INFO("[JKBMS] scanAll: " + String(arr.size()) + " devices returned");
    return result;
}
