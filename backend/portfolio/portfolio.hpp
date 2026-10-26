
#pragma once
// Accounts, positions (average-cost), realised/unrealised P&L, wallet, tax and risk analytics.
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include "../utils/json.hpp"
#include "../utils/util.hpp"
#include "../matching_engine/order.hpp"

using namespace std;

namespace qt {
struct Position { double qty = 0, avg = 0; };
struct ClosedTrade { string symbol; double qty = 0, buyPx = 0, sellPx = 0, pnl = 0, fees = 0; int64_t ts = 0; };
struct Txn { int64_t ts = 0; string kind; double amount = 0, balance = 0; };
struct Account {
  double cash = 0, startCash = 0, realized = 0, fees = 0; map<string, Position> pos;
  vector<ClosedTrade> closed; vector<Txn> txns; vector<pair<int64_t, double>> eqHist;
};
struct Quote { string sym, name, sector; double last = 0, prev = 0, high = 0, low = 0, vol = 0, cap = 0, vol1 = 0; bool crypto = false, index = false; };
typedef map<string, Quote> Quotes;

class Portfolio {
  mutable mutex m_;
  map<uint64_t, Account> acc_;
  double feeRate_ = 0.0003;
  double platformFees_ = 0;

  double eqLocked(const Account& a, const function<double(const string&)>& px) const {
    double e = a.cash;
    for (auto& kv : a.pos) e += kv.second.qty * px(kv.first);
    return e;
  }

public:
  struct View { double cash = 0, equity = 0; map<string, Position> pos; };

  double feeRate() const { return feeRate_; }

  void open(uint64_t u, double cash) {
    lock_guard<mutex> g(m_);
    auto& a = acc_[u];
    a.cash = a.startCash = cash;
    a.txns.push_back({nowMs(), "deposit", cash, cash});
  }

  bool has(uint64_t u) const {
    lock_guard<mutex> g(m_);
    return acc_.count(u) > 0;
  }

  void seedPosition(uint64_t u, const string& s, double q, double avg) {
    lock_guard<mutex> g(m_);
    auto& p = acc_[u].pos[s];
    p.qty = q;
    p.avg = avg;
  }

  View view(uint64_t u, const function<double(const string&)>& px) const {
    lock_guard<mutex> g(m_);
    View v;
    auto it = acc_.find(u);
    if (it == acc_.end()) return v;
    v.cash = it->second.cash;
    v.pos = it->second.pos;
    v.equity = eqLocked(it->second, px);
    return v;
  }

  double fee(double notional) const { return notional * feeRate_; }

  // Applies a fill to a user's account. Returns the fee charged.
  double applyFill(uint64_t u, Side side, const string& sym, double qty, double px, int64_t ts) {
    lock_guard<mutex> g(m_);
    auto& a = acc_[u];
    double notional = qty * px, fee = notional * feeRate_;

    a.fees += fee;
    platformFees_ += fee;
    a.cash -= fee;

    auto& p = a.pos[sym];

    if (side == Side::Buy) {
      a.cash -= notional;
      double nq = p.qty + qty;
      p.avg = nq > 0 ? (p.avg * p.qty + notional) / nq : 0;
      p.qty = nq;
    } else {
      a.cash += notional;
      double pnl = (px - p.avg) * qty;
      a.realized += pnl - fee;
      a.closed.push_back({sym, qty, p.avg, px, pnl - fee, fee, ts});
      p.qty -= qty;
      if (p.qty < 1e-9) {
        acc_[u].pos.erase(sym);
      }
    }

    return fee;
  }

  bool wallet(uint64_t u, const string& kind, double amount, string& err) {
    lock_guard<mutex> g(m_);
    auto& a = acc_[u];

    if (!(amount > 0)) {
      err = "Amount must be positive";
      return false;
    }

    if (kind == "withdraw") {
      if (amount > a.cash) {
        err = "Insufficient cash";
        return false;
      }
      a.cash -= amount;
    } else {
      a.cash += amount;
    }

    a.txns.push_back({nowMs(), kind, kind == "withdraw" ? -amount : amount, a.cash});
    return true;
  }

