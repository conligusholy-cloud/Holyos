# HolyOS — přidá password_hash do modelu CompounderLead ve schema.prisma
# Bezpečně (native write, bez BOM). Spusť z PowerShellu: .\scripts\add-compounder-password.ps1
$ErrorActionPreference = "Stop"

$schemaPath = (Resolve-Path (Join-Path $PSScriptRoot "..\prisma\schema.prisma")).Path
$txt = [System.IO.File]::ReadAllText($schemaPath)

if ($txt.Contains("password_hash")) {
  Write-Host "password_hash uz ve schema existuje - nic nedelam."
  return
}

# detekce konce radku v souboru
$nl = if ($txt -match "`r`n") { "`r`n" } else { "`n" }

# vloz sloupec pred 'created_at' uvnitr modelu CompounderLead (prvni vyskyt po zacatku modelu)
$col = $nl + "  // Heslo pro prihlaseni (bcrypt hash). Null = uzivatel heslo nenastavil (jen magic link)." + $nl + "  password_hash String? @db.Text"
$pattern = '(model CompounderLead \{[\s\S]*?)(\r?\n\s*created_at DateTime @default\(now\(\)\))'

$new = [regex]::Replace($txt, $pattern, ('${1}' + $col + '${2}'), 1)

if ($new -eq $txt) {
  Write-Error "Kotva (model CompounderLead ... created_at) nenalezena - schema se zmenilo, uprav rucne."
  return
}

$enc = New-Object System.Text.UTF8Encoding($false)  # bez BOM
[System.IO.File]::WriteAllText($schemaPath, $new, $enc)
Write-Host "Hotovo: password_hash pridan do CompounderLead. Zkontroluj: npx prisma validate"
