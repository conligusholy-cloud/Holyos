// HolyOS — Microsoft Graph API klient pro čtení mailboxu faktur
// Volá Graph REST endpointy přímo přes fetch s OAuth 2.0 bearer tokenem.
// Výhoda oproti IMAP: funguje bez MAPI vrstvy, žádné propagační potíže.

const msOAuth2 = require('./ms-oauth2');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function authHeaders() {
  const token = await msOAuth2.getAccessToken('graph');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };
}

/**
 * List nepřečtených zpráv v inboxu.
 * @param {string} userPrincipalName - "faktury@bestseries.cz"
 * @param {object} opts - { top = 50, includeAttachments = true }
 */
async function listUnreadMessages(userPrincipalName, opts = {}) {
  const { top = 50, includeAttachments = true } = opts;
  const url = new URL(`${GRAPH_BASE}/users/${encodeURIComponent(userPrincipalName)}/mailFolders/Inbox/messages`);
  url.searchParams.set('$filter', 'isRead eq false');
  url.searchParams.set('$top', String(top));
  url.searchParams.set('$orderby', 'receivedDateTime desc');
  url.searchParams.set('$select', 'id,internetMessageId,subject,from,toRecipients,receivedDateTime,body,bodyPreview,hasAttachments,conversationId');
  if (includeAttachments) {
    // Pozn.: @odata.type nelze dát do $select — Graph ho vrací automaticky u každé polymorfní entity.
    url.searchParams.set('$expand', 'attachments($select=id,name,contentType,size,isInline)');
  }

  const r = await fetch(url, { headers: await authHeaders() });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Graph list messages selhal: ${r.status} ${r.statusText} — ${body.slice(0, 500)}`);
  }
  const data = await r.json();
  return data.value || [];
}

/**
 * Stáhne obsah konkrétní přílohy jako Buffer.
 * Pro FileAttachment vrátí bytes.
 */
async function downloadAttachment(userPrincipalName, messageId, attachmentId) {
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userPrincipalName)}/messages/${messageId}/attachments/${attachmentId}`;
  const r = await fetch(url, { headers: await authHeaders() });
  if (!r.ok) {
    throw new Error(`Graph download attachment selhal: ${r.status}`);
  }
  const data = await r.json();
  // FileAttachment → contentBytes je base64
  if (data['@odata.type'] === '#microsoft.graph.fileAttachment' && data.contentBytes) {
    return {
      name: data.name,
      contentType: data.contentType,
      size: data.size,
      buffer: Buffer.from(data.contentBytes, 'base64'),
    };
  }
  if (data['@odata.type'] === '#microsoft.graph.itemAttachment') {
    // Nested item — vynecháme (to by byl celý další mail)
    return null;
  }
  // Reference attachment → externí odkaz, nestahujeme
  return null;
}

/**
 * Označí zprávu jako přečtenou.
 */
async function markAsRead(userPrincipalName, messageId) {
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userPrincipalName)}/messages/${messageId}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...(await authHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ isRead: true }),
  });
  if (!r.ok) {
    console.warn(`[ms-graph] markAsRead selhal ${messageId}: ${r.status}`);
  }
}

/**
 * Pošle plain-text e-mail (pro auto-reply při nečitelné faktuře).
 * Používá SendMail endpoint — vyžaduje permission Mail.Send nebo Mail.ReadWrite.
 */
async function sendReply(userPrincipalName, { to, subject, body }) {
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userPrincipalName)}/sendMail`;
  const payload = {
    message: {
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...(await authHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Graph sendMail selhal: ${r.status} ${txt.slice(0, 300)}`);
  }
}

/**
 * Plnohodnotný send-mail s HTML body a přílohami. Použité pro odesílání
 * AR faktur (Fáze 6) jménem přihlášeného uživatele.
 *
 * @param {string} fromUpn      User Principal Name (e-mailová adresa) odesílatele.
 *                              Aplikace musí mít `Mail.Send` Application permission
 *                              + ApplicationAccessPolicy povolující odesílání za tohoto usera.
 * @param {Object} args
 * @param {string|string[]} args.to
 * @param {string} args.subject
 * @param {string} [args.textBody]
 * @param {string} [args.htmlBody]      Pokud zadáno, body bude contentType=HTML.
 * @param {Array}  [args.attachments]   [{ filename, content (Buffer|string), contentType }]
 * @param {boolean} [args.saveToSentItems=true]
 * @returns {Promise<{ ok: true }>}
 */
async function sendMailAs(fromUpn, { to, subject, textBody, htmlBody, attachments, saveToSentItems = true }) {
  if (!fromUpn) throw new Error('sendMailAs: chybí fromUpn');
  if (!to) throw new Error('sendMailAs: chybí to');

  const recipients = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map(addr => ({ emailAddress: { address: addr } }));

  const message = {
    subject: subject || '(bez předmětu)',
    body: htmlBody
      ? { contentType: 'HTML', content: htmlBody }
      : { contentType: 'Text', content: textBody || '' },
    toRecipients: recipients,
  };

  if (Array.isArray(attachments) && attachments.length > 0) {
    message.attachments = attachments.map(a => {
      const buf = Buffer.isBuffer(a.content)
        ? a.content
        : Buffer.from(a.content || '', a.encoding || 'utf8');
      return {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.filename || 'attachment',
        contentType: a.contentType || 'application/octet-stream',
        contentBytes: buf.toString('base64'),
      };
    });
  }

  const url = `${GRAPH_BASE}/users/${encodeURIComponent(fromUpn)}/sendMail`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...(await authHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, saveToSentItems }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Graph sendMailAs selhal (${r.status}): ${txt.slice(0, 400)}`);
  }
  return { ok: true };
}

function isConfigured() {
  return msOAuth2.isConfigured() && !!process.env.INVOICE_IMAP_USER;
}

module.exports = {
  listUnreadMessages,
  downloadAttachment,
  markAsRead,
  sendReply,
  sendMailAs,
  isConfigured,
};
