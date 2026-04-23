# HolyOS - Git diagnose (ASCII only — PowerShell 5.1 kompatibilita)

git config --global core.pager ""

function Section($name) {
    Write-Host ""
    Write-Host "===== $name =====" -ForegroundColor Cyan
}

Section "git status --short"
git status --short

Section ".gitignore"
if (Test-Path .gitignore) {
    Get-Content .gitignore
} else {
    Write-Host "(no .gitignore)"
}

Section "check-ignore prisma/schema.prisma"
git check-ignore -v prisma/schema.prisma
if ($LASTEXITCODE -ne 0) { Write-Host "(not ignored)" }

Section "check-ignore docs/warehouse-openapi.yaml"
git check-ignore -v docs/warehouse-openapi.yaml
if ($LASTEXITCODE -ne 0) { Write-Host "(not ignored)" }

Section "ls-files prisma/"
git ls-files prisma/ | Select-Object -First 20

Section "ls-files docs/"
$docs = git ls-files docs/
if ($docs) { $docs | Select-Object -First 20 } else { Write-Host "(no tracked files in docs/)" }

Section "diff stat prisma/schema.prisma"
git diff --stat prisma/schema.prisma

Section "Get-Item prisma/schema.prisma"
if (Test-Path prisma/schema.prisma) {
    Get-Item prisma/schema.prisma | Select-Object Name, Length, LastWriteTime | Format-List
} else {
    Write-Host "MISSING on disk"
}

Section "docs/ directory listing"
if (Test-Path docs) {
    Get-ChildItem docs | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
} else {
    Write-Host "docs/ directory does not exist"
}

Write-Host ""
Write-Host "===== Done =====" -ForegroundColor Green
