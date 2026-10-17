// BS2 — administrace kalendáře schůzek (/admin/meetings).
// Data žijí v HolyOS (MeetingSlot + MeetingReservation, stejné jako Prodejní objednávky → Termíny a veřejná rezervace na /cesta);
// BS2 je čte a mění přes služební endpointy HolyOS /api/auth/bs2/meetings* (JWT aud holyos-api, iss bs2).

const CSS = `
.mt-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px}
.mt-bar h2{margin:0 10px 0 0;font-size:18px}
.mt-range{font-weight:700;min-width:190px}
.mt-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 16px}
.mt-sum .s{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.mt-sum .s b{display:block;font-size:22px}
.mt-sum .s span{font-size:12px;color:var(--text2)}
.mt-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.mt-day{background:var(--card);border:1px solid var(--border);border-radius:12px;min-height:220px;display:flex;flex-direction:column}
.mt-day.today{border-color:rgba(47,227,160,.55);box-shadow:0 0 0 1px rgba(47,227,160,.25) inset}
.mt-day.past{opacity:.55}
.mt-dh{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);font-size:12.5px}
.mt-dh b{font-size:15px}
.mt-dh .add{background:none;border:1px solid var(--border2);color:var(--blue);border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:16px;line-height:1}
.mt-slots{padding:8px;display:flex;flex-direction:column;gap:6px}
.mt-slot{border:1px solid var(--border2);border-radius:10px;padding:7px 8px;font-size:12.5px;background:rgba(8,13,26,.6);cursor:pointer}
.mt-slot:hover{border-color:var(--blue)}
.mt-slot.free{border-left:3px solid #4fd1ff}
.mt-slot.full{border-left:3px solid #2fe3a0;background:rgba(47,227,160,.08)}
.mt-slot.off{opacity:.45;border-style:dashed}
.mt-slot .t{font-weight:800;font-size:13.5px}
.mt-slot .w{color:var(--text2);font-size:11.5px}
.mt-slot .who{margin-top:3px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mt-empty{color:var(--text3);font-size:12px;text-align:center;padding:14px 0}
.mt-up{margin-top:22px}
.mt-up table{width:100%;border-collapse:collapse;font-size:13.5px}
.mt-up th,.mt-up td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
.mt-up th{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2)}
.mt-pill{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--border2);white-space:nowrap}
.mt-pill.booked{color:#4fd1ff;border-color:rgba(79,209,255,.5)}
.mt-pill.done{color:#2fe3a0;border-color:rgba(47,227,160,.5)}
.mt-pill.canceled,.mt-pill.no_show{color:#ff8f8f;border-color:rgba(255,93,108,.5)}
.mt-ov{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px}
.mt-md{background:#0d1426;border:1px solid var(--border2);border-radius:16px;padding:20px;width:560px;max-width:100%;max-height:92vh;overflow:auto;position:relative}
.mt-md h3{margin:0 0 12px}
.mt-md .x{position:absolute;top:10px;right:14px;background:none;border:none;color:var(--text2);font-size:22px;cursor:pointer}
.mt-md label{display:block;font-size:12.5px;color:var(--text2);margin:10px 0 4px}
.mt-md input,.mt-md select,.mt-md textarea{width:100%;box-sizing:border-box;background:rgba(8,13,26,.85);border:1px solid var(--border2);border-radius:9px;color:var(--text);padding:9px 10px;font:inherit}
.mt-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mt-dows{display:flex;gap:6px;flex-wrap:wrap}
.mt-dows label{display:inline-flex;align-items:center;gap:5px;margin:0;color:var(--text);border:1px solid var(--border2);border-radius:8px;padding:6px 9px;cursor:pointer}
.mt-dows input{width:auto}
.mt-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.mt-res{border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:10px}
.mt-res .nm{font-weight:700}
.mt-msg{margin-top:10px;font-size:13px}
@media(max-width:900px){.mt-week{grid-template-columns:1fr}.mt-day{min-height:0}}
`;

