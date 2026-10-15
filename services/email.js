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

// ── SMTP brána nastavitelná v Centru reklamy (AppSetting ads_center.smtp): { host, port, user, pass, from, from_name, secure } ──
const GATEWAY_KEY = 'ads_center.smtp';
let _gw = { at: 0, cfg: null };
function parseAddrLite(s) { const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(String(s || '')); return m ? { name: (m[1] || '').trim(), address: m[2].trim() } : { name: '', address: String(s || '').trim() }; }
function sameAddr(a, b) { return parseAddrLite(a).address.toLowerCase() === parseAddrLite(b).address.toLowerCase(); }
async function getGateway(force) { if (!force && _gw.cfg !== null && Date.now() - _gw.at < 60000) return _gw.cfg; try { const { getSetting } = require('./settings'); const v = await getSetting(GATEWAY_KEY, { type: 'json', defaultValue: null }); _gw = { at: Date.now(), cfg: v && typeof v === 'object' && v.host ? v : false }; } catch (e) { _gw = { at: Date.now(), cfg: false }; } return _gw.cfg; }
function gatewayTransport(cfg) { const nodemailer = require('nodemailer'); const port = parseInt(cfg.port, 10) || 587; return nodemailer.createTransport({ host: String(cfg.host).trim(), port, secure: !!cfg.secure || port === 465, auth: cfg.user ? { user: String(cfg.user).trim(), pass: String(cfg.pass || '') } : undefined, tls: { rejectUnauthorized: false }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 }); }
async function sendViaGateway(cfg, { to, cc, subject, body, link, linkLabel, preheader, attachments, brand, replyTo, trackingPixel, flyerUrl, rawHtml, fromName }) {
  try { const tx = gatewayTransport(cfg); const fa = parseAddrLite(cfg.from); const name = fromName || fa.name || cfg.from_name || ''; const fromHeader = name ? '"' + name.replace(/"/g, '') + '" <' + fa.address + '>' : fa.address;
    const info = await tx.sendMail({ from: fromHeader, to, cc: cc || undefined, replyTo: replyTo || undefined, subject: subject || 'Zpráva', text: body ? body + (link ? `\n\n${link}` : '') : '', html: renderEmailHtml({ title: subject, body, link, linkLabel, preheader, brand, trackingPixel, flyerUrl, rawHtml }), attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined });
    console.log(`[Email] odesláno přes SMTP bránu (${cfg.host}) → ${to} (from ${fa.address})`); return { sent: true, via: 'smtp-gateway', from: fa.address, messageId: info.messageId };
  } catch (e) { return { sent: false, error: e.message }; }
}
async function testGateway(cfg, to) { try { const tx = gatewayTransport(cfg); await tx.verify(); } catch (e) { return { ok: false, error: 'Připojení k SMTP selhalo: ' + e.message }; } const r = await sendViaGateway(cfg, { to, subject: 'Test e-mailové brány – HolyOS Centrum reklamy', body: 'Testovací e-mail z brány ' + cfg.host + '. Odesílatel: ' + cfg.from + '.', brand: 'bestseries2' }); return r.sent ? { ok: true, messageId: r.messageId } : { ok: false, error: r.error }; }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderEmailHtml({ title, body, link, linkLabel = 'Otevřít v HolyOS', preheader, brand, trackingPixel, flyerUrl, rawHtml }) {
  const pixelImg = trackingPixel ? `<img src="${escapeHtml(trackingPixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden;">` : '';
  const appUrl = process.env.APP_URL || '';
  const fullLink = link && link.startsWith('http') ? link : (appUrl ? appUrl.replace(/\/$/, '') + link : link);

  // Blok s letákem/prospektem (obrázek). Volitelně proklikne na odkaz (portál).
  // borderColor se liší dle brandu, ať sedí do grafiky.
  function flyerHtml(borderColor, clickUrl) {
    if (!flyerUrl) return '';
    const img = `<img src="${escapeHtml(flyerUrl)}" alt="Prádlomat — leták" style="width:100%;max-width:492px;height:auto;display:block;border-radius:12px;border:1px solid ${borderColor};">`;
    const inner = clickUrl ? `<a href="${escapeHtml(clickUrl)}" style="text-decoration:none;display:block;">${img}</a>` : img;
    return `<div style="margin:20px 0 2px;">${inner}</div>`;
  }

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
          ${flyerHtml('#2a2a30', cLink)}
        </td></tr>
        <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
  ${pixelImg}
</body></html>`;
  }

  // ── Best Series 2.0 brand: tmavý design jako web (www.bestseries2.cz) – tmavé pozadí, modro-fialové přechody,
  //    štítek BEST SERIES 2.0, bílý titulek, gradientové tlačítko. Platí pro všechny e-maily odesílané z BS2.
  if (brand === 'bs2') {
    const bLink = link && link.startsWith('http') ? link : null;
    const bodyHtml = body ? escapeHtml(body).replace(/\n/g, '<br>') : '';
    return `<!DOCTYPE html>
<html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:#04060c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#eaf2ff;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#04060c" style="background:#04060c;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b1222" style="max-width:560px;width:100%;background:#0b1222;border:1px solid #1e2a44;border-radius:18px;overflow:hidden;">
        <tr><td bgcolor="#070b16" style="background:#070b16;padding:22px 34px;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:40px;height:40px;background:#3a6cf5;background-image:linear-gradient(135deg,#4fd1ff,#3a6cf5 55%,#7c5cff);border-radius:12px;padding:2px;">
              <div style="width:36px;height:36px;line-height:36px;text-align:center;background:#0d1730;border-radius:10px;color:#4fd1ff;font-size:22px;font-weight:800;font-family:Arial,Helvetica,sans-serif;">B</div>
            </td>
            <td style="padding-left:12px;">
              <div style="font-size:19px;font-weight:800;letter-spacing:-.01em;color:#ffffff;line-height:1.1;">Best Series <span style="color:#7c9cff;">2.0</span></div>
              <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#7a8aa6;margin-top:4px;">www.bestseries2.cz</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="height:3px;line-height:3px;font-size:0;background:#3a6cf5;background-image:linear-gradient(90deg,#4fd1ff,#3a6cf5 55%,#7c5cff);">&nbsp;</td></tr>
        <tr><td style="padding:28px 34px 4px;">
          <span style="display:inline-block;padding:4px 11px;border:1px solid #27406a;border-radius:999px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8ea2c2;background:#0d1730;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#2fe3a0;margin-right:7px;vertical-align:middle;"></span>Best Series 2.0</span>
        </td></tr>
        <tr><td style="padding:14px 34px 6px;">
          <div style="font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;letter-spacing:-.01em;">${escapeHtml(title || '')}</div>
        </td></tr>
        <tr><td style="padding:10px 34px 8px;">
          ${bodyHtml ? `<div style="font-size:15px;line-height:1.7;color:#aebbd6;">${bodyHtml}</div>` : ''}
          ${bLink ? `<div style="margin:26px 0 8px;"><a href="${escapeHtml(bLink)}" style="display:inline-block;padding:13px 26px;background:#3a6cf5;background-image:linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff);color:#ffffff;text-decoration:none;border-radius:11px;font-size:14px;font-weight:700;">${escapeHtml(linkLabel || 'Otevřít')} →</a></div>
            <div style="font-size:12px;color:#5f6f8f;margin-top:10px;word-break:break-all;">${escapeHtml(bLink)}</div>` : ''}
          ${flyerHtml('#1e2a44', bLink)}
        </td></tr>
        <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
  ${pixelImg}
</body></html>`;
  }

  // ── Prádlomaty brand (modrá grafika jako stránka specialisty / leták) ─────
  if (brand === 'pradlomaty') {
    const site = 'https://pradlomaty.info';
    const pLink = link && link.startsWith('http') ? link : site + (link || '');
    const bodyHtml = body ? escapeHtml(body).replace(/\n/g, '<br>') : '';
    return `<!DOCTYPE html>
<html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#eaf2ff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f2444;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eaf2ff;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #cfe0fb;border-radius:18px;overflow:hidden;">
        <tr><td style="padding:26px 34px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);">
          <div style="font-size:22px;font-weight:800;letter-spacing:.04em;color:#ffffff;">💧 PRÁDLOMATY 💧</div>
          <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#dbe8ff;margin-top:6px;">Samoobslužné prádelny</div>
        </td></tr>
        <tr><td style="padding:30px 34px 8px;">
          <div style="font-size:22px;font-weight:700;color:#0f2444;line-height:1.3;">${escapeHtml(title || '')}</div>
        </td></tr>
        <tr><td style="padding:14px 34px 4px;">
          ${bodyHtml ? `<div style="font-size:15px;line-height:1.7;color:#334867;">${bodyHtml}</div>` : ''}
          ${pLink ? `
            <div style="margin:26px 0 8px;">
              <a href="${escapeHtml(pLink)}" style="display:inline-block;padding:14px 28px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;">
                ${escapeHtml(linkLabel || 'Otevřít')}
              </a>
            </div>
            <div style="font-size:12px;color:#6b7d99;margin-top:14px;word-break:break-all;">${escapeHtml(pLink)}</div>` : ''}
          ${flyerHtml('#cfe0fb', pLink)}
        </td></tr>
        <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
  ${pixelImg}
</body></html>`;
  }

  // ── Best Series / Výběry brand (bez HolyOS) ───────────────────────────────
  if (brand === 'vybery' || brand === 'bestseries') {
    // rawHtml = hotový (důvěryhodný) HTML obsah sestavený serverem → neescapuje se.
    const bodyHtml = rawHtml ? String(rawHtml) : (body ? escapeHtml(body).replace(/\n/g, '<br>') : '');
    const subtitle = brand === 'vybery' ? 'Výběry' : '';
    const bLink = link && link.startsWith('http') ? link : (appUrl ? appUrl.replace(/\/$/, '') + (link || '') : link);
    return `<!DOCTYPE html>
<html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:#08080a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e9e9ec;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#08080a;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#141418;border:1px solid #26262c;border-radius:18px;overflow:hidden;">
        <tr><td style="padding:28px 34px 20px;border-bottom:1px solid #222228;">
          <div style="display:inline-block;width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#e6cf92,#c9a24b);color:#241c05;text-align:center;line-height:34px;font-weight:900;font-size:17px;vertical-align:middle;">B</div>
          <span style="font-size:18px;font-weight:800;letter-spacing:.04em;color:#f4f4f6;margin-left:10px;vertical-align:middle;">BEST SERIES</span>
          ${subtitle ? `<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#c9a24b;margin-left:8px;vertical-align:middle;">${escapeHtml(subtitle)}</span>` : ''}
        </td></tr>
        <tr><td style="padding:28px 34px 8px;">
          <div style="font-size:22px;font-weight:600;color:#f4f4f6;line-height:1.3;">${escapeHtml(title || '')}</div>
        </td></tr>
        <tr><td style="padding:14px 34px 4px;">
          ${bodyHtml ? `<div style="font-size:15px;line-height:1.7;color:#b9b9c0;">${bodyHtml}</div>` : ''}
          ${bLink ? `
            <div style="margin:26px 0 8px;">
              <a href="${escapeHtml(bLink)}" style="display:inline-block;padding:14px 26px;background:#c9a24b;color:#0a0a0c;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">${escapeHtml(linkLabel || 'Otevřít')}</a>
            </div>
            <div style="font-size:12px;color:#6f6f78;margin-top:14px;word-break:break-all;">${escapeHtml(bLink)}</div>` : ''}
        </td></tr>
        <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>
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
// Pojistka: AppSetting customer_emails_paused = 'true' → e-maily zákazníkům (objednávky, doklady,
// faktury, upomínky) se NEODEŠLOU. Volající musí předat audience: 'customer'. Interní/Compounder e-maily nejsou dotčeny.
const CUSTOMER_MAIL_PAUSE_KEY = 'customer_emails_paused';
async function isCustomerMailPaused() {
  try { const { getSetting } = require('./settings'); return (await getSetting(CUSTOMER_MAIL_PAUSE_KEY, { type: 'boolean', defaultValue: false })) === true; } catch (e) { return false; }
}

async function sendMail({ to, cc, subject, body, from, fromName, link, linkLabel, preheader, attachments, brand, replyTo, trackingPixel, flyerUrl, rawHtml, deliveryReceipt, audience, leadId, campaignId, unsubscribe }) {
  if (!to) return { sent: false, skipped: 'no-recipient' };
  if (audience === 'customer' && await isCustomerMailPaused()) {
    console.warn(`[Email] POZASTAVENO (customer_emails_paused) — neodesláno → ${to}: ${subject}`);
    return { sent: false, skipped: 'customer-emails-paused', error: 'E-maily zákazníkům jsou pozastaveny (přepínač v Prodejních objednávkách)' };
  }

  // 00) Amazon SES brána (env SMTP_* + SES_CONFIGURATION_SET, src/mailer.js): jen e-maily od adresy SMTP_FROM
  try { const M = require('./ses/mailer'); if (M.isConfigured()) { const sesS = from ? await M.sesSenderFor(from) : null; const sf = sesS ? sesS.raw : M.smtpConf().from; const useSes = !!sesS; // SES jen pro odesílatele SES (SMTP_FROM + další v Nastavení) – ostatní cesty (M365 Graph) beze změny
    if (useSes) { const EL = require('./ses/email-log'); const unsubUrl = unsubscribe === false ? null : EL.unsubscribeUrl(to); let html = renderEmailHtml({ title: subject, body, link, linkLabel, preheader, brand, trackingPixel, flyerUrl, rawHtml }); if (unsubUrl) html = html.replace(/<\/body>/i, '<div style="text-align:center;font-size:11px;color:#8ea2c2;padding:10px 0 18px"><a href="' + unsubUrl + '" style="color:#8ea2c2;text-decoration:underline">Odhlásit odběr</a></div></body>');
      const fa = parseAddrLite(sf); const fromHeader = fromName ? '"' + String(fromName).replace(/"/g, '') + '" <' + fa.address + '>' : sf;
      const r = await M.sendEmail({ to, subject, html, from: fromHeader, replyTo, inlineImages: [] }); await EL.logMessage(r, { to, subject, campaignId: campaignId || (brand ? 'brand:' + brand : null), leadId });
      if (r.ok) { console.log('[Email] odesláno přes Amazon SES → ' + to + (r.simulated ? ' (simulace)' : '')); return { sent: true, via: 'ses', from: fa.address, messageId: r.messageId, sesMessageId: r.sesMessageId, simulated: !!r.simulated }; }
      console.error('[Email] SES odeslání selhalo, zkouším další cestu:', r.error); } } } catch (e) { console.error('[Email] SES:', e.message); }

  // 0) SMTP brána z Centra reklamy (Brevo / Amazon SES / M365 SMTP) – pokud je `from` její adresa (nebo from chybí a brána je výchozí)
  try { const gw = await getGateway(); if (gw && gw.host && gw.from && (!from || sameAddr(from, gw.from) || (gw.default_for_all && !from))) { const r = await sendViaGateway(gw, { to, cc, subject, body, link, linkLabel, preheader, attachments, brand, replyTo, trackingPixel, flyerUrl, rawHtml, fromName }); if (r.sent) return r; console.error('[Email] SMTP brána selhala, zkouším další cestu:', r.error); } } catch (e) { console.error('[Email] SMTP brána:', e.message); }

  // 1) Microsoft Graph send-as (preferovaná cesta pokud je `from` zadán a Graph
  //    je nakonfigurovaný — tedy Azure App z Fáze 3 s Mail.Send permission)
  let graphError = null;
  let graphConfigured = false;
  if (from) {
    try {
      const msGraph = require('./ms-graph-client');
      if (msGraph.isConfigured && msGraph.isConfigured()) {
        graphConfigured = true;
        const html = renderEmailHtml({ title: subject, body, link, linkLabel, preheader, brand, trackingPixel, flyerUrl, rawHtml });
        await msGraph.sendMailAs(from, {
          to,
          cc: cc || undefined,
          subject: subject || 'HolyOS — notifikace',
          textBody: body ? body + (link ? `\n\n${link}` : '') : '',
          htmlBody: html,
          attachments: Array.isArray(attachments) ? attachments : undefined,
          fromName: fromName || undefined,
          replyTo: replyTo || undefined,
          deliveryReceipt: !!deliveryReceipt,
        });
        console.log(`[Email] odesláno přes Graph → ${to} (from ${from}${fromName ? ' / ' + fromName : ''})`);
        return { sent: true, via: 'graph', from };
      }
    } catch (e) {
      graphError = (e && e.message) || String(e);
      console.error('[Email] Graph sendMailAs selhal (from ' + from + '):', graphError);
      // Spadnout dolů na SMTP
    }
  }

  // 2) SMTP fallback
  const tx = getTransporter();
  if (!tx) {
    // Vrať skutečnou příčinu: buď chyba Graphu (schránka není autorizovaná / neexistuje),
    // nebo že Graph není nakonfigurovaný a SMTP chybí.
    const why = graphError
      ? ('Graph odmítl odeslat z ' + from + ': ' + graphError)
      : (from && !graphConfigured ? 'Graph není nakonfigurovaný a SMTP chybí'
        : (!from ? 'Chybí odesílatel (from) a SMTP není nastavený' : 'SMTP není nastavený'));
    return { sent: false, skipped: 'no-transporter', error: why };
  }

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
      html: renderEmailHtml({ title: subject, body, link, linkLabel, preheader, brand, trackingPixel, flyerUrl, rawHtml }),
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

module.exports = { sendMail, renderEmailHtml, isCustomerMailPaused, CUSTOMER_MAIL_PAUSE_KEY, getGateway, testGateway, GATEWAY_KEY };
