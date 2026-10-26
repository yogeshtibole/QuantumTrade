
#pragma once
// Minimal multi-threaded HTTP/1.1 server (raw sockets): routing with :params, JSON helpers, static files, WebSocket upgrade hook.

#include <atomic>
#include <fstream>
#include <functional>
#include <map>
#include <mutex>
#include <sstream>
#include <thread>
#include <string>
#include <vector>
#include <algorithm>
#include <cstdint>

#include "../utils/json.hpp"
#include "../utils/latency_monitor.hpp"
#include "../utils/logger.hpp"
#include "../utils/platform.hpp"
#include "../utils/util.hpp"

using namespace std;

namespace qt {

struct Request {
    string method, path, rawQuery, body, ip;
    map<string, string> query, headers, params;
    uint64_t uid = 0;
    string role;

    string header(const string& k) const {
        auto i = headers.find(k);
        return i == headers.end() ? "" : i->second;
    }
};

struct Response {
    int status = 200;
    string body, ctype = "application/json; charset=utf-8";
    map<string, string> headers;

    void json(const Json& j, int st = 200) {
        status = st;
        body = j.dump();
        ctype = "application/json; charset=utf-8";
    }

    void error(int st, const string& msg) {
        Json j = Json::object();
        j["error"] = msg;
        json(j, st);
    }
};

typedef function<void(Request&, Response&)> Handler;

class HttpServer {
    struct Route {
        string method, pattern;
        vector<string> seg;
        Handler h;
    };

    vector<Route> routes_;
    string staticDir_;
    atomic<bool> run_{false};
    sock_t ls_ = BAD_SOCK;
    atomic<int> conns_{0};

    mutex sm_;
    map<string, uint64_t> hits_;

    static vector<string> split(const string& p) {
        vector<string> v;
        size_t i = 0;

        while (i <= p.size()) {
            size_t e = p.find('/', i);

            if (e == string::npos)
                e = p.size();

            if (e > i)
                v.push_back(p.substr(i, e - i));

            i = e + 1;
        }

        return v;
    }

    static const char* statusText(int s) {
        switch (s) {
            case 200: return "OK";
            case 201: return "Created";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 413: return "Payload Too Large";
            case 429: return "Too Many Requests";
            case 503: return "Service Unavailable";
            default:
                return s >= 500 ? "Internal Server Error" : "OK";
        }
    }

    static string mime(const string& p) {
        static const map<string, string> m = {
            {".html", "text/html; charset=utf-8"},
            {".js", "text/javascript; charset=utf-8"},
            {".css", "text/css; charset=utf-8"},
            {".json", "application/json"},
            {".svg", "image/svg+xml"},
            {".png", "image/png"},
            {".jpg", "image/jpeg"},
            {".ico", "image/x-icon"},
            {".woff2", "font/woff2"},
            {".txt", "text/plain"},
            {".pdf", "application/pdf"}
        };

        size_t d = p.rfind('.');

        if (d == string::npos)
            return "application/octet-stream";

        auto i = m.find(lower(p.substr(d)));

        return i == m.end()
            ? "application/octet-stream"
            : i->second;
    }

    static bool sendAll(sock_t s, const string& d) {
        size_t off = 0;

        while (off < d.size()) {
            int n = (int)send(
                s,
                d.data() + off,
                (int)(d.size() - off),
                SEND_FLAGS
            );

            if (n <= 0)
                return false;

            off += n;
        }

        return true;
    }

    void respond(sock_t s, Response& r) {
        ostringstream o;

        o << "HTTP/1.1 " << r.status << " " << statusText(r.status)
          << "\r\nContent-Type: " << r.ctype
          << "\r\nContent-Length: " << r.body.size()
          << "\r\nConnection: close"
          << "\r\nX-Content-Type-Options: nosniff"
          << "\r\nX-Frame-Options: DENY"
          << "\r\nReferrer-Policy: same-origin"
          << "\r\nCache-Control: "
          << (r.ctype.find("json") != string::npos
              ? "no-store"
              : "no-cache")
          << "\r\n";

        for (auto& h : r.headers)
            o << h.first << ": " << h.second << "\r\n";

        o << "\r\n";
        sendAll(s, o.str() + r.body);
    }

    bool serveStatic(Request& q, Response& r) {
        if (staticDir_.empty() || q.method != "GET")
            return false;

        string p = urlDecode(q.path);

        if (p.find("..") != string::npos ||
            p.find('\\') != string::npos)
            return false;

        if (p == "/" || p.empty())
            p = "/index.html";

        ifstream f(staticDir_ + p, ios::binary);

        if (!f)
            return false;

        ostringstream ss;
        ss << f.rdbuf();

        r.body = ss.str();
        r.ctype = mime(p);

        return true;
    }

