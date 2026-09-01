// =============================================================================
// HolyOS — Voice: notifikace do Velína po hovoru (Fáze 2)
// =============================================================================
// Po zavěšení založí NOTIFIKAČNÍ ZÁZNAM (zvoneček ve Velíně) + pošle push.
// Používá createNotification z routes/notifications.routes.js, které zapíše
// Notification (user_id) a zároveň pošle Expo push na Velín zařízení uživatele.
// Když osoba nemá User účet, spadne na čistý push (notifyPerson).
//
// Příjemce: 1) Person.voice_twilio_number == volané číslo, jinak
//           2) AppSetting "voice.notify_person_ids" (JSON pole Person.id).

const { prisma } = require('../../config/database');
const { notifyPerson } = require('../push/expo-push');

let createNotification = null;
try {
  ({ createNotification } = require('../../routes/notifications.routes'));
} catch (_) {
  createNotification = null;
}

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

  const from = fromNumber || 'neznámé číslo';
  const namePart = callerName ? ` (${callerName})` : '';
  const reason = callerIntent || summary || 'AI odbavila hovor.';
  const title = '📞 Zmeškaný hovor';
  const body = `Od ${from}${namePart}: ${reason}`.slice(0, 250);
  const meta = { kind: 'voice_call', callId: callId || null, from, callerName: callerName || null };

  // Načti user_id pro každou osobu (kvůli zvonečku)
  const people = await prisma.person.findMany({
    where: { id: { in: recipients } },
    select: { id: true, user_id: true },
  });
  const userByPerson = new Map(people.map((p) => [p.id, p.user_id]));

  await Promise.all(
    recipients.map(async (pid) => {
      const userId = userByPerson.get(pid);
      try {
        if (userId && createNotification) {
          // Zapíše Notification (zvoneček) i pošle push
          await createNotification({ userId, type: 'system', title, body, meta });
        } else {
          // Fallback: osoba bez účtu → jen push
          await notifyPerson(prisma, pid, { title, body, data: meta, sound: 'default' });
        }
      } catch (e) {
        console.warn('[voice] notifikace selhala pro person', pid, e.message);
      }
    })
  );
}

module.exports = { notifyCall, resolveRecipients };
