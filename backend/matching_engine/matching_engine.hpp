
#pragma once

// Price-time priority matching engine.
// - One book per symbol, two priority queues (bids/asks) with lazy cancellation.
// - Orders live in a MemoryPool (no allocation on the hot path).
// - Commands arrive through an SPSC ring buffer and execute on a dedicated engine thread.
// - Supports Market, Limit, Stop-loss, Take-profit, Iceberg, Bracket (OCO exits),
//   and Trailing-stop orders.
// - A market-maker bot (user 0) keeps a ladder of resting liquidity around the feed price.

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <thread>
#include <unordered_map>
#include <map>
#include <vector>
#include <string>
#include <cstdint>
#include <algorithm>
#include <cmath>
#include <chrono>
#include <memory>
#include <type_traits>

using namespace std;

#include "order.hpp"
#include "../portfolio/portfolio.hpp"
#include "../risk_manager/risk_manager.hpp"
#include "../utils/latency_monitor.hpp"
#include "../utils/memory_pool.hpp"
#include "../utils/spsc_queue.hpp"

namespace qt {

class MatchingEngine {
    static constexpr double EPS = 1e-9;

    struct BidCmp {
        bool operator()(const Order* a, const Order* b) const {
            if (a->price != b->price) return a->price < b->price;
            return a->seq > b->seq;
        }
    };

    struct AskCmp {
        bool operator()(const Order* a, const Order* b) const {
            if (a->price != b->price) return a->price > b->price;
            return a->seq > b->seq;
        }
    };

    struct Book {
        string sym;
        double tick = 0.05, liq = 0, spreadBps = 6, last = 0;
        uint64_t gen = 0;

        priority_queue<Order*, vector<Order*>, BidCmp> bids;
        priority_queue<Order*, vector<Order*>, AskCmp> asks;
        deque<Trade> tape;
    };

    typedef function<void()> Cmd;

public:
    struct Hooks {
        function<void(const Trade&)> onTrade;
        function<void(const Order&)> onOrder;
        function<void(const string&, double)> onBook;
    } hooks;

    LatencyMonitor ackLatency, matchLatency;
    atomic<uint64_t> processed{0}, tradeCount{0};

    MatchingEngine(RiskManager& r, Portfolio& p)
        : risk_(r), pf_(p) {}

    ~MatchingEngine() {
        stop();
    }

    void addSymbol(
        const string& sym,
        double tick,
        double liq,
        double spreadBps,
        double last
    ) {
        Book& b = books_[sym];
        b.sym = sym;
        b.tick = tick;
        b.liq = liq;
        b.spreadBps = spreadBps;
        b.last = last;
    }

    void start() {
        if (running_) return;

        running_ = true;
        th_ = thread([this] {
            loop();
        });
    }

    void stop() {
        if (!running_) return;

        running_ = false;
        cv_.notify_all();

        if (th_.joinable()) {
            th_.join();
        }
    }

    bool isRunning() const {
        return running_;
    }

    size_t queueDepth() const {
        return q_.size();
    }

    size_t poolLive() {
        return pool_.live();
    }

    SubmitResult submit(const OrderRequest& r) {
        uint64_t t0 = nowNs();

        SubmitResult res = call([this, r] {
            uint64_t s = nowNs();
            SubmitResult x = submit_(r);
            matchLatency.record(nowNs() - s);
            return x;
        });

        ackLatency.record(nowNs() - t0);
        processed++;

        return res;
    }

    bool cancel(uint64_t user, uint64_t id, string& why) {
        bool ok = false;
        string w;

        call([&] {
            ok = cancel_(user, id, w);
        });

        why = w;
        return ok;
    }

    void onTick(const string& sym, double px) {
        Cmd c = [this, sym, px] {
            tick_(sym, px);
        };

        if (running_) {
            post(c);
        } else {
            c();
        }
    }

    Json depth(const string& sym, int levels = 12) {
        return call([this, sym, levels] {
            return depth_(sym, levels);
        });
    }

