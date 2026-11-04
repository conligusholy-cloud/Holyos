// Laundromats — stránka Prádlomaty (převzato z Best Series 2.0: valueHero + nabídka strojů, bez Discount Creditu a objednávek).
// Stroje a fotky z HolyOS (/api/auth/lm/products, JWT LM_SSO_SECRET). Ceny se ukazují jen s LM_SHOW_PRICES=1, jinak „cenu probereme".
'use strict';
const { layout, cta, esc } = require('./lm-layout');
const { ico } = require('./icons');

function valueHero({ flex = null, sym = 'Kč' } = {}) {
  const HR = (flex && flex.R) || 1; // kolik DC (Kč) odpovídá 1 jednotce zobrazené měny
  // ── Scéna 1: hledání místa (lidé z Best Series prohledávají mapu a označí parcelu) ──
  const person = (kt, kp, path, color) => `<g><circle r="3.4" cy="-9" fill="#ffd9b0"/><rect x="-3.6" y="-6" width="7.2" height="9" rx="2.4" fill="${color}"/><rect x="-3.6" y="-1.5" width="7.2" height="1.8" fill="#fff" opacity=".85"/><animateMotion dur="8s" repeatCount="indefinite" calcMode="linear" keyTimes="${kt}" keyPoints="${kp}" path="${path}"/></g>`;
  const sceneFind = `<svg viewBox="0 0 240 150" class="vh-svg" role="img" aria-label="Lidé z Best Series hledají vhodné místo"><rect width="240" height="150" rx="12" fill="#0a1426"/>
    <g><rect x="160" y="74" width="70" height="40" rx="4" fill="#1c3b6e" stroke="#4fa3ff" stroke-width=".8"/><path d="M178 76v26M192 76v26M206 76v26M220 76v26" stroke="#7fb4ff" stroke-width=".7" opacity=".5"/><rect x="164" y="77" width="12" height="12" rx="3" fill="#1e86e0"/><text x="170" y="87" font-size="9.500" fill="#fff" text-anchor="middle" font-weight="800">P</text><text x="195" y="111" font-size="5.500" fill="#a9ccff" text-anchor="middle">Parkoviště</text></g>
    <g fill="#16294a" stroke="#22407a" stroke-width=".6"><rect x="9.5" y="9.5" width="17.0" height="19.5" rx="1.5"/><rect x="9.5" y="32.0" width="17.0" height="19.5" rx="1.5"/><rect x="29.5" y="9.5" width="17.0" height="19.5" rx="1.5"/><rect x="29.5" y="32.0" width="17.0" height="19.5" rx="1.5"/><rect x="49.5" y="9.5" width="17.0" height="19.5" rx="1.5"/><rect x="49.5" y="32.0" width="17.0" height="19.5" rx="1.5"/><rect x="77.5" y="9.5" width="14.5" height="19.5" rx="1.5"/><rect x="77.5" y="32.0" width="14.5" height="19.5" rx="1.5"/><rect x="95.0" y="9.5" width="14.5" height="19.5" rx="1.5"/><rect x="95.0" y="32.0" width="14.5" height="19.5" rx="1.5"/><rect x="112.5" y="9.5" width="14.5" height="19.5" rx="1.5"/><rect x="112.5" y="32.0" width="14.5" height="19.5" rx="1.5"/><rect x="130.0" y="9.5" width="14.5" height="19.5" rx="1.5"/><rect x="130.0" y="32.0" width="14.5" height="19.5" rx="1.5"/><rect x="155.5" y="9.5" width="17.5" height="19.5" rx="1.5"/><rect x="155.5" y="32.0" width="17.5" height="19.5" rx="1.5"/><rect x="176.0" y="9.5" width="17.5" height="19.5" rx="1.5"/><rect x="176.0" y="32.0" width="17.5" height="19.5" rx="1.5"/><rect x="196.5" y="9.5" width="17.5" height="19.5" rx="1.5"/><rect x="196.5" y="32.0" width="17.5" height="19.5" rx="1.5"/><rect x="217.0" y="9.5" width="17.5" height="19.5" rx="1.5"/><rect x="217.0" y="32.0" width="17.5" height="19.5" rx="1.5"/><rect x="9.5" y="67.5" width="17.0" height="18.0" rx="1.5"/><rect x="9.5" y="88.5" width="17.0" height="18.0" rx="1.5"/><rect x="29.5" y="67.5" width="17.0" height="18.0" rx="1.5"/><rect x="29.5" y="88.5" width="17.0" height="18.0" rx="1.5"/><rect x="49.5" y="67.5" width="17.0" height="18.0" rx="1.5"/><rect x="49.5" y="88.5" width="17.0" height="18.0" rx="1.5"/><rect x="77.5" y="67.5" width="14.5" height="18.0" rx="1.5"/><rect x="77.5" y="88.5" width="14.5" height="18.0" rx="1.5"/><rect x="95.0" y="67.5" width="14.5" height="18.0" rx="1.5"/><rect x="95.0" y="88.5" width="14.5" height="18.0" rx="1.5"/><rect x="112.5" y="67.5" width="14.5" height="18.0" rx="1.5"/><rect x="112.5" y="88.5" width="14.5" height="18.0" rx="1.5"/><rect x="130.0" y="67.5" width="14.5" height="18.0" rx="1.5"/><rect x="130.0" y="88.5" width="14.5" height="18.0" rx="1.5"/><rect x="9.5" y="119.5" width="17.0" height="23.0" rx="1.5"/><rect x="29.5" y="119.5" width="17.0" height="23.0" rx="1.5"/><rect x="49.5" y="119.5" width="17.0" height="23.0" rx="1.5"/><rect x="77.5" y="119.5" width="14.5" height="23.0" rx="1.5"/><rect x="95.0" y="119.5" width="14.5" height="23.0" rx="1.5"/><rect x="112.5" y="119.5" width="14.5" height="23.0" rx="1.5"/><rect x="130.0" y="119.5" width="14.5" height="23.0" rx="1.5"/><rect x="155.5" y="121.5" width="17.5" height="21.0" rx="1.5"/><rect x="176.0" y="121.5" width="17.5" height="21.0" rx="1.5"/><rect x="196.5" y="121.5" width="17.5" height="21.0" rx="1.5"/><rect x="217.0" y="121.5" width="17.5" height="21.0" rx="1.5"/></g>
    <g fill="none" stroke="#223a66" stroke-linecap="round"><path d="M0 59 H240" stroke-width="8"/><path d="M150 0 V150" stroke-width="8"/><path d="M72 0 V150" stroke-width="5"/><path d="M0 112 H240" stroke-width="5"/><path d="M150 92 H240" stroke-width="5"/></g>
    <g fill="none" stroke="#5f7fb8" stroke-width=".8" stroke-dasharray="4 4" opacity=".7"><path d="M0 59 H240"/><path d="M150 0 V150"/></g>
    <g font-size="5.500" fill="#7f97c4" opacity=".85"><text x="18" y="57">Hlavní</text><text x="153" y="20" transform="rotate(90 153 20)">Průmyslová</text></g>
    <rect x="78" y="119" width="66" height="25" rx="4" fill="#14452f"/><g fill="#1f7a4d" stroke="#2fe3a0" stroke-width=".4"><circle cx="84" cy="126" r="3.2"/><circle cx="94" cy="138" r="3.2"/><circle cx="104" cy="127" r="3.2"/><circle cx="116" cy="137" r="3.2"/><circle cx="126" cy="126" r="3.2"/><circle cx="138" cy="136" r="3.2"/><circle cx="132" cy="131" r="3.2"/><circle cx="90" cy="131" r="3.2"/></g>
    <g><rect x="158" y="12" width="74" height="38" rx="3" fill="#2a2f66" stroke="#5560d6" stroke-width=".8"/><rect x="170" y="24" width="24" height="16" fill="#e8ecff"/><path d="M167 24h30l-3-7h-24z" fill="#ff5470"/><rect x="179" y="31" width="6" height="9" fill="#2a2f66"/><text x="204" y="35" font-size="6.500" fill="#cfd6ff" font-weight="700">Obchod</text></g>
    <g><rect x="80" y="12" width="62" height="38" rx="3" fill="#3a2f45" stroke="#8a6fb0" stroke-width=".8"/><path d="M100 42V28l6-6 6 6v14z" fill="#d9c9f0"/><rect x="104" y="12.500" width="4" height="9" fill="#d9c9f0"/><path d="M102.500 15.500h7" stroke="#d9c9f0" stroke-width="1.600"/><path d="M106 12.500v-4" stroke="#d9c9f0" stroke-width="1.600"/><rect x="123" y="30" width="12" height="12" fill="#b9a4d8"/><text x="115" y="48" font-size="5.500" fill="#cdbfe6" text-anchor="middle">Kostel</text></g>
    <g><rect x="12" y="120" width="52" height="22" rx="3" fill="#3a2e1a" stroke="#d0a23a" stroke-width=".8"/><rect x="17" y="125" width="8" height="11" rx="1.500" fill="#ffd23f"/><rect x="19" y="127" width="4" height="3" fill="#3a2e1a"/><text x="38" y="140" font-size="5" fill="#f0d68a" text-anchor="middle">Čerp. stanice</text>
    ${flex && flex.img ? `<image class="vh-chk2" href="${flex.img}" x="30" y="121" width="26" height="16" preserveAspectRatio="xMidYMid meet"/>` : `<g class="vh-chk2"><rect x="34" y="123" width="14" height="13" rx="2" fill="#1b2e57" stroke="#3a6cf5" stroke-width=".8"/><circle cx="41" cy="130" r="3.500" fill="#0a1426" stroke="#4fd1ff"/></g>`}
    <g class="vh-chk2"><circle cx="58" cy="125" r="5" fill="#2fe3a0"/><path d="M55.500 125l2 2 3.500-4" fill="none" stroke="#04141a" stroke-width="1.400" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    <g><rect x="158" y="124" width="74" height="18" rx="3" fill="#1f3a4a" stroke="#3a8bb0" stroke-width=".8"/><circle cx="170" cy="133" r="4" fill="#4fd1ff"/><text x="200" y="135" font-size="5.500" fill="#b8e6f7" text-anchor="middle">Škola</text></g>
    <text x="111" y="132" font-size="5" fill="#bff3d9" text-anchor="middle" opacity=".0">Park</text>
    <g fill="#0a1426" opacity=".0"></g>
    <rect class="vh-lot" x="160" y="74" width="70" height="40" rx="5" fill="#2fe3a0" fill-opacity="0" stroke="#2fe3a0" stroke-width="1.5" stroke-dasharray="4 3"/>
    ${person('0;.12;.2;.34;.42;.66;1', '0;.124;.124;.463;.463;1;1', 'M10 59 H37 H111 H150 V92 H195', '#1e86e0')}${person('0;.3;.4;.56;1', '0;.4;.4;1;1', 'M10 59 H72 V112 H38 V122', '#7c5cff')}
    <g class="vh-x vh-x1" stroke="#ff5470" stroke-width="3" stroke-linecap="round"><path d="M29 22l16 16M45 22l-16 16"/></g>
    <g class="vh-x vh-x2" stroke="#ff5470" stroke-width="3" stroke-linecap="round"><path d="M103 79l16 16M119 79l-16 16"/></g>
    ${flex && flex.img ? `<image class="vh-chk" href="${flex.img}" x="178" y="79" width="44" height="30" preserveAspectRatio="xMidYMid meet"/>` : `<g class="vh-chk"><rect x="182" y="82" width="30" height="24" rx="3" fill="#1b2e57" stroke="#3a6cf5"/><rect x="180" y="82" width="30" height="6" rx="2" fill="#1e86e0"/><circle cx="195" cy="98" r="5" fill="#0a1426" stroke="#4fd1ff" stroke-width="1.5"/></g>`}
    <g class="vh-chk"><circle cx="220" cy="80" r="9" fill="#2fe3a0"/><path d="M215 80l4 4 7-8" fill="none" stroke="#04141a" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/></g>
  </svg>`;

  // ── Scéna 2: bagr kope výkop pro přípojky (voda + elektřina) až k prádlomatu ──
  const sceneDig = `<svg viewBox="0 0 240 150" class="vh-svg" role="img" aria-label="Bagr vykope přípojky, položí se zámková dlažba a auto s rukou usadí prádlomat"><rect width="240" height="150" rx="12" fill="#0a1426"/>
    <rect x="0" y="70" width="240" height="80" fill="#2a2018"/><rect x="0" y="70" width="240" height="5" fill="#2d6b4a"/>
    <rect x="0" y="75" width="240" height="75" fill="url(#vhg)" opacity=".5"/>
    <defs><linearGradient id="vhg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2b1e"/><stop offset="1" stop-color="#1a130d"/></linearGradient></defs>
    <path class="vh-trench" d="M65 100 H208" fill="none" stroke="#120d09" stroke-width="20" stroke-linecap="round" pathLength="143"/>
    <path class="vh-water" d="M65 94 H188 V70" fill="none" stroke="#4fd1ff" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round" pathLength="200"/>
    <path class="vh-drain" d="M65 100 H198 V70" fill="none" stroke="#b79a73" stroke-width="3.600" stroke-linecap="round" stroke-linejoin="round" pathLength="200"/>
    <path class="vh-elec" d="M65 106 H208 V70" fill="none" stroke="#ffd23f" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round" pathLength="200"/>
    <g class="vh-pavg"><rect class="vh-pav" style="animation-delay:5.00s" x="164.0" y="62" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.07s" x="174.3" y="62" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.14s" x="184.6" y="62" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.21s" x="194.9" y="62" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.28s" x="205.2" y="62" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.35s" x="215.5" y="62" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.42s" x="225.8" y="62" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.49s" x="164.0" y="66" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.56s" x="174.3" y="66" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.63s" x="184.6" y="66" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.70s" x="194.9" y="66" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.77s" x="205.2" y="66" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.84s" x="215.5" y="66" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.91s" x="225.8" y="66" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.98s" x="164.0" y="70" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:6.05s" x="174.3" y="70" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:6.12s" x="184.6" y="70" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:6.19s" x="194.9" y="70" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:6.26s" x="205.2" y="70" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:6.33s" x="215.5" y="70" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:6.40s" x="225.8" y="70" width="9" height="3.4" rx="0.8" fill="#8a8f98"/></g>
    ${flex && flex.img ? `<image class="vh-box" href="${flex.img}" x="166" y="10" width="70" height="60" preserveAspectRatio="xMidYMax meet"/>` : `<g class="vh-box"><rect x="188" y="26" width="44" height="44" rx="5" fill="#1b2e57" stroke="#3a6cf5"/><rect x="188" y="26" width="44" height="9" rx="3" fill="#3a6cf5"/><circle cx="203" cy="52" r="7" fill="#0a1426" stroke="#4fd1ff"/><circle cx="219" cy="52" r="7" fill="#0a1426" stroke="#4fd1ff"/></g>`}
    <g font-size="8.500" fill="#b8c6e0"><circle cx="22" cy="136" r="3" fill="#4fd1ff"/><text x="29" y="139">voda</text><circle cx="78" cy="136" r="3" fill="#b79a73"/><text x="85" y="139">odpad</text><circle cx="140" cy="136" r="3" fill="#ffd23f"/><text x="147" y="139">elektřina</text></g>
    <g class="vh-exc"><rect x="-17" y="-8" width="34" height="9" rx="4.500" fill="#2b3b5e"/><rect x="-13" y="-21" width="28" height="13" rx="2" fill="#f5b82e"/><rect x="-13" y="-33" width="15" height="13" rx="2" fill="#f5b82e"/><rect x="-10" y="-30" width="9" height="7" rx="1" fill="#a9d8ff"/>
      <g transform="translate(13 -19)"><g><animateTransform attributeName="transform" type="rotate" values="-10;16;-10" dur="1s" repeatCount="indefinite"/><line x1="0" y1="0" x2="22" y2="-11" stroke="#f5b82e" stroke-width="4.500" stroke-linecap="round"/><line x1="22" y1="-11" x2="33" y2="14" stroke="#e8a417" stroke-width="3.800" stroke-linecap="round"/><path d="M33 14l8-3-3 9z" fill="#aab6d0"/></g></g>
      <animateMotion dur="12s" repeatCount="indefinite" calcMode="linear" keyTimes="0;0.3;0.34;0.44;1" keyPoints="0;0.514;0.514;1;1" path="M22 70 H165 H300"/></g>
    <g class="vh-truck"><rect x="-38" y="-14" width="52" height="12" rx="2" fill="#2b3b5e"/><rect x="14" y="-20" width="20" height="18" rx="3" fill="#3a6cf5"/><rect x="18" y="-17" width="10" height="7" rx="1" fill="#a9d8ff"/><circle cx="-26" cy="0" r="5" fill="#111"/><circle cx="-6" cy="0" r="5" fill="#111"/><circle cx="24" cy="0" r="5" fill="#111"/>
      <g class="vh-crane"><line x1="-10" y1="-14" x2="-10" y2="-50" stroke="#f5b82e" stroke-width="4" stroke-linecap="round"/><line x1="-10" y1="-50" x2="75" y2="-62" stroke="#f5b82e" stroke-width="3.5" stroke-linecap="round"/><line class="vh-hook" x1="75" y1="-62" x2="75" y2="-62" stroke="#dfe6f2" stroke-width="1.2"/></g>
      <animateMotion dur="12s" repeatCount="indefinite" calcMode="linear" keyTimes="0;0.5;0.62;0.9;1" keyPoints="0;0;0.5;0.5;1" path="M-70 70 H126 H-70"/></g>
  </svg>`;

  // ── Scéna 3: provoz za 13 % z obratu ──
  const sceneRun = `<svg viewBox="0 0 240 150" class="vh-svg" role="img" aria-label="Provoz za 13 procent z obratu"><rect width="240" height="150" rx="12" fill="#0a1426"/>
    <g transform="translate(76 75) rotate(-90)"><circle r="34" fill="none" stroke="#1b2c52" stroke-width="14"/><circle class="vh-arc" r="34" fill="none" stroke="#2fe3a0" stroke-width="14" stroke-linecap="butt" pathLength="100" stroke-dasharray="0 100"/></g>
    <text x="76" y="76" text-anchor="middle" font-size="19" font-weight="800" fill="#eaf2ff">13 %</text><text x="76" y="90" text-anchor="middle" font-size="8.500" fill="#8ea2c2">z obratu</text>
    <g><rect class="vh-b" x="136" y="40" width="20" height="85" rx="3" fill="#2a4478" style="--h:85"/><rect class="vh-b" x="162" y="20" width="20" height="105" rx="3" fill="#3a6cf5" style="--h:105"/><rect class="vh-b" x="188" y="8" width="20" height="117" rx="3" fill="#7c5cff" style="--h:117"/>
      <rect class="vh-b13" x="188" y="8" width="20" height="15" rx="3" fill="#2fe3a0"/></g>
    <path d="M130 125 H214" stroke="#2b4a86" stroke-width="1.500"/>
  </svg>`;

  const scene = (n, title, text, svg, tag) => `<div class="vh-step"><div class="vh-sc">${svg}<span class="vh-num">${n}</span></div><b>${title}</b><span>${text}</span>${tag ? `<em>${tag}</em>` : ''}</div>`;

  // ── Kalkulačka: FLEX + posuvník DC ──
  let calc = '';
  if (flex && flex.net > 0) {
    const room = Math.max(0, Math.floor((flex.room || 0) * HR)); // maximum v DC
    const step = Math.max(1, Math.round(room / 100));
    calc = `<div class="vh-calc">
      <div class="vh-cimg">${flex.img ? `<img src="${flex.img}" alt="${esc(flex.name)}">` : ''}</div>
      <div class="vh-cbody">
        <div class="vh-ct"><span class="vh-n4">4</span><span>DC snižuje cenu — čím víc DC, tím menší cena</span></div>
        <div class="vh-nm">${esc(flex.name)}</div>
        <div class="vh-price"><b id="vh-new">${Math.round(flex.net).toLocaleString('cs-CZ')}</b> <small>${sym} bez DPH</small> <s id="vh-old">${Math.round(flex.net).toLocaleString('cs-CZ')} ${sym}</s></div>
        <div class="vh-sl"><span class="small muted">Uplatněné DC</span><b id="vh-dc">0 DC</b></div>
        <input type="range" id="vh-r" min="0" max="${room}" step="${step}" value="0" aria-label="Kolik DC uplatnit" ${room ? '' : 'disabled'}>
        <div class="vh-cmp"><div class="vh-row"><span>Pořizovací cena</span><div class="vh-bar"><i id="vh-b1" style="width:100%"></i></div></div><div class="vh-row"><span>Doba návratnosti</span><div class="vh-bar"><i id="vh-b2" class="g" style="width:100%"></i></div></div></div>
        <div class="vh-sv" id="vh-sv">Posuň posuvník a uvidíš, o kolik se zlevní prádlomat.</div>
      </div>
    </div>
    <script>(function(){var NET=${JSON.stringify(Math.round(flex.net))},ROOM=${JSON.stringify(room)},SYM=${JSON.stringify(sym)},R=${JSON.stringify(HR)};
      var r=document.getElementById('vh-r');if(!r)return;var nw=document.getElementById('vh-new'),dcE=document.getElementById('vh-dc'),bd=document.createElement('i'),b1=document.getElementById('vh-b1'),b2=document.getElementById('vh-b2'),sv=document.getElementById('vh-sv'),old=document.getElementById('vh-old');
      function f(n){return Math.round(n).toLocaleString('cs-CZ');}
      var shown=NET,raf=null,touched=false;
      function paint(v){var dc=Math.max(0,Math.min(ROOM,v)),dcc=dc/R,pr=NET-dcc,pct=NET>0?dcc/NET*100:0;
        nw.textContent=f(pr);dcE.textContent=f(dc)+' DC';bd.textContent='−'+(Math.round(pct*10)/10).toLocaleString('cs-CZ')+' %';bd.style.transform='scale('+(1+Math.min(pct,40)/200)+')';
        b1.style.width=(NET>0?pr/NET*100:100)+'%';b2.style.width=(NET>0?pr/NET*100:100)+'%';old.style.opacity=dc>0?'.7':'0';
        sv.innerHTML=dc>0?('Ušetříš <b>'+f(dcc)+' '+SYM+'</b> už při nákupu'+(R!==1?' ('+f(dc)+' DC)':'')+'.'):'Posuň posuvník a uvidíš, o kolik se zlevní prádlomat.';}
      function go(to){cancelAnimationFrame(raf);var from=shown,t0=null,d=Math.min(900,200+Math.abs(to-from)/Math.max(1,ROOM)*700);(function st(ts){if(t0==null)t0=ts;var k=Math.min(1,(ts-t0)/d),e=1-Math.pow(1-k,3);shown=from+(to-from)*e;paint(shown);r.value=shown;if(k<1)raf=requestAnimationFrame(st);})(performance.now());}
      shown=0;paint(0);
      r.addEventListener('input',function(){touched=true;cancelAnimationFrame(raf);shown=+r.value;paint(shown);});
      [].forEach.call(document.querySelectorAll('.vh-q button'),function(b){b.addEventListener('click',function(){touched=true;go(ROOM*(+b.getAttribute('data-p'))/100);});});
      if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting&&!touched){io.disconnect();setTimeout(function(){if(!touched)go(ROOM*0.6);},600);}});},{threshold:.5});io.observe(document.querySelector('.vh-calc'));}
    })();</script>`;
  }

  return `<style>
  .vh{position:relative;overflow:hidden;margin:22px 0 18px;padding:24px 22px 22px;border-radius:20px;border:1px solid var(--border2);background:radial-gradient(900px 260px at 0% 0%,rgba(30,134,224,.22),transparent 60%),radial-gradient(700px 260px at 100% 100%,rgba(124,92,255,.22),transparent 60%),var(--card2);box-shadow:0 24px 70px rgba(0,0,0,.4)}
  .vh h2{margin:0 0 4px;font-size:clamp(20px,2.6vw,28px);letter-spacing:-.02em;font-weight:800;line-height:1.15;background:linear-gradient(90deg,#fff 0%,var(--accent2) 55%,var(--vio) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  .vh .vh-sub{margin:0 0 18px;color:var(--text2);font-size:14px;max-width:760px}
  .vh-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .vh-step{position:relative;display:flex;flex-direction:column;gap:6px;padding:12px 12px 14px;border-radius:16px;background:rgba(10,18,36,.7);border:1px solid var(--border)}
  .vh-step:not(:last-child)::after{content:"";position:absolute;top:34%;right:-17px;width:18px;height:2px;background:linear-gradient(90deg,var(--accent2),var(--vio));opacity:.85}
  .vh-step:not(:last-child)::before{content:"";position:absolute;top:calc(34% - 4px);right:-18px;border:5px solid transparent;border-left:7px solid var(--vio)}
  .vh-sc{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--border);line-height:0}.vh-svg{width:100%;height:auto;display:block}
  .vh-num{position:absolute;top:8px;left:8px;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--vio));color:#fff;font-weight:800;font-size:13px;line-height:24px;text-align:center;box-shadow:0 4px 14px rgba(30,134,224,.5)}
  .vh-step b{font-size:16px;letter-spacing:-.01em;margin-top:6px}.vh-step span{font-size:13px;color:var(--text2);line-height:1.4}
  .vh-step em{font-style:normal;align-self:flex-start;margin-top:4px;font-size:12px;font-weight:800;color:var(--ok);background:rgba(47,227,160,.12);border:1px solid rgba(47,227,160,.35);padding:3px 9px;border-radius:999px}
  .vh-step .vh-num{font-size:13px;color:#fff}
  .vh-x{opacity:0;animation:vhx1 8s ease infinite}.vh-x2{animation-name:vhx2}
  .vh-lot{animation:vhlot 8s ease infinite}.vh-chk{opacity:0;animation:vhchk 8s ease infinite}.vh-chk2{opacity:0;animation:vhchk2 8s ease infinite}
  @keyframes vhx1{0%,18%{opacity:0}22%,92%{opacity:1}100%{opacity:0}}
  @keyframes vhx2{0%,40%{opacity:0}44%,92%{opacity:1}100%{opacity:0}}
  @keyframes vhlot{0%,66%{fill-opacity:0}72%,94%{fill-opacity:.28}100%{fill-opacity:0}}
  @keyframes vhchk2{0%,56%{opacity:0}64%,94%{opacity:1}100%{opacity:0}}
  @keyframes vhchk{0%,68%{opacity:0}76%,94%{opacity:1}100%{opacity:0}}
  .vh-trench{stroke-dasharray:143;animation:vhdig 12s linear infinite}.vh-water,.vh-drain,.vh-elec{stroke-dasharray:200;animation:vhpipe 12s linear infinite}.vh-drain{animation-delay:.05s}.vh-elec{animation-delay:.1s}
  @keyframes vhdig{0%{stroke-dashoffset:143}30%,96%{stroke-dashoffset:0}100%{stroke-dashoffset:0;opacity:0}}
  @keyframes vhpipe{0%,4%{stroke-dashoffset:200}31%,96%{stroke-dashoffset:0}100%{stroke-dashoffset:0;opacity:0}}
  .vh-pav{opacity:0;animation:vhpav 12s linear infinite}@keyframes vhpav{0%{opacity:0;transform:translateY(-6px)}3%,96%{opacity:1;transform:none}100%{opacity:0}}
  .vh-box{opacity:0;transform-box:fill-box;animation:vhbox 12s linear infinite}@keyframes vhbox{0%,62%{opacity:0;transform:translateY(-46px)}66%{opacity:1;transform:translateY(-46px)}80%{opacity:1;transform:translateY(0)}86%,96%{opacity:1;transform:translateY(0);filter:drop-shadow(0 0 7px #4fd1ff)}100%{opacity:0;transform:translateY(0)}}
  .vh-hook{animation:vhhook 12s linear infinite}@keyframes vhhook{0%,62%{y2:-62px}66%{y2:-62px}80%{y2:-10px}84%,100%{y2:-62px}}
  .vh-arc{animation:vharc 6s ease infinite}@keyframes vharc{0%{stroke-dasharray:0 100}25%,92%{stroke-dasharray:13 100}100%{stroke-dasharray:0 100}}
  .vh-b{transform-box:fill-box;transform-origin:50% 100%;animation:vhgrow 6s ease infinite}.vh-b:nth-of-type(2){animation-delay:.12s}.vh-b:nth-of-type(3){animation-delay:.24s}
  @keyframes vhgrow{0%{transform:scaleY(.05)}25%,92%{transform:scaleY(1)}100%{transform:scaleY(.05)}}
  .vh-b13{transform-box:fill-box;transform-origin:50% 0;animation:vhb13 6s ease infinite}@keyframes vhb13{0%,25%{opacity:0;transform:scaleY(.05)}35%,92%{opacity:1;transform:scaleY(1)}100%{opacity:0}}
  .vh-calc{margin-top:18px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px;align-items:center;padding:18px;border-radius:18px;background:rgba(6,12,26,.72);border:1px solid var(--border2)}
  .vh-cimg{position:relative;display:flex;align-items:center;justify-content:center;min-height:180px;border-radius:14px;background:radial-gradient(ellipse at 50% 60%,rgba(79,209,255,.16),transparent 70%)}
  .vh-cimg img{width:100%;max-width:420px;height:auto;object-fit:contain;filter:drop-shadow(0 18px 30px rgba(0,0,0,.55));transition:transform .4s}.vh-calc:hover .vh-cimg img{transform:scale(1.03)}
  .vh-badge{position:absolute;top:6px;right:6px;font-weight:800;font-size:18px;color:#04141a;background:linear-gradient(135deg,#2fe3a0,#4fd1ff);padding:7px 13px;border-radius:999px;box-shadow:0 8px 24px rgba(47,227,160,.4);transition:transform .2s}
  .vh-ct{display:flex;gap:10px;align-items:center;font-weight:800;font-size:16px}.vh-n4{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--vio));color:#fff;text-align:center;line-height:26px;font-size:13px;flex:none}
  .vh-nm{margin:8px 0 2px;color:var(--text2);font-size:14px}.vh-price{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.vh-price b{font-size:clamp(28px,4vw,40px);font-weight:800;letter-spacing:-.02em}.vh-price small{color:var(--text2);font-size:13px}.vh-price s{color:var(--text3);font-size:14px;transition:opacity .3s}
  .vh-sl{display:flex;justify-content:space-between;align-items:baseline;margin-top:12px}.vh-sl b{color:var(--ok);font-size:16px}
  #vh-r{-webkit-appearance:none;appearance:none;width:100%;height:10px;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--vio));padding:0;border:0;margin:8px 0 10px;cursor:pointer;outline:none;box-shadow:0 0 18px rgba(58,108,245,.3)}
  #vh-r::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:#fff;border:3px solid var(--accent2);box-shadow:0 4px 14px rgba(0,0,0,.5),0 0 0 6px rgba(79,209,255,.2)}
  #vh-r::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid var(--accent2)}
  .vh-q{display:flex;gap:6px;flex-wrap:wrap}.vh-q button{font:inherit;font-size:13px;font-weight:700;color:var(--text);background:rgba(120,160,255,.1);border:1px solid var(--border2);border-radius:999px;padding:6px 13px;cursor:pointer;min-height:34px}.vh-q button:hover{background:rgba(79,209,255,.18)}
  .vh-cmp{margin-top:14px;display:grid;gap:9px}.vh-row{display:grid;grid-template-columns:124px 1fr;gap:10px;align-items:center;font-size:12.5px;color:var(--text2)}
  .vh-bar{height:18px;border-radius:7px;background:rgba(120,160,255,.1);overflow:hidden}.vh-bar i{display:block;height:100%;border-radius:7px;background:linear-gradient(90deg,#3a4a6e,#6a7fae);transition:width .08s linear}.vh-bar i.g{background:linear-gradient(90deg,var(--accent),#3a6cf5 55%,var(--vio))}
  .vh-sv{margin-top:12px;font-size:13.5px;color:var(--text2);min-height:38px}.vh-sv b{color:var(--ok)}
  @media(max-width:900px){.vh-flow{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}.vh-step::after,.vh-step::before{display:none!important}.vh-calc{grid-template-columns:1fr}}
  @media(max-width:520px){.vh-row{grid-template-columns:100px 1fr}}
  @media(prefers-reduced-motion:reduce){.vh-x,.vh-lot,.vh-chk,.vh-chk2,.vh-trench,.vh-water,.vh-elec,.vh-box,.vh-arc,.vh-b,.vh-b13{animation:none!important}.vh-x,.vh-chk,.vh-chk2,.vh-b13{opacity:1}.vh-arc{stroke-dasharray:13 100}.vh-trench,.vh-water,.vh-drain,.vh-elec{stroke-dashoffset:0}}
  </style>
  <section class="vh">
    <h2>Prádlomat nekupujete sami. Best Series zařídí všechno ostatní.</h2>
    <p class="vh-sub">Od prvního místa po provoz hotového stroje. Vy si vyberete prádlomat, my se postaráme o zbytek.</p>
    <div class="vh-flow">
      ${scene(1, 'Zařídíme místo', 'Naši lidé najdou a vyhodnotí vhodnou lokalitu pro váš prádlomat.', sceneFind)}
      ${scene(2, 'Vytvoříme přípojky', 'Zajistíme a vybudujeme přípojky vody, odpadu a elektřiny až k prádlomatu.', sceneDig)}
      ${scene(3, 'Provozujeme za 13 % z obratu', 'Postaráme se o provoz. Platíte jen z toho, co stroj skutečně vydělá.', sceneRun, '13 % z obratu')}
    </div>
    ${calc}
  </section>`;
}


