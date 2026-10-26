
#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <ctime>
#include <map>
#include <random>
#include <string>
#include <vector>

using namespace std;

namespace qt {

inline int64_t nowMs() {
    return chrono::duration_cast<chrono::milliseconds>(
        chrono::system_clock::now().time_since_epoch()
    ).count();
}

inline uint64_t nowNs() {
    return chrono::duration_cast<chrono::nanoseconds>(
        chrono::steady_clock::now().time_since_epoch()
    ).count();
}

inline mt19937_64& rng() {
    thread_local mt19937_64 g(random_device{}() ^ nowNs());
    return g;
}

inline double uni(double a = 0, double b = 1) {
    return uniform_real_distribution<double>(a, b)(rng());
}

inline double randn() {
    return normal_distribution<double>(0, 1)(rng());
}

inline string lower(string s) {
    for (auto& c : s)
        c = (char)tolower((unsigned char)c);

    return s;
}

inline string upper(string s) {
    for (auto& c : s)
        c = (char)toupper((unsigned char)c);

    return s;
}

inline double roundTo(double v, double tick) {
    return tick > 0 ? round(v / tick) * tick : v;
}

inline double clampd(double v, double a, double b) {
    return v < a ? a : (v > b ? b : v);
}

inline string getenvOr(const char* k, const string& d) {
    const char* v = getenv(k);
    return v && *v ? v : d;
}

inline void tmUtc(time_t t, tm& out) {
#ifdef _WIN32
    gmtime_s(&out, &t);
#else
    gmtime_r(&t, &out);
#endif
}

inline string isoDate(int64_t ms) {
    tm tm;
    tmUtc((time_t)(ms / 1000), tm);

    char b[16];
    strftime(b, sizeof b, "%Y-%m-%d", &tm);

    return b;
}

inline string urlDecode(const string& s) {
    string o;

    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '%' && i + 2 < s.size()) {
            o += (char)strtol(
                s.substr(i + 1, 2).c_str(),
                nullptr,
                16
            );
            i += 2;
        }
        else if (s[i] == '+') {
            o += ' ';
        }
        else {
            o += s[i];
        }
    }

    return o;
}

inline map<string, string> parseQuery(const string& q) {
    map<string, string> m;
    size_t i = 0;

    while (i < q.size()) {
        size_t e = q.find('&', i);

        if (e == string::npos)
            e = q.size();

        string kv = q.substr(i, e - i);
        size_t eq = kv.find('=');

        if (eq == string::npos) {
            m[urlDecode(kv)] = "";
        }
        else {
            m[urlDecode(kv.substr(0, eq))] =
                urlDecode(kv.substr(eq + 1));
        }

        i = e + 1;
    }

    return m;
}

}
