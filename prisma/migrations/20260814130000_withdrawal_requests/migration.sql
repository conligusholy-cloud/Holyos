-- Výběry: požadavky zákazníků na výběr (evidence + kontrola)
CREATE TABLE "withdrawal_request" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "withdrawal_number" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'novy',
    "status_log" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withdrawal_request_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "withdrawal_request_email_idx" ON "withdrawal_request"("email");
CREATE INDEX "withdrawal_request_status_idx" ON "withdrawal_request"("status");
