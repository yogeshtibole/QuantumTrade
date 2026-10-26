
/*
 * Self-contained unit tests (no framework).
 *
 * Build:
 * g++ -std=c++17 -pthread -I.. test_engine.cpp -o test_engine
 */

#include <iostream>

#include "../backend/matching_engine/matching_engine.hpp"
#include "../backend/utils/crypto.hpp"
#include "../backend/utils/json.hpp"

using namespace qt;

static int fails = 0;
static int total = 0;

#define CHECK(c) \
    do { \
        total++; \
        if (!(c)) { \
            fails++; \
            std::cerr << "FAIL line " << __LINE__ << ": " #c "\n"; \
        } else { \
            std::cout << ""; \
        } \
    } while (0)

struct Env {
    RiskManager risk;
    Portfolio pf;
    MatchingEngine eng{risk, pf};
    std::vector<Trade> trades;

    Env() {
        eng.addSymbol("TEST", 0.05, 0, 6, 100.0);

        eng.hooks.onTrade = [this](const Trade& t) {
            trades.push_back(t);

            if (t.buyUser) {
                pf.applyFill(
                    t.buyUser,
                    Side::Buy,
                    t.symbol,
                    t.qty,
                    t.price,
                    t.ts
                );
            }

            if (t.sellUser) {
                pf.applyFill(
                    t.sellUser,
                    Side::Sell,
                    t.symbol,
                    t.qty,
                    t.price,
                    t.ts
                );
            }
        };

        for (uint64_t u = 1; u <= 3; u++) {
            pf.open(u, 1000000);
            pf.seedPosition(u, "TEST", 1000, 100);
        }
    }

    OrderRequest req(
        uint64_t u,
        Side s,
        OType t,
        double q,
        double p = 0
    ) {
        OrderRequest r;
        r.user = u;
        r.symbol = "TEST";
        r.side = s;
        r.type = t;
        r.qty = q;
        r.price = p;

        return r;
    }
};

