-- Příchozí SMS na naše čísla (Infolinka) přes Twilio Messaging webhook.
CREATE TABLE "inbound_sms" (
    "id" SERIAL NOT NULL,
    "line" VARCHAR(32),
    "from_number" VARCHAR(40) NOT NULL,
    "to_number" VARCHAR(40) NOT NULL,
    "body" TEXT,
    "message_sid" VARCHAR(64),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbound_sms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inbound_sms_message_sid_key" ON "inbound_sms"("message_sid");
CREATE INDEX "inbound_sms_line_idx" ON "inbound_sms"("line");
CREATE INDEX "inbound_sms_created_at_idx" ON "inbound_sms"("created_at");
