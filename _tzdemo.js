function nowInPrague() {
  const d = new Date();
  const p = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Prague', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false })
    .formatToParts(d).reduce((a,x)=>{ if(x.type!=='literal') a[x.type]=x.value; return a; },{});
  return new Date(Date.UTC(+p.year, +p.month-1, +p.day));
}
for (const tz of ['UTC','Europe/Prague']) {
  process.env.TZ = tz;
  const old = new Date(); old.setHours(0,0,0,0);
  console.log(tz.padEnd(15),
    '| stávající /stats →', old.toISOString().slice(0,10),
    '| nowInPrague()  →', nowInPrague().toISOString().slice(0,10));
}
console.log('\nteď UTC:', new Date().toISOString());
