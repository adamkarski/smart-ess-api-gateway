#pragma once
#include <Arduino.h>
#include <vector>
#include <functional>

class Logger {
public:
    enum Level { DEBUG, INFO, WARN, ERROR };

    static Logger& instance() {
        static Logger inst;
        return inst;
    }

    void begin(size_t maxEntries = 200) {
        _maxEntries = maxEntries;
        _entries.reserve(_maxEntries);
    }

    void log(Level level, const String& message) {
        if (level < _minLevel) return;
        unsigned long now = millis();
        String entry = "[" + String(now / 1000) + "s] ";
        switch (level) {
            case DEBUG: entry += "DEBUG"; break;
            case INFO:  entry += "INFO"; break;
            case WARN:  entry += "WARN"; break;
            case ERROR: entry += "ERROR"; break;
        }
        entry += " " + message;

        _entries.push_back({now, entry});
        if (_entries.size() > _maxEntries) {
            _entries.erase(_entries.begin());
        }

        // Also print to serial
        Serial.println(entry);
    }

    void debug(const String& msg) { log(DEBUG, msg); }
    void info(const String& msg) { log(INFO, msg); }
    void warn(const String& msg) { log(WARN, msg); }
    void error(const String& msg) { log(ERROR, msg); }

    String getTail(size_t count = 50) const {
        String result;
        size_t start = _entries.size() > count ? _entries.size() - count : 0;
        for (size_t i = start; i < _entries.size(); i++) {
            result += _entries[i].text + "\n";
        }
        return result;
    }

    String getAll() const {
        String result;
        for (const auto& e : _entries) {
            result += e.text + "\n";
        }
        return result;
    }

    void setMinLevel(Level level) { _minLevel = level; }
    size_t count() const { return _entries.size(); }
    void clear() { _entries.clear(); }

private:
    struct LogEntry {
        unsigned long timestamp;
        String text;
    };
    std::vector<LogEntry> _entries;
    size_t _maxEntries = 200;
    Level _minLevel = INFO;
};

#define LOG_DEBUG(msg)  Logger::instance().debug(msg)
#define LOG_INFO(msg)   Logger::instance().info(msg)
#define LOG_WARN(msg)   Logger::instance().warn(msg)
#define LOG_ERROR(msg)  Logger::instance().error(msg)
