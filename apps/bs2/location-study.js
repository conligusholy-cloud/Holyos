// BS2 — AI studie lokality (Prověření lokality): posbírá fakta z map (OSM Overpass: služby, ubytování,
// podnikatelé, silnice, parkoviště; spádová oblast 15 km z HolyOS), spojí je s údaji zákazníka a nechá
// Claude sestavit strukturovanou studii (segmenty zákazníků, průtok lidí/aut, odhad poptávky, cena
// přípojek a dopravy, doporučený nájem, zátěž zakreslených bodů, rizika). Vše jsou ODHADY – ve studii
// je u každého čísla uvedeno, z čeho vychází. Výstup se ukládá do location_sites.study (JSONB).
const { esc, layout } = require('./views');
const LAPP = require('./location-app');

const UA = 'BestSeries2/1.0 (+https://www.bestseries2.cz)';
async function overpass(query, ms) {
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(ms || 40000) });
  if (!r.ok) throw new Error('Overpass ' + r.status);
  return r.json();
}
const distM = (a, b, c, d) => { const R = 6371000, t = Math.PI / 180; const x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t; return Math.round(Math.sqrt(x * x + y * y) * R); };

// ── Sběr faktů z OSM kolem místa ───────────────────────────────────────────────
async function gatherOsm(lat, lng) {
  const R = 1500;
  const q = `[out:json][timeout:35];
(
  nwr(around:${R},${lat},${lng})["amenity"~"^(restaurant|cafe|pub|bar|fast_food|pharmacy|school|kindergarten|college|university|hospital|clinic|doctors|dentist|nursing_home|social_facility|fuel|bank|post_office|townhall|community_centre|fire_station|police|marketplace|car_wash|childcare)$"];
  nwr(around:${R},${lat},${lng})["tourism"~"^(hotel|guest_house|hostel|chalet|apartment|camp_site|caravan_site|motel|alpine_hut|wilderness_hut|information|attraction|museum)$"];
  nwr(around:${R},${lat},${lng})["shop"];
  nwr(around:${R},${lat},${lng})["leisure"~"^(sports_centre|fitness_centre|swimming_pool|stadium|pitch|sports_hall|water_park|golf_course|marina)$"];
  nwr(around:${R},${lat},${lng})["office"];
  nwr(around:${R},${lat},${lng})["craft"];
  nwr(around:${R},${lat},${lng})["healthcare"];
  nwr(around:${R},${lat},${lng})["landuse"~"^(industrial|commercial|retail)$"];
  nwr(around:${R},${lat},${lng})["building"~"^(apartments|dormitory)$"];
  nwr(around:600,${lat},${lng})["amenity"="parking"];
  nwr(around:600,${lat},${lng})["public_transport"~"^(stop_position|platform)$"];
  nwr(around:600,${lat},${lng})["highway"="bus_stop"];
  way(around:400,${lat},${lng})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)$"];
);
out center tags;`;
  const j = await overpass(q);
  const out = { pois: [], roads: [], parking: [], transit: [], apartments: 0, industrial: [] };
  const seen = new Set();
  for (const e of (j.elements || [])) {
    const t = e.tags || {}; const c = e.center || e; if (c.lat == null) continue;
    const d = distM(lat, lng, c.lat, c.lon);
    if (t.highway && e.type === 'way') { if (!/^(service|living_street)$/.test(t.highway) || t.name) out.roads.push({ name: t.name || t.ref || '(bez názvu)', ref: t.ref || null, cls: t.highway, maxspeed: t.maxspeed || null, lanes: t.lanes || null, dist_m: d, oneway: t.oneway === 'yes' }); continue; }
    if (t.amenity === 'parking') { out.parking.push({ name: t.name || null, capacity: t.capacity ? Number(t.capacity) : null, access: t.access || null, fee: t.fee || null, dist_m: d }); continue; }
    if (t.public_transport || t.highway === 'bus_stop') { const k = 'ps:' + (t.name || '') + Math.round(d / 50); if (seen.has(k)) continue; seen.add(k); out.transit.push({ name: t.name || '(zastávka)', dist_m: d }); continue; }
    if (t.building === 'apartments' || t.building === 'dormitory') { out.apartments++; continue; }
    if (t.landuse) { out.industrial.push({ type: t.landuse, name: t.name || null, dist_m: d }); continue; }
    const cat = t.tourism ? 'tourism:' + t.tourism : t.amenity ? 'amenity:' + t.amenity : t.shop ? 'shop:' + t.shop : t.leisure ? 'leisure:' + t.leisure : t.office ? 'office:' + t.office : t.craft ? 'craft:' + t.craft : t.healthcare ? 'healthcare:' + t.healthcare : null;
    if (!cat) continue;
    const key = cat + '|' + (t.name || '') + '|' + Math.round(d / 30); if (seen.has(key)) continue; seen.add(key);
    out.pois.push({ name: t.name || null, cat, dist_m: d, rooms: t.rooms ? Number(t.rooms) : null, beds: t.beds ? Number(t.beds) : null, capacity: t.capacity ? Number(t.capacity) : null, opening_hours: t.opening_hours || null, brand: t.brand || null });
  }
  // dedup silnic podle názvu/třídy, nejbližší
  const rm = new Map(); for (const r of out.roads) { const k = r.name + '|' + r.cls; if (!rm.has(k) || rm.get(k).dist_m > r.dist_m) rm.set(k, r); } out.roads = [...rm.values()].sort((a, b) => a.dist_m - b.dist_m).slice(0, 15);
  out.pois.sort((a, b) => a.dist_m - b.dist_m); out.pois = out.pois.slice(0, 220);
  out.parking.sort((a, b) => a.dist_m - b.dist_m); out.transit.sort((a, b) => a.dist_m - b.dist_m).slice(0, 10);
  return out;
}

