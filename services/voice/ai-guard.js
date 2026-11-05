// HolyOS — hlídač AI hlasových linek (Infolinka, osobní asistenti, kampaně).
// Cíl: aby se volající už nikdy nedostal do smyčky „Omlouvám se, můžete to zopakovat?".
//  1) Upozornění: když AI během hovoru selže, Tomáš a Jan dostanou push do Velína + zvonek
//     (s důvodem: kredit / klíč / přetížení / chyba dat). Max 1× za 30 min pro stejný druh chyby.
//  2) Hlídací pes: co 15 min krátký test Claude API; když neodpovídá, upozorní dřív, než zavolá zákazník.
//  3) classify(): srozumitelný důvod chyby (do logu, do shrnutí hovoru i do upozornění).
'use strict';

const last = new Map(); // druh chyby → čas posledního upozornění
let watchdogStarted = false;
let lastWatchdogOk = true;

function classify(e) {
  const msg = String((e && e.message) || e || '');
  const st = Number((e && (e.status || (e.error && e.error.status))) || 0);
  if (/credit balance|insufficient|billing/i.test(msg)) return { kind: 'credit', text: 'Došel kredit na Anthropic API (Console → Plans & Billing).' };
  if (st === 401 || /invalid x-api-key|authentication/i.test(msg)) return { kind: 'auth', text: 'Neplatný nebo chybějící ANTHROPIC_API_KEY.' };
  if (st === 404 || /model.*not.*found|not_found_error/i.test(msg)) return { kind: 'model', text: 'Model AI neexistuje / byl vyřazen (VOICE_MODEL).' };
  if (st === 429 || /rate.?limit/i.test(msg)) return { kind: 'rate', text: 'Překročený limit požadavků na Anthropic API.' };
  if (st === 529 || st >= 500 || /overloaded|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)) return { kind: 'overload', text: 'Anthropic API je přetížené nebo nedostupné.' };
  if (st === 400) return { kind: 'request', text: 'AI odmítla data hovoru (400): ' + msg.slice(0, 160) };
  return { kind: 'other', text: msg.slice(0, 200) || 'Neznámá chyba AI.' };
}

async function alert(kind, title, body) {
  const now = Date.now();
  if (now - (last.get(kind) || 0) < 30 * 60e3) return; // nespamovat
  last.set(kind, now);
  try {
    const { prisma } = require('../../config/database');
    const { notifyPerson } = require('../push/expo-push');
    let createNotification = null; try { ({ createNotification } = require('../../routes/notifications.routes')); } catch (_) { /* bez zvonku */ }
    const ps = await prisma.person.findMany({ where: { active: true, last_name: { equals: 'Holý', mode: 'insensitive' }, first_name: { in: ['Jan', 'Tomáš'], mode: 'insensitive' } }, select: { id: true, user_id: true } });
    for (const p of ps) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'voice_ai_error', kind }, sound: 'default' }).catch(() => {});
      if (p.user_id && createNotification) createNotification({ userId: p.user_id, type: 'system', title, body, meta: { kind: 'voice_ai_error', error: kind } }).catch(() => {});
    }
    console.warn('[voice-guard] upozornění odesláno:', title, '—', body);
  } catch (e) { console.warn('[voice-guard] upozornění se nepodařilo:', e.message); }
}

// Selhání AI během hovoru (volá relay-ws)
function callFailed(e, ctx) {
  const c = classify(e);
  const where = ctx && ctx.line ? ('linka ' + ctx.line) : 'hlasová linka';
  alert('call:' + c.kind, '⚠️ Infolinka: AI neodpovídá', where + (ctx && ctx.from ? ' · volá ' + ctx.from : '') + ' — ' + c.text);
  return c;
}

// Hlídací pes: krátký test API co 15 min (jen na serveru s klíčem)
function startWatchdog() {
  if (watchdogStarted || !process.env.ANTHROPIC_API_KEY || process.env.VOICE_WATCHDOG === '0') return;
  if (!process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production') return; // lokálně ne
  watchdogStarted = true;
  const run = async () => {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const model = process.env.VOICE_MODEL || 'claude-haiku-4-5-20251001';
      await client.messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
      if (!lastWatchdogOk) { console.log('[voice-guard] AI zase odpovídá.'); last.delete('watchdog'); }
      lastWatchdogOk = true;
    } catch (e) {
      lastWatchdogOk = false;
      const c = classify(e);
      console.warn('[voice-guard] test AI selhal:', c.kind, e.message);
      if (c.kind !== 'rate') alert('watchdog', '⚠️ Infolinka nebude fungovat', 'Test AI selhal — ' + c.text + ' Volající by slyšeli jen omluvu.');
    }
  };
  setTimeout(run, 60e3).unref();
  setInterval(run, 15 * 60e3).unref();
}

module.exports = { classify, alert, callFailed, startWatchdog };
