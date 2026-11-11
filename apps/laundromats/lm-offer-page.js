// Laundromats — veřejná stránka obchodního návrhu pro korporát (/nabidka/<token>).
// Prezentační landing: video, o co jde, co prádlomat umí, přínosy (firma / zákazníci / značka), reference,
// pilotní projekt, ekonomika s grafem, video „jak se používá", CTA. Text dopisu je jen v e-mailu.
'use strict';
const { layout, esc } = require('./lm-layout');

const T = {
  cs: {
    kick: 'Obchodní návrh', for: 'pro', valid: 'Platnost návrhu do',
    heroSub: (c) => `Samoobslužná prádelna přímo u vašich prodejen — provozovaná pod značkou ${c}, dodaná a spravovaná na klíč.`,
    chips: ['24/7 bez obsluhy', 'Pod vaší značkou', 'Dodání a servis na klíč', 'Ryze český výrobek'],
    ctaTop: 'Domluvit 20min schůzku', scroll: 'Podívat se, o co jde',
    whatH: 'O co jde', whatSub: 'Zákazník vypere a usuší během jednoho nákupu.',
    steps: [['🛒', 'Přijede na nákup', 'Prádlo vloží do prádlomatu u prodejny — trvá to minutu.'], ['🧺', 'Nakoupí', 'Praní 30–40 minut, sušení navazuje automaticky. Stav vidí v mobilu.'], ['✨', 'Odjede s čistým prádlem', 'Suché, voňavé prádlo vyzvedne cestou k autu.']],
    canH: 'Co prádlomat umí', canSub: 'Kompaktní venkovní kontejner — stačí malá volná plocha u prodejny a přípojka vody, kanalizace a elektřiny.',
    can: [['🫧', 'Pračky 8 kg a 18 kg', 'Běžné prádlo i peřiny, deky, pracovní oděvy.'], ['🌀', 'Sušička 18 kg', 'Usuší celou várku během nákupu.'], ['💳', 'Bezhotovostní platby', 'Karta, Apple Pay, Google Pay, věrnostní program.'], ['📡', 'Vzdálený dohled', 'Monitoring a diagnostika 24/7, servis často na dálku.'], ['🌙', 'Provoz 24/7', 'Bez personálu, bez zásahu do chodu prodejny.'], ['🏷️', 'Vaše značka', 'Polep, barvy i aplikace v identitě obchodní značky.']],
    models: 'Varianty prádlomatu',
    benH: 'Co pilotní projekt přinese',
    ben: (c) => [['🏪', `Pro ${c}`, ['Nový, stabilní zdroj tržeb z volné plochy u prodejny, která dnes nevydělává.', 'Vyšší a pravidelnější návštěvnost — zákazník přijede dvakrát (prádlo + vyzvednutí).', 'Delší čas v prodejně = vyšší útrata.', 'Žádný personál, provoz a servis na klíč.']], ['🙂', 'Pro zákazníky', ['Vyprat a usušit během nákupu — ušetřený čas.', 'Velké kusy (peřiny, deky), na které doma není pračka.', 'Dostupné 24/7, platba kartou i mobilem.', 'Služba navíc v místě, kam stejně jezdí.']], ['⭐', 'Pro značku', ['Inovativní služba, která odliší síť prodejen od konkurence.', 'Udržitelnost — úsporné stroje, ekologické prací prostředky.', 'Viditelný branding u prodejny, 24 hodin denně.', 'Data o využití a spokojenosti zákazníků.']]],
    refH: 'Funguje to už jinde', refSub: 'Prádlomaty provozujeme u čerpacích stanic a obchodních center v Česku i v zahraničí.',
    pilotH: 'Pilotní projekt', pilotSub: 'Jak bychom začali — konkrétní podmínky doladíme společně.',
    ecoH: 'Ekonomika pilotu', ecoSub: 'Orientační čísla — ekonomiku ověříme podle konkrétních lokalit.',
    units: 'Počet prádlomatů', inv: 'Investice celkem', unit: 'cena za prádlomat', mon: 'Čistý výsledek / měsíc', monU: 'na prádlomat', pay: 'Návratnost', months: 'měsíců', y5: 'Výsledek za 10 let', chart: 'Kumulovaný výsledek pilotu (orientačně)', start: 'start', yr: 'rok', vat: 'Ceny bez DPH. Nejde o garantovaný výsledek — odvozeno z provozu existujících prádlomatů.', model: 'Model',
    vidH: 'Jak se prádlomat používá', vid1: 'Prádlomat v provozu', vid2: 'Krok za krokem',
    ctaH: 'Pojďme to probrat — 20 minut stačí', ctaSub: 'Ukážeme investiční i provozní model a navrhneme vhodné lokality pro pilot.', cta: 'Mám zájem — domluvit schůzku', name: 'Jméno a příjmení', phone: 'Telefon', email: 'E-mail', note: 'Poznámka (nepovinné)', send: 'Odeslat', thanks: 'Děkujeme! Ozveme se do jednoho pracovního dne a domluvíme termín.', done: 'Zájem jsme už zaznamenali — děkujeme.', err: 'Nepodařilo se odeslat. Zkuste to prosím znovu.', contact: 'Kontakt', write: 'Napsat e-mail',
  },
  en: {
    kick: 'Business proposal', for: 'for', valid: 'Valid until',
    heroSub: (c) => `A self-service laundry right at your stores — operated under the ${c} brand, delivered and managed turnkey.`,
    chips: ['24/7, unstaffed', 'Under your brand', 'Turnkey delivery & service', 'Made in Czechia'],
    ctaTop: 'Book a 20-minute meeting', scroll: 'See how it works',
    whatH: 'What it is', whatSub: 'Customers wash and dry their laundry during a single shopping trip.',
    steps: [['🛒', 'Arrive to shop', 'Load the laundry into the machine by the store — takes a minute.'], ['🧺', 'Do the shopping', 'Washing takes 30–40 minutes, drying follows automatically. Status on the phone.'], ['✨', 'Leave with clean laundry', 'Pick up dry, fresh laundry on the way to the car.']],
    canH: 'What the laundromat does', canSub: 'A compact outdoor container — needs only a small free area by the store plus water, sewage and power connections.',
    can: [['🫧', '8 kg and 18 kg washers', 'Everyday laundry plus duvets, blankets, workwear.'], ['🌀', '18 kg dryer', 'Dries a full load during the shopping trip.'], ['💳', 'Cashless payments', 'Card, Apple Pay, Google Pay, loyalty programme.'], ['📡', 'Remote monitoring', '24/7 monitoring and diagnostics, much of the service done remotely.'], ['🌙', 'Open 24/7', 'No staff, no impact on store operations.'], ['🏷️', 'Your brand', 'Wrap, colours and app in your retail brand identity.']],
    models: 'Laundromat variants',
    benH: 'What the pilot delivers',
    ben: (c) => [['🏪', `For ${c}`, ['A new, stable revenue stream from free space by the store that earns nothing today.', 'Higher, more regular footfall — customers come twice (drop-off + pick-up).', 'Longer time in store = bigger basket.', 'No staff; operations and service turnkey.']], ['🙂', 'For customers', ['Wash and dry while shopping — time saved.', 'Large items (duvets, blankets) that don’t fit a home machine.', 'Available 24/7, card and mobile payments.', 'An extra service where they already shop.']], ['⭐', 'For the brand', ['An innovative service that sets the store network apart.', 'Sustainability — efficient machines, eco detergents.', 'Visible branding by the store, 24 hours a day.', 'Data on usage and customer satisfaction.']]],
    refH: 'Already working elsewhere', refSub: 'We operate laundromats at petrol stations and shopping centres in Czechia and abroad.',
    pilotH: 'Pilot project', pilotSub: 'How we would start — details to be agreed together.',
    ecoH: 'Pilot economics', ecoSub: 'Indicative figures — to be validated for the specific locations.',
    units: 'Number of machines', inv: 'Total investment', unit: 'per machine', mon: 'Net result / month', monU: 'per machine', pay: 'Payback', months: 'months', y5: '10-year result', chart: 'Cumulative pilot result (indicative)', start: 'start', yr: 'year', vat: 'Prices excl. VAT. Not a guaranteed result — derived from existing operations.', model: 'Model',
    vidH: 'How it is used', vid1: 'Laundromat in operation', vid2: 'Step by step',
    ctaH: "Let's talk — 20 minutes is enough", ctaSub: 'We will present the investment and operating model and propose suitable pilot locations.', cta: "I'm interested — book a meeting", name: 'Full name', phone: 'Phone', email: 'E-mail', note: 'Note (optional)', send: 'Send', thanks: 'Thank you! We will get back to you within one business day.', done: 'Your interest has already been recorded — thank you.', err: 'Sending failed. Please try again.', contact: 'Contact', write: 'Write an e-mail',
  },
  pl: {
    kick: 'Propozycja biznesowa', for: 'dla', valid: 'Ważna do',
    heroSub: (c) => `Pralnia samoobsługowa tuż przy Państwa sklepach — pod marką ${c}, dostarczona i obsługiwana pod klucz.`,
    chips: ['24/7 bez obsługi', 'Pod Państwa marką', 'Dostawa i serwis pod klucz', 'Czeski produkt'],
    ctaTop: 'Umówić 20-minutowe spotkanie', scroll: 'Zobacz, jak to działa',
    whatH: 'Na czym to polega', whatSub: 'Klient pierze i suszy pranie podczas jednych zakupów.',
    steps: [['🛒', 'Przyjeżdża na zakupy', 'Wkłada pranie do urządzenia przy sklepie — to minuta.'], ['🧺', 'Robi zakupy', 'Pranie 30–40 minut, suszenie automatycznie. Status w telefonie.'], ['✨', 'Wraca z czystym praniem', 'Odbiera suche, pachnące pranie w drodze do auta.']],
    canH: 'Co potrafi urządzenie', canSub: 'Kompaktowy kontener zewnętrzny — wystarczy niewielka wolna powierzchnia przy sklepie i przyłącze wody, kanalizacji i prądu.',
    can: [['🫧', 'Pralki 8 kg i 18 kg', 'Codzienne pranie oraz kołdry, koce, odzież robocza.'], ['🌀', 'Suszarka 18 kg', 'Suszy cały wsad w trakcie zakupów.'], ['💳', 'Płatności bezgotówkowe', 'Karta, Apple Pay, Google Pay, program lojalnościowy.'], ['📡', 'Zdalny nadzór', 'Monitoring i diagnostyka 24/7, serwis często zdalnie.'], ['🌙', 'Czynne 24/7', 'Bez personelu, bez wpływu na pracę sklepu.'], ['🏷️', 'Państwa marka', 'Oklejenie, kolory i aplikacja w identyfikacji marki.']],
    models: 'Warianty urządzenia',
    benH: 'Co da projekt pilotażowy',
    ben: (c) => [['🏪', `Dla ${c}`, ['Nowe, stabilne źródło przychodu z wolnej powierzchni przy sklepie.', 'Wyższy i regularniejszy ruch — klient przyjeżdża dwa razy.', 'Dłuższy czas w sklepie = większy koszyk.', 'Bez personelu, obsługa i serwis pod klucz.']], ['🙂', 'Dla klientów', ['Pranie i suszenie w trakcie zakupów — oszczędność czasu.', 'Duże rzeczy (kołdry, koce), które nie mieszczą się w domowej pralce.', 'Dostępne 24/7, płatność kartą i telefonem.', 'Dodatkowa usługa tam, gdzie i tak robią zakupy.']], ['⭐', 'Dla marki', ['Innowacyjna usługa wyróżniająca sieć sklepów.', 'Zrównoważony rozwój — oszczędne urządzenia, ekologiczne środki.', 'Widoczny branding przy sklepie, 24 godziny na dobę.', 'Dane o wykorzystaniu i zadowoleniu klientów.']]],
    refH: 'To już działa gdzie indziej', refSub: 'Prowadzimy pralnie przy stacjach paliw i centrach handlowych w Czechach i za granicą.',
    pilotH: 'Projekt pilotażowy', pilotSub: 'Jak byśmy zaczęli — szczegóły ustalimy wspólnie.',
    ecoH: 'Ekonomika pilotażu', ecoSub: 'Liczby orientacyjne — do weryfikacji dla konkretnych lokalizacji.',
    units: 'Liczba urządzeń', inv: 'Inwestycja łącznie', unit: 'za urządzenie', mon: 'Wynik netto / miesiąc', monU: 'na urządzenie', pay: 'Zwrot', months: 'miesięcy', y5: 'Wynik za 10 lat', chart: 'Skumulowany wynik pilotażu (orientacyjnie)', start: 'start', yr: 'rok', vat: 'Ceny netto. To nie jest gwarantowany wynik — na podstawie istniejących punktów.', model: 'Model',
    vidH: 'Jak się z tego korzysta', vid1: 'Urządzenie w działaniu', vid2: 'Krok po kroku',
    ctaH: 'Porozmawiajmy — wystarczy 20 minut', ctaSub: 'Przedstawimy model inwestycyjny i operacyjny oraz zaproponujemy lokalizacje pilotażu.', cta: 'Jestem zainteresowany — umówić spotkanie', name: 'Imię i nazwisko', phone: 'Telefon', email: 'E-mail', note: 'Uwagi (opcjonalnie)', send: 'Wyślij', thanks: 'Dziękujemy! Odezwiemy się w ciągu jednego dnia roboczego.', done: 'Twoje zainteresowanie zostało już zapisane — dziękujemy.', err: 'Nie udało się wysłać. Spróbuj ponownie.', contact: 'Kontakt', write: 'Napisz e-mail',
  },
};
// Výchozí reference (v administraci jde přepsat: každý řádek „Název | popis | obrázek")
const REFS = {
  cs: 'ORLEN | Prádlomaty u čerpacích stanic — zákazník vypere během tankování a nákupu. | /media/provozovna-1.webp\nM Core | Prádlomat u obchodního centra — služba navíc pro návštěvníky nákupní zóny. | /media/provozovna-2.webp\nIrsko | Partnerský provoz u čerpací stanice v zahraničí. | /media/provozovna-3.webp',
  en: 'ORLEN | Laundromats at petrol stations — customers wash while they refuel and shop. | /media/provozovna-1.webp\nM Core | Laundromat at a shopping centre — an extra service for retail-park visitors. | /media/provozovna-2.webp\nIreland | Partner operation at a petrol station abroad. | /media/provozovna-3.webp',
  pl: 'ORLEN | Pralnie przy stacjach paliw — klient pierze podczas tankowania i zakupów. | /media/provozovna-1.webp\nM Core | Pralnia przy centrum handlowym — dodatkowa usługa dla odwiedzających. | /media/provozovna-2.webp\nIrlandia | Partnerski punkt przy stacji paliw za granicą. | /media/provozovna-3.webp',
};

