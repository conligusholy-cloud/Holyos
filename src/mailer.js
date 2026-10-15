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

function isConfigured() {
  const s = smtpConf();
  return !!(s.host && s.user && s.pass);
}

function configSet() { return process.env.SES_CONFIGURATION_SET || ''; }

function getTransport() {
  const s = smtpConf();
  return nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 587,
    secure: !!s.secure,          // false = STARTTLS na 587
    requireTLS: !s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    tls: { minVersion: 'TLSv1.2' },
  });
}

async function verify() {
  if (!isConfigured()) return { ok: false, error: 'SMTP není nastaveno' };
  try { await getTransport().verify(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
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
    const info = await transport.sendMail(mailOpts);
    const sesId = (info && info.response && (String(info.response).match(/\bOk\s+([0-9a-fA-F-]{10,})/) || [])[1]) || '';
    return { ok: true, simulated: false, messageId: (info && info.messageId) || '', sesMessageId: sesId };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { sendEmail, isConfigured, verify, textToHtml, smtpConf, configSet };
