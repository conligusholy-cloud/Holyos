-- =============================================================================
-- HolyOS — Normování (FY read-only) — vlastní DB tabulky pro měření TAC + Tpz
-- =============================================================================
-- Modul `modules/normovani-fy`. FY je read-only zdroj dávek/operací/BOM,
-- start/end události žijí výhradně v těchto tabulkách. FY identifikátory
-- držíme jako stringy bez FK, aby nás nepoložily změny ve FY.

-- CreateTable: session měření jedné operace jedním pracovníkem
CREATE TABLE "normovani_sessions" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "fy_batch_id" VARCHAR(50) NOT NULL,
    "fy_batch_number" VARCHAR(50) NOT NULL,
    "fy_goods_id" VARCHAR(50),
    "fy_goods_code" VARCHAR(100),
    "fy_goods_name" VARCHAR(500),
    "fy_workflow_id" VARCHAR(50),
    "fy_operation_id" VARCHAR(50) NOT NULL,
    "fy_operation_name" VARCHAR(500),
    "workplace_label" VARCHAR(255),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "normovani_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: událost (start = chytl díl, end = díl namontován)
CREATE TABLE "normovani_events" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "event_type" VARCHAR(10) NOT NULL,
    "fy_item_id" VARCHAR(50) NOT NULL,
    "fy_goods_id" VARCHAR(50),
    "item_code" VARCHAR(100),
    "item_name" VARCHAR(500),
    "item_unit" VARCHAR(20),
    "item_qr" VARCHAR(255),
    "quantity" DECIMAL(12,4),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "normovani_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: NormovaniSession
CREATE INDEX "normovani_sessions_person_id_idx" ON "normovani_sessions"("person_id");
CREATE INDEX "normovani_sessions_fy_batch_id_idx" ON "normovani_sessions"("fy_batch_id");
CREATE INDEX "normovani_sessions_fy_operation_id_idx" ON "normovani_sessions"("fy_operation_id");
CREATE INDEX "normovani_sessions_status_idx" ON "normovani_sessions"("status");
CREATE INDEX "normovani_sessions_started_at_idx" ON "normovani_sessions"("started_at");

-- CreateIndex: NormovaniEvent
CREATE INDEX "normovani_events_session_id_occurred_at_idx" ON "normovani_events"("session_id", "occurred_at");
CREATE INDEX "normovani_events_fy_item_id_idx" ON "normovani_events"("fy_item_id");
CREATE INDEX "normovani_events_event_type_idx" ON "normovani_events"("event_type");

-- AddForeignKey
ALTER TABLE "normovani_sessions" ADD CONSTRAINT "normovani_sessions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "normovani_events" ADD CONSTRAINT "normovani_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "normovani_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