    vector<Order> ordersFor(uint64_t user, size_t histMax = 100) {
        return call([this, user, histMax] {
            vector<Order> v;

            for (auto& kv : byId_) {
                if (kv.second->user == user) {
                    v.push_back(*kv.second);
                }
            }

            sort(v.begin(), v.end(), [](const Order& a, const Order& b) {
                return a.id > b.id;
            });

            size_t n = 0;

            for (auto i = hist_.rbegin();
                 i != hist_.rend() && n < histMax;
                 ++i) {
                if (i->user == user) {
                    v.push_back(*i);
                    n++;
                }
            }

            return v;
        });
    }

    vector<Trade> tape(const string& sym, size_t n = 50) {
        return call([this, sym, n] {
            vector<Trade> v;

            auto it = books_.find(sym);
            if (it == books_.end()) return v;

            auto& t = it->second.tape;

            for (auto i = t.rbegin(); i != t.rend() && v.size() < n; ++i) {
                v.push_back(*i);
            }

            return v;
        });
    }

    // Only call from engine-thread hooks (e.g. onBook);
    // other threads must use depth().
    Json depthInEngineThread(const string& sym, int levels = 12) {
        return depth_(sym, levels);
    }

    double last(const string& sym) {
        return call([this, sym] {
            auto it = books_.find(sym);
            return it == books_.end() ? 0.0 : it->second.last;
        });
    }

private:
    RiskManager& risk_;
    Portfolio& pf_;

    MemoryPool<Order> pool_{4096};

    map<string, Book> books_;
    unordered_map<uint64_t, Order*> byId_;
    vector<Order*> triggers_;
    deque<Order> hist_;

    uint64_t nextId_ = 1, seq_ = 0, nextTrade_ = 1, nextGroup_ = 1;

    SpscQueue<Cmd, 8192> q_;

    mutex pm_, cvm_;
    condition_variable cv_;
    atomic<bool> running_{false}, sleeping_{false};
    thread th_;

    bool post(const Cmd& c) {
        {
            lock_guard<mutex> g(pm_);

            if (!q_.push(c)) {
                return false;
            }
        }

        if (sleeping_) {
            cv_.notify_one();
        }

        return true;
    }

    void loop() {
        int idle = 0;

        while (true) {
            Cmd c;

            if (q_.pop(c)) {
                c();
                idle = 0;
                continue;
            }

            if (!running_) break;

            if (++idle < 200) {
                this_thread::yield();
            } else {
                unique_lock<mutex> lk(cvm_);

                sleeping_ = true;
                cv_.wait_for(lk, chrono::milliseconds(2));
                sleeping_ = false;
                idle = 0;
            }
        }
    }

    template <class F>
    auto call(F f) -> decltype(f()) {
        typedef decltype(f()) R;

        if (!running_) {
            return f();
        }

        auto p = make_shared<promise<R>>();
        auto fut = p->get_future();

        Cmd c = [p, f]() mutable {
            try {
                setVal(*p, f);
            } catch (...) {
                p->set_exception(current_exception());
            }
        };

        while (!post(c)) {
            this_thread::yield();
        }

        return fut.get();
    }

    template <class R, class F>
    static typename enable_if<!is_void<R>::value>::type
    setVal(promise<R>& p, F& f) {
        p.set_value(f());
    }

    template <class R, class F>
    static typename enable_if<is_void<R>::value>::type
    setVal(promise<R>& p, F& f) {
        f();
        p.set_value();
    }

    template <class PQ>
    Order* topLive(Book& b, PQ& pq) {
        while (!pq.empty()) {
            Order* t = pq.top();

            if (t->status == OStatus::Cancelled ||
                (t->user == 0 && t->gen != b.gen)) {
                pq.pop();
                pool_.release(t);
                continue;
            }

            return t;
        }

        return nullptr;
    }

