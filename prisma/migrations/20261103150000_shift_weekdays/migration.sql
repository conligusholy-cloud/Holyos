-- Dny v týdnu u směny (pole čísel 1-7, ISO: 1 = pondělí). NULL = neurčeno,
-- což platí i pro směny založené před touto změnou.
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "weekdays" JSONB;
