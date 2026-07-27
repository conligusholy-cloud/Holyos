-- Do-not-contact seznam (jen e-mail + telefon)
CREATE TABLE "compounder_blocklist" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(40),
    "note" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compounder_blocklist_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "compounder_blocklist_email_idx" ON "compounder_blocklist"("email");
CREATE INDEX "compounder_blocklist_phone_idx" ON "compounder_blocklist"("phone");
