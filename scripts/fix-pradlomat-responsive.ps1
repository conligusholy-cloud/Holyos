# HolyOS - oprava responzivity pradlomat-economy.js (ASCII only)
# Spustit z workspace root: powershell -ExecutionPolicy Bypass -File scripts\fix-pradlomat-responsive.ps1

$ErrorActionPreference = 'Stop'
$target = "modules\prodejni-objednavky\pradlomat-economy.js"

Write-Host "1/4 Restoring file from HEAD..." -ForegroundColor Cyan
git checkout HEAD -- $target
if ($LASTEXITCODE -ne 0) { throw "git checkout failed" }

Write-Host "2/4 Reading file content..."
$bytes = [System.IO.File]::ReadAllBytes($target)
$txt   = [System.Text.Encoding]::UTF8.GetString($bytes)
$origLen = $txt.Length
Write-Host ("    Original length: {0} chars" -f $origLen)

function Replace-Once($haystack, $needle, $replacement, $label) {
    if (-not $haystack.Contains($needle)) {
        throw ("FAILED [{0}]: pattern not found" -f $label)
    }
    Write-Host ("    [{0}] OK" -f $label)
    return $haystack.Replace($needle, $replacement)
}

$LF = [char]10

# [1] .pe-row tracks -> minmax(0, X)
$old = "'.pe-row { display: grid; grid-template-columns: 1fr 130px 70px; gap: 10px; align-items: center; font-size: 13px; }' +" + $LF +
       "      '.pe-row.lockable { grid-template-columns: 1fr 130px 50px 34px; }' +" + $LF +
       "      '.pe-row.compact { grid-template-columns: 1fr 130px; }' +"
$new = "'.pe-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 130px) 70px; gap: 10px; align-items: center; font-size: 13px; }' +" + $LF +
       "      '.pe-row.lockable { grid-template-columns: minmax(0, 1fr) minmax(0, 130px) 50px 34px; }' +" + $LF +
       "      '.pe-row.compact { grid-template-columns: minmax(0, 1fr) minmax(0, 130px); }' +"
$txt = Replace-Once $txt $old $new "pe-row minmax tracks"

# [2] .pe-input -> add min-width:0; width:100%; box-sizing
$old = "'.pe-input { background: #fef3c7; color: #1f2937; border: 1px solid #f59e0b; border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 600; text-align: right; font-family: inherit; }' +"
$new = "'.pe-input { background: #fef3c7; color: #1f2937; border: 1px solid #f59e0b; border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 600; text-align: right; font-family: inherit; min-width: 0; width: 100%; box-sizing: border-box; }' +"
$txt = Replace-Once $txt $old $new "pe-input min-width:0"

# [3] .pe-readonly -> same fix
$old = "'.pe-readonly { background: var(--surface2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 600; text-align: right; }' +"
$new = "'.pe-readonly { background: var(--surface2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 600; text-align: right; min-width: 0; width: 100%; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +"
$txt = Replace-Once $txt $old $new "pe-readonly min-width:0"

# [4] .pe-years-grid -> 5 cols always
$old = "'.pe-years-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; margin-bottom: 14px; }' +"
$new = "'.pe-years-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }' +"
$txt = Replace-Once $txt $old $new "pe-years-grid 5 cols"

# [5] .pe-year-cell -> min-width:0
$old = "'.pe-year-cell { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }' +"
$new = "'.pe-year-cell { display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-width: 0; }' +"
$txt = Replace-Once $txt $old $new "pe-year-cell min-width:0"

# [6] .pe-year-input -> bigger padding/font
$old = "'.pe-year-input { text-align: center !important; padding: 6px 4px !important; font-size: 14px !important; }' +"
$new = "'.pe-year-input { text-align: center !important; padding: 7px 4px !important; font-size: 15px !important; }' +"
$txt = Replace-Once $txt $old $new "pe-year-input"

# [7] .pe-projection-summary -> auto-fit
$old = "'.pe-projection-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }' +"
$new = "'.pe-projection-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 16px; }' +"
$txt = Replace-Once $txt $old $new "pe-projection-summary auto-fit"

# [8] .pe-mini-card -> min-width:0
$old = "'.pe-mini-card { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }' +"
$new = "'.pe-mini-card { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; min-width: 0; }' +"
$txt = Replace-Once $txt $old $new "pe-mini-card min-width:0"

# [8b] .pe-mc-value -> word-break
$old = "'.pe-mini-card .pe-mc-value { font-size: 20px; font-weight: 700; color: #eab308; }' +"
$new = "'.pe-mini-card .pe-mc-value { font-size: 20px; font-weight: 700; color: #eab308; word-break: break-word; }' +"
$txt = Replace-Once $txt $old $new "pe-mc-value word-break"

