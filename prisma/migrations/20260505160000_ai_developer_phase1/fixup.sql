-- =============================================================================
-- HolyOS — AI Vývojář / fix-up (idempotentní)
-- =============================================================================
-- Spustit pokud původní migration.sql selhala v půlce (např. 'already exists')
-- a chceme dotáhnout zbytek bez ohledu na to, co v DB je. 100 % idempotentní:
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS  (PG 9.6+)
--   CREATE TABLE IF NOT EXISTS                (vždy)
--   CREATE INDEX IF NOT EXISTS                (PG 9.5+)
--   ADD CONSTRAINT — obal DO BLOCK s catch duplicate_object
--   INSERT ... ON CONFLICT DO NOTHING
-- Spustit:
--   npx prisma db execute --file prisma/migrations/20260505160000_ai_developer_phase1/fixup.sql --schema prisma/schema.prisma

-- ─── 1) Rozšíření admin_tasks ─────────────────────────────────────────────

ALTER TABLE "admin_tasks"
  ADD COLUMN IF NOT EXISTS "assignable_to_ai"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "admin_tasks"
  ADD COLUMN IF NOT EXISTS "acceptance_criteria" TEXT;
ALTER TABLE "admin_tasks"
  ADD COLUMN IF NOT EXISTS "affected_module"     VARCHAR(100);
ALTER TABLE "admin_tasks"
  ADD COLUMN IF NOT EXISTS "target_repo_id"      TEXT;

CREATE INDEX IF NOT EXISTS "admin_tasks_assignable_to_ai_idx" ON "admin_tasks"("assignable_to_ai");
CREATE INDEX IF NOT EXISTS "admin_tasks_target_repo_id_idx"   ON "admin_tasks"("target_repo_id");

-- ─── 2) agent_settings (singleton) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_settings" (
    "id"                       INTEGER NOT NULL DEFAULT 1,
    "enabled"                  BOOLEAN NOT NULL DEFAULT false,
    "default_autonomy"         VARCHAR(20) NOT NULL DEFAULT 'pr_review',
    "max_concurrent_runs"      INTEGER NOT NULL DEFAULT 1,
    "max_runs_per_day"         INTEGER NOT NULL DEFAULT 5,
    "daily_token_budget"       INTEGER NOT NULL DEFAULT 1000000,
    "default_timeout_minutes"  INTEGER NOT NULL DEFAULT 30,
    "max_commits_per_run"      INTEGER NOT NULL DEFAULT 10,
    "auto_merge_wait_minutes"  INTEGER NOT NULL DEFAULT 15,
    "updated_by"               INTEGER,
    "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_settings_pkey" PRIMARY KEY ("id")
);

-- ─── 3) agent_repos ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_repos" (
    "id"                  TEXT NOT NULL,
    "name"                VARCHAR(100) NOT NULL,
    "git_url"             VARCHAR(500) NOT NULL,
    "default_branch"      VARCHAR(100) NOT NULL DEFAULT 'main',
    "protected_branches"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "allow_auto_merge"    BOOLEAN NOT NULL DEFAULT false,
    "required_checks"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tech_stack"          JSONB,
    "active"              BOOLEAN NOT NULL DEFAULT true,
    "created_by"          INTEGER,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_repos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_repos_active_idx" ON "agent_repos"("active");

-- ─── 4) agent_runs ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_runs" (
    "id"             TEXT NOT NULL,
    "task_id"        INTEGER NOT NULL,
    "repo_id"        TEXT,
    "status"         VARCHAR(30) NOT NULL DEFAULT 'queued',
    "autonomy_mode"  VARCHAR(20) NOT NULL DEFAULT 'pr_review',
    "started_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at"       TIMESTAMP(3),
    "container_id"   VARCHAR(100),
    "branch"         VARCHAR(255),
    "pr_url"         VARCHAR(500),
    "pr_number"      INTEGER,
    "tokens_used"    INTEGER NOT NULL DEFAULT 0,
    "commits_count"  INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "summary"        TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_runs_task_id_idx"    ON "agent_runs"("task_id");
CREATE INDEX IF NOT EXISTS "agent_runs_status_idx"     ON "agent_runs"("status");
CREATE INDEX IF NOT EXISTS "agent_runs_started_at_idx" ON "agent_runs"("started_at");

-- ─── 5) agent_run_events ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_run_events" (
    "id"      TEXT NOT NULL,
    "run_id"  TEXT NOT NULL,
    "at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind"    VARCHAR(50) NOT NULL,
    "payload" JSONB,
    CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_run_events_run_id_at_idx" ON "agent_run_events"("run_id", "at");
CREATE INDEX IF NOT EXISTS "agent_run_events_kind_idx"      ON "agent_run_events"("kind");

-- ─── 6) Foreign keys (idempotentně přes DO block) ─────────────────────────

DO $$ BEGIN
  ALTER TABLE "admin_tasks"
    ADD CONSTRAINT "admin_tasks_target_repo_id_fkey"
    FOREIGN KEY ("target_repo_id") REFERENCES "agent_repos"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_settings"
    ADD CONSTRAINT "agent_settings_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_repos"
    ADD CONSTRAINT "agent_repos_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_runs"
    ADD CONSTRAINT "agent_runs_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "admin_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_runs"
    ADD CONSTRAINT "agent_runs_repo_id_fkey"
    FOREIGN KEY ("repo_id") REFERENCES "agent_repos"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_run_events"
    ADD CONSTRAINT "agent_run_events_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 7) Seed singleton row ─────────────────────────────────────────────────

INSERT INTO "agent_settings" (
    "id", "enabled", "default_autonomy",
    "max_concurrent_runs", "max_runs_per_day", "daily_token_budget",
    "default_timeout_minutes", "max_commits_per_run", "auto_merge_wait_minutes",
    "updated_at"
)
VALUES (
    1, false, 'pr_review',
    1, 5, 1000000,
    30, 10, 15,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- ─── 8) Diagnostika — výpis stavu po fix-upu ──────────────────────────────
-- (Postgres SELECT v --file běží OK, výsledek se nevypíše, ale je to platné SQL)

SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('agent_settings','agent_repos','agent_runs','agent_run_events')) AS agent_tables_count,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='admin_tasks'
   AND column_name IN ('assignable_to_ai','acceptance_criteria','affected_module','target_repo_id')) AS admin_tasks_new_cols,
  (SELECT COUNT(*) FROM "agent_settings" WHERE id=1) AS settings_singleton_present;
