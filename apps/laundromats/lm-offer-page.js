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
    canH: 'Co prádlomat umí', canSub: 'Kompaktní venkovní kontejner — postaví se na parkoviště, stačí přípojka vody, kanalizace a elektřiny.',
    can: [['🫧', 'Pračky 8 kg a 18 kg', 'Běžné prádlo i peřiny, deky, pracovní oděvy.'], ['🌀', 'Sušička 18 kg', 'Usuší celou várku během nákupu.'], ['💳', 'Bezhotovostní platby', 'Karta, Apple Pay, Google Pay, věrnostní program.'], ['📡', 'Vzdálený dohled', 'Monitoring a diagnostika 24/7, servis často na dálku.'], ['🌙', 'Provoz 24/7', 'Bez personálu, bez zásahu do chodu prodejny.'], ['🏷️', 'Vaše značka', 'Polep, barvy i aplikace v identitě obchodní značky.']],
    models: 'Varianty prádlomatu',
    benH: 'Co pilotní projekt přinese',
    ben: (c) => [['🏪', `Pro ${c}`, ['Nový, stabilní zdroj tržeb z parkovací plochy, která dnes nevydělává.', 'Vyšší a pravidelnější návštěvnost — zákazník přijede dvakrát (prádlo + vyzvednutí).', 'Delší čas v prodejně = vyšší útrata.', 'Žádný personál, provoz a servis na klíč.']], ['🙂', 'Pro zákazníky', ['Vyprat a usušit během nákupu — ušetřený čas.', 'Velké kusy (peřiny, deky), na které doma není pračka.', 'Dostupné 24/7, platba kartou i mobilem.', 'Služba navíc v místě, kam stejně jezdí.']], ['⭐', 'Pro značku', ['Inovativní služba, která odliší síť prodejen od konkurence.', 'Udržitelnost — úsporné stroje, ekologické prací prostředky.', 'Viditelný branding na parkovišti, 24 hodin denně.', 'Data o využití a spokojenosti zákazníků.']]],
    refH: 'Funguje to už jinde', refSub: 'Prádlomaty provozujeme u čerpacích stanic a obchodních center v Česku i v zahraničí.',
    pilotH: 'Pilotní projekt', pilotSub: 'Jak bychom začali — konkrétní podmínky doladíme společně.',
    ecoH: 'Ekonomika pilotu', ecoSub: 'Orientační čísla — ekonomiku ověříme podle konkrétních lokalit.',
    units: 'Počet prádlomatů', inv: 'Investice celkem', unit: 'cena za prádlomat', mon: 'Čistý výsledek / měsíc', monU: 'na prádlomat', pay: 'Návratnost', months: 'měsíců', y5: 'Výsledek za 5 let', chart: 'Kumulovaný výsledek pilotu (orientačně)', start: 'start', yr: 'rok', vat: 'Ceny bez DPH. Nejde o garantovaný výsledek — odvozeno z provozu existujících prádlomatů.', model: 'Model',
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
    canH: 'What the laundromat does', canSub: 'A compact outdoor container — placed in the car park, needs only water, sewage and power connections.',
    can: [['🫧', '8 kg and 18 kg washers', 'Everyday laundry plus duvets, blankets, workwear.'], ['🌀', '18 kg dryer', 'Dries a full load during the shopping trip.'], ['💳', 'Cashless payments', 'Card, Apple Pay, Google Pay, loyalty programme.'], ['📡', 'Remote monitoring', '24/7 monitoring and diagnostics, much of the service done remotely.'], ['🌙', 'Open 24/7', 'No staff, no impact on store operations.'], ['🏷️', 'Your brand', 'Wrap, colours and app in your retail brand identity.']],
    models: 'Laundromat variants',
    benH: 'What the pilot delivers',
    ben: (c) => [['🏪', `For ${c}`, ['A new, stable revenue stream from car-park space that earns nothing today.', 'Higher, more regular footfall — customers come twice (drop-off + pick-up).', 'Longer time in store = bigger basket.', 'No staff; operations and service turnkey.']], ['🙂', 'For customers', ['Wash and dry while shopping — time saved.', 'Large items (duvets, blankets) that don’t fit a home machine.', 'Available 24/7, card and mobile payments.', 'An extra service where they already shop.']], ['⭐', 'For the brand', ['An innovative service that sets the store network apart.', 'Sustainability — efficient machines, eco detergents.', 'Visible branding in the car park, 24 hours a day.', 'Data on usage and customer satisfaction.']]],
    refH: 'Already working elsewhere', refSub: 'We operate laundromats at petrol stations and shopping centres in Czechia and abroad.',
    pilotH: 'Pilot project', pilotSub: 'How we would start — details to be agreed together.',
    ecoH: 'Pilot economics', ecoSub: 'Indicative figures — to be validated for the specific locations.',
    units: 'Number of machines', inv: 'Total investment', unit: 'per machine', mon: 'Net result / month', monU: 'per machine', pay: 'Payback', months: 'months', y5: '5-year result', chart: 'Cumulative pilot result (indicative)', start: 'start', yr: 'year', vat: 'Prices excl. VAT. Not a guaranteed result — derived from existing operations.', model: 'Model',
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
    canH: 'Co potrafi urządzenie', canSub: 'Kompaktowy kontener zewnętrzny — stoi na parkingu, wymaga tylko przyłącza wody, kanalizacji i prądu.',
    can: [['🫧', 'Pralki 8 kg i 18 kg', 'Codzienne pranie oraz kołdry, koce, odzież robocza.'], ['🌀', 'Suszarka 18 kg', 'Suszy cały wsad w trakcie zakupów.'], ['💳', 'Płatności bezgotówkowe', 'Karta, Apple Pay, Google Pay, program lojalnościowy.'], ['📡', 'Zdalny nadzór', 'Monitoring i diagnostyka 24/7, serwis często zdalnie.'], ['🌙', 'Czynne 24/7', 'Bez personelu, bez wpływu na pracę sklepu.'], ['🏷️', 'Państwa marka', 'Oklejenie, kolory i aplikacja w identyfikacji marki.']],
    models: 'Warianty urządzenia',
    benH: 'Co da projekt pilotażowy',
    ben: (c) => [['🏪', `Dla ${c}`, ['Nowe, stabilne źródło przychodu z powierzchni parkingu.', 'Wyższy i regularniejszy ruch — klient przyjeżdża dwa razy.', 'Dłuższy czas w sklepie = większy koszyk.', 'Bez personelu, obsługa i serwis pod klucz.']], ['🙂', 'Dla klientów', ['Pranie i suszenie w trakcie zakupów — oszczędność czasu.', 'Duże rzeczy (kołdry, koce), które nie mieszczą się w domowej pralce.', 'Dostępne 24/7, płatność kartą i telefonem.', 'Dodatkowa usługa tam, gdzie i tak robią zakupy.']], ['⭐', 'Dla marki', ['Innowacyjna usługa wyróżniająca sieć sklepów.', 'Zrównoważony rozwój — oszczędne urządzenia, ekologiczne środki.', 'Widoczny branding na parkingu, 24 godziny na dobę.', 'Dane o wykorzystaniu i zadowoleniu klientów.']]],
    refH: 'To już działa gdzie indziej', refSub: 'Prowadzimy pralnie przy stacjach paliw i centrach handlowych w Czechach i za granicą.',
    pilotH: 'Projekt pilotażowy', pilotSub: 'Jak byśmy zaczęli — szczegóły ustalimy wspólnie.',
    ecoH: 'Ekonomika pilotażu', ecoSub: 'Liczby orientacyjne — do weryfikacji dla konkretnych lokalizacji.',
    units: 'Liczba urządzeń', inv: 'Inwestycja łącznie', unit: 'za urządzenie', mon: 'Wynik netto / miesiąc', monU: 'na urządzenie', pay: 'Zwrot', months: 'miesięcy', y5: 'Wynik za 5 lat', chart: 'Skumulowany wynik pilotażu (orientacyjnie)', start: 'start', yr: 'rok', vat: 'Ceny netto. To nie jest gwarantowany wynik — na podstawie istniejących punktów.', model: 'Model',
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

