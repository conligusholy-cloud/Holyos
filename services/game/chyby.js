// Laundromat Tycoon — evidence chyb z klientů (hráčům se nic neukazuje, vidí je jen admin hry).
// Ukládá se do AppSetting 'game.client_errors' (JSON pole, nejnovější první, max 500 skupin).
const { getSetting, setSetting } = require('../settings');
const KEY = 'game.client_errors';
const MAX = 500;

async function nacti() {
  const v = await getSetting(KEY, { type: 'json', defaultValue: [] }).catch(() => []);
  return Array.isArray(v) ? v : [];
}

// Stejná chyba (typ + text + hráč) se sloučí do jedné řádky s počitadlem.
async function zapis(hrac, chyby) {
  const list = await nacti();
  const ted = new Date().toISOString();
  for (const c of chyby.slice(0, 10)) {
    const typ = String(c.typ || 'jine').slice(0, 40);
    const text = String(c.text || '').slice(0, 300);
    const d = c.detail && typeof c.detail === 'object' ? c.detail : {};
    const kdy = /^\d{4}-/.test(String(c.kdy || '')) ? String(c.kdy).slice(0, 30) : ted;
    const radek = list.find((x) => x.typ === typ && x.text === text && x.player_id === hrac.id && !x.vyrizeno);
    if (radek) { radek.pocet += 1; radek.naposledy = kdy; radek.detail = d; continue; }
    list.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      typ, text, detail: d, player_id: hrac.id, nick: hrac.nick || null, firma: hrac.company || null,
      pocet: 1, poprve: kdy, naposledy: kdy, vyrizeno: false });
  }
  list.sort((a, b) => String(b.naposledy).localeCompare(String(a.naposledy)));
  await setSetting(KEY, list.slice(0, MAX), { type: 'json', description: 'Laundromat Tycoon — chyby z klientů (admin hry → Chyby)', scope: 'game' });
}

async function vyrizeno(id, hodnota) {
  const list = await nacti();
  const r = list.find((x) => x.id === id);
  if (r) r.vyrizeno = hodnota;
  await setSetting(KEY, list, { type: 'json', scope: 'game' });
}
async function smazVyrizene() {
  const list = (await nacti()).filter((x) => !x.vyrizeno);
  await setSetting(KEY, list, { type: 'json', scope: 'game' });
}

module.exports = { nacti, zapis, vyrizeno, smazVyrizene };
