-- E-mailová brána Amazon SES: log odeslaných e-mailů + události (open/click/delivery/bounce/complaint)
CREATE TABLE IF NOT EXISTS "email_messages" (
  "id"            TEXT NOT NULL,
  "to"            VARCHAR(255) NOT NULL,
  "subject"       VARCHAR(500) NOT NULL,
  "status"        VARCHAR(40) NOT NULL,
  "messageId"     VARCHAR(255),
  "sesMessageId"  VARCHAR(120),
  "campaignId"    VARCHAR(80),
  "leadId"        INTEGER,
  "opened"        BOOLEAN NOT NULL DEFAULT false,
  "clicked"       BOOLEAN NOT NULL DEFAULT false,
  "delivered"     BOOLEAN NOT NULL DEFAULT false,
  "bounced"       BOOLEAN NOT NULL DEFAULT false,
  "unsubscribed"  BOOLEAN NOT NULL DEFAULT false,
  "note"          VARCHAR(500),
  "openedAt"      TIMESTAMP(3),
  "clickedAt"     TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_messages_sesMessageId_key" ON "email_messages"("sesMessageId");
CREATE INDEX IF NOT EXISTS "email_messages_sesMessageId_idx" ON "email_messages"("sesMessageId");
CREATE INDEX IF NOT EXISTS "email_messages_to_idx" ON "email_messages"("to");
CREATE INDEX IF NOT EXISTS "email_messages_createdAt_idx" ON "email_messages"("createdAt");
CREATE INDEX IF NOT EXISTS "email_messages_leadId_idx" ON "email_messages"("leadId");
