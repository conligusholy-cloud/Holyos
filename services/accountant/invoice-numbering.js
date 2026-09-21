// =============================================================================
// HolyOS — Centralizovaný generátor čísla dokladu (bezpečný proti souběhu)
// =============================================================================
//
// Číslo přiděluje DATABÁZE atomicky přes tabulku document_counters
// (INSERT ... ON CONFLICT DO UPDATE ... RETURNING) — dva souběžné požadavky
// nikdy nedostanou stejné číslo (§5 zadání). UNIQUE na invoices.invoice_number
// je pojistka navíc.
//
// Číselné řady (per rok):
//   received             → FP-2026-00001  (faktura přijatá, AP)
//   issued               → FV-2026-00001  (finální/vydaná faktura, AR)
//   credit_note_received → DP-2026-00001  (dobropis přijatý)
//   credit_note_issued   → ODD-2026-00001 (opravný daňový doklad vydaný)
//   proforma_received    → ZP-2026-00001  (zálohová přijatá)
//   proforma_issued      → ZA-2026-00001  (zálohová faktura vydaná)
//   tax_receipt          → DD-2026-00001  (daňový doklad k přijaté platbě, DPPP)
//
// Řada se při prvním použití „naseeduje" z nejvyššího existujícího čísla se
// stejným prefixem (aby se nikdy nezopakovalo už vystavené číslo).

const { prisma: defaultPrisma } = require('../../config/database');

const PREFIX_MAP = {
  received: 'FP',
  issued: 'FV',
  credit_note_received: 'DP',
  credit_note_issued: 'ODD',
  proforma_received: 'ZP',
  proforma_issued: 'ZA',
  tax_receipt: 'DD',
};

/**
 * Atomicky přidělí další číslo dokladu pro daný typ.
 * @param {string} type Invoice.type
 * @param {object} [opts]
 * @param {object} [opts.prisma] Volitelný klient (např. transakce)
 * @returns {Promise<string>} např. "DD-2026-00042"
 */
async function generateInvoiceNumber(type, opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const year = new Date().getFullYear();
  const prefix = PREFIX_MAP[type] || 'FP';
  const series = `${prefix}-${year}`;
  const likePattern = `${series}-%`;

  // Jediný atomický příkaz: založ řadu naseedovanou z max existujícího čísla,
  // nebo inkrementuj stávající. RETURNING vrací přidělené pořadové číslo.
  // Pozn.: '(\\d+)$' v JS zdroji → SQL dostane regex (\d+)$ (trailing číslice).
  const rows = await db.$queryRaw`
    INSERT INTO document_counters (series, last_seq, updated_at)
    VALUES (
      ${series},
      COALESCE(
        (SELECT MAX(CAST(substring(invoice_number FROM '(\\d+)$') AS INTEGER))
           FROM invoices
          WHERE invoice_number LIKE ${likePattern}),
        0
      ) + 1,
      now()
    )
    ON CONFLICT (series) DO UPDATE
      SET last_seq = document_counters.last_seq + 1, updated_at = now()
    RETURNING last_seq;
  `;

  const seq = rows && rows[0] ? Number(rows[0].last_seq) : null;
  if (!seq || !Number.isFinite(seq)) {
    // Nouzový fallback (nemělo by nastat) — nikdy nevracet duplicitu bez pojistky.
    throw new Error('generateInvoiceNumber: nepodařilo se přidělit číslo pro ' + series);
  }
  return `${series}-${String(seq).padStart(5, '0')}`;
}

module.exports = { generateInvoiceNumber, PREFIX_MAP };
