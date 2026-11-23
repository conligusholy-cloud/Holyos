// Laundry Unlimited — auditní log (historie změn): kdo, kdy, odkud a co přesně změnil.
// Každý zápis do administrace (POST pod /admin/api) se zaloguje automaticky; konkrétní obsluhy doplní
// srozumitelný popis (res.locals.audit = { label, summary, changes, coalesce, skip }). Hesla ani těla požadavků se neukládají.
let Q = null;

async function init(q) {
  Q = q;
  await q(`CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_name TEXT,
    actor_email TEXT,
    actor_key TEXT,
    ip TEXT,
    device TEXT,
    method TEXT,
    path TEXT,
    area TEXT,
    action TEXT,
    entity_type TEXT,
    entity_id TEXT,
    label TEXT,
    summary TEXT,
    changes JSONB,
    n INT NOT NULL DEFAULT 1,
    ok BOOLEAN NOT NULL DEFAULT true,
    error TEXT,
    status INT,
    ms INT
  )`);
  await q('CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC)');
  await q('CREATE INDEX IF NOT EXISTS audit_log_area_idx ON audit_log (area, at DESC)');
  // Záznamy starší než 2 roky se mažou (spouští se při startu a pak denně)
  const prune = () => q("DELETE FROM audit_log WHERE at < now() - interval '730 days'").catch(() => {});
  prune(); setInterval(prune, 24 * 3600e3).unref();
}

const ipOf = (req) => { const x = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim(); return String(x || req.ip || '').slice(0, 64); };
function deviceOf(ua) {
  ua = String(ua || ''); if (!ua) return '';
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg\//i.test(ua) ? 'Edge' : /OPR\/|Opera/i.test(ua) ? 'Opera' : /Firefox\//i.test(ua) ? 'Firefox' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : /curl|node|python/i.test(ua) ? 'skript' : '';
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 60);
}

// Cesta požadavku → oblast a název akce
const RULES = [
  [/^\/admin\/api\/tasks\/(\d+)\/comment$/, 'Tasky', 'Komentář k tasku', 'task'],
  [/^\/admin\/api\/tasks\/(\d+)\/delete$/, 'Tasky', 'Smazání tasku', 'task'],
  [/^\/admin\/api\/tasks\/(\d+)$/, 'Tasky', 'Úprava tasku', 'task'],
  [/^\/admin\/api\/tasks$/, 'Tasky', 'Nový task', 'task'],
  [/^\/admin\/api\/inquiry\/(\d+)\/portal-link$/, 'Leady', 'Odeslán odkaz do portálu', 'lead'],
  [/^\/admin\/api\/inquiry\/(\d+)\/delete$/, 'Leady', 'Smazání leadu', 'lead'],
  [/^\/admin\/api\/inquiry\/(\d+)$/, 'Leady', 'Úprava leadu', 'lead'],
  [/^\/admin\/api\/users\/(\d+)\/password$/, 'Uživatelé administrace', 'Nastavení hesla', 'user'],
  [/^\/admin\/api\/users\/(\d+)\/link$/, 'Uživatelé administrace', 'Odeslána pozvánka / odkaz', 'user'],
  [/^\/admin\/api\/users\/(\d+)\/delete$/, 'Uživatelé administrace', 'Smazání uživatele', 'user'],
  [/^\/admin\/api\/users\/(\d+)$/, 'Uživatelé administrace', 'Povolení / zakázání uživatele', 'user'],
  [/^\/admin\/api\/users$/, 'Uživatelé administrace', 'Nový uživatel', 'user'],
  [/^\/admin\/api\/finance$/, 'Rozdělení financí', 'Úprava tabulky', 'finance'],
  [/^\/admin\/api\/model\/boards\/(\d+)\/analyze$/, 'Modelace business modelu', 'AI rozbor mapy', 'board'],
  [/^\/admin\/api\/model\/boards\/(\d+)\/chat$/, 'Modelace business modelu', 'AI poradce (dotaz)', 'board'],
  [/^\/admin\/api\/model\/boards\/(\d+)\/rename$/, 'Modelace business modelu', 'Přejmenování plátna', 'board'],
  [/^\/admin\/api\/model\/boards\/(\d+)\/delete$/, 'Modelace business modelu', 'Smazání plátna', 'board'],
  [/^\/admin\/api\/model\/boards\/(\d+)$/, 'Modelace business modelu', 'Úprava plátna', 'board'],
  [/^\/admin\/api\/model\/boards$/, 'Modelace business modelu', 'Nové plátno', 'board'],
];
function classify(p) {
  for (const [re, area, action, type] of RULES) { const m = re.exec(p); if (m) return { area, action, type, id: m[1] || null }; }
  return { area: 'Administrace', action: 'Změna', type: null, id: null };
}

