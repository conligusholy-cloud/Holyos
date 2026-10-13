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
  // Širší okruh 5 km jen pro ubytování / rekreaci (chalupy, penziony, kempy) – klíčová cílovka v horách
  let j5 = { elements: [] };
  try { j5 = await overpass(`[out:json][timeout:30];(nwr(around:5000,${lat},${lng})["tourism"~"^(hotel|guest_house|hostel|chalet|apartment|camp_site|caravan_site|motel|alpine_hut)$"];nwr(around:5000,${lat},${lng})["leisure"~"^(ski_resort|golf_course|water_park)$"];nwr(around:5000,${lat},${lng})["piste:type"];nwr(around:5000,${lat},${lng})["aerialway"];);out center tags;`, 30000); } catch (e) { /* bez širšího okruhu */ }
  const out = { pois: [], roads: [], parking: [], transit: [], apartments: 0, industrial: [], tourism5: [] };
  const seen5 = new Set();
  for (const e of (j5.elements || [])) { const t = e.tags || {}; const c = e.center || e; if (c.lat == null) continue; const d = distM(lat, lng, c.lat, c.lon); const cat = t.tourism ? 'tourism:' + t.tourism : t.leisure ? 'leisure:' + t.leisure : t['piste:type'] ? 'ski:' + t['piste:type'] : t.aerialway ? 'aerialway:' + t.aerialway : 'x'; const k = cat + '|' + (t.name || '') + '|' + Math.round(d / 50); if (seen5.has(k)) continue; seen5.add(k); out.tourism5.push({ name: t.name || null, cat, dist_m: d, rooms: t.rooms ? Number(t.rooms) : null, beds: t.beds ? Number(t.beds) : null }); }
  out.tourism5.sort((a, b) => a.dist_m - b.dist_m); out.tourism5 = out.tourism5.slice(0, 150);
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
  const userPois = pois.map((p) => { const dm = (d.lat && d.lng && p.lat && p.lng) ? distM(+d.lat, +d.lng, +p.lat, +p.lng) : null; return `${p.type}: ${p.label || ''}${p.note ? ' – ' + p.note : ''}${p.type === 'road' ? ' · viditelnost: ' + (p.visible || 'neuvedena') : ''} · VZDÁLENOST OD PRÁDLOMATU ${dm != null ? dm + ' m' : '?'} (spočteno z nákresu zákazníka)`; }).join('\n');
  const areaTxt = area ? `Spádová oblast 15 km: ${area.total_population != null ? area.total_population.toLocaleString('cs-CZ') + ' obyvatel' : '—'}, hustota ${area.density_per_km2 || '—'}/km². Obce: ${(area.places || []).slice(0, 15).map((p) => p.name + ' ' + p.population + ' (' + p.dist_km + ' km)').join(', ')}. Kapacita oblasti (1 prádlomat / ${(area.capacity || {}).per_pradlomat || '?'} obyv.): ${(area.capacity || {}).recommended ?? '—'}. Prádlomaty v provozu v okruhu: ${(area.operating || []).map((w) => w.name + ' ' + w.dist_km + ' km').join(', ') || 'žádný'}.` : 'Spádová oblast: data nedostupná.';
  return `LOKALITA: ${d.name} – ${d.address}${d.city ? ', ' + d.city : ''}; typ zástavby: ${d.building || '—'}; souřadnice ${d.lat}, ${d.lng}; prádlomat 3×2 m otočení ${d.heading || 0}°.
PŘÍSTUPNOST: ${d.access === '247' ? '24/7' : d.access === 'limited' ? 'omezená (' + (d.access_note || 'areál se zavírá') + ')' : 'neuvedeno'}.
MÍSTO: ${d.ownership === 'own' ? 'vlastní (nájem 0)' : d.ownership === 'rent' ? 'nájem ' + (d.rent_known === 'yes' ? (d.rent || '?') + ' Kč/měs ' + (d.rent_vat === 'incl' ? 's DPH' : 'bez DPH') + (d.deposit ? ', kauce ' + d.deposit : '') + (d.notice ? ', výpověď ' + d.notice + ' měs.' : '') + (d.contract_years ? ', smlouva ' + d.contract_years + ' let' : '') : 'výše nájmu neznámá') : 'neuvedeno'}.
PŘÍPOJKY: voda ${d.conn_water || '?'}${d.conn_water_m ? ' (trasa ' + d.conn_water_m + ' m)' : ''}, odpad ${d.conn_sewer || '?'}${d.conn_sewer_m ? ' (trasa ' + d.conn_sewer_m + ' m)' : ''}, elektřina ${d.conn_power || '?'}${d.conn_power_m ? ' (trasa ' + d.conn_power_m + ' m)' : ''}, zpevněná plocha ${d.surface === 'yes' ? 'vybudovaná' : d.surface === 'no' ? 'bude se budovat' : '?'}.
INVESTICE: stroj ${d.product_name || '?'} ${d.machine_price || '?'} Kč bez DPH; doprava ${d.delivery_known === 'yes' ? d.delivery + ' Kč' : 'neznámá'}; příprava místa ${d.site_prep_known === 'yes' ? d.site_prep + ' Kč' : 'neznámá'}; financování ${d.financing === 'yes' ? 'úvěr, akontace ' + (d.down_payment || 0) + (d.down_mode === 'pct' ? ' %' : ' Kč') + ', ' + (d.interest || 9) + ' % p.a., ' + (d.months || 60) + ' měs.' : 'vlastní kapitál'}; plátce DPH: ${d.vat_payer || '?'}.
EKONOMIKA (model): tržba na praní vč. sušení ${Math.round(c.perWash)} Kč s DPH; scénáře zákazníků/den slabý 5 / střední 8 / silný 12 (1 zákazník = 1 praní vč. sušení) → provozní výsledek měsíčně ${Math.round(c.S.weak.operating)} / ${Math.round(c.S.mid.operating)} / ${Math.round(c.S.strong.operating)} Kč, po splátce ${Math.round(c.S.weak.cash)} / ${Math.round(c.S.mid.cash)} / ${Math.round(c.S.strong.cash)} Kč; splátka ${Math.round(c.payment)} Kč/měs; bod zvratu provozu ${c.be_operating} praní/den, po splátce ${c.be_cash}.
AUTOMATICKÉ VYHODNOCENÍ: ${ev.result}. Chybí: ${ev.missing.join('; ') || '—'}. Rizika: ${ev.risks.join('; ') || '—'}.
BODY ZAKRESLENÉ ZÁKAZNÍKEM (ověřené zákazníkem na místě – mají přednost před OSM; vzdálenosti jsou spočtené ze souřadnic nákresu a jsou závazné):
${userPois || '—'}
POZNÁMKY ZÁKAZNÍKA: ${d.notes || '—'}

${areaTxt}

OSM – SILNICE do 400 m:
${roads || '—'}
OSM – DALŠÍ PARKOVIŠTĚ do 600 m (doplňkově; nejbližší parkoviště je to, které zakreslil zákazník):
${parking || '—'}
OSM – ZASTÁVKY do 600 m: ${transit || '—'}
OSM – BYTOVÉ DOMY do 1,5 km (budovy): ${osm.apartments}
OSM – PRŮMYSL/KOMERCE do 1,5 km: ${(osm.industrial || []).map((i) => i.type + (i.name ? ' ' + i.name : '') + ' ' + i.dist_m + ' m').join('; ') || '—'}
OSM – SLUŽBY A PODNIKY do 1,5 km (kategorie (počet): název vzdálenost):
${groups || '—'}
OSM – UBYTOVÁNÍ A REKREACE do 5 km (${(osm.tourism5 || []).length} objektů; chalupy/apartmány/penziony/kempy/sjezdovky): ${(osm.tourism5 || []).slice(0, 60).map((p) => (p.name || p.cat) + ' ' + Math.round(p.dist_m / 100) / 10 + ' km').join('; ') || '—'}
POZN.: OSM podchytí jen část rekreačních chalup (soukromé chalupy bez tagu nejsou vidět) – v horských obcích počítej s výrazně vyšším reálným počtem.`;
}

