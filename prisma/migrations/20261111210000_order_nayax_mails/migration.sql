-- Naplánovaný e-mail se zakládáním Nayax účtu (X dní po první platbě)
CREATE TABLE IF NOT EXISTS "order_nayax_mails" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "send_at" TIMESTAMP(3) NOT NULL,
  "sent_at" TIMESTAMP(3),
  "to_email" VARCHAR(255),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_nayax_mails_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "order_nayax_mails_order_id_key" ON "order_nayax_mails"("order_id");
CREATE INDEX IF NOT EXISTS "order_nayax_mails_sent_at_send_at_idx" ON "order_nayax_mails"("sent_at", "send_at");
