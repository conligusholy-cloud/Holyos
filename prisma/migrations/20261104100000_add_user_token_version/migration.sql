-- Zneplatnění přihlašovacích tokenů: verze tokenu uživatele (zvýšením se všechny starší tokeny odhlásí)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" INTEGER NOT NULL DEFAULT 0;
