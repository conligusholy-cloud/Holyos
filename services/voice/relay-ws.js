// =============================================================================
// HolyOS — Voice: WebSocket handler pro Twilio ConversationRelay
// =============================================================================
// Navěsí se na HTTP server v app.js:
//   const server = http.createServer(app);
//   require('./services/voice/relay-ws').attach(server);
//
// Podporuje dva režimy (podle query ?target=... v WS url):
//   - inbound  (recepční): volající se dovolá, AI se ptá kdo volá a co chce
//   - outbound (kampaň):   AI volá leadovi a vede rozhovor podle scénáře kampaně
//
// ConversationRelay zprávy: setup / prompt / interrupt. Zpět: { type:'text', token, last }.

const { WebSocketServer } = require('ws');
const { prisma } = require('../../config/database');
const agent = require('./agent');

let getSetting = null;
try {
  ({ getSetting } = require('../settings'));
} catch (_) {
  getSetting = null;
}

const WS_PATH = process.env.VOICE_RELAY_WS_PATH || '/api/voice/relay';
const RELAY_SECRET = process.env.VOICE_RELAY_SECRET || '';

const calls = new Map();

function personalSystem() {
  return (
    'Jsi telefonní asistentka firmy Best Series. Mluvíš česky, stručně a mile. ' +
    'Tvým úkolem je zjistit, KDO volá a CO potřebuje. Kladeš jednu krátkou otázku po druhé. ' +
    'Až máš jméno i důvod hovoru, poděkuj, potvrď že předáš vzkaz, a rozluč se. Nevymýšlej si informace. ' +
    'Pokud volající chce mluvit s živým člověkem, kolegou nebo obchodníkem, neodmítej ho — řekni, že ho přepojíš, a systém přepojení zajistí.'
  );
}

function outboundSystem(script) {
  return (
    'Jsi telefonní obchodní asistent/ka firmy Best Series. VOLÁŠ zákazníkovi. ' +
    'Mluvíš česky, mile a stručně, kladeš jednu otázku po druhé a nasloucháš. ' +
    (script
      ? 'Scénář hovoru, kterým se řiď: ' + script
      : 'Představ se za Best Series, zjisti zájem o prádlomaty a pokus se domluvit další krok (schůzku nebo zaslání informací).') +
    ' Buď přirozený/á, respektuj když člověk nemá zájem, na konci poděkuj a rozluč se.' +
    ' Pokud zákazník chce mluvit s živým člověkem nebo obchodníkem, neodmítej ho — řekni, že ho přepojíš, a systém přepojení zajistí.'
  );
}

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (_) {
    /* socket zavřený */
  }
}

// Terminální / uzavřené stavy, které automatika z hovoru NEPŘEPISUJE.
const TERMINAL_KEEP = new Set(['converted', 'smlouva_odeslat', 'smlouva_odeslana', 'nelze_pouzit']);

function appendLog(existing, note) {
  const stamp = new Date().toLocaleString('cs-CZ');
  return (existing ? (existing + '\n') : '') + '[' + stamp + '] ' + note;
}

