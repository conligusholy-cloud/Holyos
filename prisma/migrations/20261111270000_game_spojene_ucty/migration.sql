-- Stopa po tom, odkud účet vznikl. Nepřidává se tím nic nového, co bychom už
-- nevěděli — IP i prohlížeč se ukládají ke každé události hry. Tady jsou u
-- účtu, aby se dalo poznat, že si jeden člověk zakládá účty sám na sebe a
-- vybírá provize za vlastní pozvánky.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "dev_pid" VARCHAR(24);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "reg_ip" VARCHAR(64);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "reg_ua" TEXT;
CREATE INDEX IF NOT EXISTS "game_players_dev_pid_idx" ON "game_players"("dev_pid");
CREATE INDEX IF NOT EXISTS "game_players_reg_ip_idx" ON "game_players"("reg_ip");
