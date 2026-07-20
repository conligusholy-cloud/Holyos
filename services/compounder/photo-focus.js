// HolyOS — Compounder: automatická detekce středu prádlomatu na fotce lokality.
// Přes Claude vision zjistíme, kde v obrázku je samoobslužný prádlomat (kiosek),
// a vrátíme jeho střed v procentech (fx, fy). Portál pak náhled vycentruje přes
// CSS object-position, takže prádlomat je vždy uprostřed ořezu.

const MODEL = process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';

// Stáhne obrázek a vrátí { media_type, data(base64) } nebo null.
async function _fetchImage(url) {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(to);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const media = /png/.test(ct) ? 'image/png'
      : /webp/.test(ct) ? 'image/webp'
      : /gif/.test(ct) ? 'image/gif'
      : 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 4.5 * 1024 * 1024) return null; // limit Anthropic base64
    return { media_type: media, data: buf.toString('base64') };
  } catch (e) { return null; }
}

// Vrátí { fx, fy } (0–100) středu prádlomatu, nebo null když se nepodařilo.
async function detectPhotoFocus(url) {
  if (!process.env.ANTHROPIC_API_KEY || !url) return null;
  const img = await _fetchImage(url);
  if (!img) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const sys = 'Na fotografii je venkovní samoobslužná prádelna „prádlomat" — samostatný uzavřený modul/kiosek (typicky box velikosti garáže, často modrý nebo tmavý, s prosklenými dveřmi a pračkami/sušičkami uvnitř; někdy menší samoobslužný automat u zdi budovy). Najdi jeho STŘED a vrať pozici v procentech rozměrů obrázku. Když na fotce žádný takový prádlomat/kiosek není, vrať found:false. Odpověz POUZE platným JSON bez markdownu: {"found":true,"fx":<0-100>,"fy":<0-100>} nebo {"found":false}. fx: 0=levý okraj, 100=pravý okraj. fy: 0=horní okraj, 100=dolní okraj.';
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 120,
      system: sys,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } },
          { type: 'text', text: 'Kde je střed prádlomatu (kiosku)?' },
        ],
      }],
    });
    let t = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    t = t.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    const j = JSON.parse(t);
    if (!j || j.found === false) return null;
    let fx = Math.round(Number(j.fx));
    let fy = Math.round(Number(j.fy));
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
    fx = Math.max(0, Math.min(100, fx));
    fy = Math.max(0, Math.min(100, fy));
    return { fx, fy };
  } catch (e) { return null; }
}

module.exports = { detectPhotoFocus };