    void finish(Order* o) {
        if (o->user != 0) {
            hist_.push_back(*o);

            if (hist_.size() > 20000) {
                hist_.pop_front();
            }

            byId_.erase(o->id);

            if (hooks.onOrder) {
                hooks.onOrder(*o);
            }
        }

        if (o->isBracket && !o->exitsDone && o->filled > EPS) {
            createExits(o);
        }
    }

    void createExits(Order* o) {
        o->exitsDone = true;

        uint64_t g = nextGroup_++;
        Side ex = o->side == Side::Buy ? Side::Sell : Side::Buy;

        for (int k = 0; k < 2; k++) {
            Order* e = pool_.alloc();

            e->id = nextId_++;
            e->seq = ++seq_;
            e->user = o->user;
            e->symbol = o->symbol;
            e->side = ex;
            e->qty = o->filled;
            e->group = g;
            e->ts = nowMs();

            e->type = k == 0 ? OType::TakeProfit : OType::Stop;
            e->stop = k == 0 ? o->tp : o->sl;
            e->status = OStatus::Pending;

            byId_[e->id] = e;
            triggers_.push_back(e);

            if (hooks.onOrder) {
                hooks.onOrder(*e);
            }
        }
    }

    void record(Book& b, Order* in, Order* rest, double q, double px) {
        Trade t;

        t.id = nextTrade_++;
        t.symbol = b.sym;
        t.price = px;
        t.qty = q;
        t.ts = nowMs();
        t.aggressor = in->side;

        Order* buy = in->side == Side::Buy ? in : rest;
        Order* sell = in->side == Side::Buy ? rest : in;

        t.buyOrder = buy->id;
        t.sellOrder = sell->id;
        t.buyUser = buy->user;
        t.sellUser = sell->user;

        b.tape.push_back(t);

        if (b.tape.size() > 300) {
            b.tape.pop_front();
        }

        tradeCount++;

        if (hooks.onTrade) {
            hooks.onTrade(t);
        }
    }

    template <class PQ>
    void match(Book& b, Order* o, PQ& opp, bool market) {
        while (o->remaining() > EPS) {
            Order* m = topLive(b, opp);

            if (!m) break;

            if (!market) {
                if (o->side == Side::Buy && m->price > o->price + 1e-9) break;
                if (o->side == Side::Sell && m->price < o->price - 1e-9) break;
            }

            if (m->user == o->user && m->user != 0) {
                o->reason = "Self-trade prevented";
                o->status = OStatus::Cancelled;
                return;
            }

            double avail = m->type == OType::Iceberg
                ? min(m->slice, m->remaining())
                : m->remaining();

            double q = min(o->remaining(), avail);
            double px = m->price;

            o->filled += q;
            o->notional += q * px;

            m->filled += q;
            m->notional += q * px;

            if (m->type == OType::Iceberg) {
                m->slice -= q;
            }

            record(b, o, m, q, px);

            if (m->remaining() <= EPS) {
                m->status = OStatus::Filled;
                opp.pop();
                finish(m);
                pool_.release(m);
            } else {
                m->status = OStatus::Partial;

                if (m->type == OType::Iceberg && m->slice <= EPS) {
                    opp.pop();
                    m->slice = min(m->display, m->remaining());
                    m->seq = ++seq_;
                    opp.push(m);
                }

                if (m->user != 0 && hooks.onOrder) {
                    hooks.onOrder(*m);
                }
            }
        }
    }

    void runOrder(Book& b, Order* o, bool market) {
        if (o->side == Side::Buy) {
            match(b, o, b.asks, market);
        } else {
            match(b, o, b.bids, market);
        }

        if (o->status == OStatus::Cancelled) {
            finish(o);
            pool_.release(o);
            return;
        }

        if (o->remaining() <= EPS) {
            o->status = OStatus::Filled;
            finish(o);
            pool_.release(o);
            return;
        }

        if (market || (o->type == OType::Bracket && o->price <= 0)) {
            o->status = OStatus::Cancelled;
            o->reason = o->filled > 0
                ? "Market order partially filled; remainder cancelled (no liquidity)"
                : "No liquidity";

            finish(o);
            pool_.release(o);
            return;
        }

        if (o->type == OType::Iceberg) {
            o->slice = min(o->display, o->remaining());
        }

        o->status = o->filled > EPS ? OStatus::Partial : OStatus::New;

        if (o->side == Side::Buy) {
            b.bids.push(o);
        } else {
            b.asks.push(o);
        }

        if (o->user != 0 && hooks.onOrder) {
            hooks.onOrder(*o);
        }
    }

