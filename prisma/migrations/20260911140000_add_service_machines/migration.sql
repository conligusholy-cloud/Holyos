-- Stroje v provozu — evidence běžících strojů pro servisní požadavky.
CREATE TABLE "service_machines" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(80),
    "status" VARCHAR(20) NOT NULL DEFAULT 'v_provozu',
    "commissioned_at" DATE,
    "revision_at" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_machines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_machines_status_idx" ON "service_machines"("status");
