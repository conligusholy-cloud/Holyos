-- Mix-autonomy podle typu úkolu (brief kap. 6.4 + 5.2). Přidává:
--   change_type: typ změny (documentation | ui_change | bug_fix | refactor |
--     new_feature | integration | data_migration). Mapuje se na výchozí
--     autonomy v services/ai-developer/autonomy.js.
--   autonomy_override: per-task přepsání mapping (volitelné).

ALTER TABLE "admin_tasks"
  ADD COLUMN IF NOT EXISTS "change_type" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "autonomy_override" VARCHAR(20);
