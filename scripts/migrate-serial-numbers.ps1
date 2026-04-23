# HolyOS — Prisma migrace: přidat model SerialNumber
#
# Workflow proti Railway (per memory holyos_prisma_migrate_workflow):
#   1) prisma migrate diff          → vygeneruje SQL z rozdílu DB ↔ schema.prisma
#   2) prisma db execute            → aplikuje SQL na Railway
#   3) prisma migrate resolve       → zapíše do _prisma_migrations
#   4) prisma generate              → přegeneruje @prisma/client
#
# Pozn.: PS 5.1 `Out-File` / `>` píše UTF-16 BOM. Používáme `Set-Content -Encoding ascii`.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$ts = Get-Date -Format 'yyyyMMddHHmmss'
$name = "${ts}_add_serial_numbers"
$dir = Join-Path 'prisma\migrations' $name

New-Item -ItemType Directory -Path $dir -Force | Out-Null
$sqlPath = Join-Path $dir 'migration.sql'

Write-Host ''
Write-Host "--- 1/4 Diff: generuji migration.sql -------------------" -ForegroundColor Cyan
$sqlLines = npx prisma migrate diff `
  --from-schema-datasource prisma/schema.prisma `
  --to-schema-datamodel prisma/schema.prisma `
  --script

if (-not $sqlLines -or ($sqlLines -join '').Trim().Length -eq 0) {
  Write-Host 'Prazdny diff. Pravdepodobne schema je uz aplikovana. Ukoncuji.' -ForegroundColor Yellow
  return
}

$sqlText = ($sqlLines -join "`r`n")
Set-Content -Path $sqlPath -Value $sqlText -Encoding ascii
Write-Host "OK -> $sqlPath" -ForegroundColor Green

Write-Host ''
Write-Host "--- 2/4 Obsah migrace -----------------------------------" -ForegroundColor Cyan
Get-Content $sqlPath

$confirm = Read-Host "`nPokracovat v apply na Railway? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
  Write-Host 'Preruseno uzivatelem. migration.sql zustava pro rucni inspekci.' -ForegroundColor Yellow
  return
}

Write-Host ''
Write-Host "--- 3/4 Apply: prisma db execute ------------------------" -ForegroundColor Cyan
npx prisma db execute --file $sqlPath --schema prisma/schema.prisma

Write-Host ''
Write-Host "--- 4/4 Resolve jako applied ----------------------------" -ForegroundColor Cyan
try {
  npx prisma migrate resolve --applied $name
} catch {
  # P3008 („already recorded as applied") je benigni -- viz memory holyos_prisma_p3008_benign
  if ($_.Exception.Message -match 'P3008') {
    Write-Host 'P3008 benigni (jiz zapsano) -- OK' -ForegroundColor Yellow
  } else {
    throw
  }
}

Write-Host ''
Write-Host "--- Regenerace Prisma client ----------------------------" -ForegroundColor Cyan
npx prisma generate

Write-Host ''
Write-Host "HOTOVO. Migrace '$name' applied + zapsana do _prisma_migrations." -ForegroundColor Green
