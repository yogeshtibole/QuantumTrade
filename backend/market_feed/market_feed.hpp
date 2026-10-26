
#pragma once

// Simulated market feed: mean-reverting random walks, 5s candles, indices, generated news, sample calendar.
// Replace `step()` with a real exchange/vendor adapter to go live; everything downstream stays the same.

#include <atomic>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>
#include <string>
#include <map>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cmath>
#include <algorithm>
#include <chrono>

using namespace std;

#include "../portfolio/portfolio.hpp"
#include "../utils/json.hpp"
#include "../utils/util.hpp"

namespace qt {

struct Candle {
    int64_t t = 0;
    double o = 0, h = 0, l = 0, c = 0, v = 0;
};

struct News {
    uint64_t id = 0;
    int64_t ts = 0;
    string headline, sym, category, source;
    double sentiment = 0;
};

struct SymDef {
    const char *sym, *name, *sector;
    double base, vol, capCr, tick, liq;
    bool crypto, index;
};

inline const vector<SymDef>& symbolDefs() {
    static const vector<SymDef> d = {
        {"RELIANCE","Reliance Industries","Energy",2900,0.014,1960000,0.05,1500,false,false},
        {"ONGC","ONGC","Energy",270,0.016,340000,0.05,6000,false,false},
        {"HDFCBANK","HDFC Bank","Banking",1650,0.012,1260000,0.05,2000,false,false},
        {"ICICIBANK","ICICI Bank","Banking",1150,0.013,810000,0.05,3000,false,false},
        {"TCS","Tata Consultancy","IT",3900,0.011,1420000,0.05,800,false,false},
        {"INFY","Infosys","IT",1500,0.013,620000,0.05,2500,false,false},
        {"SUNPHARMA","Sun Pharma","Pharma",1700,0.014,410000,0.05,1500,false,false},
        {"DRREDDY","Dr Reddys Labs","Pharma",1280,0.013,107000,0.05,1200,false,false},
        {"ITC","ITC","FMCG",430,0.010,540000,0.05,8000,false,false},
        {"HUL","Hindustan Unilever","FMCG",2450,0.010,575000,0.05,1200,false,false},
        {"MARUTI","Maruti Suzuki","Auto",12500,0.014,393000,0.05,200,false,false},
        {"TATAMOTORS","Tata Motors","Auto",960,0.019,354000,0.05,4000,false,false},
        {"TATASTEEL","Tata Steel","Metal",150,0.020,187000,0.05,12000,false,false},
        {"HINDALCO","Hindalco","Metal",650,0.018,146000,0.05,4000,false,false},
        {"DLF","DLF","Realty",820,0.021,203000,0.05,3000,false,false},
        {"BTC-INR","Bitcoin (INR)","Crypto",5400000,0.030,0,10,0.4,true,false},
        {"ETH-INR","Ethereum (INR)","Crypto",280000,0.034,0,1,4,true,false},
        {"NIFTY50","Nifty 50","Index",24800,0.008,0,0.05,0,false,true},
        {"SENSEX","BSE Sensex","Index",81400,0.008,0,0.05,0,false,true},
        {"NASDAQ","Nasdaq Composite","Index",18200,0.011,0,0.05,0,false,true},
        {"DOWJONES","Dow Jones","Index",42000,0.009,0,0.05,0,false,true}
    };

    return d;
}

class MarketFeed {
    struct State {
        SymDef def;
        double last = 0, prev = 0, hi = 0, lo = 0, vol = 0;
        deque<Candle> candles;
    };

    mutable mutex m_;
    map<string, State> st_;
    deque<News> news_;
    uint64_t newsId_ = 1;
    atomic<bool> run_{false};
    thread th_;

    atomic<uint64_t> ticks_{0};
    int64_t startedAt_ = 0;
    int64_t lastTickAt_ = 0;

    static constexpr int64_t CANDLE_MS = 5000;

    static double sigma(const SymDef& d) {
        return d.vol * 0.0333;
    }

