
#pragma once
// Application wiring: services, engine/feed hooks, persistence and every REST endpoint.

#include <fstream>
#include <sstream>
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "../auth/auth.hpp"
#include "../market_feed/market_feed.hpp"
#include "../matching_engine/matching_engine.hpp"
#include "../portfolio/portfolio.hpp"
#include "../risk_manager/risk_manager.hpp"
#include "../strategies/strategies.hpp"
#include "../utils/latency_monitor.hpp"
#include "../websocket/ws_hub.hpp"
#include "ai_assistant.hpp"
#include "http_server.hpp"

using namespace std;

namespace qt {

struct Fill {
    int64_t ts = 0;
    uint64_t user = 0, order = 0;
    string symbol, side;
    double qty = 0, price = 0, fee = 0;
};

struct App {
    bool dev;
    string dataDir;
    int64_t startedAt = nowMs();
    double startCash = 1000000;

    MarketFeed feed;
    RiskManager risk;
    Portfolio pf;
    MatchingEngine engine;
    AuthService auth;
    WsHub hub;
    AiAssistant ai;
    HttpServer http;

    mutex fm;
    deque<Fill> fills;
    mutex lm;
    map<string, pair<int, int64_t>> loginFails;
    atomic<uint64_t> feedBatches{0};

    App(bool devMode, const string& dir, const string& secret)
        : dev(devMode),
          dataDir(dir),
          engine(risk, pf),
          auth(secret),
          ai(feed) {}

    string storePath() const {
        return dataDir + "/store.json";
    }

    void save() {
        Json j = Json::object();
        j["auth"] = auth.toJson();
        j["portfolio"] = pf.toJson();

        string tmp = storePath() + ".tmp";

        {
            ofstream f(tmp, ios::binary);
            f << j.dump();
        }

        remove(storePath().c_str());
        rename(tmp.c_str(), storePath().c_str());
    }

    bool load() {
        ifstream f(storePath(), ios::binary);
        if (!f) return false;

        ostringstream ss;
        ss << f.rdbuf();

        bool ok;
        Json j = Json::parse(ss.str(), &ok);

        if (!ok) {
            logw("store.json is corrupt - starting fresh");
            return false;
        }

        auth.fromJson(j.at("auth"));
        pf.fromJson(j.at("portfolio"));

        logi("Loaded " + to_string(auth.all().size()) +
             " users from " + storePath());

        return true;
    }

    void seed() {
        string ap = getenvOr("QT_ADMIN_PASSWORD", "Admin@12345");

        uint64_t a = auth.create(
            "Platform Admin",
            "admin@quantumtrade.local",
            "9000000001",
            ap,
            "admin",
            true
        );

        if (a) {
            pf.open(a, 0);
        }

        uint64_t d = auth.create(
            "Demo Trader",
            "demo@quantumtrade.local",
            "9000000002",
            "Demo@12345",
            "user",
            true
        );

        if (d) {
            auth.update(d, [](User& u) {
                u.kyc = "verified";
                u.watch = {
                    "RELIANCE",
                    "TCS",
                    "HDFCBANK",
                    "BTC-INR"
                };
            });

            pf.open(d, startCash);

            const struct {
                const char* s;
                double q;
            } h[] = {
                {"RELIANCE", 100},
                {"TCS", 40},
                {"HDFCBANK", 150},
                {"INFY", 100},
                {"SUNPHARMA", 60}
            };

            for (auto& x : h) {
                pf.applyFill(
                    d,
                    Side::Buy,
                    x.s,
                    x.q,
                    feed.last(x.s) * (0.96 + uni(0, 0.03)),
                    nowMs()
                );
            }
        }

        if (a || d) {
            logi(
                "Seeded demo accounts: admin@quantumtrade.local / "
                "demo@quantumtrade.local (see README for passwords)"
            );
        }
    }

