// =============================================================================
// HolyOS — Email servis (nodemailer, odesílání notifikačních emailů)
// =============================================================================
// Konfigurace přes env proměnné:
//   SMTP_HOST          — např. smtp.gmail.com, smtp.seznam.cz
//   SMTP_PORT          — 465 (TLS) nebo 587 (STARTTLS)
//   SMTP_SECURE        — 'true' pro port 465, jinak 'false'
//   SMTP_USER          — uživatelské jméno
//   SMTP_PASS          — heslo (u Gmailu "app password")
//   SMTP_FROM          — odesílatel (např. "HolyOS <noreply@firma.cz>")
//   APP_URL            — URL aplikace pro absolutní odkazy (např. https://holyos.cz)
//   EMAIL_DISABLED     — 'true' = vypne odesílání (dev bez SMTP)
//
// Pokud SMTP_HOST chybí, emailové notifikace jsou tiše vypnuté.
// =============================================================================

let transporter = null;
let initialized = false;

function getTransporter() {
  if (initialized) return transporter;
  initialized = true;

  if (process.env.EMAIL_DISABLED === 'true') {
    console.log('[Email] EMAIL_DISABLED=true — emaily se neodesílají');
    return null;
  }

  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log('[Email] SMTP_HOST není nastaven — emaily se neodesílají (přidej SMTP_HOST do .env)');
    return null;
  }

  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: (process.env.SMTP_USER && process.env.SMTP_PASS)
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      tls: { rejectUnauthorized: false }, // pro samopodepsané certifikáty na internal SMTP
    });
    console.log(`[Email] Transporter připraven (${host}:${process.env.SMTP_PORT || 587})`);
    return transporter;
  } catch (e) {
    console.error('[Email] Chyba inicializace transporteru:', e.message);
    return null;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderEmailHtml({ title, body, link, linkLabel = 'Otevřít v HolyOS', preheader }) {
  const appUrl = process.env.APP_URL || '';
  const fullLink = link && link.startsWith('http') ? link : (appUrl ? appUrl.replace(/\/$/, '') + link : link);
  return `<!DOCTYPE html>
<html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#333;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.05);">
        <tr><td style="background:linear-gradient(135deg,#6c5ce7,#3b82f6);padding:20px 28px;color:#fff;">
          <div style="font-size:12px;opacity:0.85;letter-spacing:1px;text-transform:uppercase;">HolyOS</div>
          <div style="font-size:20px;font-weight:600;margin-top:4px;">${escapeHtml(title || 'Nová notifikace')}</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          ${body ? `<div style="font-size:14px;line-height:1.6;color:#444;">${escapeHtml(body).replace(/\n/g, '<br>')}</div>` : ''}
          ${fullLink ? `
            <div style="margin-top:20px;">
              <a href="${escapeHtml(fullLink)}" style="display:inline-block;padding:10px 20px;background:#6c5ce7;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
                ${escapeHtml(linkLabel)}
              </a>
            </div>` : ''}
        </td></tr>
        <tr><td style="padding:14px 28px;background:#fafafc;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center;">
          Tento email ti zaslal HolyOS · Řízení výroby · Best Series<br>
          <a href="${escapeHtml(appUrl || '#')}" style="color:#6c5ce7;text-decoration:none;">Otevřít aplikaci</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Pošle email. Vrací { sent: bool, skipped: string? }.
 * Nikdy nevyhodí chybu — chyba se jen zaloguje.
 */
async function sendMail({ to, subject, body, link, linkLabel, preheader }) {
  if (!to) return { sent: false, skipped: 'no-recipient' };

  const tx = getTransporter();
  if (!tx) return { sent: false, skipped: 'no-transporter' };

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'holyos@localhost';

  try {
    const info = await tx.sendMail({
      from,
      to,
      subject: subject || 'HolyOS — notifikace',
      text: body ? body + (link ? `\n\n${link}` : '') : '',
      html: renderEmailHtml({ title: subject, body, link, linkLabel, preheader }),
    });
    return { sent: true, messageId: info.messageId };
  } catch (e) {
    console.error('[Email] Chyba odeslání na', to, '-', e.message);
    return { sent: false, skipped: 'send-failed', error: e.message };
  }
}

module.exports = { sendMail };
