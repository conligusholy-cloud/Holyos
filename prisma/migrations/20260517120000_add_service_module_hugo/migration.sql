-- Migration: add_service_module_hugo
-- Modul Servis + AI servisák Hugo pro partnery na bestseries.cash.
--
-- Tabulky:
--   service_categories          — kategorie znalostních článků (Mechanika, Elektro…)
--   service_appliances          — spotřebiče v produktech (motor, čerpadlo, displej…)
--   service_product_appliances  — M:N Product ↔ Appliance s pozicí v produktu
--   service_articles            — návody, řešené případy, kontrolní postupy, FAQ
--   service_article_products    — M:N článek ↔ produkty
--   service_article_appliances  — M:N článek ↔ spotřebiče
--   service_article_attachments — PDF/foto/video k článku
--   service_article_embeddings  — pgvector chunky pro RAG (schema připraveno, MVP neaktivní)
--   partner_accounts            — externí login partnera pro Huga (oddělený od User)
--   partner_product_access      — M:N partner ↔ produkty (Hugo retrieval filter)
--   service_chat_sessions       — chat session s Hugem
--   service_chat_messages       — zprávy v sessions
--   service_chat_citations      — strukturované citace článků v Hugově odpovědi
--
-- Idempotentní — všechny příkazy přežijí opakované spuštění (Railway pattern).

-- =====================================================================
-- service_categories
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_categories" (
  "id"          SERIAL PRIMARY KEY,
  "name"        VARCHAR(100) NOT NULL,
  "slug"        VARCHAR(120) NOT NULL,
  "icon"        VARCHAR(10),
  "color"       VARCHAR(20),
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_categories_name_key" ON "service_categories"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "service_categories_slug_key" ON "service_categories"("slug");

-- =====================================================================
-- service_appliances
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_appliances" (
  "id"           SERIAL PRIMARY KEY,
  "name"         VARCHAR(255) NOT NULL,
  "manufacturer" VARCHAR(255),
  "model_code"   VARCHAR(100),
  "description"  TEXT,
  "manual_url"   VARCHAR(500),
  "photo_url"    VARCHAR(500),
  "material_id"  INTEGER,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "service_appliances_material_id_idx" ON "service_appliances"("material_id");

-- =====================================================================
-- service_product_appliances
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_product_appliances" (
  "id"           SERIAL PRIMARY KEY,
  "product_id"   INTEGER NOT NULL,
  "appliance_id" INTEGER NOT NULL,
  "position"     VARCHAR(255),
  "quantity"     INTEGER NOT NULL DEFAULT 1,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_product_appliances_appliance_id_fkey" FOREIGN KEY ("appliance_id")
    REFERENCES "service_appliances"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_product_appliances_product_appliance_key"
  ON "service_product_appliances"("product_id", "appliance_id");
CREATE INDEX IF NOT EXISTS "service_product_appliances_product_id_idx" ON "service_product_appliances"("product_id");
CREATE INDEX IF NOT EXISTS "service_product_appliances_appliance_id_idx" ON "service_product_appliances"("appliance_id");

-- =====================================================================
-- service_articles
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_articles" (
  "id"                 SERIAL PRIMARY KEY,
  "title"              VARCHAR(500) NOT NULL,
  "slug"               VARCHAR(550) NOT NULL,
  "kind"               VARCHAR(20)  NOT NULL DEFAULT 'GUIDE',
  "summary"            VARCHAR(1000),
  "body_md"            TEXT NOT NULL,
  "body_search"        TEXT,
  "tags"               JSONB NOT NULL DEFAULT '[]'::jsonb,
  "visibility"         VARCHAR(20) NOT NULL DEFAULT 'partner',
  "status"             VARCHAR(20) NOT NULL DEFAULT 'draft',
  "category_id"        INTEGER,
  "author_person_id"   INTEGER,
  "views_count"        INTEGER NOT NULL DEFAULT 0,
  "helpful_count"      INTEGER NOT NULL DEFAULT 0,
  "not_helpful_count"  INTEGER NOT NULL DEFAULT 0,
  "published_at"       TIMESTAMP(3),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_articles_category_id_fkey" FOREIGN KEY ("category_id")
    REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_articles_slug_key" ON "service_articles"("slug");
