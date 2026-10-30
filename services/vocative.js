// HolyOS — český 5. pád (oslovení) pro křestní jméno. Kopie logiky z apps/bs2/vocative.js
// (BS2 se nasazuje samostatně, proto vlastní kopie). U nejasných jmen ponechá 1. pád.

const FIRST_EXC = {
  petr: 'Petře', jan: 'Jane', jiří: 'Jiří', ondřej: 'Ondřeji', matěj: 'Matěji', vít: 'Víte', luboš: 'Luboši',
  daniel: 'Danieli', pavel: 'Pavle', karel: 'Karle', marek: 'Marku', zdeněk: 'Zdeňku', radek: 'Radku',
  martin: 'Martine', michal: 'Michale', josef: 'Josefe', štěpán: 'Štěpáne', jakub: 'Jakube', filip: 'Filipe',
  tomáš: 'Tomáši', lukáš: 'Lukáši', aleš: 'Aleši', miloš: 'Miloši', ivo: 'Ivo', ivan: 'Ivane', rostislav: 'Rostislave',
  kamil: 'Kamile', emil: 'Emile', lubomír: 'Lubomíre', vladimír: 'Vladimíre', miroslav: 'Miroslave', jaromír: 'Jaromíre',
  igor: 'Igore', gustav: 'Gustave', viktor: 'Viktore', václav: 'Václave', oldřich: 'Oldřichu', jindřich: 'Jindřichu',
  vojtěch: 'Vojtěchu', bohumil: 'Bohumile', alois: 'Aloisi', denis: 'Denisi', dušan: 'Dušane', andrej: 'Andreji',
  tony: 'Tony', alex: 'Alexi', max: 'Maxi', felix: 'Felixi', lukas: 'Lukasi', thomas: 'Thomasi',
  tomas: 'Tomáši', ales: 'Aleši', milos: 'Miloši', jiri: 'Jiří', ondrej: 'Ondřeji', matej: 'Matěji', stepan: 'Štěpáne',
  zdenek: 'Zdeňku', vaclav: 'Václave', vojtech: 'Vojtěchu', dusan: 'Dušane', lubos: 'Luboši', jindrich: 'Jindřichu', oldrich: 'Oldřichu',
  dagmar: 'Dagmar', miriam: 'Miriam', ester: 'Ester', ruth: 'Ruth', karin: 'Karin', ingrid: 'Ingrid', beatrix: 'Beatrix', iris: 'Iris',
};

function vocFirst(name, female) {
  const n = String(name || '').trim(); if (!n) return n;
  const l = n.toLowerCase();
  if (FIRST_EXC[l]) return FIRST_EXC[l];
  if (/ie$/.test(l) || /[eiíyýéóůú]$/.test(l)) return n;
  if (/ka$/.test(l)) return n.slice(0, -1) + 'o';
  if (/a$/.test(l)) return n.slice(0, -1) + 'o';
  if (female) return n;
  if (/něk$/.test(l)) return n.slice(0, -3) + 'ňku';
  if (/ek$/.test(l)) return n.slice(0, -2) + 'ku';
  if (/ec$/.test(l)) return n.slice(0, -2) + 'če';
  if (/[tdn]r$/.test(l)) return n.slice(0, -1) + 'ře';
  if (/el$/.test(l)) return n.slice(0, -2) + 'le';
  if (/(ch|[hgk])$/.test(l)) return n + 'u';
  if (/[šžčřcjďťň]$/.test(l)) return n + 'i';
  if (/[bcdfghjklmnpqrstvwxz]$/.test(l)) return n + 'e';
  return n;
}

function isFemale(first, last) {
  const l = String(last || '').toLowerCase(), f = String(first || '').toLowerCase();
  if (/(ová|ská|cká|á)$/.test(l)) return true;
  return /(a|ie|e)$/.test(f) && !['honza', 'jura', 'kuba', 'saša', 'nikola', 'luka', 'ilja', 'jirka'].includes(f);
}

/** Z celého jména („Tomáš Holý“) vrátí oslovení křestním jménem v 5. pádě („Tomáši“). */
function vocativeFirstName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0], last = parts.length > 1 ? parts[parts.length - 1] : '';
  return vocFirst(first, isFemale(first, last));
}

/** Příjmení v 5. pádě – jen u typicky českých tvarů, ostatní (cizí, přídavná jména -ý/-á/-í, -ová) zůstávají beze změny. */
function vocLast(last) {
  const n = String(last || '').trim(); const l = n.toLowerCase();
  if (!n || /(ý|á|í|ová|ská|cká)$/.test(l)) return n;
  if (/(ek|ěk|ec|ák|ík|ař|ář|ch|ka|a)$/.test(l)) return vocFirst(n, false);
  return n;
}
/** Celé jméno („Tomáš Holý“) v 5. pádě pro oslovení: „Tomáši Holý“, „Jano Nováková“, „Petře Nováku“. Neosobní údaje (e-mail, číslo) nechá být. */
function vocativeFullName(fullName) {
  const t = String(fullName || '').trim();
  if (!t || /[@\d]/.test(t)) return t;
  const parts = t.split(/\s+/).filter(Boolean);
  const first = parts[0], last = parts.length > 1 ? parts[parts.length - 1] : '';
  const female = isFemale(first, last);
  const out = [vocFirst(first, female)];
  if (parts.length > 1) { out.push(...parts.slice(1, -1)); out.push(female ? last : vocLast(last)); }
  return out.join(' ');
}

module.exports = { vocFirst, isFemale, vocativeFirstName, vocativeFullName };
