// HolyOS — odhady k servisnímu požadavku (při vytvoření).
// 1) est. čas OPRAVY (min) — AI (Claude) z popisu poruchy + úkonu + stroje.
// 2) est. čas CESTY (min) — geokódování základny + cíle (Nominatim) + trasa autem (OSRM).
// Vše best-effort: při chybě vrací null a request se založí bez odhadu.

const Anthropic = require('@anthropic-ai/sdk');
const { messagesCreate } = require('../anthropic-retry');

const MODEL = process.env.VOICE_MODEL || 'claude-haiku-4-5-20251001';

// ── AI odhad času opravy (minuty) ──
async function estimateRepairMinutes({ problem, action, task, machine, description }) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const client = new Anthropic({ apiKey });
    const info = [
      machine ? ('Stroj/místo: ' + machine) : null,
      problem ? ('Porucha: ' + problem) : null,
      action ? ('Úkon (prádlomat): ' + action) : null,
      task ? ('Úkon (špagetka): ' + task) : null,
      description ? ('Popis: ' + description) : null,
    ].filter(Boolean).join('\n');
    if (!info) return null;
    const sys = 'Jsi zkušený servisní technik samoobslužných prádlomatů a stánků Špagetka. '
      + 'Na základě popisu poruchy odhadni realistický čas VLASTNÍ OPRAVY na místě v minutách '
      + '(bez cesty). Uvažuj běžné zásahy (výměna dílu, čištění, restart, kalibrace). '
      + 'Odpověz POUZE jedním celým číslem (minuty), nic víc.';
    const resp = await messagesCreate(client, {
      model: MODEL, max_tokens: 8,
      system: sys,
      messages: [{ role: 'user', content: info }],
    }, { label: 'service-estimate' });
    const text = (resp && resp.content && resp.content[0] && resp.content[0].text) || '';
    const m = text.match(/\d{1,4}/);
    if (!m) return null;
    let min = parseInt(m[0], 10);
    if (!min || min < 1) return null;
    if (min > 600) min = 600; // strop 10 h
    return min;
  } catch (e) {
    console.warn('[service-estimate] repair:', e.message);
    return null;
  }
}

// ── Odhad času cesty autem ze základny ke stroji (minuty) ──
function geocode(q) {
  return fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=cs&countrycodes=cz&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'HolyOS-Servis/1.0' } })
    .then((r) => (r.ok ? r.json() : []))
    .then((a) => (a && a[0]) ? { lat: parseFloat(a[0].lat), lon: parseFloat(a[0].lon) } : null)
    .catch(() => null);
}
async function estimateTravelMinutes(baseAddress, destText) {
  try {
    if (!baseAddress || !destText) return null;
    // Cíl zkus i bez posledního „ - …" (např. „… - Pračka").
    const destClean = String(destText).replace(/\s*[-–]\s*[^-–]+$/, '').trim();
    const [oc, dc] = await Promise.all([
      geocode(baseAddress),
      geocode(destText).then((r) => r || (destClean && destClean !== destText ? geocode(destClean) : null)),
    ]);
    if (!oc || !dc) return null;
    const url = 'https://router.project-osrm.org/route/v1/driving/' + oc.lon + ',' + oc.lat + ';' + dc.lon + ',' + dc.lat + '?overview=false';
    const j = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (j && j.routes && j.routes[0]) return Math.round(j.routes[0].duration / 60);
    return null;
  } catch (e) {
    console.warn('[service-estimate] travel:', e.message);
    return null;
  }
}

module.exports = { estimateRepairMinutes, estimateTravelMinutes };