    void handle(sock_t s, const string& ip) {
        setTimeouts(s, 15000);

        string buf;
        char tmp[8192];
        size_t hend = string::npos;

        while (hend == string::npos) {
            int n = (int)recv(s, tmp, sizeof tmp, 0);

            if (n <= 0) {
                sockClose(s);
                return;
            }

            buf.append(tmp, n);
            hend = buf.find("\r\n\r\n");

            if (buf.size() > 65536 && hend == string::npos) {
                sockClose(s);
                return;
            }
        }

        Request q;
        q.ip = ip;

        istringstream hs(buf.substr(0, hend));
        string line, target, ver;

        getline(hs, line);

        {
            istringstream rl(line);
            rl >> q.method >> target >> ver;
        }

        while (getline(hs, line)) {
            if (!line.empty() && line.back() == '\r')
                line.pop_back();

            size_t c = line.find(':');

            if (c == string::npos)
                continue;

            string v = line.substr(c + 1);
            size_t b = v.find_first_not_of(" \t");

            q.headers[lower(line.substr(0, c))] =
                b == string::npos ? "" : v.substr(b);
        }

        size_t qm = target.find('?');

        q.path = target.substr(0, qm);

        if (qm != string::npos) {
            q.rawQuery = target.substr(qm + 1);
            q.query = parseQuery(q.rawQuery);
        }

        size_t clen = (size_t)atoll(
            q.header("content-length").c_str()
        );

        Response r;

        if (clen > 2 * 1024 * 1024) {
            r.error(413, "Payload too large");
            respond(s, r);
            sockClose(s);
            return;
        }

        q.body = buf.substr(hend + 4);

        while (q.body.size() < clen) {
            int n = (int)recv(s, tmp, sizeof tmp, 0);

            if (n <= 0)
                break;

            q.body.append(tmp, n);
        }

        if (q.body.size() > clen)
            q.body.resize(clen);

        if (q.path == "/ws" &&
            lower(q.header("upgrade")) == "websocket" &&
            onUpgrade) {
            setTimeouts(s, 0);
            onUpgrade(s, q);
            return;
        }

        uint64_t t0 = nowNs();
        string key;

        try {
            if (q.method == "OPTIONS") {
                r.status = 204;
            } else if (!dispatch(q, r, key)) {
                if (!serveStatic(q, r)) {
                    if (q.path.rfind("/api/", 0) == 0) {
                        r.error(404, "Not found");
                    } else {
                        r.status = 404;
                        r.ctype = "text/plain";
                        r.body = "404 Not Found";
                    }
                }
            }
        } catch (const exception& e) {
            loge(string("handler error: ") + e.what());
            r.error(500, "Internal server error");
        }

        respond(s, r);
        sockClose(s);

        if (!key.empty()) {
            latency.record(nowNs() - t0);

            lock_guard<mutex> g(sm_);

            hits_[key + (r.status >= 400 ? " (err)" : "")]++;
            total++;
        }
    }

    bool dispatch(Request& q, Response& r, string& key) {
        auto segs = split(q.path);
        bool pathMatched = false;

        for (auto& rt : routes_) {
            if (rt.seg.size() != segs.size())
                continue;

            bool ok = true;
            map<string, string> pr;

            for (size_t i = 0; i < segs.size() && ok; i++) {
                if (rt.seg[i][0] == ':') {
                    pr[rt.seg[i].substr(1)] = segs[i];
                } else if (rt.seg[i] != segs[i]) {
                    ok = false;
                }
            }

            if (!ok)
                continue;

            pathMatched = true;

            if (rt.method != q.method)
                continue;

            q.params = pr;
            key = rt.method + " " + rt.pattern;
            rt.h(q, r);

            return true;
        }

        if (pathMatched) {
            r.error(405, "Method not allowed");
            return true;
        }

        return false;
    }

public:
    function<void(sock_t, Request&)> onUpgrade;
    LatencyMonitor latency;
    atomic<uint64_t> total{0};

    void setStaticDir(const string& d) {
        staticDir_ = d;
    }

    void route(const string& method, const string& pattern, Handler h) {
        routes_.push_back({method, pattern, split(pattern), h});
    }

    Json stats() {
        lock_guard<mutex> g(sm_);

        Json j = Json::object();
        Json by = Json::array();

        j["total_requests"] = total.load();
        j["active_connections"] = conns_.load();
        j["latency"] = latency.toJson();

        vector<pair<uint64_t, string>> v;

        for (auto& kv : hits_)
            v.push_back({kv.second, kv.first});

        sort(v.rbegin(), v.rend());

        for (size_t i = 0; i < v.size() && i < 30; i++) {
            Json x = Json::object();

            x["endpoint"] = v[i].second;
            x["count"] = v[i].first;

            by.push(x);
        }

        j["endpoints"] = by;

        return j;
    }

    bool listen(int port, const string& bind = "0.0.0.0") {
        sockInit();

        ls_ = socket(AF_INET, SOCK_STREAM, 0);

        if (ls_ == BAD_SOCK)
            return false;

        int one = 1;

        setsockopt(
            ls_, SOL_SOCKET, SO_REUSEADDR,
            (const char*)&one, sizeof one
        );

        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_port = htons((uint16_t)port);
        inet_pton(AF_INET, bind.c_str(), &a.sin_addr);

        if (::bind(ls_, (sockaddr*)&a, sizeof a) < 0 ||
            ::listen(ls_, 256) < 0) {
            loge("Cannot bind port " + to_string(port) +
                 " (already in use?)");
            return false;
        }

        run_ = true;
        return true;
    }

    void serve() {
        while (run_) {
            sockaddr_in ca{};
            socklen_t cl = sizeof ca;

            sock_t c = accept(ls_, (sockaddr*)&ca, &cl);

            if (c == BAD_SOCK) {
                if (!run_)
                    break;

                continue;
            }

            char ipb[64] = {0};

            inet_ntop(AF_INET, &ca.sin_addr, ipb, sizeof ipb);

            int one = 1;

            setsockopt(
                c, IPPROTO_TCP, TCP_NODELAY,
                (const char*)&one, sizeof one
            );

            string ip = ipb;
            conns_++;

            thread([this, c, ip] {
                handle(c, ip);
                conns_--;
            }).detach();
        }
    }

    void stop() {
        run_ = false;

        if (ls_ != BAD_SOCK) {
            sockShutdown(ls_);
            sockClose(ls_);
            ls_ = BAD_SOCK;
        }
    }
};

} // namespace qt
