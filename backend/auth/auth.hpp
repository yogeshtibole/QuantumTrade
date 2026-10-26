
#pragma once
// Users, PBKDF2 password hashing, JWT (HS256), OTP codes, TOTP 2FA, login/device history, watchlists, alerts.

#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <vector>
#include <string>
#include <cstdint>
#include <cstdlib>
#include <cctype>
#include <cstdio>
#include <utility>

#include "../utils/crypto.hpp"
#include "../utils/json.hpp"
#include "../utils/util.hpp"

using namespace std;

namespace qt {

struct LoginRec {
    int64_t ts = 0;
    string ip, device, result;
};

struct Alert {
    uint64_t id = 0;
    string sym;
    double price = 0;
    bool above = true, active = true;
};

struct User {
    uint64_t id = 0;
    string name, email, phone, pass, role = "user", kyc = "none",
           totpSecret, aiName = "Bramha", lang = "en";

    bool verified = false, totpOn = false, frozen = false;
    int64_t created = 0;

    vector<string> watch;
    vector<Alert> alerts;
    vector<LoginRec> history;

    Json pub() const {
        Json j = Json::object();

        j["id"] = id;
        j["name"] = name;
        j["email"] = email;
        j["phone"] = phone;
        j["role"] = role;
        j["kyc"] = kyc;
        j["verified"] = verified;
        j["frozen"] = frozen;
        j["two_factor"] = totpOn;
        j["ai_name"] = aiName;
        j["lang"] = lang;
        j["created"] = created;

        return j;
    }
};

class AuthService {
    struct Otp {
        string code;
        int64_t exp = 0;
        int tries = 0;
    };

    mutable mutex m_;
    map<uint64_t, User> users_;
    map<string, uint64_t> byEmail_;
    map<string, Otp> otps_;

    uint64_t nextId_ = 1, nextAlert_ = 1;
    string secret_;
    int iters_;

public:
    explicit AuthService(const string& jwtSecret, int pbkdf2Iters = 60000)
        : secret_(jwtSecret), iters_(pbkdf2Iters) {}

    string hashPassword(const string& pw) const {
        string salt = crypto::randomBytes(16);

        return "pbkdf2$" + to_string(iters_) + "$" +
               crypto::b64(salt) + "$" +
               crypto::b64(crypto::pbkdf2(pw, salt, iters_));
    }

    static bool verifyPassword(const string& pw, const string& stored) {
        size_t a = stored.find('$');
        size_t b = stored.find('$', a + 1);
        size_t c = stored.find('$', b + 1);

        if (c == string::npos) return false;

        int it = atoi(stored.substr(a + 1, b - a - 1).c_str());

        string salt = crypto::b64decode(
            stored.substr(b + 1, c - b - 1)
        );

        return crypto::ctEq(
            crypto::b64(crypto::pbkdf2(pw, salt, it)),
            stored.substr(c + 1)
        );
    }

    static bool validEmail(const string& e) {
        size_t at = e.find('@');

        return at != string::npos &&
               at > 0 &&
               e.find('.', at) != string::npos &&
               e.size() < 120 &&
               e.find(' ') == string::npos;
    }

    static string checkPasswordStrength(const string& p) {
        if (p.size() < 8)
            return "Password must be at least 8 characters";

        bool d = false, u = false, lw = false;

        for (char c : p) {
            if (isdigit((unsigned char)c)) d = true;
            if (isupper((unsigned char)c)) u = true;
            if (islower((unsigned char)c)) lw = true;
        }

        return d && u && lw
            ? ""
            : "Password needs upper-case, lower-case and a digit";
    }

    uint64_t create(
        const string& name,
        const string& email,
        const string& phone,
        const string& pw,
        const string& role,
        bool verified
    ) {
        string hp = hashPassword(pw);

        lock_guard<mutex> g(m_);

        string e = lower(email);

        if (byEmail_.count(e)) return 0;

        User u;

        u.id = nextId_++;
        u.name = name;
        u.email = e;
        u.phone = phone;
        u.pass = hp;
        u.role = role;
        u.verified = verified;
        u.created = nowMs();
        u.kyc = role == "admin" ? "verified" : "none";

        users_[u.id] = u;
        byEmail_[e] = u.id;

        return u.id;
    }

    optional<User> find(const string& email) const {
        lock_guard<mutex> g(m_);

        auto i = byEmail_.find(lower(email));

        if (i == byEmail_.end()) return nullopt;

        return users_.at(i->second);
    }

    optional<User> get(uint64_t id) const {
        lock_guard<mutex> g(m_);

        auto i = users_.find(id);

        if (i == users_.end()) return nullopt;

        return i->second;
    }

    bool update(uint64_t id, const function<void(User&)>& f) {
        lock_guard<mutex> g(m_);

        auto i = users_.find(id);

        if (i == users_.end()) return false;

        f(i->second);

        return true;
    }

    vector<User> all() const {
        lock_guard<mutex> g(m_);

        vector<User> v;

        for (auto& kv : users_) {
            v.push_back(kv.second);
        }

        return v;
    }

    void addHistory(
        uint64_t id,
        const string& ip,
        const string& dev,
        const string& result
    ) {
        update(id, [&](User& u) {
            u.history.push_back({nowMs(), ip, dev, result});

            if (u.history.size() > 100) {
                u.history.erase(u.history.begin());
            }
        });
    }

    string newOtp(const string& key, int ttlSec = 600) {
        string rb = crypto::randomBytes(4);
        uint32_t v = 0;

        for (unsigned char c : rb) {
            v = (v << 8) | c;
        }

        string c = to_string(100000 + v % 900000);

        lock_guard<mutex> g(m_);

        otps_[key] = {
            c,
            nowMs() + ttlSec * 1000LL,
            0
        };

        return c;
    }

