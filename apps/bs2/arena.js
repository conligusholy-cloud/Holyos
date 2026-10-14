// BS2 — Aréna (/arena): záchytná stránka ve stylu „Milionáře". Návštěvník zadá, jak mu máme říkat,
// pak odpovídá na 5 otázek (3 možnosti, 15 s na otázku); za každou správnou odpověď +50 000 Kč
// „startovního kapitálu". Na konci CTA na Prověření lokality. Výsledky se ukládají (arena_runs).
const { esc } = require('./views');

// Otázky: uprav text / možnosti / index správné odpovědi (0–2). Vysvětlení se ukáže po odpovědi.
const QUESTIONS = [
  { q: 'Kolik lidí obsluhuje samoobslužný prádlomat FLEX během běžného dne?', a: ['Jeden zaměstnanec na směně', 'Nikdo – zákazník si pere sám, platí kartou nebo mincemi', 'Dva lidé – obsluha a údržba'], c: 1, why: 'Prádlomat je plně samoobslužný: žádné mzdy, žádná otevírací doba – pere se 24 hodin denně.' },
  { q: 'Jak dlouho trvá jeden kompletní cyklus praní a sušení v prádlomatu?', a: ['Zhruba 60–75 minut', 'Celý půlden', 'Asi 3 hodiny'], c: 0, why: 'Praní cca 30–40 minut a sušení dalších 30–40 minut – zákazník mezitím nakoupí nebo si dá kávu.' },
  { q: 'Co nejvíc rozhoduje o výdělku prádlomatu?', a: ['Barva stroje', 'Místo – kolik lidí kolem něj denně projde', 'Cena elektřiny v regionu'], c: 1, why: 'Lokalita je 80 % úspěchu. Proto si ji před investicí prověřujeme v aplikaci Prověření lokality.' },
  { q: 'Co všechno lze v prádlomatu FLEX vyprat?', a: ['Jen běžné oblečení', 'Oblečení, peřiny, deky, spacáky i boty', 'Pouze ručníky a ložní prádlo'], c: 1, why: 'Velkokapacitní buben zvládne i peřiny, deky nebo spacáky, které se do domácí pračky nevejdou.' },
  { q: 'Kdo za vás řeší servis a dohled nad prádlomatem Best Series?', a: ['Výrobce – vzdálený dohled a servisní síť', 'Nikdo, vše je na majiteli', 'Externí firma, kterou si musíte sehnat'], c: 0, why: 'Stroj hlásí stav online a servisní tým Best Series řeší údržbu i poruchy – majitel sleduje jen tržby.' },
];
const PRIZE = 50000;      // Kč za správnou odpověď
const SECONDS = 15;       // čas na otázku
const PRESENCE_MULT = 8;  // nasobek pocitadla 'prave si prohlizi' jen na teto strance

