// HolyOS — E-mailová brána Amazon SES (SMTP) pro Best Series 2.0 / Centrum reklamy.
// Přeneseno 1:1 ze Špagetky; konfigurace env-first (Railway), HTML-only odeslání, dlouhý skrytý preheader,
// inline CID obrázky, hlavička X-SES-CONFIGURATION-SET (sledování), zachycení sesMessageId z SMTP odpovědi.
// Branding: Best Series 2.0 (tmavě modrá hlavička, azurový akcent).
const nodemailer = require('nodemailer');

function smtpConf() {
  const env = process.env;
  return {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || 'Best Series <noreply@mail.bestseries.cz>',
  };
}

// Režim API (HTTPS 443): Railway Hobby blokuje odchozí SMTP porty → s klíči SES_ACCESS_KEY_ID + SES_SECRET_ACCESS_KEY jde odeslání přes SES API (SendRawEmail)
function apiConf() {
  const env = process.env;
  const m = String(env.SMTP_HOST || '').match(/email-smtp\.([a-z0-9-]+)\.amazonaws/);
  const clean = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '');   // mezery / uvozovky z kopírování
  return { id: clean(env.SES_ACCESS_KEY_ID), secret: clean(env.SES_SECRET_ACCESS_KEY), region: env.SES_REGION || (m && m[1]) || 'eu-central-1' };
}
function useApi() { const a = apiConf(); return !!(a.id && a.secret); }
function mode() { return useApi() ? 'api' : 'smtp'; }

function isConfigured() {
  if (useApi()) return true;
  const s = smtpConf();
  return !!(s.host && s.user && s.pass);
}

function configSet() { return process.env.SES_CONFIGURATION_SET || ''; }

// Podepsané volání SES Query API (SigV4, bez AWS SDK)
async function sesCall(params) {
  const crypto = require('crypto');
  const a = apiConf();
  const host = 'email.' + a.region + '.amazonaws.com';
  const body = new URLSearchParams(Object.assign({ Version: '2010-12-01' }, params)).toString();
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const hash = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();
  const ct = 'application/x-www-form-urlencoded; charset=utf-8';
  const canon = ['POST', '/', '', 'content-type:' + ct, 'host:' + host, 'x-amz-date:' + amzDate, '', 'content-type;host;x-amz-date', hash(body)].join('\n');
  const scope = day + '/' + a.region + '/ses/aws4_request';
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canon)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + a.secret, day), a.region), 'ses'), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSign).update(sts, 'utf8').digest('hex');
  const r = await fetch('https://' + host + '/', { method: 'POST', body, signal: AbortSignal.timeout(20000), headers: { 'Content-Type': ct, 'X-Amz-Date': amzDate, Authorization: 'AWS4-HMAC-SHA256 Credential=' + a.id + '/' + scope + ', SignedHeaders=content-type;host;x-amz-date, Signature=' + sig } });
  const text = await r.text();
  const code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1] || '';
  const msg = (text.match(/<Message>([^<]+)<\/Message>/) || [])[1] || '';
  return { ok: r.ok, status: r.status, text, code, error: r.ok ? '' : ((code ? code + ': ' : '') + (msg || ('HTTP ' + r.status))) };
}

function getTransport() {
  const s = smtpConf();
  return nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 587,
    secure: !!s.secure,          // false = STARTTLS na 587
    requireTLS: !s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000,   // ať to nevisí minuty
  });
}

async function verify() {
  if (!isConfigured()) return { ok: false, error: 'SES není nastaveno' };
  if (useApi()) {
    try {
      const r = await sesCall({ Action: 'GetSendQuota' });
      if (r.ok) { const max = (r.text.match(/<Max24HourSend>([^<]+)</) || [])[1]; return { ok: true, mode: 'api', max24h: max ? Number(max) : null }; }
      // Skupina AWSSESSendingGroupDoNotRename smí jen odesílat → AccessDenied znamená, že klíč i podpis jsou platné
      if (/AccessDenied/i.test(r.code)) return { ok: true, mode: 'api', note: 'klíč platný (oprávnění jen k odesílání)' };
      const a = apiConf(); let hint = '';
      if (/SignatureDoesNotMatch/i.test(r.code)) hint = ' [kontrola: SES_SECRET_ACCESS_KEY má ' + a.secret.length + ' znaků (správně 40)' + (/^BD/.test(a.secret) && a.secret.length === 44 ? ', vypadá jako SMTP heslo – patří sem Secret access key' : '') + (/^SECRET_Z_CSV$/i.test(a.secret) ? ', je tam ještě zástupný text' : '') + ']';
      return { ok: false, mode: 'api', error: r.error + hint };
    } catch (e) { return { ok: false, mode: 'api', error: e.message }; }
  }
  try { await getTransport().verify(); return { ok: true, mode: 'smtp' }; }
  catch (e) { return { ok: false, mode: 'smtp', error: e.message + (/timeout|ETIMEDOUT|Greeting/i.test(e.message) ? ' – server se k SMTP nepřipojí (Railway Hobby blokuje SMTP porty → použij SES_ACCESS_KEY_ID + SES_SECRET_ACCESS_KEY)' : '') }; }
}

