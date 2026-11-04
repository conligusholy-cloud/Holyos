// Laundromats — automatický překlad nových textů (EN, PL).
// Když stránka v EN/PL narazí na český text bez překladu, zobrazí ho zatím česky a text
// zařadí do fronty. Fronta ho za pár sekund pošle do HolyOS (/api/auth/lm/i18n/translate),
// kde ho přeloží Claude a uloží (AppSetting lm_i18n.<lang>). Překlad se hned přidá do
// slovníku, takže další zobrazení už je přeložené — bez ručního spouštění skriptu.
'use strict';
const jwt = require('jsonwebtoken');
const I18N = require('./i18n');

module.exports = function createAuto({ HOLYOS_URL, LM_SECRET }) {
  const queue = { en: new Set(), pl: new Set() };
  const failed = new Map(); // klíč → čas posledního neúspěchu (ať se nezkouší pořád dokola)
  let timer = null, running = false;
  const tok = () => jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '2m' });
  async function call(method, p, body) {
    const r = await fetch(HOLYOS_URL + '/api/auth/lm/i18n' + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + tok() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  // Osobní údaje (jméno, e-mail, telefon) ani čistá čísla do překladu neposíláme.
  const skip = (k) => /@|https?:\/\/|\+?\d[\d ]{7,}\d/.test(k) || k.length < 2;
  function collect(lang, missing, exclude) {
    if (!LM_SECRET || !queue[lang] || !missing || !missing.size) return;
    const ex = new Set((exclude || []).filter(Boolean).flatMap((x) => [String(x).trim(), ...String(x).trim().split(/\s+/)]));
    for (const k of missing) {
      if (skip(k) || ex.has(k)) continue;
      const f = failed.get(lang + k); if (f && Date.now() - f < 30 * 60e3) continue;
      queue[lang].add(k);
    }
    if (!timer) timer = setTimeout(flush, 4000);
  }
  async function flush() {
    timer = null; if (running) { timer = setTimeout(flush, 4000); return; }
    running = true;
    try {
      for (const lang of Object.keys(queue)) {
        while (queue[lang].size) {
          const batch = [...queue[lang]].slice(0, 30); batch.forEach((k) => queue[lang].delete(k));
          try {
            const j = await call('POST', '/translate', { lang, keys: batch });
            const n = I18N.addOverlay(lang, j.translations || {});
            if (n) console.log('[i18n-auto] ' + lang + ': +' + n + ' překladů');
            batch.forEach((k) => { if (!(j.translations || {})[k]) failed.set(lang + k, Date.now()); });
          } catch (e) { console.warn('[i18n-auto] ' + lang + ':', e.message); batch.forEach((k) => failed.set(lang + k, Date.now())); break; }
        }
      }
    } finally { running = false; }
  }
  // Při startu a pak co 10 min stáhnout uložené překlady (víc instancí / nový deploy).
  async function sync() {
    if (!LM_SECRET) return;
    for (const lang of Object.keys(queue)) {
      try { const j = await call('GET', '/overlay?lang=' + lang); const n = I18N.addOverlay(lang, j.dict || {}); if (n) console.log('[i18n-auto] ' + lang + ': načteno ' + n + ' automatických překladů'); }
      catch (e) { console.warn('[i18n-auto] načtení ' + lang + ':', e.message); }
    }
  }
  setTimeout(sync, 3000); setInterval(sync, 10 * 60e3).unref();
  return { collect, sync };
};
