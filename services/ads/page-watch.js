// HolyOS — Hlídač verzí záchytných stránek: každou hodinu stáhne veřejné stránky z Centra reklamy,
// vytáhne z nich strukturu (titulek, nadpisy, tlačítka, obrázky, video, barvy, počet slov, délka) a při změně
// zapíše novou verzi s rozdílem. Verze se ukládají do AppSetting ads_center.page_versions[key] = [{at, hash, summary, diff, note}].
// Díky tomu jde ke každé úpravě stránky (text, obrázek, vzhled, barvy) přiřadit, jak se po ní změnily výsledky.
const crypto = require('crypto');
const KEY = 'ads_center.page_versions';
const MAX_PER_PAGE = 60;

function strip(html) { return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '); }
function text(html) { return strip(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function all(re, s, i) { const out = []; let m; while ((m = re.exec(s))) out.push(i != null ? m[i] : m); return out; }
function dedupe(a) { return a.filter((x, i) => x && a.indexOf(x) === i); }

// Strukturní souhrn stránky – jen to, co ovlivňuje chování návštěvníka
function summarize(html) {
  const h = String(html || ''); const body = strip(h);
  const inner = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const title = (h.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const desc = (h.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1] || '';
  const h1 = dedupe(all(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, body, 1).map(inner)).slice(0, 6);
  const h2 = dedupe(all(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, body, 1).map(inner)).slice(0, 30);
  const h3 = dedupe(all(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, body, 1).map(inner)).slice(0, 40);
  const buttons = dedupe(all(/<(?:button|a)[^>]*class="[^"]*btn[^"]*"[^>]*>([\s\S]*?)<\/(?:button|a)>/gi, body, 1).map(inner).map((x) => x.slice(0, 60))).slice(0, 40);
  const images = dedupe(all(/<img[^>]*src="([^"]+)"/gi, h, 1).map((x) => x.split('?')[0].slice(0, 140))).slice(0, 40);
  const videos = dedupe(all(/<(?:video|iframe)[^>]*src="([^"]+)"/gi, h, 1).map((x) => x.slice(0, 140))).slice(0, 10);
  const colors = dedupe(all(/--(?:accent|accent2|vio|ok|err|bg|gold|primary)\s*:\s*(#[0-9a-fA-F]{3,8})/g, h, 1)).slice(0, 12);
  const prices = dedupe(all(/(\d{1,3}(?:[  ]\d{3})+|\d{3,6})\s*Kč/g, text(h), 1)).slice(0, 20);
  const sections = dedupe(all(/<section[^>]*(?:id|data-sec)="([^"]+)"/gi, body, 1)).slice(0, 30);
  const t = text(h); const words = t ? t.split(' ').length : 0;
  return { title, desc, h1, h2, h3, buttons, images, videos, colors, prices, sections, words, bytes: h.length };
}
function hashOf(sum) { return crypto.createHash('sha1').update(JSON.stringify(sum)).digest('hex').slice(0, 16); }

// Rozdíl dvou souhrnů – lidsky čitelný seznam změn
function diffOf(a, b) {
  if (!a) return ['první zaznamenaná verze'];
  const out = []; const lab = { title: 'titulek', desc: 'meta popis', h1: 'hlavní nadpis', h2: 'nadpisy sekcí', h3: 'podnadpisy', buttons: 'tlačítka', images: 'obrázky', videos: 'video', colors: 'barvy', prices: 'ceny', sections: 'sekce' };
  Object.keys(lab).forEach((k) => { const x = a[k], y = b[k];
    if (Array.isArray(y)) { const add = y.filter((v) => !(x || []).includes(v)), rem = (x || []).filter((v) => !y.includes(v)); if (add.length) out.push(lab[k] + ' přidáno: ' + add.map((v) => '„' + String(v).slice(0, 60) + '“').join(', ')); if (rem.length) out.push(lab[k] + ' odebráno: ' + rem.map((v) => '„' + String(v).slice(0, 60) + '“').join(', ')); }
    else if (x !== y) out.push(lab[k] + ': „' + String(x || '').slice(0, 80) + '“ → „' + String(y || '').slice(0, 80) + '“'); });
  if (Math.abs((b.words || 0) - (a.words || 0)) >= 25) out.push('rozsah textu: ' + (a.words || 0) + ' → ' + (b.words || 0) + ' slov');
  if (!out.length && a.bytes !== b.bytes) out.push('drobná úprava kódu / vzhledu (' + (a.bytes || 0) + ' → ' + (b.bytes || 0) + ' B)');
  return out;
}

async function load() { const { getSetting } = require('../settings'); const v = await getSetting(KEY, { type: 'json', defaultValue: {} }); return v && typeof v === 'object' ? v : {}; }
async function save(v) { const { setSetting } = require('../settings'); await setSetting(KEY, v, { type: 'json' }); }

// Jedno kolo kontroly všech stránek z Centra reklamy; vrací seznam klíčů, kde se něco změnilo
async function check(pages) {
  const store = await load(); const changed = [];
  for (const p of pages) {
    if (!p.url || !/^https?:/.test(p.url)) continue;
    let html; try { const r = await fetch(p.url, { headers: { 'User-Agent': 'HolyOS-PageWatch/1.0' }, signal: AbortSignal.timeout(15000) }); if (!r.ok) continue; html = await r.text(); } catch (e) { continue; }
    const sum = summarize(html); const hash = hashOf(sum); const list = Array.isArray(store[p.key]) ? store[p.key] : [];
    const last = list[list.length - 1];
    if (last && last.hash === hash) { last.seen_at = new Date().toISOString(); store[p.key] = list; continue; }
    const diff = diffOf(last ? last.summary : null, sum);
    list.push({ at: new Date().toISOString(), seen_at: new Date().toISOString(), hash, summary: sum, diff, note: '' });
    while (list.length > MAX_PER_PAGE) list.shift(); store[p.key] = list; changed.push(p.key);
  }
  await save(store); return changed;
}
async function versions(key) { const s = await load(); return Array.isArray(s[key]) ? s[key] : []; }
async function addNote(key, at, note) { const s = await load(); const list = Array.isArray(s[key]) ? s[key] : []; const v = list.find((x) => x.at === at); if (!v) return false; v.note = String(note || '').slice(0, 500); s[key] = list; await save(s); return true; }
// Ruční záznam změny (např. „nové video v hero") – uloží se jako verze s poznámkou a aktuálním souhrnem
async function manual(key, url, note) { const s = await load(); const list = Array.isArray(s[key]) ? s[key] : []; let sum = null; try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); sum = summarize(await r.text()); } catch (e) { sum = list.length ? list[list.length - 1].summary : null; } const last = list[list.length - 1]; list.push({ at: new Date().toISOString(), seen_at: new Date().toISOString(), hash: sum ? hashOf(sum) : 'manual', summary: sum, diff: diffOf(last ? last.summary : null, sum || {}), note: String(note || '').slice(0, 500), manual: true }); while (list.length > MAX_PER_PAGE) list.shift(); s[key] = list; await save(s); return list[list.length - 1]; }

let timer = null;
function start(getPages) { if (timer) return; const run = async () => { try { const ch = await check(getPages()); if (ch.length) console.log('[page-watch] změna stránek:', ch.join(', ')); } catch (e) { console.warn('[page-watch]', e.message); } }; setTimeout(run, 20000); timer = setInterval(run, 60 * 60 * 1000); }

module.exports = { summarize, diffOf, check, versions, addNote, manual, start };