const JS = `(function(){
var DN=['Ne','Po','Út','St','Čt','Pá','So'], MON=['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
var MODE={online:'💻 online',osobne:'👤 osobně'}, PATH={vlastni:'💰 vlastní kapitál',financovani:'🏦 financování'};
var ST={booked:'rezervováno',done:'proběhla',canceled:'zrušeno',no_show:'nedorazil'};
var week=0, data=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function sod(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function wstart(o){var m=sod(new Date());m.setDate(m.getDate()-((m.getDay()+6)%7)+7*o);return m;}
function hm(d){return d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');}
function dlong(d){return DN[d.getDay()]+' '+d.getDate()+'. '+MON[d.getMonth()];}
function api(url,body){return fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'}).then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok||j.ok===false)throw new Error(j.error||('Chyba '+r.status));return j;});});}
var root=document.getElementById('mt');
function load(){
  var mon=wstart(week), to=new Date(mon); to.setDate(to.getDate()+7);
  var upTo=new Date(); upTo.setDate(upTo.getDate()+60);
  var from=new Date(Math.min(mon.getTime(),sod(new Date()).getTime())), until=new Date(Math.max(to.getTime(),upTo.getTime()));
  root.querySelector('.mt-weekwrap').innerHTML='<div class="mt-empty">Načítám…</div>';
  api('/admin/api/meetings?from='+encodeURIComponent(from.toISOString())+'&to='+encodeURIComponent(until.toISOString())).then(function(j){data=j.slots||[];render();}).catch(function(e){root.querySelector('.mt-weekwrap').innerHTML='<div class="mt-empty" style="color:#ff8f8f">'+esc(e.message)+'</div>';});
}
function render(){
  var mon=wstart(week), sun=new Date(mon); sun.setDate(mon.getDate()+7); var last=new Date(sun); last.setDate(last.getDate()-1);
  root.querySelector('.mt-range').textContent=mon.getDate()+'. '+MON[mon.getMonth()]+' – '+last.getDate()+'. '+MON[last.getMonth()]+' '+last.getFullYear();
  var now=new Date(), today=now.toDateString(), html='';
  var inWeek=data.filter(function(s){var d=new Date(s.starts_at);return d>=mon&&d<sun;});
  for(var i=0;i<7;i++){var d=new Date(mon);d.setDate(mon.getDate()+i);var k=d.toDateString();
    var list=inWeek.filter(function(s){return new Date(s.starts_at).toDateString()===k;});
    html+='<div class="mt-day'+(k===today?' today':'')+(d<sod(now)?' past':'')+'"><div class="mt-dh"><span>'+DN[d.getDay()]+' <b>'+d.getDate()+'.</b></span><button class="add" title="Přidat termín" data-add="'+d.toISOString()+'">+</button></div><div class="mt-slots">';
    if(!list.length)html+='<div class="mt-empty">—</div>';
    list.forEach(function(s){var b=s.booked||0,full=b>=s.capacity,r=(s.reservations||[]).filter(function(x){return x.status==='booked';});
      html+='<div class="mt-slot '+(!s.active?'off':full?'full':'free')+'" data-slot="'+s.id+'"><div class="t">'+hm(new Date(s.starts_at))+' <span class="w">· '+s.duration_min+' min'+(s.mode?' · '+(MODE[s.mode]||s.mode):'')+'</span></div>'
        +'<div class="w">'+(s.active?(b+'/'+s.capacity+' obsazeno'):'vypnuto')+'</div>'
        +r.map(function(x){return '<div class="who">'+esc((x.lead&&x.lead.name)||x.name||x.phone||x.email||'zájemce')+'</div>';}).join('')+'</div>';});
    html+='</div></div>';}
  root.querySelector('.mt-weekwrap').innerHTML='<div class="mt-week">'+html+'</div>';
  // souhrn + nejbližší schůzky
  var up=[]; data.forEach(function(s){(s.reservations||[]).forEach(function(r){if(new Date(s.starts_at)>=sod(now))up.push({s:s,r:r});});});
  up.sort(function(a,b){return new Date(a.s.starts_at)-new Date(b.s.starts_at);});
  var booked=up.filter(function(x){return x.r.status==='booked';});
  var freeCnt=data.filter(function(s){return s.active&&new Date(s.starts_at)>now&&(s.booked||0)<s.capacity;}).length;
  var wkB=inWeek.reduce(function(a,s){return a+(s.booked||0);},0);
  root.querySelector('.mt-sum').innerHTML='<div class="s"><b>'+wkB+'</b><span>rezervací v zobrazeném týdnu</span></div><div class="s"><b>'+booked.length+'</b><span>nadcházejících schůzek</span></div><div class="s"><b>'+freeCnt+'</b><span>volných termínů (60 dní)</span></div>';
  root.querySelector('.mt-up').innerHTML='<h3 style="margin:0 0 8px">Nadcházející schůzky</h3>'+(up.length?'<table><thead><tr><th>Kdy</th><th>Kdo</th><th>Kontakt</th><th>Forma / cesta</th><th>Stav</th><th></th></tr></thead><tbody>'+up.slice(0,60).map(function(x){var d=new Date(x.s.starts_at),L=x.r.lead||{};
    return '<tr><td><b>'+dlong(d)+'</b> '+hm(d)+'</td><td>'+esc(L.name||x.r.name||'—')+(L.city?' <span class="muted">· '+esc(L.city)+'</span>':'')+'</td><td>'+(x.r.phone||L.phone?'<a href="tel:'+esc(x.r.phone||L.phone)+'">'+esc(x.r.phone||L.phone)+'</a>':'')+(x.r.email||L.email?'<div class="small"><a href="mailto:'+esc(x.r.email||L.email)+'">'+esc(x.r.email||L.email)+'</a></div>':'')+'</td><td>'+(MODE[x.r.mode]||'—')+(x.r.financing_path?'<div class="small muted">'+(PATH[x.r.financing_path]||'')+'</div>':'')+'</td><td><span class="mt-pill '+esc(x.r.status)+'">'+(ST[x.r.status]||esc(x.r.status))+'</span></td><td><button class="btn sec sm" data-slot="'+x.s.id+'">Detail</button></td></tr>';}).join('')+'</tbody></table>':'<div class="muted">Zatím žádné rezervace.</div>');
}
function modal(html){var ov=document.createElement('div');ov.className='mt-ov';ov.innerHTML='<div class="mt-md"><button class="x" data-x>×</button>'+html+'</div>';document.body.appendChild(ov);ov.addEventListener('click',function(e){if(e.target===ov||e.target.hasAttribute('data-x'))ov.remove();});return ov;}
function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function addModal(day){
  var d0=day?new Date(day):sod(new Date()), d1=day?new Date(day):new Date(d0.getTime()+13*86400000);
  var ov=modal('<h3>Přidat termíny</h3><div class="mt-row"><div><label>Od</label><input type="date" class="f-from" value="'+ymd(d0)+'"></div><div><label>Do</label><input type="date" class="f-to" value="'+ymd(d1)+'"></div></div>'
   +'<label>Dny v týdnu</label><div class="mt-dows">'+[1,2,3,4,5,6,0].map(function(n){return '<label><input type="checkbox" value="'+n+'"'+(day?(new Date(day).getDay()===n?' checked':''):(n>=1&&n<=5?' checked':''))+'>'+DN[n]+'</label>';}).join('')+'</div>'
   +'<label>Časy (oddělte čárkou)</label><input class="f-times" value="9:00, 10:00, 11:00, 14:00, 15:00, 16:00">'
   +'<div class="mt-row"><div><label>Délka (min)</label><input type="number" class="f-dur" value="17" min="5" max="480"></div><div><label>Kapacita (počet zájemců)</label><input type="number" class="f-cap" value="1" min="1" max="50"></div></div>'
   +'<label>Forma</label><select class="f-mode"><option value="">online i osobně (zájemce si vybere)</option><option value="online">jen online</option><option value="osobne">jen osobně</option></select>'
   +'<label>Poznámka (interní)</label><input class="f-note" placeholder="např. Tomáš, výroba Vrtačka">'
   +'<div class="mt-act"><button class="btn f-go">Vytvořit termíny</button></div><div class="mt-msg"></div>');
  var q=function(c){return ov.querySelector(c);};
  q('.f-go').onclick=function(){
    var from=new Date(q('.f-from').value+'T00:00'), to=new Date(q('.f-to').value+'T00:00');
    var dows=[].slice.call(ov.querySelectorAll('.mt-dows input:checked')).map(function(x){return +x.value;});
    var times=q('.f-times').value.split(/[,;\\s]+/).map(function(t){var m=/^(\\d{1,2})[:.](\\d{2})$/.exec(t.trim());return m?[+m[1],+m[2]]:null;}).filter(Boolean);
    if(isNaN(from)||isNaN(to)||to<from){q('.mt-msg').textContent='Zkontrolujte rozsah dat.';return;}
    if(!dows.length||!times.length){q('.mt-msg').textContent='Vyberte aspoň jeden den a zadejte čas ve tvaru 9:00.';return;}
    var slots=[], now=new Date();
    for(var d=new Date(from);d<=to;d.setDate(d.getDate()+1)){if(dows.indexOf(d.getDay())<0)continue;times.forEach(function(t){var s=new Date(d.getFullYear(),d.getMonth(),d.getDate(),t[0],t[1]);if(s>now)slots.push({starts_at:s.toISOString(),duration_min:+q('.f-dur').value||17,capacity:+q('.f-cap').value||1,mode:q('.f-mode').value||null,note:q('.f-note').value||null});});}
    if(!slots.length){q('.mt-msg').textContent='Nevznikl žádný budoucí termín.';return;}
    if(slots.length>200&&!confirm('Vytvořit '+slots.length+' termínů?'))return;
    this.disabled=true;q('.mt-msg').textContent='Ukládám '+slots.length+' termínů…';
    api('/admin/api/meetings/slots',{slots:slots}).then(function(j){ov.remove();load();}).catch(function(e){q('.mt-msg').textContent=e.message;q('.f-go').disabled=false;});
  };
}
function slotModal(id){
  var s=data.filter(function(x){return x.id===id;})[0]; if(!s)return; var d=new Date(s.starts_at);
  var res=(s.reservations||[]).map(function(r){var L=r.lead||{};return '<div class="mt-res"><div class="nm">'+esc(L.name||r.name||'Zájemce')+' <span class="mt-pill '+esc(r.status)+'">'+(ST[r.status]||esc(r.status))+'</span></div>'
    +'<div class="small muted">'+[r.phone||L.phone,r.email||L.email,L.city].filter(Boolean).map(esc).join(' · ')+'</div>'
    +'<div class="small">'+[MODE[r.mode],PATH[r.financing_path]].filter(Boolean).join(' · ')+(r.compounder_lead_id?' · lead #'+r.compounder_lead_id:'')+'</div>'
    +(r.note?'<div class="small muted">'+esc(r.note)+'</div>':'')
    +'<div class="mt-act">'+(r.status!=='done'?'<button class="btn sm" data-rs="'+r.id+'" data-st="done">✓ Proběhla</button>':'')+(r.status!=='no_show'?'<button class="btn sec sm" data-rs="'+r.id+'" data-st="no_show">Nedorazil</button>':'')+(r.status!=='canceled'?'<button class="btn sec sm" data-rs="'+r.id+'" data-st="canceled">Zrušit</button>':'')+(r.status!=='booked'?'<button class="btn sec sm" data-rs="'+r.id+'" data-st="booked">Obnovit</button>':'')+'</div></div>';}).join('');
  var ov=modal('<h3>'+dlong(d)+' '+hm(d)+'</h3><div class="mt-row"><div><label>Datum</label><input type="date" class="e-d" value="'+ymd(d)+'"></div><div><label>Čas</label><input type="time" class="e-t" value="'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+'"></div></div>'
   +'<div class="mt-row"><div><label>Délka (min)</label><input type="number" class="e-dur" value="'+s.duration_min+'"></div><div><label>Kapacita</label><input type="number" class="e-cap" value="'+s.capacity+'"></div></div>'
   +'<label>Forma</label><select class="e-mode"><option value="">online i osobně</option><option value="online"'+(s.mode==='online'?' selected':'')+'>jen online</option><option value="osobne"'+(s.mode==='osobne'?' selected':'')+'>jen osobně</option></select>'
   +'<label>Poznámka (interní)</label><input class="e-note" value="'+esc(s.note||'')+'">'
   +'<div class="mt-act"><button class="btn e-save">Uložit</button><button class="btn sec e-tog">'+(s.active?'Vypnout termín':'Zapnout termín')+'</button><button class="btn sec e-del" style="color:#ff8f8f">Smazat</button></div>'
   +'<h3 style="margin:18px 0 0">Rezervace</h3>'+(res||'<div class="muted small" style="margin-top:6px">Zatím nikdo.</div>')+'<div class="mt-msg"></div>');
  var q=function(c){return ov.querySelector(c);}, msg=function(t){q('.mt-msg').textContent=t;}, done=function(){ov.remove();load();};
  q('.e-save').onclick=function(){var nd=new Date(q('.e-d').value+'T'+q('.e-t').value);if(isNaN(nd))return msg('Neplatné datum/čas.');api('/admin/api/meetings/slots/'+id+'/update',{starts_at:nd.toISOString(),duration_min:+q('.e-dur').value,capacity:+q('.e-cap').value,mode:q('.e-mode').value||null,note:q('.e-note').value}).then(done).catch(function(e){msg(e.message);});};
  q('.e-tog').onclick=function(){api('/admin/api/meetings/slots/'+id+'/update',{active:!s.active}).then(done).catch(function(e){msg(e.message);});};
  q('.e-del').onclick=function(){if(!confirm('Smazat termín?'))return;api('/admin/api/meetings/slots/'+id+'/delete',{}).then(function(j){if(j.deactivated)alert('Termín měl historii rezervací – byl jen vypnut.');done();}).catch(function(e){msg(e.message);});};
  [].forEach.call(ov.querySelectorAll('[data-rs]'),function(b){b.onclick=function(){var st=b.getAttribute('data-st');if(st==='canceled'&&!confirm('Zrušit rezervaci? Zájemce se o tom automaticky nedozví – dejte mu vědět.'))return;api('/admin/api/meetings/reservations/'+b.getAttribute('data-rs'),{status:st}).then(done).catch(function(e){msg(e.message);});};});
}
root.addEventListener('click',function(e){var a=e.target.closest('[data-add]');if(a){e.stopPropagation();return addModal(a.getAttribute('data-add'));}var s=e.target.closest('[data-slot]');if(s)slotModal(+s.getAttribute('data-slot'));});
root.querySelector('.mt-prev').onclick=function(){week--;render();if(week<-1)load();};
root.querySelector('.mt-next').onclick=function(){week++;if(week>7)load();else render();};
root.querySelector('.mt-today').onclick=function(){week=0;load();};
root.querySelector('.mt-new').onclick=function(){addModal(null);};
load();
})();`;

function meetingsPage(V, { admin, holyosUrl, error }) {
  return V.adminLayout('Schůzky', 'meet', admin, `<style>${CSS}</style>
  <div id="mt">
    <div class="mt-bar"><h2>📅 Kalendář schůzek</h2>
      <button class="btn sec sm mt-prev">←</button><span class="mt-range"></span><button class="btn sec sm mt-next">→</button>
      <button class="btn sec sm mt-today">Dnes</button><span style="flex:1"></span><button class="btn sm mt-new">+ Přidat termíny</button></div>
    <p class="muted small" style="margin:-6px 0 14px">Termíny, které tady vypíšete, si zájemci rezervují na <a href="/cesta" target="_blank">bestseries2.cz/cesta</a> (a ve starém odkazu z SMS). Data jsou společná s HolyOS → Prodejní objednávky → Termíny.</p>
    ${error ? `<div class="card" style="border-color:var(--err);color:#ff8f8f">${error}</div>` : ''}
    <div class="mt-sum"></div>
    <div class="mt-weekwrap"></div>
    <div class="mt-up card"></div>
  </div>
  <script>${JS}</script>`, holyosUrl);
}

module.exports = { meetingsPage };
