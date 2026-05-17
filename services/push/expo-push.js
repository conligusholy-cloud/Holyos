// =============================================================================
// HolyOS — Expo Push helper
// =============================================================================
// Wrapper nad Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/).
// Posíláme batch (max 100 zpráv/request). Vrací array delivery ticketů, které
// si můžeme uložit pro pozdější receipt check (Expo doporučuje po ~15 min).
//
// Pro Fázi 0 stačí synchronní fire-and-log. V Fázi 1 přidáme persistenci do
// PushDelivery tabulky a receipt pollování.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Pro Pracáček nepotřebujeme access tokeny — Expo Push je veřejné endpointy
// pro projekty bez "Enhanced Security". Pokud později zapneme, načteme klíč z env.
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN || null;

/**
 * Validace tokenu — Expo tokeny mají tvar ExponentPushToken[xxx] nebo ExpoPushToken[xxx]
 */
function isValidExpoToken(token) {
  if (!token || typeof token !== 'string') return false;
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

/**
 * Odeslání jedné nebo více push zpráv.
 *
 * @param {Array<Object>} messages - Pole zpráv ve formátu Expo Push API:
 *   { to: 'ExponentPushToken[...]', title, body, data, sound, badge, ... }
 * @returns {Promise<Array<Object>>} - Pole ticketů { status, id?, message?, details? }
 */
async function sendExpoPush(messages) {
  if (!Array.isArray(messages)) messages = [messages];
  if (messages.length === 0) return [];

  // Validuj tokeny — odfiltruj invalidní (vrátíme placeholder ticket)
  const valid = [];
  const invalid = [];
  for (const m of messages) {
    if (isValidExpoToken(m.to)) {
      valid.push(m);
    } else {
      invalid.push({ status: 'error', message: 'Invalid Expo push token', details: { token: m.to } });
    }
  }
  if (valid.length === 0) return invalid;

  const headers = {
    'Accept': 'application/json',
    'Accept-encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;

  // Expo limit: max 100 messages per request. Chunkujeme.
  const chunks = [];
  for (let i = 0; i < valid.length; i += 100) chunks.push(valid.slice(i, i + 100));

  const allTickets = [...invalid];
  for (const chunk of chunks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk),
      });
      // eslint-disable-next-line no-await-in-loop
      const json = await r.json().catch(() => ({}));
      if (Array.isArray(json.data)) {
        allTickets.push(...json.data);
      } else if (json.errors) {
        console.warn('[expo-push] Errors from Expo:', json.errors);
        allTickets.push({ status: 'error', message: 'Expo response error', details: json.errors });
      } else {
        console.warn('[expo-push] Unexpected response:', json);
      }
    } catch (e) {
      console.error('[expo-push] Network/HTTP error:', e.message);
      allTickets.push({ status: 'error', message: e.message });
    }
  }
  return allTickets;
}

/**
 * Vyšle push notifikaci konkrétní osobě — najde její aktivní zařízení v DB,
 * pošle batch a vrátí pole ticketů. Logování děje, neházeme chybu výš
 * (push selhání nesmí shodit business operaci, která ho jen oznamuje).
 *
 * @param {Object} prisma - Prisma client (předává volající, aby šel mock v testu)
 * @param {number} personId
 * @param {Object} payload - { title, body, data?, sound?, badge?, channelId? }
 */
async function notifyPerson(prisma, personId, payload) {
  if (!prisma || !personId || !payload) return [];

  // Tichý režim — pokud teď spadáme do quiet_from/quiet_to, push tichý
  // (vynecháme sound). Emergency push by mělo nastavit payload.bypassQuiet=true.
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { velin_quiet_from: true, velin_quiet_to: true, active: true },
  });
  if (!person || !person.active) {
    console.warn(`[expo-push] Person ${personId} not found or inactive — skipping push`);
    return [];
  }
  const silent = !payload.bypassQuiet && isWithinQuietHours(person.velin_quiet_from, person.velin_quiet_to);

  const devices = await prisma.deviceRegistration.findMany({
    where: { person_id: personId, active: true },
    select: { expo_push_token: true, platform: true, id: true },
  });
  if (devices.length === 0) {
    console.log(`[expo-push] Person ${personId} has no active devices — skipping`);
    return [];
  }

  const messages = devices.map((d) => ({
    to: d.expo_push_token,
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
    sound: silent ? null : (payload.sound || 'default'),
    badge: payload.badge,
    channelId: payload.channelId || 'default',
    priority: silent ? 'normal' : 'high',
  }));

  const tickets = await sendExpoPush(messages);
  console.log(`[expo-push] Sent ${messages.length} messages to person ${personId}, tickets:`,
    tickets.map((t) => t.status).join(','));
  return tickets;
}

/**
 * Vyhodnotí, zda aktuální lokální čas spadá do quiet hours okna.
 * `from`/`to` jsou "HH:MM" stringy. Okno přes půlnoc (22:00 → 06:00) je OK.
 */
function isWithinQuietHours(from, to) {
  if (!from || !to) return false;
  const [fH, fM] = from.split(':').map(Number);
  const [tH, tM] = to.split(':').map(Number);
  if (isNaN(fH) || isNaN(tH)) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = fH * 60 + fM;
  const end = tH * 60 + tM;
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end; // ten samý den
  return cur >= start || cur < end;                  // přes půlnoc
}

module.exports = {
  sendExpoPush,
  notifyPerson,
  isValidExpoToken,
  isWithinQuietHours,
};
