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

function getTools() {
  return [
    {
      name: TOOL_NAME,
      description:
        'Zjistí aktuální evidovaná omezení provozu (závady) na konkrétním prádlomatu. ' +
        'Zavolej VŽDY, jakmile znáš město a lokalitu prádlomatu, ještě než začneš radit, ' +
        'co má zákazník zkusit. Když si potřebuješ stav během hovoru ověřit znovu, zavolej nástroj znovu. ' +
        'Vrací stav celého prádlomatu i jednotlivých zařízení (pračky, sušičky, platební terminál).',
      input_schema: {
        type: 'object',
        properties: {
          lokalita: {
            type: 'string',
            description: 'Lokalita prádlomatu tak, jak ji zákazník řekl — obchod a město, např. „Tesco Rychnov nad Kněžnou".',
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

async function execute(name, input) {
  if (name !== TOOL_NAME) return { chyba: 'Neznámý nástroj: ' + name };

  const lokalita = String((input && input.lokalita) || '').trim();
  const zarizeni = String((input && (input.zarizeni || input.zařízení)) || '').trim();

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

module.exports = { infolinkaToolset, getTools, execute, TOOL_NAME, publicItem, matchesDevice };
