#pragma once
// Lock-free latency histogram (power-of-two buckets, nanoseconds) built on atomics.

#include <atomic>
#include <cstdint>
#include "json.hpp"

using namespace std;

namespace qt {

class LatencyMonitor {
    atomic<uint64_t> count_{0}, total_{0}, min_{~0ULL}, max_{0}, b_[40];

public:
    LatencyMonitor() {
        for (auto& x : b_)
            x = 0;
    }

    void record(uint64_t ns) {
        count_++;
        total_ += ns;

        uint64_t m = min_.load();
        while (ns < m && !min_.compare_exchange_weak(m, ns)) {}

        m = max_.load();
        while (ns > m && !max_.compare_exchange_weak(m, ns)) {}

        int k = 0;
        uint64_t v = ns;

        while (v > 1 && k < 39) {
            v >>= 1;
            k++;
        }

        b_[k]++;
    }

    uint64_t count() const {
        return count_;
    }

    double avgUs() const {
        uint64_t c = count_;
        return c ? total_ / (double)c / 1000.0 : 0;
    }

    double pctUs(double p) const {
        uint64_t c = count_;

        if (!c)
            return 0;

        uint64_t target = (uint64_t)(c * p), cum = 0;

        for (int k = 0; k < 40; k++) {
            cum += b_[k];

            if (cum > target)
                return (double)(1ULL << k) * 1.5 / 1000.0;
        }

        return max_ / 1000.0;
    }

    Json toJson() const {
        Json j = Json::object();
        uint64_t mn = min_;

        j["count"] = count();
        j["avg_us"] = avgUs();
        j["p50_us"] = pctUs(0.5);
        j["p99_us"] = pctUs(0.99);
        j["min_us"] = mn == ~0ULL ? 0.0 : mn / 1000.0;
        j["max_us"] = max_ / 1000.0;

        return j;
    }
};

} // namespace qt