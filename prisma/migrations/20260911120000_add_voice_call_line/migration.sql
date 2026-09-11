-- Příchozí linka u hovoru: obchod | infolinka (null = starý záznam / odchozí kampaň).
-- Umožní oddělit záznamy hovorů Infolinky (Servis) od obchodní recepční.
ALTER TABLE "voice_calls" ADD COLUMN "line" VARCHAR(32);
CREATE INDEX "voice_calls_line_idx" ON "voice_calls"("line");
