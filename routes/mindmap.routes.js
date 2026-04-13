// =============================================================================
// HolyOS — Mindmap routes (myšlenková mapa, verze, AI apply)
// Kompatibilní s file-based storage ze server.js
// =============================================================================

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ─── File-based storage ───────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '..', 'data');
const MINDMAP_FILE = path.join(DATA_DIR, 'mindmap-notes.json');
const MINDMAP_VERSIONS_FILE = path.join(DATA_DIR, 'mindmap-versions.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadMindmapData() {
  try { return JSON.parse(fs.readFileSync(MINDMAP_FILE, 'utf-8')); }
  catch (e) { return { notes: {}, featuresOverride: {}, descOverride: {}, connectionsOverride: {}, reviewed: {}, customModules: [], hiddenModules: [] }; }
}

function saveMindmapData(data) {
  ensureDataDir();
  fs.writeFileSync(MINDMAP_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function loadVersions() {
  try { return JSON.parse(fs.readFileSync(MINDMAP_VERSIONS_FILE, 'utf-8')); }
  catch (e) { return []; }
}

function saveVersion(description, snapshot) {
  const versions = loadVersions();
  versions.push({
    id: versions.length + 1,
    date: new Date().toISOString(),
    description,
    snapshot,
  });
  while (versions.length > 50) versions.shift();
  ensureDataDir();
  fs.writeFileSync(MINDMAP_VERSIONS_FILE, JSON.stringify(versions, null, 2), 'utf-8');
  return versions[versions.length - 1];
}

// ─── NOTES (hlavní data) ──────────────────────────────────────────────────

// GET /api/mindmap/notes
router.get('/notes', (req, res) => {
  res.json(loadMindmapData());
});

// POST /api/mindmap/notes
router.post('/notes', (req, res) => {
  try {
    const current = loadMindmapData();
    current.notes = req.body.notes || current.notes;
    saveMindmapData(current);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── COMMIT (uložení AI změn + verze) ─────────────────────────────────────

// POST /api/mindmap/commit
router.post('/commit', (req, res) => {
  try {
    const { moduleId, features, desc, connections, changes } = req.body;
    if (!moduleId || !features) return res.status(400).json({ error: 'moduleId and features required' });

    const currentData = loadMindmapData();
    saveVersion('Před změnou: ' + (changes || moduleId), JSON.parse(JSON.stringify(currentData)));

    if (!currentData.featuresOverride) currentData.featuresOverride = {};
    if (!currentData.descOverride) currentData.descOverride = {};
    if (!currentData.connectionsOverride) currentData.connectionsOverride = {};

    currentData.featuresOverride[moduleId] = features;
    if (desc) currentData.descOverride[moduleId] = desc;
    if (connections) currentData.connectionsOverride[moduleId] = connections;

    if (currentData.notes && currentData.notes[moduleId]) {
      currentData.notes[moduleId] = '';
    }
    if (currentData.applied) delete currentData.applied[moduleId];

    saveMindmapData(currentData);
    const ver = saveVersion('AI: ' + (changes || 'Struktura aktualizována — ' + moduleId), JSON.parse(JSON.stringify(currentData)));

    res.json({ ok: true, version: ver.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REVIEWED (zamknutí features) ─────────────────────────────────────────

// POST /api/mindmap/reviewed
router.post('/reviewed', (req, res) => {
  try {
    const { moduleId, featureIndex, value } = req.body;
    if (!moduleId || featureIndex === undefined) return res.status(400).json({ error: 'moduleId and featureIndex required' });

    const current = loadMindmapData();
    if (!current.reviewed) current.reviewed = {};
    if (!current.reviewed[moduleId]) current.reviewed[moduleId] = {};
    current.reviewed[moduleId][String(featureIndex)] = !!value;
    saveMindmapData(current);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CUSTOM MODULES ──────────────────────────────────────────────────────

// GET /api/mindmap/modules
router.get('/modules', (req, res) => {
  const current = loadMindmapData();
  res.json(current.customModules || []);
});

// POST /api/mindmap/modules
router.post('/modules', (req, res) => {
  try {
    const { id, icon, label, color, phase, desc, features, connections } = req.body;
    if (!id || !label) return res.status(400).json({ error: 'id and label required' });

    const current = loadMindmapData();
    if (!current.customModules) current.customModules = [];
    const mod = { id, icon: icon || '📦', label, color: color || '#6c5ce7', phase: phase || 3, desc: desc || '', features: features || [], connections: connections || [] };
    const existing = current.customModules.findIndex(m => m.id === id);
    if (existing >= 0) current.customModules[existing] = mod;
    else current.customModules.push(mod);
    saveMindmapData(current);
    res.json({ ok: true, module: mod });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mindmap/modules/toggle-visibility (musí být PŘED /:moduleId)
router.post('/modules/toggle-visibility', (req, res) => {
  try {
    const { moduleId, hidden } = req.body;
    if (!moduleId) return res.status(400).json({ error: 'moduleId required' });

    const current = loadMindmapData();
    if (!current.hiddenModules) current.hiddenModules = [];
    if (hidden) {
      if (!current.hiddenModules.includes(moduleId)) current.hiddenModules.push(moduleId);
    } else {
      current.hiddenModules = current.hiddenModules.filter(id => id !== moduleId);
    }
    saveMindmapData(current);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/mindmap/modules/:moduleId
router.delete('/modules/:moduleId', (req, res) => {
  try {
    const modId = req.params.moduleId;
    const current = loadMindmapData();
    if (!current.customModules) current.customModules = [];
    const idx = current.customModules.findIndex(m => m.id === modId);
    if (idx < 0) return res.status(404).json({ error: 'Custom module not found' });
    current.customModules.splice(idx, 1);
    if (!current.hiddenModules) current.hiddenModules = [];
    saveMindmapData(current);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── VERSIONS ────────────────────────────────────────────────────────────

// GET /api/mindmap/versions
router.get('/versions', (req, res) => {
  res.json(loadVersions().map(v => ({ id: v.id, date: v.date, description: v.description })));
});

// POST /api/mindmap/versions/:id/restore
router.post('/versions/:id/restore', (req, res) => {
  try {
    const versionId = parseInt(req.params.id);
    const versions = loadVersions();
    const version = versions.find(v => v.id === versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const currentData = loadMindmapData();
    saveVersion('Před obnovením verze #' + versionId, JSON.parse(JSON.stringify(currentData)));
    saveMindmapData(version.snapshot);
    res.json({ ok: true, restored: versionId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI APPLY ────────────────────────────────────────────────────────────

// POST /api/mindmap/ai-apply
router.post('/ai-apply', async (req, res) => {
  try {
    const { moduleData, notes, lockedFeatures } = req.body;
    if (!moduleData || !notes) return res.status(400).json({ error: 'Missing moduleData or notes' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

    const prompt = `Jsi expert na strukturování myšlenkových map pro firemní systém HOLYOS.

Dostáváš modul myšlenkové mapy a poznámky uživatele. Tvým úkolem je INTELIGENTNĚ zapracovat poznámky do struktury modulu.

## Aktuální modul:
- ID: ${moduleData.id}
- Název: ${moduleData.label}
- Popis: ${moduleData.desc}
- Aktuální features: ${JSON.stringify(moduleData.features, null, 2)}
- Connections: ${JSON.stringify(moduleData.connections || [])}

## Poznámky uživatele k zapracování:
${notes}

## ZAMČENÉ FEATURES (NESMÍŠ MĚNIT):
${lockedFeatures && lockedFeatures.length > 0 ? lockedFeatures.map(f => '- ' + f).join('\n') : '(žádné)'}
Zamčené features musíš zachovat PŘESNĚ tak jak jsou — nesmíš je přejmenovávat, mazat, slučovat ani měnit jejich sub-items!

## Instrukce:
1. Analyzuj poznámky a porozuměj záměru uživatele
2. Restrukturalizuj features modulu tak, aby odrážely požadavky z poznámek
3. Pokud uživatel chce rozdělit něco na části, vytvoř hierarchickou strukturu (features mohou být stringy nebo objekty {text, sub: [...]})
4. Pokud poznámka zmiňuje propojení s jiným modulem, přidej do connections
5. Pokud poznámka mění popis modulu, uprav desc
6. Zachovej existující features které nejsou v rozporu s poznámkami
7. DŮLEŽITÉ: Zamčené features MUSÍŠ zachovat beze změny ve výstupu!
8. Features mohou být:
   - Prostý string: "Evidence zaměstnanců"
   - Objekt s podkategoriemi: {"text": "Evidence lidí", "sub": ["Lidé obecně — kontakty, dodavatelé, zákazníci", "Zaměstnanci — smlouvy, docházka, mzdy"]}

Vrať POUZE validní JSON objekt (bez markdown, bez komentářů) s touto strukturou:
{
  "features": [...],
  "connections": [...],
  "desc": "...",
  "changes": "Stručný popis provedených změn v češtině (1-2 věty)"
}`;

    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const aiResult = await new Promise((resolve, reject) => {
      const aiReq = https.request({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-api-key': apiKey,
          'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(requestBody),
        }
      }, (aiRes) => {
        let data = '';
        aiRes.on('data', chunk => data += chunk);
        aiRes.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (aiRes.statusCode !== 200) {
              reject(new Error(parsed.error?.message || `API error ${aiRes.statusCode}`));
              return;
            }
            const text = parsed.content?.[0]?.text || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) { reject(new Error('AI response did not contain valid JSON')); return; }
            resolve(JSON.parse(jsonMatch[0]));
          } catch (e) { reject(new Error('Failed to parse AI response: ' + e.message)); }
        });
      });
      aiReq.on('error', reject);
      aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error('AI request timeout')); });
      aiReq.write(requestBody);
      aiReq.end();
    });

    res.json({ ok: true, result: aiResult });
  } catch (e) {
    console.error('AI apply error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