    void wire() {
        for (auto& d : symbolDefs()) {
            if (!d.index) {
                engine.addSymbol(
                    d.sym,
                    d.tick,
                    d.liq,
                    d.crypto ? 10 : 6,
                    feed.last(d.sym)
                );
            }
        }

        engine.hooks.onTrade = [this](const Trade& t) {
            Json pub = Json::object();

            pub["t"] = "trade";
            pub["s"] = t.symbol;
            pub["p"] = t.price;
            pub["q"] = t.qty;
            pub["ts"] = t.ts;
            pub["side"] = toS(t.aggressor);

            hub.publish("trades:" + t.symbol, pub);

            for (int k = 0; k < 2; k++) {
                uint64_t u = k == 0 ? t.buyUser : t.sellUser;

                if (!u) continue;

                Side sd = k == 0 ? Side::Buy : Side::Sell;

                double fee = pf.applyFill(
                    u, sd, t.symbol, t.qty, t.price, t.ts
                );

                {
                    lock_guard<mutex> g(fm);

                    fills.push_back({
                        t.ts,
                        u,
                        k == 0 ? t.buyOrder : t.sellOrder,
                        t.symbol,
                        toS(sd),
                        t.qty,
                        t.price,
                        fee
                    });

                    if (fills.size() > 20000) {
                        fills.pop_front();
                    }
                }

                Json m = Json::object();

                m["t"] = "fill";
                m["symbol"] = t.symbol;
                m["side"] = toS(sd);
                m["qty"] = t.qty;
                m["price"] = t.price;
                m["fee"] = fee;
                m["order"] = k == 0 ? t.buyOrder : t.sellOrder;

                hub.publishUser(u, m);
            }
        };

        engine.hooks.onOrder = [this](const Order& o) {
            Json m = Json::object();

            m["t"] = "order";
            m["order"] = o.toJson();

            hub.publishUser(o.user, m);
        };

        engine.hooks.onBook = [this](const string& s, double) {
            if (hub.hasSubscribers("depth:" + s)) {
                Json d = engine.depthInEngineThread(s, 12);
                d["t"] = "depth";

                hub.publish("depth:" + s, d);
            }
        };

        feed.onTick = [this](const string& s, double p) {
            engine.onTick(s, p);

            for (auto& a : auth.checkAlerts(s, p)) {
                Json m = Json::object();

                m["t"] = "alert";
                m["message"] = a.second;

                hub.publishUser(a.first, m);
            }
        };

        feed.onCandle = [this](const string& s, const Candle& c) {
            if (!hub.hasSubscribers("chart:" + s)) return;

            Json m = Json::object();
            Json k = Json::object();

            m["t"] = "candle";
            m["s"] = s;

            k["t"] = c.t;
            k["o"] = c.o;
            k["h"] = c.h;
            k["l"] = c.l;
            k["c"] = c.c;
            k["v"] = c.v;

            m["k"] = k;

            hub.publish("chart:" + s, m);
        };

        feed.onBatch = [this](const vector<Quote>& qs) {
            Json m = Json::object();
            Json arr = Json::array();

            m["t"] = "ticks";

            for (auto& q : qs) {
                Json x = Json::object();

                x["s"] = q.sym;
                x["p"] = q.last;
                x["c"] = q.prev > 0
                    ? (q.last / q.prev - 1) * 100
                    : 0;
                x["v"] = q.vol;

                arr.push(x);
            }

            m["d"] = arr;
            hub.publish("ticks", m);

            if (feedBatches++ % 10 == 0) {
                pf.sampleEquity(
                    [this](const string& s) {
                        return feed.last(s);
                    },
                    nowMs()
                );
            }
        };

        feed.onNews = [this](const News& n) {
            Json m = Json::object();

            m["t"] = "news";
            m["headline"] = n.headline;
            m["symbol"] = n.sym;
            m["sentiment"] = n.sentiment;
            m["ts"] = n.ts;

            hub.publish("news", m);

            if (!n.sym.empty()) {
                for (auto& u : auth.all()) {
                    if (find(
                        u.watch.begin(),
                        u.watch.end(),
                        n.sym
                    ) != u.watch.end()) {
                        Json a = Json::object();

                        a["t"] = "alert";
                        a["message"] = "Watchlist news: " + n.headline;

                        hub.publishUser(u.id, a);
                    }
                }
            }
        };

        hub.allowTopic = [](
            const string& t,
            uint64_t,
            const string&
        ) {
            if (t == "ticks" || t == "news") {
                return true;
            }

            size_t c = t.find(':');

            if (c == string::npos) {
                return false;
            }

            string p = t.substr(0, c);
            string s = t.substr(c + 1);

            if (p != "chart" && p != "depth" && p != "trades") {
                return false;
            }

            for (auto& d : symbolDefs()) {
                if (s == d.sym) return true;
            }

            return false;
        };

        http.onUpgrade = [this](sock_t s, Request& q) {
            uint64_t uid = 0;
            string role;

            auto it = q.query.find("token");

            if (it != q.query.end() &&
                !auth.verify(it->second, uid, role)) {
                uid = 0;
            }

            hub.serve(s, q, uid);
        };
    }