// Zpracuje záměry z hovoru u Compounder leadu (spárovaného podle telefonu):
//  - nemá zájem  → stav „Nemá zájem"
//  - schůzka     → stav „Domluvena schůzka" + událost do kalendáře obchodníka
//  - zavolat jindy → stav „Volat příště" + událost (hovor) do kalendáře obchodníka
async function applyVoiceIntents(phone, s, summary) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 6 || !s) return;
  const tail = digits.slice(-9);
  const leads = await prisma.compounderLead.findMany({
    where: { phone: { contains: tail } },
    select: { id: true, phone: true, status: true, activity_log: true, name: true, owner_person_id: true },
    take: 5,
    orderBy: { updated_at: 'desc' },
  });
  const lead = leads.find((l) => String(l.phone || '').replace(/\D/g, '').slice(-9) === tail);
  if (!lead) return;
  if (TERMINAL_KEEP.has(lead.status)) return; // neklobrč uzavřený obchod

  const sumTxt = summary ? String(summary).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const who = lead.name || phone;

  // 1) Nezájem má přednost
  if (s.no_interest) {
    await prisma.compounderLead.update({
      where: { id: lead.id },
      data: { status: 'nezajem', activity_log: appendLog(lead.activity_log, 'AI hovor: zákazník nemá zájem / nepřeje si kontakt → „Nemá zájem". ' + sumTxt) },
    });
    return;
  }

  let salesEvents = null;
  try { salesEvents = require('../sales/events'); } catch (_) { salesEvents = null; }
  let notify = null;
  try { notify = require('../compounder/notify'); } catch (_) { notify = null; }

  // 2) Schůzka
  if (s.meeting) {
    const at = validDate(s.meeting_at) || nextDay(10);
    const desc = 'Automaticky z AI hovoru.' + (s.when_text ? (' Domluveno: ' + s.when_text + '.') : '') + (sumTxt ? (' ' + sumTxt) : '');
    if (salesEvents) {
      await salesEvents.createLeadCalendarEvent({
        leadId: lead.id, organizerId: lead.owner_person_id || null,
        title: '🤝 Schůzka (AI): ' + who, description: desc,
        startAt: at, endAt: new Date(at.getTime() + 60 * 60000), eventType: 'meeting',
      });
    }
    await prisma.compounderLead.update({
      where: { id: lead.id },
      data: { status: 'schuzka', activity_log: appendLog(lead.activity_log, 'AI hovor: domluvena schůzka' + (s.when_text ? (' (' + s.when_text + ')') : '') + '. ' + sumTxt) },
    });
    if (notify && notify.notifyMeetingRequest) {
      notify.notifyMeetingRequest(prisma, { lead: { id: lead.id, name: lead.name, phone }, terms: s.when_text || (s.meeting_at || ''), note: 'Z AI hovoru.' }).catch(() => {});
    }
    return;
  }

  // 3) Zavolat jindy
  if (s.callback) {
    const at = validDate(s.callback_at) || nextDay(9);
    const desc = 'Automaticky z AI hovoru — zákazník chce zavolat jindy.' + (s.when_text ? (' Domluveno: ' + s.when_text + '.') : '') + (sumTxt ? (' ' + sumTxt) : '');
    if (salesEvents) {
      await salesEvents.createLeadCalendarEvent({
        leadId: lead.id, organizerId: lead.owner_person_id || null,
        title: '📞 Domluvený hovor (AI): ' + who, description: desc,
        startAt: at, endAt: new Date(at.getTime() + 15 * 60000), eventType: 'call',
      });
    }
    await prisma.compounderLead.update({
      where: { id: lead.id },
      data: { status: 'volat_pristi', activity_log: appendLog(lead.activity_log, 'AI hovor: zavolat jindy' + (s.when_text ? (' (' + s.when_text + ')') : '') + '. ' + sumTxt) },
    });
    if (notify && notify.notifyCallbackRequest) {
      notify.notifyCallbackRequest(prisma, { lead: { id: lead.id, name: lead.name, phone }, when: s.when_text || (s.callback_at || ''), note: 'Z AI hovoru.' }).catch(() => {});
    }
    return;
  }
}