const PAGE = (shellHead, netScript, presence) => `${shellHead}
<style>
  /* ── Aréna: prémiový „Milionář" look – tmavá modř, zlato, sklo. Mobile-first. ── */
  :root{--gold:#4fd1ff;--gold2:#7c5cff;--gold3:#1e86e0} /* paleta Best Series 2.0: azurová → fialová */
  main{padding-top:14px;padding-bottom:calc(96px + env(safe-area-inset-bottom))}
  .arena-hero{text-align:center;padding:10px 0 0}
  .arena-hero .eyebrow{border-color:rgba(79,209,255,.45);color:var(--gold);background:rgba(79,209,255,.06)}
  .arena-hero .eyebrow i{background:var(--gold);box-shadow:0 0 0 0 rgba(79,209,255,.7);animation:pulseg 2s infinite}
  @keyframes pulseg{0%{box-shadow:0 0 0 0 rgba(79,209,255,.7)}70%{box-shadow:0 0 0 9px rgba(79,209,255,0)}100%{box-shadow:0 0 0 0 rgba(79,209,255,0)}}
  .arena-hero h1{font-size:clamp(34px,8.5vw,64px);line-height:1.04;margin:14px auto 10px;max-width:880px;letter-spacing:-.03em}
  .arena-hero h1 .g{background:linear-gradient(95deg,#fff 0%,var(--gold) 45%,var(--gold2) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 18px rgba(79,209,255,.25))}
  .arena-hero .lead{margin:0 auto;max-width:560px;font-size:clamp(15px,4vw,17px)}
  .arena-hero mark{background:rgba(79,209,255,.12);color:var(--accent2);border:1px solid rgba(79,209,255,.35);padding:1px 8px;border-radius:999px;white-space:nowrap}
  .machine{position:relative;display:flex;justify-content:center;margin:10px 0 4px;isolation:isolate}
  .machine::before{content:'';position:absolute;left:50%;top:50%;width:min(78vw,520px);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.22),rgba(79,209,255,.12) 45%,transparent 70%);filter:blur(10px);z-index:-1;animation:breathe 5s ease-in-out infinite}
  .machine::after{content:'';position:absolute;left:50%;top:50%;width:min(70vw,470px);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;border:1px solid rgba(79,209,255,.25);box-shadow:inset 0 0 40px rgba(79,209,255,.08);z-index:-1;animation:spin 24s linear infinite;background:conic-gradient(from 0deg,transparent 0 85%,rgba(79,209,255,.35) 92%,transparent 100%)}
  @keyframes breathe{0%,100%{opacity:.8;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.06)}}
  @keyframes spin{to{transform:translate(-50%,-50%) rotate(360deg)}}
  .machine img{width:min(72vw,400px);height:auto;animation:pmfloat 5s ease-in-out infinite;filter:drop-shadow(0 30px 50px rgba(0,0,0,.6)) drop-shadow(0 0 34px rgba(79,209,255,.22))}
  /* banka – na mobilu přilepená dole, na desktopu pod pračkou */
  .bank{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;justify-content:center;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(4,6,12,0),rgba(4,6,12,.92) 30%);pointer-events:none}
  .bank .chip{pointer-events:auto;display:inline-flex;align-items:center;gap:9px;background:linear-gradient(135deg,rgba(14,22,40,.95),rgba(8,13,26,.95));border:1px solid rgba(79,209,255,.45);border-radius:999px;padding:9px 18px;font-weight:700;font-variant-numeric:tabular-nums;box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 24px rgba(79,209,255,.15);position:relative;overflow:hidden}
  .bank .chip::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.12) 50%,transparent 70%);transform:translateX(-120%);animation:shine 3.2s ease-in-out infinite}
  @keyframes shine{0%,60%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
  .bank .chip b{font-size:21px;letter-spacing:-.01em;background:linear-gradient(90deg,#ffffff,var(--gold),var(--gold2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .bank .chip.pop b{animation:pop .7s cubic-bezier(.2,1.4,.4,1)}
  .bank .chip.who{font-weight:600;color:var(--text2)} .bank .chip.who span{color:var(--text)}
  @keyframes pop{0%{transform:scale(1)}40%{transform:scale(1.45)}100%{transform:scale(1)}}
  @media (min-width:860px){.bank{position:static;padding:8px 0 16px;background:none}}
  .fly{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);font-size:clamp(34px,9vw,64px);font-weight:900;letter-spacing:-.02em;color:var(--gold);text-shadow:0 0 30px rgba(79,209,255,.7),0 4px 0 rgba(0,0,0,.4);pointer-events:none;z-index:50;animation:fly 1.4s cubic-bezier(.2,.8,.2,1) forwards}
  @keyframes fly{0%{opacity:0;transform:translate(-50%,-20%) scale(.5)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}30%{transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-190%) scale(.85)}}
  /* kvíz */
  .quiz{max-width:720px;margin:14px auto 0;position:relative;background:linear-gradient(180deg,rgba(14,22,40,.9),rgba(8,13,26,.92));border:1px solid rgba(79,209,255,.22);border-radius:22px;padding:20px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(79,209,255,.06) inset}
  .quiz::before{content:'';position:absolute;inset:-1px;border-radius:23px;padding:1px;background:linear-gradient(135deg,rgba(79,209,255,.6),rgba(79,209,255,.35) 50%,rgba(124,92,255,.5));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
  .quiz .top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
  .quiz .step{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}
  .dots{display:flex;gap:6px;margin-top:6px} .dots i{width:22px;height:4px;border-radius:2px;background:rgba(120,160,255,.18)} .dots i.on{background:var(--gold)} .dots i.ok{background:var(--ok)} .dots i.bad{background:var(--err)}
  .timer{position:relative;width:58px;height:58px;flex:none}
  .timer svg{transform:rotate(-90deg)} .timer circle{fill:none;stroke-width:5}
  .timer .bg{stroke:rgba(120,160,255,.15)} .timer .fg{stroke:var(--gold);stroke-linecap:round;transition:stroke-dashoffset 1s linear,stroke .3s;filter:drop-shadow(0 0 6px rgba(79,209,255,.6))}
  .timer.hot .fg{stroke:var(--err);filter:drop-shadow(0 0 8px rgba(255,93,108,.7))} .timer.hot b{color:var(--err);animation:tick .5s infinite alternate}
  @keyframes tick{from{transform:scale(1)}to{transform:scale(1.18)}}
  .timer b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:17px;font-variant-numeric:tabular-nums}
  .quiz h2{font-size:clamp(19px,5.2vw,26px);margin:8px 0 16px;line-height:1.3;letter-spacing:-.01em}
  .opts{display:flex;flex-direction:column;gap:10px}
  .opt{position:relative;display:flex;align-items:center;gap:12px;text-align:left;font:inherit;font-size:16px;color:var(--text);background:linear-gradient(90deg,rgba(14,22,40,.9),rgba(8,13,26,.9));border:1px solid rgba(120,160,255,.22);border-radius:999px;padding:13px 16px 13px 12px;cursor:pointer;min-height:54px;transition:transform .15s,border-color .15s,background .15s,box-shadow .15s;-webkit-tap-highlight-color:transparent}
  .opt:hover,.opt:focus-visible{border-color:var(--gold);box-shadow:0 0 0 3px rgba(79,209,255,.12),0 8px 24px rgba(0,0,0,.4);transform:translateY(-1px);outline:none}
  .opt .k{flex:none;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;background:linear-gradient(135deg,rgba(79,209,255,.3),rgba(79,209,255,.25));border:1px solid rgba(79,209,255,.45);color:var(--gold)}
  .opt.ok{border-color:var(--ok);background:linear-gradient(90deg,rgba(47,227,160,.22),rgba(47,227,160,.08));box-shadow:0 0 0 3px rgba(47,227,160,.15),0 0 30px rgba(47,227,160,.25)} .opt.ok .k{background:var(--ok);color:#04110b;border-color:var(--ok)}
  .opt.bad{border-color:var(--err);background:linear-gradient(90deg,rgba(255,93,108,.2),rgba(255,93,108,.06))} .opt.bad .k{background:var(--err);color:#fff;border-color:var(--err)}
  .opt:disabled{cursor:default;transform:none} .opt:disabled:not(.ok):not(.bad){opacity:.45}
  .why{margin-top:14px;font-size:14.5px;color:var(--text2);border-left:3px solid var(--gold);padding:6px 12px;display:none;background:rgba(79,209,255,.05);border-radius:0 10px 10px 0}
  .why.show{display:block;animation:fadein .3s ease}
  @keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .next{margin-top:16px;display:flex;justify-content:flex-end}
  .btn.gold{background:linear-gradient(90deg,var(--accent),#3a6cf5 40%,var(--vio) 70%,var(--accent));background-size:200% 100%;color:#fff;box-shadow:0 10px 30px rgba(58,108,245,.45);animation:goldmove 4s linear infinite}
  .btn.gold:hover{box-shadow:0 14px 36px rgba(58,108,245,.6)}
  @keyframes goldmove{to{background-position:200% 0}}
  .result{text-align:center}
  .result .big{font-size:clamp(40px,11vw,72px);font-weight:900;letter-spacing:-.04em;line-height:1;background:linear-gradient(90deg,#ffffff,var(--gold),var(--gold2));-webkit-background-clip:text;background-clip:text;color:transparent;margin:10px 0 6px;filter:drop-shadow(0 0 24px rgba(79,209,255,.35))}
  .result p{color:var(--text2);max-width:520px;margin:8px auto}
  /* úvodní okno „jak vám máme říkat" – sklo, zlatý rám, na mobilu dole jako sheet */
  .ov{position:fixed;inset:0;background:rgba(4,6,12,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:40;display:flex;align-items:center;justify-content:center;padding:18px;padding-bottom:calc(18px + env(safe-area-inset-bottom))}
  .ov .box{display:flex !important;flex-direction:column;gap:0;width:min(100%,440px);background:linear-gradient(180deg,rgba(14,22,40,.96),rgba(8,13,26,.98));border:1px solid rgba(79,209,255,.4);border-radius:24px;padding:28px 24px 24px;box-shadow:0 40px 100px rgba(0,0,0,.7),0 0 60px rgba(79,209,255,.12);text-align:center;animation:rise .45s cubic-bezier(.2,.9,.3,1.2)}
  @keyframes rise{from{opacity:0;transform:translateY(24px) scale(.96)}to{opacity:1;transform:none}}
  .ov .eyebrow{align-self:center;border-color:rgba(79,209,255,.45);color:var(--gold);background:rgba(79,209,255,.06)}
  .ov h2{font-size:clamp(24px,6.5vw,30px);margin:14px 0 6px;letter-spacing:-.02em}
  .ov h2 .g{background:linear-gradient(95deg,#fff,var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent}
  .ov p{color:var(--text2);font-size:14.5px;margin:0 0 16px}
  .ov input{text-align:center;font-size:18px;padding:14px;border-color:rgba(79,209,255,.3);border-radius:14px}
  .ov input:focus{border-color:var(--gold);box-shadow:0 0 0 4px rgba(79,209,255,.14),0 0 24px rgba(79,209,255,.18)}
  .ov .btn{width:100%;margin-top:12px;min-height:52px;font-size:16px;border-radius:14px}
  .ov .tiny{font-size:11.5px;color:var(--text3);margin:12px 0 0}
  /* odpočet před startem – velké číslo uprostřed pračky */
  .cd{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:3;display:none;align-items:center;justify-content:center;width:min(42vw,200px);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(4,6,12,.92),rgba(4,6,12,.72) 60%,transparent 72%);pointer-events:none}
  .cd.on{display:flex}
  .cd b{font-size:clamp(72px,22vw,150px);font-weight:900;line-height:1;letter-spacing:-.05em;background:linear-gradient(95deg,#fff,var(--accent2) 60%,var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 28px rgba(79,209,255,.55));animation:cdpop .95s cubic-bezier(.2,1.2,.3,1) both}
  .cd small{position:absolute;bottom:8%;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--text2)}
  @keyframes cdpop{0%{opacity:0;transform:scale(1.8)}35%{opacity:1;transform:scale(.95)}100%{opacity:1;transform:scale(1)}}
  .machine.dim img{filter:drop-shadow(0 30px 50px rgba(0,0,0,.6)) brightness(.55) blur(1px);transition:filter .3s}
  /* ── Aukce o kupony ── */
  .auc{max-width:720px;margin:14px auto 0;position:relative;background:linear-gradient(180deg,rgba(14,22,40,.9),rgba(8,13,26,.92));border:1px solid rgba(124,92,255,.35);border-radius:22px;padding:20px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 30px 80px rgba(0,0,0,.55)}
  .auc::before{content:'';position:absolute;inset:-1px;border-radius:23px;padding:1px;background:linear-gradient(135deg,rgba(124,92,255,.7),rgba(79,209,255,.35) 50%,rgba(30,134,224,.6));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
  .auc h2{text-align:center;margin:10px 0 4px}
  .auc .sub{text-align:center;color:var(--text2);font-size:14.5px;margin-bottom:14px}
  .prizes{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 0 14px}
  .prize{display:inline-flex;flex-direction:column;align-items:center;min-width:96px;padding:10px 14px;border-radius:14px;background:var(--card2);border:1px solid var(--border)}
  .prize b{font-size:24px;letter-spacing:-.02em;background:linear-gradient(90deg,#fff,var(--accent2) 60%,var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent}
  .prize span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text2)}
  .prize.p1{border-color:rgba(79,209,255,.6);box-shadow:0 0 24px rgba(79,209,255,.15)}
  .auc .cdbar{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--card2);border:1px solid var(--border);border-radius:14px;padding:10px 14px;margin-bottom:12px}
  .auc .cdbar b{font-size:22px;font-variant-numeric:tabular-nums;color:var(--accent2)}
  .auc .cdbar .bar{flex:1;height:6px;border-radius:3px;background:rgba(120,160,255,.15);overflow:hidden}
  .auc .cdbar .bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--vio));transition:width 1s linear}
  .lobby{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto;padding-right:2px}
  .lp{display:flex;align-items:center;gap:10px;background:rgba(4,8,16,.6);border:1px solid var(--border);border-radius:12px;padding:8px 12px;font-size:14px;animation:fadein .35s ease}
  .lp .av{width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;background:linear-gradient(135deg,rgba(30,134,224,.45),rgba(124,92,255,.45));border:1px solid var(--border2)}
  .lp .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lp .st{font-variant-numeric:tabular-nums;color:var(--text2);font-size:13px}
  .lp.me{border-color:var(--accent2);background:rgba(79,209,255,.08)} .lp.me .nm{font-weight:700}
  .lp .live{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
  .podium{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:end;margin:8px 0 14px}
  .pd{text-align:center;border-radius:16px;padding:14px 8px;background:var(--card2);border:1px solid var(--border);animation:rise .6s cubic-bezier(.2,.9,.3,1.2) both}
  .pd .pl{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--text2)} .pd .pc{font-size:30px;font-weight:900;letter-spacing:-.03em;margin:4px 0} .pd .nm{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pd.p1{order:2;border-color:rgba(79,209,255,.7);box-shadow:0 0 30px rgba(79,209,255,.2);padding-top:22px;animation-delay:.5s} .pd.p1 .pc{background:linear-gradient(90deg,#fff,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent}
  .pd.p2{order:1;animation-delay:.3s} .pd.p3{order:3;animation-delay:.1s}
  .pd.me{outline:2px solid var(--ok);outline-offset:2px}
  .coupon{margin-top:8px;border:1px dashed rgba(79,209,255,.6);border-radius:16px;padding:16px;text-align:center;background:rgba(79,209,255,.06)}
  .coupon .pc{font-size:clamp(34px,9vw,54px);font-weight:900;letter-spacing:-.03em;line-height:1;background:linear-gradient(90deg,#fff,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent}
  .coupon .code{display:inline-block;margin:8px 0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:18px;letter-spacing:.12em;padding:6px 12px;border-radius:10px;background:rgba(4,8,16,.8);border:1px solid var(--border2)}
  .coupon form{display:flex;flex-direction:column;gap:8px;margin-top:10px;background:none;border:0;padding:0;box-shadow:none}
  .coupon form .row{display:flex;gap:8px;flex-wrap:wrap} .coupon form .row input{flex:1;min-width:160px}
  .coupon .ok{color:var(--ok);font-weight:700}
  @media (max-width:600px){.auc{padding:16px 14px}.podium{gap:6px}.pd .pc{font-size:24px}.pd .nm{font-size:12.5px}}
  /* ── Bonusové karty ── */
  .cards-t{margin:16px 0 8px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent2);text-align:center}
  .cards{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;max-width:560px;margin:0 auto;perspective:900px}
  .cardb{position:relative;aspect-ratio:2/3;cursor:pointer;transform-style:preserve-3d;transition:transform .7s cubic-bezier(.2,.8,.2,1);-webkit-tap-highlight-color:transparent}
  .cardb .f,.cardb .b{position:absolute;inset:0;border-radius:12px;backface-visibility:hidden;-webkit-backface-visibility:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid var(--border2)}
  .cardb .b{background:linear-gradient(160deg,#1a2b55,#0b1430 60%,#121d36);box-shadow:0 10px 30px rgba(0,0,0,.5),inset 0 0 0 1px rgba(79,209,255,.15)}
  .cardb .b::before{content:'B';font-size:clamp(22px,6vw,34px);font-weight:900;background:linear-gradient(90deg,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent;opacity:.9}
  .cardb .b::after{content:'';position:absolute;inset:6px;border-radius:9px;border:1px dashed rgba(79,209,255,.35)}
  .cardb .f{transform:rotateY(180deg);background:linear-gradient(160deg,rgba(14,22,40,.98),rgba(8,13,26,.98));font-weight:900;font-size:clamp(14px,4vw,22px);letter-spacing:-.02em;text-align:center;padding:4px}
  .cardb .f small{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text2);font-weight:600;margin-top:4px}
  .cardb .f.up{color:var(--ok);border-color:rgba(47,227,160,.6)} .cardb .f.down{color:var(--err);border-color:rgba(255,93,108,.6)}
  .cardb.open{transform:rotateY(180deg)} .cardb.pick{transform:rotateY(180deg) scale(1.08);z-index:2}
  .cardb.pick .f{box-shadow:0 0 0 3px rgba(79,209,255,.35),0 0 40px rgba(79,209,255,.35)}
  .cardb:not(.open):hover{transform:translateY(-6px) rotateZ(-2deg)}
  .cards.lock .cardb{cursor:default}
  .cards.lock .cardb:not(.open):hover{transform:none}
  .cardb.idle{animation:cardidle 2.4s ease-in-out infinite} .cardb:nth-child(2).idle{animation-delay:.3s} .cardb:nth-child(3).idle{animation-delay:.6s} .cardb:nth-child(4).idle{animation-delay:.9s} .cardb:nth-child(5).idle{animation-delay:1.2s}
  @keyframes cardidle{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  .cards-msg{text-align:center;margin-top:12px;font-size:15px;min-height:22px}
  .cards-msg b{font-size:clamp(22px,6vw,32px);font-weight:900;letter-spacing:-.02em}
  .cards-msg b.up{color:var(--ok)} .cards-msg b.down{color:var(--err)}
  .hidden{display:none !important}
  @media (max-width:600px){.quiz{padding:16px 14px;border-radius:18px}.opt{font-size:15px}.ov{align-items:flex-end;padding:0}.ov .box{width:100%;border-radius:24px 24px 0 0;border-bottom:0;padding-bottom:calc(22px + env(safe-area-inset-bottom))}}
</style>
</head>
<body><canvas id="net" aria-hidden="true"></canvas><div class="glow a"></div><div class="glow b"></div><div class="gridfx" aria-hidden="true"></div>
${presence}
<main>
  <section class="arena-hero">
    <span class="eyebrow"><i></i>Aréna Best Series · 5 otázek · 15 vteřin na každou</span>
    <h1>Vydělejte si <span class="g">startovní kapitál</span> na vlastní prádlomat</h1>
    <p class="lead">Za každou správnou odpověď získáte <mark>+${PRIZE.toLocaleString('cs-CZ')} Kč</mark> virtuálního kapitálu. Zvládnete všech pět?</p>
    <div class="machine" id="machine"><img src="/img/pradlomat.webp?v=2" alt="Prádlomat FLEX" width="460" height="350" loading="eager" decoding="async"><div class="cd" id="cd"><b id="cdn">5</b><small>start za</small></div></div>
    <div class="bank"><span class="chip who" id="who" style="display:none">🙋 <span id="whon"></span></span><span class="chip" id="bank">💰 <b id="bankv">0 Kč</b></span></div>
  </section>

  <section class="quiz hidden" id="quiz">
    <div class="top"><div><span class="step" id="step">Otázka 1 z ${QUESTIONS.length}</span><div class="dots" id="dots">${QUESTIONS.map(() => "<i></i>").join("")}</div></div><div class="timer" id="timer"><svg width="54" height="54" viewBox="0 0 54 54"><circle class="bg" cx="27" cy="27" r="23"/><circle class="fg" id="tfg" cx="27" cy="27" r="23"/></svg><b id="tsec">${SECONDS}</b></div></div>
    <h2 id="qtext"></h2>
    <div class="opts" id="opts"></div>
    <div class="why" id="why"></div>
    <div class="next"><button class="btn gold hidden" id="next">Další otázka</button></div>
  </section>

  <section class="quiz result hidden" id="result">
    <span class="eyebrow"><i></i>Hotovo</span>
    <div class="big" id="rbig"></div>
    <h2 id="rtitle"></h2>
    <p id="rtext"></p>
    <div id="bonus">
      <div class="cards-t">Bonusová karta · vyberte jednu z pěti</div>
      <div class="cards" id="cards"></div>
      <div class="cards-msg" id="cmsg">Karta může kapitál zvýšit i snížit. Je to o náhodě.</div>
    </div>
    <div class="cta-row hidden" id="rcta-row" style="justify-content:center">
      <button class="btn gold" id="toAuc" style="width:min(100%,360px);min-height:52px;font-size:16px">Za slevovým kuponem</button>
    </div>
    <p class="small" style="margin-top:14px;color:var(--text3)">Kapitál je virtuální – ale prádlomat je skutečný.</p>
  </section>
  <section class="auc hidden" id="auc">
    <span class="eyebrow" style="display:flex;width:max-content;margin:0 auto"><i></i>Živá aukce · nové kolo každých 30 s</span>
    <h2>Hrajeme o slevové kupony na první prádlomat</h2>
    <p class="sub">Do kola se připojí každý, kdo je právě online. Tři nejlepší sázky vyhrávají kupon – a každý účastník si odnáší aspoň 10 %.</p>
    <div class="prizes"><div class="prize p1"><b>30 %</b><span>1. místo</span></div><div class="prize"><b>20 %</b><span>2. místo</span></div><div class="prize"><b>10 %</b><span>3. místo</span></div></div>
    <div id="aucOpen">
      <div class="cdbar"><span>Kolo začíná za</span><div class="bar"><i id="aucBar" style="width:100%"></i></div><b id="aucCd">30</b></div>
      <div class="lobby" id="lobby"></div>
      <p class="small" style="margin-top:10px;color:var(--text3);text-align:center" id="aucNote">Vaše sázka: celý startovní kapitál z kvízu.</p>
    </div>
    <div id="aucRes" class="hidden">
      <div class="podium" id="podium"></div>
      <div class="coupon" id="coupon"></div>
      <div class="cta-row" style="justify-content:center;margin-top:14px"><button class="btn sec" id="aucAgain">Další kolo</button></div>
    </div>
  </section>
</main>

<div class="ov" id="ov">
  <form class="box" id="nameForm">
    <span class="eyebrow"><i></i>Než začneme</span>
    <h2>Jak vám máme <span class="g">říkat?</span></h2>
    <p>Stačí křestní jméno nebo přezdívka.</p>
    <input type="text" id="nm" maxlength="40" placeholder="např. Tomáš" autocomplete="given-name" enterkeyhint="go" required>
    <button class="btn gold" type="submit">Říkejte mi takto</button>
  </form>
</div>

<script>
${netScript}
(function(){
  var Q = ${JSON.stringify(QUESTIONS)}, PRIZE = ${PRIZE}, SEC = ${SECONDS};
  var SID = (function(){ try { var k='misto_sid', v=sessionStorage.getItem(k); if(!v){ v=Math.random().toString(36).slice(2)+Date.now().toString(36); sessionStorage.setItem(k,v);} return v; } catch(e){ return 'x'; } })();
  var name = '', i = 0, bank = 0, answers = [], tick = null, left = SEC, startedAt = 0;
  var $ = function(id){ return document.getElementById(id); };
  var CIRC = 2 * Math.PI * 23; $('tfg').style.strokeDasharray = CIRC;
  function fmt(v){ return v.toLocaleString('cs-CZ') + ' Kč'; }
  function voc(n){ return n; }
  $('nameForm').addEventListener('submit', function(e){ e.preventDefault(); name = $('nm').value.trim().slice(0,40); if(!name) return; $('ov').classList.add('hidden'); $('who').style.display=''; $('whon').textContent = name; try { $('nm').blur(); } catch(e2){} start(); });
  // Po zadání jména: 5s odpočet uprostřed pračky, teprve pak se zobrazí otázky
  function start(){ i = 0; bank = 0; answers = []; $('bankv').textContent = fmt(0); $('result').classList.add('hidden'); $('quiz').classList.add('hidden');
    var m = $('machine'), cd = $('cd'), cn = $('cdn'); m.classList.add('dim'); cd.classList.add('on'); try { m.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(e){}
    var n = 5; cn.textContent = n; var iv = setInterval(function(){ n--; if(n <= 0){ clearInterval(iv); cd.classList.remove('on'); m.classList.remove('dim'); startedAt = Date.now(); $('quiz').classList.remove('hidden'); show(); setTimeout(function(){ $('quiz').scrollIntoView({ behavior:'smooth', block:'center' }); }, 50); return; } cn.style.animation = 'none'; void cn.offsetWidth; cn.style.animation = ''; cn.textContent = n; }, 1000); }
  function setTimer(s){ $('tsec').textContent = s; $('tfg').style.strokeDashoffset = CIRC * (1 - s / SEC); $('timer').classList.toggle('hot', s <= 5); }
  function show(){ var q = Q[i]; $('step').textContent = 'Otázka ' + (i+1) + ' z ' + Q.length; Array.prototype.forEach.call($('dots').children, function(d, k){ d.className = k < i ? (answers[k] && answers[k].ok ? 'ok' : 'bad') : (k === i ? 'on' : ''); }); $('qtext').textContent = q.q; $('why').className = 'why'; $('next').classList.add('hidden');
    $('opts').innerHTML = q.a.map(function(t, k){ return '<button class="opt" data-k="' + k + '"><span class="k">' + 'ABC'[k] + '</span><span>' + esc(t) + '</span></button>'; }).join('');
    Array.prototype.forEach.call($('opts').querySelectorAll('.opt'), function(b){ b.addEventListener('click', function(){ answer(+b.getAttribute('data-k')); }); });
    left = SEC; setTimer(left); clearInterval(tick); tick = setInterval(function(){ left--; setTimer(Math.max(0,left)); if(left <= 0){ clearInterval(tick); answer(-1); } }, 1000); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function answer(k){ clearInterval(tick); var q = Q[i]; var ok = k === q.c; answers.push({ q: i, a: k, ok: ok, t: SEC - left });
    Array.prototype.forEach.call($('opts').querySelectorAll('.opt'), function(b){ b.disabled = true; var kk = +b.getAttribute('data-k'); if(kk === q.c) b.classList.add('ok'); else if(kk === k) b.classList.add('bad'); });
    if(ok){ bank += PRIZE; $('bankv').textContent = fmt(bank); $('bank').classList.remove('pop'); void $('bank').offsetWidth; $('bank').classList.add('pop'); var f = document.createElement('div'); f.className = 'fly'; f.textContent = '+' + fmt(PRIZE); document.body.appendChild(f); setTimeout(function(){ f.remove(); }, 1400); }
    $('why').textContent = (ok ? '✓ Správně! ' : (k < 0 ? '⏱ Čas vypršel. ' : '✗ Tentokrát ne. ')) + q.why; $('why').className = 'why show';
    $('next').textContent = i + 1 < Q.length ? 'Další otázka' : 'Vyhodnotit'; $('next').classList.remove('hidden'); }
  $('next').addEventListener('click', function(){ i++; if(i < Q.length) show(); else finish(); });
  function finish(){ $('quiz').classList.add('hidden'); var r = $('result'); r.classList.remove('hidden'); var okN = answers.filter(function(a){ return a.ok; }).length;
    $('rbig').textContent = fmt(bank); $('rtitle').textContent = name + ', ' + (okN === Q.length ? 'bez chyby – to je výkon!' : okN >= 3 ? 'solidní základ.' : 'začátek je za vámi.');
    $('rtext').textContent = 'Správně ' + okN + ' z ' + Q.length + '. ' + (okN === Q.length ? 'Teď ještě bonusová karta.' : 'Bonusová karta může ještě leccos změnit.');
    bonusShow(); r.scrollIntoView({ behavior:'smooth', block:'center' });
    try { fetch('/api/arena/result', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ sid: SID, name: name, score: okN, bank: bank, answers: answers, ms: Date.now() - startedAt }) }); } catch(e){} }
  // ── Aukce o kupony: lobby s odpočtem (server kolo 30 s), pódium, kupon + kontakt ──
  var AUC = { round: null, poll: null, tick: null, claimed: {} };
  function aucStart(){ $('result').classList.add('hidden'); var a = $('auc'); a.classList.remove('hidden'); $('aucRes').classList.add('hidden'); $('aucOpen').classList.remove('hidden'); $('lobby').innerHTML = '';
    fetch('/api/arena/join', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ sid: SID, name: name, bank: bank }) }).then(function(r){ return r.json(); }).then(function(st){ if(!st || st.error){ $('aucNote').textContent = (st && st.error) || 'Aukce není dostupná.'; return; } AUC.round = st.round; aucRender(st); aucLoop(); }).catch(function(){ $('aucNote').textContent = 'Aukce není dostupná.'; });
    setTimeout(function(){ a.scrollIntoView({ behavior:'smooth', block:'start' }); }, 60); }
  function aucLoop(){ clearInterval(AUC.poll); AUC.poll = setInterval(function(){ if(AUC.round == null) return; fetch('/api/arena/round?sid=' + encodeURIComponent(SID) + '&round=' + AUC.round, { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(st){ aucRender(st); if(st.phase === 'result'){ clearInterval(AUC.poll); aucResult(st); } }).catch(function(){}); }, 1500); }
  function aucRender(st){ var s = Math.ceil((st.ends_in || 0) / 1000); $('aucCd').textContent = s; $('aucBar').style.width = Math.max(0, Math.min(100, (st.ends_in || 0) / 30000 * 100)) + '%';
    var me = name; var html = (st.players || []).map(function(p){ var isMe = !p.bot && p.name === me; return '<div class="lp' + (isMe ? ' me' : '') + '"><span class="av">' + esc((p.name || '?').slice(0,1).toUpperCase()) + '</span><span class="nm">' + esc(p.name) + (isMe ? ' (vy)' : '') + '</span><span class="st">' + fmt(p.bank || 0) + '</span><i class="live" title="online"></i></div>'; }).join('');
    if (html !== $('lobby').innerHTML) $('lobby').innerHTML = html; }
  function aucResult(st){ var r = st.result || {}; var pod = r.podium || []; var mine = r.mine; $('aucOpen').classList.add('hidden'); $('aucRes').classList.remove('hidden');
    $('podium').innerHTML = pod.map(function(p, i){ var isMe = !p.bot && p.name === name && mine && mine.place === i + 1; return '<div class="pd p' + (i+1) + (isMe ? ' me' : '') + '"><div class="pl">' + (i+1) + '. místo</div><div class="pc">' + p.pct + ' %</div><div class="nm">' + esc(p.name) + (isMe ? ' (vy)' : '') + '</div></div>'; }).join('');
    var c = $('coupon'); if(!mine){ c.innerHTML = '<p class="sub">Toto kolo proběhlo bez vás – zkuste další.</p>'; return; }
    var head = mine.place === 1 ? name + ', vyhráváte hlavní cenu!' : mine.place === 2 ? name + ', skvělé druhé místo!' : (mine.place === 3 ? name + ', třetí místo!' : name + ', účastnický kupon je váš.');
    c.innerHTML = '<div class="eyebrow" style="display:inline-flex"><i></i>Váš kupon</div><div class="pc" style="margin-top:8px">' + mine.pct + ' %</div><div>sleva na první prádlomat</div><div class="code">' + esc(mine.code) + '</div>'
      + '<form id="claim"><p class="sub" style="margin:0">Kam vám máme kupon poslat? Platí při objednávce prádlomatu, pošleme ho i s podmínkami.</p><div class="row"><input type="email" id="cEmail" placeholder="váš e-mail" required inputmode="email" autocomplete="email"><input type="tel" id="cPhone" placeholder="telefon (nepovinné)" inputmode="tel" autocomplete="tel"></div><button class="btn gold" type="submit">Poslat kupon</button><p class="small" style="color:var(--text3);margin:0">Odesláním souhlasíte, že vás kvůli kuponu kontaktujeme. Žádný spam.</p></form>';
    $('claim').addEventListener('submit', function(e){ e.preventDefault(); var b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Odesílám…'; fetch('/api/arena/claim', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ sid: SID, round: AUC.round, name: name, email: $('cEmail').value.trim(), phone: $('cPhone').value.trim() }) }).then(function(r){ return r.json(); }).then(function(j){ if(j && j.ok){ $('claim').innerHTML = '<p class="ok">✓ Hotovo – kupon ' + esc(j.code) + ' na ' + j.pct + ' % jsme vám odeslali.</p><a class="btn" href="/location?utm_source=arena&c=' + encodeURIComponent(j.code) + '" style="margin-top:8px">Prověřit si místo pro prádlomat</a>'; } else { b.disabled = false; b.textContent = 'Poslat kupon'; alert((j && j.error) || 'Nepodařilo se odeslat.'); } }).catch(function(){ b.disabled = false; b.textContent = 'Poslat kupon'; }); });
    c.scrollIntoView({ behavior:'smooth', block:'center' }); }
  $('aucAgain').addEventListener('click', function(){ AUC.round = null; aucStart(); });
  $('toAuc').addEventListener('click', aucStart);
  // ── Bonusové karty: 5 karet, jedna se vybere; může kapitál zvýšit i snížit. Pojistka: při plném počtu správných
  //    odpovědí (maximální kapitál) nejde vytáhnout maximální navýšení – strop výsledku je BONUS_CAP.
  var BONUS_CAP = PRIZE * Q.length + 100000;
  var BONUS_MIN = PRIZE; // po kartě má každý aspoň 50 000 – ať může hrát dál (při nule vyjde jen kladná karta)
  var CARDS = [ { k:'x2', t:'×2', s:'zdvojnásobení', f:function(v){ return v * 2; } }, { k:'p100', t:'+100 000', s:'bonus', f:function(v){ return v + 100000; } }, { k:'p50', t:'+50 000', s:'bonus', f:function(v){ return v + 50000; } }, { k:'m50', t:'−50 000', s:'ztráta', f:function(v){ return Math.max(0, v - 50000); } }, { k:'half', t:'÷2', s:'polovina', f:function(v){ return Math.round(v / 2); } } ];
  function bonusShow(){ var box = $('cards'); box.className = 'cards'; box.innerHTML = CARDS.map(function(c, i){ return '<div class="cardb idle" data-i="' + i + '"><div class="b"></div><div class="f"></div></div>'; }).join(''); $('cmsg').innerHTML = 'Karta může kapitál zvýšit i snížit. Je to o náhodě.'; $('bonus').classList.remove('hidden'); $('rcta-row').classList.add('hidden');
    Array.prototype.forEach.call(box.children, function(el){ el.addEventListener('click', function(){ bonusPick(+el.getAttribute('data-i')); }); }); }
  function bonusPick(idx){ var box = $('cards'); if(box.classList.contains('lock')) return; box.classList.add('lock');
    // Povolené karty: nikdy nad strop (plný kvíz = žádné ×2 ani +100 000); z povolených se losuje, vybraná karta dostane los, ostatní zbytek
    var maxOK = bank >= PRIZE * Q.length; var allowed = CARDS.filter(function(c){ var v = c.f(bank); if (v > BONUS_CAP) return false; if (v < BONUS_MIN) return false; if (maxOK && (c.k === 'x2' || c.k === 'p100')) return false; return true; }); if (!allowed.length) allowed = CARDS.filter(function(c){ return c.f(bank) >= BONUS_MIN; });
    var chosen = allowed[Math.floor(Math.random() * allowed.length)]; var rest = CARDS.filter(function(c){ return c !== chosen; }).sort(function(){ return Math.random() - .5; });
    var map = {}; map[idx] = chosen; var ri = 0; for (var i = 0; i < CARDS.length; i++) if (i !== idx) map[i] = rest[ri++];
    Array.prototype.forEach.call(box.children, function(el, i){ var c = map[i]; var f = el.querySelector('.f'); var nv = c.f(bank); f.innerHTML = esc(c.t) + '<small>' + esc(c.s) + '</small>'; f.classList.add(nv > bank ? 'up' : (nv < bank ? 'down' : '')); el.classList.remove('idle'); });
    var el = box.children[idx]; el.classList.add('pick', 'open'); var before = bank; var after = chosen.f(bank);
    setTimeout(function(){ bank = after; $('bankv').textContent = fmt(bank); $('rbig').textContent = fmt(bank); $('bank').classList.remove('pop'); void $('bank').offsetWidth; $('bank').classList.add('pop'); var d = after - before; $('cmsg').innerHTML = (d >= 0 ? '<b class="up">+' : '<b class="down">−') + fmt(Math.abs(d)) + '</b><br>' + (d > 0 ? 'Karta přidala. Váš kapitál: ' : d < 0 ? 'Karta ubrala. Váš kapitál: ' : 'Beze změny. Váš kapitál: ') + '<b>' + fmt(bank) + '</b>'; if (d !== 0) { var fl = document.createElement('div'); fl.className = 'fly'; fl.textContent = (d > 0 ? '+' : '−') + fmt(Math.abs(d)); if (d < 0) fl.style.color = '#ff5d6c'; document.body.appendChild(fl); setTimeout(function(){ fl.remove(); }, 1400); }
      setTimeout(function(){ Array.prototype.forEach.call(box.children, function(x){ x.classList.add('open'); }); }, 500);
      setTimeout(function(){ $('rcta-row').classList.remove('hidden'); $('rcta-row').scrollIntoView({ behavior:'smooth', block:'center' }); }, 1400); }, 750); }

  // ping návštěvy (stejný beacon jako ostatní veřejné stránky)
  try { fetch('/api/presence/ping', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ sid: SID, path: '/arena' }) }); } catch(e){}
})();
</script>
</body>
</html>`;

