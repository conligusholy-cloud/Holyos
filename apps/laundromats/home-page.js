// Laundromats — úvodní stránka laundromats.eu (značka LAUNDROMATS, vzhled Best Series 2.0).
// Všechny texty jsou ve slovníku T[lang] → překlad = doplnit další jazyk (LANGS). Přepínač jazyků se zobrazí,
// až bude v LANGS víc než jeden jazyk (nefunkční varianty se neukazují).
// Žádné vymyšlené reference, adresy, výsledky ani výnosy — místa pro skutečné podklady jsou označená (PH = placeholder).
'use strict';

const LANGS = ['cs'];

const T = {
  cs: {
    seoTitle: 'Laundromats | Vlastní prádlomat a možnosti spolupráce',
    seoDesc: 'Poznejte podnikání se samoobslužnými prádlomaty. Laundromats staví na zkušenostech z více než 70 provozů v ČR. Proberte s námi svůj záměr.',
    skip: 'Přeskočit na obsah',
    nav: { why: 'Proč prádlomat', paths: 'Možnosti spolupráce', network: 'Naše síť', start: 'Jak začít', faq: 'Časté otázky', cta: 'Probrat můj záměr', menu: 'Menu', close: 'Zavřít menu' },
    hero: {
      eyebrow: 'Zkušenosti z více než 70 prádlomatů v České republice',
      h1a: 'Vybudujte vlastní podnikání', h1b: 'se samoobslužnými prádlomaty.',
      sub: 'Začněte jedním prádlomatem a vytvořte si prostor pro další růst. Poznejte podnikání, které sami každý den provozujeme, a zjistěte, jak může fungovat ve vaší lokalitě.',
      cta1: 'Chci zjistit, jak začít', cta2: 'Prohlédnout skutečné provozovny',
      points: ['Samoobslužný provoz', 'Možnosti zajištění péče', 'Zkušenosti z vlastní sítě'],
      card: 'Přes 70 prádlomatů, které sami provozujeme v České republice.',
      imgAlt: 'Samoobslužný venkovní prádlomat se dvěma pračkami a sušičkou',
      sites: 'Skutečné provozovny',
      siteList: [['/media/provozovna-1.webp', 'Česká republika · u čerpací stanice', 'Prádlomat u čerpací stanice ORLEN'], ['/media/provozovna-2.webp', 'Česká republika · obchodní centrum, Šumperk', 'Prádlomat Best Series u obchodního centra v Šumperku', 'center 25%'], ['/media/provozovna-3.webp', 'Irsko · partnerský provoz', 'Partnerský prádlomat u čerpací stanice v Irsku']],
    },
    why: {
      kicker: 'Proč prádlomat', h: 'Jednoduchá služba. Více možností pro vaše podnikání.',
      lead: 'Zákazník přijde, vypere a usuší. Za jednoduchým používáním stojí technologie, vhodné místo a dobře nastavená péče o provoz.',
      cards: [
        ['Samoobslužný provoz', 'Zákazník obsluhuje zařízení sám. Provoz tak nevyžaduje stálou obsluhu u každého praní.'],
        ['Služba pro různé potřeby', 'Běžné prádlo, objemné kusy i situace, kdy domácí pračka nestačí. Prádlomat nabízí praktickou službu v dostupné lokalitě.'],
        ['Vaše míra zapojení', 'Každodenní péči můžete organizovat sami, nebo ji podle místních možností zajistit prostřednictvím partnera.'],
        ['Prostor pro další rozvoj', 'Začít můžete jedním místem. O dalším rozšíření se rozhodnete podle skutečných výsledků a svých možností.'],
      ],
    },
    paths: {
      kicker: 'Možnosti spolupráce', h: 'Jaká cesta je ta vaše?',
      cards: [
        ['own', 'Chci vlastnit prádlomat', 'Zajímá vás vlastní zařízení, ekonomika provozu a možnosti zajištění každodenní péče? Společně projdeme váš záměr a vhodný způsob zapojení.', 'Zajímá mě vlastnictví'],
        ['partner', 'Chci provozovat a rozvíjet síť', 'Chcete aktivně vyhledávat místa, organizovat provoz a postupně budovat více lokalit? Pojďme probrat možnosti spolupráce ve vašem regionu nebo zemi.', 'Zajímá mě partnerství'],
        ['site', 'Mám vhodné místo', 'Máte pozemek nebo prostor u obchodu, čerpací stanice či jiné navštěvované lokality? Prověříme, zda by zde prádlomat mohl dávat smysl.', 'Chci nabídnout místo'],
      ],
    },
    network: {
      kicker: 'Naše síť', h: 'Zkušenosti, které vznikají každý den v provozu.',
      lead: 'V České republice sami provozujeme přes 70 prádlomatů. Známe jejich každodenní fungování, péči o zařízení i otázky zákazníků. Na těchto zkušenostech stavíme Laundromats.',
      areas: [
        ['Lokalita', 'Dostupnost, viditelnost a okolí tvoří důležitou součást každého záměru.'],
        ['Péče o provoz', 'Čistota, doplňování prostředků a řešení závad patří k fungující službě.'],
        ['Zákaznická zkušenost', 'Srozumitelná obsluha a dostupná pomoc jsou součástí kvalitního provozu.'],
      ],
      stat: 'přes', statUnit: 'prádlomatů v ČR, které sami provozujeme',
      note: 'Zkušenosti z českého trhu. Podmínky v jiných zemích posuzujeme vždy podle místní situace.',
      gallery: 'Fotografie skutečných provozoven doplníme',
      vid1: 'Prádlomat v provozu', vid2: 'Jak se prádlomat používá — krok za krokem', vidPlay: 'Přehrát video',
      map: 'Mapa sítě bude doplněna po zveřejnění seznamu lokalit',
      cta: 'Chci vidět prádlomat v provozu',
    },
    own: {
      kicker: 'Vlastnictví a provoz', h: 'Mějte jasno v tom, co vlastnictví obnáší.',
      lead: 'Samoobslužný prádlomat nepotřebuje stálou obsluhu. Potřebuje ale pravidelnou péči. Před zahájením spolupráce si vyjasníme, kdo bude jednotlivé činnosti zajišťovat.',
      items: ['Kontroly a čistota provozovny', 'Doplňování pracích prostředků', 'Technická údržba a servis', 'Pomoc zákazníkům', 'Místní propagace', 'Sledování výsledků a nákladů'],
      foot: 'Rozsah vaší práce závisí na zvoleném modelu spolupráce a dostupnosti místních služeb.',
    },
    eco: {
      kicker: 'Ekonomika místa', h: 'Každá lokalita má svůj potenciál. Pojďme prověřit ten váš.',
      lead: 'Výsledek provozu ovlivňuje návštěvnost, ceny služeb, nájem, energie, údržba i způsob zajištění péče. Smysluplný plán začíná konkrétním místem a realistickými předpoklady.',
      factors: ['Lokalita', 'Využití strojů', 'Ceny služeb', 'Provozní náklady'],
      result: 'Plán pro vaše místo',
      cta: 'Probrat možnosti mé lokality',
    },
    start: {
      kicker: 'Jak začít', h: 'Od první myšlenky ke konkrétnímu plánu.',
      steps: [
        ['Řeknete nám svůj záměr', 'Chcete vlastnit, provozovat, nebo nabídnout místo? Zjistíme, co od spolupráce očekáváte.'],
        ['Projdeme možnosti', 'Podíváme se na region, lokalitu a předpokládaný rozsah vašeho zapojení.'],
        ['Upřesníme řešení', 'Probereme technologii, přípravu místa, náklady a rozdělení provozních úkolů.'],
        ['Domluvíme další postup', 'Získáte přehled konkrétních kroků a podmínek pro rozhodnutí.'],
      ],
    },
    tech: {
      kicker: 'Technologie', h: 'Výrobní zázemí Best Series. Provozní zkušenosti Laundromats.',
      text: 'Best Series zajišťuje výrobu a dodávku technologie. Laundromats se soustředí na provoz prádlomatů a možnosti zapojení vlastníků a partnerů. Díky propojení výrobních a provozních zkušeností můžeme řešit zařízení i jeho každodenní využití v souvislostech.',
      link: 'Web výrobce Best Series',
    },
    faq: {
      kicker: 'Časté otázky', h: 'Na co se nás lidé ptají nejčastěji',
      items: [
        ['Musím mít zkušenosti s provozováním prádelny?', 'Předchozí zkušenosti nejsou podmínkou prvního jednání. Projdeme s vámi princip fungování i povinnosti, které s vlastnictvím a provozem souvisejí.'],
        ['Je to úplně pasivní podnikání?', 'Praní a sušení probíhá samoobslužně. Kontroly, čistotu, údržbu a podporu zákazníků však musí někdo zajistit. Míra vašeho zapojení závisí na tom, které činnosti budete dělat sami a které svěříte partnerům.'],
        ['Musím už mít vybranou lokalitu?', 'Nemusíte. Pokud místo máte, uveďte ho v poptávce. Pokud ho teprve hledáte, napište region, který vás zajímá.'],
        ['Mohu vlastnit více prádlomatů?', 'Ano, váš záměr může zahrnovat více zařízení. Další rozvoj je vhodné plánovat podle možností lokalit, výsledků a zajištění provozu.'],
        ['Mohu nabídnout jen místo?', 'Ano. Ve formuláři vyberte možnost „Mám vhodné místo“ a popište jeho polohu a současné využití.'],
        ['Je možná spolupráce v zahraničí?', 'Máme zájem jednat také s partnery z dalších zemí. Konkrétní nabídka závisí na místních podmínkách a možnostech technického a provozního zajištění.'],
      ],
    },
    form: {
      kicker: 'Kontakt', h: 'Jak by mohl vypadat váš první prádlomat?',
      sub: 'Napište nám svůj záměr. Projdeme s vámi možnosti a navrhneme další postup.',
      name: 'Jméno a příjmení', email: 'E-mail', phone: 'Telefon', interest: 'Co vás zajímá', place: 'Země a město nebo region', note: 'Poznámka',
      notePh: 'Například lokalita, kterou zvažujete, nebo cokoli, co bychom měli vědět', placePh: 'Např. Česko, Brno',
      choose: 'Vyberte možnost',
      opts: [['own', 'Chci vlastnit prádlomat'], ['partner', 'Chci provozovat nebo rozvíjet síť'], ['site', 'Mám vhodné místo'], ['visit', 'Chci vidět prádlomat v provozu']],
      req: 'povinné', submit: 'Probrat můj záměr', sending: 'Odesílám…',
      ok: 'Děkujeme, váš záměr máme. Ozveme se vám, abychom domluvili další postup.',
      err: 'Odeslání se nepodařilo. Zkuste to prosím znovu, nebo nám napište na info@laundromats.eu.',
      invalid: 'Zkontrolujte prosím zvýrazněná pole.',
      eName: 'Vyplňte jméno.', eEmail: 'Zadejte platný e-mail.', ePhone: 'Zadejte telefon (alespoň 9 číslic).', eInterest: 'Vyberte, co vás zajímá.', ePlace: 'Vyplňte zemi a město nebo region.',
      privacy: 'Odesláním formuláře nám předáváte kontaktní údaje, abychom vás mohli kontaktovat ohledně vašeho záměru.',
      privacyLink: 'Informace o zpracování osobních údajů',
    },
    foot: {
      claim: 'Samoobslužné prádlomaty. Zkušenosti z provozu. Možnosti pro vaše podnikání.',
      company: 'Provozovatel webu a kontaktní údaje', privacy: 'Ochrana osobních údajů',
      tech: 'Technologie: Best Series', rights: '©',
    },
  },
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ikony (inline SVG, stroke = currentColor)
const IC = {
  self: '<path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18.4 5.6l-2.1 2.1M21 12h-3"/><circle cx="12" cy="14" r="6"/><path d="M12 11v3l2 1.5"/>',
  needs: '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="13" r="4.5"/><path d="M8 6.5h.01M11 6.5h.01"/>',
  you: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  grow: '<path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/><path d="M15 8h3v3"/>',
  own: '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  partner: '<circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><circle cx="12" cy="6" r="2.5"/><path d="M8 15.5l3-7M16 15.5l-3-7M8.5 17h7"/>',
  site: '<path d="M12 21s-6-5.3-6-10.5A6 6 0 0 1 18 10.5C18 15.7 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5.5-5L6 19"/>',
  map: '<path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
};
const svg = (k, sz) => '<svg width="' + (sz || 22) + '" height="' + (sz || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>';

const CSS = `
:root{--bg:#04060c;--bg2:#070b16;--navy:#0b1426;--card:rgba(14,22,40,.62);--line:rgba(120,160,255,.14);--line2:rgba(120,160,255,.28);--tx:#eef4ff;--tx2:#a9b8d3;--tx3:#6b7d9e;--az:#4fd1ff;--bl:#1e86e0;--vi:#7c5cff;--teal:#2fe3c6;--r:20px;--max:1180px}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.6 Inter,"Segoe UI",system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}img{max-width:100%;display:block}
.skip{position:absolute;left:-999px;top:8px;background:#fff;color:#04060c;padding:8px 14px;border-radius:8px;z-index:100}.skip:focus{left:12px}
:focus-visible{outline:2px solid var(--az);outline-offset:3px;border-radius:6px}
.wrap{max-width:var(--max);margin:0 auto;padding:0 24px}
section{position:relative;padding:110px 0;scroll-margin-top:70px}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--az);margin-bottom:16px}
.kicker:before{content:"";width:18px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--az),var(--vi))}
h1,h2,h3{margin:0;letter-spacing:-.025em;line-height:1.08}
h2{font-size:clamp(30px,4.2vw,50px);font-weight:800;max-width:820px}
h3{font-size:20px;font-weight:700;letter-spacing:-.01em;line-height:1.25}
.lead{font-size:clamp(17px,1.6vw,20px);color:var(--tx2);max-width:720px;margin:20px 0 0}
.grad{background:linear-gradient(90deg,var(--az),#7aa8ff 55%,var(--vi));-webkit-background-clip:text;background-clip:text;color:transparent}
/* tlačítka */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:0 26px;border-radius:14px;font-weight:700;font-size:16px;text-decoration:none;border:1px solid transparent;cursor:pointer;transition:transform .18s,box-shadow .18s,background .18s,border-color .18s;font-family:inherit}
.btn-p{background:linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff);color:#fff;box-shadow:0 10px 30px -10px rgba(58,108,245,.8)}
.btn-p:hover{transform:translateY(-2px);box-shadow:0 16px 36px -12px rgba(79,209,255,.75)}
.btn-g{background:rgba(255,255,255,.04);border-color:var(--line2);color:var(--tx)}.btn-g:hover{border-color:var(--az);background:rgba(79,209,255,.08)}
.btn-s{min-height:44px;padding:0 18px;font-size:14.5px;border-radius:12px}
/* hlavička */
.hdr{position:fixed;inset:0 0 auto 0;z-index:50;transition:background .25s,border-color .25s,backdrop-filter .25s;border-bottom:1px solid transparent}
.hdr.sc{background:rgba(4,6,12,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom-color:var(--line)}
.hdr .wrap{display:flex;align-items:center;gap:22px;height:72px}
.logo{display:inline-flex;align-items:center;gap:10px;text-decoration:none;font-weight:900;letter-spacing:.14em;font-size:15px}
.nav{display:flex;gap:4px;margin-left:auto}
.nav a{white-space:nowrap;padding:8px 10px;border-radius:10px;text-decoration:none;color:var(--tx2);font-size:14.5px;font-weight:500}.nav a:hover{color:var(--tx);background:rgba(255,255,255,.04)}
.burger{display:none;margin-left:auto;background:none;border:1px solid var(--line2);color:var(--tx);border-radius:12px;width:46px;height:42px;cursor:pointer}
.mnav{display:none}
@media (max-width:1060px){.nav,.hdr .btn-cta{display:none}.burger{display:inline-flex;align-items:center;justify-content:center}
 .mnav{position:fixed;inset:72px 0 0 0;background:rgba(4,6,12,.97);backdrop-filter:blur(10px);padding:24px;display:none;flex-direction:column;gap:6px;z-index:49}
 .mnav.open{display:flex}.mnav a{padding:14px 10px;font-size:19px;text-decoration:none;border-bottom:1px solid var(--line)}.mnav .btn{margin-top:18px}}
/* hero */
.hero{padding:52px 0 80px;overflow:hidden}
.hero:before{content:"";position:absolute;inset:-20% -10% auto -10%;height:120%;background:radial-gradient(900px 520px at 78% 38%,rgba(58,108,245,.28),transparent 62%),radial-gradient(700px 420px at 12% 18%,rgba(79,209,255,.12),transparent 60%);pointer-events:none}
.hero .wrap{display:grid;grid-template-columns:1.2fr .8fr;gap:40px;align-items:center;position:relative}
.eyebrow{display:inline-flex;align-items:center;gap:9px;padding:7px 14px;border:1px solid rgba(47,227,198,.35);background:rgba(47,227,198,.07);border-radius:999px;color:#b6f5ea;font-size:13.5px;font-weight:600}
.eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--teal);box-shadow:0 0 10px var(--teal)}
.hero h1{font-size:clamp(38px,5vw,66px);font-weight:850;margin:22px 0 0;letter-spacing:-.035em}
.hero h1 span{display:block}
.hero .lead{margin-top:24px}
.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.pts{list-style:none;padding:0;margin:34px 0 0;display:flex;flex-wrap:wrap;gap:10px 26px;color:var(--tx2);font-size:15px}
.pts li{display:flex;align-items:center;gap:9px}.pts svg{color:var(--teal)}
.visual{position:relative;aspect-ratio:1/1;max-width:560px;justify-self:end;width:100%}
.visual .glow{position:absolute;inset:8%;border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.35),rgba(58,108,245,.18) 45%,transparent 70%);filter:blur(10px)}
.visual .ground{position:absolute;left:6%;right:6%;bottom:9%;height:14%;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.65),transparent)}
.visual img{position:relative;width:100%;height:auto;margin-top:8%;filter:drop-shadow(0 30px 50px rgba(0,0,0,.55));animation:float 7s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.visual .note{position:absolute;right:4%;top:2%;font-size:11.5px;color:var(--tx3);letter-spacing:.04em}
.statcard{position:absolute;left:-4%;bottom:4%;max-width:270px;padding:18px 20px;border-radius:18px;background:rgba(10,16,30,.82);border:1px solid var(--line2);backdrop-filter:blur(12px);box-shadow:0 20px 50px -20px rgba(0,0,0,.8)}
.statcard b{display:block;font-size:40px;line-height:1;font-weight:850;letter-spacing:-.03em}.statcard p{margin:8px 0 0;font-size:14px;color:var(--tx2);line-height:1.45}
@media (max-width:900px){.hero{padding:40px 0 60px}.hero .wrap{grid-template-columns:1fr;gap:30px}.visual{justify-self:center;max-width:430px}.statcard{left:0}}
/* karty */
.grid{display:grid;gap:18px;margin-top:52px}.g4{grid-template-columns:repeat(4,1fr)}.g3{grid-template-columns:repeat(3,1fr)}
@media (max-width:1000px){.g4{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:1fr}}@media (max-width:620px){.g4{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:28px;transition:border-color .2s,transform .2s}
.card:hover{border-color:var(--line2);transform:translateY(-3px)}
.ico{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;color:var(--az);background:linear-gradient(135deg,rgba(79,209,255,.16),rgba(124,92,255,.12));border:1px solid rgba(79,209,255,.22);margin-bottom:20px}
.card p{color:var(--tx2);margin:12px 0 0;font-size:15.5px}
.alt{background:linear-gradient(180deg,rgba(7,11,22,.55),rgba(4,6,12,.25))}
.divline{position:absolute;inset:0 0 auto 0;height:1px;background:linear-gradient(90deg,transparent,var(--line2),transparent)}
/* cesty */
.path{display:flex;flex-direction:column;padding:34px;border-radius:24px;background:linear-gradient(160deg,rgba(20,32,58,.9),rgba(10,16,30,.9));border:1px solid var(--line2);position:relative;overflow:hidden}
.path:after{content:"";position:absolute;inset:auto -30% -55% auto;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.14),transparent 65%);pointer-events:none}
.path h3{font-size:24px}.path p{color:var(--tx2);margin:14px 0 26px;flex:1}
.path .btn{align-self:flex-start}
/* síť */
.net{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:start}
@media (max-width:900px){.net{grid-template-columns:1fr;gap:34px}}
.big{display:flex;align-items:baseline;gap:14px;margin-top:34px;padding:24px 26px;border-radius:20px;border:1px solid rgba(47,227,198,.3);background:rgba(47,227,198,.05)}
.big b{font-size:64px;font-weight:850;letter-spacing:-.04em;line-height:1}.big span{color:var(--tx2);font-size:15px;line-height:1.35}.big small{display:block;color:var(--tx3);font-size:12.5px}
.areas{display:grid;gap:12px}
.area{display:flex;gap:16px;padding:22px;border-radius:18px;background:var(--card);border:1px solid var(--line)}
.area .ico{margin:0;flex:none}.area p{margin:6px 0 0;color:var(--tx2);font-size:15px}
.ph{border:1.5px dashed rgba(120,160,255,.3);border-radius:18px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.015) 0 12px,transparent 12px 24px);color:var(--tx3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;font-size:14px;padding:20px}
.media{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:44px}.media .ph{min-height:260px}
@media (max-width:760px){.media{grid-template-columns:1fr}.media .ph{min-height:180px}}
.nnote{color:var(--tx3);font-size:13.5px;margin-top:16px}
/* vlastnictví */
.own{display:grid;grid-template-columns:.9fr 1.1fr;gap:56px;align-items:center}
@media (max-width:900px){.own{grid-template-columns:1fr;gap:30px}}
.tasks{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:560px){.tasks{grid-template-columns:1fr}}
.tasks li{display:flex;align-items:center;gap:12px;padding:18px;border-radius:16px;background:var(--card);border:1px solid var(--line);font-weight:600;font-size:15.5px}
.tasks li span{width:32px;height:32px;flex:none;border-radius:10px;display:grid;place-items:center;color:var(--teal);background:rgba(47,227,198,.1)}
.ofoot{margin-top:18px;color:var(--tx2);font-size:15px;padding-left:14px;border-left:2px solid var(--az)}
/* ekonomika */
.eco{border-radius:28px;padding:64px;background:linear-gradient(135deg,#0d1a33,#0a1222 60%,#120f2b);border:1px solid var(--line2);position:relative;overflow:hidden}
.eco:before{content:"";position:absolute;right:-120px;top:-120px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(124,92,255,.22),transparent 65%)}
@media (max-width:700px){.eco{padding:34px 22px}}
.formula{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:40px 0 36px;position:relative}
.fx{padding:14px 20px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--line2);font-weight:700;font-size:16px}
.op{color:var(--az);font-size:22px;font-weight:300}
.fx.res{background:linear-gradient(90deg,rgba(30,134,224,.25),rgba(124,92,255,.25));border-color:rgba(79,209,255,.45)}
/* kroky */
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:56px;counter-reset:s;position:relative}
.steps:before{content:"";position:absolute;left:4%;right:4%;top:27px;height:1px;background:linear-gradient(90deg,var(--az),var(--vi));opacity:.35}
@media (max-width:1000px){.steps{grid-template-columns:1fr 1fr}.steps:before{display:none}}@media (max-width:560px){.steps{grid-template-columns:1fr}}
.step{position:relative}
.step .n{width:54px;height:54px;border-radius:16px;display:grid;place-items:center;font-weight:850;font-size:20px;background:var(--bg);border:1px solid var(--line2);color:var(--az);position:relative}
.step h3{margin-top:22px}.step p{color:var(--tx2);margin:10px 0 0;font-size:15.5px}
/* technologie */
.tech{display:flex;align-items:center;gap:34px;padding:34px;border-radius:22px;border:1px solid var(--line);background:rgba(255,255,255,.02)}
@media (max-width:760px){.tech{flex-direction:column;align-items:flex-start}}
.tech .logo-ph{flex:none;width:150px;height:84px}
.tech h2{font-size:clamp(22px,2.6vw,30px)}.tech p{color:var(--tx2);margin:12px 0 0;font-size:15.5px;max-width:760px}
.tech .lnk{display:inline-flex;align-items:center;gap:8px;margin-top:14px;color:var(--tx3);font-size:14px}
/* FAQ */
.faq{max-width:860px;margin-top:44px}
.faq details{border-bottom:1px solid var(--line)}
.faq summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 4px;font-weight:700;font-size:18px}
.faq summary::-webkit-details-marker{display:none}
.faq summary svg{flex:none;color:var(--az);transition:transform .25s}
.faq details[open] summary svg{transform:rotate(45deg)}
.faq details p{margin:0;padding:0 4px 26px;color:var(--tx2);max-width:740px}
/* formulář */
.fwrap{display:grid;grid-template-columns:.85fr 1.15fr;gap:56px;align-items:start}
@media (max-width:900px){.fwrap{grid-template-columns:1fr;gap:30px}}
form.f{padding:34px;border-radius:24px;background:var(--card);border:1px solid var(--line2)}
@media (max-width:560px){form.f{padding:22px}}
.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media (max-width:560px){.row{grid-template-columns:1fr}}
.fld{display:flex;flex-direction:column;gap:7px;margin-bottom:16px}
.fld label{font-size:14px;font-weight:600;color:var(--tx)}.fld label small{color:var(--tx3);font-weight:500}
.fld input,.fld select,.fld textarea{width:100%;min-height:50px;padding:12px 14px;border-radius:12px;border:1px solid var(--line2);background:rgba(4,6,12,.6);color:var(--tx);font:inherit;font-size:16px;transition:border-color .15s,box-shadow .15s}
.fld textarea{min-height:110px;resize:vertical}
.fld select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%234fd1ff' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:40px}
.fld select option{background:#0b1426}
.fld input:focus,.fld select:focus,.fld textarea:focus{outline:none;border-color:var(--az);box-shadow:0 0 0 3px rgba(79,209,255,.18)}
.fld .er{display:none;color:#ff8a96;font-size:13px}
.fld.bad input,.fld.bad select{border-color:#ff5d6c}.fld.bad .er{display:block}
.hp{position:absolute;left:-5000px;width:1px;height:1px;overflow:hidden}
.fmsg{display:none;margin-top:14px;padding:14px 16px;border-radius:12px;font-size:15px}
.fmsg.ok{display:block;background:rgba(47,227,198,.1);border:1px solid rgba(47,227,198,.4);color:#c8fbf1}
.fmsg.bad{display:block;background:rgba(255,93,108,.08);border:1px solid rgba(255,93,108,.4);color:#ffc2c8}
.priv{margin-top:16px;font-size:13px;color:var(--tx3)}.priv a{color:var(--tx2)}
form.f .btn{width:100%}
/* patička */
footer{border-top:1px solid var(--line);padding:56px 0 34px;margin-top:40px}
.fgrid{display:grid;grid-template-columns:1.3fr auto;gap:34px;align-items:start}
@media (max-width:800px){.fgrid{grid-template-columns:1fr}}
.fgrid p{color:var(--tx2);font-size:14.5px;margin:14px 0 0;max-width:340px}
.fgrid h4{margin:0 0 12px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3)}
.fgrid nav a,.fgrid .fl{display:block;color:var(--tx2);text-decoration:none;font-size:14.5px;padding:4px 0}.fgrid nav a:hover{color:var(--az)}
.fph{color:var(--tx3);font-size:13.5px;border:1px dashed var(--line2);border-radius:12px;padding:12px 14px}
.fbot{margin-top:40px;padding-top:22px;border-top:1px solid var(--line);color:var(--tx3);font-size:13px;display:flex;flex-wrap:wrap;gap:8px 22px;justify-content:space-between}
/* odhalení při scrollu */
.rv{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease}.rv.in{opacity:1;transform:none}
.no-js .rv{opacity:1;transform:none}

.sites{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media (max-width:760px){.sites{grid-template-columns:1fr}}
.site{margin:0}.site img{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;object-position:center 60%;border-radius:18px;border:1px solid var(--line)}
.site figcaption{display:flex;align-items:center;gap:7px;margin-top:10px;color:var(--tx2);font-size:14.5px;font-weight:600}.site figcaption svg{color:var(--az)}
.vids{display:grid;grid-template-columns:minmax(0,270px) minmax(0,270px) 1fr;gap:16px;margin-top:44px;align-items:stretch}
@media (max-width:820px){.vids{grid-template-columns:1fr 1fr}.vids .ph{grid-column:1/-1;min-height:160px}}
.vid{margin:0}.vid video{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:18px;border:1px solid var(--line2);background:#0b1426;display:block}
.vid figcaption{margin-top:10px;color:var(--tx2);font-size:14px;font-weight:600}
.site img,.vid video{cursor:zoom-in;transition:filter .2s,transform .2s}.site img:hover,.vid video:hover{filter:brightness(1.08)}
.vid{position:relative}.vid.pl:before{content:"";position:absolute;left:50%;top:calc(50% - 18px);width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(6,12,24,.62) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fff'%3E%3Cpath d='M9 6.5v11l9-5.5z'/%3E%3C/svg%3E") center/32px no-repeat;border:1px solid rgba(255,255,255,.35);pointer-events:none}
#lb{position:fixed;inset:0;z-index:300;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(2,6,14,.92);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);cursor:zoom-out}
#lb.on{display:flex}#lb img,#lb video{max-width:96vw;max-height:90vh;border-radius:16px;border:1px solid rgba(120,160,255,.35);box-shadow:0 30px 90px rgba(0,0,0,.6);background:#0b1426;cursor:default}
#lb .x,#lb .nv{position:absolute;display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:rgba(10,18,36,.7);color:#fff;font-size:24px;line-height:1;cursor:pointer}
#lb .x{top:16px;right:16px}#lb .nv{top:50%;margin-top:-23px}#lb .pv{left:16px}#lb .nx{right:16px}#lb .cp{position:absolute;left:0;right:0;bottom:18px;text-align:center;color:#cfe0f5;font-size:14.5px;font-weight:600;padding:0 70px;pointer-events:none}
/* Pozadí jako Best Series 2.0: síť bodů (canvas) + záře + perspektivní mřížka */
#net{position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:.7}
.bgglow{position:fixed;border-radius:50%;filter:blur(90px);opacity:.45;z-index:-1;pointer-events:none;animation:drift 18s ease-in-out infinite alternate}
.bgglow.a{width:620px;height:620px;left:-200px;top:-200px;background:radial-gradient(circle,rgba(30,134,224,.6),transparent 65%)}
.bgglow.b{width:560px;height:560px;right:-180px;bottom:-220px;background:radial-gradient(circle,rgba(124,92,255,.5),transparent 65%);animation-delay:-9s}
.gridfx{position:fixed;inset:auto 0 0 0;height:40vh;z-index:-1;pointer-events:none;background-image:linear-gradient(rgba(120,160,255,.14) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,255,.14) 1px,transparent 1px);background-size:64px 64px;transform:perspective(600px) rotateX(62deg);transform-origin:top;mask-image:linear-gradient(to bottom,transparent,#000 35%,#000 70%,transparent);-webkit-mask-image:linear-gradient(to bottom,transparent,#000 35%,#000 70%,transparent)}
@keyframes drift{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(50px,30px,0) scale(1.1)}}
`;

function homePage(lang) {
  const L = T[lang] || T.cs; const lg = T[lang] ? lang : 'cs';
  const n = L.nav;
  const NAV = [['proc', n.why], ['spoluprace', n.paths], ['sit', n.network], ['jak-zacit', n.start], ['otazky', n.faq]];
  const navLinks = NAV.map(([id, t]) => '<a href="#' + id + '">' + esc(t) + '</a>').join('');
  // Podstránky webu + aplikace lokalit (zatím jen česky)
  const pageLinks = lg === 'cs' ? [['/cesta/compounder', 'Compounder'], ['/cesta/pradlomaty', 'Prádlomaty'], ['/cesta/ekonomika', 'Ekonomika'], ['/cesta/hledat', 'Najít místo'], ['/cesta/zhodnotit', 'Zhodnotit místo']].map(([h, t]) => '<!--PRIV--><a href="' + h + '">' + esc(t) + '</a><!--/PRIV-->').join('') : '';
  const headLinks = (lg === 'cs' ? NAV.slice(0, 1) : NAV).map(([id, t]) => '<a href="#' + id + '">' + esc(t) + '</a>').join('') + pageLinks;
  const langSwitch = LANGS.length > 1 ? '<div class="langs" role="navigation" aria-label="Jazyk">' + LANGS.map((x) => '<a href="/' + (x === 'cs' ? '' : x) + '" hreflang="' + x + '"' + (x === lg ? ' aria-current="true"' : '') + '>' + x.toUpperCase() + '</a>').join('') + '</div>' : '';
  const logo = (sz) => '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 64 64" fill="none" aria-hidden="true"><defs><linearGradient id="lg' + sz + '" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#4fd1ff"/><stop offset=".55" stop-color="#3a6cf5"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="17" fill="#0b1220"/><rect x="2.75" y="2.75" width="58.5" height="58.5" rx="16.5" stroke="url(#lg' + sz + ')" stroke-width="1.5"/><circle cx="32" cy="34" r="15" stroke="url(#lg' + sz + ')" stroke-width="3.5"/><circle cx="32" cy="34" r="8" stroke="url(#lg' + sz + ')" stroke-width="2.5" stroke-opacity=".6"/><circle cx="20" cy="16" r="2" fill="#4fd1ff"/><circle cx="27" cy="16" r="2" fill="#7c5cff"/></svg>';
  const kicker = (t) => '<div class="kicker">' + esc(t) + '</div>';
  const f = L.form;
  const interestBtn = (key, label, cls) => '<a class="btn ' + (cls || 'btn-g btn-s') + '" href="#kontakt" data-interest="' + key + '">' + esc(label) + ' ' + svg('arrow', 18) + '</a>';

  return '<!doctype html><html lang="' + lg + '" class="no-js"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<title>' + esc(L.seoTitle) + '</title><meta name="description" content="' + esc(L.seoDesc) + '">'
    + '<meta property="og:title" content="' + esc(L.seoTitle) + '"><meta property="og:description" content="' + esc(L.seoDesc) + '"><meta property="og:type" content="website"><meta property="og:image" content="/img/pradlomat-flex.webp">'
    + '<meta name="theme-color" content="#04060c"><link rel="icon" href="/favicon.svg" type="image/svg+xml">'
    + '<link rel="preload" as="image" href="/img/pradlomat-flex.webp" fetchpriority="high">'
    + require('./lm-header').FONT + '<style>' + CSS + require('./lm-header').CSS + '</style></head><body>'
    + '<canvas id="net" aria-hidden="true"></canvas><div class="bgglow a" aria-hidden="true"></div><div class="bgglow b" aria-hidden="true"></div><div class="gridfx" aria-hidden="true"></div>'
    + '<a class="skip" href="#obsah">' + esc(L.skip) + '</a>'
    // ── hlavička ──
    + require('./lm-header').header({})
    + '<main id="obsah">'
    // ── úvod ──
    + '<section class="hero" id="top"><div class="wrap"><div>'
    + '<div class="eyebrow rv"><i></i>' + esc(L.hero.eyebrow) + '</div>'
    + '<h1 class="rv"><span>' + esc(L.hero.h1a) + '</span><span class="grad">' + esc(L.hero.h1b) + '</span></h1>'
    + '<p class="lead rv">' + esc(L.hero.sub) + '</p>'
    + '<div class="ctas rv"><a class="btn btn-p" href="#jak-zacit">' + esc(L.hero.cta1) + ' ' + svg('arrow', 18) + '</a><a class="btn btn-g" href="#provozovny">' + esc(L.hero.cta2) + '</a></div>'
    + '<ul class="pts rv">' + L.hero.points.map((p) => '<li>' + svg('check', 18) + esc(p) + '</li>').join('') + '</ul></div>'
    + '<div class="visual rv"><div class="glow"></div><div class="ground"></div>'
    // PH: nahradit fotografií skutečného venkovního prádlomatu v reálném prostředí (WebP, ~1600 px, < 250 kB)
    + '<img src="/img/pradlomat-flex.webp" width="1100" height="896" alt="' + esc(L.hero.imgAlt) + '" fetchpriority="high" decoding="async">'
    + '<div class="statcard"><b class="grad">70+</b><p>' + esc(L.hero.card) + '</p></div></div></div></section>'
    // ── skutečné provozovny (3 fotky s názvem města) — PH: doplnit skutečné fotografie + města ──
    + '<section id="provozovny" style="padding:10px 0 70px"><div class="wrap"><div class="kicker">' + esc(L.hero.sites) + '</div><div class="sites">'
    + L.hero.siteList.map((x) => '<figure class="site rv"><img src="' + x[0] + '" alt="' + esc(x[2]) + '"' + (x[3] ? ' style="object-position:' + x[3] + '"' : '') + ' loading="lazy" decoding="async" width="1200" height="900"><figcaption>' + svg('site', 16) + esc(x[1]) + '</figcaption></figure>').join('')
    + '</div></div></section>'
    // ── proč ──
    + '<section class="alt" id="proc"><div class="divline"></div><div class="wrap">' + kicker(L.why.kicker) + '<h2 class="rv">' + esc(L.why.h) + '</h2><p class="lead rv">' + esc(L.why.lead) + '</p>'
    + '<div class="grid g4">' + L.why.cards.map((c, i) => '<article class="card rv"><div class="ico">' + svg(['self', 'needs', 'you', 'grow'][i], 24) + '</div><h3>' + esc(c[0]) + '</h3><p>' + esc(c[1]) + '</p></article>').join('') + '</div></div></section>'
    // ── cesty ──
    + '<section id="spoluprace"><div class="wrap">' + kicker(L.paths.kicker) + '<h2 class="rv">' + esc(L.paths.h) + '</h2>'
    + '<div class="grid g3">' + L.paths.cards.map((c) => '<article class="path rv"><div class="ico">' + svg(c[0], 24) + '</div><h3>' + esc(c[1]) + '</h3><p>' + esc(c[2]) + '</p>' + interestBtn(c[0], c[3], 'btn-p btn-s') + '</article>').join('') + '</div></div></section>'
    // ── síť ──
    + '<section class="alt" id="sit"><div class="divline"></div><div class="wrap"><div class="net"><div>' + kicker(L.network.kicker) + '<h2 class="rv">' + esc(L.network.h) + '</h2><p class="lead rv">' + esc(L.network.lead) + '</p>'
    + '<div class="big rv"><b class="grad">70+</b><span>' + esc(L.network.statUnit) + '<small>' + esc(L.network.note) + '</small></span></div>'
    + '<div class="ctas rv">' + interestBtn('visit', L.network.cta, 'btn-g') + '</div></div>'
    + '<div class="areas">' + L.network.areas.map((a, i) => '<div class="area rv"><div class="ico">' + svg(['site', 'self', 'you'][i], 22) + '</div><div><h3>' + esc(a[0]) + '</h3><p>' + esc(a[1]) + '</p></div></div>').join('') + '</div></div>'
    // PH: galerie skutečných provozoven + mapa (body až po dodání seznamu adres)
    + '<div class="vids rv">'
    + '<figure class="vid"><video class="autovid" src="/media/provoz.mp4" poster="/media/provoz-poster.jpg" muted loop playsinline preload="none" aria-label="' + esc(L.network.vid1) + '"></video><figcaption>' + esc(L.network.vid1) + '</figcaption></figure>'
    + '<figure class="vid pl"><video src="/media/krok.mp4" poster="/media/krok-poster.jpg" playsinline preload="none" aria-label="' + esc(L.network.vid2) + '"></video><figcaption>' + esc(L.network.vid2) + '</figcaption></figure>'
    + '<div class="ph" role="img" aria-label="' + esc(L.network.map) + '">' + svg('map', 30) + '<span>' + esc(L.network.map) + '</span></div></div></div></section>'
    // ── vlastnictví ──
    + '<section id="vlastnictvi"><div class="wrap"><div class="own"><div>' + kicker(L.own.kicker) + '<h2 class="rv">' + esc(L.own.h) + '</h2><p class="lead rv">' + esc(L.own.lead) + '</p></div>'
    + '<div><ul class="tasks">' + L.own.items.map((x) => '<li class="rv"><span>' + svg('check', 16) + '</span>' + esc(x) + '</li>').join('') + '</ul><p class="ofoot rv">' + esc(L.own.foot) + '</p></div></div></div></section>'
    // ── ekonomika ──
    // Rozšíření později: doložené případové studie + kalkulačka (#eco-ext)
    + '<section id="ekonomika" style="padding-top:20px"><div class="wrap"><div class="eco rv">' + kicker(L.eco.kicker) + '<h2>' + esc(L.eco.h) + '</h2><p class="lead">' + esc(L.eco.lead) + '</p>'
    + '<div class="formula" aria-label="' + esc(L.eco.factors.join(' + ') + ' = ' + L.eco.result) + '">' + L.eco.factors.map((x, i) => (i ? '<span class="op" aria-hidden="true">+</span>' : '') + '<span class="fx">' + esc(x) + '</span>').join('') + '<span class="op" aria-hidden="true">=</span><span class="fx res">' + esc(L.eco.result) + '</span></div>'
    + '<div id="eco-ext"></div>' + interestBtn('own', L.eco.cta, 'btn-p') + '</div></div></section>'
    // ── jak začít ──
    + '<section class="alt" id="jak-zacit"><div class="divline"></div><div class="wrap">' + kicker(L.start.kicker) + '<h2 class="rv">' + esc(L.start.h) + '</h2>'
    + '<ol class="steps" style="list-style:none;padding:0">' + L.start.steps.map((s, i) => '<li class="step rv"><div class="n">' + (i + 1) + '</div><h3>' + esc(s[0]) + '</h3><p>' + esc(s[1]) + '</p></li>').join('') + '</ol></div></section>'
    // ── FAQ ──
    + '<section class="alt" id="otazky"><div class="divline"></div><div class="wrap">' + kicker(L.faq.kicker) + '<h2 class="rv">' + esc(L.faq.h) + '</h2><div class="faq">'
    + L.faq.items.map((q) => '<details class="rv"><summary>' + esc(q[0]) + svg('plus', 22) + '</summary><p>' + esc(q[1]) + '</p></details>').join('') + '</div></div></section>'
    // ── formulář ──
    + '<section id="kontakt"><div class="wrap"><div class="fwrap"><div>' + kicker(f.kicker) + '<h2 class="rv">' + esc(f.h) + '</h2><p class="lead rv">' + esc(f.sub) + '</p></div>'
    + '<form class="f rv" id="inq" novalidate>'
    + '<div class="row"><div class="fld"><label for="f-name">' + esc(f.name) + ' <small>(' + esc(f.req) + ')</small></label><input id="f-name" name="name" autocomplete="name" required maxlength="120"><span class="er">' + esc(f.eName) + '</span></div>'
    + '<div class="fld"><label for="f-phone">' + esc(f.phone) + ' <small>(' + esc(f.req) + ')</small></label><input id="f-phone" name="phone" type="tel" autocomplete="tel" required maxlength="30" inputmode="tel"><span class="er">' + esc(f.ePhone) + '</span></div></div>'
    + '<div class="fld"><label for="f-email">' + esc(f.email) + ' <small>(' + esc(f.req) + ')</small></label><input id="f-email" name="email" type="email" autocomplete="email" required maxlength="160"><span class="er">' + esc(f.eEmail) + '</span></div>'
    + '<div class="row"><div class="fld"><label for="f-int">' + esc(f.interest) + ' <small>(' + esc(f.req) + ')</small></label><select id="f-int" name="interest" required><option value="">' + esc(f.choose) + '</option>' + f.opts.map((o) => '<option value="' + o[0] + '">' + esc(o[1]) + '</option>').join('') + '</select><span class="er">' + esc(f.eInterest) + '</span></div>'
    + '<div class="fld"><label for="f-place">' + esc(f.place) + ' <small>(' + esc(f.req) + ')</small></label><input id="f-place" name="place" autocomplete="address-level2" required maxlength="160" placeholder="' + esc(f.placePh) + '"><span class="er">' + esc(f.ePlace) + '</span></div></div>'
    + '<div class="fld"><label for="f-note">' + esc(f.note) + '</label><textarea id="f-note" name="note" maxlength="2000" placeholder="' + esc(f.notePh) + '"></textarea></div>'
    + '<div class="hp" aria-hidden="true"><label>Web<input name="website" tabindex="-1" autocomplete="off"></label></div>'
    + '<button class="btn btn-p" type="submit" id="f-btn">' + esc(f.submit) + '</button>'
    + '<div class="fmsg" id="f-msg" role="status" aria-live="polite"></div>'
    // PH: identita správce osobních údajů + odkaz na zásady (doplní zadavatel)
    + '<p class="priv">' + esc(f.privacy) + ' <a href="/gdpr">' + esc(f.privacyLink) + '</a></p></form></div></div></section>'
    + '</main>'
    // ── patička ──
    + '<footer><div class="wrap"><div class="fgrid"><div><a class="logo" href="#top">' + logo(30) + '<span>LAUNDROMATS</span></a><p>' + esc(L.foot.claim) + '</p></div>'
    + '<div><a class="fl" href="mailto:info@laundromats.eu">info@laundromats.eu</a><a class="fl" href="/gdpr">' + esc(L.foot.privacy) + '</a></div></div>'
    + '<div class="fbot"><span>' + esc(L.foot.rights) + ' ' + new Date().getFullYear() + ' Laundromats</span><span>' + esc(L.foot.claim) + '</span></div></div></footer>'
    + '<script>' + clientJs(L) + '</script><script>' + NET_JS + '</script><script>' + LIGHTBOX_JS + '</script><script src="/cesta/track.js" defer></script></body></html>';
}

function clientJs(L) {
  const f = L.form;
  const M = JSON.stringify({ sending: f.sending, submit: f.submit, ok: f.ok, err: f.err, invalid: f.invalid });
  return '(function(){var d=document;d.documentElement.classList.remove("no-js");var M=' + M + ';'
    // hlavička + mobilní menu
    + ''
    + 'var b=d.getElementById("burger"),mn=d.getElementById("mnav");function cl(){if(mn)mn.classList.remove("open");if(b)b.setAttribute("aria-expanded","false");}if(b&&mn){'
    + 'b.addEventListener("click",function(){var o=mn.classList.toggle("open");b.setAttribute("aria-expanded",o?"true":"false");});mn.addEventListener("click",function(e){if(e.target.closest("a"))cl();});d.addEventListener("keydown",function(e){if(e.key==="Escape")cl();});}'
    // odhalení při scrollu
    + 'var rv=d.querySelectorAll(".rv");if("IntersectionObserver"in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add("in");io.unobserve(x.target);}});},{threshold:.12,rootMargin:"0px 0px -40px 0px"});rv.forEach(function(e){io.observe(e);});}else rv.forEach(function(e){e.classList.add("in");});'
    // video v provozu: přehrávat jen ve viditelné části stránky (šetří data i baterii), ne při omezení pohybu
    + 'var av=d.querySelectorAll(".autovid"),red=matchMedia("(prefers-reduced-motion: reduce)").matches;if(!red&&"IntersectionObserver"in window){var vo=new IntersectionObserver(function(es){es.forEach(function(x){var v=x.target;if(x.isIntersecting){v.preload="auto";var p=v.play();if(p&&p.catch)p.catch(function(){});}else v.pause();});},{threshold:.35});av.forEach(function(v){vo.observe(v);});}else av.forEach(function(v){v.controls=true;});'
    // tlačítka s předvybraným zájmem
    + 'var sel=d.getElementById("f-int");d.addEventListener("click",function(e){var a=e.target.closest("[data-interest]");if(!a)return;sel.value=a.getAttribute("data-interest");sel.closest(".fld").classList.remove("bad");setTimeout(function(){d.getElementById("f-name").focus({preventScroll:true});},450);});'
    // formulář: validace → skutečné odeslání; úspěch jen při potvrzení serveru
    + 'var fm=d.getElementById("inq"),bt=d.getElementById("f-btn"),ms=d.getElementById("f-msg");'
    + 'function v(id,ok){var e=d.getElementById(id).closest(".fld");e.classList.toggle("bad",!ok);return ok;}'
    + 'fm.addEventListener("submit",function(e){e.preventDefault();ms.className="fmsg";ms.textContent="";'
    + 'var g=function(id){return d.getElementById(id).value.trim();};'
    + 'var ok=[v("f-name",g("f-name").length>1),v("f-phone",g("f-phone").replace(/\\D/g,"").length>=9),v("f-email",/^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$/.test(g("f-email"))),v("f-int",!!g("f-int")),v("f-place",g("f-place").length>1)].every(Boolean);'
    + 'if(!ok){ms.className="fmsg bad";ms.textContent=M.invalid;var fb=fm.querySelector(".bad input,.bad select");if(fb)fb.focus();return;}'
    + 'var it=g("f-int");bt.disabled=true;bt.textContent=M.sending;var sid="";try{sid=localStorage.getItem("lm_sid")||"";}catch(_){}'
    + 'fetch("/api/inquiry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:g("f-name"),email:g("f-email"),phone:g("f-phone"),interest:g("f-int"),place:g("f-place"),note:g("f-note"),website:fm.website.value,sid:sid,lang:d.documentElement.lang})})'
    + '.then(function(r){return r.json().catch(function(){return{};}).then(function(j){if(!r.ok||!j.ok)throw new Error(j.error||"x");});})'
    + '.then(function(){ms.className="fmsg ok";ms.textContent=M.ok;fm.reset();try{window.lmTrack&&lmTrack("inquiry_sent",{interest:it});}catch(_){}})'
    + '.catch(function(){ms.className="fmsg bad";ms.textContent=M.err;})'
    + '.finally(function(){bt.disabled=false;bt.textContent=M.submit;});});'
    + '})();';
}

const LIGHTBOX_JS = "(function(){var d=document,lb=d.createElement('div');lb.id='lb';lb.setAttribute('role','dialog');lb.setAttribute('aria-modal','true');lb.innerHTML='<button class=\"x\" aria-label=\"Zavřít\">&times;</button><button class=\"nv pv\" aria-label=\"Předchozí\">&#8249;</button><button class=\"nv nx\" aria-label=\"Další\">&#8250;</button><div class=\"cp\"></div>';d.body.appendChild(lb);"
  + "var m=null,cp=lb.querySelector('.cp'),pv=lb.querySelector('.pv'),nx=lb.querySelector('.nx'),list=[],ix=0;"
  + "function clr(){if(m){if(m.pause)m.pause();m.remove();m=null;}}"
  + "function show(i){clr();ix=(i+list.length)%list.length;var it=list[ix];if(it.v){m=d.createElement('video');m.src=it.src;m.poster=it.poster||'';m.controls=true;m.playsInline=true;m.autoplay=true;}else{m=d.createElement('img');m.src=it.src;m.alt=it.cap||'';}"
  + "m.addEventListener('click',function(e){e.stopPropagation();});lb.insertBefore(m,cp);cp.textContent=it.cap||'';var many=list.length>1;pv.style.display=nx.style.display=many?'flex':'none';}"
  + "function open(l,i){list=l;lb.classList.add('on');d.documentElement.style.overflow='hidden';show(i);}"
  + "function close(){clr();lb.classList.remove('on');d.documentElement.style.overflow='';}"
  + "lb.addEventListener('click',function(e){if(e.target===lb||e.target.classList.contains('x'))close();});pv.addEventListener('click',function(e){e.stopPropagation();show(ix-1);});nx.addEventListener('click',function(e){e.stopPropagation();show(ix+1);});"
  + "d.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')close();else if(e.key==='ArrowLeft')show(ix-1);else if(e.key==='ArrowRight')show(ix+1);});"
  + "var ph=[].slice.call(d.querySelectorAll('.site img')).map(function(im){var f=im.closest('figure'),c=f&&f.querySelector('figcaption');return{src:im.currentSrc||im.src,cap:c?c.textContent.trim():im.alt};});"
  + "[].forEach.call(d.querySelectorAll('.site img'),function(im,i){im.addEventListener('click',function(){open(ph,i);});});"
  + "[].forEach.call(d.querySelectorAll('.vid video'),function(v){v.addEventListener('click',function(e){e.preventDefault();v.pause();var f=v.closest('figure'),c=f&&f.querySelector('figcaption');open([{v:1,src:v.getAttribute('src'),poster:v.getAttribute('poster'),cap:c?c.textContent.trim():''}],0);});});"
  + "})();";

const NET_JS = "(function(){var c=document.getElementById('net');if(!c)return;var x=c.getContext('2d'),w,h,P=[],N=70,R=150,dpr=Math.min(2,window.devicePixelRatio||1),mx=-1e4,my=-1e4;function size(){w=c.clientWidth;h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;x.setTransform(dpr,0,0,dpr,0,0);N=Math.max(34,Math.min(90,Math.round(w*h/16000)));P=[];for(var i=0;i<N;i++)P.push({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.35,vy:(Math.random()-.5)*.35,r:Math.random()*1.6+.6})}window.addEventListener('resize',size);size();window.addEventListener('pointermove',function(e){mx=e.clientX;my=e.clientY},{passive:true});var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;function step(){x.clearRect(0,0,w,h);for(var i=0;i<P.length;i++){var p=P[i];if(!reduce){p.x+=p.vx;p.y+=p.vy;var dx=p.x-mx,dy=p.y-my,d=Math.hypot(dx,dy);if(d<140){p.x+=dx/d*.6;p.y+=dy/d*.6}}if(p.x<0||p.x>w)p.vx*=-1;if(p.y<0||p.y>h)p.vy*=-1;}for(var i=0;i<P.length;i++){for(var j=i+1;j<P.length;j++){var a=P[i],b=P[j],dd=Math.hypot(a.x-b.x,a.y-b.y);if(dd<R){x.globalAlpha=(1-dd/R)*.35;x.strokeStyle='#4fa3ff';x.lineWidth=1;x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke()}}}x.globalAlpha=1;for(var i=0;i<P.length;i++){var p=P[i];x.fillStyle='#8fd0ff';x.beginPath();x.arc(p.x,p.y,p.r,0,6.283);x.fill()}if(!reduce)requestAnimationFrame(step)}step();})();";

module.exports = { homePage, LANGS, T, NET_JS };
