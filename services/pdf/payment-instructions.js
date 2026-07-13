// =============================================================================
// HolyOS — Pokyny k platbě (Compounding rezervace)
// =============================================================================
// PDF s částkami, splatnostmi, bankovními údaji (tuzemsky + zahraničně) a QR kódy
// (CZK = QR Platba / SPD, EUR = SEPA EPC). Lokalizováno do jazyka zákazníka.
// NENÍ to daňový doklad — jen výzva k úhradě; fakturu vystavíme po platbě.

const QRCode = require('qrcode');
const contracts = require('./contracts');
const { buildSpaydString, czAccountToIban } = require('./invoice-pdf');

// ── Lokalizace ──────────────────────────────────────────────────────────────
const T = {
  cs: { title:'Pokyny k platbě', notdoc:'Toto není daňový doklad — fakturu vystavíme po přijetí platby.', domestic:'Tuzemská platba (CZK)', foreign:'Zahraniční platba (EUR / SEPA)', accno:'Číslo účtu', iban:'IBAN', vs:'Variabilní symbol', amount:'Částka', bic:'BIC / SWIFT', msg:'Zpráva pro příjemce', scancz:'Naskenujte v bankovní aplikaci (QR Platba)', scaneu:'Naskenujte v bankovní aplikaci (SEPA)', due:'Splatnost do', rate:'kurz', base:'Základ bez DPH', vat:'DPH', total:'Celkem k úhradě', reverse:'přenesená daňová povinnost (0 % DPH — reverse charge)', note:'Variabilní symbol uvádějte u každé platby. Po přijetí platby vám vystavíme fakturu (daňový doklad).' },
  en: { title:'Payment instructions', notdoc:'This is not a tax document — we will issue an invoice once the payment is received.', domestic:'Domestic payment (CZK)', foreign:'International payment (EUR / SEPA)', accno:'Account number', iban:'IBAN', vs:'Variable symbol', amount:'Amount', bic:'BIC / SWIFT', msg:'Message for recipient', scancz:'Scan in your banking app (QR payment)', scaneu:'Scan in your banking app (SEPA)', due:'Due by', rate:'rate', base:'Net (excl. VAT)', vat:'VAT', total:'Total to pay', reverse:'reverse charge (0% VAT)', note:'Please include the variable symbol with each payment. Once received, we will issue an invoice.' },
  sk: { title:'Pokyny na platbu', notdoc:'Toto nie je daňový doklad — faktúru vystavíme po prijatí platby.', domestic:'Tuzemská platba (CZK)', foreign:'Zahraničná platba (EUR / SEPA)', accno:'Číslo účtu', iban:'IBAN', vs:'Variabilný symbol', amount:'Suma', bic:'BIC / SWIFT', msg:'Správa pre príjemcu', scancz:'Naskenujte v bankovej aplikácii (QR platba)', scaneu:'Naskenujte v bankovej aplikácii (SEPA)', due:'Splatnosť do', rate:'kurz', base:'Základ bez DPH', vat:'DPH', total:'Spolu na úhradu', reverse:'prenesená daňová povinnosť (0 % DPH — reverse charge)', note:'Variabilný symbol uvádzajte pri každej platbe. Po prijatí platby vystavíme faktúru.' },
  de: { title:'Zahlungsanweisungen', notdoc:'Dies ist kein Steuerdokument — nach Zahlungseingang stellen wir eine Rechnung aus.', domestic:'Inlandszahlung (CZK)', foreign:'Auslandszahlung (EUR / SEPA)', accno:'Kontonummer', iban:'IBAN', vs:'Variables Symbol', amount:'Betrag', bic:'BIC / SWIFT', msg:'Verwendungszweck', scancz:'In der Banking-App scannen (QR-Zahlung)', scaneu:'In der Banking-App scannen (SEPA)', due:'Fällig bis', rate:'Kurs', base:'Netto (ohne MwSt.)', vat:'MwSt.', total:'Zu zahlen gesamt', reverse:'Reverse-Charge (0 % MwSt.)', note:'Bitte geben Sie bei jeder Zahlung das variable Symbol an. Nach Zahlungseingang stellen wir eine Rechnung aus.' },
  pl: { title:'Instrukcje płatności', notdoc:'To nie jest dokument podatkowy — fakturę wystawimy po otrzymaniu płatności.', domestic:'Płatność krajowa (CZK)', foreign:'Płatność zagraniczna (EUR / SEPA)', accno:'Numer konta', iban:'IBAN', vs:'Symbol zmienny', amount:'Kwota', bic:'BIC / SWIFT', msg:'Tytuł przelewu', scancz:'Zeskanuj w aplikacji bankowej (QR)', scaneu:'Zeskanuj w aplikacji bankowej (SEPA)', due:'Termin do', rate:'kurs', base:'Netto (bez VAT)', vat:'VAT', total:'Do zapłaty', reverse:'odwrotne obciążenie (0% VAT)', note:'Przy każdej płatności podaj symbol zmienny. Po otrzymaniu płatności wystawimy fakturę.' },
};
function pickLang(l) { const c = String(l || 'cs').toLowerCase().split(/[-_]/)[0]; return T[c] ? c : 'en'; }
function L(lang) { return T[pickLang(lang)]; }

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function money(n) { return (n == null) ? '—' : Number(n).toLocaleString('cs-CZ'); }
function czDate(d) { if (!d) return '—'; const x = new Date(d); return x.getDate() + '. ' + (x.getMonth() + 1) + '. ' + x.getFullYear(); }

