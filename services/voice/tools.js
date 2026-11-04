// =============================================================================
// HolyOS — Nástroje hlasového AI agenta (infolinka prádlomatů)
// =============================================================================
// Agent (services/voice/agent.js) bere toolset ve tvaru { getTools, execute }.
// Zatím je tu jediný nástroj: zjištění aktuálních omezení provozu na lokalitě,
// aby AI během hovoru věděla o evidovaných závadách a neposílala zákazníka
// zkoušet věci, které mu stejně nepomůžou.
//
// Data čte ze services/service/restrictions.js — ze stejného zdroje jako
// přehled „Aktuální omezení provozu" na Infolince.
//
// CO SE DO ODPOVĚDI NEDOSTANE (zadání, bod 5): interní servisní poznámky,
// jména techniků, telefony volajících ani odhady termínu opravy. AI dostane
// jen to, co smí zaznít zákazníkovi.

const restrictions = require('../service/restrictions');

const TOOL_NAME = 'zjisti_omezeni_provozu';
// Strop pro snímek v instrukcích — ať dlouhý seznam nevytlačí zbytek scénáře.
const MAX_ITEMS = 40;

function getTools() {
  return [
    {
      name: TOOL_NAME,
      description:
        'Zjistí aktuální evidovaná omezení provozu (závady) na JEDNOM konkrétním prádlomatu. ' +
        'Zavolej VŽDY, jakmile znáš město a lokalitu prádlomatu, ještě než začneš radit, ' +
        'co má zákazník zkusit. Když si potřebuješ stav během hovoru ověřit znovu, zavolej nástroj znovu. ' +
        'Parametr „lokalita" je povinný — nástroj NIKDY nevrací závady z jiných prádlomatů. ' +
        'Když lokalitu neznáš, nejdřív se na ni zeptej zákazníka. ' +
        'Vrací stav celého prádlomatu i jednotlivých zařízení (pračky, sušičky, platební terminál).',
      input_schema: {
        type: 'object',
        properties: {
          lokalita: {
            type: 'string',
            description: 'POVINNÉ. Lokalita prádlomatu tak, jak ji zákazník řekl — obchod a město, např. „Tesco Rychnov nad Kněžnou".',
          },
          zarizeni: {
            type: 'string',
            description: 'Volitelně konkrétní zařízení, o kterém zákazník mluví, např. „pračka 3" nebo „platební terminál".',
          },
        },
        required: ['lokalita'],
      },
    },
  ];
}

// Z položky omezení udělá to, co smí slyšet zákazník.
function publicItem(it) {
  return {
    ceho_se_tyka: it.site_out ? 'celý prádlomat' : (it.devices.length ? it.devices.join(', ') : 'zařízení'),
    druh_zarizeni: it.site_out ? ['site'] : Array.from(new Set(it.device_kinds.map((d) => d.kind))),
    stav: it.impact_label,
    zavaznost: it.impact,
    popis_zavady: it.problem || null,
    informace_pro_zakaznika: it.infoline_note || null,
    stav_servisu: it.status_label,
    od: it.since,
  };
}

// Týká se některé z evidovaných závad zařízení, o kterém zákazník mluví?
function matchesDevice(items, zarizeni) {
  const q = restrictions.locNorm(zarizeni || '').trim();
  if (!q) return null;
  const kind = restrictions.classifyDevice(zarizeni);
  const hit = items.filter((it) => {
    if (it.site_out) return true; // celý prádlomat mimo provoz se týká všeho
    return it.device_kinds.some((d) => {
      const dn = restrictions.locNorm(d.name);
      return dn.includes(q) || q.includes(dn) || (kind !== 'other' && d.kind === kind);
    });
  });
  return { nalezeno: hit.length > 0, polozky: hit.map(publicItem) };
}

// Snímek omezení do instrukcí hovoru UŽ NEPOSÍLÁME (požadavek #130).
// Dřív se na začátek hovoru vkládal seznam závad ze VŠECH prádlomatů. AI si pak
// vzala závadu z cizí lokality (zákazník ze Svitav dostal odstávku z Uherského
// Brodu) — mít cizí data v kontextu je samo o sobě riziko. Místo seznamu dostává
// AI jen pravidlo: dokud pro KONKRÉTNÍ lokalitu nezavolá nástroj, o žádném
// omezení nemluví.
function buildRestrictionsBlock() {
  return '=== OMEZENÍ PROVOZU — ODKUD JE BRÁT === '
    + 'Jediný platný zdroj informací o odstávkách a závadách je nástroj zjisti_omezeni_provozu, '
    + 'a to VŽDY pro tu konkrétní lokalitu, o které je řeč. Žádný seznam závad předem nemáš a mít nebudeš. '
    + 'Dokud ti nástroj pro danou lokalitu nevrátí omezení, neříkej, že je tam něco mimo provoz, v opravě '
    + 'nebo že na tom pracuje servis — ani náznakem, ani „asi", ani z toho, co jsi slyšela dřív v hovoru. '
    + 'Závada z jedné lokality NIKDY neplatí pro jinou. Když nástroj vrátí „Žádné evidované omezení", '
    + 'znamená to, že na té lokalitě nic evidovaného není — neslibuj ale zákazníkovi, že všechno jistě funguje.';
}

