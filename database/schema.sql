-- QuantumTrade PostgreSQL schema (PostgreSQL 14+). Money/price columns use NUMERIC, never floating point.
-- The C++ server in this repo persists to data/store.json by default; this schema is the production data model
-- (see docs/architecture.md for the migration path to PostgreSQL + Redis).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== identity & security =====
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')), email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  kyc_status TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none','pending','verified','rejected')),
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE oauth_accounts (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, UNIQUE(provider, provider_user_id));
CREATE TABLE two_factor_settings (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, totp_secret TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE, enabled_at TIMESTAMPTZ);
CREATE TABLE otp_codes (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, attempts INT NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE password_resets (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ);
CREATE TABLE sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, revoked BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE devices (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, user_agent TEXT, first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE login_history (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_id BIGINT REFERENCES devices(id), ip INET, user_agent TEXT, result TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE kyc_documents (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, doc_type TEXT NOT NULL, doc_number_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reviewed_by BIGINT REFERENCES users(id), submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ);
CREATE TABLE account_freezes (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), admin_id BIGINT NOT NULL REFERENCES users(id), reason TEXT, frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(), released_at TIMESTAMPTZ);
CREATE TABLE ai_preferences (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, assistant_name TEXT NOT NULL DEFAULT 'Bramha' CHECK (assistant_name IN ('Bramha','Sars')), language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi','mr')));

-- ===== market =====
CREATE TABLE instruments (id SERIAL PRIMARY KEY, symbol TEXT NOT NULL UNIQUE, name TEXT NOT NULL, sector TEXT, kind TEXT NOT NULL CHECK (kind IN ('stock','crypto','index')), tick_size NUMERIC(18,6) NOT NULL DEFAULT 0.05, market_cap_cr NUMERIC(18,2));
CREATE TABLE market_data (instrument_id INT NOT NULL REFERENCES instruments(id), ts TIMESTAMPTZ NOT NULL, price NUMERIC(18,4) NOT NULL, volume NUMERIC(20,6) NOT NULL DEFAULT 0, PRIMARY KEY (instrument_id, ts));
CREATE TABLE candles (instrument_id INT NOT NULL REFERENCES instruments(id), interval_s INT NOT NULL, ts TIMESTAMPTZ NOT NULL, open NUMERIC(18,4), high NUMERIC(18,4), low NUMERIC(18,4), close NUMERIC(18,4), volume NUMERIC(20,6), PRIMARY KEY (instrument_id, interval_s, ts));
CREATE TABLE order_book_snapshots (id BIGSERIAL PRIMARY KEY, instrument_id INT NOT NULL REFERENCES instruments(id), ts TIMESTAMPTZ NOT NULL DEFAULT now(), bids JSONB NOT NULL, asks JSONB NOT NULL);
CREATE TABLE news_articles (id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), headline TEXT NOT NULL, instrument_id INT REFERENCES instruments(id), category TEXT NOT NULL, source TEXT, sentiment NUMERIC(4,3));
CREATE TABLE economic_events (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('rbi','fed')), event_date DATE NOT NULL, title TEXT NOT NULL, detail TEXT);
CREATE TABLE ipo_calendar (id BIGSERIAL PRIMARY KEY, company TEXT NOT NULL, opens_on DATE, closes_on DATE, price_band TEXT, lot_size INT, listing_date DATE);
CREATE TABLE earnings_calendar (id BIGSERIAL PRIMARY KEY, instrument_id INT NOT NULL REFERENCES instruments(id), report_date DATE NOT NULL, quarter TEXT, consensus_eps NUMERIC(12,4));

-- ===== trading =====
CREATE TABLE wallets (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, cash NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (cash >= 0), currency TEXT NOT NULL DEFAULT 'INR');
CREATE TABLE transactions (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK (kind IN ('deposit','withdraw','fee','dividend','trade')), amount NUMERIC(20,4) NOT NULL, balance_after NUMERIC(20,4) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), instrument_id INT NOT NULL REFERENCES instruments(id),
  side TEXT NOT NULL CHECK (side IN ('buy','sell')), type TEXT NOT NULL CHECK (type IN ('market','limit','stop_loss','take_profit','iceberg','bracket','trailing_stop')),
  qty NUMERIC(20,6) NOT NULL CHECK (qty > 0), price NUMERIC(18,4), stop_price NUMERIC(18,4), display_qty NUMERIC(20,6), take_profit NUMERIC(18,4), stop_loss NUMERIC(18,4), trail_amount NUMERIC(18,4),
  filled_qty NUMERIC(20,6) NOT NULL DEFAULT 0, avg_fill_price NUMERIC(18,4), status TEXT NOT NULL DEFAULT 'open', oco_group BIGINT, reject_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE executed_trades (id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), user_id BIGINT NOT NULL REFERENCES users(id), instrument_id INT NOT NULL REFERENCES instruments(id), side TEXT NOT NULL, qty NUMERIC(20,6) NOT NULL, price NUMERIC(18,4) NOT NULL, fee NUMERIC(20,4) NOT NULL DEFAULT 0, latency_us INT, executed_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE portfolio (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, instrument_id INT NOT NULL REFERENCES instruments(id), qty NUMERIC(20,6) NOT NULL, avg_price NUMERIC(18,4) NOT NULL, PRIMARY KEY (user_id, instrument_id));
CREATE TABLE dividends (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), instrument_id INT NOT NULL REFERENCES instruments(id), per_share NUMERIC(12,4) NOT NULL, qty NUMERIC(20,6) NOT NULL, paid_on DATE NOT NULL);
CREATE TABLE tax_reports (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), fiscal_year TEXT NOT NULL, gross_gains NUMERIC(20,4), gross_losses NUMERIC(20,4), est_tax NUMERIC(20,4), generated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE watchlist (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, instrument_id INT NOT NULL REFERENCES instruments(id), added_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, instrument_id));
CREATE TABLE alerts (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, instrument_id INT NOT NULL REFERENCES instruments(id), target_price NUMERIC(18,4) NOT NULL, direction TEXT NOT NULL CHECK (direction IN ('above','below')), active BOOLEAN NOT NULL DEFAULT TRUE, triggered_at TIMESTAMPTZ);
CREATE TABLE notifications (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, message TEXT NOT NULL, is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ===== strategies & backtesting =====
CREATE TABLE strategies (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, default_params JSONB NOT NULL DEFAULT '{}');
CREATE TABLE backtest_runs (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id), strategy_id TEXT NOT NULL REFERENCES strategies(id), instrument_id INT REFERENCES instruments(id), params JSONB, bars INT, roi_pct NUMERIC(12,4), sharpe NUMERIC(10,4), max_drawdown_pct NUMERIC(10,4), win_rate NUMERIC(6,2), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE backtest_trades (id BIGSERIAL PRIMARY KEY, run_id BIGINT NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE, side TEXT, entry_bar INT, exit_bar INT, entry_price NUMERIC(18,4), exit_price NUMERIC(18,4), pnl_pct NUMERIC(12,4));

-- ===== admin / ops =====
CREATE TABLE api_usage (id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), endpoint TEXT NOT NULL, method TEXT NOT NULL, status INT NOT NULL, latency_us INT, user_id BIGINT);
CREATE TABLE system_logs (id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), level TEXT NOT NULL, message TEXT NOT NULL);
CREATE TABLE latency_metrics (id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), metric TEXT NOT NULL, avg_us NUMERIC(12,3), p50_us NUMERIC(12,3), p99_us NUMERIC(12,3), samples BIGINT);
CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE INDEX idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_open ON orders(instrument_id, side, price) WHERE status IN ('open','partial');
CREATE INDEX idx_trades_user ON executed_trades(user_id, executed_at DESC);
CREATE INDEX idx_trades_instr ON executed_trades(instrument_id, executed_at DESC);
CREATE INDEX idx_login_user ON login_history(user_id, created_at DESC);
CREATE INDEX idx_alerts_active ON alerts(instrument_id) WHERE active;
CREATE INDEX idx_news_ts ON news_articles(ts DESC);
CREATE INDEX idx_api_usage_ts ON api_usage(ts DESC);