const sumOf = (changes, fallback) => {
  if (!changes || !changes.length) return fallback || '';
  const head = changes.slice(0, 3).join(' · ');
  return changes.length > 3 ? head + ' · … a ' + (changes.length - 3) + ' dalších změn' : head;
};

/** Zapíše jednu položku. e: { area, action, type, id, label, summary, changes[], ok, error, status, ms, coalesce, actor{name,email,pid}, method, path } */
async function write(req, e) {
  if (!Q) return;
  try {
    const a = e.actor || (req && req.admin) || {};
    const key = a.email ? String(a.email).toLowerCase() : (a.pid ? 'pid:' + a.pid : '');
    const changes = Array.isArray(e.changes) ? e.changes.slice(0, 200).map((x) => String(x).slice(0, 400)) : null;
    const ok = e.ok !== false;
    if (e.coalesce && ok && changes && changes.length) {
      // Autosave posílá změny po každém kliknutí — sloučíme je do jedné položky (do 10 minut od poslední)
      const last = (await Q("SELECT id, changes, n FROM audit_log WHERE actor_key=$1 AND area=$2 AND action=$3 AND coalesce(entity_id,'')=$4 AND ok AND at > now() - interval '10 minutes' ORDER BY id DESC LIMIT 1", [key, e.area, e.action, String(e.id || '')])).rows[0];
      if (last) {
        const merged = (Array.isArray(last.changes) ? last.changes : []).concat(changes.filter((x) => !(last.changes || []).includes(x))).slice(-200);
        await Q('UPDATE audit_log SET at=now(), changes=$2::jsonb, summary=$3, n=n+1, ip=$4, device=$5 WHERE id=$1', [last.id, JSON.stringify(merged), sumOf(merged), req ? ipOf(req) : null, req ? deviceOf(req.headers && req.headers['user-agent']) : null]);
        return;
      }
    }
    await Q('INSERT INTO audit_log (actor_name, actor_email, actor_key, ip, device, method, path, area, action, entity_type, entity_id, label, summary, changes, ok, error, status, ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18)',
      [a.name || a.email || (a.pid ? 'HolyOS #' + a.pid : null), a.email || null, key || null, req ? ipOf(req) : null, req ? deviceOf(req.headers && req.headers['user-agent']) : null,
        e.method || (req && req.method) || null, String(e.path || (req && (req.originalUrl || req.url)) || '').split('?')[0].slice(0, 200), e.area || 'Administrace', e.action || 'Změna', e.type || null, e.id != null ? String(e.id) : null,
        e.label ? String(e.label).slice(0, 300) : null, String(e.summary || sumOf(changes) || '').slice(0, 1500) || null, changes ? JSON.stringify(changes) : null, ok, e.error ? String(e.error).slice(0, 500) : null, e.status || null, e.ms || null]);
  } catch (err) { console.warn('[lu] audit:', err.message); }
}

