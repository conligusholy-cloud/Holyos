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

function renderEmailHtml({ title, body, link, linkLabel = 'Otevřít v HolyOS', preheader, brand, trackingPixel }) {
  const pixelImg = trackingPixel ? `<img src="${escapeHtml(trackingPixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden;">` : '';
  const appUrl = process.env.APP_URL || '';
  const fullLink = link && link.startsWith('http') ? link : (appUrl ? appUrl.replace(/\/$/, '') + link : link);

  // ── Compounder brand (tmavá grafika webu, zlaté akcenty) ──────────────────
  if (brand === 'compounder') {
    const site = 'https://www.compounder.world';
    const cLink = link && link.startsWith('http') ? link : site + (link || '');
    const bodyHtml = body ? escapeHtml(body).replace(/\n/g, '<br>') : '';
    return `<!DOCTYPE html>
<html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:#08080a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e9e9ec;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#08080a;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#141418;border:1px solid #26262c;border-radius:18px;overflow:hidden;">
        <tr><td style="padding:30px 34px 22px;border-bottom:1px solid #222228;">
          <div style="font-size:21px;font-weight:700;letter-spacing:.14em;color:#f4f4f6;">COMP<span style="color:#c9a24b;">OU</span>NDER</div>
          <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a8a92;margin-top:6px;">Compounder · World</div>
        </td></tr>
        <tr><td style="padding:30px 34px 8px;">
          <div style="font-size:22px;font-weight:600;color:#f4f4f6;line-height:1.3;">${escapeHtml(title || '')}</div>
        </td></tr>
        <tr><td style="padding:14px 34px 4px;">
          ${bodyHtml ? `<div style="font-size:15px;line-height:1.7;color:#b9b9c0;">${bodyHtml}</div>` : ''}
          ${cLink ? `
            <div style="margin:26px 0 8px;">
              <a href="${escapeHtml(cLink)}" style="display:inline-block;padding:14px 26px;background:#c9a24b;color:#0a0a0c;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:.01em;">
                ${escapeHtml(linkLabel || 'Otevřít')}
              </a>
            </div>
            <div style="font-size:12px;color:#6f6f78;margin-top:14px;word-break:break-all;">${escapeHtml(cLink)}</div>` : ''}
        </td></tr>
        <tr><td style="padding:24px 34px 30px;border-top:1px solid #222228;margin-top:18px;font-size:11.5px;color:#6f6f78;text-align:center;line-height:1.7;">
          You are receiving this e-mail because you expressed interest in Compounding at compounder.world.<br><br>
          COMPOUNDER · <b style="color:#8a8a92;">Best Series s.r.o.</b> · IČO 05643724 · Czech Republic<br>
          <a href="${site}" style="color:#c9a24b;text-decoration:none;">compounder.world</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
  ${pixelImg}
</body></html>`;
  }

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
 *
 * Pořadí cest:
 *   1) Pokud je předán `from` a Microsoft Graph je nakonfigurovaný (Azure App z Fáze 3
 *      s permission Mail.Send), použij Graph send-as jménem `from`. Tj. e-mail
 *      odejde z mailboxu té osoby (s Sent Items v jejím Outlooku).
 *   2) Jinak SMTP (nodemailer s SMTP_HOST/USER/PASS z .env).
 *
 * @param {Object} args
 * @param {string} args.to
 * @param {string} args.subject
 * @param {string} args.body            Plain text body (HTML se vyrenderuje šablonou)
 * @param {string} [args.from]          UPN odesílatele (pro Graph send-as). Když chybí,
 *                                      použije se SMTP_FROM/SMTP_USER.
 * @param {string} [args.link]          Volitelný odkaz na akci v UI
 * @param {string} [args.linkLabel]
 * @param {string} [args.preheader]
 * @param {Array}  [args.attachments]   Pole attachments [{ filename, content, contentType }]
 *                                      Použito mj. pro PDF fakturu (Fáze 6).
 */
async function sendMail({ to, cc, subject, body, from, fromName, link, linkLabel, preheader, attachments, brand, replyTo, trackingPixel }) {
  if (!to) return { sent: false, skipped: 'no-recipient' };

  // 1) Microsoft Graph send-as (preferovaná cesta pokud je `from` zadán a Graph
  //    je nakonfigurovaný — tedy Azure App z Fáze 3 s Mail.Send permission)
  if (from) {
    try {
      const msGraph = require('./ms-graph-client');
      if (msGraph.isConfigured && msGraph.isConfigured()) {
        const html = renderEmailHtml({ title: subject, body, link, linkLabel, preheader, brand, trackingPixel });
        await msGraph.sendMailAs(from, {
          to,
          cc: cc || undefined,
          subject: subject || 'HolyOS — notifikace',
          textBody: body ? body + (link ? `\n\n${link}` : '') : '',
          htmlBody: html,
          attachments: Array.isArray(attachments) ? attachments : undefined,
          fromName: fromName || undefined,
          replyTo: replyTo || undefined,
        });
        console.log(`[Email] odesláno přes Graph → ${to} (from ${from}${fromName ? ' / ' + fromName : ''})`);
        return { sent: true, via: 'graph', from };
      }
    } catch (e) {
      console.error('[Email] Graph sendMailAs selhal, fallback na SMTP:', e.message);
      // Spadnout dolů na SMTP
    }
  }

  // 2) SMTP fallback
  const tx = getTransporter();
  if (!tx) return { sent: false, skipped: 'no-transporter' };

  var baseFrom = from || process.env.SMTP_FROM || process.env.SMTP_USER || 'holyos@localhost';
  // Když je zadané jméno odesílatele a adresa není už ve formátu "Jméno <adresa>", slož ho.
  const fromHeader = (fromName && baseFrom.indexOf('<') < 0) ? `"${fromName}" <${baseFrom}>` : baseFrom;

  try {
    const mailOpts = {
      from: fromHeader,
      to,
      cc: cc || undefined,
      replyTo: replyTo || undefined,
      subject: subject || 'HolyOS — notifikace',
      text: body ? body + (link ? `\n\n${link}` : '') : '',
      html: renderEmailHtml({ title: subject, body, link, linkLabel, preheader, brand, trackingPixel }),
    };
    if (Array.isArray(attachments) && attachments.length > 0) {
      mailOpts.attachments = attachments;
    }
    const info = await tx.sendMail(mailOpts);
    return { sent: true, via: 'smtp', messageId: info.messageId };
  } catch (e) {
    console.error('[Email] SMTP odeslání na', to, 'selhalo:', e.message);
    return { sent: false, skipped: 'send-failed', error: e.message };
  }
}

module.exports = { sendMail };
