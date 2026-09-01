// =============================================================================
// HolyOS — Voice: WebSocket handler pro Twilio ConversationRelay
// =============================================================================
// Navěsí se na existující HTTP server v app.js:
//   const server = http.createServer(app);
//   require('./services/voice/relay-ws').attach(server);
//
// ConversationRelay posílá přes WS zprávy typu:
//   setup     — metadata hovoru (callSid, from, to)
//   prompt    — přepsaná řeč volajícího (voicePrompt)
//   interrupt — volající skočil do řeči
//   dtmf/error
// Zpět posíláme:
//   { type: 'text', token: '<co říct>', last: true }
//
// POZOR: perzistence do prisma.voiceCall je best-effort — model existuje až
// po migraci (Fáze 1, úkol „Prisma model VoiceCall + migrace"). Do té doby se
// hovor jen zaloguje. Tento soubor se NIKDE neimportuje, dokud se nenapojí v app.js.

const { WebSocketServer } = require('ws');
const { prisma } = require('../../config/database');
const agent = require('./agent');

const WS_PATH = process.env.VOICE_RELAY_WS_PATH || '/api/voice/relay';
// Sdílené tajemství proti zneužití otevřeného WS (jinak by kdokoli mohl pálit
// Claude tokeny). TwiML v routeru přidává ?key=<secret> do WS url.
const RELAY_SECRET = process.env.VOICE_RELAY_SECRET || '';

// Aktivní hovory v paměti (callSid → stav). Pro produkci s více instancemi
// by stav patřil do sdíleného úložiště; pro 1 instanci na Railway stačí Map.
const calls = new Map();

function personalSystem(ownerName) {
  return (
    'Jsi telefonní asistentka. ' +
    (ownerName ? `Zastupuješ: ${ownerName}. ` : '') +
    'Mluvíš česky, stručně a mile. Tvým úkolem je zjistit, KDO volá a CO potřebuje. ' +
    'Kladeš jednu krátkou otázku po druhé. Až máš jméno i důvod hovoru, poděkuj, ' +
    'potvrď že předáš vzkaz, a rozluč se. Nevymýšlej si informace.'
  );
}

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (_) {
    /* socket už zavřený */
  }
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: WS_PATH });

  wss.on('connection', (ws, req) => {
    // Ověření sdíleného tajemství z query (?key=...). Když je secret nastavený
    // a nesedí, spojení hned zavřeme.
    if (RELAY_SECRET) {
      let key = null;
      try {
        key = new URL(req.url, 'http://localhost').searchParams.get('key');
      } catch (_) {
        key = null;
      }
      if (key !== RELAY_SECRET) {
        try {
          ws.close(1008, 'unauthorized');
        } catch (_) {
          /* noop */
        }
        return;
      }
    }

    const state = {
      callSid: null,
      from: null,
      to: null,
      transcript: [],
      history: [],
      startedAt: new Date(),
    };

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'setup') {
        state.callSid = msg.callSid || msg.callSID || null;
        state.from = msg.from || null;
        state.to = msg.to || null;
        if (state.callSid) calls.set(state.callSid, state);
        send(ws, {
          type: 'text',
          token:
            'Dobrý den, dovolali jste se na asistenta. Hovor obsluhuje AI a je nahráván. Jak vám můžu pomoct?',
          last: true,
        });
        return;
      }

      if (msg.type === 'prompt') {
        const userText = (msg.voicePrompt || '').trim();
        if (!userText) return;
        state.transcript.push({ role: 'caller', text: userText, ts: Date.now() });
        try {
          const { text, messages } = await agent.runTurn({
            system: personalSystem(null),
            history: state.history,
            userText,
            toolset: null, // MVP osobní recepční — bez firemních dat
            maxTokens: 300,
          });
          state.history = messages;
          state.transcript.push({ role: 'agent', text, ts: Date.now() });
          send(ws, { type: 'text', token: text, last: true });
        } catch (e) {
          console.warn('[voice] runTurn selhal:', e.message);
          send(ws, {
            type: 'text',
            token: 'Omlouvám se, teď se mi to nepodařilo. Zkuste to prosím ještě jednou.',
            last: true,
          });
        }
        return;
      }

      // interrupt / dtmf / error — pro MVP neřešíme
    });

    ws.on('close', async () => {
      if (!state.callSid) return;
      const endedAt = new Date();
      const durationSec = Math.max(0, Math.round((endedAt - state.startedAt) / 1000));

      // Shrnutí (jen když volající aspoň něco řekl)
      let summary = null;
      let callerName = null;
      let callerIntent = null;
      try {
        if (state.transcript.some((t) => t.role === 'caller')) {
          const s = await agent.summarizeStructured(state.transcript);
          summary = s.summary || null;
          callerName = s.caller_name || null;
          callerIntent = s.caller_intent || null;
        }
      } catch (e) {
        console.warn('[voice] shrnutí selhalo:', e.message);
      }

      // Uložit záznam hovoru
      let saved = null;
      try {
        if (prisma.voiceCall) {
          saved = await prisma.voiceCall.create({
            data: {
              direction: 'inbound',
              agent_kind: 'personal',
              from_number: state.from || '',
              to_number: state.to || '',
              twilio_call_sid: state.callSid,
              started_at: state.startedAt,
              ended_at: endedAt,
              duration_sec: durationSec,
              transcript: state.transcript,
              summary,
              caller_name: callerName,
              caller_intent: callerIntent,
            },
          });
        } else {
          console.log('[voice] hovor', state.callSid, '— model VoiceCall zatím není (čeká migrace)');
        }
      } catch (e) {
        console.warn('[voice] uložení hovoru selhalo:', e.message);
      }

      // Push do Velína (kdo volal + co chtěl)
      try {
        const notify = require('./notify');
        await notify.notifyCall({
          toNumber: state.to,
          fromNumber: state.from,
          callerName,
          callerIntent,
          summary,
          callId: saved && saved.id,
        });
      } catch (e) {
        console.warn('[voice] notifikace selhala:', e.message);
      }

      calls.delete(state.callSid);
    });
  });

  console.log('  Voice WS: ' + WS_PATH);
  return wss;
}

module.exports = { attach, WS_PATH, calls };