CREATE INDEX IF NOT EXISTS "service_articles_kind_idx" ON "service_articles"("kind");
CREATE INDEX IF NOT EXISTS "service_articles_status_idx" ON "service_articles"("status");
CREATE INDEX IF NOT EXISTS "service_articles_visibility_idx" ON "service_articles"("visibility");
CREATE INDEX IF NOT EXISTS "service_articles_category_id_idx" ON "service_articles"("category_id");
CREATE INDEX IF NOT EXISTS "service_articles_author_person_id_idx" ON "service_articles"("author_person_id");
-- Fulltext index nad title + body_search pro Hugo retrieval (MVP bez embeddings).
-- Pomocí trigram pattern matching pro ILIKE search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "service_articles_title_trgm_idx" ON "service_articles" USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "service_articles_body_search_trgm_idx" ON "service_articles" USING gin (body_search gin_trgm_ops);

-- =====================================================================
-- service_article_products (M:N)
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_article_products" (
  "id"         SERIAL PRIMARY KEY,
  "article_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  CONSTRAINT "service_article_products_article_id_fkey" FOREIGN KEY ("article_id")
    REFERENCES "service_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_article_products_article_product_key"
  ON "service_article_products"("article_id", "product_id");
CREATE INDEX IF NOT EXISTS "service_article_products_product_id_idx" ON "service_article_products"("product_id");

-- =====================================================================
-- service_article_appliances (M:N)
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_article_appliances" (
  "id"           SERIAL PRIMARY KEY,
  "article_id"   INTEGER NOT NULL,
  "appliance_id" INTEGER NOT NULL,
  CONSTRAINT "service_article_appliances_article_id_fkey" FOREIGN KEY ("article_id")
    REFERENCES "service_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_article_appliances_appliance_id_fkey" FOREIGN KEY ("appliance_id")
    REFERENCES "service_appliances"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_article_appliances_article_appliance_key"
  ON "service_article_appliances"("article_id", "appliance_id");
CREATE INDEX IF NOT EXISTS "service_article_appliances_appliance_id_idx" ON "service_article_appliances"("appliance_id");

-- =====================================================================
-- service_article_attachments
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_article_attachments" (
  "id"          SERIAL PRIMARY KEY,
  "article_id"  INTEGER NOT NULL,
  "title"       VARCHAR(255) NOT NULL,
  "file_path"   VARCHAR(500),
  "url"         VARCHAR(500),
  "mime_type"   VARCHAR(80),
  "size_bytes"  INTEGER,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_article_attachments_article_id_fkey" FOREIGN KEY ("article_id")
    REFERENCES "service_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "service_article_attachments_article_id_idx" ON "service_article_attachments"("article_id");

-- =====================================================================
-- service_article_embeddings (schema připraveno, MVP neaktivní)
-- Vlastní vector column doplníme později přes raw SQL:
--   ALTER TABLE service_article_embeddings ADD COLUMN embedding vector(1536);
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_article_embeddings" (
  "id"          SERIAL PRIMARY KEY,
  "article_id"  INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL DEFAULT 0,
  "chunk_text"  TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_article_embeddings_article_id_fkey" FOREIGN KEY ("article_id")
    REFERENCES "service_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "service_article_embeddings_article_id_idx" ON "service_article_embeddings"("article_id");