    void registerRoutes();
};

inline Json quoteJson(const Quote& q) {
    Json j = Json::object();

    j["symbol"] = q.sym;
    j["name"] = q.name;
    j["sector"] = q.sector;
    j["last"] = q.last;
    j["prev_close"] = q.prev;
    j["change"] = q.last - q.prev;
    j["change_pct"] = q.prev > 0
        ? (q.last / q.prev - 1) * 100
        : 0;

    j["high"] = q.high;
    j["low"] = q.low;
    j["volume"] = q.vol;
    j["market_cap_cr"] = q.cap;
    j["crypto"] = q.crypto;
    j["index"] = q.index;

    return j;
}

inline Json candleJson(const vector<Candle>& cs) {
    Json a = Json::array();

    for (auto& c : cs) {
        Json x = Json::array();

        x.push(c.t);
        x.push(c.o);
        x.push(c.h);
        x.push(c.l);
        x.push(c.c);
        x.push(c.v);

        a.push(x);
    }

    return a;
}

inline void App::registerRoutes() {
    App& A = *this;
    HttpServer& H = http;

    auto body = [](
        Request& q,
        Response& r,
        Json& out
    ) {
        bool ok;

        out = Json::parse(
            q.body.empty() ? "{}" : q.body,
            &ok
        );

        if (!ok || !out.isObj()) {
            r.error(400, "Invalid JSON body");
            return false;
        }

        return true;
    };

    auto authed = [&A](
        Request& q,
        Response& r,
        bool admin = false
    ) {
        string a = q.header("authorization");

        if (a.rfind("Bearer ", 0) != 0) {
            r.error(401, "Authentication required");
            return false;
        }

        uint64_t uid;
        string role;

        if (!A.auth.verify(a.substr(7), uid, role) || role == "2fa") {
            r.error(401, "Invalid or expired token");
            return false;
        }

        auto u = A.auth.get(uid);

        if (!u) {
            r.error(401, "Unknown user");
            return false;
        }

        if (u->frozen) {
            r.error(
                403,
                "Your account is frozen. Please contact support."
            );
            return false;
        }

        q.uid = uid;
        q.role = u->role;

        if (admin && u->role != "admin") {
            r.error(403, "Admin access required");
            return false;
        }

        return true;
    };

    auto tokenJson = [&A](const User& u) {
        Json j = Json::object();

        j["token"] = A.auth.issue(u.id, u.role);
        j["user"] = u.pub();

        return j;
    };

    auto device = [](Request& q) {
        string ua = q.header("user-agent");

        return ua.size() > 120
            ? ua.substr(0, 120)
            : ua;
    };

    auto sendOtp = [&A](
        const string& purpose,
        const string& email,
        Json& out
    ) {
        string c = A.auth.newOtp(purpose + ":" + lower(email));

        logi(
            "[OTP] " + purpose + " code for " + email +
            ": " + c +
            " (delivered by console in this build)"
        );

        // Demo mode shows only sign-up verification codes. Password-reset
        // codes are never returned, otherwise anyone could reset any account.
        if (A.dev && purpose == "verify") {
            out["dev_otp"] = c;
        }
    };

    H.route("GET", "/api/health", [&A](Request&, Response& r) {
        Json j = Json::object();

        j["status"] = "ok";
        j["uptime_s"] = (nowMs() - A.startedAt) / 1000;
        j["engine"] = A.engine.isRunning();
        j["ws_clients"] = A.hub.clientCount();
        j["dev_mode"] = A.dev;
        j["order_ack_latency"] = A.engine.ackLatency.toJson();
        j["match_latency"] = A.engine.matchLatency.toJson();
        j["trades"] = A.engine.tradeCount.load();
        j["queue_depth"] = A.engine.queueDepth();

        r.json(j);
    });

    // ---------- auth ----------

    H.route("POST", "/api/auth/register", [&, body, sendOtp](Request& q, Response& r) {
        Json b;
        if (!body(q, r, b)) return;

        string name = b.at("name").str();
        string email = lower(b.at("email").str());
        string pw = b.at("password").str();
        string phone = b.at("phone").str();

        if (name.size() < 2 || name.size() > 60)
            return r.error(400, "Please enter your name");

        if (!AuthService::validEmail(email))
            return r.error(400, "Please enter a valid email address");

        string pe = AuthService::checkPasswordStrength(pw);

        if (!pe.empty()) return r.error(400, pe);

        if (b.has("confirm") && b.at("confirm").str() != pw)
            return r.error(400, "Passwords do not match");

        if (!b.at("accept_terms").boolean())
            return r.error(400, "Please accept the Privacy Policy and Terms");

        uint64_t id = A.auth.create(
            name, email, phone, pw, "user", false
        );

        if (!id)
            return r.error(409, "An account with this email already exists");

        A.pf.open(id, A.startCash);

        Json o = Json::object();
        o["ok"] = true;
        o["need_verification"] = true;

        sendOtp("verify", email, o);

        r.json(o, 201);
    });

    H.route("POST", "/api/auth/verify-otp", [&, body, tokenJson, device](Request& q, Response& r) {
        Json b;
        if (!body(q, r, b)) return;

        string email = lower(b.at("email").str());

        if (!A.auth.checkOtp("verify:" + email, b.at("code").str()))
            return r.error(400, "Invalid or expired code");

        auto u = A.auth.find(email);

        if (!u) return r.error(400, "Unknown account");

        A.auth.update(u->id, [](User& x) {
            x.verified = true;
        });

        A.auth.addHistory(u->id, q.ip, device(q), "signup+verified");

        r.json(tokenJson(*A.auth.get(u->id)));
    });

    H.route("POST", "/api/auth/resend-otp", [&, body, sendOtp](Request& q, Response& r) {
        Json b;
        if (!body(q, r, b)) return;

        Json o = Json::object();
        o["ok"] = true;

        auto u = A.auth.find(b.at("email").str());

        if (u && !u->verified) {
            sendOtp("verify", u->email, o);
        }

        r.json(o);
    });

    H.route("POST", "/api/auth/login", [&, body, tokenJson, device, sendOtp](Request& q, Response& r) {
        Json b;
        if (!body(q, r, b)) return;

        string email = lower(b.at("email").str());
        string key = q.ip + "|" + email;
        int64_t now = nowMs();

        {
            lock_guard<mutex> g(A.lm);
            auto& f = A.loginFails[key];

            if (f.first >= 5 && now - f.second < 300000) {
                return r.error(
                    429,
                    "Too many failed attempts. Try again in 5 minutes."
                );
            }

            if (now - f.second >= 300000) {
                f.first = 0;
            }
        }

        auto u = A.auth.find(email);

        bool ok = u &&
            AuthService::verifyPassword(b.at("password").str(), u->pass);

        if (!ok) {
            {
                lock_guard<mutex> g(A.lm);
                auto& f = A.loginFails[key];
                f.first++;
                f.second = now;
            }

            if (u) {
                A.auth.addHistory(u->id, q.ip, device(q), "failed");
            }

            return r.error(401, "Incorrect email or password");
        }

        {
            lock_guard<mutex> g(A.lm);
            A.loginFails.erase(key);
        }

        if (u->frozen) {
            return r.error(
                403,
                "Your account is frozen. Please contact support."
            );
        }

        if (!u->verified) {
            Json o = Json::object();

            o["error"] = "Please verify your email with the code we sent";
            o["need_verification"] = true;

            sendOtp("verify", u->email, o);

            return r.json(o, 403);
        }

        if (u->totpOn) {
            Json o = Json::object();

            o["need_2fa"] = true;
            o["ticket"] = A.auth.issue(u->id, "2fa", 300);

            return r.json(o);
        }

        A.auth.addHistory(u->id, q.ip, device(q), "success");

        r.json(tokenJson(*u));
    });

    H.route("POST", "/api/auth/login/2fa", [&, body, tokenJson, device](Request& q, Response& r) {
        Json b;
        if (!body(q, r, b)) return;

        uint64_t uid;
        string role;

        if (!A.auth.verify(b.at("ticket").str(), uid, role) || role != "2fa") {
            return r.error(401, "Session expired, please log in again");
        }

        auto u = A.auth.get(uid);

        if (!u || !crypto::totpVerify(u->totpSecret, b.at("code").str())) {
            if (u) {
                A.auth.addHistory(uid, q.ip, device(q), "2fa failed");
            }

            return r.error(401, "Invalid authenticator code");
        }

        A.auth.addHistory(uid, q.ip, device(q), "success (2FA)");

        r.json(tokenJson(*u));
    });

    H.route("POST", "/api/auth/forgot", [&, body, sendOtp](Request& q, Response& r) {
        Json b;
        if (!body(q, r, b)) return;

        Json o = Json::object();

        o["ok"] = true;
        o["message"] = "If the account exists, a reset code has been sent.";

        if (A.auth.find(b.at("email").str())) {
            sendOtp("reset", b.at("email").str(), o);
        }

        r.json(o);
    });

    H.route("POST", "/api/auth/reset", [&, body](Request& q, Response& r) {
        Json b;
        if (!body(q, r, b)) return;

        string email = lower(b.at("email").str());
        string pe = AuthService::checkPasswordStrength(b.at("password").str());

        if (!pe.empty()) return r.error(400, pe);

        if (!A.auth.checkOtp("reset:" + email, b.at("code").str())) {
            return r.error(400, "Invalid or expired code");
        }

        auto u = A.auth.find(email);

        if (!u) return r.error(400, "Unknown account");

        string h = A.auth.hashPassword(b.at("password").str());

        A.auth.update(u->id, [&](User& x) {
            x.pass = h;
            x.verified = true;
        });

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    H.route("POST", "/api/auth/oauth/google", [&, body, tokenJson, device](Request& q, Response& r) {
        if (!A.dev) {
            return r.error(
                501,
                "Google OAuth requires client credentials and HTTPS. "
                "Set QT_DEV_MODE=1 for the demo flow, or terminate TLS "
                "at the reverse proxy and verify the ID token."
            );
        }

        Json b;
        if (!body(q, r, b)) return;

        string email = lower(
            b.at("email").str("google.demo@quantumtrade.local")
        );

        auto u = A.auth.find(email);

                // The demo sign-in may only create or reuse demo-Google accounts,
        // never an account that has a real password (admin, demo, ...).
        if (u && u->phone != "google-demo") {
            return r.error(
                403,
                "This email belongs to a password account. "
                "Please log in with your password."
            );
        }

        if (!u) {
            uint64_t id = A.auth.create(
                b.at("name").str("Google User"),
                email,
                "",
                "Oauth!" + crypto::randomHex(8),
                "user",
                true
            );

            A.pf.open(id, A.startCash);
            u = A.auth.get(id);
        }

        A.auth.addHistory(u->id, q.ip, device(q), "success (Google demo)");

        r.json(tokenJson(*u));
    });

    H.route("GET", "/api/me", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        r.json(A.auth.get(q.uid)->pub());
    });

    H.route("POST", "/api/me/settings", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        string ai = b.at("ai_name").str();
        string lang = b.at("lang").str();
        string name = b.at("name").str();

        if (!ai.empty() && ai != "Bramha" && ai != "Sars") {
            return r.error(400, "AI name must be Bramha or Sars");
        }

        if (!lang.empty() && lang != "en" && lang != "hi" && lang != "mr") {
            return r.error(400, "Unsupported language");
        }

        A.auth.update(q.uid, [&](User& u) {
            if (!ai.empty()) u.aiName = ai;
            if (!lang.empty()) u.lang = lang;

            if (name.size() >= 2 && name.size() <= 60) {
                u.name = name;
            }
        });

        r.json(A.auth.get(q.uid)->pub());
    });

    H.route("GET", "/api/me/history", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json a = Json::array();
        auto u = A.auth.get(q.uid);

        for (auto i = u->history.rbegin(); i != u->history.rend(); ++i) {
            Json x = Json::object();

            x["ts"] = i->ts;
            x["ip"] = i->ip;
            x["device"] = i->device;
            x["result"] = i->result;

            a.push(x);
        }

        r.json(a);
    });

