// HolyOS — Překladač (živý chatovací překladač na mobilu)
// Přepis řeči běží zdarma v prohlížeči (Web Speech API). Sem chodí dokončené
// promluvy, přeloží se přes AI do cílového jazyka a uloží (originál + překlad +
// řečník). Historie se dá znovu otevřít.

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { messagesCreate, humanizeAiError } = require('../services/anthropic-retry');

router.use(requireAuth);

// ISO kód → český název jazyka (pro AI prompt a UI). Neúplný seznam = fallback na kód.
const LANG_NAMES = {
  cs: 'čeština', sk: 'slovenština', en: 'angličtina', de: 'němčina', pl: 'polština',
  uk: 'ukrajinština', ru: 'ruština', es: 'španělština', it: 'italština', fr: 'francouzština',
  pt: 'portugalština', nl: 'nizozemština', hu: 'maďarština', ro: 'rumunština', hr: 'chorvatština',
  bg: 'bulharština', sr: 'srbština', el: 'řečtina', tr: 'turečtina', ar: 'arabština',
  zh: 'čínština', vi: 'vietnamština', mn: 'mongolština',
};
function langName(code) {
  const c = String(code || '').toLowerCase().slice(0, 2);
  return LANG_NAMES[c] || ('jazyk ' + c);
}

// Přeloží text do cílového jazyka + rozpozná zdrojový jazyk. Levné, krátké volání.
// Vrací { translated, sourceLang }. Když AI není k dispozici, vrátí originál.
async function translateText(text, targetLang) {
  const src = String(text || '').trim();
  if (!src) return { translated: '', sourceLang: null };
  if (!process.env.ANTHROPIC_API_KEY) return { translated: src, sourceLang: null };
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.TRANSLATOR_MODEL || 'claude-sonnet-4-6';
  const tgt = langName(targetLang);
  const sys = 'Jsi precizní tlumočník. Dostaneš útržek mluvené řeči (může být neúplný). '
    + 'Rozpoznej jeho jazyk a přelož ho do cílového jazyka: ' + tgt + ' (ISO „' + String(targetLang).toLowerCase().slice(0, 2) + '"). '
    + 'Překládej přirozeně a věrně, zachovej tón. Pokud je vstup už v cílovém jazyce, jen ho uprav do čisté podoby. '
    + 'Nepřidávej nic navíc, žádné komentáře. Odpověz POUZE platným JSON bez markdownu: '
    + '{"lang":"<ISO kód rozpoznaného zdrojového jazyka, 2 písmena>","text":"<překlad do cílového jazyka>"}';
  const msg = await messagesCreate(client, {
    model, max_tokens: 600, temperature: 0,
    system: sys,
    messages: [{ role: 'user', content: src }],
  }, { label: 'translator' });
  let out = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
  out = out.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
  let j;
  try { j = JSON.parse(out); } catch (e) { j = { lang: null, text: out }; }
  return {
    translated: String((j && j.text) || '').slice(0, 4000),
    sourceLang: j && j.lang ? String(j.lang).toLowerCase().slice(0, 8) : null,
  };
}

// POST /api/translator/deepgram-token — krátkodobý token pro přímé streamování
// z prohlížeče do Deepgramu (hlavní klíč DEEPGRAM_API_KEY zůstává na serveru).
router.post('/deepgram-token', async (req, res, next) => {
  try {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) return res.status(400).json({ error: 'Chybí DEEPGRAM_API_KEY na serveru. Doplň ho do .env i do Railway proměnných.' });
    const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { 'Authorization': 'Token ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[translator] Deepgram grant selhal:', r.status, data);
      return res.status(502).json({ error: 'Deepgram token se nepodařilo získat (' + r.status + '). Zkontroluj DEEPGRAM_API_KEY.' });
    }
    // Deepgram vrací { access_token, expires_in }
    res.json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (err) {
    console.error('[translator] deepgram-token chyba:', err.message);
    res.status(500).json({ error: 'Chyba při získávání Deepgram tokenu.' });
  }
});

