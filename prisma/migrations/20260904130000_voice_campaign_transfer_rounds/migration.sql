-- Přepojení: počet koleček (kolikrát projít seznam kontaktů dokola)
ALTER TABLE "voice_campaigns"
  ADD COLUMN "transfer_rounds" INTEGER;
