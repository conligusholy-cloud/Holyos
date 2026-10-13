// HolyOS — Šablony dokumentů: katalog a náhledy (ukázková data, stejné šablony jako u skutečných dokladů).
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { CATALOG, renderPreview } = require('../services/pdf/doc-previews');

router.use(requireAuth);

// GET /api/doc-templates — seznam šablon
router.get('/', (req, res) => {
  res.json(CATALOG);
});

// GET /api/doc-templates/:key/preview — HTML náhled s ukázkovými daty
router.get('/:key/preview', async (req, res, next) => {
  try {
    if (!CATALOG.some(c => c.key === req.params.key)) return res.status(404).json({ error: 'Šablona nenalezena' });
    const q = req.query || {};
    const html = await renderPreview(req.params.key, { lang: q.lang, vat: q.vat, cur: q.cur, note: q.note !== undefined ? String(q.note).slice(0, 600) : undefined });
    if (!html) return res.status(404).json({ error: 'Šablona nenalezena' });
    res.type('html').send(html);
  } catch (err) { next(err); }
});

module.exports = router;