// ── Sestavení podkladů pro AI ──────────────────────────────────────────────────
function buildContext({ site, d, c, ev, osm, area }) {
  const pois = LAPP.FIELDS ? (() => { try { return JSON.parse(d.pois || '[]'); } catch (e) { return []; } })() : [];
  const grp = {}; for (const p of (osm.pois || [])) { (grp[p.cat] = grp[p.cat] || []).push(p); }
  const groups = Object.entries(grp).map(([k, v]) => k + ' (' + v.length + '): ' + v.slice(0, 12).map((p) => (p.name || '—') + ' ' + p.dist_m + ' m' + (p.rooms ? ', ' + p.rooms + ' pokojů' : '') + (p.beds ? ', ' + p.beds + ' lůžek' : '')).join('; ')).join('\n');
  const roads = (osm.roads || []).map((r) => `${r.name}${r.ref ? ' [' + r.ref + ']' : ''} – třída ${r.cls}, ${r.dist_m} m od prádlomatu${r.maxspeed ? ', max ' + r.maxspeed : ''}${r.lanes ? ', pruhy ' + r.lanes : ''}`).join('\n');
  const parking = (osm.parking || []).map((p) => `${p.name || 'parkoviště'} ${p.dist_m} m${p.capacity ? ', kapacita ' + p.capacity : ''}${p.access ? ', access ' + p.access : ''}${p.fee ? ', poplatek ' + p.fee : ''}`).join('\n');
  const transit = (osm.transit || []).map((t) => `${t.name} ${t.dist_m} m`).join('; ');
  const userPois = pois.map((p) => `${p.type}: ${p.label || ''}${p.note ? ' – ' + p.note : ''}${p.type === 'road' ? ' · viditelnost: ' + (p.visible || 'neuvedena') : ''} [${p.lat},${p.lng}]`).join('\n');
  const areaTxt = area ? `Spádová oblast 15 km: ${area.total_population != null ? area.total_population.toLocaleString('cs-CZ') + ' obyvatel' : '—'}, hustota ${area.density_per_km2 || '—'}/km². Obce: ${(area.places || []).slice(0, 15).map((p) => p.name + ' ' + p.population + ' (' + p.dist_km + ' km)').join(', ')}. Kapacita oblasti (1 prádlomat / ${(area.capacity || {}).per_pradlomat || '?'} obyv.): ${(area.capacity || {}).recommended ?? '—'}. Prádlomaty v provozu v okruhu: ${(area.operating || []).map((w) => w.name + ' ' + w.dist_km + ' km').join(', ') || 'žádný'}.` : 'Spádová oblast: data nedostupná.';
  return `LOKALITA: ${d.name} – ${d.address}${d.city ? ', ' + d.city : ''}; typ zástavby: ${d.building || '—'}; souřadnice ${d.lat}, ${d.lng}; prádlomat 3×2 m otočení ${d.heading || 0}°.
PŘÍSTUPNOST: ${d.access === '247' ? '24/7' : d.access === 'limited' ? 'omezená (' + (d.access_note || 'areál se zavírá') + ')' : 'neuvedeno'}.
MÍSTO: ${d.ownership === 'own' ? 'vlastní (nájem 0)' : d.ownership === 'rent' ? 'nájem ' + (d.rent_known === 'yes' ? (d.rent || '?') + ' Kč/měs ' + (d.rent_vat === 'incl' ? 's DPH' : 'bez DPH') + (d.deposit ? ', kauce ' + d.deposit : '') + (d.notice ? ', výpověď ' + d.notice + ' měs.' : '') + (d.contract_years ? ', smlouva ' + d.contract_years + ' let' : '') : 'výše nájmu neznámá') : 'neuvedeno'}.
PŘÍPOJKY: voda ${d.conn_water || '?'}${d.conn_water_m ? ' (trasa ' + d.conn_water_m + ' m)' : ''}, odpad ${d.conn_sewer || '?'}${d.conn_sewer_m ? ' (trasa ' + d.conn_sewer_m + ' m)' : ''}, elektřina ${d.conn_power || '?'}${d.conn_power_m ? ' (trasa ' + d.conn_power_m + ' m)' : ''}, zpevněná plocha ${d.surface === 'yes' ? 'vybudovaná' : d.surface === 'no' ? 'bude se budovat' : '?'}.
INVESTICE: stroj ${d.product_name || '?'} ${d.machine_price || '?'} Kč bez DPH; doprava ${d.delivery_known === 'yes' ? d.delivery + ' Kč' : 'neznámá'}; příprava místa ${d.site_prep_known === 'yes' ? d.site_prep + ' Kč' : 'neznámá'}; financování ${d.financing === 'yes' ? 'úvěr, akontace ' + (d.down_payment || 0) + (d.down_mode === 'pct' ? ' %' : ' Kč') + ', ' + (d.interest || 9) + ' % p.a., ' + (d.months || 60) + ' měs.' : 'vlastní kapitál'}; plátce DPH: ${d.vat_payer || '?'}.
EKONOMIKA (model): tržba na praní vč. sušení ${Math.round(c.perWash)} Kč s DPH; scénáře praní/den slabý 5 / střední 8 / silný 12 → provozní výsledek měsíčně ${Math.round(c.S.weak.operating)} / ${Math.round(c.S.mid.operating)} / ${Math.round(c.S.strong.operating)} Kč, po splátce ${Math.round(c.S.weak.cash)} / ${Math.round(c.S.mid.cash)} / ${Math.round(c.S.strong.cash)} Kč; splátka ${Math.round(c.payment)} Kč/měs; bod zvratu provozu ${c.be_operating} praní/den, po splátce ${c.be_cash}.
AUTOMATICKÉ VYHODNOCENÍ: ${ev.result}. Chybí: ${ev.missing.join('; ') || '—'}. Rizika: ${ev.risks.join('; ') || '—'}.
BODY ZAKRESLENÉ ZÁKAZNÍKEM:
${userPois || '—'}
POZNÁMKY ZÁKAZNÍKA: ${d.notes || '—'}

${areaTxt}

OSM – SILNICE do 400 m:
${roads || '—'}
OSM – PARKOVIŠTĚ do 600 m:
${parking || '—'}
OSM – ZASTÁVKY do 600 m: ${transit || '—'}
OSM – BYTOVÉ DOMY do 1,5 km (budovy): ${osm.apartments}
OSM – PRŮMYSL/KOMERCE do 1,5 km: ${(osm.industrial || []).map((i) => i.type + (i.name ? ' ' + i.name : '') + ' ' + i.dist_m + ' m').join('; ') || '—'}
OSM – SLUŽBY A PODNIKY do 1,5 km (kategorie (počet): název vzdálenost):
${groups || '—'}`;
}