/** Express middleware pro /admin/api: zaloguje každou změnu (ne GET), včetně neúspěšných pokusů */
function middleware(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const t0 = Date.now(); let body = null;
  const j = res.json.bind(res);
  res.json = (b) => { body = b; return j(b); };
  res.on('finish', () => {
    try {
      const A = res.locals.audit || {}; if (A.skip) return;
      if (!req.admin && res.statusCode === 401) return; // nepřihlášené pokusy (boti) do logu nepatří
      const c = classify(String(req.originalUrl || req.url).split('?')[0]);
      const ok = res.statusCode < 400 && !(body && body.ok === false);
      write(req, { area: c.area, action: A.action || c.action, type: c.type, id: A.id != null ? A.id : c.id, label: A.label, summary: A.summary, changes: A.changes, coalesce: A.coalesce, ok, error: ok ? null : ((body && body.error) || ('HTTP ' + res.statusCode)), status: res.statusCode, ms: Date.now() - t0 });
    } catch (e) { /* log nesmí shodit požadavek */ }
  });
  next();
}

// ── Rozdíly (co přesně se změnilo) ─────────────────────────────────
const num = (x) => (x == null || x === '' ? '—' : (typeof x === 'number' ? String(Math.round(x * 100) / 100).replace('.', ',') : String(x)));
const q2 = (s) => '„' + String(s == null || s === '' ? '(bez názvu)' : s).replace(/\s+/g, ' ').slice(0, 60) + '“';
const FREQ = { once: 'jednorázově', tx: 'z každé transakce', day: 'denně', week: 'týdně', month: 'měsíčně', month_unit: 'měsíčně z prádlomatu', quarter: 'čtvrtletně', half: 'půlročně', year: 'ročně', y5: 'každých 5 let', y10: 'každých 10 let' };

function diffFinance(o, n) {
  o = o || {}; n = n || {}; const out = [];
  const oc = o.cols || [], nc = n.cols || [], or = o.rows || [], nr = n.rows || [];
  const ocm = new Map(oc.map((c) => [c.id, c])), ncm = new Map(nc.map((c) => [c.id, c]));
  nc.forEach((c) => { if (!ocm.has(c.id)) out.push('Přidána pozice ' + q2(c.name)); else if ((ocm.get(c.id).name || '') !== (c.name || '')) out.push('Pozice ' + q2(ocm.get(c.id).name) + ' přejmenována na ' + q2(c.name)); });
  oc.forEach((c) => { if (!ncm.has(c.id)) out.push('Odebrána pozice ' + q2(c.name)); });
  const orm = new Map(or.map((r) => [r.id, r])), nrm = new Map(nr.map((r) => [r.id, r]));
  nr.forEach((r) => {
    const p = orm.get(r.id);
    if (!p) { out.push('Nový řádek ' + q2(r.name)); return; }
    const nm = r.name || p.name;
    if ((p.name || '') !== (r.name || '')) out.push('Řádek ' + q2(p.name) + ' přejmenován na ' + q2(r.name));
    if (p.price !== r.price) out.push('Řádek ' + q2(nm) + ': cena ' + num(p.price) + ' → ' + num(r.price) + ' €');
    if (p.pct !== r.pct) out.push('Řádek ' + q2(nm) + ': volné prostředky ' + num(p.pct) + ' → ' + num(r.pct) + ' %');
    if (p.amt !== r.amt) out.push('Řádek ' + q2(nm) + ': volné prostředky ' + num(p.amt) + ' → ' + num(r.amt) + ' €');
    if ((p.freq || '') !== (r.freq || '')) out.push('Řádek ' + q2(nm) + ': frekvence ' + (FREQ[p.freq] || '—') + ' → ' + (FREQ[r.freq] || '—'));
    const ids = new Set(Object.keys(p.v || {}).concat(Object.keys(r.v || {})));
    ids.forEach((id) => { const a = (p.v || {})[id], b = (r.v || {})[id]; if (a !== b) out.push('Řádek ' + q2(nm) + ' · ' + q2((ncm.get(id) || ocm.get(id) || {}).name) + ': ' + num(a) + ' → ' + num(b) + ' %'); });
  });
  or.forEach((r) => { if (!nrm.has(r.id)) out.push('Smazán řádek ' + q2(r.name)); });
  const common = nr.filter((r) => orm.has(r.id)).map((r) => r.id).join(','), commonO = or.filter((r) => nrm.has(r.id)).map((r) => r.id).join(',');
  if (common !== commonO) out.push('Změněno pořadí řádků');
  // modelace výdělku a výhled
  const om = o.model || {}, nm2 = n.model || {};
  const cname = (id) => q2((ncm.get(id) || ocm.get(id) || {}).name), rname = (id) => q2((nrm.get(id) || orm.get(id) || {}).name);
  if (JSON.stringify(om.sel || null) !== JSON.stringify(nm2.sel || null)) out.push('Modelace: změněn výběr modelovaných pozic');
  const cids = new Set(Object.keys(om.vol || {}).concat(Object.keys(nm2.vol || {})));
  cids.forEach((cid) => { const a = (om.vol || {})[cid] || {}, b = (nm2.vol || {})[cid] || {}; new Set(Object.keys(a).concat(Object.keys(b))).forEach((rid) => { if (a[rid] !== b[rid]) out.push('Modelace ' + cname(cid) + ' · ' + rname(rid) + ': objem ' + num(a[rid]) + ' → ' + num(b[rid])); }); });
  const op = om.plan || {}, np = nm2.plan || {};
  [['pr', 'nové prádlomaty'], ['op', 'noví operátoři'], ['sub', 'noví předplatitelé Market Place']].forEach(([k, lab]) => { for (let i = 0; i < 10; i++) { const a = (op[k] || [])[i], b = (np[k] || [])[i]; if ((a == null ? null : a) !== (b == null ? null : b)) out.push('Výhled 10 let · rok ' + (i + 1) + ' ' + lab + ': ' + num(a) + ' → ' + num(b)); } });
  if ((op.txm == null ? null : op.txm) !== (np.txm == null ? null : np.txm)) out.push('Výhled: transakcí / měsíc na předplatitele ' + num(op.txm) + ' → ' + num(np.txm));
  return out.slice(0, 200);
}

