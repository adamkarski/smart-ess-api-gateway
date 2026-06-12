#pragma once
#include <BMSInterface.h>
#include <CRC16.h>
#include <Logger.h>
#include <NimBLEDevice.h>
#include <functional>

#include <array>

class JKBMS : public BMSInterface {
public:
    JKBMS();
    ~JKBMS();

    bool begin() override;
    bool connect() override;
    bool disconnect() override;
    bool isConnected() override;
    bool readSnapshot(BMSSnapshot& snapshot) override;
    String getStatusString() override;
    String getProtocolName() override;
    bool configure(const String& json) override;

    void setBleDeviceName(const String& name) { _bleName = name; }
    void setBleAddress(const String& addr) { _bleAddress = addr; }
    void setUseBLE(bool use) override { _useBLE = use; }
    void setSerialPins(uint8_t rx, uint8_t tx, unsigned long baud = 9600) override {
        _uartRx = rx; _uartTx = tx; _uartBaud = baud;
    }
    void setTargetName(const String& name) override { _bleName = name; }
    void setTargetAddress(const String& addr) override { _bleAddress = addr; }

    void loop() override;

    String scanForMatches(int timeoutSeconds) override;
    String scanAll(int timeoutSeconds) override;

    void setOnDataCallback(std::function<void(const BMSSnapshot&)> cb) {
        _dataCallback = cb;
    }

private:
    bool _useBLE = true;
    String _bleName = "JK-BMS";
    String _bleAddress = "";
    bool _bleInitialized = false;
    bool _bleConnected = false;
    NimBLEClient* _bleClient = nullptr;
    NimBLERemoteCharacteristic* _writeChar = nullptr;
    NimBLERemoteCharacteristic* _notifyChar = nullptr;
    String _lastStatus;

    static const size_t NOTIFY_BUF_SIZE = 512;
    uint8_t _notifyBuf[NOTIFY_BUF_SIZE];
    size_t _notifyLen = 0;
    volatile bool _notifyReady = false;
    void resetNotifyBuffer() { _notifyLen = 0; _notifyReady = false; }
    void handleNotification(NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t len, bool isNotify);

    std::vector<uint8_t> _frameBuffer;
    static const uint16_t MIN_RESPONSE_SIZE = 300;
    static const uint16_t MAX_RESPONSE_SIZE = 400;

    bool initBLE();
    bool connectBLE();
    bool readBLE(uint8_t* response, size_t& respLen, unsigned long timeout = 5000);

    uint8_t _uartRx = 16;
    uint8_t _uartTx = 17;
    unsigned long _uartBaud = 115200;
    bool _serialConfigured = false;
    HardwareSerial* _serial = nullptr;
    bool connectSerial();
    bool readSerial(uint8_t* response, size_t& respLen, unsigned long timeout = 2000);

    bool sendCommand(uint8_t cmd, uint8_t* response, size_t& respLen);
    bool parseResponse(const uint8_t* data, size_t len, BMSSnapshot& snapshot);
    bool decodeJK02CellInfo(const uint8_t* data, size_t len, BMSSnapshot& snapshot);
    std::array<uint8_t, 20> buildFrame(uint8_t commandType, uint32_t value = 0, uint8_t length = 0);

    static const uint8_t COMMAND_CELL_INFO = 0x96;
    static const uint8_t COMMAND_DEVICE_INFO = 0x97;
    static const uint8_t COMMAND_SETTINGS = 0x95;

    static const uint16_t JK_BMS_SERVICE_UUID = 0xFFE0;
    static const uint16_t JK_BMS_CHARACTERISTIC_UUID = 0xFFE1;

    enum ProtocolVersion {
        PROTOCOL_JK02_24S,
        PROTOCOL_JK02_32S,
    };
    ProtocolVersion _protocolVersion = PROTOCOL_JK02_24S;

    uint16_t _maxCells = 32;
    uint16_t _maxTemps = 8;

    std::function<void(const BMSSnapshot&)> _dataCallback;

    unsigned long _lastConnectAttempt = 0;
    static const unsigned long RECONNECT_INTERVAL = 30000;

    static uint8_t crc8(const uint8_t* data, uint16_t len);
    static uint16_t get16le(const uint8_t* data, size_t i);
    static uint32_t get32le(const uint8_t* data, size_t i);
};