function epcString({ name, iban, bic, amount, message }) {
  if (!iban) return null;
  return ['BCD', '002', '1', 'SCT', (bic || ''), String(name || '').slice(0, 70),
    String(iban).replace(/\s+/g, ''), 'EUR' + Number(amount).toFixed(2), '', '',
    String(message || '').slice(0, 140)].join('\n');
}
async function qrDataUrl(text) { if (!text) return null; try { return await QRCode.toDataURL(text, { margin: 1, width: 220 }); } catch (e) { return null; } }
function czkIbanOf(czk) {
  if (!czk) return '';
  if (czk.iban) return String(czk.iban).replace(/\s+/g, '');
  if (czk.account && czk.bankCode) { try { return czAccountToIban(czk.account + '/' + czk.bankCode); } catch (e) { return ''; } }
  return '';
}

async function renderItem(item, bank, tr, eurRate, vat) {
  const cur = item.currency || 'CZK';
  // Ceny v systému jsou BEZ DPH. Když není reverse charge (EU plátce), přičteme 21 % DPH.
  const reverseCharge = !!(vat && vat.reverseCharge);
  const vatRate = reverseCharge ? 0 : ((vat && typeof vat.rate === 'number') ? vat.rate : 0.21);
  const base = Number(item.amount) || 0;
  const vatAmt = Math.round(base * vatRate * 100) / 100;
  const total = Math.round((base + vatAmt) * 100) / 100; // částka k úhradě (s DPH)
  const czkIban = czkIbanOf(bank.czk);
  const czqr = czkIban ? await qrDataUrl(buildSpaydString({ iban: czkIban, amount: total, currency: cur === 'EUR' ? 'EUR' : 'CZK', vs: item.vs, message: item.label })) : null;
  // Zahraniční platba je vždy v EUR — přepočet částky k úhradě z CZK dle kurzu (CZK za 1 EUR).
  const rate = (eurRate && eurRate > 0) ? eurRate : 25;
  const eurTotal = (cur === 'EUR') ? total : (total / rate);
  const eurRounded = Math.round(eurTotal * 100) / 100;
  const eurqr = (bank.eur && bank.eur.iban) ? await qrDataUrl(epcString({ name: bank.eur.name, iban: bank.eur.iban, bic: bank.eur.bic, amount: eurRounded, message: item.label })) : null;
  const vatLine = reverseCharge
    ? (esc(tr.base) + ': ' + money(base) + ' ' + esc(cur) + ' · ' + esc(tr.reverse))
    : (esc(tr.base) + ': ' + money(base) + ' ' + esc(cur) + ' · ' + esc(tr.vat) + ' ' + Math.round(vatRate * 100) + ' %: ' + money(vatAmt) + ' ' + esc(cur));

  const domestic = bank.czk ? `
    <div class="col">
      <div class="ch">${esc(tr.domestic)}</div>
      <table class="kv">
        ${bank.czk.account ? `<tr><td>${esc(tr.accno)}</td><td><b>${esc(bank.czk.account)}${bank.czk.bankCode ? '/' + esc(bank.czk.bankCode) : ''}</b></td></tr>` : ''}
        ${czkIban ? `<tr><td>${esc(tr.iban)}</td><td>${esc(czkIban)}</td></tr>` : ''}
        <tr><td>${esc(tr.vs)}</td><td><b>${esc(item.vs)}</b></td></tr>
        <tr><td>${esc(tr.total)}</td><td><b>${money(total)} ${esc(cur)}</b></td></tr>
      </table>
      ${czqr ? `<img class="qr" src="${czqr}" alt="QR"><div class="qrl">${esc(tr.scancz)}</div>` : ''}
    </div>` : '';

  const foreign = (bank.eur && bank.eur.iban) ? `
    <div class="col">
      <div class="ch">${esc(tr.foreign)}</div>
      <table class="kv">
        <tr><td>${esc(tr.iban)}</td><td><b>${esc(bank.eur.iban)}</b></td></tr>
        ${bank.eur.bic ? `<tr><td>${esc(tr.bic)}</td><td>${esc(bank.eur.bic)}</td></tr>` : ''}
        <tr><td>${esc(tr.msg)}</td><td>${esc(item.label)}</td></tr>
        <tr><td>${esc(tr.total)}</td><td><b>${money(eurRounded)} EUR</b><div style="font-size:10px;color:#999">${money(total)} ${esc(cur)} · ${esc(tr.rate)} ${rate.toLocaleString('cs-CZ')} CZK/EUR</div></td></tr>
      </table>
      ${eurqr ? `<img class="qr" src="${eurqr}" alt="SEPA"><div class="qrl">${esc(tr.scaneu)}</div>` : ''}
    </div>` : '';

  return `<div class="item">
    <div class="ititle">${esc(item.label)}</div>
    <div class="idue">${esc(tr.due)} <b>${czDate(item.due)}</b></div>
    <div class="idue">${vatLine} · <b>${esc(tr.total)}: ${money(total)} ${esc(cur)}</b></div>
    <div class="cols">${domestic}${foreign}</div>
  </div>`;
}

