// Smoke test /api/hr/stats a /presence s podvrženou Prismou (bez DB), TZ=Europe/Prague
process.env.TZ = 'Europe/Prague';
const Module = require('module');

const iso = d => new Date(d).toISOString().slice(0,10);
const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date()).reduce((a,x)=>{if(x.type!=='literal')a[x.type]=x.value;return a;},{});
const DNES = `${p.year}-${p.month}-${p.day}`;
const VCERA = iso(new Date(Date.UTC(+p.year,+p.month-1,+p.day) - 86400000));

// 9 lidí dnes s příchodem bez odchodu (+ jeden má navíc otevřenou přestávku),
// 1 dnes už odešel, 2 lidé mají otevřený záznam z VČERA (zapomněli odpíchnout)
const att = [];
for (let i = 1; i <= 9; i++) att.push({ person_id: i, date: DNES, type: 'work', clock_in: '07:00', clock_out: null });
att.push({ person_id: 3, date: DNES, type: 'break', clock_in: '11:30', clock_out: null }); // otevřená přestávka
att.push({ person_id: 10, date: DNES, type: 'work', clock_in: '06:00', clock_out: '14:00' }); // už odešel
att.push({ person_id: 20, date: VCERA, type: 'work', clock_in: '07:00', clock_out: null });
att.push({ person_id: 21, date: VCERA, type: 'work', clock_in: '07:00', clock_out: null });

const match = (r, w) => {
  if (w.date && iso(w.date) !== r.date) return false;
  if (w.type && r.type !== w.type) return false;
  if (w.clock_in && w.clock_in.not === null && r.clock_in === null) return false;
  if ('clock_out' in w && w.clock_out === null && r.clock_out !== null) return false;
  return true;
};
const fakePrisma = {
  person: { count: async ({ where }) => where.type === 'employee' ? 36 : 1, updateMany: async () => ({count:0}) },
  department: { count: async () => 0 },
  attendance: {
    count: async ({ where }) => att.filter(r => match(r, where)).length,
    findMany: async ({ where, select, distinct }) => {
      let rows = att.filter(r => match(r, where));
      if (distinct) { const seen = new Set(); rows = rows.filter(r => !seen.has(r[distinct[0]]) && seen.add(r[distinct[0]])); }
      return select ? rows.map(r => ({ person_id: r.person_id })) : rows.map(r => ({ ...r, person: { id: r.person_id, first_name: 'Osoba', last_name: String(r.person_id) } }));
    },
  },
};

const origLoad = Module._load;
Module._load = function (req) {
  if (req.endsWith('config/database')) return { prisma: fakePrisma };
  const pass = (rq,rs,nx)=>{ rq.user={id:1,is_admin:true}; nx(); };
  if (req.endsWith('middleware/auth')) return { requireAuth: pass, requireAdmin: pass };
  if (req.endsWith('middleware/hr-access')) return { requireHrWrite: pass, stripSensitive: x=>x, canSeeSensitive: ()=>true };
  if (req.endsWith('services/audit')) return { logAudit: async()=>{}, diffObjects: ()=>({}), makeSnapshot: x=>x };
  return origLoad.apply(this, arguments);
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/hr', require('./routes/hr.routes.js'));
app.use((err,rq,rs,nx)=>rs.status(500).json({error:err.message}));

app.listen(0, async function () {
  const base = 'http://127.0.0.1:' + this.address().port + '/api/hr';
  console.log('TZ=Europe/Prague, pražské dnes =', DNES, '| včera =', VCERA);
  console.log('data: 9 dnes přítomno (1 z nich na přestávce), 1 dnes odešel, 2 otevřené z včera\n');

  const stats = await (await fetch(base + '/stats')).json();
  console.log('GET /stats            ->', JSON.stringify(stats));
  console.log('  presentToday ==  9 ?', stats.presentToday === 9 ? 'OK' : 'CHYBA (' + stats.presentToday + ')');

  const pres = await (await fetch(base + '/presence')).json();
  console.log('GET /presence         -> řádků:', pres.length, '| dny:', [...new Set(pres.map(r=>r.date))].join(','));
  console.log('  jen dnešní den     ?', pres.every(r => r.date === DNES) ? 'OK' : 'CHYBA');
  process.exit(0);
});
