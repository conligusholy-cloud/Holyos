// =============================================================================
// Laundromat Tycoon — cena pozemku na serveru
// =============================================================================
// Srovnání jmění ukázalo, že šedesát koupených pozemků server vůbec nevidí:
// hráč si vzal úvěr, koupil zem a serverové jmění mu kvůli tomu vyšlo
// záporné. Pozemek přitom není drobnost — je to nemovitost, banka proti ní
// půjčuje a u hráče, který zrovna expanduje, je to většina majetku.
//
// Cena pozemku se počítá z výměry a ceny za metr. Obojí visí na otisku
// názvu místa, takže to server spočítá sám úplně stejně jako hra:
//
//   výměra  = 180 až 420 m², podle otisku místa, zaokrouhlená na mřížku
//   za metr = 300 až 1200 Kč podle otisku, krát lukrativnost podle skóre
//
// Jediné, co server sám neví, je skóre místa: vzniká v hledači při obhlídce
// a do evidence míst se neukládá. Lukrativnost se z něj ale počítá v pevném
// rozsahu 0,6 až 1,2, takže i bez skóre jde určit pásmo, do kterého cena
// musí spadnout. Co pošle prohlížeč, se do toho pásma musí vejít — jinak se
// to zařízne. Dvojnásobek je nejvíc, co si tím hráč může přilepšit, a to
// jen u země, na které nic nestojí.
//
// Musí sedět s pozemekCena() v public/compounder/game/game.js. Hlídá to
// nastroje/tpozemky.js, který obě implementace porovná na stejných místech.

'use strict';

const POZEMEK_M2_MIN = 180, POZEMEK_M2_MAX = 420;
const POZEMEK_ZA_M2_MIN = 300, POZEMEK_ZA_M2_MAX = 1200;
const LUKRATIV_MIN = 0.6, LUKRATIV_MAX = 1.2;

// FNV-1a nad názvem místa. Stejná čísla jako ve hře — proto Math.imul
// a posun bez znaménka, ne obyčejné násobení.
function spotHash(id, salt) {
  const t = String(id) + (salt || '');
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function planRozmer(m2) {
  const w = Math.max(8, Math.round(Math.sqrt(m2 * 1.6)));
  const h = Math.max(6, Math.round(m2 / w));
  return { w, h };
}

// Výměra v metrech čtverečních. Zaokrouhluje se na celé metry mřížky, aby
// seděla s plánem, na kterém hráč staví.
function m2(spotId) {
  const hrube = POZEMEK_M2_MIN + spotHash(spotId, 'm2') * (POZEMEK_M2_MAX - POZEMEK_M2_MIN);
  const r = planRozmer(hrube);
  return r.w * r.h;
}

// Cena za metr bez lukrativnosti.
function zakladZaM2(spotId) {
  return POZEMEK_ZA_M2_MIN + spotHash(spotId, 'cm') * (POZEMEK_ZA_M2_MAX - POZEMEK_ZA_M2_MIN);
}

function lukrativ(score) {
  const sc = Math.max(0, Math.min(100, Number(score) || 0));
  return LUKRATIV_MIN + (sc / 100) * (LUKRATIV_MAX - LUKRATIV_MIN);
}

// Cena pozemku při známém skóre. Zaokrouhlení na padesátky je ve hře taky —
// bez něj by se čísla rozešla o jednotky korun na metr a o tisíce celkem.
function cena(spotId, score) {
  const zaM2 = Math.round(zakladZaM2(spotId) * lukrativ(score) / 50) * 50;
  return m2(spotId) * zaM2;
}

// Pásmo, do kterého cena musí spadnout, ať je skóre jakékoli.
function pasmo(spotId) {
  return { min: cena(spotId, 0), max: cena(spotId, 100) };
}

// Cena, kterou server uzná. Co přijde z prohlížeče, se musí vejít do pásma;
// mimo něj se zařízne na jeho okraj. Bez čísla se bere střed pásma — je to
// odhad, ale lepší než nula, a u starých pozemků z doby před touhle
// evidencí nic jiného nemáme.
function uznana(spotId, poslana) {
  const p = pasmo(spotId);
  const n = Math.round(Number(poslana) || 0);
  if (!n) return Math.round((p.min + p.max) / 2);
  return Math.max(p.min, Math.min(p.max, n));
}

// Odhad pro pozemek, u kterého cenu neznáme (koupený dřív, než se ukládala).
function odhad(spotId) {
  const p = pasmo(spotId);
  return Math.round((p.min + p.max) / 2);
}

module.exports = { spotHash, planRozmer, m2, zakladZaM2, lukrativ,
  cena, pasmo, uznana, odhad,
  POZEMEK_M2_MIN, POZEMEK_M2_MAX, POZEMEK_ZA_M2_MIN, POZEMEK_ZA_M2_MAX };