-- =====================================================================
-- partner_accounts — login partnera pro Huga
-- =====================================================================
CREATE TABLE IF NOT EXISTS "partner_accounts" (
  "id"                SERIAL PRIMARY KEY,
  "username"          VARCHAR(100) NOT NULL,
  "email"             VARCHAR(255),
  "phone"             VARCHAR(20),
  "display_name"      VARCHAR(255) NOT NULL,
  "password_hash"     VARCHAR(255) NOT NULL,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "company_id"        INTEGER,
  "contact_person_id" INTEGER,
  "language"          VARCHAR(5) NOT NULL DEFAULT 'cs',
  "last_login_at"     TIMESTAMP(3),
  "last_ip"           VARCHAR(45),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_accounts_company_id_fkey" FOREIGN KEY ("company_id")
    REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_accounts_username_key" ON "partner_accounts"("username");
CREATE INDEX IF NOT EXISTS "partner_accounts_company_id_idx" ON "partner_accounts"("company_id");
CREATE INDEX IF NOT EXISTS "partner_accounts_active_idx" ON "partner_accounts"("active");

-- =====================================================================
-- partner_product_access — M:N partner ↔ produkty
-- =====================================================================
CREATE TABLE IF NOT EXISTS "partner_product_access" (
  "id"         SERIAL PRIMARY KEY,
  "partner_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "serial_no"  VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_product_access_partner_id_fkey" FOREIGN KEY ("partner_id")
    REFERENCES "partner_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- NULL je distinct v PostgreSQL unique — partner může mít víc kusů stejného produktu bez serial_no
CREATE UNIQUE INDEX IF NOT EXISTS "partner_product_access_partner_product_serial_key"
  ON "partner_product_access"("partner_id", "product_id", "serial_no");
CREATE INDEX IF NOT EXISTS "partner_product_access_product_id_idx" ON "partner_product_access"("product_id");

-- =====================================================================
-- service_chat_sessions
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_chat_sessions" (
  "id"              SERIAL PRIMARY KEY,
  "partner_id"      INTEGER NOT NULL,
  "title"           VARCHAR(500),
  "language"        VARCHAR(5) NOT NULL DEFAULT 'cs',
  "status"          VARCHAR(20) NOT NULL DEFAULT 'active',
  "message_count"   INTEGER NOT NULL DEFAULT 0,
  "needs_attention" BOOLEAN NOT NULL DEFAULT false,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at"       TIMESTAMP(3),
  CONSTRAINT "service_chat_sessions_partner_id_fkey" FOREIGN KEY ("partner_id")
    REFERENCES "partner_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "service_chat_sessions_partner_id_idx" ON "service_chat_sessions"("partner_id");
CREATE INDEX IF NOT EXISTS "service_chat_sessions_status_idx" ON "service_chat_sessions"("status");
CREATE INDEX IF NOT EXISTS "service_chat_sessions_needs_attention_idx" ON "service_chat_sessions"("needs_attention");

-- =====================================================================
-- service_chat_messages
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_chat_messages" (
  "id"                    SERIAL PRIMARY KEY,
  "session_id"            INTEGER NOT NULL,
  "role"                  VARCHAR(20) NOT NULL,
  "body"                  TEXT NOT NULL,
  "retrieved_article_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "feedback"              VARCHAR(20),
  "tokens_input"          INTEGER,
  "tokens_output"         INTEGER,
  "model"                 VARCHAR(50),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_chat_messages_session_id_fkey" FOREIGN KEY ("session_id")
    REFERENCES "service_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "service_chat_messages_session_id_idx" ON "service_chat_messages"("session_id");
CREATE INDEX IF NOT EXISTS "service_chat_messages_role_idx" ON "service_chat_messages"("role");

-- =====================================================================
-- service_chat_citations
-- =====================================================================
CREATE TABLE IF NOT EXISTS "service_chat_citations" (
  "id"         SERIAL PRIMARY KEY,
  "message_id" INTEGER NOT NULL,
  "article_id" INTEGER NOT NULL,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_chat_citations_message_id_fkey" FOREIGN KEY ("message_id")
    REFERENCES "service_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_chat_citations_article_id_fkey" FOREIGN KEY ("article_id")
    REFERENCES "service_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "service_chat_citations_message_id_idx" ON "service_chat_citations"("message_id");
CREATE INDEX IF NOT EXISTS "service_chat_citations_article_id_idx" ON "service_chat_citations"("article_id");

-- =====================================================================
-- Seed základních kategorií (idempotentní přes ON CONFLICT)
-- =====================================================================
INSERT INTO "service_categories" ("name", "slug", "icon", "color", "sort_order") VALUES
  ('Mechanika',  'mechanika',  '⚙️', '#f59e0b', 10),
  ('Elektro',    'elektro',    '⚡', '#eab308', 20),
  ('Voda',       'voda',       '💧', '#0ea5e9', 30),
  ('Software',   'software',   '💻', '#8b5cf6', 40),
  ('Údržba',     'udrzba',     '🧹', '#10b981', 50),
  ('Bezpečnost', 'bezpecnost', '🛡️', '#ef4444', 60),
  ('Obecné',     'obecne',     '📝', '#94a3b8', 99)
ON CONFLICT ("slug") DO NOTHING;
