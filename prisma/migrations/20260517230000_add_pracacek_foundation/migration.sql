-- Migration: add_pracacek_foundation
-- Fáze 0 mobilní aplikace Pracáček: datový základ pro denní plán, úkoly,
-- chat nad úkolem, zpětnou vazbu, skill profil, registrovaná zařízení (Expo
-- push tokeny), docházku přes GPS a geo fence kolem provozu.
--
-- Auth model: Person dostává PIN hash + jednorázový aktivační kód. Po
-- aktivaci aplikace si zařízení registruje vlastní device_token_hash, který
-- pak slouží jako bearer pro mobile API (oddělené od HolyOS web JWT).

-- ─── Rozšíření Person ─────────────────────────────────────────────────────
ALTER TABLE "people"
  ADD COLUMN IF NOT EXISTS "pracacek_pin_hash"               VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "pracacek_activation_code"        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "pracacek_activation_expires_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pracacek_activated_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pracacek_quiet_from"             VARCHAR(5),
  ADD COLUMN IF NOT EXISTS "pracacek_quiet_to"               VARCHAR(5);

-- ─── DailyPlan ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pracacek_daily_plans" (
  "id"                SERIAL PRIMARY KEY,
  "person_id"         INTEGER NOT NULL,
  "date"              DATE NOT NULL,
  "generated_by"      VARCHAR(20) NOT NULL DEFAULT 'system',
  "generated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "morning_pushed_at" TIMESTAMP(3),
  "evening_pushed_at" TIMESTAMP(3),
  "status"            VARCHAR(20) NOT NULL DEFAULT 'draft',
  "ai_summary"        TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pracacek_daily_plans_person_id_fkey" FOREIGN KEY ("person_id")
    REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pracacek_daily_plans_person_id_date_key" UNIQUE ("person_id", "date")
);
CREATE INDEX IF NOT EXISTS "pracacek_daily_plans_date_status_idx"
  ON "pracacek_daily_plans"("date", "status");