    double step(State& s, double sg, double extra = 0) {
        double lr = sg * randn()
                  - 0.0006 * log(s.last / s.def.base)
                  + extra;

        s.last *= exp(lr);
        return s.last;
    }

    void addNews(const string& sym, int idx) {
        static const char* pos[] = {
            "%s surges on strong quarterly guidance",
            "Brokerages raise target price for %s",
            "%s wins large new order, shares gain",
            "Institutional buying lifts %s",
            "%s announces buyback programme"
        };

        static const char* neg[] = {
            "%s slips as margins disappoint",
            "Analysts cut rating on %s",
            "%s faces regulatory scrutiny",
            "Profit booking drags %s lower",
            "%s flags weak demand outlook"
        };

        static const char* gen[] = {
            "Market opens mixed as investors await policy cues",
            "FIIs turn net buyers in cash segment",
            "Crude oil volatility keeps traders cautious",
            "Rupee steady against dollar in early trade",
            "Banking stocks lead the broader rally"
        };

        News n;
        n.id = newsId_++;
        n.ts = nowMs() - idx * 90000;
        n.source = "QT Demo Wire";

        char b[200];

        if (sym.empty()) {
            n.headline = gen[(size_t)uni(0, 5) % 5];
            n.category = "market";
            n.sentiment = uni(-0.2, 0.4);
        } else {
            bool p = uni() > 0.5;

            snprintf(
                b,
                sizeof b,
                p ? pos[(size_t)uni(0, 5) % 5]
                  : neg[(size_t)uni(0, 5) % 5],
                sym.c_str()
            );

            n.headline = b;
            n.sym = sym;
            n.category = "company";
            n.sentiment = p ? uni(0.3, 0.9) : -uni(0.3, 0.9);
        }

        news_.push_back(n);

        if (news_.size() > 200) {
            news_.pop_front();
        }

        if (idx == 0 && onNews) {
            auto c = n;
            onNews(c);
        }
    }

    void loop() {
        int n = 0;

        while (run_) {
            this_thread::sleep_for(chrono::milliseconds(250));

            vector<pair<string, double>> ticks;
            vector<pair<string, Candle>> cs;
            vector<Quote> batch;

            {
                lock_guard<mutex> g(m_);

                double mret = 0;
                int cnt = 0;
                int64_t now = nowMs();

                lastTickAt_ = now;

                for (auto& kv : st_) {
                    State& s = kv.second;

                    if (s.def.index) {
                        continue;
                    }

                    double p0 = s.last;

                    step(s, sigma(s.def));

                    if (!s.def.crypto) {
                        mret += log(s.last / p0);
                        cnt++;
                    }

                    update(s, p0, now);

                    ticks.push_back({
                        kv.first,
                        roundTo(s.last, s.def.tick)
                    });

                    cs.push_back({
                        kv.first,
                        s.candles.back()
                    });
                }

                mret = cnt ? mret / cnt : 0;

                for (auto& kv : st_) {
                    State& s = kv.second;

                    if (!s.def.index) {
                        continue;
                    }

                    double p0 = s.last;
                    double k = kv.first == "NIFTY50" ? 0.9
                             : kv.first == "SENSEX" ? 0.88
                             : 0;

                    step(
                        s,
                        k > 0 ? 0.0001 : sigma(s.def) * 0.8,
                        k * mret
                    );

                    update(s, p0, now);
                }

                if (n % 2 == 0) {
                    for (auto& kv : st_) {
                        batch.push_back(quoteOf(kv.second));
                    }
                }

                if (n % 90 == 45) {
                    addNews(
                        uni() > 0.25
                            ? string(symbolDefs()[(size_t)uni(0, 17)].sym)
                            : string(),
                        0
                    );
                }
            }

            ticks_ += ticks.size();

            for (auto& t : ticks) {
                if (onTick) {
                    onTick(t.first, t.second);
                }
            }

            for (auto& c : cs) {
                if (onCandle) {
                    onCandle(c.first, c.second);
                }
            }

            if (!batch.empty() && onBatch) {
                onBatch(batch);
            }

            n++;
        }
    }

