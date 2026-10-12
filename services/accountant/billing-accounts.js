// HolyOS — Bankovní účty pro fakturaci (CZK a EUR), na které mají chodit platby.
// Účty se vybírají z agendy Banka (tabulka bank_accounts); výběr je v AppSetting
// "billing.bank_accounts" jako JSON: { CZK: <bank_account_id>, EUR: <bank_account_id> }.
// Používá se u automaticky vystavovaných faktur (servisní poplatek, softwarová podpora).
'use strict';

const { prisma } = require('../../config/database');
const KEY = 'billing.bank_accounts';
const CURRENCIES = ['CZK', 'EUR'];

function toId(v) { const n = parseInt(v && typeof v === 'object' ? v.bank_account_id : v, 10); return n > 0 ? n : null; }

async function getSelection() {
  const { getSetting } = require('../settings');
  let raw = null;
  try { raw = await getSetting(KEY, { type: 'json', defaultValue: null }); } catch (e) { raw = null; }
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
  const out = {};
  CURRENCIES.forEach(function (c) { out[c] = toId(raw && raw[c]); });
  return out;
}

async function setSelection(raw, userId) {
  const { setSetting } = require('../settings');
  const v = {};
  CURRENCIES.forEach(function (c) { v[c] = toId(raw && raw[c]); });
  await setSetting(KEY, v, { type: 'json', description: 'Bankovní účty pro fakturaci (CZK / EUR) — id z agendy Banka', scope: 'accounting', userId });
  return v;
}

function fmtNumber(a) { return a.account_number + '/' + a.bank_code; }

// Účet pro měnu: vybraný v nastavení; když není vybrán a existuje právě jeden aktivní účet v dané měně, použije se ten.
async function resolveAccount(currency) {
  const cur = String(currency || '').toUpperCase();
  const sel = await getSelection();
  if (sel[cur]) {
    const a = await prisma.bankAccount.findUnique({ where: { id: sel[cur] } }).catch(function () { return null; });
    if (a && a.active) return a;
  }
  const same = await prisma.bankAccount.findMany({ where: { currency: cur, active: true }, take: 2 }).catch(function () { return []; });
  return same.length === 1 ? same[0] : null;
}

// Pole pro Invoice (partner_bank_account / partner_iban / partner_bic) dle měny faktury; prázdný objekt, když účet není k dispozici.
async function invoiceBankFields(currency) {
  const a = await resolveAccount(currency);
  if (!a) return {};
  return { partner_bank_account: fmtNumber(a), partner_iban: a.iban || null, partner_bic: a.bic || null };
}

// Pro UI: nabídka aktivních účtů z agendy Banka + aktuální výběr.
async function getOverview() {
  const accounts = await prisma.bankAccount.findMany({ where: { active: true }, orderBy: [{ currency: 'asc' }, { name: 'asc' }] });
  const sel = await getSelection();
  const list = accounts.map(function (a) { return { id: a.id, name: a.name, bank: a.bank, currency: a.currency, number: fmtNumber(a), iban: a.iban || '', bic: a.bic || '' }; });
  const effective = {};
  for (const c of CURRENCIES) { const a = await resolveAccount(c); effective[c] = a ? a.id : null; }
  return { accounts: list, selected: sel, effective };
}

module.exports = { getSelection, setSelection, invoiceBankFields, resolveAccount, getOverview };
