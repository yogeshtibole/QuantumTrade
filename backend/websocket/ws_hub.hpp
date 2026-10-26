
#pragma once

// RFC 6455 WebSocket hub: handshake, framing, topic subscriptions, and an async broadcaster thread
// so slow clients can never stall the matching engine or the market feed.

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "../api/http_server.hpp"
#include "../utils/crypto.hpp"

using namespace std;

namespace qt {

struct WsClient {
    sock_t s = BAD_SOCK;
    uint64_t uid = 0;
    mutex m;
    set<string> topics;
    atomic<bool> alive{true};
};

class WsHub {
    struct Msg {
        string topic, data;
    };

    mutex cm_, qm_;
    vector<shared_ptr<WsClient>> clients_;
    deque<Msg> q_;
    condition_variable cv_;
    atomic<bool> run_{false};
    thread th_;

public:
    atomic<uint64_t> sent{0}, dropped{0};

    function<bool(const string&, uint64_t, const string&)> allowTopic;

    static string frame(const string& p, int op = 1) {
        string f;
        f += (char)(0x80 | op);

        size_t n = p.size();

        if (n < 126) {
            f += (char)n;
        }
        else if (n < 65536) {
            f += (char)126;
            f += (char)(n >> 8);
            f += (char)(n & 0xff);
        }
        else {
            f += (char)127;

            for (int i = 7; i >= 0; --i)
                f += (char)((n >> (i * 8)) & 0xff);
        }

        return f + p;
    }

