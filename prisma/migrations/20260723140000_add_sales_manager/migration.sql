-- HolyOS — Autonomní AI vedoucí obchodu: denní plány, úkoly a hodnocení

-- CreateTable
CREATE TABLE "sales_day_plans" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "generated_by" VARCHAR(20) NOT NULL DEFAULT 'ai',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "focus" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'published',
    "morning_pushed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_day_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_tasks" (
    "id" SERIAL NOT NULL,
    "day_plan_id" INTEGER,
    "person_id" INTEGER NOT NULL,
    "lead_id" INTEGER,
    "site_id" INTEGER,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'other',
    "title" VARCHAR(500) NOT NULL,
    "detail" TEXT,
    "reasoning" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "done_at" TIMESTAMP(3),
    "done_note" TEXT,
    "skipped_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_reviews" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "grade" VARCHAR(30),
    "summary" TEXT,
    "highlights" TEXT,
    "improvements" TEXT,
    "metrics" JSONB,
    "pay_currency" VARCHAR(3),
    "pay_base" INTEGER,
    "pay_bonus" INTEGER,
    "pay_commission" INTEGER,
    "pay_total" INTEGER,
    "pay_note" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by_person_id" INTEGER,
    "approved_total" INTEGER,
    "approved_note" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_day_plans_person_id_date_key" ON "sales_day_plans"("person_id", "date");
CREATE INDEX "sales_day_plans_date_idx" ON "sales_day_plans"("date");

CREATE INDEX "sales_tasks_person_id_status_idx" ON "sales_tasks"("person_id", "status");
CREATE INDEX "sales_tasks_day_plan_id_idx" ON "sales_tasks"("day_plan_id");
CREATE INDEX "sales_tasks_lead_id_idx" ON "sales_tasks"("lead_id");

CREATE UNIQUE INDEX "sales_reviews_person_id_kind_period_start_key" ON "sales_reviews"("person_id", "kind", "period_start");
CREATE INDEX "sales_reviews_person_id_kind_idx" ON "sales_reviews"("person_id", "kind");

-- AddForeignKey
ALTER TABLE "sales_tasks" ADD CONSTRAINT "sales_tasks_day_plan_id_fkey" FOREIGN KEY ("day_plan_id") REFERENCES "sales_day_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
