// Laundromats — veřejná stránka obchodního návrhu pro korporát (/nabidka/<token>).
// Prezentační landing: video, o co jde, co prádlomat umí, přínosy (firma / zákazníci / značka), reference,
// pilotní projekt, ekonomika s grafem, video „jak se používá", CTA. Text dopisu je jen v e-mailu.
'use strict';
const { layout, esc } = require('./lm-layout');

const T = {
  cs: {
    kick: 'Obchodní návrh', for: 'pro', valid: 'Platnost návrhu do',
    heroSub: (c) => `Samoobslužná prádelna přímo u vašich prodejen — provozovaná pod značkou ${c}, dodaná a spravovaná na klíč.`,
    chips: ['24/7 bez obsluhy', 'Pod vaší značkou', 'Dodání a servis na klíč', 'Platba kartou i mobilem'],
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
    chips: ['24/7, unstaffed', 'Under your brand', 'Turnkey delivery & service', 'Card & mobile payments'],
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
    chips: ['24/7 bez obsługi', 'Pod Państwa marką', 'Dostawa i serwis pod klucz', 'Płatność kartą i telefonem'],
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

function offerPage(o, token) {
  const L = o.lang === 'en' ? 'en' : o.lang === 'pl' ? 'pl' : 'cs', t = T[L];
  const c = esc(o.company || '');
  const pts = String(o.points || '').split('\n').map((x) => x.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  const refs = String(o.refs || REFS[L]).split('\n').map((r) => r.split('|').map((x) => x.trim())).filter((r) => r[0]);
  const units = Number(o.units) || 0, price = Number(o.unit_price) || 0, mon = Number(o.monthly_revenue) || 0;
  const invest = units * price, monAll = units * mon;
  const valid = o.valid_until ? new Date(o.valid_until + 'T12:00:00').toLocaleDateString(L === 'en' ? 'en-GB' : L === 'pl' ? 'pl-PL' : 'cs-CZ') : '';
  const kpi = (lbl, val, sub) => `<div class="k"><div class="kl">${esc(lbl)}</div><div class="kv">${val}</div>${sub ? `<div class="ks">${sub}</div>` : ''}</div>`;
  const eco = units && price ? `<section class="sec" id="eko"><h2>${esc(t.ecoH)}</h2><p class="sub">${esc(t.ecoSub)}</p>
    <div class="kpis">${kpi(t.units, String(units), o.model ? esc(t.model + ' ' + o.model) : '')}${kpi(t.inv, money(invest, o.currency), money(price, o.currency) + ' ' + esc(t.unit))}${mon ? kpi(t.mon, money(monAll, o.currency), money(mon, o.currency) + ' ' + esc(t.monU)) + kpi(t.pay, '≈ ' + Math.ceil(invest / monAll) + ' ' + esc(t.months), '') + kpi(t.y5, money(monAll * 60 - invest, o.currency), '') : ''}</div>
    ${mon ? `<div class="panel"><div class="ph">${esc(t.chart)}</div>${chartSvg(invest, monAll, t)}</div>` : ''}<p class="fine">${esc(t.vat)}</p></section>` : '';
  const body = `<style>
.ox{--a:#2dd4bf;--b:#60a5fa;max-width:1120px;margin:0 auto;padding:0 6px 60px}
.ox .hero{position:relative;border-radius:26px;overflow:hidden;margin:18px 0 10px;min-height:440px;display:flex;align-items:flex-end;border:1px solid rgba(120,160,255,.25)}
.ox .hero video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.55)}
.ox .hero:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,6,12,.1) 0%,rgba(4,6,12,.85) 85%)}
.ox .hin{position:relative;z-index:1;padding:34px 34px 30px;max-width:780px}.ox .kick{color:var(--a);font-weight:800;letter-spacing:.1em;text-transform:uppercase;font-size:12px}
.ox h1{font-size:44px;line-height:1.08;margin:8px 0 10px}.ox .lead{font-size:18px;line-height:1.5;color:#dbe6f7;margin:0 0 14px}
.ox .chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}.ox .chip{padding:6px 12px;border-radius:99px;background:rgba(45,212,191,.12);border:1px solid rgba(45,212,191,.35);color:#c9fbf3;font-size:13px;font-weight:700}
.ox .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.ox .btn{font-size:15px;padding:12px 18px;text-decoration:none;display:inline-block}.ox .ghost{background:transparent;border:1px solid rgba(255,255,255,.3);color:#fff}
.ox .meta{color:#9fb0c8;font-size:13px;margin-top:14px}
.ox .sec{margin:54px 0 0}.ox h2{font-size:30px;margin:0 0 6px}.ox .sub{color:#9fb0c8;margin:0 0 20px;font-size:16px}
.ox .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.ox .g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ox .tile{background:rgba(13,20,36,.85);border:1px solid rgba(120,160,255,.18);border-radius:18px;padding:18px}.ox .tile .ic{font-size:30px}.ox .tile b{display:block;font-size:17px;margin:8px 0 4px}.ox .tile p{margin:0;color:#b6c4d8;line-height:1.5;font-size:14.5px}
.ox .step{position:relative}.ox .step .n{position:absolute;top:14px;right:16px;color:rgba(255,255,255,.12);font-size:44px;font-weight:900}
.ox .models{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px}.ox .models figure{margin:0;background:rgba(13,20,36,.85);border:1px solid rgba(120,160,255,.18);border-radius:18px;padding:12px;text-align:center}.ox .models img{width:100%;height:190px;object-fit:contain}.ox .models figcaption{font-weight:800;letter-spacing:.06em}
.ox .ben{border-top:3px solid var(--a)}.ox .ben:nth-child(2){border-top-color:var(--b)}.ox .ben:nth-child(3){border-top-color:#fbbf24}.ox .ben ul{margin:10px 0 0;padding-left:18px;color:#c9d6ea;line-height:1.55}.ox .ben li{margin:4px 0}
.ox .ref{padding:0;overflow:hidden}.ox .ref img{width:100%;height:220px;object-fit:cover;display:block}.ox .ref div{padding:14px 16px}
.ox .tl{counter-reset:s;display:grid;gap:10px}.ox .tl .it{display:flex;gap:14px;align-items:flex-start;background:rgba(13,20,36,.85);border:1px solid rgba(120,160,255,.18);border-radius:14px;padding:14px 16px}
.ox .tl .it:before{counter-increment:s;content:counter(s);flex:0 0 32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--a),var(--b));color:#04121a;font-weight:900;display:flex;align-items:center;justify-content:center}.ox .tl .it span{line-height:1.5;padding-top:5px}
.ox .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.ox .k{background:rgba(13,20,36,.85);border:1px solid rgba(45,212,191,.3);border-radius:16px;padding:14px 16px}.ox .kl{color:#9fb0c8;font-size:13px}.ox .kv{font-size:26px;font-weight:900;color:#5eead4;margin:4px 0 2px}.ox .ks{color:#8ea2c2;font-size:12.5px}
.ox .panel{margin-top:14px;background:rgba(13,20,36,.85);border:1px solid rgba(120,160,255,.18);border-radius:18px;padding:16px}.ox .ph{font-weight:700;margin-bottom:6px}.ox .fine{color:#8ea2c2;font-size:12.5px;margin:10px 0 0}
.ox .vids{display:grid;grid-template-columns:1fr 1fr;gap:14px}.ox .vids video{width:100%;aspect-ratio:9/16;max-height:620px;object-fit:cover;border-radius:18px;border:1px solid rgba(120,160,255,.2);background:#0b1426}.ox .vids figure{margin:0}.ox .vids figcaption{color:#9fb0c8;font-size:13px;margin-top:6px;text-align:center}
.ox .cta{background:linear-gradient(135deg,rgba(45,212,191,.16),rgba(96,165,250,.12));border:1px solid rgba(45,212,191,.45);border-radius:22px;padding:28px}.ox .cta label{display:block;font-size:13px;margin:10px 0 4px;color:#9fb0c8}.ox .cta input,.ox .cta textarea{width:100%;box-sizing:border-box}
@media(max-width:820px){.ox h1{font-size:30px}.ox .g3,.ox .models{grid-template-columns:1fr}.ox .g2,.ox .vids{grid-template-columns:1fr}.ox .hin{padding:22px}.ox .hero{min-height:380px}}
</style>
<div class="ox">
  <section class="hero"><video src="/media/provoz.mp4" poster="/media/provoz-poster.jpg" autoplay muted loop playsinline preload="metadata"></video>
    <div class="hin"><div class="kick">${esc(t.kick)} ${esc(t.for)} ${c}</div>
      <h1>${esc(o.title || '')}</h1>
      <p class="lead">${esc(o.perex || t.heroSub(o.company || ''))}</p>
      <div class="chips">${t.chips.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>
      <div class="row"><a class="btn" href="#zajem">${esc(t.ctaTop)}</a><a class="btn ghost" href="#o-co-jde">${esc(t.scroll)} ↓</a></div>
      ${valid ? `<div class="meta">${esc(t.valid)} ${esc(valid)}</div>` : ''}</div></section>

  <section class="sec" id="o-co-jde"><h2>${esc(t.whatH)}</h2><p class="sub">${esc(t.whatSub)}</p>
    <div class="g3">${t.steps.map((s, i) => `<div class="tile step"><span class="n">${i + 1}</span><div class="ic">${s[0]}</div><b>${esc(s[1])}</b><p>${esc(s[2])}</p></div>`).join('')}</div></section>

  <section class="sec"><h2>${esc(t.canH)}</h2><p class="sub">${esc(t.canSub)}</p>
    <div class="g3">${t.can.map((s) => `<div class="tile"><div class="ic">${s[0]}</div><b>${esc(s[1])}</b><p>${esc(s[2])}</p></div>`).join('')}</div>
    <div class="models">${['mini', 'flex', 'max'].map((m) => `<figure><img src="/img/model/${m}" alt="${m.toUpperCase()}" loading="lazy"><figcaption>${m.toUpperCase()}</figcaption></figure>`).join('')}</div></section>

  <section class="sec"><h2>${esc(t.benH)}</h2>
    <div class="g3">${t.ben(o.company || '').map((b) => `<div class="tile ben"><div class="ic">${b[0]}</div><b>${esc(b[1])}</b><ul>${b[2].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div></section>

  ${refs.length ? `<section class="sec"><h2>${esc(t.refH)}</h2><p class="sub">${esc(t.refSub)}</p>
    <div class="g3">${refs.map((r) => `<div class="tile ref">${r[2] ? `<img src="${esc(r[2])}" alt="${esc(r[0])}" loading="lazy">` : ''}<div><b>${esc(r[0])}</b><p>${esc(r[1] || '')}</p></div></div>`).join('')}</div></section>` : ''}

  ${pts.length ? `<section class="sec"><h2>${esc(t.pilotH)}</h2><p class="sub">${esc(t.pilotSub)}</p><div class="tl">${pts.map((x) => `<div class="it"><span>${esc(x)}</span></div>`).join('')}</div></section>` : ''}

  ${eco}

  <section class="sec"><h2>${esc(t.vidH)}</h2><div class="vids">
    <figure><video src="/media/provoz.mp4" poster="/media/provoz-poster.jpg" controls playsinline preload="none"></video><figcaption>${esc(t.vid1)}</figcaption></figure>
    <figure><video src="/media/krok.mp4" poster="/media/krok-poster.jpg" controls playsinline preload="none"></video><figcaption>${esc(t.vid2)}</figcaption></figure></div></section>

  <section class="sec" id="zajem"><div class="cta"><h2>${esc(t.ctaH)}</h2><p class="sub" style="margin-bottom:14px">${esc(t.ctaSub)}</p>
    ${o.interest ? `<p style="margin:0;font-weight:700">✓ ${esc(t.done)}</p>` : `<button class="btn" type="button" id="of-open">${esc(t.cta)}</button>
    <form id="of-form" style="display:none;margin-top:6px"><div class="g2"><div><label>${esc(t.name)}</label><input name="name" required maxlength="120"></div><div><label>${esc(t.phone)}</label><input name="phone" maxlength="40"></div></div>
      <label>${esc(t.email)}</label><input name="email" type="email" maxlength="160"><label>${esc(t.note)}</label><textarea name="note" rows="3" maxlength="1500"></textarea>
      <div style="margin-top:12px"><button class="btn" type="submit">${esc(t.send)}</button> <span class="small" id="of-msg"></span></div></form>`}
    ${o.sender_name || o.reply_to || o.sender_phone ? `<div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12)"><span class="muted">${esc(t.contact)}:</span> <b>${esc(o.sender_name || 'Laundromats.eu')}</b>${o.sender_phone ? ` · <a href="tel:${esc(String(o.sender_phone).replace(/\s/g, ''))}">${esc(o.sender_phone)}</a>` : ''}${o.reply_to ? ` · <a href="mailto:${esc(o.reply_to)}">${esc(o.reply_to)}</a>` : ''}</div>` : ''}
  </div></section>
</div>
<script>(function(){var b=document.getElementById('of-open'),f=document.getElementById('of-form');if(!b)return;b.onclick=function(){f.style.display='';b.style.display='none';f.querySelector('input').focus();};
f.onsubmit=function(e){e.preventDefault();var m=document.getElementById('of-msg'),d={};new FormData(f).forEach(function(v,k){d[k]=v;});f.querySelector('button').disabled=true;
fetch('/nabidka/${token}/zajem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){if(!r.ok)throw 0;f.outerHTML='<p style="margin:0;font-weight:700">✓ ${esc(t.thanks).replace(/'/g, "\\'")}</p>';}).catch(function(){m.textContent='${esc(t.err).replace(/'/g, "\\'")}';f.querySelector('button').disabled=false;});};})();<\/script>`;
  return layout({ title: (o.title || t.kick) + ' — ' + (o.company || ''), back: false, body }).replace('<html lang="cs">', '<html lang="' + L + '">');
}

module.exports = { offerPage, REFS, T };