async function generatePaymentInstructionsPdf({ title, buyer, items, bank, note, lang, eurRate, reverseCharge, vatRate }) {
  const tr = L(lang);
  const vat = { reverseCharge: !!reverseCharge, rate: (typeof vatRate === 'number') ? vatRate : 0.21 };
  const parts = [];
  for (const it of (items || [])) parts.push(await renderItem(it, bank || {}, tr, eurRate, vat));
  const html = `<!DOCTYPE html><html lang="${esc(pickLang(lang))}"><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a;font-size:12.5px;margin:0;padding:34px 40px}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#666;margin:0 0 18px;font-size:12px}
    .buyer{background:#f6f6f8;border:1px solid #e5e5ea;border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:12px}
    .item{border:1px solid #e5e5ea;border-radius:10px;padding:14px 16px;margin-bottom:16px}
    .ititle{font-size:15px;font-weight:700;margin-bottom:2px} .idue{color:#555;font-size:12px;margin-bottom:12px}
    .cols{display:flex;gap:24px;flex-wrap:wrap} .col{flex:1;min-width:240px}
    .ch{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700;margin-bottom:6px}
    table.kv{width:100%;border-collapse:collapse;font-size:12px} table.kv td{padding:3px 0;vertical-align:top} table.kv td:first-child{color:#777;width:42%}
    .qr{width:150px;height:150px;margin-top:10px} .qrl{font-size:10.5px;color:#999;margin-top:2px}
    .note{font-size:11px;color:#777;margin-top:8px;line-height:1.6;border-top:1px solid #eee;padding-top:12px}
  </style></head><body>
    <h1>${esc(title || tr.title)}</h1>
    <div class="sub">COMPOUNDER · Best Series s.r.o. · IČO 05643724 — ${esc(tr.notdoc)}</div>
    ${buyer ? `<div class="buyer"><b>${esc(buyer.name || '')}</b>${buyer.email ? ' · ' + esc(buyer.email) : ''}${buyer.phone ? ' · ' + esc(buyer.phone) : ''}</div>` : ''}
    ${parts.join('')}
    <div class="note">${esc(note || tr.note)}</div>
  </body></html>`;
  return contracts.htmlToPdfBuffer(html);
}

module.exports = { generatePaymentInstructionsPdf, epcString, qrDataUrl, pickLang };