    SubmitResult submit_(const OrderRequest& r) {
        SubmitResult res;

        auto bad = [&](const string& why) {
            res.reason = why;
            res.status = "rejected";
            return res;
        };

        auto bi = books_.find(r.symbol);

        if (bi == books_.end()) {
            return bad("Unknown symbol");
        }

        Book& b = bi->second;

        if (!(r.qty > 0) || !isfinite(r.qty)) {
            return bad("Quantity must be positive");
        }

        bool needPx = r.type == OType::Limit || r.type == OType::Iceberg;

        if (needPx && !(r.price > 0)) {
            return bad("Limit price required");
        }

        if ((r.type == OType::Stop || r.type == OType::TakeProfit) &&
            !(r.stop > 0)) {
            return bad("Trigger price required");
        }

        if (r.type == OType::Trailing && !(r.trail > 0)) {
            return bad("Trail amount required");
        }

        if (r.type == OType::Iceberg &&
            (!(r.display > 0) || r.display > r.qty)) {
            return bad("Iceberg display quantity must be between 0 and total quantity");
        }

        if (r.type == OType::Bracket) {
            double e = r.price > 0 ? r.price : b.last;

            if (!(r.tp > 0 && r.sl > 0)) {
                return bad("Bracket needs take-profit and stop-loss");
            }

            if (r.side == Side::Buy && !(r.sl < e && e < r.tp)) {
                return bad("Buy bracket needs stop-loss < entry < take-profit");
            }

            if (r.side == Side::Sell && !(r.tp < e && e < r.sl)) {
                return bad("Sell bracket needs take-profit < entry < stop-loss");
            }
        }

        if (r.type == OType::Stop) {
            if (r.side == Side::Sell && r.stop >= b.last) {
                return bad("Sell stop-loss must be below the last price");
            }

            if (r.side == Side::Buy && r.stop <= b.last) {
                return bad("Buy stop must be above the last price");
            }
        }

        if (r.type == OType::TakeProfit) {
            if (r.side == Side::Sell && r.stop <= b.last) {
                return bad("Sell take-profit must be above the last price");
            }

            if (r.side == Side::Buy && r.stop >= b.last) {
                return bad("Buy take-profit must be below the last price");
            }
        }

        string why = risk_.check(r, riskCtx(r, b));

        if (!why.empty()) {
            return bad(why);
        }

        Order* o = pool_.alloc();

        o->id = nextId_++;
        o->seq = ++seq_;
        o->user = r.user;
        o->symbol = r.symbol;
        o->side = r.side;
        o->type = r.type;
        o->qty = r.qty;
        o->price = r.price;
        o->stop = r.stop;
        o->display = r.display;
        o->tp = r.tp;
        o->sl = r.sl;
        o->trail = r.trail;
        o->ts = nowMs();
        o->isBracket = r.type == OType::Bracket;

        byId_[o->id] = o;

        res.id = o->id;
        res.ok = true;

        if (r.type == OType::Stop ||
            r.type == OType::TakeProfit ||
            r.type == OType::Trailing) {
            o->status = OStatus::Pending;
            o->extreme = b.last;

            triggers_.push_back(o);
            res.status = toS(o->status);

            if (hooks.onOrder) {
                hooks.onOrder(*o);
            }

            return res;
        }

        Order snap;

        runOrderTracked(b, o, r.type == OType::Market, snap);

        res.status = toS(snap.status);
        res.filled = snap.filled;
        res.avg = snap.avg();
        res.reason = snap.reason;

        return res;
    }

