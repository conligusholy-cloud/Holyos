// =============================================================================
// HolyOS — Voice: worker odchozích kampaní
// =============================================================================
// Každých TICK_MS projde běžící kampaně, respektuje pracovní okno a limit
// souběžných hovorů, a volá čekající cíle. Zaseknuté „calling" (bez zavěšení)
// po pár minutách uvolní jako no_answer.

const { prisma } = require('../../config/database');
const outbound = require('./outbound');

const TICK_MS = 30000;
const MAX_CONCURRENT = parseInt(process.env.VOICE_OUTBOUND_CONCURRENCY, 10) || 1;
const STALE_MIN = 3;

function withinHours(campaign) {
  if (!campaign.call_from || !campaign.call_to) return true;
  const tz = process.env.VOICE_TZ || 'Europe/Prague';
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  return hhmm >= campaign.call_from && hhmm <= campaign.call_to;
}

async function tick() {
  try {
    if (!prisma.voiceCampaign) return;
    if (!outbound.isConfigured()) return; // bez Twilio creds nevoláme

    const running = await prisma.voiceCampaign.findMany({ where: { status: 'running' } });
    for (const camp of running) {
      // Uvolni zaseknuté hovory (calling/ringing/in_progress bez ukončení) + SMS
      const staleBefore = new Date(Date.now() - STALE_MIN * 60 * 1000);
      const stale = await prisma.voiceCampaignTarget
        .findMany({
          where: {
            campaign_id: camp.id,
            status: { in: ['calling', 'ringing', 'in_progress'] },
            updated_at: { lt: staleBefore },
          },
        })
        .catch(() => []);
      for (const st of stale) {
        await prisma.voiceCampaignTarget
          .update({ where: { id: st.id }, data: { status: 'no_answer', result_summary: 'Bez odpovědi / nespojeno' } })
          .catch(() => {});
        try {
          require('./sms').maybeSendNoAnswerSms(st);
        } catch (_) {
          /* noop */
        }
      }

      if (!withinHours(camp)) continue;

      const calling = await prisma.voiceCampaignTarget.count({
        where: { campaign_id: camp.id, status: { in: ['calling', 'ringing', 'in_progress'] } },
      });
      const slots = Math.max(0, MAX_CONCURRENT - calling);

      if (slots <= 0) continue;

      const pend = await prisma.voiceCampaignTarget.findMany({
        where: { campaign_id: camp.id, status: 'pending' },
        take: slots,
      });

      if (!pend.length) {
        const remaining = await prisma.voiceCampaignTarget.count({
          where: { campaign_id: camp.id, status: { in: ['pending', 'calling', 'ringing', 'in_progress'] } },
        });
        if (remaining === 0) {
          await prisma.voiceCampaign
            .update({ where: { id: camp.id }, data: { status: 'done' } })
            .catch(() => {});
        }
        continue;
      }

      for (const t of pend) {
        try {
          const sid = await outbound.placeCall(t, camp);
          await prisma.voiceCampaignTarget.update({
            where: { id: t.id },
            data: { status: 'calling', attempts: { increment: 1 }, last_call_sid: sid },
          });
          console.log('[voice-outbound] volám', t.phone, 'sid', sid);
        } catch (e) {
          console.warn('[voice-outbound] volání selhalo pro', t.phone, e.message);
          await prisma.voiceCampaignTarget
            .update({
              where: { id: t.id },
              data: { status: 'failed', result_summary: ('Chyba volání: ' + e.message).slice(0, 250) },
            })
            .catch(() => {});
        }
      }
    }
  } catch (e) {
    console.warn('[voice-outbound] tick chyba:', e.message);
  }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  console.log('[voice-outbound] worker start — tick ' + TICK_MS / 1000 + ' s');
  tick().catch(() => {});
}

module.exports = { start, tick };
