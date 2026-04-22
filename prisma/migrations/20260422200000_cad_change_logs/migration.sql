-- Historie změn CAD výkresů — váha + poznámka při každém úspěšném importu.
CREATE TABLE "cad_drawing_change_logs" (
    "id" SERIAL NOT NULL,
    "drawing_id" INTEGER NOT NULL,
    "author_id" INTEGER,
    "action" VARCHAR(20) NOT NULL,
    "weight" VARCHAR(20),
    "note" TEXT,
    "old_version" INTEGER,
    "new_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cad_drawing_change_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cad_drawing_change_logs_drawing_id_idx" ON "cad_drawing_change_logs"("drawing_id");
CREATE INDEX "cad_drawing_change_logs_created_at_idx" ON "cad_drawing_change_logs"("created_at");

ALTER TABLE "cad_drawing_change_logs"
    ADD CONSTRAINT "cad_drawing_change_logs_drawing_id_fkey"
    FOREIGN KEY ("drawing_id") REFERENCES "cad_drawings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cad_drawing_change_logs"
    ADD CONSTRAINT "cad_drawing_change_logs_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