    void runOrderTracked(Book& b, Order* o, bool market, Order& snap) {
        uint64_t id = o->id;

        runOrder(b, o, market);

        auto it = byId_.find(id);

        if (it != byId_.end()) {
            snap = *it->second;
        } else {
            for (auto i = hist_.rbegin(); i != hist_.rend(); ++i) {
                if (i->id == id) {
                    snap = *i;
                    break;
                }
            }
        }
    }

    RiskCtx riskCtx(const OrderRequest& r, Book& b) {
        RiskCtx c;
        c.last = b.last;

        auto v = pf_.view(r.user, [this](const string& s) {
            auto it = books_.find(s);
            return it == books_.end() ? 0.0 : it->second.last;
        });

        c.cash = v.cash;
        c.equity = v.equity;

        auto pi = v.pos.find(r.symbol);

        if (pi != v.pos.end()) {
            c.posQty = pi->second.qty;
            c.posValueSym = pi->second.qty * b.last;
        }

        for (auto& kv : byId_) {
            Order* o = kv.second;

            if (o->user != r.user) continue;

            c.openOrders++;

            if (o->symbol == r.symbol && o->side == Side::Sell) {
                c.openSellQty += o->remaining();
            }

            if (o->side == Side::Buy &&
                (o->status == OStatus::New || o->status == OStatus::Partial)) {
                c.openBuyNotional += o->remaining() * o->price;
            }
        }

        return c;
    }

    bool cancel_(uint64_t user, uint64_t id, string& why) {
        auto it = byId_.find(id);

        if (it == byId_.end()) {
            why = "Order not found or already completed";
            return false;
        }

        Order* o = it->second;

        if (o->user != user) {
            why = "Order belongs to another user";
            return false;
        }

        o->status = OStatus::Cancelled;
        o->reason = "Cancelled by user";

        if (o->group) {
            for (auto* t : triggers_) {
                if (t != o && t->group == o->group) {
                    /* OCO sibling stays until user cancels it too */
                }
            }
        }

        auto ti = find(triggers_.begin(), triggers_.end(), o);

        if (ti != triggers_.end()) {
            triggers_.erase(ti);
            finish(o);
            pool_.release(o);
        } else {
            finish(o);
        }

        return true;
    }

    void tick_(const string& sym, double px) {
        auto bi = books_.find(sym);

        if (bi == books_.end()) return;

        Book& b = bi->second;
        b.last = px;

        if (b.liq > 0) {
            refresh(b, px);
        }

        if (hooks.onBook) {
            hooks.onBook(sym, px);
        }

        vector<Order*> fired;

        for (auto* t : triggers_) {
            if (t->symbol != sym) continue;

            bool hit = false;

            if (t->type == OType::Stop) {
                hit = t->side == Side::Sell ? px <= t->stop : px >= t->stop;
            } else if (t->type == OType::TakeProfit) {
                hit = t->side == Side::Sell ? px >= t->stop : px <= t->stop;
            } else if (t->type == OType::Trailing) {
                if (t->side == Side::Sell) {
                    t->extreme = max(t->extreme, px);
                    hit = px <= t->extreme - t->trail;
                } else {
                    t->extreme = min(t->extreme, px);
                    hit = px >= t->extreme + t->trail;
                }
            }

            if (hit) {
                fired.push_back(t);
            }
        }

        for (auto* t : fired) {
            auto ti = find(triggers_.begin(), triggers_.end(), t);

            if (ti == triggers_.end()) continue;

            triggers_.erase(ti);

            if (t->group) {
                for (size_t i = 0; i < triggers_.size();) {
                    Order* s = triggers_[i];

                    if (s->group == t->group) {
                        s->status = OStatus::Cancelled;
                        s->reason = "OCO sibling triggered";

                        triggers_.erase(triggers_.begin() + i);
                        finish(s);
                        pool_.release(s);
                    } else {
                        i++;
                    }
                }
            }

            t->reason = "Triggered";
            t->type = OType::Market;
            t->status = OStatus::New;

            runOrder(b, t, true);
        }
    }

