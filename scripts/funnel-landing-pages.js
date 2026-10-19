// HolyOS — Centrum reklamy: propojení uzlů funelu „Záchytná stránka" (kind=landing) se stránkami Centra reklamy
// Uzly funelu NEJSOU v samostatné tabulce, žijí v AppSetting `ads_center.funnels` (JSON). Návštěva se uzlu započítá,
// když uzel má `page` = klíč stránky z PAGES (routes/ads-center.routes.js) — viz services/ads/funnel-events.js matchNodes().
// Skript nastaví uzlům `page` (a informativně `url`) podle mapování níže.
//
// Použití (PowerShell):
//   $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL
//   node scripts/funnel-landing-pages.js            # jen ukáže, co by změnil (dry-run)
//   node scripts/funnel-landing-pages.js --apply    # zapíše
//   node scripts/funnel-landing-pages.js --check    # spočítá uložené události „otevřeno" (funnel_landing) pro tyto uzly
require('dotenv').config();
const { prisma } = require('../config/database');
const { getSetting, setSetting } = require('../services/settings');

const KEY = 'ads_center.funnels';
const MAP = {
  nmvcydzf1x7s: { page: 'bs2_lp_start', url: 'https://www.bestseries2.cz/lp/zachytna-stranka-velka-myslenka-bestseries2-cz-start' },
  nmvcyeu092j2: { page: 'bs2_location', url: 'https://www.bestseries2.cz/location' },
  nmvcyfa8t1i6: { page: 'bs2_findlocation', url: 'https://www.bestseries2.cz/findlocation' },
  nmvcyk0rwa2b: { page: 'bs2_cesta', url: 'https://www.bestseries2.cz/cesta' },
  nmvf12rkbyps: { page: 'bs2_cesta', url: 'https://www.bestseries2.cz/cesta' },
  nmvfe5bl81yn: { page: 'bs2_cesta', url: 'https://www.bestseries2.cz/cesta' },
};
const apply = process.argv.includes('--apply');
const check = process.argv.includes('--check');

(async () => {
  const funnels = (await getSetting(KEY, { type: 'json', defaultValue: [] })) || [];
  const found = {}; let changed = 0;
  for (const f of funnels) {
    for (const nd of f.nodes || []) {
      const m = MAP[nd.id]; if (!m) continue;
      found[nd.id] = f.id;
      const info = `funel ${f.id} („${f.name || ''}"), uzel ${nd.id}, druh=${nd.kind}`;
      if (nd.kind !== 'landing') { console.log('! PŘESKOČENO – ' + info + ' není záchytná stránka'); continue; }
      if (nd.page === m.page && nd.url === m.url) { console.log('= beze změny – ' + info + ' → ' + m.page); continue; }
      console.log((apply ? '✔ nastavuji' : '→ nastavil bych') + ' – ' + info + ': page ' + (nd.page || '—') + ' → ' + m.page);
      if (apply) { nd.page = m.page; nd.url = m.url; changed++; }
    }
  }
  Object.keys(MAP).forEach((id) => { if (!found[id]) console.log('! uzel ' + id + ' nenalezen v žádném funelu'); });
  // Dva uzly téhož funelu na stejné stránce by počítaly návštěvu dvakrát
  funnels.forEach((f) => { const seen = {}; (f.nodes || []).filter((n) => n.kind === 'landing' && n.page).forEach((n) => { if (seen[n.page]) console.log('! pozor: funel ' + f.id + ' má dva uzly na stránce ' + n.page + ' (' + seen[n.page] + ', ' + n.id + ') – návštěva se započítá do obou'); seen[n.page] = n.id; }); });
  if (apply && changed) {
    await setSetting(KEY, funnels, { type: 'json', description: 'Centrum reklamy – funely', scope: 'marketing' });
    console.log('\nUloženo (' + changed + ' uzlů). Cache funelů v běžícím serveru se obnoví do 30 s.');
  } else if (!apply) console.log('\nDry-run – nic nezapsáno. Pro zápis spusť s --apply.');

  if (check) {
    console.log('\n=== Uložené události „otevřeno" (funnel_landing) ===');
    for (const [nid, fid] of Object.entries(found)) {
      const rows = await prisma.compounderEvent.findMany({ where: { event: 'funnel_landing', path: '/funnel/' + fid + '/' + nid }, select: { props: true, created_at: true }, orderBy: { created_at: 'desc' } });
      const leads = new Set(rows.map((r) => r.props && r.props.lead_id).filter(Boolean));
      console.log(nid + ' (' + MAP[nid].page + '): událostí ' + rows.length + ', unikátních leadů ' + leads.size + (rows[0] ? ', poslední ' + rows[0].created_at.toISOString() : ''));
    }
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