const SYSTEM = `Jsi analytik lokalit pro samoobslužné prádlomaty Best Series (venkovní kiosek 3×2 m, pračka 18 kg + sušička, provoz 24/7, platba kartou; praní 300 Kč, sušení 50 Kč/cyklus). Dostaneš fakta z map (OpenStreetMap) a údaje zákazníka. Sestav co nejobsáhlejší, ale poctivou studii v češtině. Každé číslo je ODHAD – vždy uveď, z čeho vychází (např. třída silnice → typická intenzita dle ŘSD/CSD 2020: dálnice 20–40 tis., silnice I. třídy 5–15 tis., II. třídy 1,5–5 tis., III. třídy 300–1 500 vozidel/den; obce; sezóna). Nevymýšlej podniky, které v datech nejsou; chybějící data označ. Segmenty zákazníků děl podle objemu praní: MALÝ (domácnosti bez pračky/sušičky, studenti, senioři, chataři, turisté, řemeslníci – pracovní oděvy), STŘEDNÍ (penziony, chalupy, apartmány, malé restaurace, kadeřnictví, masážní a kosmetické salony, fitness, mateřské školky, ordinace, autoservisy – ručníky, pracovní oděvy, ložní prádlo, typicky velké na domácí pračku) a VELKÝ (hotely, domovy seniorů, nemocnice, velké restaurace – pro průmyslovou prádelnu, pro prádlomat jen doplňkově/nouzově). Ceny přípojek odhaduj v Kč bez DPH podle délky trasy (voda cca 2–4 tis. Kč/m vč. výkopu, kanalizace 3–6 tis. Kč/m, elektro NN 1,5–3 tis. Kč/m + jistič/rozvaděč 20–40 tis., zpevněná plocha 3×2 m vč. podkladu 25–60 tis.) a uveď rozpětí. Dopravu kiosku odhaduj podle vzdálenosti z Brna (výroba) – jeřáb/hydraulická ruka + doprava, typicky 15–45 tis. Kč bez DPH v ČR. Doporučený nájem odvoď z odhadované tržby (zdravý nájem 5–12 % tržby bez DPH) a místních cen. Odpovídej POUZE validním JSON bez komentářů.`;

