
#pragma once

#include <cstdint>
#include <string>
#include "../utils/json.hpp"

using namespace std;

namespace qt {

enum class Side { Buy, Sell };
enum class OType { Market, Limit, Stop, TakeProfit, Iceberg, Bracket, Trailing };
enum class OStatus { New, Partial, Filled, Cancelled, Rejected, Pending };

inline const char* toS(Side s) {
    return s == Side::Buy ? "buy" : "sell";
}

inline const char* toS(OType t) {
    switch (t) {
        case OType::Market: return "market";
        case OType::Limit: return "limit";
        case OType::Stop: return "stop_loss";
        case OType::TakeProfit: return "take_profit";
        case OType::Iceberg: return "iceberg";
        case OType::Bracket: return "bracket";
        case OType::Trailing: return "trailing_stop";
    }
    return "limit";
}

inline const char* toS(OStatus s) {
    switch (s) {
        case OStatus::New: return "open";
        case OStatus::Partial: return "partial";
        case OStatus::Filled: return "filled";
        case OStatus::Cancelled: return "cancelled";
        case OStatus::Rejected: return "rejected";
        case OStatus::Pending: return "pending_trigger";
    }
    return "open";
}

inline bool parseType(const string& s, OType& t) {
    static const struct {
        const char* n;
        OType t;
    } m[] = {
        {"market", OType::Market},
        {"limit", OType::Limit},
        {"stop_loss", OType::Stop},
        {"stop", OType::Stop},
        {"take_profit", OType::TakeProfit},
        {"iceberg", OType::Iceberg},
        {"bracket", OType::Bracket},
        {"trailing_stop", OType::Trailing},
        {"trailing", OType::Trailing}
    };

    for (auto& e : m) {
        if (s == e.n) {
            t = e.t;
            return true;
        }
    }

    return false;
}

struct Order {
    uint64_t id = 0, user = 0, seq = 0, group = 0, gen = 0;

    string symbol;
    Side side = Side::Buy;
    OType type = OType::Limit;
    OStatus status = OStatus::New;

    double price = 0, stop = 0, qty = 0, filled = 0,
           notional = 0, display = 0, slice = 0, tp = 0,
           sl = 0, trail = 0, extreme = 0;

    bool isBracket = false, exitsDone = false;
    int64_t ts = 0;
    string reason;

    double remaining() const {
        return qty - filled;
    }

    double avg() const {
        return filled > 0 ? notional / filled : 0;
    }

    Json toJson() const {
        Json j = Json::object();

        j["id"] = id;
        j["symbol"] = symbol;
        j["side"] = toS(side);
        j["type"] = toS(type);
        j["status"] = toS(status);
        j["price"] = price;
        j["stop"] = stop;
        j["qty"] = qty;
        j["filled"] = filled;
        j["avg_price"] = avg();
        j["display"] = display;
        j["tp"] = tp;
        j["sl"] = sl;
        j["trail"] = trail;
        j["reason"] = reason;
        j["ts"] = ts;
        j["group"] = group;

        return j;
    }
};

struct Trade {
    uint64_t id = 0;
    string symbol;
    double price = 0, qty = 0;
    uint64_t buyOrder = 0, sellOrder = 0, buyUser = 0, sellUser = 0;
    int64_t ts = 0;
    Side aggressor = Side::Buy;
};

struct OrderRequest {
    uint64_t user = 0;
    string symbol;
    Side side = Side::Buy;
    OType type = OType::Limit;
    double qty = 0, price = 0, stop = 0, display = 0,
           tp = 0, sl = 0, trail = 0;
};

struct SubmitResult {
    bool ok = false;
    string reason;
    uint64_t id = 0;
    string status;
    double filled = 0, avg = 0;
};

}
