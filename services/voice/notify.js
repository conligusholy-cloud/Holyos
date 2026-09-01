// =============================================================================
// HolyOS — Voice: notifikace do Velína po hovoru (Fáze 2)
// =============================================================================
// Po zavěšení pošle push kolegovi, kterému hovor patřil:
//   1) Person.voice_twilio_number == volané číslo (owner), nebo
//   2) fallback AppSetting "voice.notify_person_ids" (JSON pole Person.id).
// Push jde přes services/push/expo-push.notifyPerson (Velín zařízení).

const { prisma } = require('../../config/database');
const { notifyPerson } = require('../push/expo-push');

let getSetting = null;
try {
  ({ getSetting } = require('../settings'));
} catch (_) {
  getSetting = null;
}

function normNumber(n) {
  return (n || '').replace(/[\s\-()]/g, '');
}

async function resolveRecipients(toNumber) {
  const ids = new Set();

  // 1) Owner podle volaného čísla
  try {
    const norm = normNumber(toNumber);
    if (norm) {
      const owner = await prisma.person.findFirst({
        where: { voice_twilio_number: norm, active: true },
        select: { id: true },
      });
      if (owner) ids.add(owner.id);
    }
  } catch (_) {
    /* ignore */
  }

  // 2) Fallback: AppSetting voice.notify_person_ids
  if (!ids.size && getSetting) {
    try {
      const raw = await getSetting('voice.notify_person_ids');
      let arr = raw;
      if (typeof raw === 'string') {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = raw.split(',');
        }
      }
      (Array.isArray(arr) ? arr : []).forEach((x) => {
        const n = parseInt(x, 10);
        if (n) ids.add(n);
      });
    } catch (_) {
      /* ignore */
    }
  }

  return [...ids];
}

async function notifyCall({ toNumber, fromNumber, callerName, callerIntent, summary, callId }) {
  const recipients = await resolveRecipients(toNumber);
  if (!recipients.length) {
    console.log(
      '[voice] žádný příjemce notifikace — nastav Person.voice_twilio_number nebo AppSetting voice.notify_person_ids'
    );
    return;
  }

  const who = callerName || fromNumber || 'Neznámé číslo';
  const title = `📞 Zmeškaný hovor — ${who}`;
  const body = (callerIntent || summary || 'AI odbavila hovor.').slice(0, 180);

  await Promise.all(
    recipients.map((pid) =>
      notifyPerson(prisma, pid, {
        title,
        body,
        data: { type: 'voice_call', callId: callId || null },
        sound: 'default',
      }).catch((e) => console.warn('[voice] push selhal pro person', pid, e.message))
    )
  );
}

module.exports = { notifyCall, resolveRecipients };