function schemaHint() {
  return `{
 "summary": "3–5 vět celkového shrnutí",
 "verdict": {"label": "Vhodné podle dostupných podkladů | Vhodné při splnění podmínek | Nevhodné podle dostupných podkladů | Nedostatek údajů pro posouzení", "reason": "..."},
 "catchment": {"population_15km": number|null, "comment": "...", "nearest_competition": "..."},
 "traffic": {"roads": [{"name": "...", "class": "...", "est_vehicles_per_day": [min,max], "visibility": "ano|částečně|ne|neuvedeno", "est_views_per_day": [min,max], "basis": "..."}], "pedestrians_per_day": [min,max], "pedestrians_basis": "...", "comment": "..."},
 "segments": [{"segment": "název", "size": "MALÝ|STŘEDNÍ|VELKÝ", "examples": ["názvy z dat"], "count_in_data": number, "fit": "vysoká|střední|nízká", "est_customers_per_week": [min,max], "how_to_reach": "..."}],
 "user_points": [{"label": "název bodu zákazníka", "type": "...", "assessment": "...", "expected_load": "vysoká|střední|nízká", "reason": "..."}],
 "parking": {"assessment": "...", "capacity_note": "...", "recommendation": "..."},
 "demand": {"customers_per_day": {"weak": n, "mid": n, "strong": n}, "washes_per_day": {"weak": n, "mid": n, "strong": n}, "monthly_revenue_czk_incl_vat": {"weak": n, "mid": n, "strong": n}, "seasonality": "...", "reasoning": "..."},
 "costs": {"connections": {"water_czk": [min,max]|null, "sewer_czk": [min,max]|null, "power_czk": [min,max]|null, "surface_czk": [min,max]|null, "total_czk": [min,max], "assumptions": "..."}, "delivery_czk": [min,max], "delivery_assumptions": "..."},
 "rent": {"recommended_monthly_czk": n, "range_czk": [min,max], "max_viable_czk": n, "reasoning": "..."},
 "risks": ["..."],
 "recommendations": ["..."],
 "data_gaps": ["..."]
}`;
}