function diffBoard(o, n) {
  o = o || {}; n = n || {}; const out = [];
  const on = o.nodes || [], nn = n.nodes || [], oe = o.edges || [], ne = n.edges || [];
  const onm = new Map(on.map((x) => [x.id, x])), nnm = new Map(nn.map((x) => [x.id, x]));
  let moved = 0, resized = 0, fmt = 0;
  nn.forEach((x) => {
    const p = onm.get(x.id);
    if (!p) { out.push('Přidáno okno ' + q2(x.text)); return; }
    if ((p.text || '') !== (x.text || '')) out.push('Okno ' + q2(p.text) + ' přepsáno na ' + q2(x.text));
    if (Math.abs((p.x || 0) - (x.x || 0)) > 1 || Math.abs((p.y || 0) - (x.y || 0)) > 1) moved++;
    if ((p.w || 0) !== (x.w || 0) || (p.h || 0) !== (x.h || 0)) resized++;
    if ((p.fz || 0) !== (x.fz || 0) || !!p.b !== !!x.b || (p.al || '') !== (x.al || '') || (p.color || '') !== (x.color || '')) fmt++;
  });
  on.forEach((x) => { if (!nnm.has(x.id)) out.push('Odebráno okno ' + q2(x.text)); });
  if (moved) out.push('Přesunuto oken: ' + moved);
  if (resized) out.push('Změněna velikost oken: ' + resized);
  if (fmt) out.push('Změněn vzhled / formát oken: ' + fmt);
  const ek = (e) => e.from + '>' + e.to, oek = new Map(oe.map((e) => [ek(e), e])), nek = new Map(ne.map((e) => [ek(e), e]));
  const lbl = (id) => q2(((nnm.get(id) || onm.get(id)) || {}).text);
  ne.forEach((e) => { if (!oek.has(ek(e))) out.push('Nové spojení ' + lbl(e.from) + ' → ' + lbl(e.to)); });
  oe.forEach((e) => { if (!nek.has(ek(e))) out.push('Odebráno spojení ' + lbl(e.from) + ' → ' + lbl(e.to)); });
  return out.slice(0, 200);
}

module.exports = { init, write, middleware, diffFinance, diffBoard, classify, ipOf, deviceOf };
