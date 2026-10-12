// HolyOS — Bankovní účty pro fakturaci (CZK a EUR), na které mají chodit platby.
// Uloženo v AppSetting "billing.bank_accounts" jako JSON: { CZK: {account, iban, bic}, EUR: {account, iban, bic} }.
// Používá se u automaticky vystavovaných faktur (servisní poplatek, softwarová podpora).
'use strict';

const KEY = 'billing.bank_accounts';
const CURRENCIES = ['CZK', 'EUR'];

function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

function normalize(raw) {
  const out = {};
  CURRENCIES.forEach(function (cur) {
    const r = (raw && raw[cur]) || {};
    out[cur] = { account: clean(r.account), iban: clean(r.iban).replace(/\s+/g, '').toUpperCase(), bic: clean(r.bic).replace(/\s+/g, '').toUpperCase() };
  });
  return out;
}

async function getAccounts() {
  const { getSetting } = require('../settings');
  let raw = null;
  try { raw = await getSetting(KEY, { type: 'json', defaultValue: null }); } catch (e) { raw = null; }
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
  return normalize(raw);
}

async function setAccounts(raw, userId) {
  const { setSetting } = require('../settings');
  const v = normalize(raw);
  await setSetting(KEY, v, { type: 'json', description: 'Bankovní účty pro fakturaci (CZK / EUR)', scope: 'accounting', userId });
  return v;
}

// Pole pro Invoice (partner_bank_account / partner_iban / partner_bic) dle měny faktury; prázdný objekt, když účet není nastaven.
async function invoiceBankFields(currency) {
  const accs = await getAccounts();
  const a = accs[String(currency || '').toUpperCase()];
  if (!a || (!a.account && !a.iban)) return {};
  return { partner_bank_account: a.account || null, partner_iban: a.iban || null, partner_bic: a.bic || null };
}

module.exports = { getAccounts, setAccounts, invoiceBankFields, normalize };