int main() {
    {
        Env e;

        auto a = e.eng.submit(
            e.req(1, Side::Sell, OType::Limit, 10, 101)
        );

        CHECK(a.ok && a.status == "open");

        auto b = e.eng.submit(
            e.req(2, Side::Buy, OType::Limit, 10, 101)
        );

        CHECK(
            b.status == "filled" &&
            e.trades.size() == 1 &&
            e.trades[0].price == 101
        );
    }

    {
        Env e;

        e.eng.submit(e.req(1, Side::Sell, OType::Limit, 10, 102));
        e.eng.submit(e.req(2, Side::Sell, OType::Limit, 10, 102));

        e.eng.submit(e.req(3, Side::Buy, OType::Limit, 5, 102));

        CHECK(
            e.trades.size() == 1 &&
            e.trades[0].sellUser == 1
        );
    } // Price-time priority

    {
        Env e;

        e.eng.submit(e.req(1, Side::Sell, OType::Limit, 10, 103));
        e.eng.submit(e.req(2, Side::Sell, OType::Limit, 10, 102));

        e.eng.submit(e.req(3, Side::Buy, OType::Limit, 5, 105));

        CHECK(e.trades[0].price == 102);
    } // Best price first

    {
        Env e;

        e.eng.submit(e.req(1, Side::Sell, OType::Limit, 10, 101));

        auto r = e.eng.submit(
            e.req(2, Side::Buy, OType::Market, 25)
        );

        CHECK(r.filled == 10 && r.status == "cancelled");
    } // IOC remainder cancelled

    {
        Env e;

        e.eng.submit(e.req(1, Side::Sell, OType::Limit, 100, 101));

        auto r = e.eng.submit(
            e.req(2, Side::Buy, OType::Limit, 40, 101)
        );

        CHECK(r.status == "filled");

        auto o = e.eng.ordersFor(1);

        CHECK(
            !o.empty() &&
            o[0].status == OStatus::Partial &&
            o[0].filled == 40
        );
    }

    {
        Env e;

        OrderRequest ice = e.req(
            1,
            Side::Sell,
            OType::Iceberg,
            100,
            101
        );

        ice.display = 10;
        e.eng.submit(ice);

        auto d = e.eng.depth("TEST");

        CHECK(d.at("asks").a[0].at("qty").num() == 10);
        // Only the visible slice is shown.

        e.eng.submit(e.req(3, Side::Sell, OType::Limit, 10, 101));
        e.eng.submit(e.req(2, Side::Buy, OType::Limit, 10, 101));

        CHECK(e.trades.back().sellUser == 1);

        e.eng.submit(e.req(2, Side::Buy, OType::Limit, 10, 101));

        CHECK(e.trades.back().sellUser == 3);
        // Replenished slice lost time priority.

        d = e.eng.depth("TEST");

        CHECK(d.at("asks").a[0].at("qty").num() == 10);
    }

    {
        Env e;

        auto r = e.eng.submit(
            e.req(1, Side::Sell, OType::Stop, 10)
        );

        CHECK(!r.ok); // Needs trigger.

        OrderRequest s = e.req(1, Side::Sell, OType::Stop, 10);
        s.stop = 95;

        r = e.eng.submit(s);

        CHECK(r.ok && r.status == "pending_trigger");

        e.eng.submit(e.req(2, Side::Buy, OType::Limit, 10, 94));

        e.eng.onTick("TEST", 96);

        CHECK(e.trades.empty());

        e.eng.onTick("TEST", 94.5);

        CHECK(
            e.trades.size() == 1 &&
            e.trades[0].price == 94
        );
    }

    {
        Env e;

        OrderRequest t = e.req(
            1,
            Side::Sell,
            OType::Trailing,
            10
        );

        t.trail = 2;
        e.eng.submit(t);

        e.eng.onTick("TEST", 105);
        e.eng.onTick("TEST", 104);

        e.eng.submit(e.req(2, Side::Buy, OType::Limit, 10, 103.5));

        CHECK(e.trades.empty());

        e.eng.onTick("TEST", 102.9);

        CHECK(e.trades.size() == 1);
    } // Trailed to 105, triggers at <= 103.

    {
        Env e;

        OrderRequest br = e.req(
            1,
            Side::Buy,
            OType::Bracket,
            10,
            100
        );

        br.tp = 110;
        br.sl = 95;

        e.eng.submit(br); // Rests at 100, last = 100.

        e.eng.submit(e.req(2, Side::Sell, OType::Limit, 10, 100));

        CHECK(e.trades.size() == 1);

        auto o = e.eng.ordersFor(1);
        int pend = 0;

        for (auto& x : o) {
            if (x.status == OStatus::Pending) {
                pend++;
            }
        }

        CHECK(pend == 2);

        e.eng.submit(e.req(2, Side::Buy, OType::Limit, 10, 96));
        e.eng.onTick("TEST", 94);

        CHECK(e.trades.size() == 2);

        o = e.eng.ordersFor(1);
        pend = 0;

        for (auto& x : o) {
            if (x.status == OStatus::Pending) {
                pend++;
            }
        }

        CHECK(pend == 0);
    } // OCO sibling cancelled

    {
        Env e;

        auto r = e.eng.submit(
            e.req(1, Side::Buy, OType::Limit, 100000, 100)
        );

        CHECK(!r.ok); // 1e7 notional > cash/limit.

        r = e.eng.submit(
            e.req(1, Side::Sell, OType::Limit, 5000, 100)
        );

        CHECK(
            !r.ok &&
            r.reason.find("position") != std::string::npos
        );

        r = e.eng.submit(
            e.req(1, Side::Buy, OType::Limit, 10, 150)
        );

        CHECK(
            !r.ok &&
            r.reason.find("band") != std::string::npos
        );

        e.risk.halted = true;

        r = e.eng.submit(
            e.req(1, Side::Buy, OType::Limit, 1, 100)
        );

        CHECK(!r.ok);
    }

    {
        Env e;

        auto r = e.eng.submit(
            e.req(1, Side::Sell, OType::Limit, 10, 101)
        );

        std::string why;

        CHECK(e.eng.cancel(1, r.id, why));

        auto r2 = e.eng.submit(
            e.req(2, Side::Buy, OType::Limit, 10, 101)
        );

        CHECK(r2.status == "open" && e.trades.empty());
        CHECK(!e.eng.cancel(2, 99999, why));
    }

    {
        Env e;

        e.eng.submit(e.req(1, Side::Sell, OType::Limit, 10, 101));

        auto r = e.eng.submit(
            e.req(1, Side::Buy, OType::Limit, 10, 101)
        );

        CHECK(r.status == "cancelled" && e.trades.empty());
    } // Self-trade

    {
        Env e;

        e.eng.submit(e.req(1, Side::Sell, OType::Limit, 10, 101));
        e.eng.submit(e.req(2, Side::Buy, OType::Market, 10));

        auto v = e.pf.view(
            2,
            [](const std::string&) {
                return 100.0;
            }
        );

        CHECK(
            v.pos["TEST"].qty == 1010 &&
            v.cash < 1000000 - 1010 + 1
        );
    } // Portfolio updated with fee

    {
        MatchingEngine::Hooks h;
        RiskManager r;
        Portfolio p;
        MatchingEngine e(r, p);

        e.addSymbol("T", 0.05, 0, 6, 100);
        e.start();

        p.open(1, 1e6);
        p.open(2, 1e6);
        p.seedPosition(1, "T", 1e5, 100);

        e.hooks.onTrade = [&](const Trade& t) {
            p.applyFill(
                t.buyUser,
                Side::Buy,
                "T",
                t.qty,
                t.price,
                0
            );

            p.applyFill(
                t.sellUser,
                Side::Sell,
                "T",
                t.qty,
                t.price,
                0
            );
        };

        OrderRequest s;
        s.user = 1;
        s.symbol = "T";
        s.side = Side::Sell;
        s.type = OType::Limit;
        s.qty = 1;
        s.price = 100.5;

        OrderRequest b = s;
        b.user = 2;
        b.side = Side::Buy;

        int fills = 0;

        for (int i = 0; i < 2000; i++) {
            e.submit(s);

            if (e.submit(b).status == "filled") {
                fills++;
            }
        }

        CHECK(fills == 2000 && e.tradeCount == 2000);

        std::cerr
            << "threaded engine: 4000 orders, ack avg "
            << e.ackLatency.avgUs()
            << " us, match avg "
            << e.matchLatency.avgUs()
            << " us\n";

        e.stop();
    }

    // Cryptography tests
    CHECK(
        crypto::hex(crypto::sha256("abc")) ==
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );

    CHECK(
        crypto::hex(
            crypto::hmacSha256(
                "key",
                "The quick brown fox jumps over the lazy dog"
            )
        ) ==
        "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
    );

    CHECK(
        crypto::totpAt(
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
            59 / 30
        ) == "287082"
    );

    CHECK(
        crypto::b64decode(crypto::b64("hello world!?")) ==
        "hello world!?"
    );

    CHECK(
        crypto::hex(
            crypto::sha1("258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        ).size() == 40
    );

    // JSON tests
    {
        bool ok;

        Json j = Json::parse(
            "{\"x\":[1,2.5,\"a\\nb\"],\"y\":null}",
            &ok
        );

        CHECK(
            ok &&
            j.at("x").a[1].num() == 2.5 &&
            Json::parse(j.dump()).dump() == j.dump()
        );

        Json::parse("{bad", &ok);

        CHECK(!ok);
    }

    std::cout
        << (total - fails)
        << "/"
        << total
        << " checks passed\n";

    return fails ? 1 : 0;
}
