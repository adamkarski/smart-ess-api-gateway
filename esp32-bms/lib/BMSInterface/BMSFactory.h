#pragma once
#include <BMSInterface.h>
#include <JKBMS.h>
#include <Logger.h>

// Factory: create the right BMS implementation based on config.
// To add a new BMS type:
//   1. Add a new branch below
//   2. Implement your class in lib/<Name>/ as a BMSInterface
//   3. Update BMSConfig::type doc comment
//   4. The rest (UI, push, persistence) is type-agnostic
class BMSFactory {
public:
    static BMSInterface* create(const String& type) {
        if (type == "jk_bms" || type.length() == 0) {
            LOG_INFO("[BMSFactory] Creating JKBMS");
            return new JKBMS();
        }
        // Future:
        // if (type == "daly")   return new DalyBMS();
        // if (type == "ant")    return new AntBMS();
        // if (type == "seplos") return new SeplosBMS();
        LOG_WARN("[BMSFactory] Unknown type '" + type + "', falling back to JKBMS");
        return new JKBMS();
    }
};