async function runStudy({ site, d, c, ev, area, model }) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('Chybí ANTHROPIC_API_KEY');
  if (!d.lat || !d.lng) throw new Error('Lokalita nemá umístění na mapě.');
  let osm; try { osm = await gatherOsm(+d.lat, +d.lng); } catch (e) { osm = { pois: [], roads: [], parking: [], transit: [], apartments: 0, industrial: [], error: e.message }; }
  const context = buildContext({ site, d, c, ev, osm, area });
  const body = { model: model || process.env.BS2_STUDY_MODEL || 'claude-sonnet-4-6', max_tokens: 7000, temperature: 0.3, system: SYSTEM,
    messages: [{ role: 'user', content: 'PODKLADY:\n' + context + '\n\nVrať studii přesně v tomto JSON schématu (čísla jako čísla, rozpětí jako [min,max]):\n' + schemaHint() }] };
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Claude ' + r.status + ': ' + ((j.error && j.error.message) || 'chyba'));
  const text = (j.content || []).map((x) => x.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('AI nevrátila JSON');
  let study; try { study = JSON.parse(m[0]); } catch (e) { throw new Error('AI vrátila neplatný JSON'); }
  study._meta = { at: new Date().toISOString(), model: body.model, osm_counts: { pois: osm.pois.length, roads: osm.roads.length, parking: osm.parking.length, transit: osm.transit.length, apartments: osm.apartments }, osm_error: osm.error || null, usage: j.usage || null };
  study._facts = { roads: osm.roads, parking: osm.parking, transit: osm.transit, pois: osm.pois.slice(0, 120), apartments: osm.apartments, industrial: osm.industrial, area: area ? { total_population: area.total_population, density: area.density_per_km2, capacity: area.capacity, operating: area.operating, places: (area.places || []).slice(0, 15) } : null };
  return study;
}

// ── Render studie ──────────────────────────────────────────────────────────────
const kc = (n) => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('cs-CZ') + ' Kč';
const rng = (a, unit) => Array.isArray(a) ? Math.round(a[0]).toLocaleString('cs-CZ') + '–' + Math.round(a[1]).toLocaleString('cs-CZ') + (unit ? ' ' + unit : '') : (a == null ? '—' : String(a));
const li = (arr) => (Array.isArray(arr) && arr.length) ? '<ul style="margin:0;padding-left:18px;color:var(--text2);display:flex;flex-direction:column;gap:5px">' + arr.map((t) => '<li>' + esc(String(t)) + '</li>').join('') + '</ul>' : '<p class="small muted" style="margin:0">—</p>';
const CLS = { 'Vhodné podle dostupných podkladů': 'ok', 'Vhodné při splnění podmínek': 'cond', 'Nevhodné podle dostupných podkladů': 'bad', 'Nedostatek údajů pro posouzení': 'na' };