# [9] chart wrap -> overflow:hidden
$old = "'.pe-projection-chart-wrap { padding: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }' +"
$new = "'.pe-projection-chart-wrap { padding: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }' +"
# This pattern may not appear in HEAD; check both variants
if ($txt.Contains($old)) {
    Write-Host "    [9] chart wrap already overflow:hidden"
} else {
    $oldAlt = "'.pe-projection-chart-wrap { padding: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; }' +"
    if ($txt.Contains($oldAlt)) {
        $txt = $txt.Replace($oldAlt, $new)
        Write-Host "    [9] chart wrap overflow-x:auto -> overflow:hidden: OK"
    } else {
        throw "FAILED [9]: chart wrap pattern not found (neither variant)"
    }
}

# [9b] .pe-svg -> remove min-width
$oldA = "'.pe-svg { width: 100%; height: auto; display: block; font-family: inherit; aspect-ratio: 1000 / 360; min-width: 640px; max-height: 460px; }' +"
$oldB = "'.pe-svg { width: 100%; height: auto; display: block; font-family: inherit; aspect-ratio: 1000 / 360; max-height: 460px; }' +"
$new  = "'.pe-svg { width: 100%; height: auto; display: block; font-family: inherit; aspect-ratio: 1000 / 360; max-height: 460px; }' +"
if ($txt.Contains($oldA)) {
    $txt = $txt.Replace($oldA, $new)
    Write-Host "    [9b] pe-svg removed min-width:640: OK"
} elseif ($txt.Contains($oldB)) {
    Write-Host "    [9b] pe-svg already without min-width"
} else {
    throw "FAILED [9b]: pe-svg pattern not found"
}

# [10] @media 720px - replace entire block (try both variants from previous commits)
$old720_v1 = "'@media (max-width: 720px) {' +" + $LF +
             "        '.pe-years-grid { grid-template-columns: repeat(5, 1fr); }' +" + $LF +
             "        '.pe-projection-summary { grid-template-columns: repeat(2, 1fr); }' +" + $LF +
             "        '.pe-projection-chart-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 12px 10px; }' +" + $LF +
             "        '.pe-projection-chart-wrap > #pe-projection-chart { min-width: 700px; }' +" + $LF +
             "        '.pe-svg { width: 100%; min-width: 700px; }' +" + $LF +
             "        '.pe-chart-swipe-hint { display: block; }' +" + $LF +
             "        '.pe-mini-card { padding: 10px 12px; }' +" + $LF +
             "        '.pe-mini-card .pe-mc-value { font-size: 17px; }' +" + $LF +
             "        '.pe-mini-card .pe-mc-label { font-size: 9px; }' +" + $LF +
             "        '.pe-chart-legend em { display: none; }' +" + $LF +
             "        '.pe-chart-head { gap: 4px 10px; }' +" + $LF +
             "        '.pe-chart-title { font-size: 10px; }' +" + $LF +
             "        '.pe-chart-legend { font-size: 11px; gap: 4px 10px; }' +" + $LF +
             "        '.pe-year-input { font-size: 15px !important; padding: 8px 4px !important; }' +" + $LF +
             "        '.pe-year-label { font-size: 9px; }' +" + $LF +
             "      '}' +"

$old720_v2 = "'@media (max-width: 720px) {' +" + $LF +
             "        '.pe-years-grid { grid-template-columns: repeat(5, 1fr); }' +" + $LF +
             "        '.pe-projection-summary { grid-template-columns: repeat(2, 1fr); }' +" + $LF +
             "        '.pe-projection-chart-wrap { padding: 12px 10px; }' +" + $LF +
             "        '.pe-projection-chart-wrap > #pe-projection-chart { min-width: 700px; }' +" + $LF +
             "        '.pe-svg { min-width: 700px; aspect-ratio: 1000 / 360; }' +" + $LF +
             "        '.pe-chart-swipe-hint { display: block; }' +" + $LF +
             "        '.pe-mini-card { padding: 10px 12px; }' +" + $LF +
             "        '.pe-mini-card .pe-mc-value { font-size: 17px; }' +" + $LF +
             "        '.pe-mini-card .pe-mc-label { font-size: 9px; }' +" + $LF +
             "        '.pe-chart-legend em { display: none; }' +" + $LF +
             "        '.pe-chart-head { gap: 4px 10px; }' +" + $LF +
             "        '.pe-chart-title { font-size: 10px; }' +" + $LF +
             "        '.pe-chart-legend { font-size: 11px; gap: 4px 10px; }' +" + $LF +
             "        '.pe-year-input { font-size: 15px !important; padding: 8px 4px !important; }' +" + $LF +
             "        '.pe-year-label { font-size: 9px; }' +" + $LF +
             "      '}' +"

