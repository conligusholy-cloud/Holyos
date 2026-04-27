// HolyOS — Šablony upomínek (3 úrovně × 4 jazyky).
// Podle Country firmy, na kterou je faktura, zvolíme jazyk:
//   CZ → cs, SK → sk, DE/AT → de, ostatní → en
// Úrovně:
//   1 = 7 dní po splatnosti — zdvořilá připomínka
//   2 = 14 dní — důraznější výzva
//   3 = 21 dní — předsoudní upomínka

'use strict';

function pickLanguage(country) {
  const c = String(country || '').toUpperCase();
  if (c === 'CZ') return 'cs';
  if (c === 'SK') return 'sk';
  if (c === 'DE' || c === 'AT') return 'de';
  return 'en';
}

// Formátování dat dle jazyka
function fmtDate(d, lang) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (lang === 'cs' || lang === 'sk') {
    return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
  }
  if (lang === 'de') {
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
  }
  // en
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function fmtAmount(n, currency, lang) {
  const num = Number(n) || 0;
  if (lang === 'cs' || lang === 'sk') {
    return num.toLocaleString(lang === 'sk' ? 'sk-SK' : 'cs-CZ', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }) + ' ' + currency;
  }
  if (lang === 'de') {
    return num.toLocaleString('de-DE', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }) + ' ' + currency;
  }
  return currency + ' ' + num.toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// ŠABLONY
// ────────────────────────────────────────────────────────────────────────────