  void sampleEquity(const function<double(const string&)>& px, int64_t ts) {
    lock_guard<mutex> g(m_);

    for (auto& kv : acc_) {
      auto& h = kv.second.eqHist;
      h.push_back({ts, eqLocked(kv.second, px)});
      if (h.size() > 3000) h.erase(h.begin(), h.begin() + 500);
    }
  }

  double platformFees() const {
    lock_guard<mutex> g(m_);
    return platformFees_;
  }

  Json snapshot(uint64_t u, const Quotes& q) const {
    lock_guard<mutex> g(m_);
    Json j = Json::object();
    auto it = acc_.find(u);
    if (it == acc_.end()) return j;

    const Account& a = it->second;
    double inv = 0, val = 0, unreal = 0, dayPnl = 0, wvol = 0;
    Json rows = Json::array();
    map<string, double> sectors;

    for (auto& kv : a.pos) {
      auto qi = q.find(kv.first);
      double last = qi != q.end() ? qi->second.last : kv.second.avg;
      double prev = qi != q.end() ? qi->second.prev : last;
      double v = kv.second.qty * last;
      double c = kv.second.qty * kv.second.avg;

      inv += c;
      val += v;
      unreal += v - c;
      dayPnl += kv.second.qty * (last - prev);

      if (qi != q.end()) {
        sectors[qi->second.sector] += v;
        wvol += v * qi->second.vol1;
      }

      Json r = Json::object();
      r["symbol"] = kv.first;
      r["qty"] = kv.second.qty;
      r["avg"] = kv.second.avg;
      r["last"] = last;
      r["value"] = v;
      r["pnl"] = v - c;
      r["pnl_pct"] = c > 0 ? (v - c) / c * 100 : 0;
      r["day_pnl"] = kv.second.qty * (last - prev);
      r["sector"] = qi != q.end() ? qi->second.sector : "";
      rows.push(r);
    }

    double eq = a.cash + val, hhi = 0;

    for (auto& kv : a.pos) {
      auto qi = q.find(kv.first);
      double l = qi != q.end() ? qi->second.last : kv.second.avg;
      double w = val > 0 ? kv.second.qty * l / val : 0;
      hhi += w * w;
    }

    double avgVol = val > 0 ? wvol / val : 0;
    double cashPct = eq > 0 ? a.cash / eq : 1;
    double score = clampd(
        100 * (0.5 * hhi + 0.4 * min(avgVol / 0.04, 1.0) + 0.1 * (1 - cashPct))
        + (val > 0 ? 8 : 0), 0, 100);

    j["cash"] = a.cash;
    j["invested"] = inv;
    j["holdings_value"] = val;
    j["equity"] = eq;
    j["unrealized"] = unreal;
    j["realized"] = a.realized;
    j["fees"] = a.fees;
    j["day_pnl"] = dayPnl;
    j["total_pnl"] = eq - a.startCash;
    j["start_cash"] = a.startCash;
    j["positions"] = rows;
    j["risk_score"] = score;
    j["risk_label"] = score < 30 ? "Low" : score < 60 ? "Moderate" : "High";

    Json al = Json::array();

    for (auto& kv : sectors) {
      Json s = Json::object();
      s["sector"] = kv.first;
      s["value"] = kv.second;
      al.push(s);
    }

    Json cs = Json::object();
    cs["sector"] = "Cash";
    cs["value"] = a.cash;
    al.push(cs);
    j["allocation"] = al;

    return j;
  }

  Json equityCurve(uint64_t u, size_t maxPts = 400) const {
    lock_guard<mutex> g(m_);
    Json r = Json::array();
    auto it = acc_.find(u);
    if (it == acc_.end()) return r;

    auto& h = it->second.eqHist;
    size_t step = h.size() > maxPts ? h.size() / maxPts : 1;

    for (size_t i = 0; i < h.size(); i += step) {
      Json p = Json::array();
      p.push(h[i].first);
      p.push(h[i].second);
      r.push(p);
    }

    return r;
  }