// Technický log jednoho dotazu na omezení (požadavek #130): co AI zadala,
// jakou lokalitu z toho HolyOS identifikoval, co načetl a co AI skutečně dostala.
// Ukládá se k hovoru do VoiceCall.restrictions_log.
function logEntry(input, res, out) {
  return {
    at: new Date().toISOString(),
    dotaz: { lokalita: (input && input.lokalita) || null, zarizeni: (input && (input.zarizeni || input.zařízení)) || null },
    lokalita_rozpoznana: !!(res && res.resolved),
    machine: (res && res.machine) ? { id: res.machine.id, name: res.machine.name } : null,
    matched_by: (res && res.matched_by) || null,
    // Co HolyOS načetl a jak to rozdělil — sem patří i zahozené cizí lokality,
    // ať je při reklamaci vidět, že se k AI nedostaly.
    nacteno: (res && res.diag) ? res.diag : null,
    // Co skutečně dostala AI (bez interních poznámek — ty publicItem nepouští dál).
    predano: out,
  };
}

/**
 * Vykoná nástroj. `onLog` (volitelné) dostane záznam do technického logu hovoru.
 */
async function execute(name, input, onLog) {
  const log = (res, out) => { try { if (typeof onLog === 'function') onLog(logEntry(input, res, out)); } catch (e) { /* log nikdy nesmí shodit hovor */ } return out; };
  if (name !== TOOL_NAME) return { chyba: 'Neznámý nástroj: ' + name };

  const lokalita = String((input && input.lokalita) || '').trim();
  const zarizeni = String((input && (input.zarizeni || input.zařízení)) || '').trim();

  // Bez lokality se neptáme na nic. Dřív se vracel seznam ze všech prádlomatů
  // a AI si z něj vzala cizí závadu — přesně to řeší požadavek #130.
  if (!lokalita) {
    return log(null, {
      dostupnost: 'ok',
      lokalita_rozpoznana: false,
      pokyn: 'Nezadala jsi lokalitu. Zeptej se zákazníka, o který prádlomat jde (obchod a město), a zavolej nástroj znovu. ' +
        'Dokud lokalitu nemáš, o žádném omezení provozu nemluv — závady z jiných prádlomatů pro tenhle hovor neplatí.',
    });
  }

  const res = await restrictions.getActiveRestrictions({ location: lokalita });

  // Data se nepodařilo načíst — AI to MUSÍ poznat a nesmí tvrdit, že nic není.
  if (!res.available) {
    return log(res, {
      dostupnost: 'nedostupne',
      pokyn: 'Údaje o závadách se teď nepodařilo načíst. NEŘÍKEJ zákazníkovi, že žádná závada není evidovaná. ' +
        'Pokračuj běžným postupem podle znalostních podkladů, případně nabídni přepojení na kolegu.',
    });
  }

  if (res.ambiguous) {
    return log(res, {
      dostupnost: 'ok',
      lokalita_rozpoznana: false,
      pokyn: 'Lokalita není jednoznačná — zeptej se zákazníka na město nebo přesnější označení prádlomatu. Nehádej.',
      moznosti: (res.candidates || []).map((c) => c.name),
    });
  }

  if (!res.resolved) {
    return log(res, {
      dostupnost: 'ok',
      lokalita_rozpoznana: false,
      pokyn: 'Tuhle lokalitu neznám. Ujisti se, o který prádlomat jde (obchod a město). ' +
        'Dokud lokalitu nemáš, netvrď nic o tom, jestli tam závada je nebo není.',
    });
  }

  const items = res.items;
  const out = {
    dostupnost: 'ok',
    lokalita_rozpoznana: true,
    lokalita: res.machine ? res.machine.name : res.location,
    // Pojistka proti záměně: AI vidí, pro kterou provozovnu data platí.
    id_provozovny: res.machine ? res.machine.id : null,
    cely_pradlomat_mimo_provoz: res.site_out,
    pocet_omezeni: items.length,
    omezeni: items.map(publicItem),
  };

  if (zarizeni) out.dotazane_zarizeni = Object.assign({ nazev: zarizeni }, matchesDevice(items, zarizeni));

  if (res.site_out) {
    out.pokyn = 'Celý prádlomat je mimo provoz — řekni to zákazníkovi hned a nenabízej mu postupy, které s tím nepomůžou.';
  } else if (!items.length) {
    out.stav = 'Žádné evidované omezení';
    out.pokyn = 'Na lokalitě ' + out.lokalita + ' NENÍ evidované žádné omezení provozu. ' +
      'Nepoužívej závadu z jiné lokality a žádnou odstávku si nedomýšlej. ' +
      'Zároveň neslibuj zákazníkovi, že všechno funguje — evidence nemusí být úplná. ' +
      'Pokračuj běžnou diagnostikou podle znalostních podkladů.';
  } else {
    out.pokyn = 'Tahle omezení platí POUZE pro lokalitu ' + out.lokalita + '. ' +
      'Pokud se týkají zařízení, o kterém zákazník mluví, řekni mu to a nabídni funkční alternativu, je-li jistá. ' +
      'Zařízení označené jako mimo provoz nedoporučuj.';
  }

  return log(res, out);
}

// Toolset pro services/voice/agent.js. `onLog` sbírá technický log k hovoru.
const createInfolinkaToolset = (onLog) => ({ getTools, execute: (name, input) => execute(name, input, onLog) });
const infolinkaToolset = createInfolinkaToolset(null);

module.exports = { infolinkaToolset, createInfolinkaToolset, getTools, execute, TOOL_NAME, publicItem, matchesDevice, buildRestrictionsBlock, logEntry };