const TEMPLATES = {
  cs: {
    1: {
      subject: 'Připomínka splatnosti faktury č. {invoice_number}',
      body: [
        'Dobrý den,',
        '',
        'dovolujeme si Vás zdvořile upozornit, že faktura č. {invoice_number} ze dne {date_issued} ve výši {total} byla splatná {date_due} a doposud není uhrazena.',
        '',
        'Předpokládáme, že se jedná o nedopatření. Prosíme o úhradu v co nejkratším čase na bankovní účet {our_iban}, variabilní symbol {our_vs}.',
        '',
        'Pokud již byla platba uhrazena, prosíme tento email ignorujte. Jinak nás kontaktujte na této adrese — rádi věc společně vyřešíme.',
        '',
        'S přátelským pozdravem,',
        '{our_company_name}',
      ].join('\n'),
    },
    2: {
      subject: '2. upomínka — faktura č. {invoice_number} po splatnosti {days_overdue} dní',
      body: [
        'Dobrý den,',
        '',
        'navzdory naší předchozí připomínce evidujeme stále neuhrazenou fakturu č. {invoice_number} ze dne {date_issued} ve výši {total}, splatnou {date_due}. K dnešnímu dni je faktura {days_overdue} dní po splatnosti.',
        '',
        'Žádáme Vás o **bezodkladnou úhradu** na účet {our_iban} pod variabilním symbolem {our_vs}. Pokud platba neproběhne do 7 kalendářních dní, budeme nuceni přistoupit k poslední upomínce a následně k vymáhání dluhu.',
        '',
        'V případě potíží s úhradou nás prosím okamžitě kontaktujte — jsme připraveni jednat o splátkovém kalendáři.',
        '',
        'S pozdravem,',
        '{our_company_name}',
      ].join('\n'),
    },
    3: {
      subject: 'POSLEDNÍ UPOMÍNKA — faktura č. {invoice_number}, {days_overdue} dní po splatnosti',
      body: [
        'Vážený obchodní partnere,',
        '',
        'i přes opakované výzvy zůstává faktura č. {invoice_number} ze dne {date_issued} ve výši {total} (splatná {date_due}) neuhrazena. K dnešnímu dni je {days_overdue} dní po splatnosti.',
        '',
        'Toto je **poslední předžalobní upomínka**. Pokud nebude celá částka {total} připsána na účet {our_iban} (VS {our_vs}) do 7 kalendářních dní od doručení tohoto emailu, postoupíme pohledávku k soudnímu vymáhání bez dalšího upozornění. Zároveň Vám budeme účtovat úroky z prodlení dle Občanského zákoníku a veškeré náklady spojené s vymáháním.',
        '',
        'Pokud platba již proběhla nebo si přejete domluvit splátkový kalendář, kontaktujte nás obratem.',
        '',
        '{our_company_name}',
      ].join('\n'),
    },
  },

  sk: {
    1: {
      subject: 'Pripomienka splatnosti faktúry č. {invoice_number}',
      body: [
        'Dobrý deň,',
        '',
        'dovoľujeme si Vás zdvorilo upozorniť, že faktúra č. {invoice_number} zo dňa {date_issued} vo výške {total} bola splatná {date_due} a doposiaľ nie je uhradená.',
        '',
        'Predpokladáme, že ide o nedopatrenie. Prosíme o úhradu v čo najkratšom čase na bankový účet {our_iban}, variabilný symbol {our_vs}.',
        '',
        'Ak už bola platba uhradená, prosíme tento email ignorujte. V opačnom prípade nás kontaktujte na tejto adrese.',
        '',
        'S priateľským pozdravom,',
        '{our_company_name}',
      ].join('\n'),
    },
    2: {
      subject: '2. upomienka — faktúra č. {invoice_number} po splatnosti {days_overdue} dní',
      body: [
        'Dobrý deň,',
        '',
        'napriek našej predchádzajúcej pripomienke evidujeme stále neuhradenú faktúru č. {invoice_number} zo dňa {date_issued} vo výške {total}, splatnú {date_due}. K dnešnému dňu je faktúra {days_overdue} dní po splatnosti.',
        '',
        'Žiadame Vás o **bezodkladnú úhradu** na účet {our_iban} pod variabilným symbolom {our_vs}. Ak platba neprebehne do 7 kalendárnych dní, budeme nútení pristúpiť k poslednej upomienke a následne k vymáhaniu dlhu.',
        '',
        'V prípade ťažkostí s úhradou nás prosím okamžite kontaktujte.',
        '',
        'S pozdravom,',
        '{our_company_name}',
      ].join('\n'),
    },
    3: {
      subject: 'POSLEDNÁ UPOMIENKA — faktúra č. {invoice_number}, {days_overdue} dní po splatnosti',
      body: [
        'Vážený obchodný partner,',
        '',
        'aj napriek opakovaným výzvam zostáva faktúra č. {invoice_number} zo dňa {date_issued} vo výške {total} (splatná {date_due}) neuhradená. K dnešnému dňu je {days_overdue} dní po splatnosti.',
        '',
        'Toto je **posledná predžalobná upomienka**. Ak nebude celá suma {total} pripísaná na účet {our_iban} (VS {our_vs}) do 7 kalendárnych dní od doručenia tohto emailu, postúpime pohľadávku na súdne vymáhanie bez ďalšieho upozornenia. Zároveň Vám budeme účtovať úroky z omeškania a všetky náklady spojené s vymáhaním.',
        '',
        'Ak už platba prebehla alebo si želáte dohodnúť splátkový kalendár, kontaktujte nás obratom.',
        '',
        '{our_company_name}',
      ].join('\n'),
    },
  },

  de: {
    1: {
      subject: 'Zahlungserinnerung — Rechnung Nr. {invoice_number}',
      body: [
        'Sehr geehrte Damen und Herren,',
        '',
        'wir möchten Sie freundlich darauf aufmerksam machen, dass die Rechnung Nr. {invoice_number} vom {date_issued} in Höhe von {total} am {date_due} fällig war und bisher nicht beglichen wurde.',
        '',
        'Wir gehen davon aus, dass es sich um ein Versehen handelt. Bitte überweisen Sie den Betrag schnellstmöglich auf das Konto {our_iban}, Verwendungszweck (VS) {our_vs}.',
        '',
        'Sollte die Zahlung bereits erfolgt sein, bitten wir Sie, diese E-Mail zu ignorieren. Andernfalls kontaktieren Sie uns gerne unter dieser Adresse.',
        '',
        'Mit freundlichen Grüßen,',
        '{our_company_name}',
      ].join('\n'),
    },
    2: {
      subject: '2. Mahnung — Rechnung Nr. {invoice_number}, {days_overdue} Tage überfällig',
      body: [
        'Sehr geehrte Damen und Herren,',
        '',
        'trotz unserer vorherigen Erinnerung ist die Rechnung Nr. {invoice_number} vom {date_issued} in Höhe von {total}, fällig am {date_due}, noch nicht beglichen. Sie ist heute {days_overdue} Tage überfällig.',
        '',
        'Wir bitten Sie um **umgehende Zahlung** auf das Konto {our_iban} (VS {our_vs}). Sollte die Zahlung nicht innerhalb von 7 Kalendertagen erfolgen, sehen wir uns gezwungen, die letzte Mahnstufe einzuleiten und das Inkassoverfahren vorzubereiten.',
        '',
        'Bei Zahlungsschwierigkeiten kontaktieren Sie uns bitte umgehend, um eine Ratenzahlung zu vereinbaren.',
        '',
        'Mit freundlichen Grüßen,',
        '{our_company_name}',
      ].join('\n'),
    },
    3: {
      subject: 'LETZTE MAHNUNG — Rechnung Nr. {invoice_number}, {days_overdue} Tage überfällig',
      body: [
        'Sehr geehrter Geschäftspartner,',
        '',
        'trotz wiederholter Aufforderungen ist die Rechnung Nr. {invoice_number} vom {date_issued} in Höhe von {total} (fällig am {date_due}) nicht beglichen. Sie ist heute {days_overdue} Tage überfällig.',
        '',
        'Dies ist die **letzte vorgerichtliche Mahnung**. Sollte der Gesamtbetrag von {total} nicht innerhalb von 7 Kalendertagen ab Erhalt dieser E-Mail auf dem Konto {our_iban} (VS {our_vs}) eingegangen sein, werden wir die Forderung ohne weitere Vorankündigung gerichtlich geltend machen. Verzugszinsen und alle Inkassokosten werden Ihnen ebenfalls in Rechnung gestellt.',
        '',
        'Falls die Zahlung bereits erfolgt ist oder Sie eine Ratenzahlung vereinbaren möchten, kontaktieren Sie uns bitte sofort.',
        '',
        '{our_company_name}',
      ].join('\n'),
    },
  },

  en: {
    1: {
      subject: 'Payment reminder — Invoice {invoice_number}',
      body: [
        'Dear Sir or Madam,',
        '',
        'We would like to kindly remind you that invoice {invoice_number} dated {date_issued} for {total} was due on {date_due} and remains unpaid.',
        '',
        'We assume this is an oversight. Please arrange payment as soon as possible to bank account {our_iban}, reference (VS) {our_vs}.',
        '',
        'If payment has already been made, please disregard this message. Otherwise, do not hesitate to contact us at this address.',
        '',
        'Best regards,',
        '{our_company_name}',
      ].join('\n'),
    },
    2: {
      subject: '2nd reminder — Invoice {invoice_number}, {days_overdue} days overdue',
      body: [
        'Dear Sir or Madam,',
        '',
        'Despite our previous reminder, invoice {invoice_number} dated {date_issued} for {total}, due on {date_due}, remains unpaid. As of today the invoice is {days_overdue} days overdue.',
        '',
        'We urgently request **immediate payment** to account {our_iban} (reference {our_vs}). If payment is not received within 7 calendar days, we will be forced to issue a final notice and prepare debt recovery proceedings.',
        '',
        'If you are experiencing payment difficulties, please contact us immediately to discuss a payment plan.',
        '',
        'Best regards,',
        '{our_company_name}',
      ].join('\n'),
    },
    3: {
      subject: 'FINAL NOTICE — Invoice {invoice_number}, {days_overdue} days overdue',
      body: [
        'Dear business partner,',
        '',
        'Despite repeated requests, invoice {invoice_number} dated {date_issued} for {total} (due {date_due}) remains unpaid. As of today it is {days_overdue} days overdue.',
        '',
        'This is the **final notice before legal action**. If the full amount of {total} is not credited to account {our_iban} (reference {our_vs}) within 7 calendar days of receiving this email, we will pursue the debt through legal channels without further notice. Interest on late payment and all collection costs will be charged to you as well.',
        '',
        'If payment has already been made or you wish to arrange a repayment schedule, please contact us immediately.',
        '',
        '{our_company_name}',
      ].join('\n'),
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Vrátí { subject, body, language } pro fakturu + level.
 * @param {object} args
 * @param {number} args.level — 1, 2, 3
 * @param {object} args.invoice — { invoice_number, date_issued, date_due, total, currency, variable_symbol, ... }
 * @param {object} args.partner — { name, country, ... } (Company)
 * @param {object} args.us — { name, iban } (naše firma)
 * @param {Date}   [args.today] — pro testy/preview, default new Date()
 */
function buildReminder({ level, invoice, partner, us, today }) {
  if (![1, 2, 3].includes(level)) throw new Error(`Neplatný level: ${level}`);
  const lang = pickLanguage(partner?.country);
  const tpl = TEMPLATES[lang][level];
  if (!tpl) throw new Error(`Šablona chybí: ${lang} / ${level}`);

  const now = today || new Date();
  const due = invoice.date_due ? new Date(invoice.date_due) : null;
  const daysOverdue = due ? Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24))) : 0;

  const vars = {
    invoice_number: invoice.invoice_number || '',
    date_issued: fmtDate(invoice.date_issued, lang),
    date_due: fmtDate(invoice.date_due, lang),
    total: fmtAmount(invoice.total, invoice.currency || 'CZK', lang),
    days_overdue: String(daysOverdue),
    our_iban: us?.iban || invoice.partner_iban || '—',
    our_vs: invoice.variable_symbol || invoice.invoice_number || '',
    our_company_name: us?.name || 'Best Series s.r.o.',
    customer_name: partner?.name || '',
  };

  const replace = s => Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), v),
    s
  );

  return {
    subject: replace(tpl.subject),
    body: replace(tpl.body),
    language: lang,
    days_overdue: daysOverdue,
  };
}

module.exports = { buildReminder, pickLanguage };