    void update(State& s, double p0, int64_t now) {
        double v = s.def.index
            ? 0
            : max(
                1.0,
                s.def.liq > 0 ? s.def.liq * uni(0.05, 0.6) : 1
              ) * (s.def.crypto ? 0.01 : 1);

        s.hi = max(s.hi, s.last);
        s.lo = min(s.lo, s.last);
        s.vol += v;

        int64_t b = now / CANDLE_MS * CANDLE_MS;

        if (s.candles.empty() || s.candles.back().t != b) {
            Candle c;

            c.t = b;
            c.o = p0;
            c.h = max(p0, s.last);
            c.l = min(p0, s.last);
            c.c = s.last;
            c.v = v;

            s.candles.push_back(c);

            if (s.candles.size() > 3000) {
                s.candles.pop_front();
            }
        } else {
            Candle& c = s.candles.back();

            c.h = max(c.h, s.last);
            c.l = min(c.l, s.last);
            c.c = s.last;
            c.v += v;
        }
    }

    Quote quoteOf(const State& s) const {
        Quote q;

        q.sym = s.def.sym;
        q.name = s.def.name;
        q.sector = s.def.sector;
        q.last = roundTo(s.last, s.def.tick);
        q.prev = roundTo(s.prev, s.def.tick);
        q.high = s.hi;
        q.low = s.lo;
        q.vol = s.vol;
        q.cap = s.def.capCr;
        q.crypto = s.def.crypto;
        q.index = s.def.index;
        q.vol1 = s.def.vol;

        return q;
    }

public:
    function<void(const string&, double)> onTick;
    function<void(const string&, const Candle&)> onCandle;
    function<void(const vector<Quote>&)> onBatch;
    function<void(const News&)> onNews;

    MarketFeed() {
        int64_t now = nowMs();
        int64_t b0 = now / CANDLE_MS * CANDLE_MS;

        for (auto& d : symbolDefs()) {
            State s;

            s.def = d;
            s.last = d.base * exp(randn() * 0.01);

            double sg = sigma(d);
            const int N = 500;

            for (int i = N; i > 0; i--) {
                Candle c;

                c.t = b0 - i * CANDLE_MS;
                c.o = s.last;
                c.h = c.l = s.last;
                c.v = 0;

                for (int k = 0; k < 20; k++) {
                    step(s, sg);

                    c.h = max(c.h, s.last);
                    c.l = min(c.l, s.last);

                    c.v += d.index
                        ? 0
                        : max(1.0, d.liq * uni(0.05, 0.6))
                          * (d.crypto ? 0.01 : 1) / 4;
                }

                c.c = s.last;
                s.candles.push_back(c);
            }

            s.prev = s.candles.front().o;
            s.hi = s.lo = s.last;

            for (auto& c : s.candles) {
                s.hi = max(s.hi, c.h);
                s.lo = min(s.lo, c.l);
                s.vol += c.v;
            }

            st_[d.sym] = s;
        }

        for (int i = 12; i > 0; i--) {
            addNews(
                i % 3
                    ? string(symbolDefs()[(size_t)uni(0, 17)].sym)
                    : string(),
                i
            );
        }

        startedAt_ = now;
    }

    ~MarketFeed() {
        stop();
    }

    void start() {
        if (run_) {
            return;
        }

        run_ = true;
        th_ = thread([this] {
            loop();
        });
    }

    void stop() {
        if (!run_) {
            return;
        }

        run_ = false;

        if (th_.joinable()) {
            th_.join();
        }
    }

    Quotes quotes() const {
        lock_guard<mutex> g(m_);

        Quotes q;

        for (auto& kv : st_) {
            q[kv.first] = quoteOf(kv.second);
        }

        return q;
    }

    bool quote(const string& s, Quote& out) const {
        lock_guard<mutex> g(m_);

        auto i = st_.find(s);

        if (i == st_.end()) {
            return false;
        }

        out = quoteOf(i->second);
        return true;
    }

