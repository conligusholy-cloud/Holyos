-- CreateTable
CREATE TABLE "dev_agents" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "icon" VARCHAR(10) NOT NULL DEFAULT '🤖',
    "module" VARCHAR(100),
    "context_file" VARCHAR(255),
    "system_prompt" TEXT NOT NULL,
    "model" VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-6',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color" VARCHAR(20) NOT NULL DEFAULT '#8b5cf6',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dev_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dev_agents_slug_key" ON "dev_agents"("slug");
