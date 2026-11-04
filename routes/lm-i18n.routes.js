// HolyOS — automatický překlad webu laundromats.eu (EN, PL). Volá jen server Laundromats
// (servisní JWT LM_SSO_SECRET). Laundromats posílá české texty, pro které nemá překlad;
// tady je přeloží Claude a uloží do AppSetting lm_i18n.<lang> (doplněk k i18n/*.json v repu).
// Díky tomu je každý nový text přeložený bez ručního spouštění scripts/laundromats-i18n.js.
const express = require('express');
const jwt = require('jsonwebtoken');
const settings = require('../services/settings');

const router = express.Router();
router.use(express.json({ limit: '300kb' }));
router.use((req, res, next) => {
  const secret = process.env.LM_SSO_SECRET; const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
  try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'laundromats' }); return next(); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
});
const LANGS = ['en', 'pl'];
const NAZEV = { en: 'angličtiny', pl: 'polštiny' };
const KEY = (l) => 'lm_i18n.' + l;
const load = async (l) => { const v = await settings.getSetting(KEY(l), { type: 'json', defaultValue: {} }).catch(() => ({})); return v && typeof v === 'object' ? v : {}; };
const POKYN = (lang) => [
  'Překládáš texty z webu laundromats.eu — prodejní web české firmy, která vyrábí a provozuje',
  'samoobslužné prádelny („prádlomaty") a nabízí je jako podnikatelskou příležitost.',
  'Přelož z češtiny do ' + NAZEV[lang] + '.',
  '',
  'PRAVIDLA:',
  '1. Zachovej tón originálu: věcný, přímý, bez marketingových frází navíc. Vykání → odpovídající zdvořilá forma.',
  '2. „Prádlomat" je název produktu — v angličtině „laundromat", v polštině „pralnia samoobsługowa"',
  '   (nebo „automat pralniczy", pokud jde o samotný stroj). „Laundromats" jako název firmy nepřekládej.',
  '3. HTML značky, entity (&nbsp;, &amp;), zástupné znaky ({x}, %s, @@…@@) a emoji nech PŘESNĚ tak, jak jsou.',
  '4. Čísla, jednotky a měny nepřepočítávej ani neměň (Kč zůstává Kč).',
  '5. Zachovej velikost písmen u nadpisů psaných verzálkami a koncovou interpunkci.',
  '6. Nepřidávej nic, co v originálu není, a nic nevynechávej. Vlastní jména, názvy produktů a zkratky nech beze změny.',
  '',
  'Vrátíš POUZE JSON pole překladů ve stejném pořadí a stejné délce jako vstup. Nic dalšího.',
].join('\n');

// GET /overlay?lang=en → { lang, dict }
router.get('/overlay', async (req, res) => {
  const l = String(req.query.lang || ''); if (!LANGS.includes(l)) return res.status(400).json({ error: 'Neznámý jazyk' });
  res.set('Cache-Control', 'no-store').json({ lang: l, dict: await load(l) });
});

// POST /translate { lang, keys: [...] } → { translations: { key: překlad } }
const busy = {};
router.post('/translate', async (req, res) => {
  try {
    const l = String((req.body || {}).lang || ''); if (!LANGS.includes(l)) return res.status(400).json({ error: 'Neznámý jazyk' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Chybí ANTHROPIC_API_KEY' });
    const keys = [...new Set((Array.isArray(req.body.keys) ? req.body.keys : []).map((k) => String(k)).filter((k) => k.trim() && k.length <= 2000))].slice(0, 40);
    while (busy[l]) await busy[l].catch(() => {}); // jeden překlad na jazyk najednou (ať se nepřepisují)
    let done; busy[l] = new Promise((ok) => { done = ok; });
    try {
      const d = await load(l);
      const todo = keys.filter((k) => !d[k]);
      if (todo.length) {
        const Anthropic = require('@anthropic-ai/sdk');
        const { messagesCreate } = require('../services/anthropic-retry');
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const r = await messagesCreate(client, { model: process.env.LM_I18N_MODEL || 'claude-sonnet-4-6', max_tokens: 8000, system: POKYN(l), messages: [{ role: 'user', content: JSON.stringify(todo, null, 1) }] });
        const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
        const a = text.indexOf('['), b = text.lastIndexOf(']');
        const out = a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : null;
        if (!Array.isArray(out) || out.length !== todo.length) throw new Error('Překlad vrátil neplatnou odpověď');
        todo.forEach((k, i) => { if (out[i] && String(out[i]).trim()) d[k] = String(out[i]); });
        await settings.setSetting(KEY(l), d, { type: 'json', description: 'Laundromats – automatické překlady (' + l + ')', scope: 'laundromats' });
        console.log('[lm-i18n] ' + l + ': přeloženo ' + todo.length + ' textů (celkem ' + Object.keys(d).length + ')');
      }
      const t = {}; keys.forEach((k) => { if (d[k]) t[k] = d[k]; });
      res.json({ translations: t });
    } finally { busy[l] = null; done(); }
  } catch (e) { console.warn('[lm-i18n]', e.message); res.status(502).json({ error: e.message }); }
});

module.exports = router;
