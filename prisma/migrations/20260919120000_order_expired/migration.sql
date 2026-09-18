-- Objednávka nepodepsaná do 24 h → status 'expired' + uvolnění slotů (worker)
ALTER TABLE "orders" ADD COLUMN "expired_at" TIMESTAMP(3);
