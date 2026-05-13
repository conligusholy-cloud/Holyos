<#
.SYNOPSIS
HolyOS one-command deploy helper.

.DESCRIPTION
Nahradi 5 manualnich kroku jednim prikazem:
  1. Cleanup stale .git/index.lock (po crashed git procesech / VS Code)
  2. git pull origin main --no-rebase (sync s remote - resi rejected push)
  3. Volitelne spusti Python apply skript (idempotentni patche)
  4. git add (jen relevantni HolyOS adresare - nikdy ne neznamych souborech)
  5. git commit s tvoji zpravou
  6. git push origin main - trigger Railway auto-deploy

.PARAMETER Message
Commit zprava (POVINNE).

.PARAMETER ApplyScript
Volitelne: cesta k Python apply skriptu. Spusti se PRED git add.

.PARAMETER All
git add . (vsechno). Default jen whitelisted adresare.

.PARAMETER WaitForDeploy
Po push poll Railway dokud deploy nedobehne. Vyzaduje railway CLI.

.EXAMPLE
.\scripts\holyos-deploy.ps1 "Opravil jsem chat 400 v Alan widgetu"

.EXAMPLE
.\scripts\holyos-deploy.ps1 -ApplyScript scripts/apply-ac-chat-400-fix.py -Message "Fix 400"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Message,

    [string]$ApplyScript = "",

    [switch]$All,

    [switch]$WaitForDeploy
)

# POZOR: NIKDY nepouzivej $ErrorActionPreference = "Stop" pro tento skript.
# Git posila LF/CRLF warningy na stderr. PowerShell to s "Stop" interpretuje
# jako RemoteException a zhavaruje uprostred deploye. Pouzivame manualni
# $LASTEXITCODE check po kazdem git volani misto toho.
$ErrorActionPreference = "Continue"

# Detekce project rootu - spolehni se na to ze script bezi z project root.
# Diakritika v path je problem pro PowerShell 5.1 bez BOM, proto radeji detekujeme.
$projectRoot = $null
if (Test-Path ".git") {
    $projectRoot = (Get-Location).Path
} else {
    # Test parent dir (kdyby user spustil ze scripts/)
    $parent = (Get-Item ..).FullName
    if (Test-Path (Join-Path $parent ".git")) {
        $projectRoot = $parent
    } else {
        Write-Host "ERROR: Run this script from HolyOS project root (where .git/ is)." -ForegroundColor Red
        Write-Host "  Current: $((Get-Location).Path)" -ForegroundColor Red
        exit 1
    }
}

function Write-Step($text) {
    Write-Host ""
    Write-Host "-> $text" -ForegroundColor Cyan
}

function Write-Done($text) {
    Write-Host "OK $text" -ForegroundColor Green
}

function Write-Warn($text) {
    Write-Host "WARN $text" -ForegroundColor Yellow
}

# Whitelist adresaru ktere je bezpecne automaticky stagovat.
# .env, node_modules, dist, tmp, data jsou tim chranene.
$SafePaths = @(
    "services/", "routes/", "modules/", "js/", "scripts/",
    "prisma/", "docs/", "app.js", "public/", "middleware/",
    "config/", "mcp-servers/", "css/", "index.html",
    "clients/", "src/", "package.json", "package-lock.json"
)

# --- 0) Nastav working directory ---
Set-Location $projectRoot
Write-Host "HolyOS deploy from $projectRoot" -ForegroundColor Magenta
Write-Host "Commit message: '$Message'"

# --- 1) Cleanup stale lock ---
$lockPath = Join-Path $projectRoot ".git\index.lock"
if (Test-Path $lockPath) {
    Write-Step "Mazem stale .git/index.lock"
    Get-Process git -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 200
    Remove-Item -Force $lockPath -ErrorAction SilentlyContinue
    if (Test-Path $lockPath) {
        Write-Warn "Lock se nepodarilo smazat - zkus zavrit VS Code / GitKraken"
        exit 1
    }
    Write-Done "Lock odstranen"
}

# --- 2) Pull from origin/main ---
Write-Step "git pull origin main --no-rebase --no-edit"
# --no-edit zabrani Vim otevreni pro merge commit (auto-prijme default zpravu)
git pull origin main --no-rebase --no-edit
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Pull selhal. Mozny conflict - vyres manualne pres git status."
    exit 1
}
Write-Done "Sync s origin"

# --- 3) Apply Python script (volitelne) ---
if ($ApplyScript -ne "") {
    if (-not (Test-Path $ApplyScript)) {
        Write-Warn "Apply skript neexistuje: $ApplyScript"
        exit 1
    }
    Write-Step "python $ApplyScript"
    python $ApplyScript
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Apply skript selhal - netlacim dal"
        exit 1
    }
    Write-Done "Patch aplikovan"
}

# --- 4) git add ---
Write-Step "git add"
if ($All) {
    git add .
    Write-Done "Staged: vsechny zmeny (-All)"
} else {
    foreach ($path in $SafePaths) {
        if (Test-Path $path) {
            # Stderr (LF/CRLF warningy) presmerovat do null, stdout silent.
            # 2>$null + | Out-Null nestaci - PS strict by stale chytil exception.
            cmd /c "git add `"$path`" 2>nul 1>nul"
        }
    }
    Write-Done "Staged: bezpecne HolyOS adresare (whitelist)"
}

# --- 5) git commit ---
Write-Step "git commit"
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Nothing to commit - mozna uz pushnuto driv. Pokracuji s push."
}

# --- 6) git push ---
Write-Step "git push origin main"
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Push selhal. Zkontroluj remote stav (git status, git log)."
    exit 1
}
Write-Done "Pushnuto do origin/main"

# --- 7) Sleduj Railway deploy (volitelne) ---
if ($WaitForDeploy) {
    Write-Step "Sleduji Railway deploy (max 5 min)"
    $start = Get-Date
    $maxWait = [TimeSpan]::FromMinutes(5)
    while ((Get-Date) - $start -lt $maxWait) {
        Start-Sleep -Seconds 10
        $statusRaw = railway status --json 2>$null
        if ($statusRaw) {
            try {
                $status = $statusRaw | ConvertFrom-Json
                $dStatus = $status.deployment.status
                if ($dStatus -eq "SUCCESS") {
                    Write-Done "Railway deploy SUCCESS po $([int]((Get-Date) - $start).TotalSeconds)s"
                    break
                } elseif ($dStatus -eq "FAILED") {
                    Write-Warn "Railway deploy FAILED - koukni do logu"
                    break
                } else {
                    Write-Host "  ... build status: $dStatus" -ForegroundColor DarkGray
                }
            } catch {
                Write-Host "  ... waiting" -ForegroundColor DarkGray
            }
        }
    }
}

Write-Host ""
Write-Host "DONE. Railway redeployne za ~2 min." -ForegroundColor Green
Write-Host "   Sleduj: https://railway.com -> service -> Deployments" -ForegroundColor DarkGray