const SYSTEM = `Jsi analytik lokalit pro samoobslužné prádlomaty Best Series (venkovní kiosek 3×2 m, pračka 18 kg + sušička, provoz 24/7, platba kartou; praní 300 Kč, praní s aviváží 350 Kč, sušení 50 Kč/cyklus). Dostaneš fakta z map (OpenStreetMap) a údaje zákazníka. Sestav co nejobsáhlejší, ale poctivou studii v češtině. Každé číslo je ODHAD – vždy uveď, z čeho vychází (např. třída silnice → typická intenzita dle ŘSD/CSD 2020: dálnice 20–40 tis., silnice I. třídy 5–15 tis., II. třídy 1,5–5 tis., III. třídy 300–1 500 vozidel/den; obce; sezóna). Nevymýšlej podniky, které v datech nejsou; chybějící data označ. Body zakreslené zákazníkem jsou ověřené na místě – u nich VŽDY použij uvedenou vzdálenost z nákresu (ne vzdálenosti z OSM) a hodnoť je jako primární; OSM je jen doplněk. Segmenty zákazníků děl podle objemu praní: MALÝ (domácnosti bez pračky/sušičky, studenti, senioři, chataři, turisté, řemeslníci – pracovní oděvy), STŘEDNÍ (penziony, chalupy, apartmány, malé restaurace, kadeřnictví, masážní a kosmetické salony, fitness, mateřské školky, ordinace, autoservisy – ručníky, pracovní oděvy, ložní prádlo, typicky velké na domácí pračku) a VELKÝ (hotely, domovy seniorů, nemocnice, velké restaurace – pro průmyslovou prádelnu, pro prádlomat jen doplňkově/nouzově). Ceny přípojek odhaduj v Kč bez DPH podle délky trasy (voda cca 2–4 tis. Kč/m vč. výkopu, kanalizace 3–6 tis. Kč/m, elektro NN 1,5–3 tis. Kč/m + jistič/rozvaděč 20–40 tis., zpevněná plocha 3×2 m vč. podkladu 25–60 tis.) a uveď rozpětí. Dopravu kiosku odhaduj podle vzdálenosti z Brna (výroba) – jeřáb/hydraulická ruka + doprava, typicky 15–45 tis. Kč bez DPH v ČR. Doporučený nájem odvoď z odhadované tržby (zdravý nájem 5–12 % tržby bez DPH) a místních cen. Pokud zákazník nájem už zná, nedoporučuj jinou částku – POSUĎ jeho nájem (přiměřený / vysoký / nízký vůči tržbě, co vyjednat). Pokud je místo vlastní, nájem neřeš a NIKDE neuváděj nájem jako chybějící údaj ani riziko (je známý: 0 Kč). 
VERDIKT: u 'Vhodné při splnění podmínek' vždy vyjmenuj v conditions 2–6 KONKRÉTNÍCH, ověřitelných podmínek (co, kdo, jak ověřit – např. 'Ověřit minimálně 3 zákazníky/den: 2 týdny testovacího provozu' nebo 'Získat souhlas majitele parkoviště s označením 1 místa'); scorecard vyplň pro všech 6 oblastí.\nKALIBRACE Z PRAXE BEST SERIES (má přednost před teoretickými odhady): (1) Lidé jezdí prát do VĚTŠÍCH měst, ne do malých obcí – u obce do ~1 500 obyvatel počítej s reálnou spádovostí jen 3–5 km a přednostně s vlastními obyvateli obce; počet obyvatel v 15 km je u malé obce slabý signál (uveď ho, ale nestav na něm poptávku). (2) Zkušenost z provozu: prádlomat v malé obci na venkově mívá typicky 2–4 zákazníky za den (slabý scénář 1–2, silný 4–6), v okresním městě u supermarketu 8–15. Odhady drž v těchto pásmech, pokud data neukazují jasný důvod pro víc. (3) V horských a rekreačních oblastech jsou zásadní cílovou skupinou CHALUPÁŘI a chalupy/apartmány na pronájem (výměna ložního prádla mezi turnusy, prádlo po víkendu) – uveď je jako samostatný segment s vlastním odhadem, s výraznou sezónností (víkendy, prázdniny, zimní sezóna), i když je OSM nepodchytí kompletně. (4) Penziony a restaurace jsou dobrý STŘEDNÍ segment jen pokud nemají vlastní prádelnu – uveď to jako podmínku. (5) Buď raději konzervativní; rozpětí uváděj poctivě. Odpovídej POUZE validním JSON bez komentářů.`;

