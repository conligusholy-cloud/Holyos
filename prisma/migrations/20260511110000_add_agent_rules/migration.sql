-- AgentRule: dynamicky editovatelná pravidla, co agent smí / nesmí / vyžaduje schválení.
-- Fáze 1 reálně používá kind='forbidden' + scope='path_pattern' (nahradí hardcoded
-- FORBIDDEN_PATTERNS v services/ai-developer/agent.js). Zbytek scope a kind hodnot
-- je rezerva pro Fázi 2 (approval workflow) — backend check zatím neaplikuje.

CREATE TABLE "agent_rules" (
  "id"            TEXT PRIMARY KEY,
  "kind"          VARCHAR(30) NOT NULL,
  "scope"         VARCHAR(30) NOT NULL,
  "value"         TEXT NOT NULL,
  "description"   TEXT,
  "active"        BOOLEAN NOT NULL DEFAULT TRUE,
  "blocked_count" INTEGER NOT NULL DEFAULT 0,
  "created_by"    INTEGER,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "agent_rules_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "agent_rules_kind_scope_active_idx" ON "agent_rules" ("kind", "scope", "active");

-- Seed: 6 patternů z hardcoded FORBIDDEN_PATTERNS v services/ai-developer/agent.js
-- (převedeno z JS regex literálů na string bez /.../ obalu). Po commitu této migrace
-- a deploye worker použije DB pravidla místo hardcoded. Hardcoded zůstanou v kódu
-- jako fallback safety net, pokud DB load selže.

INSERT INTO "agent_rules" ("id", "kind", "scope", "value", "description", "active") VALUES
  (gen_random_uuid()::TEXT, 'forbidden', 'path_pattern', '(^|/)\.env(\.|$)',         'Nemodifikovat .env soubory — obsahují secrets (API klíče, DB credentials).',                  TRUE),
  (gen_random_uuid()::TEXT, 'forbidden', 'path_pattern', '(^|/)secrets/',            'Adresář secrets/ je z principu mimo agenta — credentials, certifikáty, klíče.',                TRUE),
  (gen_random_uuid()::TEXT, 'forbidden', 'path_pattern', '\.(key|pem)$',             'Privátní klíče (.key, .pem) — kryptografické materiály mimo agenta.',                          TRUE),
  (gen_random_uuid()::TEXT, 'forbidden', 'path_pattern', '(^|/)migrations/',         'Prisma migrace jsou historie schématu — agent je nesmí přepisovat ani mazat.',                 TRUE),
  (gen_random_uuid()::TEXT, 'forbidden', 'path_pattern', '(^|/)node_modules/',       'node_modules je build artefakt, ne zdrojový kód. Agent nesmí měnit obsah balíčků.',             TRUE),
  (gen_random_uuid()::TEXT, 'forbidden', 'path_pattern', '\.git/',                   'Git interní data — agent nesmí přepisovat refs, hooks ani objekty.',                            TRUE);
