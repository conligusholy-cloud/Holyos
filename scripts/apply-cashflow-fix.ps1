# HolyOS - patch pro cashflow kalendar v Prodejnich objednavkach.
# Upravy:
#   1) doplatek = production_finish_last - 14 dni
#   2) menove zobrazeni v kalendari, timeline a statistikach
#
# Spousteni z korene projektu:
#   powershell -ExecutionPolicy Bypass -File .\scripts\apply-cashflow-fix.ps1

$ErrorActionPreference = 'Stop'

$target = Join-Path $PSScriptRoot '..\modules\prodejni-objednavky\index.html'
$target = (Resolve-Path $target).Path
Write-Host "Patchuji: $target"

# Cti binarne, abychom nesahli na original encoding.
[byte[]]$bytes = [System.IO.File]::ReadAllBytes($target)
$enc = New-Object System.Text.UTF8Encoding($false) # bez BOM
$content = $enc.GetString($bytes)

# CRLF -> LF pro replace, vratime zpet pokud puvodni mel CRLF.
$hadCrlf = $content.Contains("`r`n")
if ($hadCrlf) { $content = $content -replace "`r`n", "`n" }

function Try-Patch {
    param([string]$Old, [string]$New, [string]$Label, [int]$Idx)
    if ($script:content.Contains($Old)) {
        $script:content = $script:content.Replace($Old, $New)
        Write-Host ("  [{0}] OK   - {1}" -f $Idx, $Label) -ForegroundColor Green
        return $true
    } else {
        Write-Host ("  [{0}] SKIP - vzor nenalezen: {1}" -f $Idx, $Label) -ForegroundColor Yellow
        return $false
    }
}