// Bezpečně převede ISO řetězec na Date (nebo null).
function validDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
// Fallback: zítra v danou hodinu (přibližně, když AI neurčila přesný čas).
function nextDay(hour) {
  const d = new Date(Date.now() + 24 * 3600000);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// Rozpozná, že volající chce mluvit s živým člověkem (aby ho AI přepojila).
// Bez diakritiky, malá písmena. Volíme spíš konzervativně, ať to nemíří omylem.
function wantsHuman(text) {
  const t = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (!t) return false;
  // "s clovekem", "na cloveka", "ziveho cloveka", "s nekym zivym", "realnou osobou"
  if (/(s |se |na |za )?(zive?ho|zivou|realn\w*|skutecn\w*)?\s*(clovek\w*|osob\w*)/.test(t) &&
      /(chci|chtel|chtela|muzu|mohu|potrebuj\w*|dejte|prepoj\w*|spoj\w*|mluvit|mluvil|volat|zavolej\w*|preda\w*)/.test(t)) return true;
  // přímé fráze / žádost o operátora / obchodníka
  if (/(prepoj\w*|spoj\w*|preda\w*)\s+(me|mne|nas)?\s*(na|k)?\s*(operator\w*|obchodnik\w*|kolegu|clovek\w*|zive\w*)/.test(t)) return true;
  if (/\boperator\w*/.test(t) && /(chci|prepoj\w*|spoj\w*|mluvit|s )/.test(t)) return true;
  // odmítnutí robota/AI
  if (/(nechci|nebudu|nemluvim)\s+(s )?(robot\w*|ai|umel\w*|automat\w*)/.test(t)) return true;
  if (/(jsi| jste|to je)\s+(robot|ai|umela|automat)/.test(t) && /(chci|prepoj|clovek|zive)/.test(t)) return true;
  return false;
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: WS_PATH });

  wss.on('connection', async (ws, req) => {
    let q = {};
    try {
      q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    } catch (_) {
      q = {};
    }
    if (RELAY_SECRET && q.key !== RELAY_SECRET) {
      try {
        ws.close(1008, 'unauthorized');
      } catch (_) {
        /* noop */
      }
      return;
    }

    // KEEPALIVE: při tichu v hovoru neteče přes WS žádný provoz a proxy (Railway)
    // nečinné spojení po ~minutě zavře → hovor spadne. Posíláme proto ping frame
    // každých 20 s, aby spojení zůstalo živé po celou dobu hovoru.
    const pingTimer = setInterval(() => {
      try { if (ws.readyState === ws.OPEN) ws.ping(); } catch (_) { /* noop */ }
    }, 20000);
    // Bez listeneru na 'error' vyhodí Node u WS chyby výjimku (a shodí spojení/proces).
    ws.on('error', (e) => { console.warn('[voice] WS error:', (e && e.message) || e); });

    const targetId = q.target || null;
    const mode = targetId ? 'outbound' : 'inbound';
    // Úvod řekne Twilio přes welcomeGreeting (neinteruptovatelně) → WS ho sám neposílá.
    const welcomeByTwilio = q.wg === '1';

    const state = {
      callSid: null,
      from: null,
      to: null,
      transcript: [],
      history: [],
      welcomeByTwilio,
      startedAt: new Date(),
      mode,
      handedOff: false,
      targetId,
      target: null,
      campaign: null,
      system: mode === 'outbound' ? outboundSystem(null) : personalSystem(),
      greeting:
        'Dobrý den, dovolali jste se na asistenta. Hovor obsluhuje AI a je nahráván. Jak vám můžu pomoct?',
    };

    // Outbound: načti cíl + kampaň a nastav scénář
    if (mode === 'outbound' && targetId) {
      try {
        const t = await prisma.voiceCampaignTarget.findUnique({
          where: { id: targetId },
          include: { campaign: true },
        });
        if (t) {
          state.target = t;
          state.campaign = t.campaign;
          state.system = outboundSystem(t.campaign && t.campaign.script);
        }
      } catch (e) {
        console.warn('[voice] outbound target load selhal:', e.message);
      }
    }

    // Inbound: scénář + úvodní věta z nastavení, jinak default
    if (mode === 'inbound' && getSetting) {
      try {
        const p = await getSetting('voice.inbound_prompt');
        if (p && String(p).trim()) state.system = String(p);
        const g = await getSetting('voice.inbound_greeting');
        if (g && String(g).trim()) state.greeting = String(g);
      } catch (_) {
        /* default */
      }
    }

    // Sjednocení s AI specialistou: doplň pojistky proti vymýšlení + přesnou matematiku
    // + ZÁVAZNÉ firemní podklady (stejná znalostní báze) + mluvený styl. Neblokuje hovor.
    try {
      const aic = require('../compounder/ai-context');
      const scope = (mode === 'outbound')
        ? (state.campaign && state.campaign.id ? ('outbound:' + state.campaign.id) : 'outbound')
        : 'inbound';
      state.system = await aic.augmentSystem(state.system, { voice: true, scope });
      // Rod komunikace podle jména leada (muž/žena) — u odchozích hovorů známe cíl.
      if (mode === 'outbound' && state.target) {
        let first = null, last = null, full = state.target.name || null;
        try {
          const tail = String(state.target.phone || '').replace(/\D/g, '').slice(-9);
          if (tail.length >= 6) {
            const leads = await prisma.compounderLead.findMany({
              where: { phone: { contains: tail } },
              select: { phone: true, first_name: true, last_name: true, name: true },
              take: 5, orderBy: { updated_at: 'desc' },
            });
            const lead = leads.find((l) => String(l.phone || '').replace(/\D/g, '').slice(-9) === tail);
            if (lead) { first = lead.first_name; last = lead.last_name; full = lead.name || full; }
          }
        } catch (_) { /* fallback na jméno z cíle */ }
        const g = aic.detectGenderCz(first, last, full);
        if (g) state.system += '\n\n' + aic.genderInstruction(g);
      }
    } catch (e) {
      console.warn('[voice] augment systému selhal:', e.message);
    }

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

        if (mode === 'outbound') {
          const fixedGreeting =
            state.campaign && state.campaign.greeting && String(state.campaign.greeting).trim();
          if (state.welcomeByTwilio && fixedGreeting) {
            // Úvod řekne Twilio (welcomeGreeting, neinteruptovatelně) → jen si ho
            // vložíme do historie, ať AI ví, že se už představila. Nic neposíláme.
            state.history = [{ role: 'assistant', content: fixedGreeting }];
            state.transcript.push({ role: 'agent', text: fixedGreeting, ts: Date.now() });
          } else if (fixedGreeting) {
            // Pevná úvodní věta z kampaně (AI ji řekne přesně takto)
            state.history = [{ role: 'assistant', content: fixedGreeting }];
            state.transcript.push({ role: 'agent', text: fixedGreeting, ts: Date.now() });
            send(ws, { type: 'text', token: fixedGreeting, last: true });
          } else {
            // AI zahájí hovor sama podle scénáře
            try {
              const { text, messages } = await agent.runTurn({
                system: state.system,
                history: [],
                userText: '(Hovor byl spojen, druhá strana zvedla. Zahaj rozhovor krátkým pozdravem a představením podle scénáře.)',
                maxTokens: 200,
              });
              state.history = messages;
              state.transcript.push({ role: 'agent', text, ts: Date.now() });
              send(ws, { type: 'text', token: text, last: true });
            } catch (e) {
              send(ws, {
                type: 'text',
                token: 'Dobrý den, volám z firmy Best Series. Máte chviličku?',
                last: true,
              });
            }
          }
        } else if (state.welcomeByTwilio) {
          // Příchozí: úvod řekne Twilio → jen ho zaznamenáme do historie.
          state.history = [{ role: 'assistant', content: state.greeting }];
          state.transcript.push({ role: 'agent', text: state.greeting, ts: Date.now() });
        } else {
          send(ws, { type: 'text', token: state.greeting, last: true });
        }
        return;
      }

      if (msg.type === 'prompt') {
        const userText = (msg.voicePrompt || '').trim();
        if (!userText) return;
        state.transcript.push({ role: 'caller', text: userText, ts: Date.now() });

        // Přepojení na živého člověka: když zákazník chce člověka, řekni krátkou
        // přepojovací větu a ukonči AI relaci s handoffData → Twilio zavolá
        // /api/voice/relay-end, které vytočí obchodníka leadu / záložní kontakt.
        if (!state.handedOff && wantsHuman(userText)) {
          let allow = true;
          try {
            if (mode === 'outbound') {
              // Odchozí: povolení řídí konkrétní kampaň.
              allow = state.campaign ? state.campaign.transfer_enabled !== false : true;
            } else if (getSetting) {
              // Příchozí: globální nastavení.
              const v = await getSetting('voice.transfer_enabled');
              allow = v === undefined || v === null ? true : (v === true || v === 'true' || v === 1 || v === '1');
            }
          } catch (_) { allow = true; }
          if (allow) {
            state.handedOff = true;
            const line = 'Přepojím vás na kolegu, moment prosím.';
            state.transcript.push({ role: 'agent', text: line, ts: Date.now() });
            send(ws, { type: 'text', token: line, last: true });
            console.log('[voice] přepojení vyžádáno (' + mode + ') → posílám end/handoff, callSid=' + state.callSid);
            // Prodleva, ať se přepojovací věta stihne DOŘÍCT, pak ukonči relaci
            // (jinak Twilio ukončí relaci uprostřed věty).
            setTimeout(() => {
              send(ws, { type: 'end', handoffData: JSON.stringify({ transfer: true, reason: 'caller_requested_human' }) });
            }, 2600);
            return;
          } else {
            console.log('[voice] přepojení vyžádáno, ale je VYPNUTÉ (' + mode + ').');
          }
        }
        try {
          const { text, messages } = await agent.runTurn({
            system: state.system,
            history: state.history,
            userText,
            toolset: null,
            maxTokens: 300,
          });
          state.history = messages;
          state.transcript.push({ role: 'agent', text, ts: Date.now() });
          send(ws, { type: 'text', token: text, last: true });
        } catch (e) {
          console.warn('[voice] runTurn selhal:', e.message);
          send(ws, {
            type: 'text',
            token: 'Omlouvám se, můžete to prosím zopakovat?',
            last: true,
          });
        }
        return;
      }
    });

    ws.on('close', async () => {
      try { clearInterval(pingTimer); } catch (_) { /* noop */ }
      if (!state.callSid && mode !== 'outbound') return;
      const endedAt = new Date();
      const durationSec = Math.max(0, Math.round((endedAt - state.startedAt) / 1000));

      let summary = null;
      let callerName = null;
      let callerIntent = null;
      let intents = null;
      try {
        if (state.transcript.some((t) => t.role === 'caller')) {
          const s = await agent.summarizeStructured(state.transcript, { now: new Date() });
          summary = s.summary || null;
          callerName = s.caller_name || null;
          callerIntent = s.caller_intent || null;
          intents = s;
        }
      } catch (e) {
        console.warn('[voice] shrnutí selhalo:', e.message);
      }

      let saved = null;
      try {
        if (prisma.voiceCall) {
          saved = await prisma.voiceCall.create({
            data: {
              direction: mode,
              agent_kind: mode === 'outbound' ? 'campaign' : 'personal',
              from_number: state.from || '',
              to_number: state.to || '',
              twilio_call_sid: state.callSid || 'local-' + Date.now(),
              started_at: state.startedAt,
              ended_at: endedAt,
              duration_sec: durationSec,
              transcript: state.transcript,
              summary,
              caller_name: callerName,
              caller_intent: callerIntent,
              campaign_target_id: state.targetId || null,
            },
          });
        }
      } catch (e) {
        console.warn('[voice] uložení hovoru selhalo:', e.message);
      }

      if (mode === 'outbound' && state.target) {
        // Aktualizuj cíl kampaně. Pozor: pokud AMD mezitím označil záznamník
        // (no_answer/failed), neklobrč to na 'done'.
        try {
          let cur = null;
          try { cur = await prisma.voiceCampaignTarget.findUnique({ where: { id: state.target.id }, select: { status: true } }); } catch (_) { cur = null; }
          const keep = cur && (cur.status === 'no_answer' || cur.status === 'failed');
          await prisma.voiceCampaignTarget.update({
            where: { id: state.target.id },
            data: {
              status: keep ? cur.status : 'done',
              result_summary: summary || callerIntent || null,
              voice_call_id: saved && saved.id,
            },
          });
        } catch (e) {
          console.warn('[voice] update cíle kampaně selhal:', e.message);
        }
        // Automatika podle záměrů z hovoru: nezájem → „Nemá zájem"; schůzka →
        // „Domluvena schůzka" + kalendář; zavolat jindy → „Volat příště" + kalendář.
        if (intents && state.target.phone) {
          try {
            await applyVoiceIntents(state.target.phone, intents, summary);
          } catch (e) {
            console.warn('[voice] zpracování záměrů selhalo:', e.message);
          }
        }
      } else {
        // Inbound: push do Velína
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
      }

      if (state.callSid) calls.delete(state.callSid);
    });
  });

  console.log('  Voice WS: ' + WS_PATH);
  return wss;
}

module.exports = { attach, WS_PATH, calls };
