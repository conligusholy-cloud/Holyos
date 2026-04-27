// HolyOS — ARES lookup s in-memory cache (TTL 24h)
// ARES = Administrativní registr ekonomických subjektů ČR
// REST API: https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const cache = new Map(); // ico → { at: timestamp, data }

/**
 * Dotaz na ARES podle IČO. Vrátí normalizovaný objekt nebo null při 404.
 * Vyhazuje jen při síťové chybě.
 */
async function lookupByIco(ico) {
  const clean = String(ico || '').replace(/\D/g, '');
  if (!clean || clean.length < 6 || clean.length > 8) return null;

  // Cache
  const cached = cache.get(clean);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const url = `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${clean}`;
  let r;
  try {
    r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  } catch (err) {
    console.warn('[ARES] Síťová chyba:', err.message);
    return null;
  }
  if (r.status === 404) {
    cache.set(clean, { at: Date.now(), data: null });
    return null;
  }
  if (!r.ok) {
    console.warn('[ARES] Neočekávaný status:', r.status);
    return null;
  }
  const d = await r.json();
  const sidlo = d.sidlo || {};
  const normalized = {
    ico: d.ico,
    name: d.obchodniJmeno,
    dic: d.dic || d.icDph || null,
    address: [sidlo.nazevUlice, sidlo.cisloDomovni, sidlo.cisloOrientacni && ('/' + sidlo.cisloOrientacni)]
      .filter(Boolean).join(' ').trim() || null,
    city: sidlo.nazevObce || sidlo.nazevCastiObce || null,
    zip: sidlo.psc ? String(sidlo.psc) : null,
    country: sidlo.kodStatu || 'CZ',
    legal_form: d.pravniForma,
    active: !d.datumZaniku,
    raw: d,
  };
  cache.set(clean, { at: Date.now(), data: normalized });
  return normalized;
}

/**
 * Porovná extrahovaná data z faktury (name, dic) proti oficiálním datům z ARES.
 * Vrací { match: bool, confidence: 0-1, mismatches: [{field, expected, got}] }.
 */
function crossCheck(extracted, aresData) {
  if (!aresData) {
    return { match: false, confidence: 0, mismatches: [{ field: 'ico', reason: 'IČO nenalezeno v ARES' }] };
  }
  const mismatches = [];
  let score = 1;

  // Porovnání obchodního jména (case-insensitive, strip s.r.o./a.s./...)
  const norm = s => (s || '').toLowerCase()
    .replace(/[,\.]/g, '')
    .replace(/\b(s\s*r\s*o|sro|a\s*s|as|spol|s\.r\.o\.|a\.s\.)\b/g, '')
    .replace(/\s+/g, ' ').trim();

  if (extracted.name && aresData.name) {
    const a = norm(extracted.name);
    const b = norm(aresData.name);
    if (a !== b && !a.includes(b) && !b.includes(a)) {
      mismatches.push({ field: 'name', expected: aresData.name, got: extracted.name });
      score -= 0.3;
    }
  }

  if (extracted.dic && aresData.dic) {
    const a = String(extracted.dic).replace(/\s/g, '').toUpperCase();
    const b = String(aresData.dic).replace(/\s/g, '').toUpperCase();
    if (a !== b) {
      mismatches.push({ field: 'dic', expected: aresData.dic, got: extracted.dic });
      score -= 0.2;
    }
  }

  return {
    match: mismatches.length === 0,
    confidence: Math.max(0, score),
    mismatches,
    canonical: aresData,
  };
}

module.exports = { lookupByIco, crossCheck };