function schemaHint() {
  return `{
 "summary": "3–5 vět celkového shrnutí",
 "verdict": {"label": "Vhodné podle dostupných podkladů | Vhodné při splnění podmínek | Nevhodné podle dostupných podkladů | Nedostatek údajů pro posouzení", "reason": "...", "conditions": ["konkrétní podmínka, která musí být splněna (jen při 'Vhodné při splnění podmínek' / 'Nedostatek údajů'; jinak [])"], "scorecard": [{"area": "Poptávka a spádovost|Viditelnost a průtok|Dostupnost a parkování|Přípojky a místo|Ekonomika a financování|Smlouva a nájem", "rating": "dobré|podmíněné|slabé|neznámé", "note": "1 věta"}]},
 "catchment": {"population_15km": number|null, "comment": "...", "nearest_competition": "..."},
 "traffic": {"roads": [{"name": "...", "class": "...", "est_vehicles_per_day": [min,max], "visibility": "ano|částečně|ne|neuvedeno", "est_views_per_day": [min,max], "basis": "..."}], "pedestrians_per_day": [min,max], "pedestrians_basis": "...", "comment": "..."},
 "segments": [{"segment": "název (vždy zahrň: Obyvatelé obce; Chalupáři a rekreační objekty; Chalupy a apartmány na pronájem; Penziony a hotely; Restaurace a služby; Projíždějící po hlavní silnici; další dle dat)", "size": "MALÝ|STŘEDNÍ|VELKÝ", "examples": ["názvy z dat"], "count_in_data": number, "fit": "vysoká|střední|nízká", "est_customers_per_week": [min,max], "how_to_reach": "..."}],
 "user_points": [{"label": "název bodu zákazníka", "type": "...", "assessment": "...", "expected_load": "vysoká|střední|nízká", "reason": "..."}],
 "parking": {"assessment": "...", "capacity_note": "...", "recommendation": "..."},
 "demand": {"customers_per_day": {"weak": n, "mid": n, "strong": n}, "washes_per_day": {"weak": n, "mid": n, "strong": n}, "monthly_revenue_czk_incl_vat": {"weak": n, "mid": n, "strong": n}, "seasonality": "...", "reasoning": "..."},
 "costs": {"connections": {"water_czk": [min,max]|null, "sewer_czk": [min,max]|null, "power_czk": [min,max]|null, "surface_czk": [min,max]|null, "total_czk": [min,max], "assumptions": "..."}, "delivery_czk": [min,max], "delivery_assumptions": "..."},
 "rent": {"recommended_monthly_czk": n, "range_czk": [min,max], "max_viable_czk": n, "reasoning": "...", "assessment": "pokud zákazník nájem ZNÁ: posuď, zda je přiměřený/vysoký vůči odhadované tržbě a co vyjednat; pokud je místo vlastní: null"},
 "risks": ["..."],
 "recommendations": ["..."],
 "data_gaps": ["..."]
}`;
}

async function runStudy({ site, d, c, ev, area, model }) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('Chybí ANTHROPIC_API_KEY');
  if (!d.lat || !d.lng) throw new Error('Lokalita nemá umístění na mapě.');
  let osm; try { osm = await gatherOsm(+d.lat, +d.lng); } catch (e) { osm = { pois: [], roads: [], parking: [], transit: [], apartments: 0, industrial: [], error: e.message }; }
  const context = buildContext({ site, d, c, ev, osm, area }) + (osm.error ? '\n\nPOZOR: mapová data (OSM) se nepodařilo načíst (' + osm.error + ') – vycházej z údajů zákazníka a spádové oblasti; nevymýšlej podniky.' : '');
  const modelName = model || process.env.BS2_STUDY_MODEL || 'claude-sonnet-4-6';
  async function ask(extra, maxTokens) {
    const body = { model: modelName, max_tokens: maxTokens, temperature: 0.3, system: SYSTEM,
      messages: [{ role: 'user', content: 'PODKLADY:\n' + context + '\n\nVrať studii přesně v tomto JSON schématu (čísla jako čísla, rozpětí jako [min,max]). Texty drž stručné (každé pole max. 2–3 věty), žádné trailing čárky, žádný text mimo JSON.' + (extra || '') + '\n' + schemaHint() + '\n\nOdpověď začni znakem { a ukonči znakem }.' }] };
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Claude ' + r.status + ': ' + ((j.error && j.error.message) || 'chyba'));
    return { text: (j.content || []).map((x) => x.text || '').join(''), stop: j.stop_reason, usage: j.usage };
  }
  function parseJson(text) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b < 0) return null;
    let t = text.slice(a, b + 1);
    try { return JSON.parse(t); } catch (e) { /* oprava běžných chyb */ }
    t = t.replace(/```json|```/g, '').replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001f]+/g, ' ');
    try { return JSON.parse(t); } catch (e) { return null; }
  }
  let out = await ask('', 12000); let study = parseJson(out.text);
  if (!study) {
    console.warn('[bs2] studie: neplatný JSON (stop=' + out.stop + '), zkouším znovu stručněji; začátek: ' + out.text.slice(0, 300).replace(/\s+/g, ' '));
    out = await ask(' DŮLEŽITÉ: předchozí odpověď nebyla validní JSON – odpověz výrazně stručněji (max. 6 segmentů, max. 5 položek v seznamech) a zkontroluj uzavření všech závorek.', 12000);
    study = parseJson(out.text);
  }
  if (!study) throw new Error('AI vrátila neplatný JSON (' + (out.stop === 'max_tokens' ? 'odpověď byla příliš dlouhá' : 'chyba formátu') + ')');
  const j = { usage: out.usage };
  study._meta = { at: new Date().toISOString(), model: modelName, osm_counts: { pois: osm.pois.length, roads: osm.roads.length, parking: osm.parking.length, transit: osm.transit.length, apartments: osm.apartments }, osm_error: osm.error || null, usage: j.usage || null };
  study._facts = { roads: osm.roads, parking: osm.parking, transit: osm.transit, pois: osm.pois.slice(0, 120), apartments: osm.apartments, industrial: osm.industrial, area: area ? { total_population: area.total_population, density: area.density_per_km2, capacity: area.capacity, operating: area.operating, places: (area.places || []).slice(0, 60).map((p) => ({ name: p.name, population: p.population, dist_km: p.dist_km, lat: p.lat, lon: p.lon })), center: area.center ? { lat: area.center.lat, lon: area.center.lon } : null, radius_km: area.radius_km || 15 } : null, site: { lat: +d.lat, lng: +d.lng } };
  return study;
}