// Prostý text / markdown → čisté HTML (preheader skryje sledovací pixel, inline CID obrázky).
function textToHtml(text, preheader, opts = {}) {
  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const escAttr = (s) => String(s || '').replace(/"/g, '&quot;');
  const raw = String(text || '').replace(/\r\n/g, '\n');
  const body = esc(raw)
    .replace(/(^|\n)\s*#{1,6}\s+(.+)/g, '$1<strong>$2</strong>')
    .replace(/\*\*([^\n*][^*]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^\s*][^*\n]*?)\*(?=[\s.,!?):]|$)/g, '$1<em>$2</em>')
    .replace(/(^|\n)\s*[-*]\s+/g, '$1• ')
    // holé URL → <a> odkaz (SES sleduje prokliky jen u <a href>, ne u textu, který si prolinkuje klient)
    .replace(/(^|[\s(>])(https?:\/\/[^\s<]+?)(?=[.,!?):]*(?:\s|<|$))/g, '$1<a href="$2" style="color:#1e86e0;font-weight:600">$2</a>')
    .replace(/\n/g, '<br>');
  const cids = Array.isArray(opts.imageCids) ? opts.imageCids.filter(Boolean) : [];
  const imgHtml = cids.map((c) => `<div style="margin-top:16px"><img src="cid:${escAttr(c)}" alt="" style="width:100%;max-width:544px;border-radius:10px;display:block"></div>`).join('');
  const unsub = opts.unsubscribeUrl
    ? `<br><a href="${escAttr(opts.unsubscribeUrl)}" style="color:#8ea2c2;text-decoration:underline">Odhlásit odběr</a>` : '';
  // DLOUHÝ skrytý preheader (~260 znaků) → sledovací odkaz spadne mimo náhled schránky
  const bodyPlain = raw.replace(/\s+/g, ' ').trim();
  const preSrc = (preheader && String(preheader).trim()) || (raw.split('\n').find((l) => l.trim()) || 'Best Series');
  const pre = esc((preSrc.trim() + ' — ' + bodyPlain).replace(/\s+/g, ' ').trim().slice(0, 260));
  const spacer = '&#847;&zwnj;&nbsp;'.repeat(140);
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b1220">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${pre}</div>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${spacer}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
  <tr><td style="background:#0b1430;padding:18px 28px;font-weight:800;font-size:22px;color:#fff;letter-spacing:.02em">BEST SERIES <span style="color:#4fd1ff">2.0</span></td></tr>
  <tr><td style="padding:24px 28px;font-size:15px;line-height:1.6">${body}${imgHtml}</td></tr>
  <tr><td style="padding:16px 28px;background:#f0f4fb;border-top:1px solid #e3e9f5;font-size:12px;color:#58698a;text-align:center">
    <a href="https://www.bestseries2.cz" style="color:#1e86e0;text-decoration:none;font-weight:700">www.bestseries2.cz</a> · Best Series s.r.o.${unsub}
  </td></tr>
  </table></td></tr></table></body></html>`;
}

// vrací { ok, simulated, error, messageId, sesMessageId }
async function sendEmail({ to, subject, text, html, preheader, inlineImages, unsubscribeUrl, from, replyTo }) {
  const s = smtpConf();
  if (!isConfigured()) return { ok: true, simulated: true };   // simulační režim
  try {
    const transport = getTransport();
    const fs = require('fs');
    const imgs = (Array.isArray(inlineImages) ? inlineImages : []).filter((im) => im && im.path && fs.existsSync(im.path));
    const attachments = imgs.map((im, i) => ({ filename: im.filename || ('foto' + (i + 1) + '.jpg'), path: im.path, cid: 'img' + i }));
    const htmlBody = html || textToHtml(text, preheader, { imageCids: attachments.map((a) => a.cid), unsubscribeUrl });
    const cfgSet = configSet();
    const mailOpts = { from: from || s.from, to, subject, html: htmlBody, attachments, replyTo: replyTo || undefined };
    if (cfgSet) mailOpts.headers = { 'X-SES-CONFIGURATION-SET': cfgSet };   // DŮLEŽITÉ pro tracking
    if (useApi()) {
      const MailComposer = require('nodemailer/lib/mail-composer');
      const node = new MailComposer(mailOpts).compile();
      const raw = await node.build();
      const params = { Action: 'SendRawEmail', 'RawMessage.Data': raw.toString('base64') };
      if (cfgSet) params.ConfigurationSetName = cfgSet;
      let r = await sesCall(params);
      // limit odesílání (14/s): při Throttling chvíli počkat a zkusit znovu
      for (let i = 0; i < 3 && !r.ok && /Throttl|MaxSendRate/i.test(r.code + ' ' + r.error); i++) { await new Promise((ok) => setTimeout(ok, 1000 * (i + 1))); r = await sesCall(params); }
      if (!r.ok) {
        let hint = '';
        if (/not verified/i.test(r.error)) {
          const fromAddr = parseAddr(mailOpts.from).address.toLowerCase();
          const failed = ((r.error.split(':').pop()) || '').toLowerCase();
          hint = fromAddr && failed.includes(fromAddr)
            ? ' – odesílatel ' + fromAddr + ' (doména ' + fromAddr.split('@')[1] + ') není ověřený v AWS SES: SES → Identities → Create identity → Domain, DKIM záznamy do DNS.'
            : ' – příjemce není ověřený: účet SES je v sandboxu (posílat jde jen na ověřené adresy, dokud AWS neschválí Production access).';
        }
        return { ok: false, error: r.error + hint };
      }
      const sesId = (r.text.match(/<MessageId>([^<]+)<\/MessageId>/) || [])[1] || '';
      return { ok: true, simulated: false, messageId: node.messageId() || '', sesMessageId: sesId };
    }
    const info = await transport.sendMail(mailOpts);
    const sesId = (info && info.response && (String(info.response).match(/\bOk\s+([0-9a-fA-F-]{10,})/) || [])[1]) || '';
    return { ok: true, simulated: false, messageId: (info && info.messageId) || '', sesMessageId: sesId };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Odesílatelé přes SES: SMTP_FROM + další adresy (AppSetting ads_center.ses_senders) ──
// Každá doména musí být ověřená v AWS SES (Identities → doména, DKIM v DNS), jinak SES odeslání odmítne.
const SENDERS_KEY = 'ads_center.ses_senders';
function parseAddr(s) { const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(String(s || '')); return m ? { name: (m[1] || '').trim(), address: m[2].trim() } : { name: '', address: String(s || '').trim() }; }
async function extraSenders() {
  try { const { getSetting } = require('../settings'); const v = await getSetting(SENDERS_KEY, { type: 'json', defaultValue: [] }); return (Array.isArray(v) ? v : []).map(String).filter(Boolean); }
  catch (e) { return []; }
}
async function sesSenders() {
  const out = []; const seen = new Set();
  const add = (raw, extra) => { const p = parseAddr(raw); const a = p.address.toLowerCase(); if (!a || !a.includes('@') || seen.has(a)) return; seen.add(a); out.push({ raw: String(raw).trim(), address: p.address, name: p.name, domain: a.split('@')[1], extra: !!extra }); };
  if (process.env.SMTP_FROM) add(process.env.SMTP_FROM, false);
  (await extraSenders()).forEach((s) => add(s, true));
  return out;
}
/** Vrátí odesílatele SES pro danou adresu „From" (nebo null, když adresa přes SES nejde). */
async function sesSenderFor(from) {
  const a = parseAddr(from).address.toLowerCase(); if (!a) return null;
  return (await sesSenders()).find((s) => s.address.toLowerCase() === a) || null;
}

module.exports = { sendEmail, isConfigured, verify, textToHtml, smtpConf, configSet, mode, apiConf, sesSenders, sesSenderFor, extraSenders, SENDERS_KEY, parseAddr };