function arenaPage() {
  const LOC = require('./location'); const V = require('./views');
  const src = LOC.PAGE;
  // Hlava (meta + styly) ze stránky Prověření lokality, jen jiný titulek a popis; animované pozadí (síť) sdílené.
  let head = src.slice(0, src.indexOf('</head>'));
  head = head.replace(/<title>[^<]*<\/title>/, '<title>Aréna Best Series – vydělejte si startovní kapitál na prádlomat</title>')
    .replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="5 otázek, 15 vteřin na každou, +50 000 Kč za správnou odpověď. Zahrajte si o virtuální startovní kapitál a zjistěte, co by prádlomat vydělal u vás."');
  const ni = src.indexOf("(function(){var c=document.getElementById('net')"); const ne = src.indexOf('\n', ni);
  const netScript = ni >= 0 ? src.slice(ni, ne) : '';
  const hi = src.indexOf('<header'); const he = src.indexOf('</header>') + '</header>'.length;
  let header = src.slice(hi, he).replace('Prověření lokality</span>', 'Aréna</span>').replace('<!--PRESENCE-->', '<span style="margin-left:auto"></span>' + V.PRESENCE_HTML);
  // Pocitadlo 'prave si prohlizi' se na Arene zobrazuje vynasobene (PRESENCE_MULT), zdrojova data se nemeni.
  const presenceJs = V.PRESENCE_JS.replace('var v=(j.total!=null?j.total:j.hour);', 'var v=(j.total!=null?j.total:j.hour);v=Math.round(Number(v||0)*' + PRESENCE_MULT + ');');
  return PAGE(head + '<style>' + V.PRESENCE_CSS + '</style>', netScript, header).replace('</body>', '<script>' + presenceJs + '</script></body>');
}

module.exports = { arenaPage, QUESTIONS, PRIZE, SECONDS };
