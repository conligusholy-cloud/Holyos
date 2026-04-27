// HolyOS — Microsoft OAuth 2.0 client credentials flow
// Získává access token pro Exchange Online IMAP (XOAUTH2).
// Tenant-level App Registration v Azure AD s IMAP.AccessAsApp application permission.

const msal = require('@azure/msal-node');

let cca = null;             // Cached ConfidentialClientApplication
let cachedToken = null;
let cachedExpiresAt = 0;    // ms epoch

/**
 * Vytvoří MSAL client (singleton).
 */
function getClient() {
  if (cca) return cca;

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Microsoft OAuth 2.0 není nakonfigurovaný. Chybí AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET v .env.'
    );
  }

  cca = new msal.ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    system: {
      loggerOptions: { loggerCallback: () => {}, piiLoggingEnabled: false },
    },
  });

  return cca;
}

/**
 * Vrátí platný access token s 60s bufferem před expirací.
 * Podporuje dva scope cíle:
 *  - 'outlook' → https://outlook.office365.com/.default (IMAP/POP přes XOAUTH2)
 *  - 'graph' (default) → https://graph.microsoft.com/.default (REST /messages API)
 */
const cacheByScope = new Map(); // scope-key → { token, expiresAt }

async function getAccessToken(scopeKey = 'graph') {
  const cached = cacheByScope.get(scopeKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }
  const scope = scopeKey === 'outlook'
    ? 'https://outlook.office365.com/.default'
    : 'https://graph.microsoft.com/.default';

  const client = getClient();
  const result = await client.acquireTokenByClientCredential({ scopes: [scope] });
  if (!result?.accessToken) {
    throw new Error('OAuth2: acquireTokenByClientCredential nevrátil accessToken.');
  }
  const token = result.accessToken;
  const expiresAt = result.expiresOn?.getTime() || (Date.now() + 3500 * 1000);
  cacheByScope.set(scopeKey, { token, expiresAt });
  return token;
}

/**
 * Je OAuth2 nakonfigurovaný (všechny tři hodnoty v .env)?
 */
function isConfigured() {
  return !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
}

/**
 * Reset cache — použít při problémech s expirací.
 */
function clearCache() {
  cacheByScope.clear();
}

module.exports = { getAccessToken, isConfigured, clearCache };
