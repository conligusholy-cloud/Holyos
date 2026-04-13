// =============================================================================
// HolyOS — Voice AI routes (STT + hlasový asistent)
// Kompatibilita s js/ai-assistant.js
// =============================================================================

const express = require('express');
const https = require('https');
const router = express.Router();
const { prisma } = require('../config/database');

// ─── STT CHECK ────────────────────────────────────────────────────────────

// GET /api/ai/stt-check
router.get('/stt-check', (req, res) => {
  const hasWhisper = !!process.env.OPENAI_API_KEY;
  res.json({ whisper: hasWhisper });
});

// ─── WHISPER TRANSCRIPTION ────────────────────────────────────────────────

// POST /api/ai/transcribe
router.post('/transcribe', async (req, res) => {
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    // Sbírání raw body (multipart)
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    await new Promise(resolve => req.on('end', resolve));
    const body = Buffer.concat(chunks);

    // Extrahovat boundary z content-type
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) return res.status(400).json({ error: 'Missing multipart boundary' });
    const boundary = '--' + boundaryMatch[1];

    // Najít audio part
    const bodyStr = body.toString('latin1');
    const parts = bodyStr.split(boundary);
    let audioBuffer = null;
    let fileName = 'voice.webm';
    for (const part of parts) {
      if (part.includes('name="audio"')) {
        const fnMatch = part.match(/filename="([^"]+)"/);
        if (fnMatch) fileName = fnMatch[1];
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const dataStart = headerEnd + 4;
          const dataEnd = part.lastIndexOf('\r\n');
          audioBuffer = Buffer.from(part.substring(dataStart, dataEnd), 'latin1');
        }
      }
    }

    if (!audioBuffer || audioBuffer.length < 1000) {
      return res.json({ text: '' });
    }

    // Zavolat OpenAI Whisper API
    const whisperBoundary = '----WhisperBoundary' + Date.now();
    const fileMime = fileName.includes('mp4') ? 'audio/mp4' : 'audio/webm';
    const formParts = [];
    formParts.push(Buffer.from(
      '--' + whisperBoundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="' + fileName + '"\r\n' +
      'Content-Type: ' + fileMime + '\r\n\r\n', 'utf8'));
    formParts.push(audioBuffer);
    formParts.push(Buffer.from(
      '\r\n--' + whisperBoundary + '\r\n' +
      'Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n', 'utf8'));
    formParts.push(Buffer.from(
      '--' + whisperBoundary + '\r\n' +
      'Content-Disposition: form-data; name="language"\r\n\r\ncs\r\n', 'utf8'));
    formParts.push(Buffer.from('--' + whisperBoundary + '--\r\n', 'utf8'));
    const formBody = Buffer.concat(formParts);

    const whisperResult = await new Promise((resolve, reject) => {
      const whisperReq = https.request({
        hostname: 'api.openai.com', path: '/v1/audio/transcriptions', method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + openaiKey,
          'Content-Type': 'multipart/form-data; boundary=' + whisperBoundary,
          'Content-Length': formBody.length,
        }
      }, (wRes) => {
        let d = '';
        wRes.on('data', c => d += c);
        wRes.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (wRes.statusCode !== 200) reject(new Error(parsed.error?.message || 'Whisper error'));
            else resolve(parsed.text || '');
          } catch(e) { reject(e); }
        });
      });
      whisperReq.on('error', reject);
      whisperReq.setTimeout(15000, () => { whisperReq.destroy(); reject(new Error('Whisper timeout')); });
      whisperReq.write(formBody);
      whisperReq.end();
    });

    res.json({ text: whisperResult });
  } catch (e) {
    console.error('Transcribe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── VOICE AI (Claude) ───────────────────────────────────────────────────

// Shromáždí relevantní kontext z DB na základě dotazu
async function gatherDataContext(message, context) {
  const msg = (message || '').toLowerCase();

  const wantsPeople = /zaměstnan|lidi|lidé|osob|pracovník|kolega|tým|hr|člověk|kdo |jméno|telefon|email|kontakt/.test(msg);
  const wantsCompanies = /společnost|firma|firmy|dodavatel|odběratel|partner/.test(msg);
  const wantsOrders = /objednáv|nákup|nakup|faktur|dodávk/.test(msg);
  const wantsMaterials = /zboží|zbozi|materiál|material|produkt|polož|sklad|záso|stock|minimum|pod minim|výrob/.test(msg);
  const wantsAttendance = /docházk|dochazk|příchod|odchod|přítom/.test(msg);
  const wantsLeaves = /volno|dovolená|nemoc|absenc/.test(msg);
  const wantsOverview = /kolik|přehled|souhrn|celk|systém|všech|stav |statistik|report/.test(msg);

  // Základní počty (vždy)
  const [peopleCount, companiesCount, matsCount, ordersCount] = await Promise.all([
    prisma.person.count({ where: { active: true } }),
    prisma.company.count({ where: { active: true } }),
    prisma.material.count({ where: { status: 'active' } }),
    prisma.order.count(),
  ]);

  const ctx = {
    prehled: { lide: peopleCount, spolecnosti: companiesCount, zbozi: matsCount, objednavky: ordersCount },
  };

  if (wantsPeople || wantsOverview) {
    ctx.lide = await prisma.person.findMany({
      where: { active: true },
      select: {
        id: true, first_name: true, last_name: true, email: true, phone: true,
        employee_number: true, type: true,
        department: { select: { name: true } },
        role: { select: { name: true } },
      },
      take: 50,
    });
  }

  if (wantsCompanies || wantsOverview) {
    ctx.spolecnosti = await prisma.company.findMany({
      where: { active: true },
      select: { id: true, name: true, ico: true, type: true, email: true, phone: true },
      take: 30,
    });
  }

  if (wantsOrders) {
    ctx.objednavky = await prisma.order.findMany({
      take: 20,
      orderBy: { created_at: 'desc' },
      include: {
        company: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });
  }

  if (wantsMaterials || wantsOverview) {
    const lowStock = await prisma.$queryRaw`
      SELECT id, code, name, current_stock, min_stock, unit
      FROM materials
      WHERE status = 'active' AND min_stock IS NOT NULL AND current_stock <= min_stock
      LIMIT 20
    `;
    ctx.zbozi_pod_minimem = lowStock;
  }

  if (wantsAttendance) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    ctx.dochazka_dnes = await prisma.attendance.findMany({
      where: { date: today },
      include: { person: { select: { first_name: true, last_name: true } } },
    });
  }

  if (wantsLeaves) {
    ctx.zadosti_o_volno = await prisma.leaveRequest.findMany({
      where: { status: 'pending' },
      include: { person: { select: { first_name: true, last_name: true } } },
      take: 10,
    });
  }

  return JSON.stringify(ctx, null, 0);
}

// POST /api/ai/voice
router.post('/voice', async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

    const dataContext = await gatherDataContext(message, context);

    const systemPrompt = `Jsi AI asistent HOLYOS (řízení výroby, Best Series). Mluv česky, stručně, bez markdownu — odpovědi se čtou nahlas.
Pravidla: Odpovídej POUZE z dat v kontextu. Nemáš-li data, řekni to. Čísla uváděj přesně. Pokud uživatel chce navigovat, řekni kam jdeš.
Moduly: Lidé a HR, Nákup a sklad (zboží, objednávky, sklady), Pracovní postup, Programování výroby.
Uživatel je v: "${context || 'hlavní stránka'}"`;

    const userPrompt = `DATA:\n${dataContext}\n\nDOTAZ: ${message}`;

    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const aiResult = await new Promise((resolve, reject) => {
      const aiReq = https.request({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-api-key': apiKey,
          'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(requestBody),
        }
      }, (aiRes) => {
        let d = '';
        aiRes.on('data', chunk => d += chunk);
        aiRes.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (aiRes.statusCode !== 200) {
              reject(new Error(parsed.error?.message || 'API error ' + aiRes.statusCode));
              return;
            }
            resolve(parsed.content?.[0]?.text || 'Omlouvám se, nedokázal jsem zpracovat odpověď.');
          } catch (e) { reject(new Error('Parse error: ' + e.message)); }
        });
      });
      aiReq.on('error', reject);
      aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error('Timeout')); });
      aiReq.write(requestBody);
      aiReq.end();
    });

    res.json({ ok: true, response: aiResult });
  } catch (e) {
    console.error('AI voice error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