// POST /api/translator/sessions — založí nový rozhovor
const createSchema = z.object({
  targetLang: z.string().min(2).max(8),
  title: z.string().max(200).optional().nullable(),
});
router.post('/sessions', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const s = await prisma.translatorSession.create({
      data: {
        target_lang: parsed.data.targetLang.toLowerCase().slice(0, 8),
        title: parsed.data.title || null,
        created_by_user_id: (req.user && req.user.id) || null,
        created_by_name: (req.user && (req.user.displayName || req.user.username)) || null,
      },
    });
    res.status(201).json({ id: s.id, target_lang: s.target_lang });
  } catch (err) { next(err); }
});

// POST /api/translator/sessions/:id/lines — přidá promluvu (přeloží + uloží)
const lineSchema = z.object({
  original: z.string().min(1).max(4000),
  speaker: z.string().max(40).optional(),
});
router.post('/sessions/:id/lines', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = lineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const session = await prisma.translatorSession.findUnique({ where: { id }, select: { id: true, target_lang: true, title: true, lines_count: true } });
    if (!session) return res.status(404).json({ error: 'Rozhovor nenalezen' });

    let translated = null, sourceLang = null;
    try {
      const r = await translateText(parsed.data.original, session.target_lang);
      translated = r.translated; sourceLang = r.sourceLang;
    } catch (e) {
      // Překlad selhal (např. došel kredit) — uložíme aspoň originál a vrátíme hlášku.
      const line = await prisma.translatorLine.create({
        data: { session_id: id, speaker: (parsed.data.speaker || '1').slice(0, 40), original: parsed.data.original, translated: null, source_lang: null },
      });
      await prisma.translatorSession.update({ where: { id }, data: { lines_count: { increment: 1 } } });
      return res.status(200).json({ id: line.id, translated: null, sourceLang: null, aiError: humanizeAiError(e) });
    }

    const line = await prisma.translatorLine.create({
      data: {
        session_id: id,
        speaker: (parsed.data.speaker || '1').slice(0, 40),
        original: parsed.data.original,
        translated,
        source_lang: sourceLang,
      },
    });
    // Titulek doplníme z prvního přeloženého řádku (ať jde rozhovor poznat v historii).
    const patch = { lines_count: { increment: 1 } };
    if (!session.title) patch.title = String(translated || parsed.data.original).slice(0, 120);
    if (sourceLang) patch.source_lang = sourceLang;
    await prisma.translatorSession.update({ where: { id }, data: patch });

    res.status(201).json({ id: line.id, translated, sourceLang });
  } catch (err) { next(err); }
});

// POST /api/translator/sessions/:id/reply — moje odpověď přeložená do jazyka druhého
const replySchema = z.object({
  text: z.string().min(1).max(4000),
  toLang: z.string().min(2).max(8),
});
router.post('/sessions/:id/reply', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const session = await prisma.translatorSession.findUnique({ where: { id }, select: { id: true } });
    if (!session) return res.status(404).json({ error: 'Rozhovor nenalezen' });

    let translated = null, sourceLang = null;
    try {
      const r = await translateText(parsed.data.text, parsed.data.toLang);
      translated = r.translated; sourceLang = r.sourceLang;
    } catch (e) {
      return res.status(200).json({ translated: null, aiError: humanizeAiError(e) });
    }
    await prisma.translatorLine.create({
      data: {
        session_id: id,
        speaker: 'Já',
        original: parsed.data.text,
        translated,
        source_lang: sourceLang,
      },
    });
    await prisma.translatorSession.update({ where: { id }, data: { lines_count: { increment: 1 } } });
    res.status(201).json({ translated });
  } catch (err) { next(err); }
});

// GET /api/translator/sessions — historie (nejnovější první)
router.get('/sessions', async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
    const sessions = await prisma.translatorSession.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true, title: true, target_lang: true, source_lang: true,
        lines_count: true, created_by_name: true, created_at: true,
      },
    });
    res.json(sessions);
  } catch (err) { next(err); }
});

// GET /api/translator/sessions/:id — detail včetně řádků
router.get('/sessions/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const session = await prisma.translatorSession.findUnique({
      where: { id },
      include: { lines: { orderBy: { created_at: 'asc' } } },
    });
    if (!session) return res.status(404).json({ error: 'Rozhovor nenalezen' });
    res.json(session);
  } catch (err) { next(err); }
});

// DELETE /api/translator/sessions/:id — smaže rozhovor (i řádky přes kaskádu)
router.delete('/sessions/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    await prisma.translatorSession.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
