// =============================================================================
// HolyOS — Registr plátců DPH (MFČR / ADIS) — zveřejněné bankovní účty
// =============================================================================
// Veřejná SOAP služba MF ČR: getStatusNespolehlivyPlatceRozsireny(dic)
// vrací, zda je subjekt nespolehlivý plátce + seznam zveřejněných účtů.
// Bez registrace, bez klíče. Výsledky cachujeme v paměti (6 h).
// =============================================================================

const ENDPOINT = 'https://adisrws.mfcr.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP';
const NS = 'http://adis.mfcr.cz/rozhraniCRPDPH/';
const TTL_MS = 6 * 3600 * 1000;
const cache = new Map(); // dic → { at, data }

// Kanonický tvar CZ účtu: "předčíslí-číslo/kód" bez úvodních nul; IBAN CZ převede na tuzemský tvar
function canonAccount(s) {
  if (!s) return null;
  let v = String(s).replace(/\s+/g, '').toUpperCase();
  const ib = v.match(/^CZ\d{2}(\d{4})(\d{6})(\d{10})$/);
  if (ib) {
    const pre = ib[2].replace(/^0+/, ''), num = ib[3].replace(/^0+/, '');
    return (pre ? pre + '-' : '') + num + '/' + ib[1];
  }
  const m = v.match(/^(?:(\d{1,10})-)?(\d{1,20})\/(\d{4})$/);
  if (m) {
    const pre = (m[1] || '').replace(/^0+/, ''), num = m[2].replace(/^0+/, '');
    return (pre ? pre + '-' : '') + num + '/' + m[3];
  }
  return v.replace(/-/g, ''); // zahraniční IBAN apod.
}

function dicFor(company) {
  const raw = String((company && (company.dic || company.ico)) || '').replace(/\s+/g, '').toUpperCase();
  if (!raw) return null;
  if (/^CZ\d{8,10}$/.test(raw)) return raw.slice(2);
  if (/^\d{8,10}$/.test(raw)) return raw; // IČO = DIČ bez CZ u právnických osob
  return null; // zahraniční DIČ — registr MFČR jen pro CZ
}

const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? m[1] : ''; };

function parseResponse(xml) {
  const st = xml.match(/<(?:\w+:)?statusPlatceDPH\b[^>]*>/);
  if (!st) {
    const fault = xml.match(/<faultstring>([^<]*)</);
    throw new Error(fault ? fault[1] : 'Neočekávaná odpověď registru');
  }
  const unreliable = attr(st[0], 'nespolehlivyPlatce'); // ANO | NE | NENALEZEN
  const accounts = [];
  const re = /<(?:\w+:)?ucet\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?ucet>/g; let m;
  while ((m = re.exec(xml))) {
    const since = attr(m[1], 'datumZverejneni').slice(0, 10) || null;
    const s = m[2].match(/<(?:\w+:)?standardniUcet\b[^>]*>/);
    const n = m[2].match(/<(?:\w+:)?nestandardniUcet\b[^>]*>/);
    if (s) {
      const pre = attr(s[0], 'predcisli'), num = attr(s[0], 'cislo'), bank = attr(s[0], 'kodBanky');
      const acc = (pre ? pre + '-' : '') + num + '/' + bank;
      accounts.push({ account: acc, canon: canonAccount(acc), since });
    } else if (n) {
      const num = attr(n[0], 'cislo');
      accounts.push({ account: num, canon: canonAccount(num), since });
    }
  }
  const nameM = xml.match(/<(?:\w+:)?nazevSubjektu>([^<]*)</);
  return { found: unreliable !== 'NENALEZEN', unreliable: unreliable === 'ANO', accounts, name: nameM ? nameM[1] : null };
}

/**
 * Dotaz do registru. Vrací { ok, dic, found, unreliable, accounts[], name, cached } nebo { ok:false, error }.
 * @param {string} dic  DIČ bez "CZ"
 * @param {{cacheOnly?: boolean}} [opts]
 */
async function lookupDph(dic, opts = {}) {
  if (!dic) return { ok: false, error: 'Firma nemá CZ DIČ/IČO' };
  const hit = cache.get(dic);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.data, cached: true };
  if (opts.cacheOnly) return { ok: false, error: 'not_cached' };
  const body = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>'
    + '<StatusNespolehlivyPlatceRozsirenyRequest xmlns="' + NS + '"><dic>' + dic + '</dic></StatusNespolehlivyPlatceRozsirenyRequest>'
    + '</soapenv:Body></soapenv:Envelope>';
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(ENDPOINT, {
      method: 'POST', signal: ctrl.signal, body,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: NS + 'getStatusNespolehlivyPlatceRozsireny' },
    }).finally(() => clearTimeout(t));
    const xml = await r.text();
    const data = { ok: true, dic, ...parseResponse(xml), checked_at: new Date().toISOString() };
    cache.set(dic, { at: Date.now(), data });
    return data;
  } catch (e) {
    return { ok: false, dic, error: e.name === 'AbortError' ? 'Registr DPH neodpověděl (timeout)' : e.message };
  }
}

module.exports = { lookupDph, canonAccount, dicFor, parseResponse };
