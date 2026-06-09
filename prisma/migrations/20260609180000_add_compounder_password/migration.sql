-- Compounder: heslo pro přihlášení (bcrypt hash), nullable (null = jen magic link)
ALTER TABLE "compounder_leads" ADD COLUMN "password_hash" TEXT;
