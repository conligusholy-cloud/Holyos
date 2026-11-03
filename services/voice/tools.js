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
        'Zjistí aktuální evidovaná omezení provozu (závady) na konkrétním prádlomatu. ' +
        'Zavolej VŽDY, jakmile znáš město a lokalitu prádlomatu, ještě než začneš radit, ' +
        'co má zákazník zkusit. Když si potřebuješ stav během hovoru ověřit znovu, zavolej nástroj znovu. ' +
        'Bez parametru „lokalita" vrátí ÚPLNÝ seznam všech evidovaných omezení na všech prádlomatech — ' +
        'použij to, když zákazník mluví obecně (např. shání nejbližší prádlomat) a ty si potřebuješ ověřit, ' +
        'jestli je některá lokalita omezená. ' +
        'Vrací stav celého prádlomatu i jednotlivých zařízení (pračky, sušičky, platební terminál).',
      input_schema: {
        type: 'object',
        properties: {
          lokalita: {
            type: 'string',
            description: 'Lokalita prádlomatu tak, jak ji zákazník řekl — obchod a město, např. „Tesco Rychnov nad Kněžnou". ' +
              'Nevyplňuj, když chceš celý seznam omezení na všech prádlomatech.',
          },
          zarizeni: {
            type: 'string',
            description: 'Volitelně konkrétní zařízení, o kterém zákazník mluví, např. „pračka 3" nebo „platební terminál".',
          },
        },
        // „lokalita" je nepovinná — bez ní nástroj vrátí celý seznam omezení.
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

// Úplný seznam evidovaných omezení (všechny prádlomaty) v podobě pro zákazníka.
// Používá ho jednak nástroj volaný bez lokality, jednak snímek v instrukcích hovoru.
async function allRestrictions() {
  try {
    const { items } = await restrictions.listActiveRestrictions({});
    const capped = items.slice(0, MAX_ITEMS);
    return {
      dostupnost: 'ok',
      cely_seznam: true,
      pocet_omezeni: items.length,
      omezeni: capped.map((it) => Object.assign({ lokalita: it.location }, publicItem(it))),
      zkraceno: items.length > capped.length ? ('zobrazeno ' + capped.length + ' z ' + items.length) : undefined,
      pokyn: items.length
        ? 'Tohle jsou JEDINÁ evidovaná omezení. O žádném jiném prádlomatu netvrď, že je mimo provoz.'
        : 'Právě není evidované ŽÁDNÉ omezení. O žádném prádlomatu neříkej, že je mimo provoz nebo v opravě. '
          + 'To ale neznamená, že všechno jistě funguje — neslibuj zákazníkovi bezchybný provoz.',
    };
  } catch (e) {
    console.warn('[voice tools] seznam omezení se nepodařilo načíst:', e.message);
    return {
      dostupnost: 'nedostupne',
      pokyn: 'Seznam omezení se teď nepodařilo načíst. NEŘÍKEJ, že žádná závada není evidovaná, '
        + 'ani že některý prádlomat mimo provoz je. Pokračuj běžným postupem.',
    };
  }
}

/**
 * Snímek všech evidovaných omezení jako text do instrukcí hovoru.
 * Staví se jednou na začátku hovoru, aby AI seznam měla i tehdy, když ji
 * nenapadne zavolat nástroj (přesně to se stalo u hovoru s dotazem na
 * nejbližší prádlomat — AI si „mimo provoz" domyslela).
 * Obsahuje jen to, co smí zaznít zákazníkovi — žádné interní poznámky
 * ani jména techniků (ta se do publicItem() nedostanou).
 */
async function buildRestrictionsBlock() {
  const head = '=== EVIDOVANÁ OMEZENÍ PROVOZU K TÉTO CHVÍLI (jediný platný zdroj) === ';
  let data;
  try {
    data = await allRestrictions();
  } catch (e) {
    data = { dostupnost: 'nedostupne' };
  }
  if (data.dostupnost === 'nedostupne') {
    return head
      + 'Seznam omezení se teď nepodařilo načíst. O ŽÁDNÉM prádlomatu neříkej, že je mimo provoz nebo v opravě, '
      + 'a zároveň netvrď, že všechno funguje. Zkus nástroj zjisti_omezeni_provozu, nebo pokračuj běžným postupem.';
  }
  if (!data.pocet_omezeni) {
    return head
      + 'Právě NENÍ evidované žádné omezení provozu — ani jeden prádlomat není hlášený jako mimo provoz. '
      + 'Proto o žádné lokalitě neříkej, že je mimo provoz, v opravě nebo že na ní pracuje servis. '
      + 'Neznamená to, že je vše jistě v pořádku: zákazníkovu závadu normálně sepiš a předej servisu.';
  }
  const radky = data.omezeni.map((o) => {
    const casti = [
      o.lokalita || 'neznámá lokalita',
      o.ceho_se_tyka,
      o.stav,
      o.popis_zavady ? ('závada: ' + o.popis_zavady) : null,
      o.informace_pro_zakaznika ? ('pro zákazníka: ' + o.informace_pro_zakaznika) : null,
    ].filter(Boolean);
    return '- ' + casti.join(' — ');
  });
  return head
    + 'Tohle je ÚPLNÝ seznam. Co v něm není, není mimo provoz a nesmíš to tak označit. '
    + (data.zkraceno ? ('(' + data.zkraceno + ' — zbytek si vyžádej nástrojem.) ') : '')
    + '\n' + radky.join('\n')
    + '\nSeznam je z okamžiku začátku hovoru. Když si potřebuješ stav ověřit znovu, zavolej zjisti_omezeni_provozu.';
}

async function execute(name, input) {
  if (name !== TOOL_NAME) return { chyba: 'Neznámý nástroj: ' + name };

  const lokalita = String((input && input.lokalita) || '').trim();
  const zarizeni = String((input && (input.zarizeni || input.zařízení)) || '').trim();

  // Bez lokality → celý seznam omezení ze všech prádlomatů. Zákazník se často
  // ptá obecně („kde je nejbližší prádlomat") a AI potřebuje vědět, jestli
  // některá lokalita omezená JE — ne si to domýšlet.
  if (!lokalita) return await allRestrictions();

  const res = await restrictions.getActiveRestrictions({ location: lokalita });

  // Data se nepodařilo načíst — AI to MUSÍ poznat a nesmí tvrdit, že nic není.
  if (!res.available) {
    return {
      dostupnost: 'nedostupne',
      pokyn: 'Údaje o závadách se teď nepodařilo načíst. NEŘÍKEJ zákazníkovi, že žádná závada není evidovaná. ' +
        'Pokračuj běžným postupem podle znalostních podkladů, případně nabídni přepojení na kolegu.',
    };
  }

  if (res.ambiguous) {
    return {
      dostupnost: 'ok',
      lokalita_rozpoznana: false,
      pokyn: 'Lokalita není jednoznačná — zeptej se zákazníka na město nebo přesnější označení prádlomatu. Nehádej.',
      moznosti: (res.candidates || []).map((c) => c.name),
    };
  }

  if (!res.resolved) {
    return {
      dostupnost: 'ok',
      lokalita_rozpoznana: false,
      pokyn: 'Tuhle lokalitu neznám. Ujisti se, o který prádlomat jde (obchod a město). ' +
        'Dokud lokalitu nemáš, netvrď nic o tom, jestli tam závada je nebo není.',
    };
  }

  const items = res.items;
  const out = {
    dostupnost: 'ok',
    lokalita_rozpoznana: true,
    lokalita: res.machine ? res.machine.name : res.location,
    cely_pradlomat_mimo_provoz: res.site_out,
    pocet_omezeni: items.length,
    omezeni: items.map(publicItem),
  };

  if (zarizeni) out.dotazane_zarizeni = Object.assign({ nazev: zarizeni }, matchesDevice(items, zarizeni));

  if (res.site_out) {
    out.pokyn = 'Celý prádlomat je mimo provoz — řekni to zákazníkovi hned a nenabízej mu postupy, které s tím nepomůžou.';
  } else if (!items.length) {
    out.pokyn = 'Na téhle lokalitě není evidovaná žádná závada. To ale NEZNAMENÁ, že všechno funguje — ' +
      'neslibuj zákazníkovi, že je zařízení v pořádku. Pokračuj běžnou diagnostikou podle znalostních podkladů.';
  } else {
    out.pokyn = 'Na lokalitě jsou evidovaná omezení. Pokud se týkají zařízení, o kterém zákazník mluví, ' +
      'řekni mu to a nabídni funkční alternativu, je-li jistá. Zařízení označené jako mimo provoz nedoporučuj.';
  }

  return out;
}

// Toolset pro services/voice/agent.js
const infolinkaToolset = { getTools, execute };

module.exports = { infolinkaToolset, getTools, execute, TOOL_NAME, publicItem, matchesDevice, allRestrictions, buildRestrictionsBlock };
