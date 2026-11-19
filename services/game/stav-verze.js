// =============================================================================
// Verze uloženého stavu — kdo smí přepsat koho
// =============================================================================
// Hra je klientská: celý stav drží prohlížeč a při každém uložení ho pošle
// celý. Když má hráč hru otevřenou na dvou místech, oba klienti posílají
// svoji pravdu a jeden z nich je vždycky starší. Proti tomu je verze: klient
// pošle tu, ze které vychází, a server uložení odmítne, když mezitím vznikla
// novější — a pošle novější stav zpátky, aby si ho klient převzal.
//
// Dřív to mělo díru: chybějící verze znamenala „nekontroluj“. Jenže hra,
// která svoji verzi ještě nezná, je přesně ta, které se věřit nedá — a ta
// přepsala naslepo i stav o mnoho novější. Jednomu hráči takhle zmizelo
// 57 M i se splaceným úvěrem: zaplatil ho v jedné hře a druhá, stará, ho
// o pár minut později přepsala i s penězi.
//
// Bez verze se proto ukládá jen do účtu, který ještě žádný stav nemá —
// to je první uložení nové hry a není co přepsat.
'use strict';

// Má se tohle uložení odmítnout? rev je verze, ze které klient vychází
// (null = neví), stateRev a state je to, co o hráči máme uložené.
function konflikt(rev, stateRev, state) {
  const akt = Number(stateRev || 0);
  const maStav = akt > 0 || !!(state && typeof state === 'object');
  if (rev == null) return maStav;
  const r = Number(rev);
  // Nečíslo není shoda — radši odmítnout a poslat stav zpátky.
  if (!Number.isFinite(r)) return true;
  return r !== akt;
}

module.exports = { konflikt };