  Json txns(uint64_t u) const {
    lock_guard<mutex> g(m_);
    Json r = Json::array();
    auto it = acc_.find(u);
    if (it == acc_.end()) return r;

    for (auto i = it->second.txns.rbegin(); i != it->second.txns.rend() && r.size() < 100; ++i) {
      Json t = Json::object();
      t["ts"] = i->ts;
      t["kind"] = i->kind;
      t["amount"] = i->amount;
      t["balance"] = i->balance;
      r.push(t);
    }

    return r;
  }

  // Illustrative tax report (all trades on the simulator are short-term). Rates are assumptions, not advice.
  Json taxReport(uint64_t u) const {
    lock_guard<mutex> g(m_);
    Json j = Json::object();
    auto it = acc_.find(u);
    if (it == acc_.end()) return j;

    double gains = 0, losses = 0, fees = 0;
    Json rows = Json::array();

    for (auto& c : it->second.closed) {
      if (c.pnl >= 0) gains += c.pnl;
      else losses += c.pnl;
      fees += c.fees;

      Json r = Json::object();
      r["symbol"] = c.symbol;
      r["qty"] = c.qty;
      r["buy"] = c.buyPx;
      r["sell"] = c.sellPx;
      r["pnl"] = c.pnl;
      r["ts"] = c.ts;
      r["term"] = "short";
      rows.push(r);
    }

    double net = gains + losses, rate = 0.20;
    j["gross_gains"] = gains;
    j["gross_losses"] = losses;
    j["net_stcg"] = net;
    j["assumed_stcg_rate"] = rate;
    j["estimated_tax"] = net > 0 ? net * rate : 0.0;
    j["fees_paid"] = fees;
    j["trades"] = rows;
    j["disclaimer"] = "Illustrative only. Simulated trades; rates are assumptions. Consult a tax professional.";

    return j;
  }

  Json toJson() const {
    lock_guard<mutex> g(m_);
    Json j = Json::object();
    j["platform_fees"] = platformFees_;
    Json arr = Json::array();

    for (auto& kv : acc_) {
      const Account& a = kv.second;
      Json x = Json::object();
      x["user"] = kv.first;
      x["cash"] = a.cash;
      x["start"] = a.startCash;
      x["realized"] = a.realized;
      x["fees"] = a.fees;

      Json ps = Json::array();
      for (auto& p : a.pos) {
        Json y = Json::object();
        y["s"] = p.first;
        y["q"] = p.second.qty;
        y["a"] = p.second.avg;
        ps.push(y);
      }
      x["pos"] = ps;

      Json cl = Json::array();
      for (auto& c : a.closed) {
        Json y = Json::object();
        y["s"] = c.symbol;
        y["q"] = c.qty;
        y["b"] = c.buyPx;
        y["p"] = c.sellPx;
        y["n"] = c.pnl;
        y["f"] = c.fees;
        y["t"] = c.ts;
        cl.push(y);
      }
      x["closed"] = cl;

      Json tx = Json::array();
      for (auto& t : a.txns) {
        Json y = Json::object();
        y["t"] = t.ts;
        y["k"] = t.kind;
        y["a"] = t.amount;
        y["b"] = t.balance;
        tx.push(y);
      }
      x["txns"] = tx;
      arr.push(x);
    }

    j["accounts"] = arr;
    return j;
  }

  void fromJson(const Json& j) {
    lock_guard<mutex> g(m_);
    platformFees_ = j.at("platform_fees").num();

    for (auto& x : j.at("accounts").a) {
      Account a;
      a.cash = x.at("cash").num();
      a.startCash = x.at("start").num();
      a.realized = x.at("realized").num();
      a.fees = x.at("fees").num();

      for (auto& y : x.at("pos").a)
        a.pos[y.at("s").str()] = {y.at("q").num(), y.at("a").num()};

      for (auto& y : x.at("closed").a)
        a.closed.push_back({
            y.at("s").str(), y.at("q").num(), y.at("b").num(),
            y.at("p").num(), y.at("n").num(), y.at("f").num(),
            (int64_t)y.at("t").num()
        });

      for (auto& y : x.at("txns").a)
        a.txns.push_back({
            (int64_t)y.at("t").num(), y.at("k").str(),
            y.at("a").num(), y.at("b").num()
        });

      acc_[(uint64_t)x.at("user").num()] = a;
    }
  }
};
}
