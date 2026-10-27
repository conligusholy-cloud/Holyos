// HolyOS — Veřejné API stránky „Zaplatit doklad přes QR" (odkaz z e-mailu, bez přihlášení, jen podepsaný token)
'use strict';
const express = require('express');
const { prisma } = require('../config/database');
const { logAudit } = require('../services/audit');
const { verifyAccount } = require('../services/banking/account-verification');
const { verifyToken, buildSpd, BLOCKED } = require('../services/accounting/invoice-qr');

const router = express.Router();

const SELECT = {
  id: true, invoice_number: true, external_number: true, direction: true, status: true, tags: true,
  total: true, paid_amount: true, currency: true, variable_symbol: true, constant_symbol: true, specific_symbol: true,
  date_due: true, partner_bank_account: true, partner_iban: true, company_id: true,
  company: { select: { name: true } },
};

// Načte doklad podle tokenu a spočítá, jestli se dá platit
async function loadState(token) {
  const t = verifyToken(token);
  if (!t) return { http: 404, error: 'Neplatný odkaz.' };
  if (t.expired) return { http: 410, error: 'Platnost odkazu vypršela — pošli si z HolyOS nový e-mail.' };
  const inv = await prisma.invoice.findUnique({ where: { id: t.id }, select: SELECT });
  if (!inv || inv.direction !== 'ap') return { http: 404, error: 'Doklad nenalezen.' };
  const remaining = Math.round((Number(inv.total) - Number(inv.paid_amount || 0)) * 100) / 100;
  let blocked = BLOCKED[inv.status] || null;
  if (!blocked && remaining <= 0.009) blocked = 'Na dokladu není co doplácet.';
  if (!blocked && !inv.partner_bank_account && !inv.partner_iban) blocked = 'Doklad nemá účet příjemce.';
  if (!blocked && (inv.partner_bank_account || inv.partner_iban)) {
    try {
      const v = await verifyAccount({ companyId: inv.company_id, partnerBankAccount: inv.partner_bank_account, partnerIban: inv.partner_iban });
      if (v.needs_physical) blocked = 'Účet příjemce není ověřený — nejdřív ho ověř v HolyOS (Účetní doklady → detail dokladu → 🔐).';
    } catch (e) { blocked = 'Účet příjemce se nepodařilo ověřit: ' + e.message; }
  }
  return { inv, remaining, blocked, already_qr: inv.status === 'qr_pending' };
}

router.get('/:token', async (req, res) => {
  try {
    const s = await loadState(req.params.token);
    if (s.error) return res.status(s.http).json({ error: s.error });
    const { inv } = s;
    res.json({
      invoice_number: inv.invoice_number, external_number: inv.external_number, supplier: inv.company && inv.company.name,
      amount: s.remaining, currency: inv.currency, date_due: inv.date_due, variable_symbol: inv.variable_symbol,
      account: inv.partner_iban || inv.partner_bank_account, status: inv.status, blocked: s.blocked, already_qr: s.already_qr,
    });
  } catch (e) { console.error('[invoice-qr] info:', e); res.status(500).json({ error: 'Chyba serveru.' }); }
});

// Vygenerování QR kódu = doklad se označí „platí se přes QR" (qr_pending) a zmizí z nabídky k platbě
router.post('/:token/generate', async (req, res) => {
  try {
    const s = await loadState(req.params.token);
    if (s.error) return res.status(s.http).json({ error: s.error });
    if (s.blocked) return res.status(409).json({ error: s.blocked });
    const { inv, remaining } = s;
    const spd = buildSpd({ ...inv }, remaining);
    if (spd.error) return res.status(400).json({ error: spd.error });

    if (inv.status !== 'qr_pending') {
      // atomicky — když mezitím vznikl příkaz / platba, QR se nevygeneruje (ochrana proti dvojí platbě)
      const tags = (inv.tags || []).filter((x) => !String(x).startsWith('qr_prev:'));
      tags.push('qr_prev:' + inv.status);
      const r = await prisma.invoice.updateMany({
        where: { id: inv.id, status: inv.status },
        data: { status: 'qr_pending', tags },
      });
      if (r.count === 0) {
        const again = await loadState(req.params.token);
        return res.status(409).json({ error: (again.blocked) || 'Stav dokladu se mezitím změnil — načti stránku znovu.' });
      }
      logAudit({
        action: 'update', entity: 'invoice', entity_id: inv.id,
        description: `${inv.invoice_number}: vygenerován QR kód k platbě (${remaining} ${inv.currency}) → platí se přes QR; zaplaceno se potvrdí až nalezením ve výpisu`,
        changes: { qr_pay: { status_from: inv.status, amount: remaining } },
      }).catch(() => {});
    }

    const QRCode = require('qrcode');
    const qr = await QRCode.toDataURL(spd.spd, { errorCorrectionLevel: 'M', margin: 2, width: 420 });
    res.json({ qr, spd: spd.spd, iban: spd.iban, account: inv.partner_bank_account || null, amount: remaining, currency: inv.currency, variable_symbol: inv.variable_symbol, invoice_number: inv.invoice_number, supplier: inv.company && inv.company.name });
  } catch (e) { console.error('[invoice-qr] generate:', e); res.status(500).json({ error: 'Chyba serveru.' }); }
});

module.exports = { router };
