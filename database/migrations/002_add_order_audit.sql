-- 002: order audit trail (example of a forward-only migration).
BEGIN;
CREATE TABLE order_events (id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, event TEXT NOT NULL, detail JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_order_events_order ON order_events(order_id, created_at);
INSERT INTO schema_migrations(version) VALUES ('002_add_order_audit');
COMMIT;
