# HolyOS — Plánovač Fáze 1 | Migrace bez shadow DB (pro Railway / produkci)
#
# Generuje SQL diff pro novou sekci PLÁNOVAČ:
#   - Competency, WorkerCompetency, OperationRequiredCompetency
#   - BomSnapshot, BomSnapshotItem
#   - ProductionBatch, BatchOperation, BatchOperationLog
#   - Rozšíření: Workstation.flow_type, Product.batch sizes,
#     SlotAssignment.batch_id, ProductOperation.from_factorify/calibration
#
# Workflow per holyos_prisma_migrate_workflow:
#   diff → SQL → db execute → migrate resolve → generate.
#
# KROK 1 tohoto skriptu: jen VYGENERUJE SQL, nic nespustí proti DB.

$ErrorActionPreference = 'Stop'

$ts = Get-Date -Format "yyyyMMddHHmmss"
$migName = "${ts}_pridej-davky-kompetence-bom-snapshot"
$migDir = "prisma/migrations/$migName"
$migFile = "$migDir/migration.sql"

Write-Host "Vytvářím adresář migrace: $migDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $migDir -Force | Out-Null

Write-Host "Generuji diff SQL (schema vs. aktuální DB)..." -ForegroundColor Cyan
$sql = npx prisma migrate diff `
  --from-schema-datasource prisma/schema.prisma `
  --to-schema-datamodel prisma/schema.prisma `
  --script

# UTF-8 bez BOM (PS 5.1 by jinak vložil BOM a Postgres by hlásil syntax error).
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
Write-Host "    node scripts/apply-planovac-f1-migration.js `"$migName`"" -ForegroundColor Yellow
