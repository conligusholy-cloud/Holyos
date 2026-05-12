#!/usr/bin/env node
// Patch script — přidá tlačítka koš (smazat soubor) u Faktury a Protokolu
// v záložce Pneu management a Servis v modules/vozovy-park/index.html
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'modules', 'vozovy-park', 'index.html');
let src = fs.readFileSync(FILE, 'utf8');

let changed = 0;

// ══════════════════════════════════════════════════════════════════════════════
// A) Pneu management — sekce výměn pneu (tire-changes history list)
//    Přidej tlačítka koš vedle odkazu Faktura a Protokol
// ══════════════════════════════════════════════════════════════════════════════

// Stávající render akcí výměn pneu:
//   (c.invoice_url ? '<a class="dl" href="..." ...>📎 Faktura</a>' : '') +
//   (c.protocol_url ? '<a class="dl" href="..." ...>📋 Protokol</a>' : '') +
const TIRE_ACTIONS_OLD = `              '<div class=\"actions\">' +\n                (c.invoice_url ? '<a class=\"dl\" href=\"' + escHtml(c.invoice_url) + '\" target=\"_blank\" rel=\"noopener\" title=\"Otevřít fakturu\">📎 Faktura</a>' : '') +\n                (c.protocol_url ? '<a class=\"dl\" href=\"' + escHtml(c.protocol_url) + '\" target=\"_blank\" rel=\"noopener\" title=\"Otevřít protokol / dodací list\">📋 Protokol</a>' : '') +`;

const TIRE_ACTIONS_NEW = `              '<div class=\"actions\">' +\n                (c.invoice_url ? '<a class=\"dl\" href=\"' + escHtml(c.invoice_url) + '\" target=\"_blank\" rel=\"noopener\" title=\"Otevřít fakturu\">📎 Faktura</a>' : '') +\n                (c.invoice_url ? '<button type=\"button\" class=\"btn btn-sm btn-danger\" onclick=\"deleteTireChangeFile(' + c.id + ',\\'invoice\\',' + vehicleId + ')\" title=\"Smazat fakturu\">🗑️</button>' : '') +\n                (c.protocol_url ? '<a class=\"dl\" href=\"' + escHtml(c.protocol_url) + '\" target=\"_blank\" rel=\"noopener\" title=\"Otevřít protokol / dodací list\">📋 Protokol</a>' : '') +\n                (c.protocol_url ? '<button type=\"button\" class=\"btn btn-sm btn-danger\" onclick=\"deleteTireChangeFile(' + c.id + ',\\'protocol\\',' + vehicleId + ')\" title=\"Smazat protokol / dodací list\">🗑️</button>' : '') +`;

if (src.includes(TIRE_ACTIONS_OLD)) {
  src = src.replace(TIRE_ACTIONS_OLD, TIRE_ACTIONS_NEW);
  changed++;
  console.log('[A] Pneu výměny — přidány tlačítka koš pro Fakturu a Protokol');
} else {
  console.log('[A] Pneu výměny — sekce nenalezena nebo již upravena, přeskočeno');
}

// ══════════════════════════════════════════════════════════════════════════════
// B) Servis — sekce historie servisů
//    Přidej tlačítka koš vedle odkazu Faktura a Protokol
// ══════════════════════════════════════════════════════════════════════════════

const SVC_ACTIONS_OLD = `                (s.invoice_url ? '<a class=\"dl\" href=\"' + escHtml(s.invoice_url) + '\" target=\"_blank\" rel=\"noopener\">📎 Faktura</a>' : '') +\n                (s.protocol_url ? '<a class=\"dl\" href=\"' + escHtml(s.protocol_url) + '\" target=\"_blank\" rel=\"noopener\" title=\"Protokol / dodací list\">📋 Protokol</a>' : '') +`;