function studyPage(s, site, st, nav) {
  const v = st.verdict || {}; const t = st.traffic || {}; const dem = st.demand || {}; const co = st.costs || {}; const cn = co.connections || {}; const rent = st.rent || {}; const pk = st.parking || {};
  const meta = st._meta || {}; const f = st._facts || {};
  const sizeBadge = (z) => `<span class="badge ${z === 'VELKÝ' ? 'blocked' : z === 'STŘEDNÍ' ? 'active' : 'invited'}">${esc(z || '')}</span>`;
  const loadBadge = (z) => `<span class="badge ${z === 'vysoká' ? 'active' : z === 'střední' ? 'invited' : 'blocked'}">${esc(z || '')}</span>`;
  const body = `
  <style>.st h2{margin:0 0 10px} .st .card{margin-bottom:12px} .st table{font-size:13.5px} .st th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)} .st .big{font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums} .st .k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)}
  .res{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:6px 14px;font-weight:700;font-size:14px;border:1px solid} .res.ok{color:var(--ok);border-color:rgba(47,227,160,.5);background:rgba(47,227,160,.1)} .res.cond{color:#ffd866;border-color:rgba(245,180,0,.5);background:rgba(245,180,0,.1)} .res.bad{color:var(--err);border-color:rgba(255,93,108,.5);background:rgba(255,93,108,.1)} .res.na{color:var(--text2);border-color:var(--border2)}
  @media print{header,.tabs,.banner,.glow,.gridfx,#net,.helpbtn,.no-print{display:none!important}body{background:#fff!important;color:#000!important}.card{background:#fff!important;border:1px solid #ccc!important;box-shadow:none!important;color:#000}.muted,.st .k,.st th{color:#333!important}}</style>
  <div class="st">
  <div class="row no-print" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><div class="row"><a class="btn sec sm" href="/lokalita">← Moje lokality</a><a class="btn sec sm" href="/lokalita/${site.id}/report">Report</a></div><div class="row"><form method="post" action="/lokalita/${site.id}/studie" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Zpracovávám… (až 2 min)'"><button class="btn sec sm" type="submit">🔄 Aktualizovat studii</button></form><button class="btn sm" type="button" onclick="window.print()">Uložit jako PDF / tisk</button></div></div>
  <div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><div class="small muted">AI studie lokality · ${meta.at ? new Date(meta.at).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) : ''} · ${esc(meta.model || '')}</div><h1 style="margin:2px 0 4px">${esc(site.name)}</h1><div class="muted">${esc(site.address || '')}${site.city ? ', ' + esc(site.city) : ''}</div></div>${v.label ? `<span class="res ${CLS[v.label] || 'na'}">${esc(v.label)}</span>` : ''}</div>
    <p style="margin:12px 0 4px">${esc(st.summary || '')}</p>${v.reason ? `<p class="small muted" style="margin:0">${esc(v.reason)}</p>` : ''}
    <p class="small muted" style="margin:10px 0 0">Všechna čísla jsou odhady sestavené AI z dat OpenStreetMap, spádové oblasti a vašich údajů. U každého je uveden základ odhadu. Nejde o odborné schválení investice.</p></div>

  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
    <div class="stat"><div class="l">Spádová oblast 15 km</div><div class="v">${(st.catchment && st.catchment.population_15km != null) ? Number(st.catchment.population_15km).toLocaleString('cs-CZ') : '—'}</div><div class="small muted">obyvatel</div></div>
    <div class="stat"><div class="l">Chodci / den</div><div class="v">${rng(t.pedestrians_per_day)}</div><div class="small muted">odhad</div></div>
    <div class="stat"><div class="l">Zákazníci / den (střední)</div><div class="v">${dem.customers_per_day ? dem.customers_per_day.mid : '—'}</div><div class="small muted">slabý ${dem.customers_per_day ? dem.customers_per_day.weak : '—'} · silný ${dem.customers_per_day ? dem.customers_per_day.strong : '—'}</div></div>
    <div class="stat"><div class="l">Doporučený nájem</div><div class="v">${kc(rent.recommended_monthly_czk)}</div><div class="small muted">${rng(rent.range_czk, 'Kč')} · max ${kc(rent.max_viable_czk)}</div></div>
  </div>

  <div class="card"><h2>Spádová oblast a konkurence</h2><p style="margin:0;color:var(--text2)">${esc((st.catchment || {}).comment || '')}</p>${(st.catchment || {}).nearest_competition ? `<p class="small" style="margin:8px 0 0"><b>Konkurence:</b> ${esc(st.catchment.nearest_competition)}</p>` : ''}
    ${f.area && f.area.places ? `<div class="small muted" style="margin-top:8px">Obce v okruhu: ${f.area.places.map((p) => esc(p.name) + ' ' + Number(p.population).toLocaleString('cs-CZ')).join(' · ')}</div>` : ''}</div>

  <div class="card"><h2>Průtok lidí a aut – kolik lidí prádlomat uvidí</h2>
    ${(t.roads || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>Silnice</th><th>Třída</th><th>Vozidel / den</th><th>Vidět z auta</th><th>Zhlédnutí / den</th><th>Základ odhadu</th></tr></thead><tbody>${t.roads.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.class || '')}</td><td>${rng(r.est_vehicles_per_day)}</td><td>${esc(r.visibility || '')}</td><td>${rng(r.est_views_per_day)}</td><td class="small muted">${esc(r.basis || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">V datech nejsou silnice.</p>'}
    <p style="margin:10px 0 0;color:var(--text2)"><b>Chodci:</b> ${rng(t.pedestrians_per_day)} / den – ${esc(t.pedestrians_basis || '')}</p><p class="small muted" style="margin:6px 0 0">${esc(t.comment || '')}</p></div>

  <div class="card"><h2>Segmenty zákazníků v okolí</h2><p class="small muted" style="margin:0 0 10px">MALÝ = objem na domácí pračku (domácnosti, turisté, řemeslníci) · STŘEDNÍ = větší než domácí pračka (penziony, salony, restaurace, fitness) · VELKÝ = objem pro průmyslovou prádelnu (hotely, domovy seniorů) – pro prádlomat jen doplňkově.</p>
    ${(st.segments || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>Segment</th><th>Objem</th><th>V datech</th><th>Příklady</th><th>Vhodnost</th><th>Zákazníků / týden</th><th>Jak oslovit</th></tr></thead><tbody>${st.segments.map((g) => `<tr><td><b>${esc(g.segment)}</b></td><td>${sizeBadge(g.size)}</td><td>${g.count_in_data != null ? g.count_in_data : '—'}</td><td class="small">${esc((g.examples || []).slice(0, 6).join(', '))}</td><td>${loadBadge(g.fit)}</td><td>${rng(g.est_customers_per_week)}</td><td class="small muted">${esc(g.how_to_reach || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">—</p>'}</div>

  <div class="card"><h2>Vaše zakreslené body – očekávaná zátěž</h2>
    ${(st.user_points || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>Bod</th><th>Typ</th><th>Zátěž</th><th>Hodnocení</th></tr></thead><tbody>${st.user_points.map((p) => `<tr><td><b>${esc(p.label || '')}</b></td><td class="small">${esc(p.type || '')}</td><td>${loadBadge(p.expected_load)}</td><td class="small">${esc(p.assessment || '')}${p.reason ? ' <span class="muted">– ' + esc(p.reason) + '</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Žádné body.</p>'}
    <h3 style="margin:14px 0 4px;font-size:14px">Parkování</h3><p style="margin:0;color:var(--text2)">${esc(pk.assessment || '')}${pk.capacity_note ? ' ' + esc(pk.capacity_note) : ''}</p>${pk.recommendation ? `<p class="small" style="margin:6px 0 0"><b>Doporučení:</b> ${esc(pk.recommendation)}</p>` : ''}
    ${(f.parking || []).length ? `<div class="small muted" style="margin-top:6px">Parkoviště v OSM do 600 m: ${f.parking.map((p) => esc(p.name || 'parkoviště') + ' ' + p.dist_m + ' m' + (p.capacity ? ' (' + p.capacity + ' míst)' : '')).join(' · ')}</div>` : ''}</div>

  <div class="card"><h2>Odhad poptávky</h2>
    <div class="tbl-wrap"><table><thead><tr><th></th><th>Slabý</th><th>Střední</th><th>Silný</th></tr></thead><tbody>
      <tr><td>Zákazníků / den</td><td>${(dem.customers_per_day || {}).weak ?? '—'}</td><td><b>${(dem.customers_per_day || {}).mid ?? '—'}</b></td><td>${(dem.customers_per_day || {}).strong ?? '—'}</td></tr>
      <tr><td>Praní / den</td><td>${(dem.washes_per_day || {}).weak ?? '—'}</td><td><b>${(dem.washes_per_day || {}).mid ?? '—'}</b></td><td>${(dem.washes_per_day || {}).strong ?? '—'}</td></tr>
      <tr><td>Tržba / měsíc s DPH</td><td>${kc((dem.monthly_revenue_czk_incl_vat || {}).weak)}</td><td><b>${kc((dem.monthly_revenue_czk_incl_vat || {}).mid)}</b></td><td>${kc((dem.monthly_revenue_czk_incl_vat || {}).strong)}</td></tr></tbody></table></div>
    <p class="small" style="margin:8px 0 0;color:var(--text2)"><b>Sezónnost:</b> ${esc(dem.seasonality || '—')}</p><p class="small muted" style="margin:6px 0 0">${esc(dem.reasoning || '')}</p>
    <p class="small no-print" style="margin:10px 0 0"><a class="btn sec sm" href="/lokalita/${site.id}?ai=1">Použít odhad AI jako scénáře v kalkulaci</a></p></div>

  <div class="card"><h2>Odhad nákladů – přípojky a doprava</h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div class="stat"><div class="l">Voda</div><div class="v" style="font-size:18px">${cn.water_czk ? rng(cn.water_czk, 'Kč') : 'vybudována / —'}</div></div>
      <div class="stat"><div class="l">Odpad</div><div class="v" style="font-size:18px">${cn.sewer_czk ? rng(cn.sewer_czk, 'Kč') : 'vybudován / —'}</div></div>
      <div class="stat"><div class="l">Elektřina</div><div class="v" style="font-size:18px">${cn.power_czk ? rng(cn.power_czk, 'Kč') : 'vybudována / —'}</div></div>
      <div class="stat"><div class="l">Zpevněná plocha</div><div class="v" style="font-size:18px">${cn.surface_czk ? rng(cn.surface_czk, 'Kč') : 'vybudována / —'}</div></div>
      <div class="stat"><div class="l">Přípojky celkem</div><div class="v" style="font-size:18px">${rng(cn.total_czk, 'Kč')}</div></div>
      <div class="stat"><div class="l">Doprava a usazení</div><div class="v" style="font-size:18px">${rng(co.delivery_czk, 'Kč')}</div></div></div>
    <p class="small muted" style="margin:8px 0 0">Přípojky: ${esc(cn.assumptions || '')}</p><p class="small muted" style="margin:4px 0 0">Doprava: ${esc(co.delivery_assumptions || '')}</p><p class="small muted" style="margin:4px 0 0">Ceny bez DPH, orientační – přesnou cenu stanoví Best Series po místním šetření.</p></div>

  <div class="card"><h2>Doporučená výše nájmu</h2><div class="row" style="gap:18px;flex-wrap:wrap"><div><div class="k">Doporučeno</div><div class="big">${kc(rent.recommended_monthly_czk)}<span class="small muted" style="font-weight:500"> /měs</span></div></div><div><div class="k">Rozpětí</div><div class="big" style="font-size:20px">${rng(rent.range_czk, 'Kč')}</div></div><div><div class="k">Maximum, při kterém to ještě dává smysl</div><div class="big" style="font-size:20px">${kc(rent.max_viable_czk)}</div></div></div><p class="small muted" style="margin:8px 0 0">${esc(rent.reasoning || '')}</p></div>

  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card" style="margin:0"><h2 style="font-size:15px">Hlavní rizika</h2>${li(st.risks)}</div>
    <div class="card" style="margin:0"><h2 style="font-size:15px">Doporučení</h2>${li(st.recommendations)}</div>
    <div class="card" style="margin:0"><h2 style="font-size:15px">Chybějící data</h2>${li(st.data_gaps)}</div></div>

  <details class="card" style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Podklady z map (${(meta.osm_counts || {}).pois || 0} služeb, ${(meta.osm_counts || {}).roads || 0} silnic, ${(meta.osm_counts || {}).parking || 0} parkovišť)${meta.osm_error ? ' – ⚠ OSM data se nepodařilo načíst' : ''}</summary>
    <div class="small muted" style="margin-top:10px">${(f.pois || []).map((p) => esc((p.name || '—') + ' (' + p.cat + ', ' + p.dist_m + ' m)')).join(' · ')}</div></details>
  </div>`;
  return layout({ title: 'AI studie – ' + (site.name || ''), user: s.nick, nav, active: 'loc', fx: true, help: null, body });
}

module.exports = { runStudy, studyPage, gatherOsm };
