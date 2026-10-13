// BS2 — Obchodní podmínky a informace o zpracování osobních údajů pro produkty
// „Prověření lokality" a „Vyhledávač míst" (balíčky Základ / Plus / Premium, dokoupení
// vyhodnocení a vyhledání, přechod na vyšší balíček). Zobrazují se na /location/vop a /location/gdpr
// a odkazují se z každé platby (prodejní stránka i nákupy v aplikaci).

const TERMS_VERSION = 'loc-2026-10'; // verze podmínek uložená k objednávce

const LOC_VOP_HTML = `<h1>OBCHODNÍ PODMÍNKY</h1>
<p>aplikací <b>Prověření lokality</b> a <b>Vyhledávač míst</b> provozovaných na adrese www.bestseries2.cz (dále jen „Podmínky“)</p>
<p class="small">Verze ${TERMS_VERSION} · účinné od 14. 10. 2026</p>

<h3>1. POSKYTOVATEL A PŘEDMĚT PODMÍNEK</h3>
<p><b>1.1.</b> Poskytovatelem je společnost <b>BEST SERIES s.r.o.</b>, IČO 05643724, se sídlem Zámostní 1155/27, Slezská Ostrava, 710 00 Ostrava, zapsaná v obchodním rejstříku vedeném Krajským soudem v Ostravě (dále jen „Poskytovatel“). Kontakt: tomas.holy@bestseries.cz, www.bestseries2.cz.</p>
<p><b>1.2.</b> Podmínky upravují práva a povinnosti mezi Poskytovatelem a osobou, která si objedná přístup do webových aplikací Prověření lokality a Vyhledávač míst (dále jen „Aplikace“) nebo doplňkové služby k nim (dále jen „Zákazník“). Podmínky doplňují Všeobecné obchodní podmínky aplikace Best Series 2.0; v případě rozporu mají pro Aplikace přednost tyto Podmínky.</p>
<p><b>1.3.</b> Aplikace jsou digitální obsah a služba poskytovaná online. Nejsou poradenstvím ve smyslu zvláštních právních předpisů, nejsou znaleckým posudkem ani odborným schválením investice.</p>

<h3>2. CO SI ZÁKAZNÍK OBJEDNÁVÁ</h3>
<p><b>2.1. Balíčky přístupu</b> (ceny včetně DPH, jednorázově):</p>
<ul>
<li><b>Základ – 4 900 Kč:</b> přístup do Aplikací na 12 měsíců, vyhodnocení 3 lokalit, 1 vyhledání ve Vyhledávači míst, export studie do PDF.</li>
<li><b>Plus – 9 900 Kč:</b> přístup na 12 měsíců, vyhodnocení 10 lokalit, 2 vyhledání, porovnání lokalit, jeden 30minutový konzultační hovor.</li>
<li><b>Premium – 15 900 Kč:</b> vše z Plus, 3 vyhledání a místní šetření technikem Poskytovatele na jedné lokalitě v České republice se zprávou v Aplikaci.</li>
</ul>
<p><b>2.2. Doplňkové služby</b> (ceny včetně DPH): dokoupení vyhodnocení lokality (1 ks 999 Kč, 3 ks 1 999 Kč, 10 ks 4 999 Kč), dokoupení vyhledání (1 ks 499 Kč, 3 ks 999 Kč, 10 ks 2 999 Kč) a přechod na vyšší balíček za doplatek rozdílu cen balíčků. Dokoupené položky se připisují k účtu Zákazníka a lze je čerpat po dobu platnosti přístupu; platnost přístupu se dokoupením ani přechodem neprodlužuje.</p>
<p><b>2.3. Čerpání.</b> Vyhodnocení lokality se odečte v okamžiku prvního vyhodnocení dané lokality; každou lokalitu lze vyhodnotit jen jednou, úpravy údajů a ukládání jsou neomezené. Vyhledání se odečte při první analýze daného města nebo bodu v mapě; k uloženým výsledkům se Zákazník vrací bez dalšího odečtu. Nevyčerpané položky po skončení platnosti přístupu propadají bez nároku na vrácení ceny.</p>
<p><b>2.4. Místní šetření (Premium)</b> se uskuteční na lokalitě v ČR v termínu dohodnutém se Zákazníkem, zpravidla do 30 dnů od sdělení lokality. Zpráva z šetření je informativní a nenahrazuje stavební, právní ani technický průzkum.</p>

<h3>3. OBJEDNÁVKA, UZAVŘENÍ SMLOUVY A PLATBA</h3>
<p><b>3.1.</b> Smlouva je uzavřena okamžikem úspěšného zaplacení objednávky. Platby probíhají kartou prostřednictvím platební brány Stripe; Poskytovatel nemá přístup k údajům o platební kartě. Daňový doklad je Zákazníkovi zaslán elektronicky na uvedený e-mail.</p>
<p><b>3.2.</b> Přístup je zpřístupněn automaticky po připsání platby: Zákazníkovi je založen účet v Best Series 2.0 (nebo rozšířen stávající) a zaslán aktivační e-mail. Zákazník si zvolí přihlašovací jméno a heslo a je povinen je chránit před zneužitím; přístup je určen pouze pro Zákazníka a nelze jej sdílet ani přeprodávat.</p>
<p><b>3.3.</b> Ceny jsou uvedeny včetně DPH. Poskytovatel je oprávněn ceny měnit; pro již zaplacené objednávky platí cena v okamžiku objednávky.</p>

<h3>4. ODSTOUPENÍ OD SMLOUVY A VRÁCENÍ PENĚZ</h3>
<p><b>4.1.</b> Zákazník, který je spotřebitelem, má právo odstoupit od smlouvy uzavřené na dálku do 14 dnů od jejího uzavření. <b>Zákazník však výslovně žádá, aby mu byl digitální obsah a přístup do Aplikací zpřístupněn ihned po zaplacení, tj. před uplynutím lhůty pro odstoupení, a bere na vědomí, že tím podle § 1837 písm. l) a m) občanského zákoníku ztrácí právo od smlouvy odstoupit</b> v rozsahu již zpřístupněného obsahu a čerpaných služeb. Tento souhlas Zákazník vyjadřuje zaškrtnutím příslušného políčka před platbou.</p>
<p><b>4.2.</b> Pokud Zákazník do okamžiku odstoupení nečerpal žádné vyhodnocení, vyhledání ani místní šetření, Poskytovatel mu na žádost zaslanou na tomas.holy@bestseries.cz do 14 dnů od zaplacení vrátí cenu v plné výši. Částečně čerpaný balíček se nevrací; dokoupené položky a doplatky za přechod na vyšší balíček se po zpřístupnění nevracejí.</p>
<p><b>4.3.</b> Poskytovatel může ukončit přístup Zákazníkovi, který Podmínky závažně poruší (zejména sdílení přístupu, automatizované vytěžování, pokusy o narušení Aplikací); v takovém případě nevzniká nárok na vrácení ceny.</p>

<h3>5. POVAHA VÝSTUPŮ A ODPOVĚDNOST</h3>
<p><b>5.1.</b> Výstupy Aplikací (vyhodnocení, studie, spádovost, kapacita, seznam míst, kontakty, ekonomické scénáře) jsou <b>orientační</b>. Vznikají automatizovaně z veřejně dostupných dat (mapová data OpenStreetMap a ČÚZK, GeoNames, veřejné rejstříky a weby), z údajů zadaných Zákazníkem a z interní metodiky Poskytovatele; při sestavování studie a dohledávání kontaktů je využita umělá inteligence. Data mohou být neúplná, nepřesná nebo zastaralá a Zákazník je povinen je před rozhodnutím ověřit.</p>
<p><b>5.2.</b> Výstupy nejsou příslibem ani zárukou výnosu, návštěvnosti či vhodnosti místa a nejsou nabídkou na prodej prádlomatu. Rozhodnutí Poskytovatele o prodeji stroje na konkrétní místo je samostatný krok nezávislý na výsledku Aplikací. Výsledky jiných lokalit nejsou zárukou výsledků lokality Zákazníka.</p>
<p><b>5.3.</b> Poskytovatel neodpovídá za rozhodnutí učiněná na základě výstupů, za ušlý zisk ani za škody vzniklé z dočasné nedostupnosti Aplikací nebo externích datových zdrojů. Odpovědnost Poskytovatele za škodu je omezena do výše ceny zaplacené Zákazníkem za dotčenou službu, nejde-li o škodu způsobenou úmyslně nebo z hrubé nedbalosti.</p>
<p><b>5.4.</b> Kontakty na provozovatele míst jsou dohledány z veřejných zdrojů a slouží výhradně k jednání o pronájmu plochy pro prádlomat. Zákazník je povinen je používat v souladu s právními předpisy, zejména nezasílat nevyžádaná obchodní sdělení.</p>

<h3>6. DOSTUPNOST A ZMĚNY APLIKACÍ</h3>
<p><b>6.1.</b> Poskytovatel usiluje o dostupnost Aplikací 24 hodin denně, nezaručuje ji však. Aplikace využívají externí služby (mapové servery, platební brána, AI služby), jejichž výpadek může funkce dočasně omezit.</p>
<p><b>6.2.</b> Poskytovatel je oprávněn Aplikace rozvíjet, měnit jejich vzhled a funkce a upravovat metodiku výpočtů; podstatné změny neomezí již zaplacený rozsah služeb.</p>

<h3>7. DUŠEVNÍ VLASTNICTVÍ A UŽITÍ VÝSTUPŮ</h3>
<p><b>7.1.</b> Aplikace, jejich metodika, design a texty jsou chráněny autorským právem Poskytovatele. Zákazník získává nevýhradní, nepřenosné právo Aplikace užívat po dobu platnosti přístupu.</p>
<p><b>7.2.</b> Studie a výstupy ke svým lokalitám může Zákazník užívat pro vlastní potřebu, včetně předložení bance, společníkovi nebo pronajímateli. Není dovoleno výstupy hromadně kopírovat, dále prodávat nebo vydávat za vlastní poradenskou službu.</p>

<h3>8. REKLAMACE A ŘEŠENÍ SPORŮ</h3>
<p><b>8.1.</b> Reklamace (nefunkčnost Aplikací, nepřipsání zaplacených položek) uplatní Zákazník na tomas.holy@bestseries.cz nebo přes Podporu v aplikaci. Poskytovatel reklamaci vyřídí bez zbytečného odkladu, nejpozději do 30 dnů.</p>
<p><b>8.2.</b> Spotřebitel má právo na mimosoudní řešení sporu u České obchodní inspekce (www.coi.cz) nebo prostřednictvím platformy ODR (ec.europa.eu/consumers/odr). Dozorovým orgánem je Česká obchodní inspekce a příslušný živnostenský úřad.</p>

<h3>9. ZÁVĚREČNÁ USTANOVENÍ</h3>
<p><b>9.1.</b> Právní vztahy se řídí právem České republiky, zejména zákonem č. 89/2012 Sb., občanským zákoníkem, a zákonem č. 634/1992 Sb., o ochraně spotřebitele.</p>
<p><b>9.2.</b> Informace o zpracování osobních údajů jsou uvedeny v samostatném dokumentu <a href="/location/gdpr">Ochrana osobních údajů</a>.</p>
<p><b>9.3.</b> Poskytovatel může Podmínky měnit; nové znění je účinné zveřejněním na www.bestseries2.cz/location/vop a vztahuje se na objednávky učiněné po tomto datu. Zákazník vyjadřuje souhlas s Podmínkami zaškrtnutím políčka před každou platbou; verze Podmínek je uložena k objednávce.</p>`;