const money = (v, cur) => Math.round(Number(v)).toLocaleString('cs-CZ').replace(/\u00a0/g, ' ') + (cur === 'EUR' ? ' €' : ' Kč');

const ECO2 = {
  cs: { h: 'Ekonomika', oneH: 'Ekonomika jednoho prádlomatu', invT: 'Investice (bez DPH)', est: 'odhad', visits: 'Návštěvnost', perDay: 'zák./den', modT: 'Modelováno na typ FLEX', modS: '— pračka 8 kg, pračka 18 kg a sušička 18 kg. Všechna čísla níže jsou spočítaná pro tuto konfiguraci.', price: 'Cena prádlomatu', conn: 'Přípojky (elektřina, voda, odpad)', connNA: 'dle lokality', warr: (n) => `Prodloužená záruka na ${n + 1} ${n + 1 < 5 ? 'roky' : 'let'} (+${n} × 1 rok)`, invU: 'Investice / prádlomat', opT: 'Měsíční provoz (bez DPH)', sales: 'Tržby', energy: 'Energie — elektřina, voda, odpad (≈ 10 %)', service: 'Kompletní servisní správa vč. detergentů (20 %)', net: 'Čistý výsledek / měsíc', pilotH: (n) => `Ekonomika pilotu — ${n} prádlomatů`, warrNote: (y, m) => `Záruka ze zákona 1 rok. Lze prodloužit až na 5 let — ${y} bez DPH za každý rok navíc, max. 4 × ${y} = ${m}.` },
  en: { h: 'Economics', oneH: 'Economics of one laundromat', invT: 'Investment (excl. VAT)', est: 'estimate', visits: 'Footfall', perDay: 'cust./day', modT: 'Modelled on the FLEX type', modS: '— 8 kg washer, 18 kg washer and 18 kg dryer. All figures below are calculated for this configuration.', price: 'Laundromat price', conn: 'Connections (power, water, drainage)', connNA: 'per location', warr: (n) => `Extended warranty to ${n + 1} years (+${n} × 1 year)`, invU: 'Investment / unit', opT: 'Monthly operation (excl. VAT)', sales: 'Revenue', energy: 'Utilities — power, water, waste (≈ 10 %)', service: 'Full service management incl. detergents (20 %)', net: 'Net result / month', pilotH: (n) => `Pilot economics — ${n} laundromats`, warrNote: (y, m) => `Statutory warranty 1 year. Extendable up to 5 years — ${y} excl. VAT per extra year, max. 4 × ${y} = ${m}.` },
  pl: { h: 'Ekonomika', oneH: 'Ekonomika jednej pralni', invT: 'Inwestycja (netto)', est: 'szacunek', visits: 'Frekwencja', perDay: 'klient./dzień', modT: 'Model oparty na typie FLEX', modS: '— pralka 8 kg, pralka 18 kg i suszarka 18 kg. Wszystkie liczby poniżej dotyczą tej konfiguracji.', price: 'Cena urządzenia', conn: 'Przyłącza (prąd, woda, kanalizacja)', connNA: 'wg lokalizacji', warr: (n) => `Gwarancja przedłużona do ${n + 1} ${n + 1 < 5 ? 'lat' : 'lat'} (+${n} × 1 rok)`, invU: 'Inwestycja / urządzenie', opT: 'Miesięczna eksploatacja (netto)', sales: 'Przychód', energy: 'Media — prąd, woda, ścieki (≈ 10 %)', service: 'Pełna obsługa serwisowa z detergentami (20 %)', net: 'Wynik netto / miesiąc', pilotH: (n) => `Ekonomika pilotażu — ${n} urządzeń`, warrNote: (y, m) => `Gwarancja ustawowa 1 rok. Można przedłużyć do 5 lat — ${y} netto za każdy dodatkowy rok, maks. 4 × ${y} = ${m}.` },
};

const POT = {
  cs: { h: 'Celkový potenciál', sub: (c, n) => `Kdyby se pilot osvědčil: plán na 15 let pro ${n} prodejen ${c}, 1 prádlomat na prodejnu. Výstavba 20 prádlomatů měsíčně, tempo roste o 30 % ročně, dokud se nevyčerpá kapacita.`, mo: 'měsíc', pCap: 'Kapacita (prodejen)', pCapS: '1 prádlomat na prodejnu', pInv: 'Investice celkem', pMon: 'Čistý výsledek / měsíc', pMonS: 'při plné kapacitě', pFull: 'Plná kapacita dosažena', pPay: 'Návratnost celé investice', pTot: 'Výsledek za 15 let', cYear: 'Rok', cAdd: 'Nově postaveno', cTot: 'Prádlomatů celkem', cInv: 'Investice v roce', cNet: 'Čistý výsledek v roce', cCum: 'Kumulativně', fine: 'Orientační plán — počet prodejen vychází z veřejně dostupných informací; skutečný počet vhodných lokalit ověříme společně. Ceny bez DPH.' },
  en: { h: 'Total potential', sub: (c, n) => `If the pilot proves itself: a 15-year plan for ${n} ${c} stores, 1 machine per store. 20 machines built per month, the pace grows 30 % a year until capacity is used up.`, mo: 'month', pCap: 'Capacity (stores)', pCapS: '1 machine per store', pInv: 'Total investment', pMon: 'Net result / month', pMonS: 'at full capacity', pFull: 'Full capacity reached', pPay: 'Payback of the whole investment', pTot: '15-year result', cYear: 'Year', cAdd: 'Newly built', cTot: 'Machines in total', cInv: 'Investment in year', cNet: 'Net result in year', cCum: 'Cumulative', fine: 'Indicative plan — the number of stores is based on publicly available information; the actual number of suitable sites will be verified together. Prices excl. VAT.' },
  pl: { h: 'Łączny potencjał', sub: (c, n) => `Jeśli pilotaż się sprawdzi: plan na 15 lat dla ${n} sklepów ${c}, 1 urządzenie na sklep. Budowa 20 urządzeń miesięcznie, tempo rośnie o 30 % rocznie do wyczerpania pojemności.`, mo: 'miesiąc', pCap: 'Pojemność (sklepy)', pCapS: '1 urządzenie na sklep', pInv: 'Inwestycja łącznie', pMon: 'Wynik netto / miesiąc', pMonS: 'przy pełnej pojemności', pFull: 'Pełna pojemność osiągnięta', pPay: 'Zwrot całej inwestycji', pTot: 'Wynik za 15 lat', cYear: 'Rok', cAdd: 'Nowo zbudowane', cTot: 'Urządzeń łącznie', cInv: 'Inwestycja w roku', cNet: 'Wynik netto w roku', cCum: 'Narastająco', fine: 'Plan orientacyjny — liczba sklepów pochodzi z publicznie dostępnych informacji; faktyczną liczbę odpowiednich lokalizacji zweryfikujemy wspólnie. Ceny netto.' },
};

