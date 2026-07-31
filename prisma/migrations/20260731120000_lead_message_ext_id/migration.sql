-- Identifikátor externí zprávy u příchozích e-mailových odpovědí (dedup příchozích).
ALTER TABLE "lead_messages" ADD COLUMN "ext_message_id" VARCHAR(500);
CREATE UNIQUE INDEX "lead_messages_ext_message_id_key" ON "lead_messages"("ext_message_id");