    double last(const string& s) const {
        lock_guard<mutex> g(m_);

        auto i = st_.find(s);

        return i == st_.end()
            ? 0
            : roundTo(i->second.last, i->second.def.tick);
    }

    bool def(const string& s, SymDef& d) const {
        lock_guard<mutex> g(m_);

        auto i = st_.find(s);

        if (i == st_.end()) {
            return false;
        }

        d = i->second.def;
        return true;
    }

    vector<Candle> candles(const string& s, size_t limit) const {
        lock_guard<mutex> g(m_);

        auto i = st_.find(s);
        vector<Candle> v;

        if (i == st_.end()) {
            return v;
        }

        auto& c = i->second.candles;
        size_t from = c.size() > limit ? c.size() - limit : 0;

        v.assign(c.begin() + from, c.end());

        return v;
    }

    vector<News> news(size_t n, const string& sym = "") const {
        lock_guard<mutex> g(m_);

        vector<News> v;

        for (auto i = news_.rbegin(); i != news_.rend() && v.size() < n; ++i) {
            if (sym.empty() || i->sym == sym) {
                v.push_back(*i);
            }
        }

        return v;
    }

    Json status() const {
        Json j = Json::object();

        lock_guard<mutex> g(m_);

        j["running"] = run_.load();
        j["symbols"] = st_.size();
        j["ticks_total"] = ticks_.load();
        j["last_tick_age_ms"] = lastTickAt_ ? nowMs() - lastTickAt_ : -1;
        j["uptime_s"] = (nowMs() - startedAt_) / 1000;
        j["source"] = "simulated";
        j["candle_ms"] = CANDLE_MS;

        return j;
    }

    // Sample economic calendar (dates generated relative to today).
    // Demo data, not real announcements.
    static Json calendar() {
        struct E {
            const char* kind;
            int d;
            const char* title;
            const char* detail;
        };

        static const E ev[] = {
            {"rbi",3,"RBI MPC Meeting - Day 1","Monetary Policy Committee begins review"},
            {"rbi",5,"RBI Policy Announcement","Repo rate decision and policy stance"},
            {"rbi",12,"RBI Governor Press Conference","Liquidity and inflation outlook"},
            {"rbi",20,"RBI Weekly Statistical Supplement","Forex reserves and money supply"},
            {"fed",4,"US CPI Inflation Data","Consumer price index release"},
            {"fed",9,"FOMC Meeting Begins","Two-day policy meeting"},
            {"fed",10,"FOMC Rate Decision","Federal funds target range"},
            {"fed",11,"Fed Chair Press Conference","Policy guidance and projections"},
            {"ipo",2,"GreenGrid Energy IPO opens","Price band Rs 310-326, lot 46 shares"},
            {"ipo",6,"NexaPay Technologies IPO opens","Price band Rs 180-190, lot 78 shares"},
            {"ipo",9,"Himalaya Foods IPO listing","Listing on NSE and BSE"},
            {"ipo",15,"Vertex Logistics IPO opens","Price band Rs 520-548, lot 27 shares"},
            {"earnings",1,"TCS Q2 results","Consensus: revenue growth 5.1% YoY"},
            {"earnings",3,"Infosys Q2 results","Consensus: EPS Rs 16.4"},
            {"earnings",6,"HDFC Bank Q2 results","Consensus: NII growth 8%"},
            {"earnings",8,"Reliance Industries Q2 results","Consensus: EBITDA Rs 48,000 cr"},
            {"earnings",13,"Sun Pharma Q2 results","Consensus: PAT Rs 2,900 cr"},
            {"earnings",16,"Maruti Suzuki Q2 results","Consensus: volume 5.0 lakh units"}
        };

        Json a = Json::array();
        int64_t now = nowMs();

        for (auto& e : ev) {
            Json x = Json::object();

            x["kind"] = e.kind;
            x["date"] = isoDate(now + (int64_t)e.d * 86400000LL);
            x["title"] = e.title;
            x["detail"] = e.detail;
            x["sample"] = true;

            a.push(x);
        }

        return a;
    }
};

} // namespace qt
