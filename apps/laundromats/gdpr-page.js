// =============================================================================
// Laundromats — Ochrana osobních údajů (GDPR)
// =============================================================================
// Obsah vychází z toho, co web a navazující HolyOS opravdu dělají: poptávkový
// formulář, rezervace schůzky, účty, měření pohybu po webu (cookie lm_sid),
// e-maily, SMS a videohovory. Když se zpracování změní, musí se změnit i tahle
// stránka — je to závazek vůči zákazníkovi, ne dekorace.
//
// POZOR: tohle je poctivě sepsaný podklad, ne právní posudek. Před ostrým
// nasazením ať ho projde právník; doby uchování níže jsou návrh, ne předpis.

'use strict';

const SPRAVCE = {
  nazev: 'Best Series s.r.o.',
  ico: '05643724',
  adresa: 'Zámostní 27, Slezská Ostrava, 710 00',
  email: 'info@bestseries.cz',
};
const UCINNOST = '4. 11. 2026';

const CSS = `<style>
:root{--bg:#04060c;--card:rgba(14,22,42,.6);--bd:rgba(120,160,255,.16);--t:#e8f0ff;--t2:#9db0cd;--t3:#6b7d9c;--blue:#4fd1ff}
*{box-sizing:border-box}
body{font-family:'Inter',system-ui,Segoe UI,Arial,sans-serif;background:var(--bg);color:var(--t2);margin:0;line-height:1.65;font-size:15.5px}
.wrap{max-width:780px;margin:0 auto;padding:28px 22px 70px}
.top{display:flex;align-items:center;gap:14px;margin-bottom:26px;flex-wrap:wrap}
.back{color:var(--blue);text-decoration:none;font-size:14px}
.back:hover{text-decoration:underline}
h1{color:var(--t);font-size:30px;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}
.lead{color:var(--t3);font-size:14px;margin:0 0 28px}
h2{color:var(--t);font-size:18px;margin:34px 0 10px;letter-spacing:-.01em}
h2 span{color:var(--t3);font-weight:400;font-size:14px;margin-right:8px}
p{margin:0 0 12px}
ul{margin:0 0 14px;padding-left:20px}
li{margin:0 0 7px}
b,strong{color:var(--t);font-weight:600}
a{color:var(--blue)}
table{width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--bd);vertical-align:top}
th{color:var(--t);font-weight:600;white-space:nowrap}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px 18px;margin:0 0 18px}
.tw{overflow-x:auto}
.foot{margin-top:40px;padding-top:18px;border-top:1px solid var(--bd);color:var(--t3);font-size:13px}
@media(max-width:560px){h1{font-size:25px}body{font-size:15px}}
</style>`;

