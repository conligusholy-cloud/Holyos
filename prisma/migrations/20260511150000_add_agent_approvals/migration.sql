-- AgentApproval: schvalovací fronta pro requires_approval rules a další review akce.
-- MVP tabulka, runner zatím netvoří záznamy automaticky (auto-tvorba + resume
-- workflow je další session). UI v modulu AI Vývojář → záložka Schválení umožňuje
-- ručně vytvořit / decide pro otestování flow.

CREATE TABLE "agent_approvals" (
  "id"           TEXT PRIMARY KEY,
  "run_id"       TEXT NOT NULL,
  "kind"         VARCHAR(30) NOT NULL,                       -- plan_review | pr_review | rule_override
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "decided_at"   TIMESTAMPTZ,
  "decided_by"   INTEGER,
  "decision"     VARCHAR(20) NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | expired
  "comment"      TEXT,
  "payload"      JSONB,

  CONSTRAINT "agent_approvals_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_approvals_decided_by_fkey"
    FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "agent_approvals_run_id_idx" ON "agent_approvals" ("run_id");
CREATE INDEX "agent_approvals_decision_idx" ON "agent_approvals" ("decision");
