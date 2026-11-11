-- Odkud návštěvník přišel, přímo u záznamu. Nahrávají se jen lidé z reklamy
-- a u těch bez účtu nebylo kde zdroj vzít — v událostech se neukládá.
ALTER TABLE "game_replays" ADD COLUMN IF NOT EXISTS "zdroj" VARCHAR(80);