    void refresh(Book& b, double mid) {
        b.gen++;

        if (b.bids.size() + b.asks.size() > 6000) {
            compact(b);
        }

        double half = mid * b.spreadBps / 20000.0;
        double step = max(b.tick, mid * 0.00015);

        for (int i = 0; i < 10; i++) {
            for (int s = 0; s < 2; s++) {
                Order* o = pool_.alloc();

                o->id = nextId_++;
                o->seq = ++seq_;
                o->user = 0;
                o->symbol = b.sym;
                o->gen = b.gen;
                o->type = OType::Limit;
                o->ts = nowMs();

                o->side = s == 0 ? Side::Buy : Side::Sell;

                double raw = s == 0
                    ? mid - half - i * step
                    : mid + half + i * step;

                o->price = max(b.tick, roundTo(raw, b.tick));

                if (s == 0 && o->price >= mid) {
                    o->price = mid - b.tick;
                }

                if (s == 1 && o->price <= mid) {
                    o->price = mid + b.tick;
                }

                o->qty = b.liq * (0.4 + uni(0, 1.2)) * (1 + i * 0.25);

                runOrder(b, o, false);
            }
        }
    }

    template <class PQ>
    void compactPQ(Book& b, PQ& pq) {
        vector<Order*> keep;

        while (!pq.empty()) {
            Order* t = pq.top();
            pq.pop();

            if (t->status == OStatus::Cancelled ||
                (t->user == 0 && t->gen != b.gen)) {
                pool_.release(t);
            } else {
                keep.push_back(t);
            }
        }

        for (auto* t : keep) {
            pq.push(t);
        }
    }

    void compact(Book& b) {
        compactPQ(b, b.bids);
        compactPQ(b, b.asks);
    }

    template <class PQ>
    Json side_(Book& b, PQ pq, int levels) {
        Json arr = Json::array();

        double cum = 0;
        double curPx = -1, curQty = 0;
        int n = 0;

        auto flush = [&] {
            if (curPx >= 0) {
                cum += curQty;

                Json l = Json::object();
                l["price"] = curPx;
                l["qty"] = curQty;
                l["total"] = cum;

                arr.push(l);
                n++;
            }
        };

        while (!pq.empty() && n < levels) {
            Order* t = pq.top();
            pq.pop();

            if (t->status == OStatus::Cancelled ||
                (t->user == 0 && t->gen != b.gen)) {
                continue;
            }

            double vis = t->type == OType::Iceberg
                ? min(t->slice, t->remaining())
                : t->remaining();

            if (curPx >= 0 && fabs(t->price - curPx) < 1e-9) {
                curQty += vis;
            } else {
                flush();

                if (n >= levels) {
                    curPx = -1;
                    break;
                }

                curPx = t->price;
                curQty = vis;
            }
        }

        if (n < levels) {
            flush();
        }

        return arr;
    }

    Json depth_(const string& sym, int levels) {
        Json j = Json::object();

        auto it = books_.find(sym);

        if (it == books_.end()) {
            return j;
        }

        Book& b = it->second;

        j["symbol"] = sym;
        j["bids"] = side_(b, b.bids, levels);
        j["asks"] = side_(b, b.asks, levels);
        j["last"] = b.last;

        double bb = j.at("bids").size()
            ? j.at("bids").a[0].at("price").num()
            : 0;

        double ba = j.at("asks").size()
            ? j.at("asks").a[0].at("price").num()
            : 0;

        j["best_bid"] = bb;
        j["best_ask"] = ba;
        j["spread"] = (bb > 0 && ba > 0) ? ba - bb : 0;
        j["mid"] = (bb > 0 && ba > 0) ? (ba + bb) / 2 : b.last;

        return j;
    }
};

} // namespace qt
