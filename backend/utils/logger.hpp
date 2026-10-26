#pragma once

#include <cstdio>
#include <deque>
#include <mutex>
#include <string>
#include <vector>
#include "util.hpp"

using namespace std;

namespace qt {

struct LogEntry {
    int64_t ts;
    string level, msg;
};

class Logger {
    mutex m_;
    deque<LogEntry> buf_;

public:
    static Logger& get() {
        static Logger l;
        return l;
    }

    void log(const char* lvl, const string& msg) {
        lock_guard<mutex> g(m_);

        buf_.push_back({nowMs(), lvl, msg});

        if (buf_.size() > 2000)
            buf_.pop_front();

        fprintf(stderr, "[%s] %s\n", lvl, msg.c_str());
    }

    vector<LogEntry> tail(size_t n) {
        lock_guard<mutex> g(m_);

        size_t s = buf_.size() > n ? buf_.size() - n : 0;

        return vector<LogEntry>(buf_.begin() + s, buf_.end());
    }
};

inline void logi(const string& m) {
    Logger::get().log("INFO", m);
}

inline void logw(const string& m) {
    Logger::get().log("WARN", m);
}

inline void loge(const string& m) {
    Logger::get().log("ERROR", m);
}

} // namespace qt