function chartSvg(invest, monthly, t) {
  // kumulovaný výsledek 0–60 měsíců: start na −investice, roste o měsíční výsledek
  const W = 760, H = 240, P = 36, N = 60;
  const ys = Array.from({ length: N + 1 }, (_, m) => -invest + monthly * m);
  const lo = Math.min(...ys, 0), hi = Math.max(...ys, 0), span = hi - lo || 1;
  const x = (m) => P + (W - 2 * P) * m / N, y = (v) => H - P - (H - 2 * P) * (v - lo) / span;
  const pts = ys.map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const be = monthly > 0 ? invest / monthly : null;
  const yrs = [0, 12, 24, 36, 48, 60].map((m) => `<line x1="${x(m)}" y1="${P / 2}" x2="${x(m)}" y2="${H - P}" stroke="rgba(255,255,255,.06)"/><text x="${x(m)}" y="${H - 10}" fill="#8ea2c2" font-size="12" text-anchor="middle">${m ? (m / 12) + '. ' + t.yr : t.start}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(t.chart)}"><defs><linearGradient id="og" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2dd4bf" stop-opacity=".35"/><stop offset="1" stop-color="#2dd4bf" stop-opacity="0"/></linearGradient></defs>
  ${yrs}<line x1="${P}" y1="${y(0)}" x2="${W - P}" y2="${y(0)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="4 4"/>
  <polygon points="${x(0)},${y(0)} ${pts} ${x(N)},${y(0)}" fill="url(#og)"/><polyline points="${pts}" fill="none" stroke="#2dd4bf" stroke-width="3"/>
  ${be && be <= N ? `<circle cx="${x(be)}" cy="${y(0)}" r="6" fill="#22c55e"/><text x="${x(be)}" y="${y(0) - 12}" fill="#22c55e" font-size="13" font-weight="700" text-anchor="middle">${t.pay} ≈ ${Math.ceil(be)} ${t.months}</text>` : ''}</svg>`;
}

const CHK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
const PIN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const EXTRA = {
  cs: { brandK: 'Vaše značka', brandH: (c) => `Prádlomat v barvách ${c}`, brandSub: (c) => `Prádlomat personalizujeme podle vizuální identity ${c} — zákazník vidí službu ${c}, ne cizí stroj.`, brandPts: ['Polep a barvy podle vašeho brand manuálu', 'Logo a název služby podle vašeho přání', 'Platební obrazovka a aplikace ve vaší identitě', 'Vizualizaci připravíme před spuštěním pilotu'], brandCap: (c) => `Vizualizace prádlomatu pro ${c}`, brandCap0: 'Ukázka prádlomatu — vizualizaci ve vašich barvách připravíme', statCard: ['Vyrobeno v České republice', 'Dodáváme kamkoli na světě'], proof: [['CZFLAG', 'Vyrobeno v České republice', 'Vývoj i výroba u nás — ryze český výrobek.'], ['🌍', 'Dodáváme kamkoli na světě', 'Doprava, instalace a uvedení do provozu na klíč.'], ['🛠️', 'Vlastní provoz a servis', 'Prádlomaty sami provozujeme — víme, co v praxi funguje.']], eyebrow: 'Více než 150 prádlomatů dodaných po Evropě · ryze český výrobek', statTxt: (n, c) => `prádlomatů v pilotním projektu pro ${c}.`, statAlt: 'Více než 150 prádlomatů dodaných po Evropě.', sites: 'Skutečné provozovny', what: 'O co jde', can: 'Co prádlomat umí', ben: 'Přínosy', eco: 'Ekonomika', pilot: 'Pilot', vid: 'Video', cta: 'Další krok' },
  en: { brandK: 'Your brand', brandH: (c) => `A laundromat in ${c} colours`, brandSub: (c) => `We personalise the laundromat to the ${c} visual identity — customers see a ${c} service, not someone else's machine.`, brandPts: ['Wrap and colours according to your brand manual', 'Logo and service name as you wish', 'Payment screen and app in your identity', 'We prepare a visualisation before the pilot starts'], brandCap: (c) => `Laundromat visualisation for ${c}`, brandCap0: 'Sample laundromat — we will prepare a visualisation in your colours', statCard: ['Made in the Czech Republic', 'Delivered anywhere in the world'], proof: [['CZFLAG', 'Made in the Czech Republic', 'Designed and built in-house — a genuinely Czech product.'], ['🌍', 'Delivered anywhere in the world', 'Transport, installation and commissioning turnkey.'], ['🛠️', 'Our own operations & service', 'We run laundromats ourselves — we know what works.']], eyebrow: 'Over 150 laundromats delivered across Europe · made in Czechia', statTxt: (n, c) => `laundromats in the pilot project for ${c}.`, statAlt: 'Over 70 laundromats we operate ourselves in the Czech Republic.', sites: 'Real sites', what: 'What it is', can: 'What it does', ben: 'Benefits', eco: 'Economics', pilot: 'Pilot', vid: 'Video', cta: 'Next step' },
  pl: { brandK: 'Państwa marka', brandH: (c) => `Pralnia w barwach ${c}`, brandSub: (c) => `Personalizujemy urządzenie zgodnie z identyfikacją wizualną ${c} — klient widzi usługę ${c}, nie cudzą maszynę.`, brandPts: ['Oklejenie i kolory zgodnie z księgą znaku', 'Logo i nazwa usługi według Państwa życzenia', 'Ekran płatności i aplikacja w Państwa identyfikacji', 'Wizualizację przygotujemy przed startem pilotażu'], brandCap: (c) => `Wizualizacja urządzenia dla ${c}`, brandCap0: 'Przykładowe urządzenie — wizualizację w Państwa barwach przygotujemy', statCard: ['Wyprodukowano w Czechach', 'Dostarczamy na cały świat'], proof: [['CZFLAG', 'Wyprodukowano w Czechach', 'Projekt i produkcja u nas — czeski produkt.'], ['🌍', 'Dostarczamy na cały świat', 'Transport, instalacja i uruchomienie pod klucz.'], ['🛠️', 'Własna eksploatacja i serwis', 'Sami prowadzimy pralnie — wiemy, co działa.']], eyebrow: 'Ponad 150 urządzeń dostarczonych w Europie · czeski produkt', statTxt: (n, c) => `urządzeń w projekcie pilotażowym dla ${c}.`, statAlt: 'Ponad 70 pralni, które sami prowadzimy w Czechach.', sites: 'Prawdziwe punkty', what: 'Na czym to polega', can: 'Co potrafi', ben: 'Korzyści', eco: 'Ekonomika', pilot: 'Pilotaż', vid: 'Wideo', cta: 'Kolejny krok' },
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
  const eco = units && price ? `<section class="sec" id="eko" data-s="ekonomika">${kick(X.eco)}<h2>${esc(t.ecoH)}</h2><p class="sub">${esc(t.ecoSub)}</p><div class="eco">
    <div class="kpis">${kpi(t.units, String(units), o.model ? esc(t.model + ' ' + o.model) : '')}${kpi(t.inv, money(invest, o.currency), money(price, o.currency) + ' ' + esc(t.unit))}${mon ? kpi(t.mon, money(monAll, o.currency), money(mon, o.currency) + ' ' + esc(t.monU)) + kpi(t.pay, '≈ ' + Math.ceil(invest / monAll) + ' ' + esc(t.months), '') + kpi(t.y5, money(monAll * 60 - invest, o.currency), '') : ''}</div>
    ${mon ? `<div class="chart"><div class="ph">${esc(t.chart)}</div>${chartSvg(invest, monAll, t)}</div>` : ''}<p class="fine">${esc(t.vat)}</p></div></section>` : '';
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
.ox .visual{position:relative;justify-self:end;width:100%;max-width:560px}
.ox .visual .glow{position:absolute;inset:4%;border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.35),rgba(58,108,245,.18) 45%,transparent 70%);filter:blur(10px)}
.ox .visual video{position:relative;display:block;width:78%;margin:0 auto;aspect-ratio:9/16;height:auto;object-fit:cover;border-radius:26px;border:1px solid var(--line2);background:#0b1220;box-shadow:0 30px 60px -20px rgba(0,0,0,.8),0 0 0 6px rgba(79,209,255,.06)}
.ox .statcard{position:absolute;left:-8%;bottom:-4%;max-width:230px;padding:14px 16px;border-radius:18px;background:rgba(10,16,30,.85);border:1px solid var(--line2);backdrop-filter:blur(12px);box-shadow:0 20px 50px -20px rgba(0,0,0,.8)}
.ox .statcard b{display:block;font-size:34px;line-height:1;font-weight:850;letter-spacing:-.03em}.ox .statcard p{margin:8px 0 0;font-size:14px;color:var(--tx2);line-height:1.45}
.ox .sec{padding:70px 0 0;scroll-margin-top:70px}.ox .kicker{font-size:12.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--az);margin-bottom:14px}
.ox h2{font-size:clamp(28px,3.4vw,42px);font-weight:820}.ox .sub{color:var(--tx2);margin:12px 0 0;font-size:17px;max-width:760px;line-height:1.55}
.ox .grid{display:grid;gap:18px;margin-top:36px}.ox .g3{grid-template-columns:repeat(3,1fr)}
.ox .card{background:rgba(14,22,40,.62);border:1px solid var(--line);border-radius:20px;padding:26px;backdrop-filter:blur(6px)}
.ox .ico{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:linear-gradient(135deg,rgba(79,209,255,.16),rgba(124,92,255,.12));border:1px solid rgba(79,209,255,.22);margin-bottom:18px}
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
.ox .chart{margin-top:22px;position:relative}.ox .ph{font-weight:700;margin-bottom:8px;color:var(--tx2)}.ox .fine{color:var(--tx3);font-size:13px;margin:14px 0 0;position:relative}
.ox .vids{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:30px;max-width:900px}.ox .vids figure{margin:0}.ox .vids video{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:18px;border:1px solid var(--line2);background:#0b1426;display:block}.ox .vids figcaption{margin-top:10px;color:var(--tx2);font-size:14px;font-weight:600}
.ox .cta{margin-top:30px;border-radius:28px;padding:40px;background:linear-gradient(135deg,rgba(30,134,224,.18),rgba(124,92,255,.16));border:1px solid rgba(79,209,255,.4)}
.ox .cta label{display:block;font-size:14px;font-weight:600;margin:12px 0 6px}.ox .cta input,.ox .cta textarea{width:100%;box-sizing:border-box;min-height:50px;padding:12px 14px;border-radius:12px;border:1px solid var(--line2);background:rgba(4,6,12,.6);color:var(--tx);font:inherit}
.ox .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ox .contact{margin-top:22px;padding-top:16px;border-top:1px solid var(--line2);color:var(--tx2)}.ox .contact a{color:var(--az)}
.ox .statcard.globe{max-width:300px;padding:12px 14px 14px;left:-10%;bottom:-6%}.ox .globe > svg{display:block;width:100%;height:auto}.ox .globe .gt b{display:flex;align-items:center;gap:6px;font-size:15px;font-weight:800;letter-spacing:0;margin-top:6px}.ox .globe .gt p{margin:4px 0 0;font-size:13.5px}
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
  <section class="sec brand" data-s="znacka" style="padding-top:20px">${kick(X.brandK)}<div class="bwrap"><div class="bimg"><div class="bglow"></div>${SPARKS}<img src="${o.image_v ? '/nabidka/' + token + '/img?v=' + o.image_v : '/img/model/flex'}" alt="${esc(X.brandCap(o.company || ''))}"><div class="bshadow"></div><div class="bcap">${esc(o.image_v ? X.brandCap(o.company || '') : X.brandCap0)}</div></div>
    <div><h2>${esc(X.brandH(o.company || ''))}</h2><p class="sub">${esc(X.brandSub(o.company || ''))}</p><ul class="bl">${X.brandPts.map((x) => `<li>${CHK}<span>${esc(x)}</span></li>`).join('')}</ul></div></div></section>

  ${refs.length ? `<section class="sec" data-s="provozovny" style="padding-top:20px">${kick(X.sites)}<div class="sites">${refs.map((r) => `<figure class="site">${r[2] ? `<img src="${esc(r[2])}" alt="${esc(r[0])}" loading="lazy">` : ''}<figcaption>${PIN}${esc(r[0])}</figcaption>${r[1] ? `<small>${esc(r[1])}</small>` : ''}</figure>`).join('')}</div></section>` : ''}

  <section class="sec" id="o-co-jde" data-s="o-co-jde">${kick(X.what)}<h2>${esc(t.whatH)}</h2><p class="sub">${esc(t.whatSub)}</p>
    <div class="grid g3">${t.steps.map((s, i) => `<div class="card step"><div class="n">${i + 1}</div><h3>${esc(s[1])}</h3><p>${esc(s[2])}</p></div>`).join('')}</div></section>

  <section class="sec" data-s="co-umi">${kick(X.can)}<h2>${esc(t.canH)}</h2><p class="sub">${esc(t.canSub)}</p>
    <div class="grid g3">${t.can.map((s) => `<div class="card"><div class="ico">${s[0]}</div><h3>${esc(s[1])}</h3><p>${esc(s[2])}</p></div>`).join('')}</div>
    <div class="models">${['mini', 'flex', 'max'].map((m) => `<figure><img src="/img/model/${m}" alt="${m.toUpperCase()}" loading="lazy"><figcaption>${m.toUpperCase()}</figcaption></figure>`).join('')}</div></section>

  <section class="sec" data-s="prinosy">${kick(X.ben)}<h2>${esc(t.benH)}</h2>
    <div class="grid g3">${t.ben(o.company || '').map((b) => `<div class="path"><div class="ico">${b[0]}</div><h3>${esc(b[1])}</h3><ul>${b[2].map((x) => `<li>${CHK}<span>${esc(x)}</span></li>`).join('')}</ul></div>`).join('')}</div></section>

  ${pts.length ? `<section class="sec" data-s="pilot">${kick(X.pilot)}<h2>${esc(t.pilotH)}</h2><p class="sub">${esc(t.pilotSub)}</p><div class="tl">${pts.map((x) => `<div class="it"><span>${esc(x)}</span></div>`).join('')}</div></section>` : ''}

  ${eco}

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
