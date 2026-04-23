# HolyOS — Sklad 2.0 | Migrace bez shadow DB (pro Railway / produkci)
#
# Proč: `prisma migrate dev` vyžaduje shadow DB a aplikuje celou historii migrací,
# což selhává kvůli rozbité pořadí existujících migrací.
# Místo toho použijeme `prisma migrate diff` → SQL → `db execute` → `migrate resolve`.
#
# KROK 1 tohoto skriptu: jen VYGENERUJE SQL, nic nespustí proti DB.
#        Výstup si prohlédneš a teprve potom spustíš "apply" část ručně.

$ErrorActionPreference = 'Stop'

$ts = Get-Date -Format "yyyyMMddHHmmss"
$migName = "${ts}_sklad_2_pwa_tisk"
$migDir = "prisma/migrations/$migName"
$migFile = "$migDir/migration.sql"

Write-Host "Vytvářím adresář migrace: $migDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $migDir -Force | Out-Null

Write-Host "Generuji diff SQL (schema vs. aktuální DB)..." -ForegroundColor Cyan
# --from-schema-datasource: Prisma se připojí k DB uvedené v schema.prisma
#   (DATABASE_URL načte přes dotenv z .env, stejně jako běžné Prisma operace).
# --to-schema-datamodel:    cílový stav podle modelů v schema.prisma.
# Pozor: `Out-File -Encoding utf8` v PS 5.1 zapisuje BOM, kvůli kterému Postgres
# hlásí "syntax error at or near ''" v `prisma db execute`. Použij utf8NoBOM (PS 7)
# nebo zapiš binárně přes .NET API.
$sql = npx prisma migrate diff `
  --from-schema-datasource prisma/schema.prisma `
  --to-schema-datamodel prisma/schema.prisma `
  --script
# WriteAllText s UTF8Encoding($false) zapisuje bez BOM v obou PS 5.1 i 7.
[System.IO.File]::WriteAllText(
    (Join-Path (Resolve-Path .) $migFile),
    ($sql -join "`r`n"),
    (New-Object System.Text.UTF8Encoding $false)
)

if (-not (Test-Path $migFile)) {
    Write-Host "CHYBA: soubor $migFile se nevytvořil." -ForegroundColor Red
    exit 1
}

$size = (Get-Item $migFile).Length
Write-Host ""
Write-Host "Migrace vygenerovaná: $migFile ($size bytů)" -ForegroundColor Green
Write-Host ""
Write-Host "--- Obsah migrace: ----------------------------------------------------"
Get-Content $migFile
Write-Host "-----------------------------------------------------------------------"
Write-Host ""
Write-Host "Projdi výstup výše." -ForegroundColor Yellow
Write-Host "Pokud vypadá OK, pokračuj dalším skriptem:" -ForegroundColor Yellow
Write-Host "    node scripts/apply-sklad2-migration.js `"$migName`"" -ForegroundColor Yellow