    H.route("POST", "/api/auth/2fa/setup", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        string sec = crypto::randomBase32(16);

        A.auth.update(q.uid, [&](User& u) {
            u.totpSecret = sec;
            u.totpOn = false;
        });

        auto u = A.auth.get(q.uid);

        Json o = Json::object();

        o["secret"] = sec;
        o["uri"] = "otpauth://totp/QuantumTrade:" + u->email +
                   "?secret=" + sec + "&issuer=QuantumTrade";

        r.json(o);
    });

    H.route("POST", "/api/auth/2fa/enable", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        auto u = A.auth.get(q.uid);

        if (u->totpSecret.empty() ||
            !crypto::totpVerify(u->totpSecret, b.at("code").str())) {
            return r.error(400, "Invalid authenticator code");
        }

        A.auth.update(q.uid, [](User& x) {
            x.totpOn = true;
        });

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    H.route("POST", "/api/auth/2fa/disable", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        auto u = A.auth.get(q.uid);

        if (!AuthService::verifyPassword(b.at("password").str(), u->pass) ||
            !crypto::totpVerify(u->totpSecret, b.at("code").str())) {
            return r.error(400, "Password or code is incorrect");
        }

        A.auth.update(q.uid, [](User& x) {
            x.totpOn = false;
            x.totpSecret.clear();
        });

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    H.route("POST", "/api/kyc", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        string pan = upper(b.at("pan").str());
        bool ok = pan.size() == 10;

        for (size_t i = 0; ok && i < 10; i++) {
            ok = (i < 5 || i == 9)
                ? isalpha((unsigned char)pan[i]) != 0
                : isdigit((unsigned char)pan[i]) != 0;
        }

        if (!ok) return r.error(400, "PAN must look like ABCDE1234F");

        auto u = A.auth.get(q.uid);

        if (u->kyc == "verified") {
            return r.error(400, "KYC already verified");
        }

        A.auth.update(q.uid, [](User& x) {
            x.kyc = "pending";
        });

        Json o = Json::object();
        o["kyc"] = "pending";

        r.json(o);
    });

    // ---------- market data ----------

    H.route("GET", "/api/symbols", [&A](Request&, Response& r) {
        Json a = Json::array();

        for (auto& kv : A.feed.quotes()) {
            if (!kv.second.index) {
                a.push(quoteJson(kv.second));
            }
        }

        r.json(a);
    });

    H.route("GET", "/api/market/overview", [&A](Request&, Response& r) {
        Json a = Json::array();
        auto qs = A.feed.quotes();

        for (auto n : {
            "NIFTY50", "SENSEX", "NASDAQ",
            "DOWJONES", "BTC-INR", "ETH-INR"
        }) {
            if (qs.count(n)) {
                a.push(quoteJson(qs[n]));
            }
        }

        r.json(a);
    });

    H.route("GET", "/api/heatmap", [&A](Request&, Response& r) {
        Json a = Json::array();

        for (auto& kv : A.feed.quotes()) {
            if (!kv.second.index) {
                Json x = quoteJson(kv.second);

                if (kv.second.crypto) {
                    x["market_cap_cr"] =
                        kv.first == "BTC-INR" ? 1100000 : 330000;
                }

                a.push(x);
            }
        }

        r.json(a);
    });

    H.route("GET", "/api/candles", [&A](Request& q, Response& r) {
        string s = q.query["symbol"];

        size_t lim = (size_t)min(
            2000,
            max(
                10,
                atoi(q.query.count("limit")
                    ? q.query["limit"].c_str()
                    : "300")
            )
        );

        auto c = A.feed.candles(s, lim);

        if (c.empty()) return r.error(404, "Unknown symbol");

        r.json(candleJson(c));
    });

    H.route("GET", "/api/depth", [&A](Request& q, Response& r) {
        Json d = A.engine.depth(
            q.query["symbol"],
            min(
                25,
                max(
                    1,
                    atoi(q.query.count("levels")
                        ? q.query["levels"].c_str()
                        : "12")
                )
            )
        );

        if (!d.has("bids")) return r.error(404, "Unknown symbol");

        r.json(d);
    });

    H.route("GET", "/api/trades", [&A](Request& q, Response& r) {
        Json a = Json::array();

        for (auto& t : A.engine.tape(q.query["symbol"], 60)) {
            Json x = Json::object();

            x["price"] = t.price;
            x["qty"] = t.qty;
            x["ts"] = t.ts;
            x["side"] = toS(t.aggressor);

            a.push(x);
        }

        r.json(a);
    });

    H.route("GET", "/api/news", [&A](Request& q, Response& r) {
        Json a = Json::array();

        for (auto& n : A.feed.news(60, q.query["symbol"])) {
            Json x = Json::object();

            x["id"] = n.id;
            x["ts"] = n.ts;
            x["headline"] = n.headline;
            x["symbol"] = n.sym;
            x["category"] = n.category;
            x["source"] = n.source;
            x["sentiment"] = n.sentiment;

            a.push(x);
        }

        r.json(a);
    });

    H.route("GET", "/api/calendar", [](Request& q, Response& r) {
        Json all = MarketFeed::calendar();
        Json a = Json::array();

        string k = q.query["kind"];

        for (auto& e : all.a) {
            if (k.empty() || e.at("kind").str() == k) {
                a.push(e);
            }
        }

        r.json(a);
    });

    // ---------- trading ----------

    H.route("POST", "/api/orders", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        if (!A.risk.allowRate(q.uid)) {
            return r.error(429, "Order rate limit exceeded");
        }

        OrderRequest o;
        o.user = q.uid;
        o.symbol = upper(b.at("symbol").str());

        OType t;

        if (!parseType(lower(b.at("type").str("limit")), t)) {
            return r.error(400, "Unknown order type");
        }

        o.type = t;

        string sd = lower(b.at("side").str());

        if (sd != "buy" && sd != "sell") {
            return r.error(400, "Side must be buy or sell");
        }

        o.side = sd == "buy" ? Side::Buy : Side::Sell;

        o.qty = b.at("qty").num();
        o.price = b.at("price").num();
        o.stop = b.at("stop").num();
        o.display = b.at("display").num();
        o.tp = b.at("tp").num();
        o.sl = b.at("sl").num();
        o.trail = b.at("trail").num();

        SubmitResult s;

        try {
            s = A.engine.submit(o);
        } catch (const exception& e) {
            return r.error(503, "Engine busy");
        }

        Json j = Json::object();

        j["ok"] = s.ok;
        j["id"] = s.id;
        j["status"] = s.status;
        j["filled"] = s.filled;
        j["avg_price"] = s.avg;
        j["reason"] = s.reason;

        if (!s.ok) {
            j["error"] = s.reason;
            return r.json(j, 422);
        }

        r.json(j, 201);
    });

    H.route("POST", "/api/orders/cancel", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        string why;

        if (!A.engine.cancel(q.uid, (uint64_t)b.at("id").num(), why)) {
            return r.error(404, why);
        }

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    H.route("GET", "/api/orders", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json a = Json::array();

        for (auto& o : A.engine.ordersFor(q.uid, 80)) {
            a.push(o.toJson());
        }

        r.json(a);
    });

    H.route("GET", "/api/fills", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json a = Json::array();
        lock_guard<mutex> g(A.fm);

        for (auto i = A.fills.rbegin();
             i != A.fills.rend() && a.size() < 100;
             ++i) {
            if (i->user == q.uid) {
                Json x = Json::object();

                x["ts"] = i->ts;
                x["symbol"] = i->symbol;
                x["side"] = i->side;
                x["qty"] = i->qty;
                x["price"] = i->price;
                x["fee"] = i->fee;
                x["order"] = i->order;

                a.push(x);
            }
        }

        r.json(a);
    });

    // ---------- portfolio / wallet / watchlist ----------

    H.route("GET", "/api/portfolio", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json j = A.pf.snapshot(q.uid, A.feed.quotes());
        j["risk_limits"] = A.risk.toJson();

        r.json(j);
    });

    H.route("GET", "/api/portfolio/equity", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        r.json(A.pf.equityCurve(q.uid));
    });

    H.route("GET", "/api/portfolio/tax", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        r.json(A.pf.taxReport(q.uid));
    });

    H.route("GET", "/api/portfolio/dividends", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json snap = A.pf.snapshot(q.uid, A.feed.quotes());
        Json rows = Json::array();

        double total = 0;

        static const map<string, double> yield = {
            {"RELIANCE", 0.35},
            {"HDFCBANK", 1.1},
            {"ICICIBANK", 0.8},
            {"TCS", 1.6},
            {"INFY", 2.4},
            {"SUNPHARMA", 0.7},
            {"DRREDDY", 0.6},
            {"ITC", 3.1},
            {"HUL", 1.7},
            {"MARUTI", 0.8},
            {"TATAMOTORS", 0.3},
            {"TATASTEEL", 2.3},
            {"HINDALCO", 0.6},
            {"DLF", 0.5},
            {"ONGC", 4.4}
        };

        for (auto& p : snap.at("positions").a) {
            auto y = yield.find(p.at("symbol").str());

            if (y == yield.end()) continue;

            double dps = p.at("last").num() * y->second / 100 / 4;

            for (int k = 1; k <= 4; k++) {
                Json x = Json::object();

                x["symbol"] = p.at("symbol").str();
                x["date"] = isoDate(nowMs() - (int64_t)k * 91 * 86400000LL);
                x["dps"] = dps * (0.92 + 0.04 * k);
                x["amount"] = dps * (0.92 + 0.04 * k) * p.at("qty").num();

                total += x.at("amount").num();
                rows.push(x);
            }
        }

        Json o = Json::object();

        o["rows"] = rows;
        o["total_12m"] = total;
        o["note"] = "Illustrative sample dividend history based on indicative yields.";

        r.json(o);
    });

    H.route("GET", "/api/wallet", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        r.json(A.pf.txns(q.uid));
    });

    H.route("POST", "/api/wallet", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        string k = b.at("kind").str();
        string err;
        double amt = b.at("amount").num();

        if (k != "deposit" && k != "withdraw") {
            return r.error(400, "kind must be deposit or withdraw");
        }

        if (amt > 10000000) {
            return r.error(400, "Amount too large");
        }

        if (k == "withdraw" && A.auth.get(q.uid)->kyc != "verified") {
            return r.error(403, "Complete KYC verification before withdrawing");
        }

        if (!A.pf.wallet(q.uid, k, amt, err)) {
            return r.error(400, err);
        }

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    H.route("GET", "/api/watchlist", [&, authed](Request& q, Response& r) {
        if (!authed(q, r)) return;

        auto u = A.auth.get(q.uid);
        auto qs = A.feed.quotes();

        Json o = Json::object();
        Json a = Json::array();
        Json al = Json::array();

        for (auto& s : u->watch) {
            if (qs.count(s)) {
                a.push(quoteJson(qs[s]));
            }
        }

        for (auto& x : u->alerts) {
            Json y = Json::object();

            y["id"] = x.id;
            y["symbol"] = x.sym;
            y["price"] = x.price;
            y["direction"] = x.above ? "above" : "below";
            y["active"] = x.active;

            al.push(y);
        }

        o["symbols"] = a;
        o["alerts"] = al;

        r.json(o);
    });

    H.route("POST", "/api/watchlist", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        string s = upper(b.at("symbol").str());
        string act = b.at("action").str("add");

        Quote qq;

        if (!A.feed.quote(s, qq)) {
            return r.error(404, "Unknown symbol");
        }

        A.auth.update(q.uid, [&](User& u) {
            auto i = find(u.watch.begin(), u.watch.end(), s);

            if (act == "add" &&
                i == u.watch.end() &&
                u.watch.size() < 50) {
                u.watch.push_back(s);
            }

            if (act == "remove" && i != u.watch.end()) {
                u.watch.erase(i);
            }
        });

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    H.route("POST", "/api/alerts", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        string s = upper(b.at("symbol").str());
        Quote qq;

        if (!A.feed.quote(s, qq)) {
            return r.error(404, "Unknown symbol");
        }

        double p = b.at("price").num();

        if (!(p > 0)) {
            return r.error(400, "Price must be positive");
        }

        uint64_t id = A.auth.addAlert(
            q.uid,
            s,
            p,
            b.at("direction").str("above") != "below"
        );

        Json o = Json::object();
        o["id"] = id;

        r.json(o, 201);
    });

    H.route("POST", "/api/alerts/delete", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        uint64_t id = (uint64_t)b.at("id").num();

        A.auth.update(q.uid, [&](User& u) {
            u.alerts.erase(
                remove_if(
                    u.alerts.begin(),
                    u.alerts.end(),
                    [&](const Alert& a) {
                        return a.id == id;
                    }
                ),
                u.alerts.end()
            );
        });

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    // ---------- strategies, backtest, AI ----------

    H.route("GET", "/api/strategies", [](Request&, Response& r) {
        Json a = Json::array();

        for (auto& s : strategyList()) {
            Json x = Json::object();

            x["id"] = s.id;
            x["name"] = s.name;
            x["description"] = s.desc;

            a.push(x);
        }

        r.json(a);
    });

    H.route("POST", "/api/backtest", [&A, body](Request& q, Response& r) {
        Json b;
        if (!body(q, r, b)) return;

        string id = b.at("strategy").str();
        bool known = false;

        for (auto& s : strategyList()) {
            if (id == s.id) known = true;
        }

        if (!known) return r.error(400, "Unknown strategy");

        int n = (int)clampd(b.at("bars").num(1000), 100, 20000);

        double cap = clampd(b.at("capital").num(100000), 1000, 1e9);
        double fee = clampd(b.at("fee_bps").num(3), 0, 100);
        double slip = clampd(b.at("slippage_bps").num(2), 0, 100);
        double py = clampd(b.at("periods_per_year").num(252), 1, 100000);

        uint64_t seed = (uint64_t)b.at("seed").num(42);

        vector<Bar> bars;
        string src = "simulated";

        SymDef d{};
        string sym = upper(b.at("symbol").str("RELIANCE"));

        if (!A.feed.def(sym, d)) {
            return r.error(400, "Unknown symbol");
        }

        if (b.at("prices").isArr() && b.at("prices").size() >= 60) {
            src = "uploaded";

            size_t i = 0;

            for (auto& p : b.at("prices").a) {
                double c = p.num();

                if (!(c > 0)) {
                    return r.error(400, "Prices must be positive numbers");
                }

                Bar x;

                x.t = (int64_t)i++;
                x.o = x.c = c;
                x.h = c * 1.001;
                x.l = c * 0.999;
                x.v = 1e5;

                if (!bars.empty()) {
                    x.o = bars.back().c;
                    x.h = max(x.o, c) * 1.001;
                    x.l = min(x.o, c) * 0.999;
                }

                bars.push_back(x);

                if (bars.size() > 20000) break;
            }
        } else if (b.at("source").str() == "live") {
            src = "live feed (5s candles)";

            for (auto& c : A.feed.candles(sym, 3000)) {
                Bar x;

                x.t = c.t;
                x.o = c.o;
                x.h = c.h;
                x.l = c.l;
                x.c = c.c;
                x.v = c.v;

                bars.push_back(x);
            }
        } else {
            bars = bt::synth(n, d.base, d.vol, seed);
        }

        Json res = bt::backtest(
            id, bars, b.at("params"), cap, fee, slip, py, seed
        );

        res["data_source"] = src;
        res["symbol"] = sym;

        if (res.has("error")) {
            return r.json(res, 400);
        }

        r.json(res);
    });

    H.route("POST", "/api/ai/ask", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r)) return;

        Json b;
        if (!body(q, r, b)) return;

        string question = b.at("question").str();

        if (question.empty() || question.size() > 500) {
            return r.error(400, "Ask a question (max 500 characters)");
        }

        auto u = A.auth.get(q.uid);
        string lang = b.at("lang").str(u->lang);

        r.json(A.ai.answer(
            question,
            lang,
            u->aiName,
            A.pf.snapshot(q.uid, A.feed.quotes()),
            upper(b.at("symbol").str())
        ));
    });

    H.route("GET", "/api/ai/analysis", [&A](Request& q, Response& r) {
        Analysis a;
        string s = upper(q.query["symbol"]);

        if (!A.ai.analyze(s, a)) {
            return r.error(404, "No data for symbol");
        }

        r.json(A.ai.toJson(s, a));
    });

    // ---------- admin ----------

    H.route("GET", "/api/admin/overview", [&, authed](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        auto us = A.auth.all();

        int kycP = 0;
        int frozen = 0;
        int v = 0;

        for (auto& u : us) {
            if (u.kyc == "pending") kycP++;
            if (u.frozen) frozen++;
            if (u.verified) v++;
        }

        Json j = Json::object();

        j["users"] = us.size();
        j["verified_users"] = v;
        j["kyc_pending"] = kycP;
        j["frozen"] = frozen;
        j["trades"] = A.engine.tradeCount.load();
        j["platform_fees"] = A.pf.platformFees();
        j["fee_rate"] = A.pf.feeRate();
        j["ws_clients"] = A.hub.clientCount();
        j["halted"] = A.risk.halted.load();
        j["risk"] = A.risk.toJson();

        {
            lock_guard<mutex> g(A.fm);
            j["fills"] = A.fills.size();
        }

        r.json(j);
    });

    H.route("GET", "/api/admin/users", [&, authed](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        Json a = Json::array();
        auto qs = A.feed.quotes();

        for (auto& u : A.auth.all()) {
            Json x = u.pub();

            x["equity"] = A.pf.snapshot(u.id, qs).at("equity").num();

            a.push(x);
        }

        r.json(a);
    });

    H.route("POST", "/api/admin/users/kyc", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        Json b;
        if (!body(q, r, b)) return;

        string s = b.at("status").str();

        if (s != "verified" && s != "rejected" &&
            s != "pending" && s != "none") {
            return r.error(400, "Bad status");
        }

        if (!A.auth.update(
            (uint64_t)b.at("id").num(),
            [&](User& u) {
                u.kyc = s;
            }
        )) {
            return r.error(404, "No such user");
        }

        logi(
            "[ADMIN] KYC " + s + " for user " +
            to_string((uint64_t)b.at("id").num())
        );

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    H.route("POST", "/api/admin/users/freeze", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        Json b;
        if (!body(q, r, b)) return;

        uint64_t id = (uint64_t)b.at("id").num();

        if (id == q.uid) {
            return r.error(400, "You cannot freeze your own account");
        }

        bool fr = b.at("frozen").boolean(true);

        if (!A.auth.update(id, [&](User& u) {
            u.frozen = fr;
        })) {
            return r.error(404, "No such user");
        }

        logw(
            string("[ADMIN] user ") + to_string(id) +
            (fr ? " frozen" : " unfrozen")
        );

        Json o = Json::object();
        o["ok"] = true;

        r.json(o);
    });

    H.route("GET", "/api/admin/trades", [&, authed](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        Json a = Json::array();
        lock_guard<mutex> g(A.fm);

        for (auto i = A.fills.rbegin();
             i != A.fills.rend() && a.size() < 200;
             ++i) {
            Json x = Json::object();

            x["ts"] = i->ts;
            x["user"] = i->user;
            x["symbol"] = i->symbol;
            x["side"] = i->side;
            x["qty"] = i->qty;
            x["price"] = i->price;
            x["fee"] = i->fee;

            a.push(x);
        }

        r.json(a);
    });

    H.route("GET", "/api/admin/feed", [&, authed](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        Json j = A.feed.status();

        j["ws_clients"] = A.hub.clientCount();
        j["ws_sent"] = A.hub.sent.load();
        j["ws_dropped"] = A.hub.dropped.load();

        r.json(j);
    });

    H.route("GET", "/api/admin/revenue", [&, authed](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        map<int64_t, double> b;

        {
            lock_guard<mutex> g(A.fm);

            for (auto& f : A.fills) {
                b[f.ts / 60000 * 60000] += f.fee;
            }
        }

        Json a = Json::array();

        for (auto& kv : b) {
            Json x = Json::array();

            x.push(kv.first);
            x.push(kv.second);

            a.push(x);
        }

        Json o = Json::object();

        o["total"] = A.pf.platformFees();
        o["fee_rate"] = A.pf.feeRate();
        o["per_minute"] = a;

        r.json(o);
    });

    H.route("GET", "/api/admin/api-usage", [&, authed](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        r.json(A.http.stats());
    });

    H.route("GET", "/api/admin/logs", [&, authed](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        Json a = Json::array();

        for (auto& e : Logger::get().tail(200)) {
            Json x = Json::object();

            x["ts"] = e.ts;
            x["level"] = e.level;
            x["msg"] = e.msg;

            a.push(x);
        }

        r.json(a);
    });

    H.route("GET", "/api/admin/latency", [&, authed](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        Json j = Json::object();

        j["order_ack"] = A.engine.ackLatency.toJson();
        j["match"] = A.engine.matchLatency.toJson();
        j["http"] = A.http.latency.toJson();
        j["queue_depth"] = A.engine.queueDepth();
        j["pool_live"] = A.engine.poolLive();
        j["orders"] = A.engine.processed.load();

        r.json(j);
    });

    H.route("POST", "/api/admin/halt", [&, authed, body](Request& q, Response& r) {
        if (!authed(q, r, true)) return;

        Json b;
        if (!body(q, r, b)) return;

        A.risk.halted = b.at("halted").boolean(true);

        logw(
            string("[ADMIN] trading ") +
            (A.risk.halted ? "HALTED" : "resumed")
        );

        Json o = Json::object();
        o["halted"] = A.risk.halted.load();

        r.json(o);
    });
}

}
