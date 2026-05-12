#!/usr/bin/env node
// Patch script — přidá remove_invoice/remove_protocol flagy do fleet.routes.js
// a zpracování těchto flagů v PUT handlerech pro tire-changes a services.
// Spustit jednou: node scripts/patch-fleet-remove-files.js
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'routes', 'fleet.routes.js');
let src = fs.readFileSync(FILE, 'utf8');

let changed = 0;

// ── 1) tireChangeSchema — přidat remove_invoice + remove_protocol ──────────
const TIRE_SCHEMA_OLD = `  // Protokol / dodací list — stejný base64 mechanismus jako faktura výše.
  protocol_file_data: z.string().optional().nullable(),
  protocol_file_name: z.string().optional().nullable(),
  protocol_mime: z.string().optional().nullable(),
});`;

const TIRE_SCHEMA_NEW = `  // Protokol / dodací list — stejný base64 mechanismus jako faktura výše.
  protocol_file_data: z.string().optional().nullable(),
  protocol_file_name: z.string().optional().nullable(),
  protocol_mime: z.string().optional().nullable(),
  // Příznaky pro smazání souboru bez smazání celého záznamu (tlačítko koš v UI)
  remove_invoice: z.boolean().optional(),
  remove_protocol: z.boolean().optional(),
});`;

if (src.includes(TIRE_SCHEMA_OLD)) {
  src = src.replace(TIRE_SCHEMA_OLD, TIRE_SCHEMA_NEW);
  changed++;
  console.log('[1] tireChangeSchema — přidány remove_invoice / remove_protocol');
} else {
  console.log('[1] tireChangeSchema — již upraven nebo nenalezen, přeskočeno');
}

// ── 2) serviceSchema — přidat remove_invoice + remove_protocol ─────────────
const SVC_SCHEMA_OLD = `  // Upload protokolu / dodacího listu (volitelně)
  protocol_file_data: z.string().optional().nullable(),
  protocol_file_name: z.string().optional().nullable(),
  protocol_mime: z.string().optional().nullable(),
});`;

const SVC_SCHEMA_NEW = `  // Upload protokolu / dodacího listu (volitelně)
  protocol_file_data: z.string().optional().nullable(),
  protocol_file_name: z.string().optional().nullable(),
  protocol_mime: z.string().optional().nullable(),
  // Příznaky pro smazání souboru bez smazání celého záznamu (tlačítko koš v UI)
  remove_invoice: z.boolean().optional(),
  remove_protocol: z.boolean().optional(),
});`;

if (src.includes(SVC_SCHEMA_OLD)) {
  src = src.replace(SVC_SCHEMA_OLD, SVC_SCHEMA_NEW);
  changed++;
  console.log('[2] serviceSchema — přidány remove_invoice / remove_protocol');
} else {
  console.log('[2] serviceSchema — již upraven nebo nenalezen, přeskočeno');
}

// ── 3) PUT /tire-changes/:id — zpracovat remove flagy ──────────────────────
// Najdeme blok kde se provádí PUT a přidáme remove logiku před prisma.$transaction
const TIRE_PUT_OLD = `    if (!parsed.data.invoice_file_data) delete data.invoice_url;
    // Stejné pravidlo jako u faktury: pokud klient v této editaci nepřiložil
    // nový protokol, nepřepisujeme existující URL na null.
    if (!parsed.data.protocol_file_data) delete data.protocol_url;`;

const TIRE_PUT_NEW = `    if (!parsed.data.invoice_file_data) delete data.invoice_url;
    // Stejné pravidlo jako u faktury: pokud klient v této editaci nepřiložil
    // nový protokol, nepřepisujeme existující URL na null.
    if (!parsed.data.protocol_file_data) delete data.protocol_url;
    // Tlačítko koš — smaž soubor + vynuluj URL v záznamu
    if (parsed.data.remove_invoice) {
      removeStoredFile(existing.invoice_url);
      data.invoice_url = null;
    }
    if (parsed.data.remove_protocol) {
      removeStoredFile(existing.protocol_url);
      data.protocol_url = null;
    }`;

if (src.includes(TIRE_PUT_OLD)) {
  src = src.replace(TIRE_PUT_OLD, TIRE_PUT_NEW);
  changed++;
  console.log('[3] PUT /tire-changes — přidána logika remove_invoice / remove_protocol');
} else {
  console.log('[3] PUT /tire-changes — již upraven nebo nenalezen, přeskočeno');
}

// ── 4) PUT /services/:serviceId — zpracovat remove flagy ───────────────────
const SVC_PUT_OLD = `    if (!parsed.data.invoice_file_data) delete data.invoice_url;
    if (!parsed.data.protocol_file_data) delete data.protocol_url;`;

const SVC_PUT_NEW = `    if (!parsed.data.invoice_file_data) delete data.invoice_url;
    if (!parsed.data.protocol_file_data) delete data.protocol_url;
    // Tlačítko koš — smaž soubor + vynuluj URL v záznamu
    if (parsed.data.remove_invoice) {
      removeStoredFile(existing.invoice_url);
      data.invoice_url = null;
    }
    if (parsed.data.remove_protocol) {
      removeStoredFile(existing.protocol_url);
      data.protocol_url = null;
    }`;

if (src.includes(SVC_PUT_OLD)) {
  src = src.replace(SVC_PUT_OLD, SVC_PUT_NEW);
  changed++;
  console.log('[4] PUT /services — přidána logika remove_invoice / remove_protocol');
} else {
  console.log('[4] PUT /services — již upraven nebo nenalezen, přeskočeno');
}

fs.writeFileSync(FILE, src);
console.log(`\nHotovo. Provedeno ${changed} změn.`);