// ── Render studie ──────────────────────────────────────────────────────────────
const kc = (n) => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('cs-CZ') + ' Kč';
const rng = (a, unit) => Array.isArray(a) ? Math.round(a[0]).toLocaleString('cs-CZ') + '–' + Math.round(a[1]).toLocaleString('cs-CZ') + (unit ? ' ' + unit : '') : (a == null ? '—' : String(a));
const lo = (a, unit) => Array.isArray(a) ? 'od ' + Math.round(a[0]).toLocaleString('cs-CZ') + (unit ? ' ' + unit : '') : (a == null ? '—' : String(a));
const li = (arr) => (Array.isArray(arr) && arr.length) ? '<ul style="margin:0;padding-left:18px;color:var(--text2);display:flex;flex-direction:column;gap:5px">' + arr.map((t) => '<li>' + esc(String(t)) + '</li>').join('') + '</ul>' : '<p class="small muted" style="margin:0">—</p>';
const CLS = { 'Vhodné podle dostupných podkladů': 'ok', 'Vhodné při splnění podmínek': 'cond', 'Nevhodné podle dostupných podkladů': 'bad', 'Nedostatek údajů pro posouzení': 'na' };

function studyBody(s, site, st, nav, R, siteCoords, d) {
  d = d || {};
  const own = d.ownership === 'own', rentKnown = d.ownership === 'rent' && d.rent_known === 'yes' && Number(String(d.rent || '').replace(/\s/g, '')) > 0, rentVal = Number(String(d.rent || '').replace(/\s/g, ''));
  R = R || { map: '', scenarios: '', facts: '' };
  if (siteCoords && siteCoords.lat) { st._facts = st._facts || {}; st._facts.site = siteCoords; }
  const v = st.verdict || {}; const t = st.traffic || {}; const dem = st.demand || {}; const co = st.costs || {}; const cn = co.connections || {}; const rent = st.rent || {}; const pk = st.parking || {};
  const meta = st._meta || {}; const f = st._facts || {};
  const sizeBadge = (z) => `<span class="badge ${z === 'VELKÝ' ? 'blocked' : z === 'STŘEDNÍ' ? 'active' : 'invited'}">${esc(z || '')}</span>`;
  const loadBadge = (z) => `<span class="badge ${z === 'vysoká' ? 'active' : z === 'střední' ? 'invited' : 'blocked'}">${esc(z || '')}</span>`;
  const body = `
  <style>.rep h4{margin:16px 0 6px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent2)} .rep ul{margin:0;padding-left:18px;color:var(--text2);font-size:14px} .rep .warn li{color:#ffd9a0} .rep .miss li{color:#ffd866} .lk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px} .sc{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px} .sc .c{background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:12px 14px} .sc .c.hi{border-color:rgba(79,209,255,.45)} .sc .k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)} .sc .v{font-size:20px;font-weight:800;letter-spacing:-.02em;margin:2px 0 6px;font-variant-numeric:tabular-nums} .sc .pos{color:var(--ok)} .sc .neg{color:var(--err)} .cas{display:flex;flex-direction:column;gap:5px} .cas div{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;padding:6px 10px;border-radius:8px;background:rgba(4,8,16,.5);border:1px solid var(--border)} .cas div span{color:var(--text2)} .cas div.t{border-color:rgba(79,209,255,.4);font-weight:700}
  .st h2{margin:0 0 10px} .st .card{margin-bottom:12px} .st table{font-size:13.5px} .st th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)} .st .big{font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums} .st .k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)}
  .res{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:6px 14px;font-weight:700;font-size:14px;border:1px solid} .res.ok{color:var(--ok);border-color:rgba(47,227,160,.5);background:rgba(47,227,160,.1)} .res.cond{color:#ffd866;border-color:rgba(245,180,0,.5);background:rgba(245,180,0,.1)} .res.bad{color:var(--err);border-color:rgba(255,93,108,.5);background:rgba(255,93,108,.1)} .res.na{color:var(--text2);border-color:var(--border2)}
  @media print{.no-print{display:none!important}}</style>
  <div class="st">
  <div class="row no-print" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><div class="row"><a class="btn sec sm" href="/lokalita">← Moje lokality</a><a class="btn sec sm" href="/lokalita/${site.id}">Upravit údaje</a></div><div class="row"><form method="post" action="/lokalita/${site.id}/studie" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Zpracovávám… (až 2 min)'"><button class="btn sec sm" type="submit">🔄 Aktualizovat studii</button></form><a class="btn sm" href="/lokalita/${site.id}/studie/tisk" target="_blank">Uložit jako PDF / tisk</a></div></div>
  <div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><div class="small muted">Studie lokality · ${meta.at ? new Date(meta.at).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) : ''}</div><h1 style="margin:2px 0 4px">${esc(site.name)}</h1><div class="muted">${esc(site.address || '')}${site.city ? ', ' + esc(site.city) : ''}</div></div>${v.label ? `<span class="res ${CLS[v.label] || 'na'}">${esc(v.label)}</span>` : ''}</div>
    <p style="margin:12px 0 4px">${esc(st.summary || '')}</p>${v.reason ? `<p class="small muted" style="margin:0">${esc(v.reason)}</p>` : ''}
    ${(v.scorecard || []).length ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-top:14px">${v.scorecard.map((x) => { const r = String(x.rating || ''); const col = r === 'dobré' ? 'var(--ok)' : r === 'podmíněné' ? '#ffd866' : r === 'slabé' ? 'var(--err)' : 'var(--text2)'; const ic = r === 'dobré' ? '✓' : r === 'podmíněné' ? '!' : r === 'slabé' ? '✕' : '?'; return `<div class="stat" style="border-color:${col}55"><div class="l">${esc(x.area || '')}</div><div class="v" style="font-size:16px;color:${col}">${ic} ${esc(r)}</div><div class="small muted" style="margin-top:4px">${esc(x.note || '')}</div></div>`; }).join('')}</div>` : ''}
    ${(v.conditions || []).length ? `<div style="margin-top:14px;padding:12px 14px;border-radius:12px;border:1px solid rgba(245,180,0,.5);background:rgba(245,180,0,.08)"><div style="font-weight:700;color:#ffd866;margin-bottom:6px">Podmínky, které musí být splněny</div><ol style="margin:0;padding-left:20px;color:var(--text);display:flex;flex-direction:column;gap:5px">${v.conditions.map((t) => '<li>' + esc(String(t)) + '</li>').join('')}</ol></div>` : ''}
    <p class="small muted" style="margin:10px 0 0">Všechna čísla jsou odhady sestavené ze spádové oblasti, mapových podkladů a vašich údajů. U každého je uveden základ odhadu. Nejde o odborné schválení investice.</p></div>

  ${R.map}
  ${f.area ? `<div class="card" style="padding:10px"><div id="st-map" style="height:380px;border-radius:12px;overflow:hidden;z-index:0;background:#0e1e33"></div>
    <div class="row" style="gap:8px 14px;flex-wrap:wrap;margin:8px 4px 0;font-size:12px;color:var(--text2)"><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#4fd1ff;border:1px solid #fff;margin-right:5px"></i>prádlomat</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#d7301f;margin-right:5px"></i>obce podle počtu obyvatel</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#1e86e0;border:1px solid #fff;margin-right:5px"></i>prádlomaty v provozu</span><span style="color:var(--text3)">kruh = spádová oblast ${f.area.radius_km || 15} km · zdroj GeoNames</span></div>
    <script>(function(){ var A=${JSON.stringify({ site: f.site, center: f.area.center, r: f.area.radius_km || 15, places: f.area.places || [], op: (f.area.operating || []) })};
      var c=A.site&&A.site.lat?[A.site.lat,A.site.lng]:(A.center?[A.center.lat,A.center.lon]:[49.8,15.5]); var m=L.map('st-map',{scrollWheelZoom:false}).setView(c,10);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles &copy; Esri',maxZoom:19}).addTo(m);
      function col(p){return p>=50000?'#7f0000':p>=20000?'#b30000':p>=10000?'#d7301f':p>=5000?'#ef6548':p>=2000?'#fc8d59':p>=1000?'#fdbb84':p>=500?'#fdd49e':'#fee8c8';} function rad(p){return Math.max(4,Math.min(30,Math.sqrt(p)/3));}
      var ring=L.circle(c,{radius:A.r*1000,color:'#4fd1ff',weight:2,fill:true,fillColor:'#1e86e0',fillOpacity:.06,dashArray:'6 6'}).addTo(m);
      A.places.forEach(function(p){ if(p.lat==null) return; L.circleMarker([p.lat,p.lon],{radius:rad(p.population),color:'rgba(0,0,0,.35)',weight:.5,fillColor:col(p.population),fillOpacity:.8}).addTo(m).bindTooltip(p.name+': '+Number(p.population).toLocaleString('cs-CZ')+(p.dist_km!=null?' · '+p.dist_km+' km':''),{direction:'top'}); });
      A.op.forEach(function(w){ if(w.lat==null) return; L.circleMarker([w.lat,w.lon],{radius:6,color:'#fff',weight:1.5,fillColor:'#1e86e0',fillOpacity:1}).addTo(m).bindTooltip('🧺 '+w.name+' · '+w.dist_km+' km',{direction:'top'}); });
      L.circleMarker(c,{radius:7,color:'#fff',weight:2,fillColor:'#4fd1ff',fillOpacity:1}).addTo(m).bindTooltip('Prádlomat',{direction:'top',permanent:true});
      try{ m.fitBounds(ring.getBounds(),{padding:[16,16]}); }catch(e){} })();</script>
    <div class="card" style="margin:10px 0 0;padding:14px 16px;background:var(--card2)">
      <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0 0 2px;font-size:17px">🎯 Spádová oblast ${f.area.radius_km || 15} km — ${esc(site.city || site.name || '')}</h2><div class="small muted">Počet obyvatel v okruhu ${f.area.radius_km || 15} km od prádlomatu · zdroj: GeoNames</div></div><div style="text-align:right"><div class="big" style="font-size:32px;background:linear-gradient(90deg,#fff,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent">${f.area.total_population != null ? Number(f.area.total_population).toLocaleString('cs-CZ') : '—'}</div><div class="small muted">obyvatel${f.area.density != null ? ' · ' + Number(f.area.density).toLocaleString('cs-CZ') + ' /km²' : ''}</div></div></div>
      ${f.area.capacity && f.area.capacity.recommended > 0 ? `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--border2);background:rgba(30,134,224,.1)"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><b style="color:var(--accent2)">📦 Kapacita oblasti: ${f.area.capacity.recommended}× prádlomat</b><span class="small muted">1 prádlomat / ${Number(f.area.capacity.per_pradlomat || 0).toLocaleString('cs-CZ')} obyvatel</span></div>${(f.area.capacity.allocation || []).length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">${f.area.capacity.allocation.map((a) => `<span class="badge invited" style="font-weight:500"><b style="color:var(--accent2)">${a.units}×</b>&nbsp;${esc(a.name)} <span class="muted">· ${Number(a.population).toLocaleString('cs-CZ')} obyv.</span></span>`).join('')}</div>` : ''}</div>` : ''}
      ${(f.area.operating || []).length ? `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--border2);background:rgba(30,134,224,.1)"><b style="color:var(--accent2)">🧺 V tomto okruhu už ${f.area.operating.length === 1 ? 'funguje' : 'fungují'} ${f.area.operating.length} ${f.area.operating.length === 1 ? 'prádelna' : f.area.operating.length < 5 ? 'prádelny' : 'prádelen'}</b><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">${f.area.operating.map((w) => `<span class="badge invited" style="font-weight:500">● ${esc(w.name)} · ${w.dist_km} km</span>`).join('')}</div></div>` : `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid rgba(47,227,160,.4);background:rgba(47,227,160,.08);color:#a9f5d9">✓ V okruhu ${f.area.radius_km || 15} km zatím žádný prádlomat v provozu není.</div>`}
      ${(f.area.places || []).length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">${f.area.places.slice(0, 20).map((p) => `<span class="badge" style="font-weight:500;border-color:var(--border);color:var(--text2)"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.population >= 10000 ? '#d7301f' : p.population >= 5000 ? '#ef6548' : p.population >= 2000 ? '#fc8d59' : p.population >= 1000 ? '#fdbb84' : '#fdd49e'};margin-right:5px"></i>${esc(p.name)} — ${Number(p.population).toLocaleString('cs-CZ')}${p.dist_km != null ? ' · ' + p.dist_km + ' km' : ''}</span>`).join('')}</div>` : ''}
    </div></div>` : ''}
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
    <div class="stat"><div class="l">Spádová oblast 15 km</div><div class="v">${(st.catchment && st.catchment.population_15km != null) ? Number(st.catchment.population_15km).toLocaleString('cs-CZ') : '—'}</div><div class="small muted">obyvatel</div></div>
    <div class="stat"><div class="l">Chodci / den</div><div class="v">${rng(t.pedestrians_per_day)}</div><div class="small muted">odhad</div></div>
    <div class="stat"><div class="l">Zákazníci / den (střední)</div><div class="v">${dem.customers_per_day ? dem.customers_per_day.mid : '—'}</div><div class="small muted">slabý ${dem.customers_per_day ? dem.customers_per_day.weak : '—'} · silný ${dem.customers_per_day ? dem.customers_per_day.strong : '—'}</div></div>
    ${own ? `<div class="stat"><div class="l">Nájem</div><div class="v">0 Kč</div><div class="small muted">vlastní místo</div></div>` : rentKnown ? `<div class="stat"><div class="l">Váš nájem</div><div class="v">${kc(rentVal)}</div><div class="small muted">${d.rent_vat === 'incl' ? 's DPH' : 'bez DPH'} · únosné max. ${kc(rent.max_viable_czk)}</div></div>` : `<div class="stat"><div class="l">Doporučený nájem</div><div class="v">${kc(rent.recommended_monthly_czk)}</div><div class="small muted">${rng(rent.range_czk, 'Kč')} · max ${kc(rent.max_viable_czk)}</div></div>`}
  </div>

  <div class="card"><h2>Spádová oblast a konkurence</h2><p style="margin:0;color:var(--text2)">${esc((st.catchment || {}).comment || '')}</p>${(st.catchment || {}).nearest_competition ? `<p class="small" style="margin:8px 0 0"><b>Konkurence:</b> ${esc(st.catchment.nearest_competition)}</p>` : ''}
</div>

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
      <tr><td>Tržba / měsíc s DPH</td><td>${kc((dem.monthly_revenue_czk_incl_vat || {}).weak)}</td><td><b>${kc((dem.monthly_revenue_czk_incl_vat || {}).mid)}</b></td><td>${kc((dem.monthly_revenue_czk_incl_vat || {}).strong)}</td></tr></tbody></table></div>
    <p class="small" style="margin:8px 0 0;color:var(--text2)"><b>Sezónnost:</b> ${esc(dem.seasonality || '—')}</p><p class="small muted" style="margin:6px 0 0">${esc(dem.reasoning || '')}</p>
    <p class="small muted" style="margin:10px 0 0">${st._applied_washes ? 'Scénáře v ekonomické kalkulaci níže jsou nastavené podle tohoto odhadu (' + esc(st._applied_washes.weak) + ' / ' + esc(st._applied_washes.mid) + ' / ' + esc(st._applied_washes.strong) + ' zákazníků za den; 1 zákazník = 1 praní vč. sušení).' : ''}</p></div>

  ${R.scenarios}
  <div class="card"><h2>Orientační náklady – přípojky a doprava</h2>
    <div style="margin:0 0 12px;padding:10px 12px;border-radius:12px;border:1px solid rgba(245,180,0,.5);background:rgba(245,180,0,.1);color:#ffd866;font-size:13.5px">⚠ Částky níže <b>nelze brát jako relevantní nabídku</b> – jde o hrubý spodní odhad podle délek tras. Skutečnou cenu určí až <b>místní šetření a konkrétní nacenění tohoto případu</b>.</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div class="stat"><div class="l">Voda</div><div class="v" style="font-size:18px">${cn.water_czk ? lo(cn.water_czk, 'Kč') : 'vybudována'}</div></div>
      <div class="stat"><div class="l">Odpad</div><div class="v" style="font-size:18px">${cn.sewer_czk ? lo(cn.sewer_czk, 'Kč') : 'vybudován'}</div></div>
      <div class="stat"><div class="l">Elektřina</div><div class="v" style="font-size:18px">${cn.power_czk ? lo(cn.power_czk, 'Kč') : 'vybudována'}</div></div>
      <div class="stat"><div class="l">Zpevněná plocha</div><div class="v" style="font-size:18px">${cn.surface_czk ? lo(cn.surface_czk, 'Kč') : 'vybudována'}</div></div>
      <div class="stat"><div class="l">Přípojky celkem</div><div class="v" style="font-size:18px">${lo(cn.total_czk, 'Kč')}</div></div>
      <div class="stat"><div class="l">Doprava a usazení</div><div class="v" style="font-size:18px">${lo(co.delivery_czk, 'Kč')}</div></div></div>
    <p class="small muted" style="margin:8px 0 0">Ceny bez DPH. Základ odhadu – přípojky: ${esc(cn.assumptions || '')}</p><p class="small muted" style="margin:4px 0 0">Doprava: ${esc(co.delivery_assumptions || '')}</p></div>

  ${own ? '' : rentKnown ? `<div class="card"><h2>Posouzení vašeho nájmu</h2><div class="row" style="gap:18px;flex-wrap:wrap"><div><div class="k">Váš nájem</div><div class="big">${kc(rentVal)}<span class="small muted" style="font-weight:500"> /měs ${d.rent_vat === 'incl' ? 's DPH' : 'bez DPH'}</span></div></div><div><div class="k">Obvyklé rozpětí pro tuto lokalitu</div><div class="big" style="font-size:20px">${rng(rent.range_czk, 'Kč')}</div></div><div><div class="k">Maximum, při kterém to ještě dává smysl</div><div class="big" style="font-size:20px;color:${rent.max_viable_czk && rentVal > rent.max_viable_czk ? 'var(--err)' : 'var(--ok)'}">${kc(rent.max_viable_czk)}</div></div></div><p style="margin:8px 0 0;color:var(--text2)">${esc(rent.assessment || rent.reasoning || '')}</p></div>` : `<div class="card"><h2>Doporučená výše nájmu</h2><div class="row" style="gap:18px;flex-wrap:wrap"><div><div class="k">Doporučeno</div><div class="big">${kc(rent.recommended_monthly_czk)}<span class="small muted" style="font-weight:500"> /měs</span></div></div><div><div class="k">Rozpětí</div><div class="big" style="font-size:20px">${rng(rent.range_czk, 'Kč')}</div></div><div><div class="k">Maximum, při kterém to ještě dává smysl</div><div class="big" style="font-size:20px">${kc(rent.max_viable_czk)}</div></div></div><p class="small muted" style="margin:8px 0 0">${esc(rent.reasoning || '')}</p></div>`}

  <div class="card"><h2>Podklady vyhodnocení</h2><div class="rep">${R.facts}</div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card" style="margin:0"><h2 style="font-size:15px">Hlavní rizika</h2>${li(st.risks)}</div>
    <div class="card" style="margin:0"><h2 style="font-size:15px">Doporučení</h2>${li(st.recommendations)}</div>
    <div class="card" style="margin:0"><h2 style="font-size:15px">Chybějící data</h2>${li(st.data_gaps)}</div></div>

  </div>`;
  return { body, meta };
}
const LEAF = `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" crossorigin="anonymous" referrerpolicy="no-referrer"><script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;
function studyPage(s, site, st, nav, R, siteCoords, d) {
  const { body } = studyBody(s, site, st, nav, R, siteCoords, d);
  return layout({ title: 'Studie – ' + (site.name || ''), user: s.nick, nav, active: 'loc', fx: true, help: null, body }).replace('</head>', LEAF + '</head>');
}
// Tisková verze: samostatný A4 dokument ve stylu Best Series 2.0 (světlý papír, tmavá hlavička, modrý akcent), bez prvků webu.
function studyPrintPage(s, site, st, R, siteCoords, d) {
  R = Object.assign({}, R || {}, { scenarios: (R && R.scenTable) || (R && R.scenarios) || '' });
  const { body, meta } = studyBody(s, site, st, [], R, siteCoords, d);
  const dateS = meta.at ? new Date(meta.at).toLocaleDateString('cs-CZ') : '';
  const { logoSvg } = require('./logo');
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studie lokality ${esc(site.name || '')} · Best Series 2.0</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">${LEAF}
<style>
  @page{size:A4;margin:16mm 14mm 18mm}
  :root{--bg:#fff;--card:#fff;--card2:#f4f7fb;--border:#d9e1ec;--border2:#b9c7d8;--text:#111827;--text2:#3b4a5e;--text3:#6b7a90;--accent:#1e86e0;--accent2:#1668b8;--vio:#5b47c9;--ok:#0a7a4a;--err:#b3261e;--blue:#1668b8}
  *{box-sizing:border-box} html,body{margin:0;background:#fff;color:var(--text);font:11.5px/1.5 Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  body{padding:0} main{max-width:none;padding:0;margin:0}
  .toolbar{position:sticky;top:0;background:#0a1220;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center;justify-content:space-between;font-size:13px}
  .toolbar button{font:inherit;font-weight:700;background:linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff);color:#fff;border:0;border-radius:10px;padding:9px 16px;cursor:pointer}
  .doc{max-width:190mm;margin:0 auto;padding:10mm 0}
  .ph{display:flex;justify-content:space-between;align-items:center;background:#0a1220;color:#fff;border-radius:12px;padding:14px 18px;margin-bottom:14px}
  .ph .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:15px} .ph .brand span.v{color:#4fd1ff} .ph .meta{text-align:right;font-size:11px;color:#b9c7d8} .ph .meta b{display:block;color:#fff;font-size:13px}
  .pf{margin-top:14px;border-top:1px solid var(--border);padding-top:6px;font-size:9.5px;color:var(--text3);display:flex;justify-content:space-between;gap:10px}
  .card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;box-shadow:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  .stat{background:var(--card2);border:1px solid var(--border);border-radius:9px;padding:9px 11px;break-inside:avoid} .stat .v{font-size:19px;font-weight:800;letter-spacing:-.02em} .stat .l{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .badge{display:inline-block;font-size:10px;font-weight:700;border-radius:999px;padding:1px 7px;border:1px solid var(--border2);color:var(--text2);background:#fff} .badge.active{color:var(--ok);border-color:#9cd9b8} .badge.blocked{color:var(--err);border-color:#e6a8a3} .badge.invited{color:var(--blue);border-color:#bcd6f0}
  table{width:100%;border-collapse:collapse;font-size:10.5px} th,td{text-align:left;padding:5px 6px;border-top:1px solid var(--border);vertical-align:top} th{color:var(--text3);font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;border-top:0} tr{break-inside:avoid} .tbl-wrap{overflow:visible}
  .small{font-size:10.5px} .muted{color:var(--text3)}
  .st h1{font-size:22px;margin:2px 0 4px;letter-spacing:-.02em} .st h2{font-size:14px;color:var(--accent2);border-bottom:2px solid #e3ebf5;padding-bottom:4px;margin:0 0 8px;break-after:avoid} .st h3{font-size:12.5px;margin:12px 0 4px}
  .rep h4{margin:12px 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent2)} .rep ul{margin:0;padding-left:16px;color:var(--text2)} .rep .warn li{color:#7a4b00} .rep .miss li{color:#7a5a00}
  .lk-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
  .sc{display:grid;grid-template-columns:repeat(3,1fr);gap:8px} .sc .c{background:var(--card2);border:1px solid var(--border);border-radius:9px;padding:9px 11px;break-inside:avoid} .sc .c.hi{border-color:var(--accent)} .sc .k{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)} .sc .v{font-size:16px;font-weight:800;margin:2px 0 5px} .sc .pos{color:var(--ok)} .sc .neg{color:var(--err)}
  .cas{display:flex;flex-direction:column;gap:3px} .cas div{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;padding:3px 7px;border-radius:6px;background:#fff;border:1px solid var(--border)} .cas div span{color:var(--text2)} .cas div.t{border-color:var(--accent);font-weight:700}
  .res{display:inline-flex;align-items:center;border-radius:999px;padding:5px 12px;font-weight:700;font-size:12.5px;border:1.5px solid} .res.ok{color:var(--ok);border-color:var(--ok);background:#edfaf3} .res.cond{color:#8a6508;border-color:#d9a21b;background:#fff8e1} .res.bad{color:var(--err);border-color:var(--err);background:#fdecea} .res.na{color:var(--text2);border-color:var(--border2)}
  .an-big .n{font-size:26px;font-weight:800;color:var(--accent2)} .an-big .l{font-size:10px;color:var(--text3)}
  .town{display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--text2);background:var(--card2);border:1px solid var(--border);border-radius:999px;padding:2px 8px} .town .d{width:7px;height:7px;border-radius:50%;display:inline-block} .towns{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
  .an-box{margin-top:8px;padding:9px 11px;border-radius:9px;border:1px solid #bcd6f0;background:#eef5fc} .an-box.ok{border-color:#9cd9b8;background:#edfaf3;color:#0a5a36} .an-box b.t{color:var(--accent2)}
  div[style*="rgba(245,180,0"]{background:#fff8e1!important;border-color:#e0b64d!important;color:#5b4300!important} div[style*="rgba(245,180,0"] *{color:#5b4300!important}
  div[style*="rgba(30,134,224,.1"]{background:#eef5fc!important;border-color:#bcd6f0!important} div[style*="rgba(30,134,224,.1"] *{color:#123!important}
  div[style*="rgba(47,227,160"]{background:#edfaf3!important;border-color:#9cd9b8!important;color:#0a5a36!important}
  .stat .v,.an-big .n,.big{-webkit-text-fill-color:initial;background:none!important;color:var(--text)!important;filter:none!important} .big{font-size:18px;font-weight:800}
  #rep-map,#st-map{height:300px!important;border:1px solid var(--border);border-radius:8px;break-inside:avoid} .leaflet-control-zoom{display:none!important} .leaflet-control-attribution{font-size:8px}
  .no-print,.helpbtn{display:none!important}
  .mapcard{break-inside:avoid}
  .scen-tbl td,.scen-tbl th{padding:5px 8px} .scen-tbl tr.t td{background:#eef5fc;border-top:1px solid #bcd6f0;border-bottom:1px solid #bcd6f0}
  a{color:inherit;text-decoration:none}
  @media print{.toolbar{display:none}.doc{padding:0;max-width:none}.card{break-inside:auto}.card.mapcard,.stat,.sc .c,.rep-box{break-inside:avoid}}
</style></head><body>
<div class="toolbar"><span>Tisková verze studie – v dialogu tisku zvolte „Uložit jako PDF", okraje Výchozí a vypněte záhlaví/zápatí prohlížeče.</span><button type="button" onclick="window.print()">🖨 Vytisknout / uložit PDF</button></div>
<div class="doc">
  <div class="ph"><div class="brand">${logoSvg(34, 'p')}Best Series&nbsp;<span class="v">2.0</span> · Prověření lokality</div><div class="meta"><b>Studie lokality ${esc(site.name || '')}</b>${esc(site.address || '')}${site.city ? ', ' + esc(site.city) : ''} · ${dateS}</div></div>
  ${body.replace(/<div class="card" style="padding:10px"><div id="rep-map"/g, '<div class="card mapcard" style="padding:10px"><div id="rep-map"').replace(/<div class="card" style="padding:10px"><div id="st-map"/g, '<div class="card mapcard" style="padding:10px"><div id="st-map"')}
  <style>.cas div{background:#fff!important;border-color:var(--border)!important;color:var(--text)!important} .cas div span{color:var(--text2)!important} .sc .c{background:var(--card2)!important;border-color:var(--border)!important} .rep ul,.rep li{color:var(--text2)!important} .stat,.an-box{color:var(--text)!important}</style>
  <div class="pf"><span>Best Series s.r.o. · IČO 05643724 · www.bestseries2.cz</span><span>Orientační studie – odhady z dostupných podkladů, nikoli odborné schválení investice ani předpověď výdělku.</span></div>
</div>
<script>window.addEventListener('load',function(){ setTimeout(function(){ try{ document.querySelectorAll('.leaflet-container').forEach(function(el){ var m=el._leaflet_map; }); }catch(e){} },300); });</script>
</body></html>`;
}

module.exports = { runStudy, studyPage, studyPrintPage, gatherOsm };