$new720 = "'@media (max-width: 720px) {' +" + $LF +
          "        '.pe-projection-chart-wrap { padding: 12px 10px; }' +" + $LF +
          "        '.pe-mini-card { padding: 10px 12px; }' +" + $LF +
          "        '.pe-mini-card .pe-mc-value { font-size: 17px; }' +" + $LF +
          "        '.pe-mini-card .pe-mc-label { font-size: 9px; }' +" + $LF +
          "        '.pe-chart-legend em { display: none; }' +" + $LF +
          "        '.pe-chart-head { gap: 4px 10px; }' +" + $LF +
          "        '.pe-chart-title { font-size: 10px; }' +" + $LF +
          "        '.pe-chart-legend { font-size: 11px; gap: 4px 10px; }' +" + $LF +
          "        '.pe-year-input { font-size: 14px !important; padding: 6px 3px !important; }' +" + $LF +
          "        '.pe-year-label { font-size: 9px; }' +" + $LF +
          "        '.pe-years-grid { gap: 6px; }' +" + $LF +
          "        '.pe-svg .pe-y-left text, .pe-svg .pe-y-right text { font-size: 18px; }' +" + $LF +
          "        '.pe-svg .pe-bar-label, .pe-svg .pe-cum-label { font-size: 17px; }' +" + $LF +
          "        '.pe-svg .pe-x-axis .pe-x-year { font-size: 18px; }' +" + $LF +
          "        '.pe-svg .pe-x-axis .pe-x-sub { font-size: 14px; }' +" + $LF +
          "      '}' +"

if ($txt.Contains($old720_v1)) {
    $txt = $txt.Replace($old720_v1, $new720)
    Write-Host "    [10] @media 720px (v1) replaced: OK"
} elseif ($txt.Contains($old720_v2)) {
    $txt = $txt.Replace($old720_v2, $new720)
    Write-Host "    [10] @media 720px (v2) replaced: OK"
} else {
    throw "FAILED [10]: @media 720px pattern not found"
}

# [11] @media 480px - replace
$old480 = "'@media (max-width: 480px) {' +" + $LF +
          "        '.pe-projection-summary { grid-template-columns: 1fr 1fr; gap: 8px; }' +" + $LF +
          "        '.pe-years-grid { grid-template-columns: repeat(5, 1fr); gap: 4px; }' +" + $LF +
          "      '}' +"
$new480 = "'@media (max-width: 480px) {' +" + $LF +
          "        '.pe-years-grid { gap: 4px; }' +" + $LF +
          "        '.pe-year-input { padding: 5px 2px !important; font-size: 13px !important; }' +" + $LF +
          "        '.pe-mini-card .pe-mc-value { font-size: 15px; }' +" + $LF +
          "        '.pe-svg .pe-y-left text, .pe-svg .pe-y-right text { font-size: 22px; }' +" + $LF +
          "        '.pe-svg .pe-bar-label, .pe-svg .pe-cum-label { font-size: 20px; }' +" + $LF +
          "        '.pe-svg .pe-x-axis .pe-x-year { font-size: 22px; }' +" + $LF +
          "        '.pe-svg .pe-x-axis .pe-x-sub { font-size: 17px; }' +" + $LF +
          "      '}' +"
$txt = Replace-Once $txt $old480 $new480 "@media 480px"

# [12] .pe-lock-btn -> flex-shrink:0
$old = "'.pe-lock-btn { background: transparent; border: 1px solid var(--border); border-radius: 6px; width: 30px; height: 30px; cursor: pointer; font-size: 13px; padding: 0; transition: all 0.15s; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }' +"
$new = "'.pe-lock-btn { background: transparent; border: 1px solid var(--border); border-radius: 6px; width: 30px; height: 30px; cursor: pointer; font-size: 13px; padding: 0; transition: all 0.15s; line-height: 1; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }' +"
$txt = Replace-Once $txt $old $new "pe-lock-btn flex-shrink:0"

Write-Host "3/4 Writing back (UTF-8 no BOM)..."
$newLen = $txt.Length
Write-Host ("    New length: {0} chars (delta: {1})" -f $newLen, ($newLen - $origLen))
[System.IO.File]::WriteAllText((Resolve-Path $target).Path, $txt, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "4/4 Validating..."
node --check $target
if ($LASTEXITCODE -ne 0) { throw "node --check failed" }
$lines = (Get-Content $target | Measure-Object -Line).Lines
$sz = (Get-Item $target).Length
Write-Host ("    OK - {0} lines, {1} bytes" -f $lines, $sz)

Write-Host ""
Write-Host "Done. Now run:" -ForegroundColor Green
Write-Host "    git add $target" -ForegroundColor Yellow
Write-Host "    git commit -m `"Oprav responzivitu pradlomat-economy (input min-width:0, 5-col grid)`"" -ForegroundColor Yellow
Write-Host "    git push origin main" -ForegroundColor Yellow