// Klientský přepočet po úpravě odhadu přípojky (žluté pole)
function ecoScript(d) {
  return '<script>(function(){var D=' + JSON.stringify(d) + ',t=D.t;var esc=function(x){return String(x).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[c];});};'
    + 'var money=' + money.toString() + ';var pilotSim=' + pilotSim.toString() + ';var chartSvg=' + chartSvg.toString() + ';var potSim=' + potSim.toString() + ';var potHtml=' + potHtml.toString() + ';'
    + 'var i=document.getElementById("eco-conn"),v=document.getElementById("eco-vis");if(!i||!v)return;function set(k,x){document.querySelectorAll("[data-k="+k+"]").forEach(function(e){e.textContent=x;});}'
    + 'function nv(){return Math.max(0,Number(String(v.value).replace(/\\s/g,"").replace(",","."))||0);}'
    + 'function calc(){var c=Number(String(i.value).replace(/[^0-9]/g,""))||0,u=D.price+c+D.wCost,pi=u*D.units,sa=nv()*D.rpv,net=sa*0.7,pn=net*D.units;'
    + 'set("uInv",money(u,D.cur));set("pInv",money(pi,D.cur));set("sales",money(sa,D.cur));set("en","− "+money(sa*0.1,D.cur));set("sv","− "+money(sa*0.2,D.cur));set("net",money(net,D.cur));set("pNet",money(pn,D.cur));'
    + 'set("uPay","≈ "+(net>0?Math.ceil(u/net):"–")+" "+t.months);var sm=pilotSim(pi,pn,D.units,120);set("pPay","≈ "+(sm.payback?sm.payback:"–")+" "+t.months);set("y5",money(sm.total,D.cur));var ch=document.getElementById("eco-chart");if(ch)ch.innerHTML=chartSvg(pi,pn,t,D.units);var pe=document.getElementById("eco-pot");if(pe&&D.stores)pe.innerHTML=potHtml(potSim(u,net,D.stores,15),D.pt,money,D.cur);}'
    + 'i.addEventListener("input",calc);v.addEventListener("input",calc);i.addEventListener("blur",function(){var c=Number(String(i.value).replace(/[^0-9]/g,""))||0;i.value=c.toLocaleString("cs-CZ");});})();<\/script>';
}

// Simulace pilotu na 10 let: půlka prádlomatů se postaví 1. měsíc, zbytek 2. měsíc (investice se platí postupně),
// každý prádlomat po otevření nabíhá (skrytá náběhová křivka), na to sezónnost a lehké kolísání.
// Dlouhodobý průměr = zadaný měsíční výsledek. Vrací kumulovaný výsledek po měsících + měsíc návratnosti.
function pilotSim(invest, monthly, units, N) {
  const n = Math.max(1, Math.round(units) || 1), first = Math.ceil(n / 2), unitInv = invest / n, unitNet = monthly / n;
  const season = [1.07, 1.05, 1.02, 0.99, 0.96, 0.92, 0.89, 0.91, 0.99, 1.05, 1.09, 1.06];
  const ramp = [0.4, 0.7, 0.9];
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cum = [0]; let c = 0, payback = null, min = 0;
  for (let m = 1; m <= N; m++) {
    const built = m === 1 ? first : (m === 2 ? n - first : 0);
    c -= built * unitInv;
    let net = 0;
    for (const [b, cnt] of [[1, first], [2, n - first]]) { if (m >= b) net += cnt * unitNet * (ramp[m - b] != null ? ramp[m - b] : 1); }
    c += net * season[(m - 1) % 12] * (1 + (rnd() - 0.5) * 0.08);
    cum.push(c); if (c < min) min = c;
    if (payback === null && m >= 2 && c >= 0) payback = m;
  }
  return { cum, payback, total: c };
}

