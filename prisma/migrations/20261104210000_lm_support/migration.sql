-- Podpora Laundromats (chat)
CREATE TABLE IF NOT EXISTS "lm_support_messages" (
  "id" SERIAL NOT NULL,
  "account_id" INTEGER NOT NULL,
  "sender" VARCHAR(10) NOT NULL,
  "agent_name" VARCHAR(80),
  "body" TEXT NOT NULL,
  "read_by_agent" BOOLEAN NOT NULL DEFAULT false,
  "read_by_user" BOOLEAN NOT NULL DEFAULT false,
  "file_name" VARCHAR(200),
  "file_type" VARCHAR(100),
  "file_size" INTEGER,
  "file_data" BYTEA,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lm_support_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lm_support_messages_account_id_created_at_idx" ON "lm_support_messages"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "lm_support_messages_sender_read_by_agent_idx" ON "lm_support_messages"("sender", "read_by_agent");
