# HolyOS — migrace: lm_support_messages (Podpora Laundromats)
# Spusť Z KOŘENE projektu PŘED nasazením kódu (railway up):
#   .\scripts\migrate-lm-support.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$name = '20261104210000_lm_support'
$sql = "prisma\migrations\$name\migration.sql"
Write-Host '--- 1/3 Aplikuji SQL ---' -ForegroundColor Cyan
npx prisma db execute --file $sql --schema prisma/schema.prisma
if ($LASTEXITCODE -ne 0) { throw 'db execute selhalo - migrace NEBYLA oznacena jako aplikovana' }
Write-Host '--- 2/3 Zapisuji do _prisma_migrations ---' -ForegroundColor Cyan
npx prisma migrate resolve --applied $name
Write-Host '--- 3/3 prisma generate ---' -ForegroundColor Cyan
npx prisma generate
Write-Host 'Hotovo.' -ForegroundColor Green
