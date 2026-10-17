// BS2 — jednotná patička veřejných stránek (logo Best Series 2.0 + odkazy). Použije /location, /findlocation i /cesta.
const { logoSvg } = require('./logo');
const FOOTER_CSS = `.site-foot{margin-top:70px;padding:26px 0 8px;border-top:1px solid rgba(120,160,255,.14);display:flex;align-items:center;justify-content:space-between;gap:16px 28px;flex-wrap:wrap;font-size:13.5px;color:#58698a}
.site-foot .sf-brand{display:flex;align-items:center;gap:12px;color:#8ea2c2}
.site-foot .sf-brand b{font-weight:800;letter-spacing:-.01em;background:linear-gradient(90deg,#4fd1ff,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:15px}
.site-foot nav{display:flex;flex-wrap:wrap;gap:6px 22px}
.site-foot nav a{color:#7d93b8;text-decoration:none}.site-foot nav a:hover{color:#4fd1ff}
@media(max-width:720px){.site-foot{flex-direction:column;align-items:flex-start}}`;
function siteFooter() {
  return `<footer class="site-foot"><div class="sf-brand">${logoSvg(40, 'sf')}<span><b>Best Series 2.0</b> &nbsp;© Best Series</span></div><nav><a href="/findlocation">Vyhledávač míst</a><a href="/location">Prověření lokality</a><a href="/location/vop">Obchodní podmínky</a><a href="/location/gdpr">Ochrana osobních údajů</a><a href="/login">Přihlášení</a></nav></footer>`;
}
module.exports = { siteFooter, FOOTER_CSS };
