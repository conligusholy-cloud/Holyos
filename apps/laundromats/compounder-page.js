// Laundromats — stránka Compounder (převzato z Best Series 2.0: apps/bs2/views.js supporterCompounder, bez částí pro podporovatele).
'use strict';
const { layout, cta, esc } = require('./lm-layout');
const { ico } = require('./icons'); // kopie apps/bs2/icons.js

function compounderPage() {
  const P = [
    ['01', 'Nekupuje stroj. Kupuje čas.', 'Prádlomat nepotřebuje obsluhu, pracuje 24/7 a vydělává, i když spíte. Compounder počítá, kolik hodin svého života si každým strojem koupí zpátky — ne jen kolik korun.'],
    ['02', 'První stroj neslouží k utrácení. Slouží k pořízení druhého.', 'Výnos z prvního prádlomatu jde na splátku a zálohu dalšího. Spotřeba přijde až ve chvíli, kdy síť vydělává víc, než stačíte utratit. To je rozdíl mezi majitelem a Compounderem.'],
    ['03', 'Používá páku, ne úspory.', 'Bankovní domy berou prádlomat jako zástavu. Compounder nečeká, až našetří — nechá stroj, ať si na sebe vydělá sám, a své peníze používá jen tam, kde banka nemůže.'],
    ['04', 'Nemyslí na jeden stroj. Myslí na linku.', 'Jeden prádlomat je experiment. Pět prádlomatů je příjem. Dvacet je svoboda. Compounder se od začátku rozhoduje tak, aby šlo každé další místo zopakovat stejně — stejná smlouva, stejný servis, stejný proces.'],
    ['05', 'Místo je důležitější než stroj.', 'Stroj je vždycky stejný. Rozdíl dělá místo: lidé, průchod, parkování, konkurence. Compounder tráví čas hledáním dobrých míst, protože ví, že stroj dodáme my a místo si musí najít sám.'],
    ['06', 'Hraje na čas, ne na dokonalost.', 'Pravidla se změnila 24. 9. 2026 — dnes je to podpultová informace. Compounder ví, že okno nebude otevřené věčně, a radši má tři stroje teď než pět „až to bude ideální".'],
    ['07', 'Nedrží informaci pro sebe.', 'Lidé, které přivede, kupují vedle něj — ne proti němu. Každý další Compounder v okolí zvedá povědomí o prádlomatech, a tím i obrat všech. Proto má svůj doporučovací odkaz a Discount Credit.'],
    ['08', 'Měří, co se násobí.', 'Počet strojů. Měsíční obrat na stroj. Kolik strojů si síť sama zaplatí ročně. Compounder zná svoje tři čísla zpaměti a každé rozhodnutí poměřuje tím, jestli je zvedne.'],
  ];
  const steps = [['Rok 1', 1, 'první stroj si splácí sám'], ['Rok 2', 2, 'výnos z prvního = záloha na druhý'], ['Rok 3', 4, 'dva stroje platí dva další'], ['Rok 4', 8, 'síť roste rychleji než Vaše výdaje'], ['Rok 5', 16, 'linka — svoboda']];
  // Fáze Compoundera — doplňujeme postupně
  const PHASES = [
    { no: '0', k: 'Jak to vlastně funguje', title: 'Prádlomat po spuštění', visual: 'how', lead: 'Než se pustíme do strategie, podívejte se, co se děje, když prádlomat <b>uvedete do chodu</b>. Stojí na dobrém místě, je otevřený <b>24 hodin denně, 7 dní v týdnu</b> — a nepotřebuje žádnou obsluhu. Zákazník přijde, zaplatí, vypere nebo usuší. Peníze jdou na Váš účet.',
      points: [] },
    { no: '1', k: 'Vztah s bankovním domem', title: 'Sblížení', visual: 'pilots', lead: 'Stejně jako mezi lidmi je i mezi Vámi a bankovním domem potřeba vybudovat vztah. Teď jste pro něj <b>nový partner</b> — a potřebuje Vás trochu poznat. Strategie je jednoduchá: <b>začněte jedním prvním prádlomatem</b> — verze MINI, ideálně bez financování.',
      points: [
        ['box', 'Jeden první prádlomat', 'Začněte <b>jedním strojem</b>. Ne třemi, ne pěti. Jeden stroj na jednom místě dá všechna data, která potřebujete — a nic Vás nenutí dělat další rozhodnutí dřív, než budete vědět.'],
        ['bolt', 'Verze MINI, ideálně bez financování', 'Pro první stroj doporučujeme <b>verzi MINI</b> a nejlépe ji <b>koupit za vlastní</b>. Žádná splátka, stroj od prvního dne vydělává jen Vám — a pro banku je to první důkaz, že to myslíte vážně.'],
        ['check', 'Pokud financování, pak s maximální akontací', 'Když první stroj přece jen financujete, dejte <b>co nejvyšší akontaci</b>. Čím víc vložíte, tím lépe Vás banka čte: nižší riziko, lepší podmínky pro další kola.'],
        ['sun', 'Tomuto stroji říkáme Pilot', 'Pilot slouží především k jednomu: <b>ověřit správné místo</b>. Stroj je vždycky stejný — rozdíl dělá lokalita. Pilot ji otestuje naostro.'],
      ],
      timeline: [['Den 0', 'Pilot v provozu'], ['1–6 měsíců', 'sběr dat o místě: obrat, vytížení, opakovaní zákazníci'], ['~6 měsíců', 'místo se verifikuje — nebo Pilota přemístíme jinam']],
      note: 'Dle statistik víme zhruba <b>po 6 měsících</b>, jestli se místo verifikuje, nebo je potřeba stroj přemístit na jiné místo. Díky tomu nikdy nerozšiřujete síť na místě, které nefunguje — a banka vidí, že rozhodujete podle čísel.' },
    { no: '2', k: 'Po 6 měsících', title: 'Násobení', visual: 'scale', lead: 'Uplynulo 6 měsíců. Už víte, <b>kteří Piloti místo verifikovali</b> a kteří ne. Od této chvíle se mění pravidla: na ověřené místo jde další stroj <b>100 % zafinancovaný</b> (0 % akontace) — stroj splácí sám sebe a ještě něco zbývá.',
      points: [
        ['check', 'Verifikované místo = stroj 100 % zafinancovaný', 'Na místo, které prokázalo čísla, dodáme <b>další prádlomat 100 % zafinancovaný bankou</b> — 0 % akontace. Nic nevkládáte — stroj si na sebe vydělá a splátku pokryje z vlastního obratu.'],
        ['network', 'Neverifikované místo = počkat, nebo přemístit', 'Pilot, který místo neověřil, buď ještě chvíli počká, nebo ho <b>přesuneme na nové místo</b>. Nic se neztrácí — stroj jede dál, jen jinde.'],
        ['box', 'Přistavujete další a další', 'Každé ověřené místo unese víc strojů a každý nový Pilot otevírá další místo. Síť roste z vlastních výnosů, ne z Vašich úspor.'],
        ['sun', 'Po pěti letech zůstane všechno Vám', 'Máte dobré místo, víte, kolik tam vyděláte, a víte, že se prádlomat sám zaplatí. Po splacení <b>je stroj i jeho výnos Váš</b> — každý měsíc, napořád.'],
      ],
      decision: true,
      note: 'Tady je potřeba udělat důležité rozhodnutí: <b>Kolik prádlomatů vlastně chci?</b> 3, 5, 10 nebo 100? Otázka nezní, kolik si můžete dovolit — ale <b>kolik peněz chcete mít pravidelně měsíčně za 5 let, až se doplatí financování</b>.' },
    { no: '3', k: 'Pořád dokola', title: 'Smyčka', visual: 'loop', lead: 'Fáze 3 je v podstatě <b>opakování fází 1 a 2</b>. Pilotem ověříte místo, na ověřené místo dodáme 100 % zafinancovaný stroj, Pilota přesunete na nové místo a ověřujete znovu. <b>A tak pořád dokola.</b> Jediné, co je na Vás: kolik opakování uděláte.',
      points: [
        ['network', '1 · Pilot na nové místo', 'Pilota (stále ten samý MINI) postavíte na nové místo — začíná kolo.'],
        ['sun', '2 · Pilot ověřuje místo', 'Jeden stroj MINI, náběhová křivka, čísla rozhodnou.'],
        ['check', '3 · Místo verifikováno', 'Obrat a vytížení potvrdily, že místo funguje.'],
        ['box', '4 · Dodáme zafinancovaný stroj', 'Na ověřené místo jde prádlomat 100 % zafinancovaný. Splácí se sám — a Pilot jede na další místo. Každé kolo = +1 stroj, který je po splacení Váš.'],
      ] },
  ];
  return layout({ title: 'Compounder', desc: 'Jak přemýšlí správný Compounder — od prvního prádlomatu k síti, která se splácí sama.', active: 'compounder', body: `
  <style>
  .cp .hero2{margin:22px 0 26px;max-width:860px}
  .cp .hero2 .k{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent2);font-weight:700}
  .cp .hero2 h1{margin:4px 0 10px;font-size:clamp(30px,5vw,56px);line-height:1.02;letter-spacing:-.03em;font-weight:900}
  .cp .hero2 h1 .g{background:linear-gradient(90deg,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .hero2 p{margin:0;font-size:clamp(16px,1.8vw,19px);line-height:1.55;color:var(--text)}
  .cp .def{display:flex;gap:16px;align-items:flex-start;padding:18px 20px;border-radius:18px;border:1px solid rgba(79,209,255,.4);background:linear-gradient(135deg,rgba(30,134,224,.16),rgba(124,92,255,.14));margin:0 0 26px;max-width:860px}
  .cp .def .q{flex:none;width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;color:var(--accent2);background:rgba(4,8,16,.5);border:1px solid var(--border2)}
  .cp .def b{display:block;font-size:17px;margin-bottom:4px}
  .cp .def p{margin:0;color:var(--text);line-height:1.5}
  .cp .ladder{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:0 0 10px}
  .cp .ladder .r{padding:16px 12px;border-radius:16px;border:1px solid var(--border);background:var(--card);text-align:center;position:relative}
  .cp .ladder .r .y{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);font-weight:700}
  .cp .ladder .r .n{font-size:clamp(28px,4vw,44px);font-weight:900;letter-spacing:-.03em;line-height:1.1;margin:4px 0;background:linear-gradient(180deg,#fff,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .ladder .r .t{font-size:12px;color:var(--text2);line-height:1.35}
  .cp .ladder .r:last-child{border-color:rgba(47,227,160,.55);box-shadow:0 0 30px rgba(47,227,160,.18)} .cp .ladder .r:last-child .n{background:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .note{font-size:12.5px;color:var(--text3);margin:0 0 28px;max-width:860px}
  .cp h2.sec{font-size:clamp(20px,2.6vw,28px);letter-spacing:-.02em;margin:0 0 14px}
  .cp .pr{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 28px}
  .cp .pr .c{padding:20px;border-radius:16px;border:1px solid var(--border);background:var(--card);display:flex;gap:16px;transition:border-color .2s,transform .2s}
  .cp .pr .c:hover{border-color:rgba(79,209,255,.5);transform:translateY(-2px)}
  .cp .pr .c .no{flex:none;font-size:30px;font-weight:900;letter-spacing:-.04em;line-height:1;background:linear-gradient(180deg,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent;min-width:46px}
  .cp .pr .c b{display:block;font-size:16.5px;margin:2px 0 6px;letter-spacing:-.01em}
  .cp .pr .c p{margin:0;color:var(--text2);font-size:14px;line-height:1.5}
  .cp .vs{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 28px}
  .cp .vs .c{padding:18px 20px;border-radius:16px;border:1px solid var(--border);background:var(--card)}
  .cp .vs .c.b{border-color:rgba(47,227,160,.5)} .cp .vs .c .h{font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;margin-bottom:10px} .cp .vs .c.a .h{color:var(--text3)} .cp .vs .c.b .h{color:var(--ok)}
  .cp .vs ul{margin:0;padding:0;list-style:none} .cp .vs li{padding:7px 0;border-top:1px solid var(--border);font-size:14px;line-height:1.4} .cp .vs li:first-child{border-top:0} .cp .vs .c.a li{color:var(--text2)}
  .cp .ph{margin:0 0 28px;padding:26px 28px;border-radius:22px;border:1px solid rgba(79,209,255,.3);background:linear-gradient(135deg,rgba(30,134,224,.12),rgba(124,92,255,.1));position:relative;overflow:hidden}
  .cp .ph:before{content:'';position:absolute;inset:-40%;background:radial-gradient(circle at 15% 15%,rgba(79,209,255,.16),transparent 45%);pointer-events:none}
  .cp .ph>*{position:relative}
  .cp .ph-head{display:flex;gap:20px;align-items:flex-start;margin-bottom:20px}
  .cp .ph-no{flex:none;width:76px;height:76px;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(30,134,224,.5),rgba(124,92,255,.5));border:1px solid rgba(79,209,255,.5);box-shadow:0 14px 40px rgba(30,134,224,.35)}
  .cp .ph-no span{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#dff3ff;font-weight:700} .cp .ph-no b{font-size:34px;line-height:1;letter-spacing:-.03em;color:#fff}
  .cp .ph-k{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent2);font-weight:700}
  .cp .ph-head h2{margin:4px 0 8px;font-size:clamp(24px,3.2vw,36px);letter-spacing:-.025em}
  .cp .ph-head p{margin:0;color:var(--text);line-height:1.55;max-width:760px;font-size:15.5px}
  .cp .how{margin:4px 0 22px;padding:14px;border-radius:18px;border:1px solid var(--border);background:radial-gradient(ellipse at 50% 100%,rgba(79,209,255,.12),transparent 60%),rgba(4,8,16,.45)}
  .cp .how-stage{position:relative;width:min(100%,440px);margin:0 auto;aspect-ratio:1000/820;overflow:visible;min-height:560px}
  .cp .how-mach{position:absolute;inset:0}
  .cp .how-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 24px 40px rgba(0,0,0,.7)) drop-shadow(0 0 30px rgba(79,209,255,.25))}
  .cp .how-w8{width:9%!important}
  .cp .how-d{position:absolute;width:12%;aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none}
  .cp .how-d i{position:absolute;inset:0;border-radius:50%;border:3px solid rgba(79,209,255,.0);transition:border-color .3s}
  .cp .how-d span{position:absolute;left:50%;top:106%;transform:translateX(-50%);white-space:nowrap;font-size:10px;font-weight:700;color:#fff;background:rgba(4,8,16,.7);padding:1px 6px;border-radius:999px;opacity:0;transition:opacity .3s} .cp .how-d.on span{opacity:1}
  .cp .how-d.on i{border-color:rgba(79,209,255,.85);box-shadow:0 0 22px rgba(79,209,255,.55),inset 0 0 18px rgba(79,209,255,.25);border-top-color:#fff;animation:howspin .7s linear infinite}
  .cp .how-s.on i{border-color:rgba(245,158,11,.9);box-shadow:0 0 22px rgba(245,158,11,.55),inset 0 0 18px rgba(245,158,11,.25);border-top-color:#fff;animation:howspin 1s linear infinite}
  @keyframes howspin{to{transform:rotate(360deg)}}
  .cp .how-cust,.cp .how-bag{position:absolute;line-height:1;transform:translate(-50%,-50%);opacity:0;filter:drop-shadow(0 6px 10px rgba(0,0,0,.7));z-index:3}
  .cp .how-cust{width:22%;aspect-ratio:1/2} .cp .how-cust.flip svg{transform:scaleX(-1)} .cp .how-cust svg{width:100%;height:100%;display:block;animation:howbob .7s ease-in-out infinite}
  @keyframes howbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3%)}}
  .cp .how-bag{font-size:30px;z-index:4}
  .cp .how-tag{position:absolute;transform:translate(-50%,-100%);padding:5px 10px;border-radius:999px;background:rgba(4,8,16,.85);border:1px solid rgba(79,209,255,.45);color:#fff;font-size:12px;font-weight:700;white-space:nowrap;opacity:0;transition:opacity .3s,left .5s,top .5s;z-index:5;pointer-events:none}
  .cp .how-door{position:absolute;left:2%;bottom:6%;width:9%;height:40%;border-radius:8px;border:1px dashed rgba(79,209,255,.35);display:flex;align-items:flex-end;justify-content:center;font-size:10px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase;padding-bottom:4px}
  .cp .how-clock{position:absolute;left:-32%;top:0;width:24%;text-align:center;z-index:6}
  .cp .how-clock svg{width:100%;height:auto;display:block;filter:drop-shadow(0 10px 24px rgba(0,0,0,.6)) drop-shadow(0 0 16px rgba(79,209,255,.2))}
  .cp .how-clock .hc-txt{margin-top:6px} .cp .how-clock .hc-txt b{display:block;font-size:clamp(16px,2.2vw,24px);letter-spacing:-.02em;color:#fff} .cp .how-clock .hc-txt span{font-size:11px;color:var(--text2);letter-spacing:.14em;text-transform:uppercase}
  .cp .how-acc{position:absolute;right:-34%;top:0;width:210px;box-sizing:border-box;white-space:nowrap;padding:10px 14px;border-radius:14px;background:rgba(4,8,16,.85);border:1px solid rgba(47,227,160,.45);box-shadow:0 14px 34px rgba(0,0,0,.5),0 0 24px rgba(47,227,160,.15);text-align:right;z-index:6;backdrop-filter:blur(8px)}
  .cp .how-acc b{display:block;font-size:clamp(20px,2.6vw,30px);letter-spacing:-.02em;line-height:1.1;background-image:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .how-coins{position:absolute;inset:0;pointer-events:none;z-index:5} .cp .how-coins .coin{position:absolute;transform:translate(-50%,-50%);font-style:normal;font-weight:900;color:var(--ok);text-shadow:0 0 12px rgba(47,227,160,.7);animation:howcoin 1.8s ease-out forwards}
  @keyframes howcoin{0%{opacity:0;margin-top:0;transform:translate(-50%,-50%) scale(.6)}20%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}100%{opacity:0;margin-top:-120px;margin-left:120px;transform:translate(-50%,-50%) scale(.9)}}
  .cp .how-cas{position:absolute;right:-34%;top:26%;width:210px;display:flex;flex-direction:column;gap:6px;z-index:6}
  .cp .how-cas .cs,.cp .how-cas button{opacity:0;transform:translateY(-14px) scale(.96);transition:opacity .45s,transform .45s cubic-bezier(.2,1.3,.4,1)} .cp .how-cas .in{opacity:1;transform:none}
  .cp .how-cas .cs{display:flex;flex-direction:column;align-items:flex-end;text-align:right;padding:7px 12px;box-sizing:border-box;width:100%;border-radius:12px;background:rgba(4,8,16,.85);border:1px solid var(--border2);backdrop-filter:blur(8px);box-shadow:0 10px 24px rgba(0,0,0,.45)}
  .cp .how-cas .cs small{display:block;font-size:10.5px;color:var(--text2);line-height:1.35;margin-top:3px} .cp .how-cas .cs small i{font-style:normal;color:#fff} .cp .how-cas .cs b{font-size:clamp(18px,2.2vw,24px);letter-spacing:-.02em;color:#fff;margin-top:2px;white-space:nowrap}
  .cp .how-cas .cs.m{border-color:rgba(245,158,11,.4)} .cp .how-cas .cs.m b{color:#f59e0b}
  .cp .how-cas .cs.r{border-color:rgba(47,227,160,.6);background:rgba(47,227,160,.12);box-shadow:0 10px 30px rgba(47,227,160,.25)} .cp .how-cas .cs.r b{font-size:22px;background-image:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .how-cas .cs.r.neg{border-color:rgba(239,68,68,.7);background:rgba(239,68,68,.14);box-shadow:0 10px 30px rgba(239,68,68,.3)} .cp .how-cas .cs.r.neg b{background-image:linear-gradient(180deg,#fff,#ef4444);text-shadow:0 0 14px rgba(239,68,68,.6)}
  .cp .how-cas button{align-self:stretch}
  .cp .how-foot{display:flex;flex-wrap:wrap;gap:10px 22px;justify-content:center;margin-top:28px;position:relative;z-index:7;font-size:12.5px;color:var(--text2)} .cp .how-foot b{color:var(--accent2)}
  /* Telefon: stejné rozložení jako na počítači (hodiny vlevo, stroj uprostřed, karty vpravo), celé zmenšené podle šířky (zoom nastaví skript) */
  @media(max-width:700px){.cp .how{padding:10px 4px;overflow:hidden} .cp .how-stage{width:440px;max-width:none;min-height:560px} .cp .how-foot{margin-top:14px;font-size:12px;gap:6px 14px} .cp .how-clock{left:-21%;width:22%} .cp .how-clock .hc-txt b{font-size:24px} .cp .how-clock .hc-txt span{font-size:12px} .cp .how-acc,.cp .how-cas{right:-21%;width:200px} .cp .how-acc b{font-size:32px} .cp .how-acc .dec-k,.cp .how-cas .cs .dec-k{font-size:11px} .cp .how-acc .dec-s{font-size:14px} .cp .how-cas .cs b{font-size:27px} .cp .how-cas .cs small{font-size:12.5px} .cp .how-cas .cs.r b{font-size:27px} .cp .how-tag{font-size:14px}}
  .cp .pilots{margin:4px 0 22px;padding:18px 18px 14px;border-radius:18px;border:1px solid var(--border);background:radial-gradient(ellipse at 50% 100%,rgba(79,209,255,.14),transparent 60%),rgba(4,8,16,.45)}
  .cp .pl-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:end}
  .cp .pl-row.one{grid-template-columns:1fr;justify-items:center} .cp .pl-row.one .pl{width:min(100%,520px)}
  .cp .pl{position:relative;text-align:center;animation:pmfloat 5s ease-in-out infinite}
  .cp .pl img{width:100%;height:auto;filter:drop-shadow(0 22px 36px rgba(0,0,0,.65)) drop-shadow(0 0 26px rgba(79,209,255,.25))}
  .cp .pl .pl-tag{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);padding:5px 12px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));box-shadow:0 8px 24px rgba(30,134,224,.45);white-space:nowrap}
  .cp .pl .pl-mini{position:absolute;top:6px;right:6px;padding:3px 8px;border-radius:999px;font-size:10.5px;font-weight:800;letter-spacing:.1em;color:var(--accent2);border:1px solid rgba(79,209,255,.5);background:rgba(4,8,16,.75)}
  .cp .pl-cap{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:center;margin-top:22px;font-size:13.5px;color:var(--text)}
  .cp .pl-cap span{display:inline-flex;align-items:center;gap:8px} .cp .pl-cap i{width:8px;height:8px;border-radius:50%;background:var(--accent2);box-shadow:0 0 10px var(--accent2)}
  .cp .pl-cap .pl-arrow{color:var(--text3);font-size:18px} .cp .pl-cap .pl-goal{color:var(--ok);font-weight:700}
  @keyframes pmfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  @media(max-width:760px){.cp .pl-row{grid-template-columns:1fr;gap:20px} .cp .pl img{max-width:220px} .cp .pl .pl-tag{font-size:10.5px;padding:4px 10px} .cp .pl .pl-mini{font-size:9.5px;padding:2px 7px}}
  .cp .scale{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin:4px 0 22px}
  .cp .sc-col{padding:16px;border-radius:18px;border:1px solid var(--border);background:rgba(4,8,16,.45);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;position:relative}
  .cp .sc-col.ok{border-color:rgba(47,227,160,.45);background:radial-gradient(ellipse at 50% 100%,rgba(47,227,160,.12),transparent 60%),rgba(4,8,16,.45)}
  .cp .sc-col.wait{border-color:rgba(245,158,11,.4)}
  .cp .sc-h{width:100%;display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700} .cp .sc-h i{width:8px;height:8px;border-radius:50%}
  .cp .sc-col.ok .sc-h{color:var(--ok)} .cp .sc-col.ok .sc-h i{background:var(--ok);box-shadow:0 0 10px var(--ok)}
  .cp .sc-col.wait .sc-h{color:#f59e0b} .cp .sc-col.wait .sc-h i{background:#f59e0b;box-shadow:0 0 10px #f59e0b}
  .cp .sc-m{position:relative;width:38%;min-width:150px;text-align:center;animation:pmfloat 5s ease-in-out infinite} .cp .sc-m.new{animation-delay:-2s} .cp .sc-col.wait .sc-m{width:52%}
  .cp .sc-m img{width:100%;height:auto;filter:drop-shadow(0 18px 30px rgba(0,0,0,.65)) drop-shadow(0 0 22px rgba(79,209,255,.22))}
  .cp .sc-m.dim img{filter:grayscale(.7) brightness(.7) drop-shadow(0 18px 30px rgba(0,0,0,.65))}
  .cp .sc-m .pl-tag{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);padding:5px 12px;border-radius:999px;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));white-space:nowrap;box-shadow:0 8px 24px rgba(30,134,224,.45)}
  .cp .sc-m .pl-tag.z{background:linear-gradient(135deg,#1ea97c,var(--ok));box-shadow:0 8px 24px rgba(47,227,160,.4)} .cp .sc-m .pl-tag.g{background:#3a4454;box-shadow:none}
  .cp .sc-plus{font-size:34px;font-weight:900;color:var(--ok);text-shadow:0 0 18px rgba(47,227,160,.6)} .cp .sc-arrow{font-size:28px;color:#f59e0b}
  .cp .sc-t{width:100%;text-align:center;font-size:13px;color:var(--text2);margin-top:10px}
  .cp .loopwrap{display:flex;flex-direction:column;gap:18px;align-items:stretch;margin:4px 0 22px}
  .cp .loop{position:relative;aspect-ratio:1;max-width:560px;margin:0 auto;width:100%}
  .cp .loop-svg{width:100%;height:100%;display:block}
  .cp .loop-dash{animation:lpspin 30s linear infinite;transform-origin:210px 210px}
  @keyframes lpspin{to{transform:rotate(360deg)}}
  .cp .ln{position:absolute;width:170px;padding:10px 12px;border-radius:14px;border:1px solid var(--border2);background:rgba(4,8,16,.85);backdrop-filter:blur(8px);box-shadow:0 14px 30px rgba(0,0,0,.45);text-align:center}
  .cp .ln i{position:absolute;top:-12px;left:50%;transform:translateX(-50%);width:24px;height:24px;border-radius:50%;font-style:normal;font-weight:800;font-size:12px;color:#fff;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--accent),var(--vio));box-shadow:0 0 14px rgba(79,209,255,.5)}
  .cp .ln b{display:block;font-size:13px;line-height:1.25;margin-top:4px} .cp .ln span{font-size:11px;color:var(--text2)}
  .cp .ln.n1{top:2%;left:50%;transform:translateX(-50%)} .cp .ln.n2{top:50%;right:-4%;transform:translateY(-50%)} .cp .ln.n3{bottom:2%;left:50%;transform:translateX(-50%);border-color:rgba(47,227,160,.55)} .cp .ln.n3 i{background:linear-gradient(135deg,#1ea97c,var(--ok))} .cp .ln.n4{top:50%;left:-4%;transform:translateY(-50%)}
  .cp .lp-img{position:absolute;left:50%;top:14%;width:84px;height:auto;transform:translate(-50%,-50%);opacity:0;pointer-events:none;filter:drop-shadow(0 14px 22px rgba(0,0,0,.7)) drop-shadow(0 0 14px rgba(79,209,255,.35));z-index:3;will-change:left,top,transform,opacity}
  .cp #lp-flex{width:110px}
  .cp .lp-pilot{display:flex;flex-direction:column;align-items:center;gap:2px;width:92px;filter:none}
  .cp .lp-pilot img{width:84px;height:auto;filter:drop-shadow(0 14px 22px rgba(0,0,0,.7)) drop-shadow(0 0 14px rgba(79,209,255,.35));position:relative;z-index:1}
  .cp .lp-pilot .lp-ring{position:absolute;left:50%;top:40%;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;border:1.5px dashed rgba(79,209,255,.55);animation:lpspin 14s linear infinite;z-index:0}
  .cp .lp-pilot .lp-tag{white-space:nowrap;font-size:9.5px;font-weight:800;letter-spacing:.1em;padding:3px 8px;border-radius:999px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));box-shadow:0 6px 16px rgba(30,134,224,.45);position:relative;z-index:1}
  .cp .lp-stamp{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-14deg);padding:4px 10px;border:3px solid var(--ok);border-radius:8px;color:var(--ok);font-weight:900;font-size:13px;letter-spacing:.14em;background:rgba(4,8,16,.7);opacity:0;pointer-events:none;z-index:4;text-shadow:0 0 10px rgba(47,227,160,.6);box-shadow:0 0 18px rgba(47,227,160,.4)}
  .cp .ln{z-index:2}
  .cp .lp-income{position:absolute;right:-4%;bottom:4%;z-index:4;padding:10px 14px;border-radius:14px;border:1px solid rgba(47,227,160,.45);background:rgba(4,8,16,.8);backdrop-filter:blur(8px);box-shadow:0 14px 34px rgba(0,0,0,.5),0 0 24px rgba(47,227,160,.15);text-align:right;min-width:170px}
  .cp .lp-income .k{display:block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--text3);font-weight:700}
  .cp .lp-income b{display:block;font-size:clamp(20px,2.6vw,28px);letter-spacing:-.02em;line-height:1.1;background-image:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .lp-income .s{display:block;font-size:10.5px;color:var(--text2);margin-top:2px}
  .cp .lp-income.bump{animation:incbump .5s cubic-bezier(.2,1.4,.4,1)} @keyframes incbump{0%{transform:scale(1)}40%{transform:scale(1.08);box-shadow:0 14px 34px rgba(0,0,0,.5),0 0 40px rgba(47,227,160,.45)}100%{transform:scale(1)}}
  @media(max-width:900px){.cp .loop{margin-bottom:92px} .cp .lp-income{right:auto;left:50%;bottom:-88px;transform:translateX(-50%);text-align:center;min-width:200px}}
  .cp .loop-fleet{margin-top:6px;padding:10px 12px;border-radius:14px;border:1px dashed var(--border2);background:rgba(4,8,16,.4)}
  .cp .lf-h{display:flex;align-items:center;justify-content:space-between;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);font-weight:700;margin-bottom:6px} .cp .lf-h b{font-size:14px;color:var(--ok);letter-spacing:0}
  .cp .lf-row{display:flex;flex-wrap:wrap;gap:6px;min-height:44px;align-items:flex-end}
  .cp .lf-row{justify-content:center;--lfw:80px} .cp .lf-m{width:var(--lfw);height:auto;transition:width .6s ease;filter:drop-shadow(0 8px 14px rgba(0,0,0,.6)) drop-shadow(0 0 10px rgba(79,209,255,.3));animation:lfpop .5s cubic-bezier(.2,1.4,.4,1) both}
  @keyframes lfpop{from{transform:translateY(-14px) scale(.4);opacity:0}to{transform:none;opacity:1}}
  .cp .rep{padding:20px 22px;border-radius:18px;border:1px solid rgba(79,209,255,.4);background:linear-gradient(135deg,rgba(30,134,224,.14),rgba(124,92,255,.1))}
  .cp .rep-q{font-size:clamp(20px,2.4vw,26px);font-weight:900;letter-spacing:-.02em} .cp .rep-sub{color:var(--text2);font-size:13.5px;margin:4px 0 14px} .cp .rep-sub b{color:var(--accent2)}
  .cp .rep input[type=range]{width:100%;accent-color:#4fd1ff;margin:0 0 14px}
  .cp .rep-out{display:flex;flex-wrap:wrap;gap:14px 22px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:rgba(4,8,16,.5);border:1px solid var(--border)}
  .cp .rep-out b{display:block;font-size:clamp(22px,3vw,32px);letter-spacing:-.02em;line-height:1.1;background-image:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .rep-money{margin-left:auto;text-align:right} .cp .rep-money b{background-image:linear-gradient(180deg,#fff,var(--accent2))}
  .cp .rep-dots{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px;align-items:center} .cp .rep-dots i{width:14px;height:14px;border-radius:4px;background:linear-gradient(135deg,var(--accent),var(--vio));box-shadow:0 0 8px rgba(79,209,255,.4)} .cp .rep-dots i:first-child{background:linear-gradient(135deg,#1ea97c,var(--ok))} .cp .rep-dots em{font-style:normal;font-size:12px;color:var(--text2);margin-left:4px}
  @media(max-width:900px){.cp .ln{width:128px} .cp .ln.n2{right:-2%} .cp .ln.n4{left:-2%}}
  .cp .dec{margin-top:14px;padding:20px 22px;border-radius:18px;border:1px solid rgba(124,92,255,.45);background:linear-gradient(135deg,rgba(124,92,255,.14),rgba(30,134,224,.1))}
  .cp .dec-q{font-size:clamp(20px,2.6vw,28px);font-weight:900;letter-spacing:-.02em;margin-bottom:12px}
  .cp .dec-opts{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
  .cp .dec-o{font:inherit;font-weight:800;font-size:20px;min-width:72px;padding:12px 18px;border-radius:14px;border:1px solid var(--border2);background:rgba(4,8,16,.6);color:var(--text2);cursor:pointer;transition:all .2s}
  @media(max-width:700px){.cp .dec-opts{flex-wrap:nowrap;gap:6px} .cp .dec-o{flex:1 1 0;min-width:0;padding:10px 4px;font-size:18px}}
  .cp .dec-o:hover{color:var(--text);border-color:rgba(79,209,255,.5)} .cp .dec-o.on{color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));border-color:transparent;box-shadow:0 10px 30px rgba(30,134,224,.4);transform:translateY(-2px)}
  .cp .dec-money{margin-left:auto;text-align:right} .cp .dec-money b{background-image:linear-gradient(180deg,#fff,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
  @media(max-width:640px){.cp .dec-out{flex-direction:column;align-items:flex-start} .cp .dec-money{margin-left:0;text-align:left}}
  .cp .dec-out{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 16px;border-radius:14px;background:rgba(4,8,16,.5);border:1px solid var(--border);margin-bottom:12px}
  .cp .dec-k{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--text3);font-weight:700}
  .cp .dec-out b{display:block;font-size:clamp(22px,3vw,32px);letter-spacing:-.02em;line-height:1.1;background:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .dec-s{display:block;font-size:13px;color:var(--text2);margin-top:2px}
  .cp .dec-ask{font-size:15px;line-height:1.5;color:var(--text)} .cp .dec-ask b{color:var(--accent2)}
  @media(max-width:760px){.cp .scale{grid-template-columns:1fr}}
  /* Telefon: oba stroje vedle sebe s plusem jako na počítači, jen menší (žádné zalamování pod sebe) */
  @media(max-width:700px){.cp .sc-col{flex-wrap:wrap;gap:6px 4px;padding:12px 8px 14px}.cp .sc-h{flex:0 0 100%;margin-bottom:2px}.cp .sc-col .sc-m{width:40%;min-width:0;flex:0 0 40%}.cp .sc-col.wait .sc-m{width:48%;flex-basis:48%}.cp .sc-plus{font-size:24px;flex:0 0 28px;text-align:center}.cp .sc-arrow{font-size:22px;flex:0 0 28px;text-align:center}.cp .sc-m .pl-tag{font-size:10px;padding:3px 9px;letter-spacing:.04em;white-space:nowrap}.cp .sc-t{flex:0 0 100%;font-size:12.5px;margin-top:4px}}
  .cp .ph-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:18px}
  .cp .ph-grid .c{padding:16px 18px;border-radius:16px;border:1px solid var(--border);background:rgba(4,8,16,.55)}
  .cp .ph-grid .i{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:var(--accent2);background:linear-gradient(135deg,rgba(30,134,224,.35),rgba(124,92,255,.35));border:1px solid var(--border2);margin-bottom:10px}
  .cp .ph-grid b{display:block;font-size:15.5px;margin-bottom:4px} .cp .ph-grid p{margin:0;color:var(--text2);font-size:13.5px;line-height:1.5} .cp .ph-grid p b{display:inline;color:var(--accent2);font-size:inherit}
  .cp .ph-tl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
  .cp .ph-tl .s{position:relative;padding:14px 14px 14px 52px;border-radius:14px;border:1px dashed var(--border2);background:rgba(4,8,16,.4)}
  .cp .ph-tl .s i{position:absolute;left:14px;top:14px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:800;font-size:12px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio))}
  .cp .ph-tl .s b{display:block;font-size:14px} .cp .ph-tl .s span{font-size:12.5px;color:var(--text2);line-height:1.4}
  .cp .ph-tl .s:last-child{border-color:rgba(47,227,160,.5)} .cp .ph-tl .s:last-child i{background:linear-gradient(135deg,#1ea97c,var(--ok))}
  .cp .ph-note{margin:0;padding:12px 16px;border-radius:12px;background:rgba(47,227,160,.07);border:1px solid rgba(47,227,160,.3);color:var(--text);font-size:14px;line-height:1.5} .cp .ph-note b{color:var(--ok)}
  .cp .ph-head p b{color:var(--accent2)}
  @media(max-width:760px){.cp .ph{padding:20px 18px} .cp .ph-grid,.cp .ph-tl{grid-template-columns:1fr} .cp .ph-head{flex-direction:column;gap:12px}}
  .cp .cta{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;padding:22px 24px;border-radius:18px;border:1px solid var(--border2);background:var(--card2)}
  .cp .cta .q{font-size:clamp(18px,2.2vw,24px);font-weight:800;letter-spacing:-.02em} .cp .cta .q small{display:block;font-size:14px;font-weight:500;color:var(--text2);margin-top:4px}
  @media(max-width:760px){.cp .ladder{grid-template-columns:repeat(2,1fr)} .cp .pr,.cp .vs{grid-template-columns:1fr}}
  </style>
  <div class="cp">
    <div class="hero2"><div class="k">Laundromats</div><h1>Jak přemýšlí <span class="g">správný Compounder</span></h1>
      <p>Compounder není titul. Je to způsob uvažování. Stejný stroj, stejná cena, stejná smlouva — a přesto jeden člověk skončí s jedním prádlomatem a druhý se sítí. Rozdíl je jen v hlavě.</p></div>

    ${PHASES.map(ph => `<section class="ph">
      <div class="ph-head"><div class="ph-no"><span>Fáze</span><b>${ph.no}</b></div><div><div class="ph-k">${esc(ph.k)}</div><h2>${esc(ph.title)}</h2><p>${ph.lead}</p></div></div>
      ${ph.visual === 'pilots' ? `<div class="pilots"><div class="pl-row one"><div class="pl"><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI" loading="lazy" decoding="async"><span class="pl-tag">Pilot — Váš první prádlomat</span><span class="pl-mini">MINI · ideálně bez financování</span></div></div><div class="pl-cap"><span><i></i>1 stroj · verze MINI · za vlastní (nebo s max. akontací)</span><span class="pl-arrow">→</span><span class="pl-goal">cíl: ověřit místo do ~6 měsíců</span></div></div>` : ''}
      ${ph.visual === 'how' ? `<div class="how">
        <div class="how-stage">
          <div class="how-mach">
          <img class="how-img" src="/img/pradlomat-mini.webp?v=3" alt="Prádlomat MINI" loading="lazy" decoding="async">
          <div class="how-d how-w" id="how-w"><i></i><span>Pračka 18 kg</span></div>
          <div class="how-d how-s" id="how-s"><i></i><span>Sušička</span></div>
          <div class="how-cust" id="how-cust"><svg viewBox="0 0 60 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="hcB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fd1ff"/><stop offset="1" stop-color="#1e86e0"/></linearGradient></defs><circle cx="30" cy="16" r="12" fill="#f3c6a0"/><path d="M18 14c2-10 22-10 24 0-4-4-20-4-24 0z" fill="#3b2a20"/><path d="M14 44c0-10 8-14 16-14s16 4 16 14l-2 34H16z" fill="url(#hcB)"/><path d="M12 36l-8 30 7 2 7-26z" fill="#f3c6a0"/><path d="M48 36l8 30-7 2-7-26z" fill="#f3c6a0"/><path d="M17 76l-2 40h10l4-36zM43 76l2 40H35l-4-36z" fill="#1b2a44"/><path d="M12 116h14v4H12zM34 116h14v4H34z" fill="#0b1220"/><g class="hc-walk"><animateTransform attributeName="transform" type="rotate" values="-6 30 78;6 30 78;-6 30 78" dur=".7s" repeatCount="indefinite"/></g></svg></div>
          <div class="how-bag" id="how-bag">🧺</div>
          <div class="how-tag" id="how-tag"></div>
          <div class="how-coins" id="how-coins"></div>
          </div>
          <div class="how-clock" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="rgba(4,8,16,.8)" stroke="rgba(79,209,255,.5)" stroke-width="2"/>${Array.from({ length: 12 }, (_, i) => `<line x1="50" y1="8" x2="50" y2="${i % 3 === 0 ? 15 : 12}" stroke="${i % 3 === 0 ? '#fff' : 'rgba(255,255,255,.45)'}" stroke-width="${i % 3 === 0 ? 2.5 : 1.5}" transform="rotate(${i * 30} 50 50)"/>`).join('')}<circle id="hc-day" cx="50" cy="50" r="46" fill="none" stroke="rgba(79,209,255,.35)" stroke-width="4" stroke-dasharray="289" stroke-dashoffset="289" transform="rotate(-90 50 50)"/><line id="hc-h" x1="50" y1="50" x2="50" y2="26" stroke="#fff" stroke-width="4" stroke-linecap="round"/><line id="hc-m" x1="50" y1="50" x2="50" y2="14" stroke="#4fd1ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="50" cy="50" r="3" fill="#4fd1ff"/></svg><div class="hc-txt"><b id="hc-t">06:00</b><span id="hc-d">den 1</span></div></div>
          <div class="how-acc"><span class="dec-k">průměrná tržba za den</span><b><span id="how-sum">0</span> Kč</b><span class="dec-s" id="how-n">0 zákazníků</span></div>
          <div class="how-cas" id="how-cas">
          <div class="cs in"><span class="dec-k">tržba za měsíc</span><b id="hs-m">0 Kč</b><small>s DPH<br>bez DPH <i id="hs-mn">0 Kč</i></small></div>
          <div class="cs m in"><span class="dec-k">náklady za měsíc</span><b id="hs-cost">− 5 000 Kč</b><small>bez DPH<br>nájem 5 000 Kč<br>servis 13 % <i id="hs-serv">0 Kč</i><br>energie <i id="hs-en">0 Kč</i><i id="hs-env" hidden></i></small></div>
          <div class="cs r in"><span class="dec-k">zbude Vám měsíčně</span><b id="hs-res">− 6 050 Kč</b><small>s DPH<br>bez DPH <i id="hs-resn">− 5 000 Kč</i></small></div>
          <button type="button" class="btn sec sm" id="hs-again" onclick="location.reload()">↻ Spustit znovu</button>
        </div>
        </div>
        <div class="how-foot"><span>🕐 <b id="how-clock">06:00</b> · prádlomat běží 24/7</span><span>📡 vše vidíte v telefonu</span><span>🔧 servis = Best Series</span></div>
        <script>(function(){var how=document.querySelector('.cp .how'),st=document.querySelector('.cp .how-stage');if(!how||!st)return;
function fit(){if(window.innerWidth>700){st.style.transform='';st.style.marginLeft='';st.style.marginBottom='';st.style.width='';return;}
st.style.width='440px';st.style.transform='none';st.style.marginLeft='0';st.style.marginBottom='0';
var r=st.getBoundingClientRect(),minL=r.left,maxR=r.right;st.querySelectorAll('.how-clock,.how-acc,.how-cas').forEach(function(el){var b=el.getBoundingClientRect();if(b.width>0){minL=Math.min(minL,b.left);maxR=Math.max(maxR,b.right);}});
var full=Math.max(440,maxR-minL),left=r.left-minL,nat=st.offsetHeight||560;
var cs=getComputedStyle(how);var w=how.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0)-4;var s=Math.min(1,w/full);
st.style.transformOrigin='top left';st.style.transform='scale('+s+')';st.style.marginLeft=Math.max(0,(w-full*s)/2+left*s)+'px';st.style.marginBottom=(-nat*(1-s))+'px';
// korekce podle skutečné polohy po zmenšení: obsah zarovnat na střed rámečku, nikdy nepřetéct vpravo
var hr=how.getBoundingClientRect(),cl=hr.left+(parseFloat(cs.paddingLeft)||0),cr=hr.right-(parseFloat(cs.paddingRight)||0);
for(var k=0;k<2;k++){var r2=st.getBoundingClientRect(),a=r2.left,b=r2.right;st.querySelectorAll('.how-clock,.how-acc,.how-cas').forEach(function(el){var q=el.getBoundingClientRect();if(q.width>0){a=Math.min(a,q.left);b=Math.max(b,q.right);}});
var cw=b-a,avail=cr-cl;if(cw>avail+1){s=s*avail/cw;st.style.transform='scale('+s+')';st.style.marginBottom=(-nat*(1-s))+'px';continue;}
var shift=(cl+(avail-cw)/2)-a;st.style.marginLeft=(parseFloat(st.style.marginLeft)+shift)+'px';}}
fit();addEventListener('resize',fit);addEventListener('orientationchange',function(){setTimeout(fit,250);});setTimeout(fit,300);setTimeout(fit,1200);})();</script>
      </div>
      <script>(function(){
        var $=function(id){return document.getElementById(id);};
        var cust=$('how-cust'),bag=$('how-bag'),w=$('how-w'),sd=$('how-s'),tag=$('how-tag'),sum=$('how-sum'),n=$('how-n'),clk=$('how-clock'),coins=$('how-coins');
        if(!cust)return;
        // pozice v % plochy obrázku: pračka 18 kg a sušička (bubny na fotce), vchod vlevo
        function put(el,p,extra){ el.style.left=p.x+'%'; el.style.top=p.y+'%'; if(extra) el.style.transform=extra; }
        var W={x:40,y:52},S={x:60,y:49},IN={x:-14,y:58},OUT={x:-14,y:58};
        put(w,W); put(sd,S);
        function say(t,p){ tag.textContent=t; tag.style.opacity=t?1:0; if(p){ tag.style.left=p.x+'%'; tag.style.top=(p.y-16)+'%'; } }
        var SPEED=70; // ms na jednu simulovanou minutu → 24 h ≈ 100 s
        var total=0,cnt=0,min=6*60,T0=performance.now()-6*60*SPEED,PR=[[400,'praní s aviváží 350 Kč',1],[400,'praní 300 Kč',2],[500,'praní s aviváží 350 Kč',3]];
        function fmt(m){ var h=Math.floor(m/60)%24,mm=m%60; return (h<10?'0':'')+h+':'+(mm<10?'0':'')+mm; }
        var hcH=document.getElementById('hc-h'),hcM=document.getElementById('hc-m'),hcT=document.getElementById('hc-t'),hcD=document.getElementById('hc-d'),hcDay=document.getElementById('hc-day'),dayNo=1,lastM=0,dayTotal=0;
        var stopped=false;
        var fmtK=function(x){ return Math.round(x).toLocaleString('cs-CZ')+' Kč'; };
        function monthCalc(){ var day=total, m=day*30.5, mn=m/1.21, serv=m*0.13, en=mn*0.095, env=en*1.15, res=mn-5000-serv-en;
          document.getElementById('hs-m').textContent=fmtK(m); document.getElementById('hs-mn').textContent=fmtK(mn);
          document.getElementById('hs-cost').textContent='− '+fmtK(5000+serv+en); document.getElementById('hs-serv').textContent=fmtK(serv); document.getElementById('hs-en').textContent=fmtK(en); document.getElementById('hs-env').textContent=fmtK(env); var rb=document.getElementById('hs-res'), resV=res*1.21; rb.textContent=(resV<0?'− ':'')+fmtK(Math.abs(resV)); document.getElementById('hs-resn').textContent=(res<0?'− ':'')+fmtK(Math.abs(res)); rb.parentNode.classList.toggle('neg',res<0); }
        monthCalc(); // výchozí stav (záporné = červeně)
        function finishDay(){ if(stopped) return; stopped=true; hcT.textContent='24:00'; hcD.textContent='konec dne'; clk.textContent='24:00'; hcDay.setAttribute('stroke-dashoffset','0'); say(''); monthCalc(); document.getElementById('hs-again').classList.add('in'); }
        function face(m){ if(stopped) return; if(m>=1440){ finishDay(); return; } var mm=m%1440, mi=Math.floor(mm); lastM=mm;
          hcH.setAttribute('transform','rotate('+((mm/60)%12)*30+' 50 50)'); hcM.setAttribute('transform','rotate('+(mm%60)*6+' 50 50)'); hcT.textContent=fmt(mi); hcDay.setAttribute('stroke-dashoffset',String(289-289*(mm/1440))); clk.textContent=fmt(mi); }
        function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
        function simWait(minutes){ return wait(minutes*SPEED); }
        (function clockLoop(){ if(stopped) return; var f=(performance.now()-T0)/SPEED; min=Math.floor(f); face(f); requestAnimationFrame(clockLoop); })();
        async function customer(){
          if(stopped){ cust.style.opacity=0; bag.style.opacity=0; return; }
          var pr=PR[cnt%PR.length]; cnt++; var WW=W, ring=w, cycles=pr[2];
          await simWait(3+Math.random()*8);
          cust.classList.remove('flip'); cust.style.transition='none'; bag.style.transition='none'; put(cust,IN); put(bag,{x:IN.x+8,y:IN.y+10}); cust.style.opacity=1; bag.style.opacity=1; await wait(50);
          cust.style.transition='left 2.2s linear, top 2.2s linear, opacity .4s'; bag.style.transition='left 2.2s linear, top 2.2s linear, opacity .4s, transform .6s';
          put(cust,{x:WW.x-15,y:58}); put(bag,{x:WW.x-5,y:72}); say('přichází s prádlem',{x:20,y:70}); await simWait(5);
          say('platí: '+pr[1]+' + sušení '+cycles+'×50 Kč',{x:WW.x-6,y:WW.y-14}); await simWait(3);
          bag.style.transition='left .7s ease-in, top .7s ease-in, transform .7s, opacity .4s'; put(bag,{x:WW.x,y:WW.y},'translate(-50%,-50%) scale(.4)'); await wait(700); bag.style.opacity=0;
          ring.classList.add('on'); say('pere… 40 min',{x:WW.x,y:WW.y-16}); await simWait(40); ring.classList.remove('on');
          var END=WW;
          bag.style.transition='none'; put(bag,{x:WW.x,y:WW.y},'translate(-50%,-50%) scale(.4)'); bag.style.opacity=1; await wait(30);
          bag.style.transition='left .9s ease-in-out, top .9s ease-in-out, transform .9s'; put(bag,{x:S.x,y:S.y},'translate(-50%,-50%) scale(.4)'); say('do sušičky',{x:(WW.x+S.x)/2,y:S.y-16}); await wait(950);
          for(var cy=1;cy<=cycles;cy++){ sd.classList.add('on'); say('suší… '+cy+'/'+cycles+' · 15 min',{x:S.x,y:S.y-16}); await simWait(15); sd.classList.remove('on'); if(cy<cycles) await simWait(1); }
          END=S;
          // platba se připíše
          var c=document.createElement('em'); c.className='coin'; c.textContent='+'+pr[0]+' Kč'; c.style.left=END.x+'%'; c.style.top=END.y+'%'; coins.appendChild(c); setTimeout(function(){ c.remove(); },1800);
          if(stopped){ cust.style.opacity=0; bag.style.opacity=0; return; }
          total+=pr[0]; var shown=parseInt(sum.textContent.replace(/\\s/g,''),10)||0, st=Date.now(); (function tw(){ var k=Math.min(1,(Date.now()-st)/700); sum.textContent=Math.round(shown+(total-shown)*k).toLocaleString('cs-CZ'); if(k<1) requestAnimationFrame(tw); })();
          n.textContent=cnt+' zákazník'+(cnt===1?'':cnt<5?'ci':'ů'); monthCalc();
          // odchází s čistým prádlem
          bag.style.transition='left .6s ease-out, top .6s ease-out, transform .6s'; put(bag,{x:END.x+8,y:72},'translate(-50%,-50%) scale(1)'); cust.style.transition='left .6s, top .6s'; put(cust,{x:END.x,y:58}); say('hotovo ✓',{x:END.x,y:END.y-14}); await wait(700);
          cust.style.transition='left 2s linear, top 2s linear, opacity .5s'; bag.style.transition='left 2s linear, top 2s linear, opacity .5s'; cust.classList.add('flip'); put(cust,OUT); put(bag,{x:OUT.x-8,y:OUT.y+10}); await wait(1600); cust.style.opacity=0; bag.style.opacity=0; say('');
          await simWait(10+Math.random()*25); if(!stopped) customer();
        }
        customer();
      })();</script>` : ''}
      ${ph.visual === 'loop' ? `<div class="loopwrap"><div class="loop">
        <svg viewBox="0 0 420 420" class="loop-svg" aria-hidden="true">
          <defs><linearGradient id="lpG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fd1ff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient>
          <marker id="lpA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#4fd1ff"/></marker></defs>
          <circle cx="210" cy="210" r="150" fill="none" stroke="rgba(79,209,255,.12)" stroke-width="26"/>
          <circle cx="210" cy="210" r="150" fill="none" stroke="url(#lpG)" stroke-width="3" stroke-dasharray="10 12" class="loop-dash"/>
          <path d="M210 60 A150 150 0 0 1 360 210" fill="none" stroke="url(#lpG)" stroke-width="3" marker-end="url(#lpA)" class="loop-arc"/>
          <path d="M360 210 A150 150 0 0 1 210 360" fill="none" stroke="url(#lpG)" stroke-width="3" marker-end="url(#lpA)" class="loop-arc"/>
          <path d="M210 360 A150 150 0 0 1 60 210" fill="none" stroke="url(#lpG)" stroke-width="3" marker-end="url(#lpA)" class="loop-arc"/>
          <path d="M60 210 A150 150 0 0 1 210 60" fill="none" stroke="url(#lpG)" stroke-width="3" marker-end="url(#lpA)" class="loop-arc"/>
          <circle id="loop-dot" cx="210" cy="60" r="5" fill="#4fd1ff" style="filter:drop-shadow(0 0 6px #4fd1ff)"/>
          <text x="210" y="200" text-anchor="middle" fill="#8ea2c2" font-size="12" font-weight="700" letter-spacing="2">SMYČKA</text>
          <text x="210" y="232" text-anchor="middle" fill="#fff" font-size="26" font-weight="900">∞</text>
        </svg>
        <div class="ln n1"><i>2</i><b>Pilot ověřuje místo</b><span>náběhová křivka</span></div>
        <div class="ln n2"><i>3</i><b>Místo verifikováno</b><span>čísla sedí</span></div>
        <div class="ln n3"><i>4</i><b>Dodáme zafinancovaný stroj</b><span>100 %</span></div>
        <div class="ln n4"><i>1</i><b>Pilot na nové místo</b><span>start každého kola</span></div>
        <div id="lp-mini" class="lp-img lp-pilot"><i class="lp-ring"></i><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI"><span class="lp-tag">PILOT · stále ten samý MINI</span></div>
        <img id="lp-flex" class="lp-img" src="/img/pradlomat.webp?v=2" alt="Zafinancovaný stroj">
        <div id="lp-stamp" class="lp-stamp">VERIFIKOVÁNO</div>
        <div class="lp-income"><span class="k">Měsíční příjem</span><b><span id="lp-inc">0</span> Kč</b><span class="s">25 000 Kč × <span id="lp-inc-n">0</span> strojů · odhad</span></div>
      </div>
      <div class="loop-fleet"><div class="lf-h"><span>Vaše flotila</span><b id="lf-n">0</b></div><div class="lf-row" id="lf-row"></div></div>
      <script>(function(){
var loop=document.querySelector('.cp .loop'),dot=document.getElementById('loop-dot'),mini=document.getElementById('lp-mini'),flex=document.getElementById('lp-flex'),stamp=document.getElementById('lp-stamp'),row=document.getElementById('lf-row'),n=document.getElementById('lf-n');
if(!loop||!dot||!mini||!flex||!row)return;
var A=4000,B=2600,C=2200,D=2400,T=A+B+C+D,start=performance.now(),count=0,dropped=false;
var incEl=document.getElementById('lp-inc'),incN=document.getElementById('lp-inc-n'),incBox=document.querySelector('.lp-income'),incShown=0,incTarget=0;
function incTick(){if(incShown<incTarget){incShown=Math.min(incTarget,incShown+Math.max(500,(incTarget-incShown)*0.12));incEl.textContent=Math.round(incShown).toLocaleString('cs-CZ');requestAnimationFrame(incTick);}}
function pos(deg){var a=deg*Math.PI/180;return {x:210+150*Math.sin(a),y:210-150*Math.cos(a)};}
function place(el,p,scale,op,dy){el.style.left=(p.x/420*100)+'%';el.style.top=((p.y+(dy||0))/420*100)+'%';el.style.transform='translate(-50%,-50%) scale('+(scale||1)+')';el.style.opacity=op==null?1:op;}
function hide(el){el.style.opacity=0;}
var ease=function(x){return x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;};
function tick(now){
  var t=(now-start)%T;
  if(t<A){ // bod 4 → 1 → 2: tečka + MINI jedou spolu
    var ang=270+180*ease(t/A),p=pos(ang);dot.setAttribute('cx',p.x.toFixed(1));dot.setAttribute('cy',p.y.toFixed(1));place(mini,p,1,1);hide(flex);stamp.style.opacity=0;stamp.style.transform='translate(-50%,-50%) rotate(-14deg) scale(2)';dropped=false;
  }else if(t<A+B){ // bod 2: MINI vyroste, razítko, výměna za FLEX
    var q=(t-A)/B,p=pos(90);dot.setAttribute('cx',p.x.toFixed(1));dot.setAttribute('cy',p.y.toFixed(1));
    var grow=Math.min(1,q/.3),sw=q<.6?0:(q-.6)/.4;
    place(mini,p,1+.5*grow-.5*sw,1);place(flex,p,1,sw);
    stamp.style.left=(p.x/420*100)+'%';stamp.style.top=(p.y/420*100)+'%';
    var st=q<.25?0:Math.min(1,(q-.25)/.15);stamp.style.opacity=q<.85?st:Math.max(0,1-(q-.85)/.15);stamp.style.transform='translate(-50%,-50%) rotate(-14deg) scale('+(2-st)+')';
  }else{ // bod 2 → 3 → 4: FLEX po kružnici do bodu 3 a propadne do flotily; MINI zároveň jede z bodu 2 středem kruhu do bodu 4 — dorazí ve stejný okamžik jako tečka
    var u=(t-A-B)/(C+D),p2=pos(90),p4=pos(270),mq=ease(u);place(mini,{x:p2.x+(p4.x-p2.x)*mq,y:p2.y+(p4.y-p2.y)*mq},1,1);stamp.style.opacity=0;
    if(t<A+B+C){ var q=ease((t-A-B)/C),ang=90+90*q,p=pos(ang);dot.setAttribute('cx',p.x.toFixed(1));dot.setAttribute('cy',p.y.toFixed(1));place(flex,p,1,1); }
    else{ var q=(t-A-B-C)/D,ang=180+90*ease(q),p=pos(ang);dot.setAttribute('cx',p.x.toFixed(1));dot.setAttribute('cy',p.y.toFixed(1));
      var p3=pos(180),dq=Math.min(1,q/.6);place(flex,p3,1-.4*dq,1-dq,dq*dq*140);
      if(!dropped&&q>=.45){dropped=true;count++;var im=document.createElement('img');im.src='/img/pradlomat.webp?v=2';im.alt='';im.className='lf-m';row.appendChild(im);n.textContent=count;var w=count<=10?80:count<=20?56:count<=40?40:count<=80?30:22;row.style.setProperty('--lfw',w+'px');incTarget=count*25000;incN.textContent=count;incBox.classList.remove('bump');void incBox.offsetWidth;incBox.classList.add('bump');incTick();} }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
})();</script>
      <div class="rep"><div class="rep-q">Kolik opakování uděláte?</div><div class="rep-sub">Každé kolo smyčky = <b>+1 prádlomat</b>, který je po splacení Váš.</div>
        <input type="range" id="rep-r" min="1" max="100" value="10" oninput="var n=+this.value;document.getElementById('rep-n').textContent=n;document.getElementById('rep-k').textContent=(n+1);document.getElementById('rep-m').textContent=((n+1)*25000).toLocaleString('cs-CZ');document.getElementById('rep-dots').innerHTML=Array.from({length:Math.min(n+1,60)},function(){return '<i></i>'}).join('')+((n+1)>60?'<em>+'+((n+1)-60)+'</em>':'')">
        <div class="rep-out"><div><span class="dec-k">opakování</span><b><span id="rep-n">10</span>×</b></div><div><span class="dec-k">prádlomatů celkem</span><b><span id="rep-k">11</span></b><span class="dec-s">Pilot + 1 za každé kolo</span></div><div class="rep-money"><span class="dec-k">měsíčně pro Vás</span><b><span id="rep-m">275 000</span> Kč</b><span class="dec-s">odhad · 25 000 Kč / stroj</span></div></div>
        <div class="rep-dots" id="rep-dots">${Array.from({ length: 11 }, () => '<i></i>').join('')}</div>
      </div></div>` : ''}
      ${ph.visual === 'scale' ? `<div class="scale"><div class="sc-col ok"><div class="sc-h"><i></i>Místo verifikováno</div><div class="sc-m"><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI" loading="lazy" decoding="async"><span class="pl-tag">Pilot</span></div><div class="sc-plus">+</div><div class="sc-m new"><img src="/img/pradlomat.webp?v=2" alt="Další stroj" loading="lazy" decoding="async"><span class="pl-tag z">100 % zafinancovaný</span></div><div class="sc-t">stroj splácí sám sebe — a ještě něco zbývá</div></div>
        <div class="sc-col wait"><div class="sc-h"><i></i>Místo neverifikováno</div><div class="sc-m dim"><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI" loading="lazy" decoding="async"><span class="pl-tag g">Pilot</span></div><div class="sc-arrow">⟶</div><div class="sc-t">počkat · nebo přemístit na nové místo a verifikovat znovu</div></div></div>` : ''}
      ${ph.points.length ? `<div class="ph-grid">${ph.points.map(pt => `<div class="c"><div class="i">${ico(pt[0], 20)}</div><b>${esc(pt[1])}</b><p>${pt[2]}</p></div>`).join('')}</div>` : ''}
      ${ph.timeline ? `<div class="ph-tl">${ph.timeline.map((t, i) => `<div class="s"><i>${i + 1}</i><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join('')}</div>` : ''}
      ${ph.note ? `<p class="ph-note">${ph.note}</p>` : ''}
      ${ph.decision ? `<div class="dec"><div class="dec-q">Kolik prádlomatů vlastně chci?</div><div class="dec-opts">${[3, 5, 10, 100].map((n, i) => `<button type="button" class="dec-o${i === 1 ? ' on' : ''}" data-n="${n}" onclick="for(const b of this.parentNode.children)b.classList.remove('on');this.classList.add('on');document.getElementById('dec-n').textContent=this.dataset.n;document.getElementById('dec-m').textContent=(this.dataset.n*25000).toLocaleString('cs-CZ')">${n}</button>`).join('')}</div>
        <div class="dec-out"><div><span class="dec-k">za 5 let</span><b><span id="dec-n">5</span> prádlomatů</b><span class="dec-s">splacených · Vašich · každý měsíc vydělávají jen Vám</span></div><div class="dec-money"><span class="dec-k">měsíčně pro Vás</span><b><span id="dec-m">125 000</span> Kč</b><span class="dec-s">odhad při dodržení postupu · 25 000 Kč čistého na jeden prádlomat měsíčně</span></div></div>
        <div class="dec-ask">Otázka tedy nezní „kolik strojů", ale: <b>Kolik peněz chcete mít pravidelně měsíčně za 5 let, až se doplatí financování?</b></div></div>` : ''}
    </section>`).join('')}

  ${cta('Chcete si spočítat svůj první prádlomat?', 'Projdeme s vámi místo, financování i to, jak z prvního stroje udělat síť.')}
  </div>` });
}


module.exports = { compounderPage };
