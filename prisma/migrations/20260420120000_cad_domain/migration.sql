-- CreateTable
CREATE TABLE "cad_projects" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "customer" VARCHAR(255),
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cad_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cad_blocks" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "label" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cad_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cad_drawings" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "block_id" INTEGER,
    "file_name" VARCHAR(255) NOT NULL,
    "relative_path" VARCHAR(500),
    "extension" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "checksum" VARCHAR(64),
    "source_path" VARCHAR(1000),
    "title" VARCHAR(255),
    "description" TEXT,
    "created_by_id" INTEGER,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_import_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cad_drawings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cad_drawing_configs" (
    "id" SERIAL NOT NULL,
    "drawing_id" INTEGER NOT NULL,
    "config_name" VARCHAR(255) NOT NULL,
    "config_code" VARCHAR(100),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "custom_properties" JSONB NOT NULL DEFAULT '{}',
    "mass_grams" DECIMAL(12,3),
    "png_path" VARCHAR(500),
    "pdf_path" VARCHAR(500),
    "external_references" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cad_drawing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cad_components" (
    "id" SERIAL NOT NULL,
    "parent_config_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "path" VARCHAR(1000),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "configuration" VARCHAR(255),
    "custom_properties" JSONB,
    "is_unknown" BOOLEAN NOT NULL DEFAULT false,
    "material_id" INTEGER,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cad_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cad_projects_code_key" ON "cad_projects"("code");

-- CreateIndex
CREATE INDEX "cad_projects_code_idx" ON "cad_projects"("code");

-- CreateIndex
CREATE INDEX "cad_projects_active_idx" ON "cad_projects"("active");

-- CreateIndex
CREATE INDEX "cad_blocks_project_id_idx" ON "cad_blocks"("project_id");

-- CreateIndex
CREATE INDEX "cad_blocks_parent_id_idx" ON "cad_blocks"("parent_id");

-- CreateIndex
CREATE INDEX "cad_drawings_project_id_idx" ON "cad_drawings"("project_id");

-- CreateIndex
CREATE INDEX "cad_drawings_block_id_idx" ON "cad_drawings"("block_id");

-- CreateIndex
CREATE INDEX "cad_drawings_extension_idx" ON "cad_drawings"("extension");

-- CreateIndex
CREATE INDEX "cad_drawings_file_name_idx" ON "cad_drawings"("file_name");

-- CreateIndex
CREATE UNIQUE INDEX "cad_drawings_project_id_file_name_version_key" ON "cad_drawings"("project_id", "file_name", "version");

-- CreateIndex
CREATE INDEX "cad_drawing_configs_drawing_id_idx" ON "cad_drawing_configs"("drawing_id");

-- CreateIndex
CREATE UNIQUE INDEX "cad_drawing_configs_drawing_id_config_name_key" ON "cad_drawing_configs"("drawing_id", "config_name");

-- CreateIndex
CREATE INDEX "cad_components_parent_config_id_idx" ON "cad_components"("parent_config_id");

-- CreateIndex
CREATE INDEX "cad_components_material_id_idx" ON "cad_components"("material_id");

-- CreateIndex
CREATE INDEX "cad_components_is_unknown_idx" ON "cad_components"("is_unknown");

-- AddForeignKey
ALTER TABLE "cad_blocks" ADD CONSTRAINT "cad_blocks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "cad_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cad_blocks" ADD CONSTRAINT "cad_blocks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cad_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cad_drawings" ADD CONSTRAINT "cad_drawings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "cad_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cad_drawings" ADD CONSTRAINT "cad_drawings_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "cad_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cad_drawings" ADD CONSTRAINT "cad_drawings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cad_drawing_configs" ADD CONSTRAINT "cad_drawing_configs_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "cad_drawings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cad_components" ADD CONSTRAINT "cad_components_parent_config_id_fkey" FOREIGN KEY ("parent_config_id") REFERENCES "cad_drawing_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cad_components" ADD CONSTRAINT "cad_components_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
