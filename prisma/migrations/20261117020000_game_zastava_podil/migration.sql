-- Zástava podílem u půjčky mezi hráči.
-- Dosud šlo ručit jen prádlomatem (zastava_spot) nebo ničím. Teď jde dát
-- v sázku kus vlastní firmy: při první nezaplacené splátce přejde věřiteli
-- a ten s ním naloží, jak chce.
ALTER TABLE "game_loans" ADD COLUMN IF NOT EXISTS "zastava_podil" DOUBLE PRECISION;