const SERVICES = [
  ['find_place', 'Najít místo', 'Pomůžeme vám najít vhodné místo pro prádlomat — analýza lokality, oslovení majitelů pozemků a doporučení.'],
  ['connections', 'Přípojky', 'Zajištění přípojek pro prádlomat (voda, elektřina, odpad). Cena podle konkrétní situace — individuální nacenění.'],
  ['service_contract', 'Servisní smlouva', 'Pravidelný servis a údržba prádlomatu. Cena je procento z obratu stroje — platíte jen tehdy, když prádlomat vydělává.'],
  ['extended_warranty', 'Prodloužená záruka', 'Záruka na prádlomat celkem 2 až 5 let. První rok je ze zákona zdarma.'],
];


// Okno „Mám zájem" — zákazník jen potvrdí opravdový zájem a my mu voláme.
// Stránka je za přihlášením, takže kontakt známe z účtu a nic se nevyplňuje.
const ZAJEM_DLG = `
<dialog class="helpdlg" id="zajemDlg"><div class="hd-in">
  <div class="hd-head"><span class="hd-q">!</span><h2>Máte opravdový zájem?</h2>
    <button class="hd-x" type="button" data-zavrit aria-label="Zavřít">✕</button></div>
  <div class="hd-body">
    <div id="zajemForm">
      <p>Pokud máte o <b id="zajemProd">prádlomat</b> opravdový zájem, klikněte na <b>OK</b> — do několika minut se vám ozve kompetentní osoba.</p>
      <div id="zajemErr" class="msg err" style="display:none"></div>
      <div class="row" style="margin-top:14px;justify-content:flex-end">
        <button class="btn sec" type="button" data-zavrit>Zrušit</button>
        <button class="btn" type="button" id="zajemOk">OK, mám zájem</button>
      </div>
    </div>
    <div id="zajemDik" style="display:none">
      <p style="font-size:16px"><b>Děkujeme, máme to.</b></p>
      <p>Ozveme se vám na číslo z vašeho účtu — obvykle do několika minut.</p>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" type="button" data-zavrit>Zavřít</button></div>
    </div>
  </div>
</div></dialog>
<script>
(function(){
  var dlg = document.getElementById('zajemDlg'); if (!dlg) return;
  var prod = '';
  var el = function(id){ return document.getElementById(id); };
  var zavri = function(){ if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); };

  document.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('[data-zajem]') : null;
    if (b) {
      prod = b.getAttribute('data-zajem') || 'prádlomat';
      el('zajemProd').textContent = prod;
      el('zajemErr').style.display = 'none';
      el('zajemForm').style.display = '';
      el('zajemDik').style.display = 'none';
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      return;
    }
    if (e.target.closest && e.target.closest('[data-zavrit]')) zavri();
  });

  el('zajemOk').addEventListener('click', function(){
    var err = el('zajemErr');
    var btn = el('zajemOk'); btn.disabled = true; btn.textContent = 'Odesílám…';
    fetch('/api/cesta/pradlomat-zajem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ product: prod, sid: (window.lmSid ? window.lmSid() : undefined) })
    }).then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(j){
        btn.disabled = false; btn.textContent = 'OK, mám zájem';
        if (!j || !j.ok) {
          err.textContent = (j && j.error) || 'Odeslání se nepodařilo, zkuste to prosím znovu.';
          err.style.display = ''; return;
        }
        el('zajemForm').style.display = 'none';
        el('zajemDik').style.display = '';
      }).catch(function(){
        btn.disabled = false; btn.textContent = 'OK, mám zájem';
        err.textContent = 'Odeslání se nepodařilo, zkuste to prosím znovu.';
        err.style.display = '';
      });
  });
})();
</script>`;