# --- 1) Helpery cfCurSymbol / cfFmtMoney / cfFmtMixed ---
$old1 = @"
    var _cashflowPayments = [];   // pole { date, amount, kind, paid, overdue, order, estimated }
    var _cashflowView = 'timeline';
    var _cashflowCalAnchor = null; // první den zobrazeného měsíce v kalendáři

    async function loadCashflow() {
"@.Replace("`r`n","`n")

$new1 = @"
    var _cashflowPayments = [];   // pole { date, amount, kind, paid, overdue, order, estimated }
    var _cashflowView = 'timeline';
    var _cashflowCalAnchor = null; // první den zobrazeného měsíce v kalendáři

    // Symbol pro měnu — kalendář i timeline pracují s reálnou měnou objednávky, ne s pevně psaným „Kč".
    function cfCurSymbol(c) {
      if (c === 'EUR') return '€';
      if (c === 'USD') return '$';
      if (c === 'GBP') return '£';
      if (c === 'PLN') return 'zł';
      if (c === 'HUF') return 'Ft';
      return 'Kč';
    }
    // Naformátuje částku s odpovídajícím symbolem dle měny.
    function cfFmtMoney(n, currency) {
      return Math.round(n).toLocaleString('cs-CZ') + ' ' + cfCurSymbol(currency || 'CZK');
    }
    // Sečte částky a vrátí buď jednoměnový výsledek („123 €"), nebo mix měn rozdělený („+").
    function cfFmtMixed(amountsByCur) {
      var keys = Object.keys(amountsByCur).filter(function (k) { return amountsByCur[k] > 0.5; });
      if (!keys.length) return '0 ' + cfCurSymbol('CZK');
      keys.sort(function (a, b) {
        if (a === b) return 0;
        if (a === 'EUR') return -1;
        if (b === 'EUR') return 1;
        if (a === 'CZK') return 1;
        if (b === 'CZK') return -1;
        return a.localeCompare(b);
      });
      return keys.map(function (k) { return cfFmtMoney(amountsByCur[k], k); }).join(' + ');
    }

    async function loadCashflow() {
"@.Replace("`r`n","`n")

Try-Patch -Old $old1 -New $new1 -Label "helpery cfCurSymbol/cfFmtMoney/cfFmtMixed" -Idx 1 | Out-Null

# --- 2) Aktualizace komentare ---
$old2 = @"
    //   - doplatek: pokud existuje final_invoice → final_invoice.date_due,
    //              jinak heuristika: expected_delivery + final_invoice_lead_days (odhad).
    //   - jednorázová platba (payment_split=false):
    //              pokud final_invoice → date_due, jinak expected_delivery nebo created_at+14d (odhad).
"@.Replace("`r`n","`n")

$new2 = @"
    //   - doplatek: pokud existuje final_invoice → final_invoice.date_due,
    //              jinak heuristika: production_finish_last − 14 dní (resp. − final_invoice_lead_days),
    //              tj. doplatek má padnout 14 dní PŘED dokončením výroby poslední položky,
    //              aby bylo možné zboží uvolnit oproti zaplacenému doplatku.
    //   - jednorázová platba (payment_split=false):
    //              pokud final_invoice → date_due, jinak production_finish_last − 14 dní,
    //              fallback expected_delivery − 14 dní nebo created_at+14d (odhad).
"@.Replace("`r`n","`n")

Try-Patch -Old $old2 -New $new2 -Label "komentar buildPaymentsFromOrders" -Idx 2 | Out-Null

# --- 3) DOPLATEK ---
$old3 = @"
          // ── DOPLATEK ──
          var finalAmt = total - depositAmt;
          if (finalAmt > 0.01) {
            var finalDate, finalEstimated = true;
            if (o.final_paid && o.final_paid_at) {
              finalDate = new Date(o.final_paid_at);
              finalEstimated = false;
            } else if (o.final_invoice && o.final_invoice.date_due) {
              finalDate = new Date(o.final_invoice.date_due);
              finalEstimated = false;
            } else if (o.expected_delivery) {
              var ed = new Date(o.expected_delivery);
              ed.setDate(ed.getDate() + (o.final_invoice_lead_days || 14));
              finalDate = ed;
            } else if (o.created_at) {
              var c = new Date(o.created_at);
              c.setDate(c.getDate() + 30 + (o.final_invoice_lead_days || 14));
              finalDate = c;
            }
"@.Replace("`r`n","`n")

$new3 = @"
          // ── DOPLATEK ──
          var finalAmt = total - depositAmt;
          if (finalAmt > 0.01) {
            var finalDate, finalEstimated = true;
            // Kolik dní PŘED koncem výroby má doplatek padnout (default 14).
            var leadDays = (o.final_invoice_lead_days != null ? parseInt(o.final_invoice_lead_days, 10) : 14);
            if (!isFinite(leadDays)) leadDays = 14;
            if (o.final_paid && o.final_paid_at) {
              finalDate = new Date(o.final_paid_at);
              finalEstimated = false;
            } else if (o.final_invoice && o.final_invoice.date_due) {
              finalDate = new Date(o.final_invoice.date_due);
              finalEstimated = false;
            } else if (o.production_finish_last) {
              // Doplatek splatný 14 dní PŘED dokončením výroby poslední položky.
              var pf = new Date(o.production_finish_last);
              pf.setDate(pf.getDate() - leadDays);
              finalDate = pf;
            } else if (o.expected_delivery) {
              // Fallback — pokud nemáme rozplánovanou výrobu, použij očekávané dodání mínus lead.
              var ed = new Date(o.expected_delivery);
              ed.setDate(ed.getDate() - leadDays);
              finalDate = ed;
            } else if (o.created_at) {
              var c = new Date(o.created_at);
              c.setDate(c.getDate() + 30 - leadDays);
              finalDate = c;
            }
"@.Replace("`r`n","`n")

Try-Patch -Old $old3 -New $new3 -Label "DOPLATEK vypocet datumu" -Idx 3 | Out-Null

# --- 4) JEDNORAZOVA PLATBA ---
$old4 = @"
        } else {
          // ── JEDNORÁZOVÁ PLATBA (záloha = celá objednávka) ──
          if (total > 0) {
            var fullDate, fullEstimated = true;
            if (o.final_paid && o.final_paid_at) {
              fullDate = new Date(o.final_paid_at);
              fullEstimated = false;
            } else if (o.final_invoice && o.final_invoice.date_due) {
              fullDate = new Date(o.final_invoice.date_due);
              fullEstimated = false;
            } else if (o.expected_delivery) {
              fullDate = new Date(o.expected_delivery);
            } else if (o.created_at) {
              var cc = new Date(o.created_at);
              cc.setDate(cc.getDate() + 14);
              fullDate = cc;
            }
"@.Replace("`r`n","`n")

$new4 = @"
        } else {
          // ── JEDNORÁZOVÁ PLATBA (záloha = celá objednávka) ──
          if (total > 0) {
            var fullDate, fullEstimated = true;
            // Stejné lead-time pravidlo jako u doplatku — splatnost 14 dní před dokončením výroby.
            var leadDaysFull = (o.final_invoice_lead_days != null ? parseInt(o.final_invoice_lead_days, 10) : 14);
            if (!isFinite(leadDaysFull)) leadDaysFull = 14;
            if (o.final_paid && o.final_paid_at) {
              fullDate = new Date(o.final_paid_at);
              fullEstimated = false;
            } else if (o.final_invoice && o.final_invoice.date_due) {
              fullDate = new Date(o.final_invoice.date_due);
              fullEstimated = false;
            } else if (o.production_finish_last) {
              var pfFull = new Date(o.production_finish_last);
              pfFull.setDate(pfFull.getDate() - leadDaysFull);
              fullDate = pfFull;
            } else if (o.expected_delivery) {
              var edFull = new Date(o.expected_delivery);
              edFull.setDate(edFull.getDate() - leadDaysFull);
              fullDate = edFull;
            } else if (o.created_at) {
              var cc = new Date(o.created_at);
              cc.setDate(cc.getDate() + 14);
              fullDate = cc;
            }
"@.Replace("`r`n","`n")

Try-Patch -Old $old4 -New $new4 -Label "JEDNORAZOVA PLATBA vypocet datumu" -Idx 4 | Out-Null

# --- 5) renderCashflowStats ---
$old5 = @"
      var sumPending = 0, sumOverdue = 0, sumThisMonth = 0, sumReceivedYTD = 0;
      var countPending = 0, countOverdue = 0, countThisMonth = 0;
      var yearStart = new Date(today.getFullYear(), 0, 1);

      _cashflowPayments.forEach(function (p) {
        if (!p.paid) {
          if (p.overdue) { sumOverdue += p.amount; countOverdue++; }
          else { sumPending += p.amount; countPending++; }
          if (p.date >= monthStart && p.date < monthEnd) { sumThisMonth += p.amount; countThisMonth++; }
        } else {
          if (p.date >= yearStart) sumReceivedYTD += p.amount;
        }
      });

      function fmt(n) { return Math.round(n).toLocaleString('cs-CZ') + ' Kč'; }
      box.innerHTML =
        '<div class="cf-stat pending">' +
          '<div class="cf-stat-label">Tento měsíc očekáváno</div>' +
          '<div class="cf-stat-value">' + fmt(sumThisMonth) + '</div>' +
          '<div class="cf-stat-sub">' + countThisMonth + ' plateb</div>' +
        '</div>' +
        '<div class="cf-stat pending">' +
          '<div class="cf-stat-label">Celkem nezaplaceno</div>' +
          '<div class="cf-stat-value">' + fmt(sumPending) + '</div>' +
          '<div class="cf-stat-sub">' + countPending + ' očekávaných plateb</div>' +
        '</div>' +
        '<div class="cf-stat warn">' +
          '<div class="cf-stat-label">Po splatnosti</div>' +
          '<div class="cf-stat-value">' + fmt(sumOverdue) + '</div>' +
          '<div class="cf-stat-sub">' + countOverdue + ' plateb v prodlení</div>' +
        '</div>' +
        '<div class="cf-stat ok">' +
          '<div class="cf-stat-label">Přijato letos</div>' +
          '<div class="cf-stat-value">' + fmt(sumReceivedYTD) + '</div>' +
          '<div class="cf-stat-sub">Od 1. ledna ' + today.getFullYear() + '</div>' +
        '</div>';
"@.Replace("`r`n","`n")

$new5 = @"
      // Mícháme více měn — držíme součty per měna a v UI je zobrazíme zvlášť.
      var sumPending = {}, sumOverdue = {}, sumThisMonth = {}, sumReceivedYTD = {};
      var countPending = 0, countOverdue = 0, countThisMonth = 0;
      var yearStart = new Date(today.getFullYear(), 0, 1);

      function bump(bag, cur, amt) { bag[cur] = (bag[cur] || 0) + amt; }

      _cashflowPayments.forEach(function (p) {
        var cur = p.currency || 'CZK';
        if (!p.paid) {
          if (p.overdue) { bump(sumOverdue, cur, p.amount); countOverdue++; }
          else { bump(sumPending, cur, p.amount); countPending++; }
          if (p.date >= monthStart && p.date < monthEnd) { bump(sumThisMonth, cur, p.amount); countThisMonth++; }
        } else {
          if (p.date >= yearStart) bump(sumReceivedYTD, cur, p.amount);
        }
      });

      box.innerHTML =
        '<div class="cf-stat pending">' +
          '<div class="cf-stat-label">Tento měsíc očekáváno</div>' +
          '<div class="cf-stat-value">' + cfFmtMixed(sumThisMonth) + '</div>' +
          '<div class="cf-stat-sub">' + countThisMonth + ' plateb</div>' +
        '</div>' +
        '<div class="cf-stat pending">' +
          '<div class="cf-stat-label">Celkem nezaplaceno</div>' +
          '<div class="cf-stat-value">' + cfFmtMixed(sumPending) + '</div>' +
          '<div class="cf-stat-sub">' + countPending + ' očekávaných plateb</div>' +
        '</div>' +
        '<div class="cf-stat warn">' +
          '<div class="cf-stat-label">Po splatnosti</div>' +
          '<div class="cf-stat-value">' + cfFmtMixed(sumOverdue) + '</div>' +
          '<div class="cf-stat-sub">' + countOverdue + ' plateb v prodlení</div>' +
        '</div>' +
        '<div class="cf-stat ok">' +
          '<div class="cf-stat-label">Přijato letos</div>' +
          '<div class="cf-stat-value">' + cfFmtMixed(sumReceivedYTD) + '</div>' +
          '<div class="cf-stat-sub">Od 1. ledna ' + today.getFullYear() + '</div>' +
        '</div>';
"@.Replace("`r`n","`n")

Try-Patch -Old $old5 -New $new5 -Label "renderCashflowStats" -Idx 5 | Out-Null

# --- 6) Timeline mesicni soucty ---
$old6 = @"
        var sumIn = 0, sumPend = 0;
        monthPayments.forEach(function (p) {
          if (p.paid) sumIn += p.amount; else sumPend += p.amount;
        });
        var isCurrent = (y === nowYear && mi === nowMonth);

        html += '<div class="cf-month-col">' +
          '<div class="cf-month-head' + (isCurrent ? ' current' : '') + '">' +
            '<div class="cf-month-title">' + monthNames[mi] + ' ' + y + '</div>' +
            '<div class="cf-month-sub">' +
              (sumIn > 0 ? '<span class="cf-incoming">✓ ' + Math.round(sumIn).toLocaleString('cs-CZ') + ' Kč</span>' : '') +
              (sumPend > 0 ? '<span class="cf-pending">⏳ ' + Math.round(sumPend).toLocaleString('cs-CZ') + ' Kč</span>' : '') +
              (sumIn === 0 && sumPend === 0 ? '<span style="color:var(--text2);font-style:italic;">bez plateb</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="cf-month-body">';
"@.Replace("`r`n","`n")

$new6 = @"
        // Soucty per mena — abychom mohli mix men zobrazit korektne misto pevneho Kc.
        var sumInByCur = {}, sumPendByCur = {};
        var totalIn = 0, totalPend = 0;
        monthPayments.forEach(function (p) {
          var cur = p.currency || 'CZK';
          if (p.paid) { sumInByCur[cur] = (sumInByCur[cur] || 0) + p.amount; totalIn += p.amount; }
          else { sumPendByCur[cur] = (sumPendByCur[cur] || 0) + p.amount; totalPend += p.amount; }
        });
        var isCurrent = (y === nowYear && mi === nowMonth);

        html += '<div class="cf-month-col">' +
          '<div class="cf-month-head' + (isCurrent ? ' current' : '') + '">' +
            '<div class="cf-month-title">' + monthNames[mi] + ' ' + y + '</div>' +
            '<div class="cf-month-sub">' +
              (totalIn > 0 ? '<span class="cf-incoming">✓ ' + cfFmtMixed(sumInByCur) + '</span>' : '') +
              (totalPend > 0 ? '<span class="cf-pending">⏳ ' + cfFmtMixed(sumPendByCur) + '</span>' : '') +
              (totalIn === 0 && totalPend === 0 ? '<span style="color:var(--text2);font-style:italic;">bez plateb</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="cf-month-body">';
"@.Replace("`r`n","`n")

Try-Patch -Old $old6 -New $new6 -Label "timeline mesicni soucty" -Idx 6 | Out-Null

# --- 7) Kalendarove pilulky + tooltip ---
$old7 = @"
        dayPays.forEach(function (p) {
          var cls = p.paid ? 'paid' : (p.overdue ? 'overdue' : 'pending');
          var amt = Math.round(p.amount).toLocaleString('cs-CZ');
          var kind = p.kind === 'deposit' ? 'Z' : (p.kind === 'final' ? 'D' : 'P');
          var title = (p.order.order_number || '') + ' — ' + ((p.order.company && p.order.company.name) || '') + ' — ' + amt + ' Kč';
          html += '<div class="cf-cal-pill ' + cls + '" title="' + esc(title) + '" onclick="event.stopPropagation();openOrderDetail(' + p.order.id + ')">' + kind + ' ' + amt + '</div>';
        });
"@.Replace("`r`n","`n")

$new7 = @"
        dayPays.forEach(function (p) {
          var cls = p.paid ? 'paid' : (p.overdue ? 'overdue' : 'pending');
          var sym = cfCurSymbol(p.currency);
          var amt = Math.round(p.amount).toLocaleString('cs-CZ');
          var kind = p.kind === 'deposit' ? 'Z' : (p.kind === 'final' ? 'D' : 'P');
          var title = (p.order.order_number || '') + ' — ' + ((p.order.company && p.order.company.name) || '') + ' — ' + amt + ' ' + sym;
          html += '<div class="cf-cal-pill ' + cls + '" title="' + esc(title) + '" onclick="event.stopPropagation();openOrderDetail(' + p.order.id + ')">' + kind + ' ' + amt + ' ' + sym + '</div>';
        });
"@.Replace("`r`n","`n")

Try-Patch -Old $old7 -New $new7 -Label "kalendar pill + tooltip" -Idx 7 | Out-Null

# Vratit puvodni EOL
if ($hadCrlf) { $content = $content -replace "`n", "`r`n" }

# Zapis zpet (bez BOM, UTF-8)
[System.IO.File]::WriteAllBytes($target, $enc.GetBytes($content))
Write-Host ""
Write-Host "Hotovo. Spust 'git diff modules/prodejni-objednavky/index.html' pro overeni." -ForegroundColor Cyan