// Celkový potenciál: výstavba po 20 prádlomatech měsíčně, tempo roste o 30 % ročně, dokud se nevyčerpá kapacita (počet prodejen).
// Každý nový prádlomat nabíhá (skrytá křivka), pak běží naplno. Vrací řádky po letech + klíčová čísla.
function potSim(ui, un, cap, Y) {
  const ramp = [0.4, 0.7, 0.9], N = Y * 12, built = [];
  let left = cap, full = null;
  for (let m = 0; m < N; m++) {
    const b = Math.min(left, Math.round(20 * Math.pow(1.3, Math.floor(m / 12))));
    built.push(b); left -= b; if (left === 0 && full === null) full = m + 1;
  }
  const rows = []; let cum = 0, payback = null, wasNeg = false, tot = 0, yNew = 0, yInv = 0, yNet = 0;
  for (let m = 0; m < N; m++) {
    let net = 0;
    for (let j = 0; j <= m; j++) if (built[j]) net += built[j] * un * (ramp[m - j] != null ? ramp[m - j] : 1);
    cum += net - built[m] * ui; tot += built[m]; yNew += built[m]; yInv += built[m] * ui; yNet += net;
    if (cum < 0) wasNeg = true;
    if (payback === null && wasNeg && cum >= 0) payback = m + 1;
    if (m % 12 === 11) { rows.push({ year: (m + 1) / 12, added: yNew, total: tot, inv: yInv, net: yNet, cum: cum }); yNew = 0; yInv = 0; yNet = 0; }
  }
  return { rows, full, payback, total: cum, cap, invest: cap * ui, monthly: cap * un };
}
function potHtml(s, t, money, cur) {
  const f = (m) => m ? (Math.floor((m - 1) / 12) + 1) + '. ' + t.yr + ', ' + (((m - 1) % 12) + 1) + '. ' + t.mo : '–';
  const k = (l, v, sub) => '<div class="k"><div class="kl">' + l + '</div><div class="kv">' + v + '</div>' + (sub ? '<div class="ks">' + sub + '</div>' : '') + '</div>';
  const nf = (n) => Math.round(n).toLocaleString('cs-CZ');
  const body = s.rows.map((r) => '<tr' + (s.payback && r.year === Math.ceil(s.payback / 12) ? ' class="pb"' : '') + '><td>' + r.year + '. ' + t.yr + '</td><td>' + nf(r.added) + '</td><td>' + nf(r.total) + '</td><td>' + money(r.inv, cur) + '</td><td>' + money(r.net, cur) + '</td><td>' + money(r.cum, cur) + '</td></tr>').join('');
  return '<div class="kpis">' + k(t.pCap, nf(s.cap), t.pCapS) + k(t.pInv, money(s.invest, cur), '') + k(t.pMon, money(s.monthly, cur), t.pMonS) + k(t.pFull, f(s.full), '') + k(t.pPay, f(s.payback), '') + k(t.pTot, money(s.total, cur), '') + '</div>'
    + '<div class="ptw"><table class="pt"><thead><tr><th>' + t.cYear + '</th><th>' + t.cAdd + '</th><th>' + t.cTot + '</th><th>' + t.cInv + '</th><th>' + t.cNet + '</th><th>' + t.cCum + '</th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

function chartSvg(invest, monthly, t, units) {
  // kumulovaný výsledek 0–120 měsíců (10 let) ze simulace náběhu, sezónnosti a kolísání
  const W = 760, H = 240, P = 36, N = 120;
  const sim = pilotSim(invest, monthly, units, N);
  const ys = sim.cum;
  const lo = Math.min(...ys, 0), hi = Math.max(...ys, 0), span = hi - lo || 1;
  const x = (m) => P + (W - 2 * P) * m / N, y = (v) => H - P - (H - 2 * P) * (v - lo) / span;
  const pts = ys.map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const be = sim.payback;
  const yrs = [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120].map((m) => `<line x1="${x(m)}" y1="${P / 2}" x2="${x(m)}" y2="${H - P}" stroke="rgba(255,255,255,.06)"/><text x="${x(m)}" y="${H - 10}" fill="#8ea2c2" font-size="11" text-anchor="middle">${m ? (m / 12) + '. ' + t.yr : t.start}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(t.chart)}"><defs><linearGradient id="og" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2dd4bf" stop-opacity=".35"/><stop offset="1" stop-color="#2dd4bf" stop-opacity="0"/></linearGradient></defs>
  ${yrs}<line x1="${P}" y1="${y(0)}" x2="${W - P}" y2="${y(0)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="4 4"/>
  <polygon points="${x(0)},${y(0)} ${pts} ${x(N)},${y(0)}" fill="url(#og)"/><polyline points="${pts}" fill="none" stroke="#2dd4bf" stroke-width="3"/>
  ${be ? `<circle cx="${x(be)}" cy="${y(ys[be])}" r="6" fill="#22c55e"/><text x="${x(be)}" y="${y(ys[be]) - 12}" fill="#22c55e" font-size="13" font-weight="700" text-anchor="middle">${t.pay} ≈ ${be} ${t.months}</text>` : ''}</svg>`;
}

const CHK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
const PIN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const EXTRA = {
  cs: { verInd: 'Vybaveno profesionálními průmyslovými pračkami a sušičkami nejvyšší řady — profi řada', prH: 'Doba cyklu', prP: 'Ceny pro zákazníky', prTimes: [['Praní', '30–40 min'], ['Sušení', '15–20 min']], prPrices: [['Praní 18 kg bez aviváže', '300 Kč'], ['Praní 18 kg s aviváží', '350 Kč'], ['Praní 8 kg bez aviváže', '200 Kč', 1], ['Praní 8 kg s aviváží', '230 Kč', 1], ['Sušení 15 minut', '50 Kč']], coopK: 'Forma spolupráce', coopH: 'Jak by spolupráce fungovala', coopSub: (c) => `Jednoduché rozdělení rolí: vlastníkem prádlomatů je ${c}, my je vyrobíme, postavíme a postaráme se o provoz.`,
    coopA: 'Investice a vlastnictví', coopAList: (c) => [`${c} koupí prádlomaty do svého vlastnictví`, 'Zafinancuje přípojky (voda, kanalizace, elektřina)', 'Umístí prádlomat u své prodejny podle předem odsouhlaseného technického řešení a vizualizace', 'Tržby z prádlomatů zůstávají jemu'],
    coopB: 'Výroba, realizace a provoz', coopBList: ['Provedeme místní šetření a navrhneme technické řešení a vizualizaci', 'Prádlomaty vyrobíme v České republice', 'Zrealizujeme přípojky na místě', 'Dodáme a nainstalujeme prádlomat na klíč', 'Poskytneme full servis provozu — údržba, náhradní díly, vzdálený dohled, zákaznická linka, reporting'],
    coopFlow: [['Místní šetření', 'B'], ['Objednávka a financování', 'A'], ['Výroba v ČR', 'B'], ['Realizace přípojek', 'B'], ['Dodání a instalace', 'B'], ['Full servis provozu', 'B']], verEq: { mini: ['Pračka 18 kg', 'Sušička 18 kg'], flex: ['Pračka 8 kg', 'Pračka 18 kg', 'Sušička 18 kg'], max: ['2× pračka 18 kg', '2× sušička 18 kg'] }, verEqAll: ['Profesionální průmyslové pračky a sušičky nejvyšší řady — profi řada', 'Bezhotovostní platby (karta, Apple / Google Pay)', 'Vzdálený dohled a diagnostika 24/7', 'Provoz 24/7 bez obsluhy'], verK: 'Verze prádlomatu', verH: 'Děláme ve třech verzích — MINI, FLEX a MAX', verSub: 'Velikost vybereme podle lokality a očekávané poptávky. Všechny verze mají stejnou techniku, platby i dohled.', verDesc: { mini: 'Kompaktní verze pro menší plochy.', flex: 'Univerzální verze pro většinu lokalit.', max: 'Největší kapacita pro frekventovaná místa.' }, eqH: 'Jak jsou stroje vybavené', brandK: 'Vaše značka', brandH: (c) => `Prádlomat v barvách ${c}`, brandSub: (c) => `Prádlomat personalizujeme podle vizuální identity ${c} — zákazník vidí službu ${c}, ne cizí stroj.`, brandPts: ['Polep a barvy podle vašeho brand manuálu', 'Logo a název služby podle vašeho přání', 'Platební obrazovka a aplikace ve vaší identitě', 'Vizualizaci připravíme před spuštěním pilotu'], brandCap: (c) => `Vizualizace prádlomatu pro ${c}`, brandCap0: 'Ukázka prádlomatu — vizualizaci ve vašich barvách připravíme', statCard: ['Vyrobeno v České republice', 'Dodáváme kamkoli na světě'], proof: [['CZFLAG', 'Vyrobeno v České republice', 'Vývoj i výroba u nás — ryze český výrobek.'], ['🌍', 'Dodáváme kamkoli na světě', 'Doprava, instalace a uvedení do provozu na klíč.'], ['🛠️', 'Vlastní provoz a servis', 'Prádlomaty sami provozujeme — víme, co v praxi funguje.']], eyebrow: 'Více než 150 prádlomatů dodaných po Evropě · ryze český výrobek', statTxt: (n, c) => `prádlomatů v pilotním projektu pro ${c}.`, statAlt: 'Více než 150 prádlomatů dodaných po Evropě.', sites: 'Skutečné provozovny', what: 'O co jde', can: 'Co prádlomat umí', ben: 'Přínosy', eco: 'Ekonomika', pilot: 'Pilot', vid: 'Video', cta: 'Další krok' },
  en: { verInd: 'Equipped with fully professional top-of-the-range industrial washers and dryers — pro series', prH: 'Cycle time', prP: 'Customer prices', prTimes: [['Washing', '30–40 min'], ['Drying', '15–20 min']], prPrices: [['Wash 18 kg without softener', '300 CZK'], ['Wash 18 kg with softener', '350 CZK'], ['Wash 8 kg without softener', '200 CZK', 1], ['Wash 8 kg with softener', '230 CZK', 1], ['Drying 15 minutes', '50 CZK']], coopK: 'Form of cooperation', coopH: 'How the cooperation would work', coopSub: (c) => `A simple split of roles: the laundromats belong to ${c}, we build, install and operate them.`,
    coopA: 'Investment and ownership', coopAList: (c) => [`${c} buys the laundromats into its ownership`, 'Finances the connections (water, sewage, power)', 'Places the laundromat at its store according to the pre-agreed technical solution and visualisation', 'All revenue stays with ' + c],
    coopB: 'Manufacturing, delivery and operation', coopBList: ['We carry out an on-site survey and propose the technical solution and visualisation', 'We manufacture the laundromats in the Czech Republic', 'We build the on-site connections', 'We deliver and install the laundromat turnkey', 'We provide full operating service — maintenance, spare parts, remote monitoring, customer hotline, reporting'],
    coopFlow: [['On-site survey', 'B'], ['Order and financing', 'A'], ['Manufacturing in CZ', 'B'], ['Connections', 'B'], ['Delivery and installation', 'B'], ['Full operating service', 'B']], verEq: { mini: ['18 kg washer', '18 kg dryer'], flex: ['8 kg washer', '18 kg washer', '18 kg dryer'], max: ['2× 18 kg washer', '2× 18 kg dryer'] }, verEqAll: ['Fully professional top-of-the-range industrial washers and dryers — pro series', 'Cashless payments (card, Apple / Google Pay)', '24/7 remote monitoring and diagnostics', 'Open 24/7, unstaffed'], verK: 'Laundromat versions', verH: 'We make three versions — MINI, FLEX and MAX', verSub: 'We choose the size according to the location and expected demand. All versions share the same technology, payments and monitoring.', verDesc: { mini: 'Compact version for smaller spaces.', flex: 'Versatile version for most locations.', max: 'Highest capacity for busy sites.' }, eqH: 'How the machines are equipped', brandK: 'Your brand', brandH: (c) => `A laundromat in ${c} colours`, brandSub: (c) => `We personalise the laundromat to the ${c} visual identity — customers see a ${c} service, not someone else's machine.`, brandPts: ['Wrap and colours according to your brand manual', 'Logo and service name as you wish', 'Payment screen and app in your identity', 'We prepare a visualisation before the pilot starts'], brandCap: (c) => `Laundromat visualisation for ${c}`, brandCap0: 'Sample laundromat — we will prepare a visualisation in your colours', statCard: ['Made in the Czech Republic', 'Delivered anywhere in the world'], proof: [['CZFLAG', 'Made in the Czech Republic', 'Designed and built in-house — a genuinely Czech product.'], ['🌍', 'Delivered anywhere in the world', 'Transport, installation and commissioning turnkey.'], ['🛠️', 'Our own operations & service', 'We run laundromats ourselves — we know what works.']], eyebrow: 'Over 150 laundromats delivered across Europe · made in Czechia', statTxt: (n, c) => `laundromats in the pilot project for ${c}.`, statAlt: 'Over 70 laundromats we operate ourselves in the Czech Republic.', sites: 'Real sites', what: 'What it is', can: 'What it does', ben: 'Benefits', eco: 'Economics', pilot: 'Pilot', vid: 'Video', cta: 'Next step' },
  pl: { verInd: 'Wyposażone w profesjonalne przemysłowe pralki i suszarki najwyższej klasy — seria profi', prH: 'Czas cyklu', prP: 'Ceny dla klientów', prTimes: [['Pranie', '30–40 min'], ['Suszenie', '15–20 min']], prPrices: [['Pranie 18 kg bez płynu zmiękczającego', '300 CZK'], ['Pranie 18 kg z płynem zmiękczającym', '350 CZK'], ['Pranie 8 kg bez płynu zmiękczającego', '200 CZK', 1], ['Pranie 8 kg z płynem zmiękczającym', '230 CZK', 1], ['Suszenie 15 minut', '50 CZK']], coopK: 'Forma współpracy', coopH: 'Jak wyglądałaby współpraca', coopSub: (c) => `Prosty podział ról: urządzenia należą do ${c}, my je produkujemy, instalujemy i obsługujemy.`,
    coopA: 'Inwestycja i własność', coopAList: (c) => [`${c} kupuje urządzenia na własność`, 'Finansuje przyłącza (woda, kanalizacja, prąd)', 'Umieszcza urządzenie przy swoim sklepie zgodnie z wcześniej uzgodnionym rozwiązaniem technicznym i wizualizacją', 'Przychody pozostają w ' + c],
    coopB: 'Produkcja, realizacja i eksploatacja', coopBList: ['Przeprowadzamy wizję lokalną i proponujemy rozwiązanie techniczne oraz wizualizację', 'Urządzenia produkujemy w Czechach', 'Wykonujemy przyłącza na miejscu', 'Dostarczamy i instalujemy urządzenie pod klucz', 'Zapewniamy pełny serwis eksploatacji — konserwacja, części, zdalny nadzór, infolinia, raporty'],
    coopFlow: [['Wizja lokalna', 'B'], ['Zamówienie i finansowanie', 'A'], ['Produkcja w CZ', 'B'], ['Przyłącza', 'B'], ['Dostawa i instalacja', 'B'], ['Pełny serwis', 'B']], verEq: { mini: ['Pralka 18 kg', 'Suszarka 18 kg'], flex: ['Pralka 8 kg', 'Pralka 18 kg', 'Suszarka 18 kg'], max: ['2× pralka 18 kg', '2× suszarka 18 kg'] }, verEqAll: ['Profesjonalne przemysłowe pralki i suszarki najwyższej klasy — seria profi', 'Płatności bezgotówkowe (karta, Apple / Google Pay)', 'Zdalny nadzór i diagnostyka 24/7', 'Czynne 24/7 bez obsługi'], verK: 'Wersje urządzenia', verH: 'Produkujemy w trzech wersjach — MINI, FLEX i MAX', verSub: 'Rozmiar dobieramy do lokalizacji i oczekiwanego popytu. Wszystkie wersje mają tę samą technikę, płatności i nadzór.', verDesc: { mini: 'Kompaktowa wersja na mniejsze powierzchnie.', flex: 'Uniwersalna wersja dla większości lokalizacji.', max: 'Największa wydajność dla ruchliwych miejsc.' }, eqH: 'Jak wyposażone są urządzenia', brandK: 'Państwa marka', brandH: (c) => `Pralnia w barwach ${c}`, brandSub: (c) => `Personalizujemy urządzenie zgodnie z identyfikacją wizualną ${c} — klient widzi usługę ${c}, nie cudzą maszynę.`, brandPts: ['Oklejenie i kolory zgodnie z księgą znaku', 'Logo i nazwa usługi według Państwa życzenia', 'Ekran płatności i aplikacja w Państwa identyfikacji', 'Wizualizację przygotujemy przed startem pilotażu'], brandCap: (c) => `Wizualizacja urządzenia dla ${c}`, brandCap0: 'Przykładowe urządzenie — wizualizację w Państwa barwach przygotujemy', statCard: ['Wyprodukowano w Czechach', 'Dostarczamy na cały świat'], proof: [['CZFLAG', 'Wyprodukowano w Czechach', 'Projekt i produkcja u nas — czeski produkt.'], ['🌍', 'Dostarczamy na cały świat', 'Transport, instalacja i uruchomienie pod klucz.'], ['🛠️', 'Własna eksploatacja i serwis', 'Sami prowadzimy pralnie — wiemy, co działa.']], eyebrow: 'Ponad 150 urządzeń dostarczonych w Europie · czeski produkt', statTxt: (n, c) => `urządzeń w projekcie pilotażowym dla ${c}.`, statAlt: 'Ponad 70 pralni, które sami prowadzimy w Czechach.', sites: 'Prawdziwe punkty', what: 'Na czym to polega', can: 'Co potrafi', ben: 'Korzyści', eco: 'Ekonomika', pilot: 'Pilotaż', vid: 'Wideo', cta: 'Kolejny krok' },
};
// Nadpis: bílá část + gradientní část (rozdělí se před posledním „u / pro / pod / at / for / dla / przy")
function splitTitle(title) {
  const m = String(title || '').match(/^(.*\S)\s+((?:u|pro|pod|at|for|under|dla|przy|pod)\s+.+)$/i);
  return m ? [m[1], m[2]] : [String(title || ''), ''];
}

// Živá mapka: z Česka vedou animované oblouky do světa (výroba v ČR, dodání kamkoli)
const CZF = (w) => `<svg width="${w}" height="${Math.round(w * 2 / 3)}" viewBox="0 0 30 20" style="border-radius:3px;flex:none;vertical-align:-3px" aria-label="CZ"><rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#d7141a"/><path d="M0 0 L15 10 L0 20 Z" fill="#11457e"/></svg>`;
const GLOBE = (() => {
  const W = 280, H = 150, cz = [150, 52];
  const dst = [[38, 60], [70, 108], [112, 30], [205, 40], [236, 92], [262, 64], [188, 118], [96, 70]];
  // tečková „zeměkoule" — pravidelná síť bodů v elipse
  let dots = '';
  for (let y = 10; y < H; y += 9) for (let x = 6; x < W; x += 9) { const nx = (x - W / 2) / (W / 2), ny = (y - H / 2) / (H / 2); if (nx * nx + ny * ny < 1) dots += `<circle cx="${x}" cy="${y}" r="1.1" fill="rgba(120,160,255,.28)"/>`; }
  const arcs = dst.map(([x, y], i) => { const mx = (cz[0] + x) / 2, my = Math.min(cz[1], y) - 26 - (i % 3) * 6; return `<path class="gl-arc" style="animation-delay:-${(i * 0.23).toFixed(2)}s" d="M${cz[0]} ${cz[1]} Q${mx} ${my} ${x} ${y}"/><circle class="gl-dst" style="animation-delay:-${(i * 0.3).toFixed(1)}s" cx="${x}" cy="${y}" r="3"/>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><radialGradient id="glg" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="rgba(58,108,245,.35)"/><stop offset="1" stop-color="rgba(58,108,245,0)"/></radialGradient></defs>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2 - 2}" ry="${H / 2 - 2}" fill="url(#glg)" stroke="rgba(120,160,255,.25)"/>${dots}${arcs}
  <circle class="gl-pulse" cx="${cz[0]}" cy="${cz[1]}" r="6"/><circle class="gl-cz" cx="${cz[0]}" cy="${cz[1]}" r="5"/><text x="${cz[0] + 9}" y="${cz[1] - 7}" fill="#b6f5ea" font-size="10.5" font-weight="700">CZ</text></svg>`;
})();
// Jiskry za personalizovaným prádlomatem (pevné pozice, různé zpoždění)
const SPARKS = '<div class="bsp">' + [[8, 18, 0], [86, 14, .6], [16, 62, 1.2], [92, 52, .3], [50, 4, 1.8], [30, 30, 2.4], [72, 70, .9], [4, 40, 2.1], [64, 24, 1.5], [96, 30, 2.7]].map(([x, y, d]) => `<i style="left:${x}%;top:${y}%;animation-delay:${d}s"></i>`).join('') + '</div>';
// Moderní ikony v brandu (gradient cyan → fialová) pro sekci Přínosy
function benIco(i) {
  const g = `<defs><linearGradient id="bg${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fd1ff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>`;
  const a = `fill="none" stroke="url(#bg${i})" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
  const P = [
    // prodejna s rostoucím grafem
    `<path ${a} d="M3 9.5 4.6 4h14.8L21 9.5"/><path ${a} d="M3 9.5c0 1.4 1.1 2.5 2.5 2.5S8 10.9 8 9.5c0 1.4 1.1 2.5 2.5 2.5h3c1.4 0 2.5-1.1 2.5-2.5 0 1.4 1.1 2.5 2.5 2.5S21 10.9 21 9.5"/><path ${a} d="M4.5 12v8h15v-8"/><path ${a} d="m8 17.5 2.5-2.5 2 1.5 3.5-3.5"/><path ${a} d="M14 13h2v2"/>`,
    // zákazník + srdce
    `<circle ${a} cx="9" cy="8" r="3.5"/><path ${a} d="M2.5 20c.6-3.6 3.3-6 6.5-6 1.6 0 3 .5 4.1 1.5"/><path ${a} d="M17.5 21s-4-2.4-4-5.1c0-1.2.9-2.1 2-2.1.8 0 1.5.4 2 1.1.5-.7 1.2-1.1 2-1.1 1.1 0 2 .9 2 2.1 0 2.7-4 5.1-4 5.1z"/>`,
    // značka – odznak s jiskrou
    `<path ${a} d="M12 2.8l2.2 1.6 2.7-.1.8 2.6 2.2 1.6-.9 2.5.9 2.5-2.2 1.6-.8 2.6-2.7-.1L12 19.2l-2.2-1.6-2.7.1-.8-2.6-2.2-1.6.9-2.5-.9-2.5 2.2-1.6.8-2.6 2.7.1z"/><path ${a} d="M12 7.5l1.1 2.4 2.4 1.1-2.4 1.1L12 14.5l-1.1-2.4L8.5 11l2.4-1.1z"/><path ${a} d="M8.5 19.5 7 22.5M15.5 19.5l1.5 3"/>`,
  ];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${g}${P[i] || P[2]}</svg>`;
}

function offerPage(o, token, opts) {
  const preview = !!(opts && opts.preview);
  const L = o.lang === 'en' ? 'en' : o.lang === 'pl' ? 'pl' : 'cs', t = T[L], X = EXTRA[L];
  const c = esc(o.company || '');
  const pts = String(o.points || '').split('\n').map((x) => x.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  const refs = String(o.refs || REFS[L]).split('\n').map((r) => r.split('|').map((x) => x.trim())).filter((r) => r[0]);
  const units = Number(o.units) || 0, price = Number(o.unit_price) || 0, mon = Number(o.monthly_revenue) || 0;
  const invest = units * price, monAll = units * mon;
  const valid = o.valid_until ? new Date(o.valid_until + 'T12:00:00').toLocaleDateString(L === 'en' ? 'en-GB' : L === 'pl' ? 'pl-PL' : 'cs-CZ') : '';
  const [h1a, h1b] = splitTitle(o.title || t.kick);
  const kick = (x) => `<div class="kicker">— ${esc(x)}</div>`;
  const kpi = (lbl, val, sub) => `<div class="k"><div class="kl">${esc(lbl)}</div><div class="kv">${val}</div>${sub ? `<div class="ks">${sub}</div>` : ''}</div>`;
  // Ekonomika ve dvou rovinách: 1 prádlomat (tržby − energie 10 % − servis 20 %) a celý pilot
  const E = ECO2[L], cur = o.currency, EUR = cur === 'EUR';
  const conn = Number(o.conn_price) || (EUR ? 2200 : 55000), wy = Math.min(4, Math.max(0, Math.round(o.warranty_years == null || o.warranty_years === '' ? 4 : Number(o.warranty_years) || 0)));
  const wPrice = EUR ? 600 : 15000, wCost = wy * wPrice;
  // Tržby z návštěvnosti: 6 zákazníků / den = 2 073 € bez DPH měsíčně (CZK = × 25)
  const RPV = (EUR ? 2073 : 2073 * 25) / 6;
  const visits = Number(o.visits) || 7, sales = visits * RPV;
  const uInv = price + conn + wCost, en = sales * 0.10, sv = sales * 0.20, net = sales - en - sv;
  const pInv = units * uInv, pNet = units * net;
  const pSim = pilotSim(pInv, pNet, units, 120);
  const stores = Math.max(0, Math.round(Number(o.stores) || 0));
  const PT = Object.assign({}, POT[L] || POT.cs, { yr: t.yr, mo: (POT[L] || POT.cs).mo });
  // sub je funkce — do klienta se neposílá (JSON ji zahodí), klient ji nepotřebuje
  const row = (l, v, cls) => `<div class="er${cls ? ' ' + cls : ''}"><span>${l}</span><b>${v}</b></div>`;
  const one = price ? `<div class="eco"><div class="ehead"><div><h3 class="eh">${esc(E.oneH)}</h3><div class="emod"><b>${esc(E.modT)}</b> ${esc(E.modS)}</div></div><div class="eimg"><img src="${o.image_v ? '/nabidka/' + token + '/img?v=' + o.image_v : '/img/model/flex'}" alt="FLEX" loading="lazy" data-zoom><span>FLEX</span></div></div><div class="etwo">
      <div class="ecol"><div class="ect">${esc(E.invT)}</div>${row(esc(E.price) + (o.model ? ' <i>' + esc(o.model) + '</i>' : ''), money(price, cur))}<div class="er"><span>${esc(E.conn)} <em class="est">${esc(E.est)}</em></span><b><label class="edit"><input id="eco-conn" type="text" inputmode="numeric" value="${Math.round(conn).toLocaleString('cs-CZ')}" aria-label="${esc(E.conn)}">${EUR ? '€' : 'Kč'}</label></b></div>${wy ? row(esc(E.warr(wy)), money(wCost, cur)) : ''}${row(esc(E.invU), '<span data-k="uInv">' + money(uInv, cur) + '</span>', 'tot')}</div>
      <div class="ecol"><div class="ect">${esc(E.opT)}</div><div class="er"><span>${esc(E.visits)} <em class="est">${esc(E.est)}</em></span><b><label class="edit"><input id="eco-vis" type="text" inputmode="decimal" value="${String(visits).replace('.', ',')}" aria-label="${esc(E.visits)}" style="width:44px">${esc(E.perDay)}</label></b></div>${row(esc(E.sales), '<span data-k="sales">' + money(sales, cur) + '</span>')}${row('− ' + esc(E.energy), '<span data-k="en">− ' + money(en, cur) + '</span>', 'neg')}${row('− ' + esc(E.service), '<span data-k="sv">− ' + money(sv, cur) + '</span>', 'neg')}${row(esc(E.net), '<span data-k="net">' + money(net, cur) + '</span>', 'tot')}${row(esc(t.pay), '<span data-k="uPay">≈ ' + (net > 0 ? Math.ceil(uInv / net) : '–') + ' ' + esc(t.months) + '</span>')}</div></div>
      <div class="ewar">🛡️ <span>${esc(E.warrNote(money(wPrice, cur), money(4 * wPrice, cur)))}</span></div></div>` : '';
  const eco = units && price ? `<section class="sec" id="eko" data-s="ekonomika">${kick(X.eco)}<h2>${esc(E.h)}</h2><p class="sub">${esc(t.ecoSub)}</p>${one}
    <div class="eco" style="margin-top:22px"><h3 class="eh">${esc(E.pilotH(units))}</h3><div class="kpis">${kpi(t.units, String(units), o.model ? esc(t.model + ' ' + o.model) : '')}${kpi(t.inv, '<span data-k="pInv">' + money(pInv, cur) + '</span>', '<span data-k="uInv">' + money(uInv, cur) + '</span> ' + esc(t.monU))}${kpi(t.mon, '<span data-k="pNet">' + money(pNet, cur) + '</span>', '<span data-k="net">' + money(net, cur) + '</span> ' + esc(t.monU)) + kpi(t.pay, '<span data-k="pPay">≈ ' + (pSim.payback || '–') + ' ' + esc(t.months) + '</span>', '') + kpi(t.y5, '<span data-k="y5">' + money(pSim.total, cur) + '</span>', '')}</div>
    <div class="chart"><div class="ph">${esc(t.chart)}</div><div id="eco-chart">${chartSvg(pInv, pNet, t, units)}</div></div><p class="fine">${esc(t.vat)}</p></div>${stores > 0 ? `<div class="eco" style="margin-top:22px"><h3 class="eh">${esc(PT.h)}</h3><p class="sub" style="margin:0 0 14px">${esc(PT.sub(o.company || '', stores))}</p><div id="eco-pot">${potHtml(potSim(uInv, net, stores, 15), PT, money, cur)}</div><p class="fine">${esc(PT.fine)}</p></div>` : ''}</section>` + ecoScript({ price, wCost, rpv: RPV, units, cur, stores, pt: PT, t: { chart: t.chart, yr: t.yr, start: t.start, pay: t.pay, months: t.months } }) : '';
  const body = `<style>
.ox{--bg:#04060c;--line:rgba(120,160,255,.14);--line2:rgba(120,160,255,.28);--tx:#eef4ff;--tx2:#a9b8d3;--tx3:#6b7d9e;--az:#4fd1ff;--vi:#7c5cff;--teal:#2fe3c6;max-width:1180px;margin:0 auto;padding:0 22px 70px;color:var(--tx)}
.ox h1,.ox h2,.ox h3{margin:0;letter-spacing:-.025em;line-height:1.08}
.ox .grad{background:linear-gradient(90deg,var(--az),#7aa8ff 55%,var(--vi));-webkit-background-clip:text;background-clip:text;color:transparent}
.ox .btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:0 26px;border-radius:14px;font-weight:700;font-size:16px;text-decoration:none;border:1px solid transparent;cursor:pointer;font-family:inherit;transition:transform .18s,box-shadow .18s,border-color .18s}
.ox .btn-p{background:linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff);color:#fff;box-shadow:0 10px 30px -10px rgba(58,108,245,.8)}.ox .btn-p:hover{transform:translateY(-2px)}
.ox .btn-g{background:rgba(255,255,255,.04);border-color:var(--line2);color:var(--tx)}.ox .btn-g:hover{border-color:var(--az)}
.ox .hero{position:relative;display:grid;grid-template-columns:1.05fr .95fr;gap:40px;align-items:center;padding:40px 0 70px}
.ox .hero:before{content:"";position:absolute;inset:-20% -10% auto -10%;height:120%;background:radial-gradient(900px 520px at 78% 38%,rgba(58,108,245,.28),transparent 62%),radial-gradient(700px 420px at 12% 18%,rgba(79,209,255,.12),transparent 60%);pointer-events:none;z-index:-1}
.ox .eyebrow{display:inline-flex;align-items:center;gap:9px;padding:7px 14px;border:1px solid rgba(47,227,198,.35);background:rgba(47,227,198,.07);border-radius:999px;color:#b6f5ea;font-size:13.5px;font-weight:600;text-transform:none;letter-spacing:0}.ox .eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--teal);box-shadow:0 0 10px var(--teal)}
.ox .hero h1{font-size:clamp(28px,3.2vw,42px);font-weight:750;margin:0;letter-spacing:-.02em;line-height:1.15}.ox .hero h1 span{display:block}
.ox .lead{margin:24px 0 0;font-size:clamp(17px,1.6vw,20px);line-height:1.6;color:var(--tx2);max-width:640px}
.ox .ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}
.ox .chk{list-style:none;padding:0;margin:30px 0 0;display:flex;flex-wrap:wrap;gap:10px 26px;color:var(--tx2);font-size:15px}.ox .chk li{display:flex;align-items:center;gap:9px}.ox .chk svg{color:var(--teal)}
.ox .meta{color:var(--tx3);font-size:13.5px;margin-top:18px}
.ox .visual{position:relative;justify-self:end;width:100%;max-width:400px}
.ox .visual .glow{position:absolute;inset:4%;border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.35),rgba(58,108,245,.18) 45%,transparent 70%);filter:blur(10px)}
.ox .visual video{position:relative;display:block;width:78%;margin:0 auto;aspect-ratio:9/16;height:auto;object-fit:cover;border-radius:26px;border:1px solid var(--line2);background:#0b1220;box-shadow:0 30px 60px -20px rgba(0,0,0,.8),0 0 0 6px rgba(79,209,255,.06)}
.ox .statcard{position:absolute;left:-8%;bottom:-4%;max-width:230px;padding:14px 16px;border-radius:18px;background:rgba(10,16,30,.85);border:1px solid var(--line2);backdrop-filter:blur(12px);box-shadow:0 20px 50px -20px rgba(0,0,0,.8)}
.ox .statcard b{display:block;font-size:34px;line-height:1;font-weight:850;letter-spacing:-.03em}.ox .statcard p{margin:8px 0 0;font-size:14px;color:var(--tx2);line-height:1.45}
.ox .sec{padding:70px 0 0;scroll-margin-top:70px}.ox .kicker{font-size:12.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--az);margin-bottom:14px}
.ox h2{font-size:clamp(28px,3.4vw,42px);font-weight:820}.ox .sub{color:var(--tx2);margin:12px 0 0;font-size:17px;max-width:760px;line-height:1.55}
.ox .grid{display:grid;gap:18px;margin-top:36px}.ox .g3{grid-template-columns:repeat(3,1fr)}
.ox .card{background:rgba(14,22,40,.62);border:1px solid var(--line);border-radius:20px;padding:26px;backdrop-filter:blur(6px)}
.ox .ico{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:linear-gradient(135deg,rgba(79,209,255,.16),rgba(124,92,255,.12));border:1px solid rgba(79,209,255,.22);margin-bottom:18px}
.ox .ico{position:relative;width:56px;height:56px;border-radius:16px;box-shadow:0 0 0 1px rgba(79,209,255,.08) inset,0 8px 28px -10px rgba(79,209,255,.55);transition:transform .3s,box-shadow .3s}
.ox .ico svg{width:28px;height:28px;filter:drop-shadow(0 0 6px rgba(79,209,255,.45))}
.ox .path:hover .ico{transform:translateY(-3px);box-shadow:0 0 0 1px rgba(79,209,255,.25) inset,0 12px 34px -8px rgba(124,92,255,.7)}
.ox .card h3{font-size:19px;font-weight:700}.ox .card p{color:var(--tx2);margin:10px 0 0;font-size:15.5px;line-height:1.55}
.ox .step .n{width:54px;height:54px;border-radius:16px;display:grid;place-items:center;font-weight:850;font-size:20px;background:var(--bg);border:1px solid var(--line2);color:var(--az);margin-bottom:18px}
.ox .models{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:18px}.ox .models figure{margin:0;padding:18px;border-radius:20px;background:radial-gradient(circle at 50% 40%,rgba(79,209,255,.12),transparent 65%),rgba(14,22,40,.62);border:1px solid var(--line);text-align:center}.ox .models img{width:100%;height:200px;object-fit:contain;filter:drop-shadow(0 20px 30px rgba(0,0,0,.5))}.ox .models figcaption{font-weight:800;letter-spacing:.14em;color:var(--tx2);margin-top:8px}
.ox .path{display:flex;flex-direction:column;padding:30px;border-radius:24px;background:linear-gradient(160deg,rgba(20,32,58,.9),rgba(10,16,30,.9));border:1px solid var(--line2);position:relative;overflow:hidden}
.ox .path:after{content:"";position:absolute;inset:auto -30% -55% auto;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.14),transparent 65%);pointer-events:none}
.ox .path ul{list-style:none;padding:0;margin:14px 0 0}.ox .path li{display:flex;gap:10px;color:var(--tx2);font-size:15.5px;line-height:1.5;margin:9px 0}.ox .path li svg{flex:none;color:var(--teal);margin-top:3px}
.ox .sites{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:30px}.ox .site{margin:0}.ox .site img{width:100%;aspect-ratio:4/3;object-fit:cover;object-position:center 60%;border-radius:18px;border:1px solid var(--line)}
.ox .site figcaption{display:flex;align-items:center;gap:7px;margin-top:10px;color:var(--tx2);font-size:14.5px;font-weight:600}.ox .site figcaption svg{color:var(--az);flex:none}.ox .site small{display:block;color:var(--tx3);font-weight:500;font-size:13.5px;margin:4px 0 0 23px;line-height:1.45}
.ox .tl{display:grid;gap:12px;margin-top:30px;counter-reset:s}.ox .tl .it{display:flex;gap:16px;align-items:center;padding:16px 20px;border-radius:16px;background:rgba(14,22,40,.62);border:1px solid var(--line)}
.ox .tl .it:before{counter-increment:s;content:counter(s);flex:0 0 42px;height:42px;border-radius:12px;display:grid;place-items:center;font-weight:850;background:var(--bg);border:1px solid var(--line2);color:var(--az)}.ox .tl .it span{color:var(--tx);font-size:16px;line-height:1.5}
.ox .eco{margin-top:30px;border-radius:28px;padding:40px;background:linear-gradient(135deg,#0d1a33,#0a1222 60%,#120f2b);border:1px solid var(--line2);position:relative;overflow:hidden}
.ox .eco:before{content:"";position:absolute;right:-120px;top:-120px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(124,92,255,.22),transparent 65%);pointer-events:none}
.ox .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;position:relative}.ox .k{padding:16px 18px;border-radius:16px;background:rgba(4,6,12,.45);border:1px solid var(--line2)}.ox .kl{color:var(--tx2);font-size:13.5px}.ox .kv{font-size:30px;font-weight:850;letter-spacing:-.03em;margin:6px 0 2px}.ox .ks{color:var(--tx3);font-size:12.5px}
.ox .eh{font-size:20px;margin:0 0 8px;position:relative}.ox .ehead{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:20px;position:relative}.ox .emod{color:var(--tx2);font-size:14.5px;line-height:1.5;max-width:560px}.ox .emod b{color:#fde047}.ox .eimg{position:relative;flex:0 0 auto;width:230px;padding:10px;border-radius:18px;background:radial-gradient(circle at 50% 60%,rgba(79,209,255,.16),transparent 70%);border:1px solid var(--line2)}.ox .eimg img{display:block;width:100%;height:auto;filter:drop-shadow(0 12px 24px rgba(0,0,0,.5))}.ox [data-zoom]{cursor:zoom-in;transition:transform .25s}.ox .eimg:hover [data-zoom]{transform:scale(1.04)}.zoom{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:4vh 4vw;background:rgba(2,4,10,.88);backdrop-filter:blur(6px);cursor:zoom-out;animation:zin .2s ease}.zoom[hidden]{display:none}.zoom img{max-width:100%;max-height:92vh;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6);cursor:default}.zoom .zx{position:absolute;top:18px;right:22px;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-size:18px;cursor:pointer}@keyframes zin{from{opacity:0}to{opacity:1}}
.ox .eimg span{position:absolute;top:10px;right:10px;font-size:11px;font-weight:800;letter-spacing:.1em;padding:3px 8px;border-radius:7px;background:linear-gradient(90deg,var(--az),var(--vi));color:#04060c}@media (max-width:760px){.ox .ehead{flex-direction:column;align-items:flex-start}.ox .eimg{width:100%;max-width:300px}}.ox .etwo{display:grid;grid-template-columns:1fr 1fr;gap:16px;position:relative}.ox .ecol{padding:18px 20px;border-radius:16px;background:rgba(4,6,12,.45);border:1px solid var(--line2)}.ox .ect{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--az);font-weight:700;margin-bottom:8px}.ox .er{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);color:var(--tx2);font-size:15px}.ox .er i{font-style:normal;color:var(--tx3);font-size:13px}.ox .er b{color:var(--tx);white-space:nowrap}.ox .er.neg b{color:#fca5a5}.ox .est{font-style:normal;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#facc15;background:rgba(250,204,21,.12);border:1px solid rgba(250,204,21,.35);border-radius:6px;padding:1px 6px;margin-left:4px}.ox .edit{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:9px;background:rgba(250,204,21,.12);border:1px solid rgba(250,204,21,.55);color:#fde047;cursor:text}.ox .edit input{width:84px;background:transparent;border:0;outline:0;color:#fde047;font:inherit;font-weight:700;text-align:right;padding:0;margin:0;min-height:0}.ox .edit:focus-within{box-shadow:0 0 0 3px rgba(250,204,21,.25)}.ox .er.tot{border-bottom:0;padding-top:12px;font-weight:700;color:var(--tx)}.ox .er.tot b{font-size:20px;background:linear-gradient(90deg,var(--az),var(--vi));-webkit-background-clip:text;background-clip:text;color:transparent}.ox .ewar{margin-top:14px;display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border-radius:14px;background:rgba(47,227,198,.07);border:1px solid rgba(47,227,198,.22);color:var(--tx2);font-size:14px;line-height:1.5;position:relative}@media (max-width:760px){.ox .etwo{grid-template-columns:1fr}}
.ox .ptw{overflow-x:auto;margin-top:18px}.ox .pt{width:100%;border-collapse:collapse;font-size:14px}.ox .pt th,.ox .pt td{padding:9px 10px;text-align:right;border-bottom:1px solid rgba(255,255,255,.08);white-space:nowrap}.ox .pt th:first-child,.ox .pt td:first-child{text-align:left;font-weight:700}.ox .pt th{color:var(--tx2);font-weight:700;font-size:12.5px}.ox .pt tr.pb td{background:rgba(34,197,94,.10)}
.ox .chart{margin-top:22px;position:relative}.ox .ph{font-weight:700;margin-bottom:8px;color:var(--tx2)}.ox .fine{color:var(--tx3);font-size:13px;margin:14px 0 0;position:relative}
.ox .vids{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:30px;max-width:900px}.ox .vids figure{margin:0}.ox .vids video{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:18px;border:1px solid var(--line2);background:#0b1426;display:block}.ox .vids figcaption{margin-top:10px;color:var(--tx2);font-size:14px;font-weight:600}
.ox .cta{margin-top:30px;border-radius:28px;padding:40px;background:linear-gradient(135deg,rgba(30,134,224,.18),rgba(124,92,255,.16));border:1px solid rgba(79,209,255,.4)}
.ox .cta label{display:block;font-size:14px;font-weight:600;margin:12px 0 6px}.ox .cta input,.ox .cta textarea{width:100%;box-sizing:border-box;min-height:50px;padding:12px 14px;border-radius:12px;border:1px solid var(--line2);background:rgba(4,6,12,.6);color:var(--tx);font:inherit}
.ox .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ox .contact{margin-top:22px;padding-top:16px;border-top:1px solid var(--line2);color:var(--tx2)}.ox .contact a{color:var(--az)}
.ox .statcard.globe{max-width:230px;padding:10px 12px 12px;left:-12%;bottom:-6%}.ox .globe > svg{display:block;width:100%;height:auto}.ox .globe .gt b{display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:800;letter-spacing:0;margin-top:6px}.ox .globe .gt p{margin:4px 0 0;font-size:12.5px}
.ox .gl-arc{fill:none;stroke:#4fd1ff;stroke-width:1.6;stroke-linecap:round;stroke-dasharray:4 6;animation:glFlow 1.6s linear infinite;filter:drop-shadow(0 0 3px rgba(79,209,255,.7))}
.ox .gl-dst{fill:#7aa8ff;animation:glPing 2.4s ease-in-out infinite}.ox .gl-cz{fill:#2fe3c6}.ox .gl-pulse{fill:none;stroke:#2fe3c6;stroke-width:2;transform-box:fill-box;transform-origin:center;animation:glPulse 2s ease-out infinite}
@keyframes glFlow{to{stroke-dashoffset:-20}}@keyframes glPulse{0%{transform:scale(.4);opacity:1}100%{transform:scale(2.6);opacity:0}}@keyframes glPing{0%,100%{opacity:.35}50%{opacity:1}}
.ox .brand h2{font-size:clamp(24px,2.4vw,32px)}.ox .bwrap{display:grid;grid-template-columns:1fr 1fr;gap:36px;align-items:center;margin-top:14px}.ox .bimg{position:relative;max-width:470px;width:100%;margin:0 auto;padding:30px 10px 54px;display:flex;flex-direction:column;align-items:center}
.ox .bimg img{position:relative;z-index:2;display:block;width:88%;height:auto;max-height:340px;object-fit:contain;border-radius:14px;filter:drop-shadow(0 24px 40px rgba(0,0,0,.6));animation:bFloat 6s ease-in-out infinite}
.ox .bglow{position:absolute;z-index:0;left:6%;right:6%;top:6%;bottom:16%;border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.55),rgba(124,92,255,.28) 45%,transparent 70%);filter:blur(28px);animation:bGlow 4s ease-in-out infinite}
.ox .bshadow{width:60%;height:18px;margin-top:14px;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.7),transparent);animation:bShadow 6s ease-in-out infinite}
.ox .bsp{position:absolute;inset:0;z-index:1;pointer-events:none}.ox .bsp i{position:absolute;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 10px 3px rgba(79,209,255,.9),0 0 20px 6px rgba(124,92,255,.5);opacity:0;animation:bSpark 3.2s ease-in-out infinite}
.ox .bcap{margin-top:10px;padding:6px 12px;border-radius:999px;background:rgba(6,10,20,.78);border:1px solid var(--line2);font-size:13px;font-weight:700;color:var(--tx);text-align:center}
@keyframes bFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}@keyframes bShadow{0%,100%{transform:scaleX(1);opacity:.9}50%{transform:scaleX(.85);opacity:.55}}
@keyframes bGlow{0%,100%{opacity:.75;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}@keyframes bSpark{0%{opacity:0;transform:scale(.3)}40%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.2) translateY(-18px)}}
@media (prefers-reduced-motion:reduce){.ox .bimg img,.ox .bglow,.ox .bshadow,.ox .bsp i{animation:none}.ox .bsp i{opacity:.6}}
.ox .bl{list-style:none;padding:0;margin:20px 0 0}.ox .bl li{display:flex;gap:10px;margin:10px 0;color:var(--tx2);font-size:16px;line-height:1.5}.ox .bl svg{flex:none;color:var(--teal);margin-top:4px}
@media (max-width:900px){.ox .bwrap{grid-template-columns:1fr}}
.ox .vers{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}.ox .ver{padding:22px;border-radius:22px;background:linear-gradient(160deg,rgba(20,32,58,.9),rgba(10,16,30,.9));border:1px solid var(--line2);text-align:center}
.ox .vimg{position:relative;height:210px;display:flex;align-items:center;justify-content:center}.ox .vimg img{position:relative;z-index:1;max-width:100%;max-height:200px;object-fit:contain;filter:drop-shadow(0 18px 26px rgba(0,0,0,.55));animation:bFloat 6s ease-in-out infinite}
.ox .vglow{position:absolute;inset:12% 14%;border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.35),rgba(124,92,255,.15) 50%,transparent 72%);filter:blur(18px)}
.ox .vtag{display:inline-block;margin-top:10px;padding:4px 14px;border-radius:999px;border:1px solid rgba(79,209,255,.4);color:var(--az);font-weight:850;letter-spacing:.16em;font-size:14px}.ox .ver b{display:block;margin-top:8px;font-size:16px}.ox .ver p{margin:8px 0 0;color:var(--tx2);font-size:14.5px;line-height:1.5}
.ox .veq{list-style:none;padding:14px 0 0;margin:14px 0 0;border-top:1px solid var(--line);text-align:left}.ox .veq li{display:flex;gap:8px;margin:7px 0;color:var(--tx2);font-size:14.5px;line-height:1.4}.ox .veq svg{flex:none;color:var(--teal);margin-top:1px}.ox .veq li.vm{color:var(--tx);font-weight:600}
@media (max-width:900px){.ox .vers{grid-template-columns:1fr}}
.ox .indbadge{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:9px 16px;border-radius:999px;border:1px solid rgba(47,227,198,.4);background:rgba(47,227,198,.08);color:#b6f5ea;font-weight:700;font-size:14.5px}
.ox .vpr{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);text-align:left}.ox .vph{font-size:12.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--az);margin-bottom:6px}
.ox .vr{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(120,160,255,.12);font-size:14px;color:var(--tx2)}.ox .vr b{color:var(--tx);white-space:nowrap}.ox .vr:last-child{border-bottom:0}
.ox .coop{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:stretch;margin-top:30px}.ox .cside h3{margin:6px 0 0;font-size:21px}.ox .ctag{align-self:flex-start;padding:5px 12px;border-radius:999px;font-size:12.5px;font-weight:800;letter-spacing:.06em;border:1px solid rgba(251,191,36,.45);color:#fcd34d;background:rgba(251,191,36,.08)}
.ox .cside.us .ctag{border-color:rgba(79,209,255,.45);color:var(--az);background:rgba(79,209,255,.08)}.ox .cside.us{border-color:rgba(79,209,255,.4)}.ox .carrow{align-self:center;font-size:30px;color:var(--az);opacity:.8}
.ox .cflow{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin-top:22px}.ox .cf{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:14px;background:rgba(14,22,40,.62);border:1px solid var(--line)}.ox .cf b{font-size:14.5px}.ox .cf small{color:var(--tx3);font-size:12px}
.ox .cn{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-weight:850;font-size:13px;background:var(--bg);border:1px solid var(--line2);color:var(--az)}.ox .cfa{color:var(--tx3)}
@media (max-width:900px){.ox .coop{grid-template-columns:1fr}.ox .carrow{transform:rotate(90deg);justify-self:center}}
.ox .proof .pi{font-style:normal;font-size:30px;display:block;margin-bottom:10px}.ox .proof b{-webkit-text-fill-color:currentColor}
.ox .proof{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:10px 0 0}.ox .proof div{padding:22px 24px;border-radius:20px;background:linear-gradient(160deg,rgba(20,32,58,.9),rgba(10,16,30,.9));border:1px solid var(--line2)}.ox .proof b{display:block;font-size:19px;font-weight:800;letter-spacing:-.01em;line-height:1.25}.ox .proof span{display:block;margin-top:8px;color:var(--tx2);font-size:15px;line-height:1.4}
@media (max-width:900px){.ox .proof{grid-template-columns:1fr}.ox .hero{grid-template-columns:1fr;gap:30px;padding-top:24px}.ox .visual{justify-self:center;max-width:400px}.ox .statcard{left:0}.ox .g3,.ox .models,.ox .sites{grid-template-columns:1fr}.ox .two{grid-template-columns:1fr}.ox .eco,.ox .cta{padding:24px}}
</style>
<div class="ox">
  <section class="hero" data-s="uvod"><div>
      <h1><span>${esc(h1a)}</span>${h1b ? `<span class="grad">${esc(h1b)}</span>` : ''}</h1>
      <p class="lead">${esc(o.perex || t.heroSub(o.company || ''))}</p>
      <ul class="chk">${t.chips.map((x) => `<li>${CHK}${esc(x)}</li>`).join('')}</ul>
      <div class="meta">${esc(t.kick)} ${esc(t.for)} <b>${c}</b>${valid ? ' · ' + esc(t.valid) + ' ' + esc(valid) : ''}</div>
    </div>
    <div class="visual"><div class="glow"></div><video src="/media/provoz.mp4" poster="/media/provoz-poster.jpg" autoplay muted loop playsinline preload="metadata"></video>
      <div class="statcard globe">${GLOBE}<div class="gt"><b>${CZF(20)} ${esc(X.statCard[0])}</b><p>🌍 ${esc(X.statCard[1])}</p></div></div></div>
  </section>
  <section class="sec brand" data-s="znacka" style="padding-top:20px">${kick(X.brandK)}<div class="bwrap"><div class="bimg"><div class="bglow"></div>${SPARKS}<img src="${o.image_v ? '/nabidka/' + token + '/img?v=' + o.image_v : '/img/model/flex'}" alt="${esc(X.brandCap(o.company || ''))}" data-zoom><div class="bshadow"></div><div class="bcap">${esc(o.image_v ? X.brandCap(o.company || '') : X.brandCap0)}</div></div>
    <div><h2>${esc(X.brandH(o.company || ''))}</h2><p class="sub">${esc(X.brandSub(o.company || ''))}</p><ul class="bl">${X.brandPts.map((x) => `<li>${CHK}<span>${esc(x)}</span></li>`).join('')}</ul></div></div></section>

  <section class="sec" data-s="verze" style="padding-top:20px">${kick(X.verK)}<h2>${esc(X.verH)}</h2><p class="sub">${esc(X.verSub)}</p><div class="indbadge">🏭 ${esc(X.verInd)}</div>
    <div class="vers">${(opts && Array.isArray(opts.models) && opts.models.length ? opts.models : ['mini', 'flex', 'max'].map((k) => ({ kind: k }))).map((m, i) => `<div class="ver"><div class="vimg"><div class="vglow"></div><img src="/img/model/${esc(m.kind)}" alt="${esc(m.kind.toUpperCase())}" loading="lazy" style="animation-delay:-${i * 2}s"></div><div class="vtag">${esc(m.kind.toUpperCase())}</div>${m.name && m.name.toUpperCase() !== m.kind.toUpperCase() ? `<b>${esc(m.name)}</b>` : ''}${m.desc ? `<p>${esc(m.desc)}</p>` : `<p>${esc(X.verDesc[m.kind] || '')}</p>`}<ul class="veq">${(X.verEq[m.kind] || []).map((x) => `<li class="vm">${CHK}<span>${esc(x)}</span></li>`).join('')}${X.verEqAll.map((x) => `<li>${CHK}<span>${esc(x)}</span></li>`).join('')}</ul>
      <div class="vpr"><div class="vph">⏱ ${esc(X.prH)}</div>${X.prTimes.map((r) => `<div class="vr"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}
      <div class="vph" style="margin-top:10px">💳 ${esc(X.prP)}</div>${(m.kind === 'flex' ? X.prPrices : X.prPrices.filter((r) => !r[2])).map((r) => `<div class="vr"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div></div>`).join('')}</div></section>

  <section class="sec" id="o-co-jde" data-s="spoluprace">${kick(X.coopK)}<h2>${esc(X.coopH)}</h2><p class="sub">${esc(X.coopSub(o.company || ''))}</p>
    <div class="coop"><div class="path cside"><div class="ctag">${c}</div><h3>${esc(X.coopA)}</h3><ul>${X.coopAList(o.company || '').map((x) => `<li>${CHK}<span>${esc(x)}</span></li>`).join('')}</ul></div>
      <div class="carrow" aria-hidden="true">⇄</div>
      <div class="path cside us"><div class="ctag">Laundromats.eu</div><h3>${esc(X.coopB)}</h3><ul>${X.coopBList.map((x) => `<li>${CHK}<span>${esc(x)}</span></li>`).join('')}</ul></div></div></section>


  <section class="sec" data-s="prinosy">${kick(X.ben)}<h2>${esc(t.benH)}</h2>
    <div class="grid g3">${t.ben(o.company || '').map((b, i) => `<div class="path"><div class="ico">${benIco(i)}</div><h3>${esc(b[1])}</h3><ul>${b[2].map((x) => `<li>${CHK}<span>${esc(x)}</span></li>`).join('')}</ul></div>`).join('')}</div></section>

  ${eco}

  ${pts.length ? `<section class="sec" data-s="pilot">${kick(X.pilot)}<h2>${esc(t.pilotH)}</h2><p class="sub">${esc(t.pilotSub)}</p><div class="tl">${pts.map((x) => `<div class="it"><span>${esc(x)}</span></div>`).join('')}</div></section>` : ''}

  <section class="sec" data-s="video">${kick(X.vid)}<h2>${esc(t.vidH)}</h2><div class="vids">
    <figure><video src="/media/provoz.mp4" poster="/media/provoz-poster.jpg" controls playsinline preload="none"></video><figcaption>${esc(t.vid1)}</figcaption></figure>
    <figure><video src="/media/krok.mp4" poster="/media/krok-poster.jpg" controls playsinline preload="none"></video><figcaption>${esc(t.vid2)}</figcaption></figure></div></section>

  <section class="sec" id="zajem" data-s="zajem">${kick(X.cta)}<div class="cta"><h2>${esc(t.ctaH)}</h2><p class="sub" style="margin-bottom:20px">${esc(t.ctaSub)}</p>
    ${o.interest ? `<p style="margin:0;font-weight:700">✓ ${esc(t.done)}</p>` : `<button class="btn btn-p" type="button" id="of-open">${esc(t.cta)} →</button>
    <form id="of-form" style="display:none;margin-top:4px"><div class="two"><div><label>${esc(t.name)}</label><input name="name" required maxlength="120"></div><div><label>${esc(t.phone)}</label><input name="phone" maxlength="40"></div></div>
      <label>${esc(t.email)}</label><input name="email" type="email" maxlength="160"><label>${esc(t.note)}</label><textarea name="note" rows="3" maxlength="1500"></textarea>
      <div style="margin-top:16px"><button class="btn btn-p" type="submit">${esc(t.send)}</button> <span class="small" id="of-msg"></span></div></form>`}
    ${o.sender_name || o.reply_to || o.sender_phone ? `<div class="contact">${esc(t.contact)}: <b style="color:var(--tx)">${esc(o.sender_name || 'Laundromats.eu')}</b>${o.sender_phone ? ` · <a href="tel:${esc(String(o.sender_phone).replace(/\s/g, ''))}">${esc(o.sender_phone)}</a>` : ''}${o.reply_to ? ` · <a href="mailto:${esc(o.reply_to)}">${esc(o.reply_to)}</a>` : ''}</div>` : ''}
  </div></section>
</div>
<div class="zoom" id="ox-zoom" hidden><button type="button" class="zx" aria-label="Zavřít">✕</button><img alt=""></div>
<script>(function(){var z=document.getElementById('ox-zoom'),zi=z.querySelector('img');function close(){z.hidden=true;document.body.style.overflow='';}
document.querySelectorAll('[data-zoom]').forEach(function(im){im.addEventListener('click',function(){zi.src=im.currentSrc||im.src;zi.alt=im.alt;z.hidden=false;document.body.style.overflow='hidden';});});
z.addEventListener('click',function(e){if(e.target!==zi)close();});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!z.hidden)close();});})();</script>
<script>(function(){var b=document.getElementById('of-open'),f=document.getElementById('of-form');if(!b)return;b.onclick=function(){f.style.display='';b.style.display='none';f.querySelector('input').focus();};
f.onsubmit=function(e){e.preventDefault();var m=document.getElementById('of-msg'),d={};new FormData(f).forEach(function(v,k){d[k]=v;});f.querySelector('button').disabled=true;
fetch('/nabidka/${token}/zajem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){if(!r.ok)throw 0;f.outerHTML='<p style="margin:0;font-weight:700">✓ ${esc(t.thanks).replace(/'/g, "\\'")}</p>';}).catch(function(){m.textContent='${esc(t.err).replace(/'/g, "\\'")}';f.querySelector('button').disabled=false;});};})();<\/script>`;
  // Sledování pohybu na stránce (každá nabídka má vlastní adresu → víme, kdo a jak dlouho ji čte). Náhled z administrace se nesleduje.
  const TRACK = preview ? '' : `<script>(function(){var T='${token}',V=(Date.now().toString(36)+Math.random().toString(36).slice(2,8)),q=[],secs=0,sc=0,last=Date.now(),seen={};
function tick(){var n=Date.now();if(!document.hidden)secs+=Math.min(n-last,30000)/1000;last=n;}
function scr(){var h=document.documentElement,p=(h.scrollTop+innerHeight)/Math.max(1,h.scrollHeight)*100;if(p>sc)sc=p;}
function send(fin){tick();var b=JSON.stringify({visit:V,secs:Math.round(secs),scroll:Math.round(sc),events:q.splice(0),ua:navigator.userAgent});
try{fetch('/nabidka/'+T+'/ev',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true});}catch(e){}}
addEventListener('scroll',scr,{passive:true});scr();
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){var k=e.target.getAttribute('data-s');if(e.isIntersecting&&!seen[k]){seen[k]=1;q.push({k:'section',v:k});}});},{threshold:.35});document.querySelectorAll('[data-s]').forEach(function(x){io.observe(x);});}
document.addEventListener('click',function(e){var a=e.target.closest('a,button');if(a)q.push({k:'click',v:(a.textContent||a.getAttribute('href')||'').trim().slice(0,60)});});
document.querySelectorAll('video[controls]').forEach(function(v){v.addEventListener('play',function(){q.push({k:'video',v:(v.closest('figure')&&v.closest('figure').textContent.trim())||v.getAttribute('src')});});});
var f=document.getElementById('of-form');if(f){var o=document.getElementById('of-open');if(o)o.addEventListener('click',function(){q.push({k:'form',v:'otevřen'});});f.addEventListener('submit',function(){q.push({k:'form',v:'odeslán'});send();});}
document.addEventListener('visibilitychange',function(){tick();if(document.hidden)send(1);});setInterval(function(){if(!document.hidden)send();},15000);setTimeout(send,3000);addEventListener('pagehide',function(){send(1);});})();<\/script>`;
  let html = layout({ title: (o.title || t.kick) + ' — ' + (o.company || ''), back: false, body: body + TRACK }).replace('<html lang="cs">', '<html lang="' + L + '">');
  // Nabídka je samostatná stránka: bez menu webu a bez čísla verze (zůstává logo a přepínač jazyka)
  html = html.replace(/<nav class="lnav"[\s\S]*?<\/nav>/, '').replace(/<span class="lsp">[\s\S]*?<!--\/PRIV--><\/span>/, '<span class="lsp"></span>').replace(/(<a class="brand") href="[^"]*"/, '$1 href="#"');
  return html;
}

module.exports = { offerPage, REFS, T };