const LOC_GDPR_HTML = `<h1>OCHRANA OSOBNÍCH ÚDAJŮ</h1>
<p>informace o zpracování osobních údajů v aplikacích <b>Prověření lokality</b> a <b>Vyhledávač míst</b> podle čl. 13 nařízení (EU) 2016/679 (GDPR)</p>
<p class="small">Verze ${TERMS_VERSION} · účinné od 14. 10. 2026</p>

<h3>1. SPRÁVCE</h3>
<p>Správcem osobních údajů je <b>BEST SERIES s.r.o.</b>, IČO 05643724, Zámostní 1155/27, Slezská Ostrava, 710 00 Ostrava. Kontakt pro záležitosti ochrany osobních údajů: tomas.holy@bestseries.cz.</p>

<h3>2. JAKÉ ÚDAJE ZPRACOVÁVÁME</h3>
<ul>
<li><b>Identifikační a kontaktní údaje:</b> jméno a příjmení, e-mail, telefon, firma / IČO (uvedete-li je), přihlašovací jméno.</li>
<li><b>Údaje o objednávkách a platbách:</b> zvolený balíček a doplňkové služby, částka, datum, stav platby, identifikátor platby v systému Stripe (údaje o kartě zpracovává výhradně Stripe).</li>
<li><b>Údaje zadané v aplikacích:</b> názvy a adresy lokalit, poloha v mapě, zakreslené body v okolí, údaje o nájmu, přípojkách, investici a financování, poznámky, vyhledávaná města nebo body v mapě.</li>
<li><b>Výstupy aplikací:</b> vyhodnocení, studie, výsledky vyhledávání, dohledané kontakty na provozovatele míst (z veřejných zdrojů).</li>
<li><b>Technické a provozní údaje:</b> IP adresa, typ prohlížeče, čas přihlášení, záznamy o použití funkcí a o chybách, cookies nezbytné pro přihlášení a bezpečnost.</li>
<li><b>Komunikace:</b> zprávy zaslané přes Podporu, e-maily, nápady na vylepšení.</li>
</ul>

<h3>3. ÚČELY A PRÁVNÍ ZÁKLADY</h3>
<ul>
<li><b>Uzavření a plnění smlouvy</b> (čl. 6 odst. 1 písm. b GDPR): vyřízení objednávky, založení účtu, zpřístupnění aplikací, zpracování lokalit a sestavení studií, místní šetření, dokoupení položek, podpora.</li>
<li><b>Plnění právních povinností</b> (čl. 6 odst. 1 písm. c): vystavení a archivace daňových dokladů, účetnictví.</li>
<li><b>Oprávněný zájem</b> (čl. 6 odst. 1 písm. f): zabezpečení aplikací, prevence zneužití, zlepšování funkcí na základě anonymizovaných statistik, vymáhání nároků.</li>
<li><b>Souhlas</b> (čl. 6 odst. 1 písm. a): zasílání informací o prádlomatech a novinkách Best Series e-mailem, pokud jej udělíte; souhlas lze kdykoli odvolat odkazem v e-mailu nebo na kontaktní adrese.</li>
</ul>

<h3>4. PŘÍJEMCI A ZPRACOVATELÉ</h3>
<p>Údaje předáváme pouze v nezbytném rozsahu těmto zpracovatelům a příjemcům:</p>
<ul>
<li><b>Stripe Payments Europe, Ltd.</b> – platební brána (platby kartou, daňové doklady).</li>
<li><b>Railway Corp.</b> – hosting aplikací a databáze (EU/USA, standardní smluvní doložky).</li>
<li><b>Anthropic, PBC</b> – AI služby pro sestavení studie lokality a dohledání kontaktů; předávají se údaje o lokalitě (adresa, poloha, zadané parametry) bez identifikace Zákazníka.</li>
<li><b>Microsoft Ireland Operations Ltd.</b> – e-mailová komunikace (Microsoft 365).</li>
<li><b>Cloudflare, Inc.</b> – doručování obsahu a ochrana webu.</li>
<li>Poskytovatelé mapových a datových služeb (OpenStreetMap / Overpass, ČÚZK, GeoNames, Nominatim) – obdrží pouze souřadnice či název obce, nikoli identitu Zákazníka.</li>
<li>Orgány veřejné moci, vyžaduje-li to zákon; účetní a právní poradci Správce.</li>
</ul>
<p>Údaje nejsou prodávány třetím stranám ani využívány k automatizovanému rozhodování s právními účinky pro Zákazníka.</p>

<h3>5. DOBA UCHOVÁNÍ</h3>
<ul>
<li>Účet, lokality, studie a výsledky vyhledávání: po dobu platnosti přístupu a dalších 24 měsíců, aby bylo možné přístup obnovit; poté anonymizace nebo výmaz.</li>
<li>Objednávky a daňové doklady: 10 let (zákonná archivace).</li>
<li>Technické logy: zpravidla 90 dnů.</li>
<li>Marketingový souhlas: do odvolání, nejdéle 5 let od posledního kontaktu.</li>
</ul>

<h3>6. VAŠE PRÁVA</h3>
<p>Máte právo na přístup k údajům, jejich opravu, výmaz, omezení zpracování, přenositelnost, právo vznést námitku proti zpracování z oprávněného zájmu a právo odvolat souhlas. Žádosti vyřizujeme na tomas.holy@bestseries.cz do 30 dnů. Máte rovněž právo podat stížnost u Úřadu pro ochranu osobních údajů (www.uoou.cz).</p>

<h3>7. COOKIES A ZABEZPEČENÍ</h3>
<p>Aplikace používají pouze technické cookies nezbytné pro přihlášení, ochranu formulářů a bezpečnost; analytické a marketingové cookies nepoužíváme. Data jsou přenášena šifrovaně (HTTPS), hesla ukládáme pouze v podobě bezpečného otisku, přístup k datům mají jen pověřené osoby Správce.</p>

<h3>8. KONTAKTY TŘETÍCH OSOB</h3>
<p>Aplikace Vyhledávač míst zobrazuje veřejně dostupné kontaktní údaje provozovatelů míst (firma, telefon, e-mail, web, případně kontaktní osoba z veřejných firemních zdrojů). Zákazník je při jejich použití samostatným správcem a odpovídá za to, že je využije pouze k jednání o pronájmu plochy a v souladu s GDPR a zákonem o některých službách informační společnosti.</p>`;

module.exports = { TERMS_VERSION, LOC_VOP_HTML, LOC_GDPR_HTML };
