# Architecture

```
 Browser (vanilla JS ES modules + Tailwind)
   │  REST /api/*          WebSocket /ws (ticks, candles, depth, trades, private order/fill events)
   ▼
 C++17 server (single process, raw sockets)
   ├─ api/            HTTP server, router, JWT-protected REST handlers, static file server, AI assistant
   ├─ auth/           PBKDF2-SHA256 passwords, JWT HS256, OTP, TOTP 2FA, login/device history, alerts
   ├─ websocket/      RFC 6455 hub with topic subscriptions + async broadcaster thread
   ├─ market_feed/    market simulator (random walk, 5s candles, news, sample calendar) – swap for a real adapter
   ├─ matching_engine/ price-time priority books, order types, memory pool, lock-free command queue
   ├─ risk_manager/   pre-trade checks, rate limiter, admin kill-switch
   ├─ portfolio/      accounts, positions, P&L, fees, tax/dividend/risk analytics, wallet
   ├─ strategies/     8 strategies + backtester (fees, slippage, Sharpe, drawdown…)
   └─ utils/          crypto (SHA-1/256, HMAC, PBKDF2, TOTP), JSON, logger, SPSC queue, memory pool, latency histogram
```

## Threads
| Thread | Role |
|---|---|
| `main` | accept loop; one detached thread per HTTP/WebSocket connection |
| `engine` | **only** thread that touches order books; drains the lock-free queue |
| `feed` | advances prices every 250 ms, posts ticks to the engine, publishes candles/ticks |
| `ws-broadcaster` | sends queued frames to subscribers (slow clients are dropped, never block the engine) |
| `saver` | snapshots users + accounts to `data/store.json` every 30 s and on shutdown |

## Order path
`POST /api/orders` → validation → rate limit → command pushed to the **SPSC ring buffer** (`std::mutex` serialises producers) → engine thread: **risk check** (cash, position, exposure, price band, halt) → match against the opposite `std::priority_queue` (price-time priority) → trade hooks update the portfolio under a mutex and publish WebSocket events → result returned through a `std::promise`.

Orders are allocated from a **MemoryPool**; cancelled / replaced market-maker orders are removed lazily when they surface at the top of the heap (compaction when a heap grows large).

## C++ concepts used
`std::thread`, `std::mutex`/`lock_guard`, `std::atomic` (counters, kill-switch, latency histogram, queue indices), lock-free SPSC queue, `std::priority_queue`, socket programming (BSD sockets / Winsock), memory pool, STL containers/algorithms, smart pointers (`unique_ptr`, `shared_ptr`), `std::promise/future`, `std::condition_variable`.

## Market liquidity
A built-in market-maker (user 0) keeps a 10-level ladder on every symbol around the feed price. Your orders trade against it; the feed price itself is exogenous (like a real exchange).

## Production roadmap (not implemented)
* **PostgreSQL**: `database/schema.sql` is the target model. Add a `Store` backend using libpq (write-behind from the engine's trade hook).
* **Redis**: sessions / rate limits / WebSocket pub-sub fan-out for multi-node deployments.
* **TLS**: terminate at nginx (`docker/nginx.conf`). **OAuth**: verify Google ID tokens server-side behind HTTPS (the demo endpoint is disabled when `QT_DEV_MODE=0`).
* **Real data / brokerage**: replace `market_feed` with an exchange or vendor adapter and route fills to a broker (FIX).
* Email/SMS delivery for OTP codes (currently printed to the server log and, in dev mode, shown in the UI).