const SVC_ACTIONS_NEW = `                (s.invoice_url ? '<a class=\"dl\" href=\"' + escHtml(s.invoice_url) + '\" target=\"_blank\" rel=\"noopener\">📎 Faktura</a>' : '') +\n                (s.invoice_url ? '<button type=\"button\" class=\"btn btn-sm btn-danger\" onclick=\"deleteServiceFile(' + s.id + ',\\'invoice\\',' + vehicleId + ')\" title=\"Smazat fakturu\">🗑️</button>' : '') +\n                (s.protocol_url ? '<a class=\"dl\" href=\"' + escHtml(s.protocol_url) + '\" target=\"_blank\" rel=\"noopener\" title=\"Protokol / dodací list\">📋 Protokol</a>' : '') +\n                (s.protocol_url ? '<button type=\"button\" class=\"btn btn-sm btn-danger\" onclick=\"deleteServiceFile(' + s.id + ',\\'protocol\\',' + vehicleId + ')\" title=\"Smazat protokol / dodací list\">🗑️</button>' : '') +`;

if (src.includes(SVC_ACTIONS_OLD)) {
  src = src.replace(SVC_ACTIONS_OLD, SVC_ACTIONS_NEW);
  changed++;
  console.log('[B] Servis — přidány tlačítka koš pro Fakturu a Protokol');
} else {
  console.log('[B] Servis — sekce nenalezena nebo již upravena, přeskočeno');
}

// ══════════════════════════════════════════════════════════════════════════════
// C) Přidat JS funkce deleteTireChangeFile() a deleteServiceFile()
//    Vložíme je těsně před "// ─── Init" na konci scriptu
// ══════════════════════════════════════════════════════════════════════════════

const JS_INSERT_BEFORE = `    // ─── Init ──────────────────────────────────────────────────────────────`;

const JS_NEW_FUNCTIONS = `    // ─── Smazání souboru (Faktura / Protokol) bez smazání záznamu ────────────
    // Zavolá PUT s remove_invoice=true nebo remove_protocol=true, uloží hned
    // (bez jiných dat) a reload tab. Backend smaže fyzický soubor + vynuluje URL.

    async function deleteTireChangeFile(changeId, field, vehicleId) {
      const label = field === 'invoice' ? 'fakturu' : 'protokol / dodací list';
      if (!confirm('Opravdu smazat ' + label + '? Záznam výměny zůstane zachován.')) return;
      try {
        const body = field === 'invoice'
          ? { remove_invoice: true }
          : { remove_protocol: true };
        const r = await fetch('/api/fleet/tire-changes/' + changeId, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(body),
        });
        if (!r.ok) { const err = await r.json().catch(() => ({})); alert('Chyba: ' + (err.error || r.status)); return; }
        const panel = document.querySelector('.veh-tab-panel[data-panel="tires"]');
        if (panel) await loadTiresTab(vehicleId, panel);
      } catch (e) { alert('Chyba: ' + e.message); }
    }

    async function deleteServiceFile(serviceId, field, vehicleId) {
      const label = field === 'invoice' ? 'fakturu' : 'protokol / dodací list';
      if (!confirm('Opravdu smazat ' + label + '? Servisní záznam zůstane zachován.')) return;
      try {
        const body = field === 'invoice'
          ? { remove_invoice: true }
          : { remove_protocol: true };
        const r = await fetch('/api/fleet/services/' + serviceId, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(body),
        });
        if (!r.ok) { const err = await r.json().catch(() => ({})); alert('Chyba: ' + (err.error || r.status)); return; }
        const panel = document.querySelector('.veh-tab-panel[data-panel="service"]');
        if (panel) await loadServiceTab(vehicleId, panel);
      } catch (e) { alert('Chyba: ' + e.message); }
    }

    // ─── Init ──────────────────────────────────────────────────────────────`;

if (src.includes(JS_INSERT_BEFORE) && !src.includes('deleteTireChangeFile')) {
  src = src.replace(JS_INSERT_BEFORE, JS_NEW_FUNCTIONS);
  changed++;
  console.log('[C] JS — přidány funkce deleteTireChangeFile() a deleteServiceFile()');
} else if (src.includes('deleteTireChangeFile')) {
  console.log('[C] JS — funkce již existují, přeskočeno');
} else {
  console.log('[C] JS — místo pro vložení nenalezeno, přeskočeno');
}

fs.writeFileSync(FILE, src);
console.log(`\nHotovo. Provedeno ${changed} změn.`);
