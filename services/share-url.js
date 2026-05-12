// HolyOS — Helper pro buildování externích share/order URL
//
// Konfigurace přes env proměnné:
//   SHARE_BASE_URL  — externí doména pro share linky (např. https://bestseries.cash)
//                     Použito pro: /share/tools/:tool/:token a /order/:token
//                     Když chybí, fallback na APP_URL.
//   APP_URL         — primární doména aplikace (např. https://app.holyos.cz)
//
// Důvod oddělení: share linky obchodníka jsou marketingově oddělené od admin
// aplikace (jiná doména pro zákazníka než pro interní vstup).

function trimSlash(s) {
  return String(s || '').replace(/\/+$/, '');
}

/**
 * Vrátí base URL pro veřejné share linky (bez koncového /).
 * Příklad: 'https://bestseries.cash' nebo '' když není nic nakonfigurované.
 */
function getShareBaseUrl() {
  return trimSlash(process.env.SHARE_BASE_URL || process.env.APP_URL || '');
}

/**
 * Vrátí base URL aplikace (interní admin) — separátní od share doména.
 * Pro buildování linků zpět do admin UI.
 */
function getAppUrl() {
  return trimSlash(process.env.APP_URL || '');
}

/**
 * Sestaví full URL pro share path.
 * @param {string} pathname — např. '/share/tools/pradlomat-economy/abc...' nebo '/order/xyz...'
 */
function buildShareUrl(pathname) {
  const base = getShareBaseUrl();
  const path = pathname && pathname.startsWith('/') ? pathname : '/' + (pathname || '');
  return base + path;
}

module.exports = {
  getShareBaseUrl,
  getAppUrl,
  buildShareUrl,
};
