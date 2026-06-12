#pragma once
#include <Arduino.h>
#include <vector>

struct BMSSnapshot {
    float totalVoltage = 0;
    float current = 0;
    float power = 0;
    float soc = 0;
    std::vector<float> cellVoltages;
    float cellMinVoltage = 0;
    float cellMaxVoltage = 0;
    float cellDelta = 0;
    std::vector<float> temperatures;
    bool balancing = false;
    float balancingCurrent = 0;
    uint16_t cycleCount = 0;
    float capacityRemainingAh = 0;
    float capacityFullAh = 0;
    uint8_t cellCount = 0;
    uint8_t tempSensorCount = 0;
    float minCellNumber = 0;
    float maxCellNumber = 0;
    uint32_t timestamp = 0;
};

class BMSInterface {
public:
    virtual ~BMSInterface() = default;

    virtual bool begin() = 0;
    virtual bool connect() = 0;
    virtual bool disconnect() = 0;
    virtual bool isConnected() = 0;
    virtual bool readSnapshot(BMSSnapshot& snapshot) = 0;
    virtual String getStatusString() = 0;
    virtual String getProtocolName() = 0;
    virtual void loop() {}

    virtual bool configure(const String& json) { (void)json; return true; }

    virtual void setTargetAddress(const String& addr) { (void)addr; }
    virtual void setTargetName(const String& name) { (void)name; }
    virtual void setUseBLE(bool use) { (void)use; }
    virtual void setSerialPins(uint8_t rx, uint8_t tx, unsigned long baud = 9600) {
        (void)rx; (void)tx; (void)baud;
    }

    virtual String scanForMatches(int timeoutSeconds) {
        (void)timeoutSeconds;
        return "[]";
    }

    virtual String scanAll(int timeoutSeconds) {
        (void)timeoutSeconds;
        return "[]";
    }
};