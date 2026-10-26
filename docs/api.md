# REST & WebSocket API

All endpoints are under `/api`, JSON in/out. Authenticated endpoints need `Authorization: Bearer <JWT>`. Errors: `{"error":"message"}`.

## Auth
| Method | Path | Body |
|---|---|---|
| POST | `/auth/register` | `name,email,phone,password,confirm,accept_terms` → OTP sent |
| POST | `/auth/verify-otp` | `email,code` → `{token,user}` |
| POST | `/auth/resend-otp` | `email` |
| POST | `/auth/login` | `email,password` → `{token}` or `{need_2fa,ticket}` |
| POST | `/auth/login/2fa` | `ticket,code` |
| POST | `/auth/forgot`, `/auth/reset` | `email` / `email,code,password` |
| POST | `/auth/oauth/google` | demo only (`QT_DEV_MODE=1`) |
| POST | `/auth/2fa/setup`, `/enable`, `/disable` | TOTP management |
| GET | `/me`, `/me/history` · POST `/me/settings` | profile, device login history, AI name/language |
| POST | `/kyc` | `pan` |

## Market data (public)
`GET /symbols` · `/market/overview` · `/heatmap` · `/candles?symbol=&limit=` · `/depth?symbol=&levels=` · `/trades?symbol=` · `/news?symbol=` · `/calendar?kind=rbi|fed|ipo|earnings` · `/strategies` · `/health`

## Trading (auth)
* `POST /orders` `{symbol, side, type, qty, price?, stop?, display?, tp?, sl?, trail?}`  
  `type`: `market | limit | stop_loss | take_profit | iceberg | bracket | trailing_stop`
* `POST /orders/cancel` `{id}` · `GET /orders` · `GET /fills`

## Portfolio (auth)
`GET /portfolio` · `/portfolio/equity` · `/portfolio/dividends` · `/portfolio/tax` · `GET|POST /wallet` · `GET|POST /watchlist` · `POST /alerts`, `/alerts/delete`

## Analytics
* `POST /backtest` `{strategy, symbol, bars, seed, capital, fee_bps, slippage_bps, params, source:"sim|live", prices:[…]}`
* `POST /ai/ask` `{question, lang:"en|hi|mr", symbol?}` (auth) · `GET /ai/analysis?symbol=`

## Admin (role = admin)
`GET /admin/overview|users|trades|feed|revenue|api-usage|logs|latency` · `POST /admin/users/kyc` `{id,status}` · `/admin/users/freeze` `{id,frozen}` · `/admin/halt` `{halted}`

## WebSocket `/ws?token=<JWT optional>`
Send `{"op":"sub","topics":["ticks","chart:TCS","depth:TCS","trades:TCS","news"]}` (also `unsub`, `ping`).  
Messages: `ticks`, `candle`, `depth`, `trade`, `news`, and private (when a valid token was supplied) `order`, `fill`, `alert`.
