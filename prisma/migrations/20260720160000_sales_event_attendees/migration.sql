-- Účastníci schůzky (CSV e-mailů) pro pozvánky přes Graph.
ALTER TABLE "sales_events" ADD COLUMN IF NOT EXISTS "attendees" TEXT;
