// HolyOS — stažení faktury z odkazu v e-mailu (Stripe / Anthropic a podobné portály)
// Mnoho dodavatelů (Stripe, Anthropic, OpenAI…) pošle jen tlačítko „Download invoice / receipt",
// které vede na HTML stránku, ne na PDF. Tady se z té stránky PDF dohledá:
//  1) Stripe: ke stránce faktury/účtenky se připojí „/pdf" (invoice.stripe.com/i/…/pdf, pay.stripe.com/…/pdf)
//  2) obecně: z HTML se vytáhnou odkazy na .pdf / „/pdf" / download a zkusí se (jedna úroveň)

const MAX_BYTES = 20 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; HolyOS-InvoiceFetcher/1.0)';

const normUrl = (u) => String(u || '').replace(/&amp;/gi, '&').replace(/[.,;:!?)\]>]+$/, '');

async function get(url) {
  const ctrl = new AbortController();
  const tmo = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'Accept': 'application/pdf,image/*,text/html;q=0.8,*/*;q=0.5', 'User-Agent': UA } });
    if (!res.ok) return { ok: false, status: res.status };
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) return { ok: false, status: 'too_big' };
    return { ok: true, ct, buffer: Buffer.from(ab), cd: res.headers.get('content-disposition') || '', url: res.url || url };
  } catch (e) { return { ok: false, status: e.message }; }
  finally { clearTimeout(tmo); }
}

const isDoc = (r) => r && r.ok && (r.ct.includes('pdf') || r.ct.startsWith('image/'));

function stripeVariants(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)stripe\.com$/i.test(u.hostname)) return [];
    const base = u.origin + u.pathname.replace(/\/+$/, '');
    if (/\/pdf$/i.test(base)) return [];
    return [base + '/pdf' + u.search, base + '/pdf'];
  } catch (e) { return []; }
}

function htmlCandidates(html, baseUrl) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = normUrl(m[1]);
    if (!/\.pdf(\?|#|$)|\/pdf(\?|#|$)|download|stahnout|invoice_pdf|receipt_pdf/i.test(href)) continue;
    try { const abs = new URL(href, baseUrl).toString(); if (abs !== baseUrl && out.indexOf(abs) === -1) out.push(abs); } catch (e) { /* neplatný odkaz */ }
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Vrátí { buffer, contentType, filename, finalUrl } nebo null.
 * Nikdy nehází — chyby se jen zalogují.
 */
async function fetchInvoiceDocument(rawUrl) {
  const url = normUrl(rawUrl);
  let r = await get(url);
  let source = r;
  if (!r.ok) { console.warn(`[invoice-link] ${url} → ${r.status}`); }
  if (!isDoc(r)) {
    const tries = [];
    stripeVariants(url).forEach((v) => tries.push(v));
    if (r.ok && r.ct.includes('html')) htmlCandidates(r.buffer.toString('utf8'), r.url || url).forEach((v) => { if (tries.indexOf(v) === -1) tries.push(v); });
    r = null;
    for (const t of tries) {
      const x = await get(t);
      if (isDoc(x)) { r = x; source = x; console.log(`[invoice-link] ${url} → PDF nalezeno na ${t}`); break; }
    }
    if (!r) { console.warn(`[invoice-link] ${url} → žádný dokument (PDF/obrázek) nenalezen`); return null; }
  }
  const cdMatch = source.cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const urlName = (source.url || url).split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || 'invoice';
  let filename = (cdMatch ? decodeURIComponent(cdMatch[1]) : urlName).replace(/['"]/g, '').trim() || 'invoice';
  if (!/\.(pdf|png|jpe?g|webp)$/i.test(filename)) {
    if (source.ct.includes('pdf')) filename += '.pdf';
    else if (source.ct.startsWith('image/')) filename += '.' + source.ct.split('/')[1].split(';')[0];
  }
  return { buffer: source.buffer, contentType: source.ct.split(';')[0] || 'application/pdf', filename, finalUrl: source.url || url };
}

/**
 * Z nalezených odkazů vyřadí duplicitní účtenky, když je k dispozici faktura
 * (Stripe posílá „Download invoice" i „Download receipt" ke stejné platbě).
 */
function preferInvoiceLinks(links) {
  const isStripeInvoice = (u) => /stripe\.com\/(i|invoice)\//i.test(u) || /invoice\.stripe\.com/i.test(u);
  const isStripeReceipt = (u) => /stripe\.com\/receipts?\//i.test(u);
  if (!links.some((l) => isStripeInvoice(l.url))) return links;
  return links.filter((l) => !isStripeReceipt(l.url));
}

module.exports = { fetchInvoiceDocument, preferInvoiceLinks, normUrl };