function pradlomatyPage(products, cfg) {
  cfg = cfg || {}; const items = cfg.items || {};
  const globalPrices = cfg.show_prices === true || process.env.LM_SHOW_PRICES === '1';
  const money = (n) => Math.round(Number(n)).toLocaleString('cs-CZ') + ' Kč';
  // Nastavení z administrace: skryté pryč, pořadí, vlastní název a popis, cena per produkt (jinak globálně)
  const list = (Array.isArray(products) ? products : []).map((p, i) => Object.assign({ _i: i, _c: items[p.id] || {} }, p))
    .filter((p) => !p._c.hidden)
    .sort((a, b) => ((a._c.order || 0) - (b._c.order || 0)) || (a._i - b._i))
    .map((p) => Object.assign({}, p, { name_cs: p._c.title || p.name_cs, _desc: p._c.desc || '', _price: p._c.show_price === true || (p._c.show_price !== false && globalPrices) }));
  const showPrices = true; // rozhoduje p._price
  const grid = list.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">` + list.map((p) => `
    <div class="card" style="margin:0;display:flex;flex-direction:column">${p.image_ext ? `<div style="margin:-6px -6px 12px;padding:10px;border-radius:14px;background:radial-gradient(ellipse at 50% 60%,rgba(79,209,255,.16),transparent 70%)"><img src="/img/product/${p.id}?v=${encodeURIComponent(String(p.image_updated_at || ''))}" alt="${esc(p.name_cs)}" loading="lazy" style="width:100%;height:180px;object-fit:contain;display:block"></div>` : ''}
      <b style="font-size:17px">${esc(p.name_cs)}</b>
      ${p._desc ? `<p class="muted" style="margin:6px 0 0;font-size:14px;line-height:1.5">${esc(p._desc)}</p>` : ''}
      ${showPrices && p._price && p.price_czk != null ? `<div style="font-size:24px;font-weight:800;margin-top:6px">${money(p.price_czk)} <span class="small muted" style="font-weight:500">bez DPH</span></div><div class="small muted">${money(Number(p.price_czk) * 1.21)} s DPH 21 %</div>` : `${p._desc ? '' : '<div class="small muted" style="margin-top:6px">Cenu a financování probereme podle vašeho místa.</div>'}`}
      <div style="margin-top:auto;padding-top:14px"><button type="button" class="btn sm" data-zajem="${esc(p.name_cs)}">Mám zájem →</button></div></div>`).join('') + `</div>`
    : `<div class="card muted">Nabídku strojů právě aktualizujeme. Napište nám a pošleme vám ji.</div>`;
  // Služby řešíme až po pořízení prádlomatu → zamčené dlaždice (šedé + 🔒), klik = vysvětlení
  const svc = `<style>.svc-lock{position:relative;margin:0;text-align:left;font:inherit;color:inherit;cursor:pointer;filter:grayscale(1);opacity:.55;transition:opacity .15s}.svc-lock:hover{opacity:.75}.svc-lock .svc-lk{position:absolute;top:12px;right:14px;font-size:15px}</style>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">` + SERVICES.map((s) => `<button type="button" class="card svc-lock" data-svc="${esc(s[1])}"><span class="svc-lk" title="Zpřístupníme po pořízení prádlomatu">🔒</span><b style="font-size:16px;padding-right:22px">${esc(s[1])}</b><p class="muted" style="margin:8px 0 0">${esc(s[2])}</p></button>`).join('') + `</div>
  <dialog class="helpdlg" id="svcDlg"><div class="hd-in">
    <div class="hd-head"><span class="hd-q">🔒</span><h2><span id="svcName">Služba</span> zatím uzamčena</h2>
      <button class="hd-x" type="button" data-svczavrit aria-label="Zavřít">✕</button></div>
    <div class="hd-body"><p>Služby k prádlomatu řešíme až ve chvíli, kdy máte prádlomat pořízený. Nejdřív spolu vybereme stroj a místo — pak vám služby zpřístupníme.</p>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn sec" type="button" data-svczavrit>Zavřít</button><a class="btn" href="/cesta/schuzka">📅 Domluvit online schůzku</a></div></div>
  </div></dialog>
  <script>(function(){var d=document.getElementById('svcDlg');if(!d)return;var cl=function(){if(d.close)d.close();else d.removeAttribute('open');};
    document.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('[data-svc]'):null;
      if(b){document.getElementById('svcName').textContent=b.getAttribute('data-svc');if(d.showModal)d.showModal();else d.setAttribute('open','');try{if(window.lmTrack)lmTrack('locked_service',{service:b.getAttribute('data-svc')});}catch(x){}return;}
      if(e.target===d||(e.target.closest&&e.target.closest('[data-svczavrit]')))cl();});})();<\/script>`;
  return layout({ title: 'Prádlomaty', desc: 'Samoobslužné venkovní prádlomaty — co všechno zajistíme a jaké stroje nabízíme.', active: 'pradlomaty', body: `
  ${valueHero({ flex: null, sym: 'Kč' })}
  <h2 style="margin:30px 0 12px;display:flex;align-items:center;gap:8px">${ico('box', 18)} Prádlomaty, které si můžete pořídit</h2>
  ${grid}
  <h2 style="margin:34px 0 12px;display:flex;align-items:center;gap:8px">${ico('check', 18)} Služby k prádlomatu</h2>
  ${svc}
  ${ZAJEM_DLG}
  ${cta('Který prádlomat se hodí na vaše místo?', 'Projdeme s vámi lokalitu, výběr stroje i financování.')}
  ` });
}

module.exports = { pradlomatyPage };