    static bool sendRaw(WsClient& c, const string& d) {
        lock_guard<mutex> g(c.m);

        size_t off = 0;

        while (off < d.size()) {
            int n = (int)send(
                c.s,
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

    void start() {
        if (run_) return;

        run_ = true;

        th_ = thread([this] {
            auto lastPing = nowMs();

            while (run_) {
                deque<Msg> batch;

                {
                    unique_lock<mutex> lk(qm_);

                    cv_.wait_for(
                        lk,
                        chrono::milliseconds(1000),
                        [&] {
                            return !q_.empty() || !run_;
                        }
                    );

                    batch.swap(q_);
                }

                vector<shared_ptr<WsClient>> cs;

                {
                    lock_guard<mutex> g(cm_);
                    cs = clients_;
                }

                for (auto& m : batch) {
                    string fr = frame(m.data);

                    for (auto& c : cs) {
                        if (!c->alive) continue;

                        bool want;

                        {
                            lock_guard<mutex> g(c->m);
                            want = c->topics.count(m.topic) > 0;
                        }

                        if (want) {
                            if (sendRaw(*c, fr)) {
                                sent++;
                            }
                            else {
                                c->alive = false;
                                dropped++;
                                sockShutdown(c->s);
                            }
                        }
                    }
                }

                if (nowMs() - lastPing > 20000) {
                    lastPing = nowMs();

                    string pf = frame("", 9);

                    for (auto& c : cs) {
                        if (c->alive && !sendRaw(*c, pf)) {
                            c->alive = false;
                            sockShutdown(c->s);
                        }
                    }
                }

                lock_guard<mutex> g(cm_);

                clients_.erase(
                    remove_if(
                        clients_.begin(),
                        clients_.end(),
                        [](const shared_ptr<WsClient>& c) {
                            return !c->alive;
                        }
                    ),
                    clients_.end()
                );
            }
        });
    }

    void stop() {
        run_ = false;
        cv_.notify_all();

        if (th_.joinable())
            th_.join();
    }

    void publish(const string& topic, const string& data) {
        {
            lock_guard<mutex> g(qm_);

            if (q_.size() > 5000) {
                q_.pop_front();
                dropped++;
            }

            q_.push_back({topic, data});
        }

        cv_.notify_one();
    }

    void publish(const string& topic, const Json& j) {
        publish(topic, j.dump());
    }

    void publishUser(uint64_t uid, const Json& j) {
        publish("user:" + to_string(uid), j.dump());
    }

    bool hasSubscribers(const string& topic) {
        lock_guard<mutex> g(cm_);

        for (auto& c : clients_) {
            lock_guard<mutex> g2(c->m);

            if (c->alive && c->topics.count(topic))
                return true;
        }

        return false;
    }

    size_t clientCount() {
        lock_guard<mutex> g(cm_);
        return clients_.size();
    }

    // Called on the connection's own thread after the upgrade request was parsed.
    void serve(sock_t s, Request& req, uint64_t uid) {
        string key = req.header("sec-websocket-key");

        if (key.empty()) {
            sockClose(s);
            return;
        }

        string acc = crypto::b64(
            crypto::sha1(
                key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            )
        );

        string resp =
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Accept: " + acc + "\r\n\r\n";

        if (send(s, resp.data(), (int)resp.size(), SEND_FLAGS) <= 0) {
            sockClose(s);
            return;
        }

        auto c = make_shared<WsClient>();

        c->s = s;
        c->uid = uid;

        setSendTimeout(s, 300);

        int one = 1;

        setsockopt(
            s,
            SOL_SOCKET,
            SO_KEEPALIVE,
            (const char*)&one,
            sizeof one
        );

        if (uid)
            c->topics.insert("user:" + to_string(uid));

        {
            lock_guard<mutex> g(cm_);
            clients_.push_back(c);
        }

        sendRaw(
            *c,
            frame(
                "{\"t\":\"hello\",\"user\":" +
                to_string(uid) + "}"
            )
        );

        string buf;
        char tmp[4096];

        while (c->alive) {
            int n = (int)recv(s, tmp, sizeof tmp, 0);

            if (n <= 0) break;

            buf.append(tmp, n);

            while (buf.size() >= 2) {
                uint8_t b0 = buf[0], b1 = buf[1];

                int op = b0 & 0xf;
                bool mask = b1 & 0x80;
                uint64_t len = b1 & 0x7f;
                size_t off = 2;

                if (len == 126) {
                    if (buf.size() < 4) break;

                    len = ((uint8_t)buf[2] << 8) |
                          (uint8_t)buf[3];

                    off = 4;
                }
                else if (len == 127) {
                    if (buf.size() < 10) break;

                    len = 0;

                    for (int i = 0; i < 8; i++)
                        len = (len << 8) | (uint8_t)buf[2 + i];

                    off = 10;
                }

                if (len > 65536) {
                    c->alive = false;
                    break;
                }

                size_t need = off + (mask ? 4 : 0) + len;

                if (buf.size() < need) break;

                string pl = buf.substr(
                    off + (mask ? 4 : 0),
                    len
                );

                if (mask) {
                    for (size_t i = 0; i < pl.size(); i++)
                        pl[i] ^= buf[off + (i % 4)];
                }

                buf.erase(0, need);

                if (op == 8) {
                    c->alive = false;
                    break;
                }

                if (op == 9)
                    sendRaw(*c, frame(pl, 10));

                if (op != 1) continue;

                bool ok;

                Json m = Json::parse(pl, &ok);

                if (!ok) continue;

                string o = m.at("op").str();

                if (o == "sub" || o == "unsub") {
                    for (auto& t : m.at("topics").a) {
                        string tn = t.str();

                        if (tn.size() > 64) continue;

                        if (o == "sub") {
                            if (tn.rfind("user:", 0) == 0)
                                continue;

                            if (allowTopic && !allowTopic(tn, uid, ""))
                                continue;

                            lock_guard<mutex> g(c->m);

                            if (c->topics.size() < 64)
                                c->topics.insert(tn);
                        }
                        else {
                            lock_guard<mutex> g(c->m);

                            if (tn.rfind("user:", 0) != 0)
                                c->topics.erase(tn);
                        }
                    }
                }
                else if (o == "ping") {
                    sendRaw(*c, frame("{\"t\":\"pong\"}"));
                }
            }
        }

        c->alive = false;

        {
            lock_guard<mutex> g(cm_);

            clients_.erase(
                remove(clients_.begin(), clients_.end(), c),
                clients_.end()
            );
        }

        sockClose(s);
    }
};

}
