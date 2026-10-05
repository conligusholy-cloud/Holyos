// BS2 — český 5. pád (oslovení) pro jméno a příjmení. Heuristika + slovník výjimek;
// u cizích/nejasných jmen raději ponechá 1. pád, než aby vyrobila nesmysl.

const FIRST_EXC = {
  petr: 'Petře', jan: 'Jane', jiří: 'Jiří', ondřej: 'Ondřeji', matěj: 'Matěji', vít: 'Víte', luboš: 'Luboši',
  daniel: 'Danieli', pavel: 'Pavle', karel: 'Karle', marek: 'Marku', zdeněk: 'Zdeňku', radek: 'Radku',
  martin: 'Martine', michal: 'Michale', josef: 'Josefe', štěpán: 'Štěpáne', jakub: 'Jakube', filip: 'Filipe',
  tomáš: 'Tomáši', lukáš: 'Lukáši', aleš: 'Aleši', miloš: 'Miloši', ivo: 'Ivo', ivan: 'Ivane', rostislav: 'Rostislave',
  kamil: 'Kamile', emil: 'Emile', lubomír: 'Lubomíre', vladimír: 'Vladimíre', miroslav: 'Miroslave', jaromír: 'Jaromíre',
  igor: 'Igore', gustav: 'Gustave', viktor: 'Viktore', václav: 'Václave', oldřich: 'Oldřichu', jindřich: 'Jindřichu',
  vojtěch: 'Vojtěchu', bohumil: 'Bohumile', alois: 'Aloisi', denis: 'Denisi', dušan: 'Dušane', andrej: 'Andreji',
  tony: 'Tony', alex: 'Alexi', max: 'Maxi', felix: 'Felixi', lukas: 'Lukasi', thomas: 'Thomasi',
  // ženská jména končící souhláskou — beze změny
  dagmar: 'Dagmar', miriam: 'Miriam', ester: 'Ester', ruth: 'Ruth', karin: 'Karin', ingrid: 'Ingrid', beatrix: 'Beatrix', iris: 'Iris',
};

function capLike(src, out) { return src && src[0] === src[0].toUpperCase() ? out.charAt(0).toUpperCase() + out.slice(1) : out; }

function vocFirst(name, female) {
  const n = String(name || '').trim(); if (!n) return n;
  const l = n.toLowerCase();
  if (FIRST_EXC[l]) return FIRST_EXC[l];
  if (/ie$/.test(l) || /[eiíyýéóůú]$/.test(l)) return n;       // Marie, Lucie, Jiří, Kryštofe…
  if (/ka$/.test(l)) return n.slice(0, -1) + 'o';               // Jirka → Jirko
  if (/a$/.test(l)) return n.slice(0, -1) + 'o';                // Jana → Jano, Honza → Honzo
  if (female) return n;                                          // ženské jméno na souhlásku
  if (/něk$/.test(l)) return n.slice(0, -3) + 'ňku';
  if (/ek$/.test(l)) return n.slice(0, -2) + 'ku';
  if (/ec$/.test(l)) return n.slice(0, -2) + 'če';
  if (/[tdn]r$/.test(l) && /[tdn]r$/.test(l)) return n.slice(0, -1) + 'ře';  // Alexandr → Alexandře
  if (/el$/.test(l)) return n.slice(0, -2) + 'le';
  if (/(ch|[hgk])$/.test(l)) return n + 'u';
  if (/[šžčřcjďťň]$/.test(l)) return n + 'i';
  if (/[bcdfhjklmnpqrstvwxz]$/.test(l) || /[áíéóúůýě]?[bcdfghklmnprstvz]$/.test(l)) return n + 'e';
  return n;
}

function vocLast(name) {
  const n = String(name || '').trim(); if (!n) return n;
  const l = n.toLowerCase();
  if (/(ová|á|ů)$/.test(l) || /[ýíéóúě]$/.test(l)) return n;   // Nováková, Holý, Krejčí, Novotná
  if (/a$/.test(l)) return n.slice(0, -1) + 'o';                // Svoboda → Svoboda → Svobodo
  if (/ek$/.test(l)) return n.slice(0, -2) + 'ku';
  if (/ec$/.test(l)) return n.slice(0, -2) + 'če';
  if (/[tdn]r$/.test(l)) return n.slice(0, -1) + 'ře';
  if (/el$/.test(l)) return n.slice(0, -2) + 'le';
  if (/[áíý]l$/.test(l)) return n + 'i';                        // Král → Králi
  if (/(ch|[hgk])$/.test(l)) return n + 'u';
  if (/[šžčřcjďťň]$/.test(l)) return n + 'i';
  if (/[bdfklmnprstvz]$/.test(l)) return n + 'e';
  return n;
}

function isFemale(first, last) {
  const l = String(last || '').toLowerCase(), f = String(first || '').toLowerCase();
  if (/(ová|ská|cká|á)$/.test(l)) return true;
  if (/ová$|á$/.test(l)) return true;
  return /(a|ie|e)$/.test(f) && !['honza', 'jura', 'kuba', 'saša', 'nikola', 'luka', 'ilja', 'jirka'].includes(f);
}

/** „Tomáš Holý“ → „Tomáši Holý“, „Jana Nováková“ → „Jano Nováková“. Bez jména vrací prázdný řetězec. */
function vocativeName(first, last) {
  const fem = isFemale(first, last);
  return [first ? vocFirst(first, fem) : '', last ? vocLast(last) : ''].filter(Boolean).join(' ');
}

module.exports = { vocativeName, vocFirst, vocLast };