-- ─── GeoFence ─────────────────────────────────────────────────────────────
-- Vytváříme PŘED TaskAssignment a AttendancePunch (FK reference).
CREATE TABLE IF NOT EXISTS "pracacek_geo_fences" (
  "id"          SERIAL PRIMARY KEY,
  "name"        VARCHAR(255) NOT NULL,
  "center_lat"  DOUBLE PRECISION NOT NULL,
  "center_lng"  DOUBLE PRECISION NOT NULL,
  "radius_m"    INTEGER NOT NULL DEFAULT 150,
  "active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "notes"       TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── TaskAssignment ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pracacek_task_assignments" (
  "id"                    SERIAL PRIMARY KEY,
  "daily_plan_id"         INTEGER,
  "person_id"             INTEGER NOT NULL,
  "created_by"            VARCHAR(20) NOT NULL DEFAULT 'system',
  "created_by_person_id"  INTEGER,
  "source"                VARCHAR(30) NOT NULL DEFAULT 'manager',
  "source_ref_type"       VARCHAR(50),
  "source_ref_id"         INTEGER,
  "title"                 VARCHAR(500) NOT NULL,
  "description"           TEXT,
  "priority"              INTEGER NOT NULL DEFAULT 3,
  "estimated_min"         INTEGER,
  "due_at"                TIMESTAMP(3),
  "status"                VARCHAR(20) NOT NULL DEFAULT 'proposed',
  "accepted_at"           TIMESTAMP(3),
  "started_at"            TIMESTAMP(3),
  "completed_at"          TIMESTAMP(3),
  "blocked_at"            TIMESTAMP(3),
  "blocked_reason"        TEXT,
  "cancelled_at"          TIMESTAMP(3),
  "cancel_reason"         VARCHAR(500),
  "actual_min"            INTEGER,
  "location_hint"         VARCHAR(255),
  "requires_gps_fence"    BOOLEAN NOT NULL DEFAULT FALSE,
  "fence_id"              INTEGER,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pracacek_task_assignments_daily_plan_id_fkey" FOREIGN KEY ("daily_plan_id")
    REFERENCES "pracacek_daily_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pracacek_task_assignments_person_id_fkey" FOREIGN KEY ("person_id")
    REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pracacek_task_assignments_created_by_person_id_fkey" FOREIGN KEY ("created_by_person_id")
    REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pracacek_task_assignments_fence_id_fkey" FOREIGN KEY ("fence_id")
    REFERENCES "pracacek_geo_fences"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pracacek_task_assignments_person_id_status_idx"
  ON "pracacek_task_assignments"("person_id", "status");
CREATE INDEX IF NOT EXISTS "pracacek_task_assignments_due_at_idx"
  ON "pracacek_task_assignments"("due_at");
CREATE INDEX IF NOT EXISTS "pracacek_task_assignments_daily_plan_id_idx"
  ON "pracacek_task_assignments"("daily_plan_id");
CREATE INDEX IF NOT EXISTS "pracacek_task_assignments_source_idx"
  ON "pracacek_task_assignments"("source", "source_ref_type", "source_ref_id");

-- ─── TaskMessage ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pracacek_task_messages" (
  "id"               SERIAL PRIMARY KEY,
  "task_id"          INTEGER NOT NULL,
  "author_kind"      VARCHAR(20) NOT NULL,
  "author_person_id" INTEGER,
  "body"             TEXT NOT NULL,
  "attachments"      JSONB,
  "read_at"          TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pracacek_task_messages_task_id_fkey" FOREIGN KEY ("task_id")
    REFERENCES "pracacek_task_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pracacek_task_messages_author_person_id_fkey" FOREIGN KEY ("author_person_id")
    REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pracacek_task_messages_task_id_created_at_idx"
  ON "pracacek_task_messages"("task_id", "created_at");

-- ─── TaskFeedback ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pracacek_task_feedbacks" (
  "id"              SERIAL PRIMARY KEY,
  "task_id"         INTEGER NOT NULL UNIQUE,
  "self_rating"     INTEGER,
  "difficulty"      INTEGER,
  "time_actual_min" INTEGER,
  "blockers"        TEXT,
  "free_text"       TEXT,
  "ai_summary"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pracacek_task_feedbacks_task_id_fkey" FOREIGN KEY ("task_id")
    REFERENCES "pracacek_task_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── EveningReflection ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pracacek_evening_reflections" (
  "id"              SERIAL PRIMARY KEY,
  "person_id"       INTEGER NOT NULL,
  "date"            DATE NOT NULL,
  "mood"            INTEGER,
  "energy"          INTEGER,
  "wins"            TEXT,
  "struggles"       TEXT,
  "tomorrow_focus"  TEXT,
  "free_text"       TEXT,
  "ai_summary"      TEXT,
  "submitted_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pracacek_evening_reflections_person_id_fkey" FOREIGN KEY ("person_id")
    REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pracacek_evening_reflections_person_id_date_key" UNIQUE ("person_id", "date")
);
CREATE INDEX IF NOT EXISTS "pracacek_evening_reflections_date_idx"
  ON "pracacek_evening_reflections"("date");

-- ─── PersonSkillProfile ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pracacek_skill_profiles" (
  "id"              SERIAL PRIMARY KEY,
  "person_id"       INTEGER NOT NULL UNIQUE,
  "skills"          JSONB NOT NULL DEFAULT '[]'::jsonb,
  "preferred_shift" VARCHAR(20),
  "speed_factor"    DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "notes"           TEXT,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pracacek_skill_profiles_person_id_fkey" FOREIGN KEY ("person_id")
    REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── DeviceRegistration ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pracacek_device_registrations" (
  "id"                 SERIAL PRIMARY KEY,
  "person_id"          INTEGER NOT NULL,
  "expo_push_token"    VARCHAR(255) NOT NULL UNIQUE,
  "device_token_hash"  VARCHAR(255) NOT NULL,
  "platform"           VARCHAR(10) NOT NULL,
  "device_label"       VARCHAR(255),
  "app_version"        VARCHAR(30),
  "os_version"         VARCHAR(30),
  "last_seen_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "active"             BOOLEAN NOT NULL DEFAULT TRUE,
  "revoked_at"         TIMESTAMP(3),
  "revoke_reason"      VARCHAR(255),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pracacek_device_registrations_person_id_fkey" FOREIGN KEY ("person_id")
    REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pracacek_device_registrations_person_id_active_idx"
  ON "pracacek_device_registrations"("person_id", "active");

-- ─── AttendancePunch ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pracacek_attendance_punches" (
  "id"                  SERIAL PRIMARY KEY,
  "person_id"           INTEGER NOT NULL,
  "kind"                VARCHAR(20) NOT NULL,
  "source"              VARCHAR(30) NOT NULL DEFAULT 'pracacek_gps',
  "lat"                 DOUBLE PRECISION,
  "lng"                 DOUBLE PRECISION,
  "accuracy_m"          DOUBLE PRECISION,
  "inside_fence"        BOOLEAN NOT NULL DEFAULT FALSE,
  "fence_id"            INTEGER,
  "punched_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by_user_id" INTEGER,
  "approved_at"         TIMESTAMP(3),
  "notes"               TEXT,
  CONSTRAINT "pracacek_attendance_punches_person_id_fkey" FOREIGN KEY ("person_id")
    REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pracacek_attendance_punches_fence_id_fkey" FOREIGN KEY ("fence_id")
    REFERENCES "pracacek_geo_fences"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pracacek_attendance_punches_person_id_punched_at_idx"
  ON "pracacek_attendance_punches"("person_id", "punched_at");
CREATE INDEX IF NOT EXISTS "pracacek_attendance_punches_fence_id_idx"
  ON "pracacek_attendance_punches"("fence_id");
