
#pragma once
// Pre-trade risk checks (margin, exposure, price band, position) and a per-user rate limiter.
#include <atomic>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include "../matching_engine/order.hpp"
#include "../utils/util.hpp"

using namespace std;

namespace qt {

struct RiskLimits {
    double maxOrderNotional = 2500000, priceBandPct = 10,
           maxPositionPct = 60, leverage = 1.0, maxQty = 1e7;
    int maxOpenOrders = 100, maxOrdersPerSec = 20;
};

struct RiskCtx {
    double last = 0, cash = 0, equity = 0, posQty = 0,
           posValueSym = 0, openBuyNotional = 0, openSellQty = 0;
    int openOrders = 0;
};

class RiskManager {
    mutex rm_;
    map<uint64_t, deque<int64_t>> hits_;

public:
    RiskLimits lim;
    atomic<bool> halted{false};
    atomic<uint64_t> checks{0}, rejects{0};

    string check(const OrderRequest& r, const RiskCtx& c) {
        checks++;

        auto rej = [&](const string& why) {
            rejects++;
            return why;
        };

        if (halted)
            return rej("Trading is halted by the administrator");

        if (!(r.qty > 0) || !isfinite(r.qty))
            return rej("Quantity must be positive");

        if (r.qty > lim.maxQty)
            return rej("Quantity exceeds maximum order size");

        if (c.last <= 0)
            return rej("No market price available");

        bool limitLike = r.type == OType::Limit ||
                         r.type == OType::Iceberg ||
                         (r.type == OType::Bracket && r.price > 0);

        double ref = limitLike ? r.price : c.last;

        if (limitLike &&
            fabs(r.price / c.last - 1) * 100 > lim.priceBandPct) {
            return rej(
                "Limit price outside the +/-" +
                to_string((int)lim.priceBandPct) + "% price band"
            );
        }

        double notional = r.qty * ref;

        if (notional > lim.maxOrderNotional)
            return rej("Order value exceeds the per-order limit");

        if (c.openOrders >= lim.maxOpenOrders)
            return rej("Too many open orders");

        if (r.side == Side::Buy) {
            if (notional + c.openBuyNotional >
                c.cash * lim.leverage + 1e-6) {
                return rej(
                    "Insufficient buying power (margin check failed)"
                );
            }

            if (c.equity > 0 &&
                (c.posValueSym + notional) / c.equity * 100 >
                    lim.maxPositionPct) {
                return rej(
                    "Exposure limit: single position would exceed " +
                    to_string((int)lim.maxPositionPct) +
                    "% of equity"
                );
            }
        } else if (r.qty + c.openSellQty > c.posQty + 1e-9) {
            return rej(
                "Insufficient position (short selling is disabled)"
            );
        }

        return "";
    }

    bool allowRate(uint64_t user) {
        lock_guard<mutex> g(rm_);
        int64_t now = nowMs();
        auto& d = hits_[user];

        while (!d.empty() && now - d.front() > 1000)
            d.pop_front();

        if ((int)d.size() >= lim.maxOrdersPerSec)
            return false;

        d.push_back(now);
        return true;
    }

    Json toJson() const {
        Json j = Json::object();

        j["max_order_notional"] = lim.maxOrderNotional;
        j["price_band_pct"] = lim.priceBandPct;
        j["max_position_pct"] = lim.maxPositionPct;
        j["leverage"] = lim.leverage;
        j["max_open_orders"] = lim.maxOpenOrders;
        j["max_orders_per_sec"] = lim.maxOrdersPerSec;
        j["halted"] = halted.load();
        j["checks"] = checks.load();
        j["rejects"] = rejects.load();

        return j;
    }
};

}
