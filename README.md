# QuantumTrade — High-Frequency Trading Platform (C++ full stack)

A trading platform with a C++17 backend (REST + WebSocket + matching engine) and a plain-JavaScript frontend (Tailwind CSS, no build step). The backend serves the frontend, so **one executable runs everything**.

> **Honest scope.** Market data is *simulated* (random-walk feed + a market-maker bot) and funds are *virtual*; this is a paper-trading / portfolio project, not a brokerage. PostgreSQL, Redis and real OAuth are **designed for but not wired in** — see "What is and isn't implemented".

## Quick start
```
g++ -std=c++17 -O2 -pthread -I. backend/main.cpp -o quantumtrade        # Windows: add  -lws2_32  and use quantumtrade.exe
./quantumtrade                                                          # then open http://localhost:8080
```
Log in with `demo@quantumtrade.local` / `Demo@12345`, or sign up (the OTP code is shown on screen in dev mode). Admin: `admin@quantumtrade.local` / `Admin@12345`. Full instructions: [docs/setup.md](docs/setup.md).

## Highlights
| Feature | Where |
|---|---|
| **Live WebSocket prices** — ticks, candles, depth and trades without refreshing | `backend/websocket`, `frontend/hooks/useWebSocket.js` |
| **C++ matching engine** — price-time priority, 7 order types, µs-level latency monitor (≈3 µs ack in unit tests) | `backend/matching_engine` |
| **Risk management** — buying power, exposure %, price band, position check, rate limit, admin kill-switch | `backend/risk_manager` |
| **Backtesting** — 8 strategies, fees/slippage, Sharpe, drawdown, win rate, candlestick replay, CSV export | `backend/strategies`, `frontend/pages/backtest.js` |
| **AI assistant** (Bramha / Sars) — analysis, sentiment, forecast, portfolio tips; English / हिन्दी / मराठी; voice | `backend/api/ai_assistant.hpp`, `frontend/pages/ai.js` |
| **Dark glassmorphism UI**, responsive desktop/mobile | `frontend/assets/styles.css` |
| **Security** — PBKDF2-SHA256, JWT, OTP, TOTP 2FA, login lockout, device history | `backend/auth` |

C++ concepts: `std::thread`, mutex, atomics, lock-free SPSC queue, priority queue, sockets, memory pool, STL, smart pointers, promise/future.

## Pages
Home · Login/Signup (OTP, 2FA, forgot password, Google demo) · Dashboard · Trade (candles + RSI/MACD/Bollinger/VWAP, order book, time & sales, 7 order types) · Order Book & Depth · Portfolio (holdings, P&L, dividends, allocation, risk score, tax report, PDF, wallet) · AI Assistant · Heat Map · News & Calendar · Algorithms · Backtest Lab · Admin (users, KYC, freeze, trade monitor, feed status, revenue, API usage, logs, halt) · Settings.

## What is and isn't implemented
| Implemented and tested | Not implemented (documented path in docs/architecture.md) |
|---|---|
| Matching engine, risk checks, portfolio accounting (38 unit checks, `tests/test_engine.cpp`) | **PostgreSQL / Redis integration** — the server persists to `data/store.json`. `database/schema.sql` (36 tables), seed and migrations are provided for the next step; docker-compose provisions both services. |
| REST API + WebSocket verified end-to-end (`tests/api_smoke.js`) | **TLS in-process** — terminate SSL at nginx (`docker/nginx.conf`) |
| JWT, PBKDF2, TOTP (RFC 6238 test vector), OTP flow | **Real Google OAuth** (needs credentials + HTTPS); a demo endpoint exists in dev mode only |
| Admin tools, KYC states, freeze, halt | **Email/SMS delivery** of OTPs (printed to server log; shown in UI in dev mode) |
| Frontend: all pages written; JS syntax-checked | **Real market data / broker** — simulated feed only. Frontend was not exercised in a real browser in the build environment: expect to polish layout details. |

## Project layout
```
backend/   api  auth  matching_engine  websocket  market_feed  risk_manager  portfolio  strategies  utils  main.cpp
frontend/  index.html  App.js  src/  components/  pages/  charts/  hooks/  assets/
database/  schema.sql  seed.sql  migrations/
docs/ docker/ tests/ CMakeLists.txt
```
Frontend uses plain JavaScript ES modules (`App.js`, not React/`App.jsx`) as requested; Tailwind loads from its CDN, so the first page load needs internet access.

*Not investment advice. Sample testimonials, news, calendar events, dividends and tax figures are illustrative demo data.*
