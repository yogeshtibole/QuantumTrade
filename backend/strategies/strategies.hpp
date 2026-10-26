
#pragma once
// Eight trading strategies + a vectorised backtester (fees, slippage, Sharpe, drawdown, win rate, profit factor).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <random>
#include <string>
#include <vector>
#include "../utils/json.hpp"
#include "../utils/util.hpp"

using namespace std;

namespace qt {

struct Bar {
    int64_t t = 0;
    double o = 0, h = 0, l = 0, c = 0, v = 0;
};

struct StrategyInfo {
    const char *id, *name, *desc;
};

inline const vector<StrategyInfo>& strategyList() {
    static const vector<StrategyInfo> s = {
        {"mean_reversion", "Mean Reversion", "Buys when price falls more than k standard deviations below its moving average; exits at the mean."},
        {"momentum", "Momentum Trading", "Holds while the n-bar rate of change and the trend filter are positive."},
        {"arbitrage", "Arbitrage", "Trades the price gap between two venues quoting the same asset; profits as the gap closes."},
        {"scalping", "Scalping", "Very short holds on EMA/RSI micro-trends with tight take-profit and stop-loss."},
        {"pair_trading", "Pair Trading", "Long/short a cointegrated pair when the spread z-score is stretched; exits on reversion."},
        {"breakout", "Breakout Strategy", "Donchian channel: buys a new n-bar high, exits on a break of the shorter-term low."},
        {"ma_crossover", "Moving Average Crossover", "Long while the fast moving average is above the slow one."},
        {"vwap", "VWAP Strategy", "Buys below rolling VWAP by a band and exits when price reclaims VWAP."}
    };
    return s;
}

namespace bt {

inline vector<double> sma(const vector<double>& x, int n) {
    vector<double> r(x.size(), NAN);
    double s = 0;

    for (size_t i = 0; i < x.size(); i++) {
        s += x[i];

        if (i >= (size_t)n)
            s -= x[i - n];

        if (i + 1 >= (size_t)n)
            r[i] = s / n;
    }

    return r;
}

inline vector<double> stdev(const vector<double>& x, int n) {
    vector<double> r(x.size(), NAN);

    for (size_t i = n - 1; i < x.size(); i++) {
        double m = 0;

        for (int k = 0; k < n; k++)
            m += x[i - k];

        m /= n;

        double v = 0;

        for (int k = 0; k < n; k++)
            v += (x[i - k] - m) * (x[i - k] - m);

        r[i] = sqrt(v / n);
    }

    return r;
}

inline vector<double> ema(const vector<double>& x, int n) {
    vector<double> r(x.size(), 0);
    double a = 2.0 / (n + 1);

    for (size_t i = 0; i < x.size(); i++)
        r[i] = i ? a * x[i] + (1 - a) * r[i - 1] : x[i];

    return r;
}

inline vector<double> rsi(const vector<double>& x, int n) {
    vector<double> r(x.size(), 50);
    double g = 0, l = 0;

    for (size_t i = 1; i < x.size(); i++) {
        double d = x[i] - x[i - 1];
        double up = d > 0 ? d : 0;
        double dn = d < 0 ? -d : 0;

        if ((int)i <= n) {
            g += up / n;
            l += dn / n;
        } else {
            g = (g * (n - 1) + up) / n;
            l = (l * (n - 1) + dn) / n;
        }

        r[i] = l < 1e-12 ? 100 : 100 - 100 / (1 + g / l);
    }

    return r;
}

inline vector<Bar> synth(int n, double start, double dailyVol, uint64_t seed) {
    mt19937_64 g(seed);
    normal_distribution<double> N(0, 1);

    vector<Bar> b;
    double p = start, drift = 0;
    int regime = 0;

    for (int i = 0; i < n; i++) {
        if (i % 120 == 0) {
            regime = (int)(g() % 3);
            drift = regime == 0 ? 0.0004 : regime == 1 ? -0.0003 : 0.0;
        }

        double r = drift + dailyVol * N(g) - 0.01 * log(p / start) * 0.1;
        double o = p;
        p *= exp(r);

        Bar x;
        x.t = i;
        x.o = o;
        x.c = p;
        x.h = max(o, p) * (1 + fabs(N(g)) * dailyVol * 0.3);
        x.l = min(o, p) * (1 - fabs(N(g)) * dailyVol * 0.3);
        x.v = 1e5 * (1 + 0.5 * fabs(N(g)));

        b.push_back(x);
    }

    return b;
}

struct Result {
    vector<int> pos;
    vector<double> ret;
};

// Returns desired position (-1,0,1) per bar plus the per-bar return series the position earns.
inline Result run(const string& id, const vector<Bar>& bars, const Json& P, uint64_t seed) {
    size_t n = bars.size();

    vector<double> c(n), h(n), l(n), v(n);

    for (size_t i = 0; i < n; i++) {
        c[i] = bars[i].c;
        h[i] = bars[i].h;
        l[i] = bars[i].l;
        v[i] = bars[i].v;
    }

    Result R;
    R.pos.assign(n, 0);
    R.ret.assign(n, 0);

    for (size_t i = 1; i < n; i++)
        R.ret[i] = c[i] / c[i - 1] - 1;

    auto pi = [&](const char* k, double d) {
        return (int)P.at(k).num(d);
    };

    auto pd = [&](const char* k, double d) {
        return P.at(k).num(d);
    };

    int cur = 0;

    if (id == "mean_reversion") {
        int w = pi("window", 20);
        double k = pd("k", 1.5);

        auto m = sma(c, w);
        auto s = stdev(c, w);

        for (size_t i = w; i < n; i++) {
            double z = (c[i] - m[i]) / (s[i] + 1e-12);

            if (cur == 0 && z < -k)
                cur = 1;
            else if (cur == 1 && z > -0.2)
                cur = 0;

            R.pos[i] = cur;
        }
    }
    else if (id == "momentum") {
        int w = pi("lookback", 20);
        int t = pi("trend", 50);
        double th = pd("threshold", 0.0);

        auto m = sma(c, t);

        for (size_t i = max(w, t); i < n; i++) {
            double roc = c[i] / c[i - w] - 1;
            cur = (roc > th && c[i] > m[i]) ? 1 : 0;
            R.pos[i] = cur;
        }
    }
    else if (id == "ma_crossover") {
        int f = pi("fast", 10);
        int s = pi("slow", 30);

        auto a = sma(c, f);
        auto b = sma(c, s);

        for (size_t i = s; i < n; i++)
            R.pos[i] = a[i] > b[i] ? 1 : 0;
    }
    else if (id == "breakout") {
        int w = pi("window", 20);
        int ex = max(2, w / 2);

        for (size_t i = w; i < n; i++) {
            double hi = -1e18, lo = 1e18;

            for (int k = 1; k <= w; k++)
                hi = max(hi, h[i - k]);

            for (int k = 1; k <= ex; k++)
                lo = min(lo, l[i - k]);

            if (cur == 0 && c[i] > hi)
                cur = 1;
            else if (cur == 1 && c[i] < lo)
                cur = 0;

            R.pos[i] = cur;
        }
    }
    else if (id == "vwap") {
        int w = pi("window", 50);
        double band = pd("band", 0.002);

        for (size_t i = w; i < n; i++) {
            double pv = 0, vv = 0;

            for (int k = 0; k < w; k++) {
                double tp = (h[i - k] + l[i - k] + c[i - k]) / 3;
                pv += tp * v[i - k];
                vv += v[i - k];
            }

            double vw = pv / vv;

            if (cur == 0 && c[i] < vw * (1 - band))
                cur = 1;
            else if (cur == 1 && c[i] >= vw)
                cur = 0;

            R.pos[i] = cur;
        }
    }
    else if (id == "scalping") {
        auto e = ema(c, 5);
        auto r = rsi(c, 7);

        double tp = pd("take_profit", 0.003);
        double sl = pd("stop_loss", 0.002);
        int maxHold = pi("max_hold", 4);
        int held = 0;
        double entry = 0;

        for (size_t i = 8; i < n; i++) {
            if (cur == 0 && c[i] > e[i] && e[i] > e[i - 1] &&
                r[i] > 50 && r[i] < 70) {
                cur = 1;
                entry = c[i];
                held = 0;
            }
            else if (cur == 1) {
                held++;
                double pnl = c[i] / entry - 1;

                if (pnl >= tp || pnl <= -sl || held >= maxHold)
                    cur = 0;
            }

            R.pos[i] = cur;
        }
    }
    else {
        // Pair trading and arbitrage: trade a spread between asset A and a second leg B.
        mt19937_64 g(seed ^ 0x9e3779b97f4a7c15ULL);
        normal_distribution<double> N(0, 1);

        vector<double> lb(n), sp(n);
        double ou = 0;
        bool arb = id == "arbitrage";

        double kappa = arb ? 0.35 : 0.08;
        double sg = arb ? 0.0012 : 0.006;
        double beta = pd("beta", 1.0);

        for (size_t i = 0; i < n; i++) {
            ou += -kappa * ou + sg * N(g);
            lb[i] = beta * log(c[i]) - ou;
            sp[i] = log(c[i]) - (arb ? 1.0 : beta) *
                    lb[i] / (arb ? 1.0 : 1.0);
        }

        int w = pi("window", arb ? 10 : 40);
        double ent = pd("entry_z", arb ? 1.5 : 2.0);
        double ext = pd("exit_z", 0.3);

        auto m = sma(sp, w);
        auto s = stdev(sp, w);

        for (size_t i = 1; i < n; i++)
            R.ret[i] = (sp[i] - sp[i - 1]) * (arb ? 1.0 : 1.0);

        for (size_t i = w; i < n; i++) {
            double z = (sp[i] - m[i]) / (s[i] + 1e-12);

            if (cur == 0) {
                if (z > ent)
                    cur = -1;
                else if (z < -ent)
                    cur = 1;
            }
            else if (fabs(z) < ext ||
                     (cur == 1 && z > ent * 1.8) ||
                     (cur == -1 && z < -ent * 1.8)) {
                cur = 0;
            }

            R.pos[i] = cur;
        }
    }

    return R;
}

inline Json backtest(const string& id, const vector<Bar>& bars,
                     const Json& P, double capital, double feeBps,
                     double slipBps, double perYear, uint64_t seed) {
    size_t n = bars.size();
    Json out = Json::object();

    if (n < 60) {
        out["error"] = "Need at least 60 bars";
        return out;
    }

    Result R = run(id, bars, P, seed);

    double cost = (feeBps + slipBps) / 10000.0;
    vector<double> eq(n, capital), rets(n, 0);

    int prev = 0;
    int64_t entryI = 0;
    double entryEq = capital;
    double legRet = 0;

    Json trades = Json::array();
    vector<double> tp;

    double gp = 0, gl = 0;
    int wins = 0, nt = 0, inMkt = 0;

    for (size_t i = 1; i < n; i++) {
        int pp = R.pos[i - 1];
        double r = pp * R.ret[i];

        if (pp != 0) {
            inMkt++;
            legRet += r;
        }

        int want = R.pos[i - 1];
        double fee = 0;

        if (want != prev)
            fee = cost * abs(want - prev);

        rets[i] = r - fee;
        eq[i] = eq[i - 1] * (1 + rets[i]);

        if (want != prev) {
            if (prev != 0) {
                double pnl = eq[i] / entryEq - 1;

                Json t = Json::object();
                t["entry_bar"] = entryI;
                t["exit_bar"] = i;
                t["side"] = prev > 0 ? "long" : "short";
                t["entry_price"] = bars[entryI].c;
                t["exit_price"] = bars[i].c;
                t["pnl_pct"] = pnl * 100;
                t["bars"] = (int64_t)i - entryI;

                trades.push(t);
                nt++;

                if (pnl > 0) {
                    wins++;
                    gp += pnl;
                } else {
                    gl += -pnl;
                }
            }

            if (want != 0) {
                entryI = i;
                entryEq = eq[i - 1];
                legRet = 0;
            }
        }

        prev = want;
    }

    if (prev != 0) {
        double pnl = eq[n - 1] / entryEq - 1;
        nt++;

        if (pnl > 0) {
            wins++;
            gp += pnl;
        } else {
            gl += -pnl;
        }

        Json t = Json::object();
        t["entry_bar"] = entryI;
        t["exit_bar"] = n - 1;
        t["side"] = prev > 0 ? "long" : "short";
        t["entry_price"] = bars[entryI].c;
        t["exit_price"] = bars[n - 1].c;
        t["pnl_pct"] = pnl * 100;
        t["bars"] = (int64_t)(n - 1) - entryI;
        t["open"] = true;

        trades.push(t);
    }

    double mu = 0, sd = 0;

    for (size_t i = 1; i < n; i++)
        mu += rets[i];

    mu /= (n - 1);

    for (size_t i = 1; i < n; i++)
        sd += (rets[i] - mu) * (rets[i] - mu);

    sd = sqrt(sd / (n - 1));

    double pk = eq[0], dd = 0;
    Json curve = Json::array(), ddc = Json::array();
    size_t step = n > 600 ? n / 600 : 1;

    for (size_t i = 0; i < n; i++) {
        pk = max(pk, eq[i]);
        double d = 1 - eq[i] / pk;
        dd = max(dd, d);

        if (i % step == 0 || i == n - 1) {
            curve.push(eq[i]);
            ddc.push(-d * 100);
        }
    }

    Json pos = Json::array();

    for (size_t i = 0; i < n; i += step)
        pos.push(R.pos[i]);

    out["strategy"] = id;
    out["bars"] = n;
    out["capital"] = capital;
    out["final_equity"] = eq[n - 1];
    out["net_profit"] = eq[n - 1] - capital;
    out["roi_pct"] = (eq[n - 1] / capital - 1) * 100;
    out["buy_hold_pct"] = (bars[n - 1].c / bars[0].c - 1) * 100;
    out["sharpe"] = sd > 1e-12 ? mu / sd * sqrt(perYear) : 0;
    out["max_drawdown_pct"] = dd * 100;
    out["trades_count"] = nt;
    out["win_rate"] = nt ? 100.0 * wins / nt : 0;
    out["profit_factor"] = gl > 1e-12 ? gp / gl : (gp > 0 ? 99.0 : 0);
    out["exposure_pct"] = 100.0 * inMkt / n;
    out["avg_trade_pct"] = nt ? (gp - gl) / nt * 100 : 0;
    out["equity_curve"] = curve;
    out["drawdown_curve"] = ddc;
    out["positions"] = pos;
    out["trades"] = trades;
    out["step"] = (int64_t)step;

    Json cl = Json::array();

    // OHLC candles, step bars aggregated per candle (for the replay chart).
    for (size_t i = 0; i < n; i += step) {
        size_t e = min(n, i + step);
        double hi = bars[i].h, lo = bars[i].l;

        for (size_t k = i; k < e; k++) {
            hi = max(hi, bars[k].h);
            lo = min(lo, bars[k].l);
        }

        Json c = Json::array();
        c.push(bars[i].o);
        c.push(hi);
        c.push(lo);
        c.push(bars[e - 1].c);
        cl.push(c);
    }

    out["ohlc"] = cl;
    return out;
}

}
}