    bool checkOtp(const string& key, const string& code) {
        lock_guard<mutex> g(m_);

        auto i = otps_.find(key);

        if (i == otps_.end()) return false;

        if (nowMs() > i->second.exp || ++i->second.tries > 5) {
            otps_.erase(i);
            return false;
        }

        if (!crypto::ctEq(i->second.code, code)) return false;

        otps_.erase(i);

        return true;
    }

    string issue(
        uint64_t uid,
        const string& role,
        int ttlSec = 8 * 3600
    ) const {
        Json h = Json::object();

        h["alg"] = "HS256";
        h["typ"] = "JWT";

        Json p = Json::object();

        p["sub"] = uid;
        p["role"] = role;
        p["iat"] = nowMs() / 1000;
        p["exp"] = nowMs() / 1000 + ttlSec;

        string head = crypto::b64(h.dump(), true);
        string body = crypto::b64(p.dump(), true);

        string sig = crypto::b64(
            crypto::hmacSha256(secret_, head + "." + body),
            true
        );

        return head + "." + body + "." + sig;
    }

    bool verify(
        const string& tok,
        uint64_t& uid,
        string& role
    ) const {
        size_t a = tok.find('.');
        size_t b = tok.find(
            '.',
            a == string::npos ? 0 : a + 1
        );

        if (a == string::npos || b == string::npos) return false;

        if (!crypto::ctEq(
            crypto::b64(
                crypto::hmacSha256(secret_, tok.substr(0, b)),
                true
            ),
            tok.substr(b + 1)
        )) {
            return false;
        }

        bool ok;

        Json p = Json::parse(
            crypto::b64decode(tok.substr(a + 1, b - a - 1)),
            &ok
        );

        if (!ok || p.at("exp").num() < nowMs() / 1000) {
            return false;
        }

        uid = (uint64_t)p.at("sub").num();
        role = p.at("role").str();

        return true;
    }

    uint64_t addAlert(
        uint64_t uid,
        const string& sym,
        double price,
        bool above
    ) {
        uint64_t id = 0;

        update(uid, [&](User& u) {
            id = nextAlert_++;
            u.alerts.push_back({id, sym, price, above, true});
        });

        return id;
    }

    // Returns (user, message) pairs for alerts that fire on this tick.
    vector<pair<uint64_t, string>> checkAlerts(
        const string& sym,
        double px
    ) {
        vector<pair<uint64_t, string>> out;

        lock_guard<mutex> g(m_);

        for (auto& kv : users_) {
            for (auto& a : kv.second.alerts) {
                if (a.active && a.sym == sym &&
                    (a.above ? px >= a.price : px <= a.price)) {

                    a.active = false;

                    char b[160];

                    snprintf(
                        b,
                        sizeof b,
                        "Price alert: %s is %s %.2f (now %.2f)",
                        sym.c_str(),
                        a.above ? "above" : "below",
                        a.price,
                        px
                    );

                    out.push_back({kv.first, b});
                }
            }
        }

        return out;
    }

    Json toJson() const {
        lock_guard<mutex> g(m_);

        Json j = Json::object();
        Json arr = Json::array();

        j["next_id"] = nextId_;
        j["next_alert"] = nextAlert_;

        for (auto& kv : users_) {
            const User& u = kv.second;

            Json x = u.pub();

            x["pass"] = u.pass;
            x["totp"] = u.totpSecret;

            Json w = Json::array();

            for (auto& s : u.watch) {
                w.push(s);
            }

            x["watch"] = w;

            Json al = Json::array();

            for (auto& a : u.alerts) {
                Json y = Json::object();

                y["id"] = a.id;
                y["s"] = a.sym;
                y["p"] = a.price;
                y["above"] = a.above;
                y["active"] = a.active;

                al.push(y);
            }

            x["alerts"] = al;

            Json h = Json::array();

            for (auto& r : u.history) {
                Json y = Json::object();

                y["ts"] = r.ts;
                y["ip"] = r.ip;
                y["dev"] = r.device;
                y["res"] = r.result;

                h.push(y);
            }

            x["history"] = h;
            arr.push(x);
        }

        j["users"] = arr;

        return j;
    }

    void fromJson(const Json& j) {
        lock_guard<mutex> g(m_);

        nextId_ = (uint64_t)j.at("next_id").num(1);
        nextAlert_ = (uint64_t)j.at("next_alert").num(1);

        for (auto& x : j.at("users").a) {
            User u;

            u.id = (uint64_t)x.at("id").num();
            u.name = x.at("name").str();
            u.email = x.at("email").str();
            u.phone = x.at("phone").str();
            u.role = x.at("role").str();
            u.kyc = x.at("kyc").str();

            u.verified = x.at("verified").boolean();
            u.frozen = x.at("frozen").boolean();
            u.totpOn = x.at("two_factor").boolean();
            u.aiName = x.at("ai_name").str("Bramha");
            u.lang = x.at("lang").str("en");
            u.created = (int64_t)x.at("created").num();

            u.pass = x.at("pass").str();
            u.totpSecret = x.at("totp").str();

            for (auto& s : x.at("watch").a) {
                u.watch.push_back(s.str());
            }

            for (auto& y : x.at("alerts").a) {
                u.alerts.push_back({
                    (uint64_t)y.at("id").num(),
                    y.at("s").str(),
                    y.at("p").num(),
                    y.at("above").boolean(),
                    y.at("active").boolean()
                });
            }

            for (auto& y : x.at("history").a) {
                u.history.push_back({
                    (int64_t)y.at("ts").num(),
                    y.at("ip").str(),
                    y.at("dev").str(),
                    y.at("res").str()
                });
            }

            users_[u.id] = u;
            byEmail_[u.email] = u.id;
        }
    }
};

}
