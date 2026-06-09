# HolyOS — přidá password_hash do modelu CompounderLead ve schema.prisma
# Pracuje POUZE uvnitř bloku "model CompounderLead { ... }" (password_hash je i u jiných modelů).
# Native write bez BOM. Spusť z PowerShellu: .\scripts\add-compounder-password.ps1
$ErrorActionPreference = "Stop"

$schemaPath = (Resolve-Path (Join-Path $PSScriptRoot "..\prisma\schema.prisma")).Path
$txt = [System.IO.File]::ReadAllText($schemaPath)

# vyřízni blok modelu CompounderLead (od hlavičky po první "\n}")
$m = [regex]::Match($txt, 'model CompounderLead \{[\s\S]*?\r?\n\}')
if (-not $m.Success) { Write-Error "model CompounderLead nenalezen ve schema.prisma"; return }
$block = $m.Value

if ($block -match 'password_hash') {
  Write-Host "password_hash uz je v CompounderLead - nic nedelam."
  return
}

$nl = if ($txt -match "`r`n") { "`r`n" } else { "`n" }
$col = $nl + "  // Heslo pro prihlaseni (bcrypt hash). Null = uzivatel heslo nenastavil (jen magic link)." + $nl + "  password_hash String? @db.Text"

# vlož sloupec pred 'created_at' UVNITR bloku
$newBlock = [regex]::Replace($block, '(\r?\n[ \t]*created_at DateTime @default\(now\(\)\))', ($col + '${1}'), 1)
if ($newBlock -eq $block) { Write-Error "Kotva 'created_at' uvnitr CompounderLead nenalezena - uprav rucne."; return }

$new = $txt.Substring(0, $m.Index) + $newBlock + $txt.Substring($m.Index + $block.Length)

$enc = New-Object System.Text.UTF8Encoding($false)  # bez BOM
[System.IO.File]::WriteAllText($schemaPath, $new, $enc)
Write-Host "Hotovo: password_hash pridan do CompounderLead. Dale spust: npx prisma generate"
