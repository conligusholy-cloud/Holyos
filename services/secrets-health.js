// HolyOS — Kontrola platnosti klíčů externích služeb (po rotaci secretů)
// Každá kontrola je jen ČTECÍ (žádné odeslání SMS/e-mailu, žádná platba).
// Nikdy nevrací hodnotu klíče — jen stav, případně délku pro diagnostiku.

const TIMEOUT_MS = 10000;

async function fetchT(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

const env = (k) => (process.env[k] || '').trim();
const has = (...keys) => keys.every((k) => !!env(k));

// Výsledek jedné kontroly
function res(name, status, detail) { return { name, status, detail: detail || '' }; }

async function httpCheck(name, keys, fn) {
  if (!has(...keys)) return res(name, 'missing', 'chybí ' + keys.filter((k) => !env(k)).join(', '));
  try {
    const out = await fn();
    return out;
  } catch (e) {
    return res(name, 'fail', e.name === 'AbortError' ? 'timeout' : e.message);
  }
}

async function statusOf(r) {
  if (r.ok) return null;
  const t = await r.text().catch(() => '');
  return 'HTTP ' + r.status + ' ' + t.replace(/\s+/g, ' ').slice(0, 160);
}

const CHECKS = {
  async database() {
    try {
      const { prisma } = require('../config/database');
      await prisma.user.count();
      return res('Databáze (DATABASE_URL)', 'ok');
    } catch (e) { return res('Databáze (DATABASE_URL)', 'fail', e.message.slice(0, 200)); }
  },

  anthropic: () => httpCheck('Anthropic (ANTHROPIC_API_KEY)', ['ANTHROPIC_API_KEY'], async () => {
    const r = await fetchT('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' } });
    const err = await statusOf(r);
    return err ? res('Anthropic (ANTHROPIC_API_KEY)', 'fail', err) : res('Anthropic (ANTHROPIC_API_KEY)', 'ok');
  }),

  openai: () => httpCheck('OpenAI (OPENAI_API_KEY)', ['OPENAI_API_KEY'], async () => {
    const r = await fetchT('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + env('OPENAI_API_KEY') } });
    const err = await statusOf(r);
    return err ? res('OpenAI (OPENAI_API_KEY)', 'fail', err) : res('OpenAI (OPENAI_API_KEY)', 'ok');
  }),

  deepgram: () => httpCheck('Deepgram (DEEPGRAM_API_KEY)', ['DEEPGRAM_API_KEY'], async () => {
    const r = await fetchT('https://api.deepgram.com/v1/projects', { headers: { Authorization: 'Token ' + env('DEEPGRAM_API_KEY') } });
    const err = await statusOf(r);
    return err ? res('Deepgram (DEEPGRAM_API_KEY)', 'fail', err) : res('Deepgram (DEEPGRAM_API_KEY)', 'ok');
  }),

  twilio: () => twilioCheck('Twilio hlavní (TWILIO_ACCOUNT_SID/AUTH_TOKEN)', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'),
  twilioInfolinka: () => twilioCheck('Twilio Infolinka (TWILIO_INFOLINKA_*)', 'TWILIO_INFOLINKA_ACCOUNT_SID', 'TWILIO_INFOLINKA_AUTH_TOKEN'),

  stripe: () => httpCheck('Stripe (STRIPE_SECRET_KEY)', ['STRIPE_SECRET_KEY'], async () => {
    const r = await fetchT('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY') } });
    const err = await statusOf(r);
    // Omezený klíč (rk_) bez práva na balance vrátí 403 → klíč je platný
    if (err && r.status === 403) return res('Stripe (STRIPE_SECRET_KEY)', 'ok', 'klíč platný (omezená oprávnění)');
    return err ? res('Stripe (STRIPE_SECRET_KEY)', 'fail', err) : res('Stripe (STRIPE_SECRET_KEY)', 'ok');
  }),

  async stripeWebhook() {
    const v = env('STRIPE_WEBHOOK_SECRET');
    if (!v) return res('Stripe webhook (STRIPE_WEBHOOK_SECRET)', 'missing', 'chybí');
    return /^whsec_[A-Za-z0-9]{20,}$/.test(v)
      ? res('Stripe webhook (STRIPE_WEBHOOK_SECRET)', 'ok', 'formát v pořádku — ověř „Send test event“ ve Stripe')
      : res('Stripe webhook (STRIPE_WEBHOOK_SECRET)', 'fail', 'nevypadá jako whsec_… (délka ' + v.length + ')');
  },

  async ses() {
    const name = 'Amazon SES (SES_ACCESS_KEY_ID/SECRET)';
    if (!has('SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY')) return res(name, 'missing', 'chybí SES klíče');
    try {
      const v = await require('./ses/mailer').verify();
      return v.ok ? res(name, 'ok', v.note || '') : res(name, 'fail', v.error);
    } catch (e) { return res(name, 'fail', e.message); }
  },

  async azure() {
    const name = 'Azure / M365 (AZURE_CLIENT_SECRET)';
    if (!has('AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET')) return res(name, 'missing', 'chybí AZURE_*');
    try {
      const o = require('./ms-oauth2');
      o.clearCache();
      const tok = await o.getAccessToken('graph');
      return tok ? res(name, 'ok') : res(name, 'fail', 'token nevrácen');
    } catch (e) { return res(name, 'fail', String(e.errorMessage || e.message).split('\n')[0].slice(0, 200)); }
  },

  gosms: () => httpCheck('GoSMS (GOSMS_CLIENT_ID/SECRET)', ['GOSMS_CLIENT_ID', 'GOSMS_CLIENT_SECRET'], async () => {
    const base = (env('GOSMS_BASE') || 'https://app.gosms.eu').replace(/\/+$/, '');
    const r = await fetchT(base + '/oauth/v2/token?grant_type=client_credentials&client_id=' + encodeURIComponent(env('GOSMS_CLIENT_ID')) + '&client_secret=' + encodeURIComponent(env('GOSMS_CLIENT_SECRET')));
    const err = await statusOf(r);
    return err ? res('GoSMS (GOSMS_CLIENT_ID/SECRET)', 'fail', err) : res('GoSMS (GOSMS_CLIENT_ID/SECRET)', 'ok');
  }),

  github: () => httpCheck('GitHub (AI_DEV_GITHUB_TOKEN)', ['AI_DEV_GITHUB_TOKEN'], async () => {
    const r = await fetchT('https://api.github.com/repos/conligusholy-cloud/Holyos', { headers: { Authorization: 'Bearer ' + env('AI_DEV_GITHUB_TOKEN'), 'User-Agent': 'holyos-secrets-health', Accept: 'application/vnd.github+json' } });
    const err = await statusOf(r);
    if (err) return res('GitHub (AI_DEV_GITHUB_TOKEN)', 'fail', err);
    const j = await r.json().catch(() => ({}));
    const push = j.permissions ? !!j.permissions.push : null;
    return res('GitHub (AI_DEV_GITHUB_TOKEN)', push === false ? 'fail' : 'ok', push === false ? 'token nemá právo zápisu (Contents: Read and write)' : (j.private === false ? 'POZOR: repozitář je veřejný' : ''));
  }),

  expo: () => httpCheck('Expo push (EXPO_ACCESS_TOKEN)', ['EXPO_ACCESS_TOKEN'], async () => {
    const r = await fetchT('https://api.expo.dev/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + env('EXPO_ACCESS_TOKEN'), 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ meActor { __typename id } }' }) });
    const err = await statusOf(r);
    if (err) return res('Expo push (EXPO_ACCESS_TOKEN)', 'fail', err);
    const j = await r.json().catch(() => ({}));
    return j && j.data && j.data.meActor ? res('Expo push (EXPO_ACCESS_TOKEN)', 'ok') : res('Expo push (EXPO_ACCESS_TOKEN)', 'fail', JSON.stringify(j.errors || j).slice(0, 160));
  }),

  async r2() {
    const name = 'Cloudflare R2 (R2_ACCESS_KEY_ID/SECRET)';
    if (!has('R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET')) return res(name, 'missing', 'chybí R2_*');
    try {
      const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
      const c = new S3Client({ region: 'auto', endpoint: env('R2_ENDPOINT'), forcePathStyle: true, credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') } });
      await c.send(new ListObjectsV2Command({ Bucket: env('R2_BUCKET'), MaxKeys: 1 }));
      return res(name, 'ok');
    } catch (e) { return res(name, 'fail', (e.Code || e.name || '') + ' ' + String(e.message || '').slice(0, 160)); }
  },

  metaApp: () => metaAppCheck('Meta aplikace (META_APP_ID/SECRET)', 'META_APP_ID', 'META_APP_SECRET'),
  metaLeadsApp: () => metaAppCheck('Meta Leads aplikace (META_LEADS_APP_ID/SECRET)', 'META_LEADS_APP_ID', 'META_LEADS_APP_SECRET'),
  metaPage: () => metaTokenCheck('Meta stránka (META_PAGE_ACCESS_TOKEN)', 'META_PAGE_ACCESS_TOKEN'),
  metaAds: () => metaTokenCheck('Meta reklamy (META_ADS_ACCESS_TOKEN)', 'META_ADS_ACCESS_TOKEN'),
};

async function twilioCheck(name, sidKey, tokKey) {
  return httpCheck(name, [sidKey, tokKey], async () => {
    const sid = env(sidKey);
    const auth = Buffer.from(sid + ':' + env(tokKey)).toString('base64');
    const r = await fetchT('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(sid) + '.json', { headers: { Authorization: 'Basic ' + auth } });
    const err = await statusOf(r);
    if (err) return res(name, 'fail', err);
    const j = await r.json().catch(() => ({}));
    return res(name, j.status === 'active' ? 'ok' : 'fail', 'účet: ' + (j.status || '?'));
  });
}

async function metaAppCheck(name, idKey, secKey) {
  return httpCheck(name, [idKey, secKey], async () => {
    const r = await fetchT('https://graph.facebook.com/oauth/access_token?grant_type=client_credentials&client_id=' + encodeURIComponent(env(idKey)) + '&client_secret=' + encodeURIComponent(env(secKey)));
    const err = await statusOf(r);
    return err ? res(name, 'fail', err) : res(name, 'ok');
  });
}

async function metaTokenCheck(name, key) {
  return httpCheck(name, [key], async () => {
    const r = await fetchT('https://graph.facebook.com/v19.0/me?fields=id,name&access_token=' + encodeURIComponent(env(key)));
    const err = await statusOf(r);
    return err ? res(name, 'fail', err) : res(name, 'ok');
  });
}

// Interní tajemství — jen kontrola, že jsou nastavená a dost dlouhá (hodnota se neověřuje proti ničemu)
const INTERNAL = ['JWT_SECRET', 'BS2_SSO_SECRET', 'BS2_SESSION_SECRET', 'COMPOUNDER_TOKEN_SECRET', 'HUGO_COOKIE_SECRET', 'UNSUBSCRIBE_SECRET', 'VOICE_RELAY_SECRET', 'SESSION_SECRET'];
// Klíče, které se automaticky ověřit nedají (u dodavatele / bez read-only API)
const MANUAL = ['FACTORIFY_TOKEN', 'SIS_KIOSK_API_KEY', 'SMTP_PASS', 'FB_WEBHOOK_API_KEY', 'GOOGLE_LEAD_WEBHOOK_KEY', 'MAKE_WEBHOOK_API_KEY', 'LINKEDIN_WEBHOOK_SECRET', 'SLOT_CALENDAR_API_KEY'];

async function runAll() {
  const started = Date.now();
  const external = await Promise.all(Object.values(CHECKS).map((fn) => fn().catch((e) => res('?', 'fail', e.message))));
  const internal = INTERNAL.map((k) => {
    const v = env(k);
    if (!v) return res(k, 'missing', 'nenastaveno');
    return res(k, v.length >= 32 ? 'ok' : 'weak', 'délka ' + v.length + (v.length >= 32 ? '' : ' (doporučeno ≥ 32)'));
  });
  const manual = MANUAL.map((k) => res(k, env(k) ? 'manual' : 'missing', env(k) ? 'nastaveno — ověř ručně ve funkci, která ho používá' : 'nenastaveno'));
  return { checked_at: new Date().toISOString(), ms: Date.now() - started, external, internal, manual };
}

module.exports = { runAll };