function page() {
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ochrana osobních údajů · Laundromats</title>
<meta name="description" content="Jaké osobní údaje na laundromats.eu zpracováváme, proč, jak dlouho a jaká máte práva.">
<meta name="robots" content="index,follow">
${CSS}</head><body><div class="wrap">

<div class="top"><a class="back" href="/cesta" id="zpet">← zpět</a></div>

<h1>Ochrana osobních údajů</h1>
<p class="lead">Účinné od ${UCINNOST} · týká se webu laundromats.eu a navazující komunikace</p>

<div class="card">
<p>Tahle stránka popisuje, co se u nás děje s vašimi údaji. Shrnuto: údaje od vás sbíráme jen proto,
abychom s vámi mohli probrat prádlomat a navázat na to — nikomu je neprodáváme a nepředáváme je
nikomu, kdo pro nás nepracuje.</p>
</div>

<h2><span>1.</span>Kdo údaje zpracovává</h2>
<p>Správcem je <b>${SPRAVCE.nazev}</b>, IČO ${SPRAVCE.ico}, se sídlem ${SPRAVCE.adresa}.
Ve všem, co se týká osobních údajů, nás zastihnete na <a href="mailto:${SPRAVCE.email}">${SPRAVCE.email}</a>.</p>
<p>Nemáme pověřence pro ochranu osobních údajů — zákon nám ho neukládá. Vaše žádosti vyřizujeme přímo my.</p>

<h2><span>2.</span>Jaké údaje a proč</h2>
<div class="tw"><table>
<thead><tr><th>Co nám dáte</th><th>Proč to potřebujeme</th><th>Na základě čeho</th></tr></thead>
<tbody>
<tr><td><b>Poptávka z webu</b><br>jméno, e-mail, telefon, místo, poznámka</td>
    <td>Abychom se vám mohli ozvat a domluvit se, jestli má smysl pokračovat.</td>
    <td>Jednání o smlouvě (čl. 6 odst. 1 písm. b GDPR)</td></tr>
<tr><td><b>Rezervace schůzky</b><br>jméno, příjmení, e-mail, telefon, zvolený termín, poznámka</td>
    <td>Abychom schůzku potvrdili, poslali vám odkaz na videohovor a připomněli termín.</td>
    <td>Jednání o smlouvě</td></tr>
<tr><td><b>Účet na laundromats.eu</b><br>jméno, e-mail, telefon, firma, heslo (uložené jen jako otisk)</td>
    <td>Abyste se dostali k ekonomice prádlomatu a dalším nástrojům a vrátili se k nim i později.</td>
    <td>Jednání o smlouvě</td></tr>
<tr><td><b>Pohyb po webu</b><br>anonymní označení prohlížeče, navštívené stránky, čas, IP adresa, typ prohlížeče</td>
    <td>Abychom věděli, co je na webu srozumitelné a co ne, a uměli navázat na to, co už jste viděli.</td>
    <td>Oprávněný zájem (čl. 6 odst. 1 písm. f) — vědět, jak web funguje</td></tr>
<tr><td><b>Videohovor</b><br>obraz a zvuk po dobu hovoru</td>
    <td>Abychom schůzku mohli vést na dálku. Hovor nenahráváme, pokud se na tom předem nedomluvíme.</td>
    <td>Jednání o smlouvě</td></tr>
<tr><td><b>Kontakt z reklamy</b><br>údaje z formuláře na Facebooku, Instagramu nebo Googlu</td>
    <td>Totéž co u poptávky — ozvat se vám.</td>
    <td>Jednání o smlouvě</td></tr>
<tr><td><b>Telefonát na infolinku</b><br>telefonní číslo, obsah hovoru, přepis</td>
    <td>Abychom vyřešili, s čím voláte, a předali to servisu. O nahrávání vás upozorníme na začátku hovoru.</td>
    <td>Oprávněný zájem — doložitelnost a kvalita služby</td></tr>
</tbody></table></div>
<p>Citlivé údaje (zdraví, přesvědčení a podobně) nezpracováváme a nechceme je po vás. Nerozhodujeme
o vás automatizovaně — za každým rozhodnutím na naší straně je člověk.</p>

<h2><span>3.</span>Cookies a měření</h2>
<p>Používáme jen cookies, bez kterých by web nefungoval, a jedno vlastní měření návštěvnosti. Žádné
reklamní ani sledovací cookies třetích stran na webu nemáme, takže vás neotravujeme lištou se souhlasem.</p>
<div class="tw"><table>
<thead><tr><th>Cookie</th><th>K čemu</th><th>Jak dlouho</th></tr></thead>
<tbody>
<tr><td>lm_sid</td><td>Anonymní označení prohlížeče, aby se návštěvy nepočítaly pořád dokola jako nové.</td><td>1 rok</td></tr>
<tr><td>lm_tl</td><td>Označení z jedinečného odkazu, který jsme vám poslali — poznáme, že jste to vy.</td><td>1 rok</td></tr>
<tr><td>lm_acc</td><td>Přihlášení k účtu. Vzniká, jen když se přihlásíte.</td><td>30 dní</td></tr>
</tbody></table></div>
<p>Cookies můžete kdykoli smazat v nastavení prohlížeče. Web pak bude fungovat dál, jen se budete
muset znovu přihlásit a nebudeme vědět, že jste tu už byli.</p>

<h2><span>4.</span>Komu se údaje dostanou</h2>
<p>Nikomu je neprodáváme a nepředáváme je k cizímu marketingu. Pracují pro nás ale dodavatelé,
bez kterých bychom web a komunikaci neprovozovali — ti je zpracovávají jen podle našich pokynů:</p>
<ul>
<li>provozovatel serverů, na kterých web a náš systém běží,</li>
<li>odesílatel e-mailů a SMS zpráv,</li>
<li>poskytovatel služby pro videohovory,</li>
<li>poskytovatel AI, která pomáhá vyřídit hovor na infolince,</li>
<li>provozovatelé reklamních platforem, pokud jste nám údaje dali přes jejich formulář.</li>
</ul>
<p>Část z nich sídlí mimo Evropskou unii, především ve Spojených státech. Předání kryjí standardní
smluvní doložky schválené Evropskou komisí, případně rozhodnutí o odpovídající ochraně.</p>
<p>Údaje předáme i státním orgánům, pokud nám to uloží zákon.</p>

<h2><span>5.</span>Jak dlouho si je necháme</h2>
<ul>
<li><b>Poptávka, u které z jednání nic nebude</b> — 2 roky od posledního kontaktu. Pak je smažeme.</li>
<li><b>Rezervace a průběh schůzek</b> — 2 roky od schůzky.</li>
<li><b>Účet na webu</b> — dokud ho máte. Po zrušení účtu údaje do 30 dní smažeme.</li>
<li><b>Měření pohybu po webu</b> — 14 měsíců.</li>
<li><b>Záznamy a přepisy hovorů na infolince</b> — 6 měsíců.</li>
<li><b>Údaje k uzavřené smlouvě</b> — po dobu, kterou ukládá zákon (účetnictví 10 let, promlčecí lhůty).</li>
</ul>

<h2><span>6.</span>Co s tím můžete dělat</h2>
<p>Ze zákona máte právo:</p>
<ul>
<li>vědět, jaké údaje o vás máme, a dostat jejich kopii,</li>
<li>nechat si je opravit, když nesedí,</li>
<li>nechat si je vymazat, pokud je už nepotřebujeme,</li>
<li>omezit, co s nimi smíme dělat,</li>
<li>dostat je ve strojově čitelné podobě a přenést je jinam,</li>
<li><b>vznést námitku proti zpracování z oprávněného zájmu</b> — tedy proti měření pohybu po webu,</li>
<li>kdykoli odvolat souhlas tam, kde jsme na něm zpracování postavili (odvolání nemá vliv na to, co proběhlo předtím).</li>
</ul>
<p>Stačí napsat na <a href="mailto:${SPRAVCE.email}">${SPRAVCE.email}</a>. Ozveme se nejpozději do měsíce.
Abychom údaje nevydali někomu cizímu, můžeme vás požádat, abyste prokázali, že jste to opravdu vy.</p>
<p>Když budete mít pocit, že s údaji nakládáme špatně, můžete si stěžovat u
<a href="https://www.uoou.cz" target="_blank" rel="noopener">Úřadu pro ochranu osobních údajů</a>,
Pplk. Sochora 27, 170 00 Praha 7. Budeme ale rádi, když to nejdřív zkusíte s námi.</p>

<h2><span>7.</span>Bezpečnost</h2>
<p>Spojení s webem je šifrované. Hesla ukládáme jen jako nevratný otisk, takže je neznáme ani my.
K údajům se dostanou jen lidé, kteří je k práci potřebují, a přístup do našeho systému je chráněn
dvoufázovým ověřením.</p>

<h2><span>8.</span>Změny</h2>
<p>Když se způsob zpracování změní, upravíme i tuhle stránku a změníme datum účinnosti nahoře.
U podstatné změny vás upozorníme e-mailem, pokud na vás kontakt máme.</p>

<div class="foot">${SPRAVCE.nazev} · IČO ${SPRAVCE.ico} · ${SPRAVCE.adresa} · <a href="mailto:${SPRAVCE.email}">${SPRAVCE.email}</a></div>
</div>
<script>
// „zpět" má vrátit tam, odkud člověk přišel — ne natvrdo na začátek cesty.
// Když předchozí stránka na našem webu není (otevřeno z e-mailu, z nové karty),
// zůstane odkaz na /cesta, aby nevedl do prázdna.
(function(){var a=document.getElementById('zpet');if(!a)return;
  var r=document.referrer||'';var vlastni=false;
  try{vlastni=!!r&&new URL(r).origin===location.origin&&new URL(r).pathname!==location.pathname;}catch(e){}
  if(!vlastni)return;
  a.setAttribute('href',r);
  a.addEventListener('click',function(e){if(history.length>1){e.preventDefault();history.back();}});
})();
</script>
</body></html>`;
}

module.exports = { page, SPRAVCE, UCINNOST };
