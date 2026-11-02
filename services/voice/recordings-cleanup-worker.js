// =============================================================================
// HolyOS — Úklid lokálních kopií nahrávek hovorů (data/voice-recordings)
// =============================================================================
// Nahrávky jsou uložené u Twilia; na volume /app/data se drží jen lokální kopie kvůli
// přehrávání s převíjením (ensureLocalRecording v routes/voice-agent.routes.js je při
// přehrání stáhne znovu). Kopie starší než VOICE_RECORDINGS_KEEP_DAYS (výchozí 30 dní,
// podle posledního přístupu/změny souboru) se v noci mažou, ať se volume nezaplní.
// Mažou se jen soubory *.mp3 / *.mp3.part v tomto adresáři — nic jiného.

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'data', 'voice-recordings');
const KEEP_DAYS = Math.max(7, parseInt(process.env.VOICE_RECORDINGS_KEEP_DAYS || '30', 10) || 30);

let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    if (!fs.existsSync(DIR)) return;
    const limit = Date.now() - KEEP_DAYS * 86400000;
    let removed = 0, bytes = 0;
    for (const name of fs.readdirSync(DIR)) {
      if (!/\.mp3(\.part)?$/i.test(name)) continue;
      const f = path.join(DIR, name);
      try {
        const st = fs.statSync(f);
        if (!st.isFile()) continue;
        const last = Math.max(st.mtimeMs, st.atimeMs || 0);
        // .part = nedokončené stažení → pryč už po dni
        if (last < limit || (name.endsWith('.part') && st.mtimeMs < Date.now() - 86400000)) { fs.unlinkSync(f); removed++; bytes += st.size; }
      } catch (_) { /* soubor mezitím zmizel */ }
    }
    if (removed) console.log('[voice-cleanup] smazáno ' + removed + ' lokálních kopií nahrávek (' + Math.round(bytes / 1048576) + ' MB), starší než ' + KEEP_DAYS + ' dní');
  } catch (e) {
    console.warn('[voice-cleanup] tick selhal:', e.message);
  } finally { running = false; }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(tick, 6 * 60 * 60 * 1000); // 4× denně (levné — jen výpis adresáře)
  setTimeout(tick, 5 * 60 * 1000);
  console.log('[voice-cleanup] worker spuštěn (kopie nahrávek starší než ' + KEEP_DAYS + ' dní se mažou)');
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick };
