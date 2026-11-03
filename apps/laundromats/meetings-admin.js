// Laundromats — administrace kalendáře schůzek (/admin/meetings).
// Data žijí v HolyOS (MeetingSlot + MeetingReservation, stejné jako Prodejní objednávky → Termíny a veřejná rezervace na laundromats.eu/cesta);
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
.mt-slot.part{border-left:3px solid #2fe3a0;border-color:rgba(47,227,160,.35);background:rgba(47,227,160,.10)}
.mt-slot.full{border-left:4px solid #22c55e;border-color:rgba(34,197,94,.75);background:rgba(34,197,94,.30)}
.mt-slot.full .w{color:#d1fae5}
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
.mt-tabs{display:flex;gap:8px;margin:0 0 16px;flex-wrap:wrap}
.mt-tabs button{background:transparent;border:1px solid var(--border2);color:var(--text2);border-radius:999px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer}
.mt-tabs button.on{background:rgba(79,209,255,.14);border-color:var(--blue);color:var(--blue)}
.mt-tw{overflow-x:auto}
.mt-hot table{width:100%;border-collapse:collapse;font-size:13.5px}
.mt-hot th,.mt-hot td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap}
.mt-hot th{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2)}
.mt-hot tr:hover td{background:rgba(79,209,255,.05)}
.mt-hot .nm{font-weight:700}
.mt-hot .cf-info{font-size:12px;color:var(--text2);margin:0 0 8px}
.mt-msg{margin-top:10px;font-size:13px}
@media(max-width:900px){.mt-week{grid-template-columns:1fr}.mt-day{min-height:0}}
`;

const JS = `(function(){
var DN=['Ne','Po','Út','St','Čt','Pá','So'], MON=['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
var MODE={online:'💻 online',osobne:'👤 osobně'}, PATH={vlastni:'💰 vlastní kapitál',financovani:'🏦 financování'};
var ST={booked:'rezervováno',done:'proběhla',canceled:'zrušeno',no_show:'nedorazil'};
var ST2={new:'Nový',nedovolano:'Nedovoláno',volat_pristi:'Volat příště',contacted:'Kontaktován',access_sent:'Odeslán přístup',odeslan_specialista:'Odeslán specialista',psal_chatovi:'Psal s chatem',schuzka:'Domluvena schůzka',schuzka_online:'Schůzka online',qualified:'Kvalifikován',dosledovani:'Dosledování',slibeny_krok:'Slíbený krok',smlouva_odeslat:'Odeslat dokumentaci',smlouva_odeslana:'Dokumentace odeslána',poptavka_financovani:'Poptávka financování',odeslana_schuzka:'Odeslána schůzka',prodano:'Prodáno',converted:'Převeden',nezajem:'Nemá zájem',nelze_pouzit:'Nelze použít',rejected:'Zamítnut'};
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
      html+='<div class="mt-slot '+(!s.active?'off':full?'full':b>0?'part':'free')+'" data-slot="'+s.id+'"><div class="t">'+hm(new Date(s.starts_at))+' <span class="w">· '+s.duration_min+' min'+(s.mode?' · '+(MODE[s.mode]||s.mode):'')+'</span></div>'
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
   +'<label>Časy (oddělte čárkou)</label><input class="f-times" value="9:00, 9:30, 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, 13:00, 13:30, 14:00, 14:30, 15:00, 15:30, 16:00, 16:30, 17:00, 17:30, 18:00, 18:30, 19:00">'
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
function chanHtml(note){
  if(!note)return '';
  var m=/\\((WhatsApp|Teams)\\)/.exec(note),u=/https:\\/\\/\\S+/.exec(note),txt=String(note).replace(/\\s*·?\\s*https:\\/\\/\\S+/,'');
  var pill=m?'<span class="mt-pill" style="border-color:'+(m[1]==='Teams'?'#a78bfa':'#25D366')+';color:'+(m[1]==='Teams'?'#c4b5fd':'#4ade80')+'">'+(m[1]==='Teams'?'🟣 Teams':'🟢 WhatsApp')+'</span> ':'';
  return '<div class="small muted">'+pill+esc(txt)+(u?' · <a href="'+esc(u[0])+'" target="_blank" rel="noopener">Odkaz na Teams</a>':'')+'</div>';
}
function slotModal(id){
  var s=data.filter(function(x){return x.id===id;})[0]; if(!s)return; var d=new Date(s.starts_at);
  var res=(s.reservations||[]).map(function(r){var L=r.lead||{};return '<div class="mt-res"><div class="nm">'+(L.is_hot?'⭐ ':'')+esc(L.name||r.name||'Zájemce')+' <span class="mt-pill '+esc(r.status)+'">'+(ST[r.status]||esc(r.status))+'</span></div>'
    +'<div class="small muted">'+[r.phone||L.phone,r.email||L.email,L.city].filter(Boolean).map(esc).join(' · ')+'</div>'
    +'<div class="small">'+[MODE[r.mode],PATH[r.financing_path]].filter(Boolean).join(' · ')+(r.compounder_lead_id?' · lead #'+r.compounder_lead_id:'')+'</div>'
    +chanHtml(r.note)
    +'<div class="mt-act">'+(r.status!=='done'?'<button class="btn sm" data-rs="'+r.id+'" data-st="done">✓ Proběhla</button>':'')+(r.status!=='no_show'?'<button class="btn sec sm" data-rs="'+r.id+'" data-st="no_show">Nedorazil</button>':'')+(r.status!=='canceled'?'<button class="btn sec sm" data-rs="'+r.id+'" data-st="canceled">Zrušit</button>':'')+(r.status!=='booked'?'<button class="btn sec sm" data-rs="'+r.id+'" data-st="booked">Obnovit</button>':'')+(r.compounder_lead_id?'<button class="btn sec sm" data-hot="'+r.compounder_lead_id+'" data-on="'+(L.is_hot?1:0)+'" style="'+(L.is_hot?'background:#eab308;color:#1a1a1a;border-color:#eab308':'')+'">'+(L.is_hot?'⭐ Zajímavý kontakt':'☆ Označit jako zajímavý')+'</button>':'')+'</div></div>';}).join('');
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
  [].forEach.call(ov.querySelectorAll('[data-hot]'),function(b){b.onclick=function(){var lid=+b.getAttribute('data-hot'),on=b.getAttribute('data-on')!=='1';b.disabled=true;api('/admin/api/leads/'+lid+'/hot',{hot:on}).then(function(j){var v=!!(j&&j.is_hot);(s.reservations||[]).forEach(function(r){if(r.compounder_lead_id===lid){r.lead=r.lead||{};r.lead.is_hot=v;}});ov.remove();slotModal(id);}).catch(function(e){b.disabled=false;msg(e.message);});};});
  [].forEach.call(ov.querySelectorAll('[data-rs]'),function(b){b.onclick=function(){var st=b.getAttribute('data-st');if(st==='canceled'&&!confirm('Zrušit rezervaci? Zájemce se o tom automaticky nedozví – dejte mu vědět.'))return;api('/admin/api/meetings/reservations/'+b.getAttribute('data-rs'),{status:st}).then(done).catch(function(e){msg(e.message);});};});
}
function autoModal(){
  var ov=modal('<h3>⚙ Automatické uvolňování termínů</h3><div class="muted small">Systém sám vypisuje termíny na zadaný počet pracovních dnů dopředu (So, Ne a státní svátky se přeskakují). Každý den se vygeneruje jednou – termín, který pak smažete nebo upravíte, se znovu nevytvoří.</div><div class="mt-msg">Načítám…</div>');
  var q=function(c){return ov.querySelector(c);};
  api('/admin/api/meetings/auto').then(function(j){var c=j.config||{},st=j.status||{};
    q('.mt-msg').outerHTML='<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" class="a-en" style="width:auto"'+(c.enabled?' checked':'')+'> Zapnout automatické uvolňování</label>'
     +'<div class="mt-row"><div><label>Pracovních dnů dopředu</label><input type="number" class="a-wd" min="1" max="30" value="'+c.workdays+'"></div><div><label>Kapacita termínu (kolik lidí vyřizuje)</label><input type="number" class="a-cap" min="1" max="50" value="'+c.capacity+'"></div></div>'
     +'<div class="mt-row"><div><label>Od (první termín)</label><input type="time" class="a-from" value="'+esc(c.from)+'"></div><div><label>Do (konec posledního okna)</label><input type="time" class="a-to" value="'+esc(c.to)+'"></div></div>'
     +'<div class="mt-row"><div><label>Krok oken (min)</label><input type="number" class="a-step" min="5" max="240" value="'+c.step+'"></div><div><label>Délka schůzky (min)</label><input type="number" class="a-dur" min="5" max="480" value="'+c.duration_min+'"></div></div>'
     +'<label>Forma</label><select class="a-mode"><option value="">online i osobně (zájemce si vybere)</option><option value="online"'+(c.mode==='online'?' selected':'')+'>jen online</option><option value="osobne"'+(c.mode==='osobne'?' selected':'')+'>jen osobně</option></select>'
     +'<label>Poznámka (interní)</label><input class="a-note" value="'+esc(c.note||'')+'" placeholder="např. Tomáš + Jan">'
     +'<div class="muted small" style="margin-top:8px">Příklad: 10:00–18:00 po 30 min = termíny 10:00, 10:30 … 17:30. Kapacita 2 = ve stejný čas si mohou domluvit schůzku dva zájemci.'+(st.last_run?'<br>Naposledy běželo: '+new Date(st.last_run).toLocaleString('cs-CZ')+' (vytvořeno '+(st.last_created||0)+').':'')+'</div>'
     +'<div class="mt-act"><button class="btn a-save">Uložit</button><button class="btn sec a-run">Uvolnit teď</button></div><div class="mt-msg"></div>';
    var msg=function(t){q('.mt-msg').textContent=t;};
    var body=function(){return {enabled:q('.a-en').checked,workdays:+q('.a-wd').value,capacity:+q('.a-cap').value,from:q('.a-from').value,to:q('.a-to').value,step:+q('.a-step').value,duration_min:+q('.a-dur').value,mode:q('.a-mode').value||null,note:q('.a-note').value};};
    q('.a-save').onclick=function(){this.disabled=true;msg('Ukládám…');api('/admin/api/meetings/auto',body()).then(function(r){msg('Uloženo.'+(r.config&&r.config.enabled?' Nově vytvořeno termínů: '+(r.created||0)+'.':''));q('.a-save').disabled=false;load();}).catch(function(e){msg(e.message);q('.a-save').disabled=false;});};
    q('.a-run').onclick=function(){this.disabled=true;msg('Uvolňuji…');api('/admin/api/meetings/auto',body()).then(function(){return api('/admin/api/meetings/auto/run',{});}).then(function(r){msg('Hotovo. Nově vytvořeno termínů: '+(r.created||0)+'.');q('.a-run').disabled=false;load();}).catch(function(e){msg(e.message);q('.a-run').disabled=false;});};
  }).catch(function(e){q('.mt-msg').textContent=e.message;});
}
// Kazda tabulka v administraci se filtruje a radi stejne jako tabulky v HolyOS:
// sdilena komponenta ColFilters (servirovana z /admin/column-filters.js). Staci zavolat
// dtable() a tabulka ma radek filtru, trojstavove razeni i pocitadlo radku.
// Kdyby se komponenta nenacetla, vraci null a volajici vykresli prostou tabulku.
function dtable(sel,cols,renderRow,noun,emptyText){
  if(!window.ColFilters)return null;
  return window.ColFilters.table({table:function(){return root.querySelector(sel);},
    columns:cols,renderRow:renderRow,progressive:true,noun:noun,emptyText:emptyText});
}
// ── Jmenný seznam — kontakty označené v HolyOS jako „zajímavý kontakt“ ──
// Filtry, řazení i počítadlo řádků dělá sdílená komponenta HolyOS (ColFilters,
// /js/column-filters.js), aby se tabulka ovládala přesně stejně jako tabulky v HolyOS.
// Kdyby se skript nenačetl (HolyOS nedostupný), vykreslí se aspoň prostá tabulka.
var hot=null, hotT=null;
function hotLoad(){
  var box=root.querySelector('.mt-hotwrap');
  box.innerHTML='<div class="mt-empty">Načítám…</div>';
  api('/admin/api/hot-leads').then(function(j){hot=j.leads||[];hotRender();})
    .catch(function(e){box.innerHTML='<div class="mt-empty" style="color:#ff8f8f">'+esc(e.message)+'</div>';});
}
function hcell(v){return '<td>'+(v?esc(v):'<span class="muted">—</span>')+'</td>';}
// Jeden kontakt = jeden řádek: každý údaj má vlastní sloupec, nic se neláme pod sebe.
function hotRow(l){
  return '<tr><td><span class="nm">⭐ '+esc(l.name)+'</span>'+(l.only_polish?' <span class="mt-pill">🇵🇱 jen polsky</span>':'')+'</td>'
    +hcell(l.company)+hcell(l.city)
    +'<td>'+(l.phone?'<a href="tel:'+esc(l.phone)+'">'+esc(l.phone)+'</a>':'<span class="muted">—</span>')+'</td>'
    +'<td>'+(l.email?'<a href="mailto:'+esc(l.email)+'">'+esc(l.email)+'</a>':'<span class="muted">—</span>')+'</td>'
    +'<td><span class="mt-pill">'+esc(ST2[l.status]||l.status||'—')+'</span></td>'
    +hcell(l.owner)
    +'<td>'+(l.last_called_at?dlong(new Date(l.last_called_at)):'<span class="muted">nevoláno</span>')+'</td></tr>';
}
function hotRender(){
  var box=root.querySelector('.mt-hotwrap');
  if(!hot){box.innerHTML='';return;}
  if(!hot.length){box.innerHTML='<div class="mt-empty">Zatím není žádný kontakt označený jako zajímavý. Označuje se hvězdičkou v kartě kontaktu v HolyOS.</div>';return;}
  box.innerHTML='<div class="mt-tw"><table class="hot-dt"><thead><tr>'
    +'<th>Jméno</th><th>Firma</th><th>Město</th><th>Telefon</th><th>E-mail</th><th>Stav</th><th>Obchodník</th><th>Naposledy voláno</th>'
    +'</tr></thead><tbody></tbody></table></div>';
  if(!window.ColFilters){box.querySelector('tbody').innerHTML=hot.map(hotRow).join('');return;}
  hotT=dtable('.hot-dt',[
      {key:'name',label:'Jméno',get:function(l){return l.name||'';},ph:'Jméno…',enum:false},
      {key:'company',label:'Firma',get:function(l){return l.company||'';},ph:'Firma…'},
      {key:'city',label:'Město',get:function(l){return l.city||'';},ph:'Město…'},
      {key:'phone',label:'Telefon',get:function(l){return l.phone||'';},ph:'Telefon…',enum:false},
      {key:'email',label:'E-mail',get:function(l){return l.email||'';},ph:'E-mail…',enum:false},
      {key:'status',label:'Stav',get:function(l){return ST2[l.status]||l.status||'';},ph:'Vyber…',enum:true},
      {key:'owner',label:'Obchodník',get:function(l){return l.owner||'';},ph:'Vyber…',enum:true},
      {key:'last_called_at',label:'Naposledy voláno',type:'date',get:function(l){return l.last_called_at||null;}}
    ],hotRow,'kontaktů','Zatím není žádný kontakt označený jako zajímavý.');
  hotT.setRows(hot);
}
// ── Uživatelé — účty registrované na laundromats.eu (/cesta/registrace) ──
var usr=null, usrT=null;
function usrLoad(){
  var box=root.querySelector('.mt-usrwrap');
  box.innerHTML='<div class="mt-empty">Načítám…</div>';
  api('/admin/api/users').then(function(j){usr=j.users||[];usrRender();})
    .catch(function(e){box.innerHTML='<div class="mt-empty" style="color:#ff8f8f">'+esc(e.message)+'</div>';});
}
function dtm(v){if(!v)return '<span class="muted">—</span>';var d=new Date(v);return dlong(d)+' '+hm(d);}
function usrRow(u){
  var lead=u.compounder_lead_id&&window.LM_HOLYOS?'<a href="'+window.LM_HOLYOS+'/modules/prodejni-objednavky/index.html?lead='+u.compounder_lead_id+'" target="_blank" rel="noopener" class="small">kontakt #'+u.compounder_lead_id+' ↗</a>':(u.compounder_lead_id?'<span class="small muted">#'+u.compounder_lead_id+'</span>':'<span class="muted">—</span>');
  return '<tr'+(u.disabled?' style="opacity:.55"':'')+'><td><span class="nm">'+esc(u.name)+'</span></td>'
    +'<td><a href="mailto:'+esc(u.email)+'">'+esc(u.email)+'</a></td>'
    +'<td>'+(u.phone?'<a href="tel:'+esc(u.phone)+'">'+esc(u.phone)+'</a>':'<span class="muted">—</span>')+'</td>'
    +hcell(u.company)
    +'<td>'+dtm(u.created_at)+'</td>'
    +'<td>'+(u.email_verified_at?'<span class="mt-pill" style="color:#4ade80;border-color:#4ade80">ověřen</span>':'<span class="mt-pill" style="color:#ffd866;border-color:#ffd866">čeká na ověření</span>')+'</td>'
    +'<td>'+dtm(u.last_login_at)+'</td><td style="text-align:right">'+(u.login_count||0)+'</td>'
    +'<td>'+lead+'</td>'
    +'<td><button class="btn sec sm" data-udis="'+u.id+'" data-on="'+(u.disabled?0:1)+'"'+(u.disabled?'':' style="color:#ff8f8f"')+'>'+(u.disabled?'Odblokovat':'Zablokovat')+'</button></td></tr>';
}
function usrRender(){
  var box=root.querySelector('.mt-usrwrap');
  if(!usr){box.innerHTML='';return;}
  var ver=usr.filter(function(u){return u.email_verified_at;}).length;
  root.querySelector('.mt-usrsum').textContent=usr.length?('Celkem '+usr.length+' · ověřených '+ver+' · zablokovaných '+usr.filter(function(u){return u.disabled;}).length):'';
  if(!usr.length){box.innerHTML='<div class="mt-empty">Zatím se nikdo nezaregistroval. Registrace je na laundromats.eu/cesta/registrace.</div>';return;}
  box.innerHTML='<div class="mt-tw"><table class="usr-dt"><thead><tr><th>Jméno</th><th>E-mail</th><th>Telefon</th><th>Firma</th><th>Registrace</th><th>Ověření</th><th>Poslední přihlášení</th><th>Přihlášení</th><th>Kontakt v HolyOS</th><th></th></tr></thead><tbody></tbody></table></div>';
  if(!window.ColFilters){box.querySelector('tbody').innerHTML=usr.map(usrRow).join('');return;}
  usrT=dtable('.usr-dt',[
      {key:'name',label:'Jméno',get:function(u){return u.name||'';},ph:'Jméno…',enum:false},
      {key:'email',label:'E-mail',get:function(u){return u.email||'';},ph:'E-mail…',enum:false},
      {key:'phone',label:'Telefon',get:function(u){return u.phone||'';},ph:'Telefon…',enum:false},
      {key:'company',label:'Firma',get:function(u){return u.company||'';},ph:'Firma…'},
      {key:'created_at',label:'Registrace',type:'date',get:function(u){return u.created_at||null;}},
      {key:'verified',label:'Ověření',get:function(u){return u.email_verified_at?'ověřen':'čeká na ověření';},ph:'Vyber…',enum:true},
      {key:'last_login_at',label:'Poslední přihlášení',type:'date',get:function(u){return u.last_login_at||null;}},
      {key:'login_count',label:'Přihlášení',type:'number',get:function(u){return u.login_count||0;}},
      {key:'lead',label:'Kontakt v HolyOS',get:function(u){return u.compounder_lead_id?String(u.compounder_lead_id):'';},enum:false},
      {key:'act',label:'',get:function(u){return u.disabled?'zablokovaný':'aktivní';},enum:true}
    ],usrRow,'uživatelů','Žádný uživatel.');
  usrT.setRows(usr);
}
root.addEventListener('click',function(e){var b=e.target.closest('[data-udis]');if(!b)return;e.stopPropagation();var id=+b.getAttribute('data-udis'),dis=b.getAttribute('data-on')==='1';
  if(dis&&!confirm('Zablokovat účet? Uživatel se odhlásí a nebude se moci přihlásit.'))return;b.disabled=true;
  api('/admin/api/users/'+id+'/disabled',{disabled:dis}).then(function(){(usr||[]).forEach(function(u){if(u.id===id)u.disabled=dis;});usrRender();}).catch(function(er){b.disabled=false;alert(er.message);});},true);
root.querySelector('.mt-usrreload').onclick=usrLoad;
// Přepínání záložek. Seznam se tahá ze serveru až při prvním otevření.
function tab(name){
  var isHot=name==='hot', isUsr=name==='usr';
  root.querySelectorAll('.mt-tabs button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-tab')===name);});
  root.querySelector('.mt-meet').style.display=(isHot||isUsr)?'none':'';
  root.querySelector('.mt-hot').style.display=isHot?'':'none';
  root.querySelector('.mt-usr').style.display=isUsr?'':'none';
  if(isHot&&hot===null)hotLoad();
  if(isUsr&&usr===null)usrLoad();
}
root.querySelectorAll('.mt-tabs button').forEach(function(b){b.onclick=function(){tab(b.getAttribute('data-tab'));};});

root.querySelector('.mt-auto').onclick=autoModal;
root.addEventListener('click',function(e){var a=e.target.closest('[data-add]');if(a){e.stopPropagation();return addModal(a.getAttribute('data-add'));}var s=e.target.closest('[data-slot]');if(s)slotModal(+s.getAttribute('data-slot'));});
root.querySelector('.mt-prev').onclick=function(){week--;render();if(week<-1)load();};
root.querySelector('.mt-next').onclick=function(){week++;if(week>7)load();else render();};
root.querySelector('.mt-today').onclick=function(){week=0;load();};
root.querySelector('.mt-new').onclick=function(){addModal(null);};
load();
})();`;

const LAYOUT_CSS = `
:root{--bg:#04060c;--surface2:#0d1426;--card:rgba(14,22,42,.85);--border:rgba(120,160,255,.16);--border2:rgba(120,160,255,.28);--text:#e8f0ff;--text2:#8ea2c2;--text3:#58698a;--blue:#4fd1ff;--err:#ff5d6c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:14.5px;line-height:1.5}
a{color:var(--blue)}.wrap{max-width:1400px;margin:0 auto;padding:0 20px 60px}
.top{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--border);background:rgba(8,13,26,.9);margin-bottom:22px}
.top b{font-size:17px}.top b span{color:var(--blue)}.top .sp{flex:1}.top .who{color:var(--text2);font-size:13px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-top:16px}
.btn{background:linear-gradient(90deg,#1e86e0,#7c5cff);color:#fff;border:none;border-radius:10px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}
.btn.sec,.btn.btn-secondary{background:transparent;border:1px solid var(--border2);color:var(--text)}.btn.sm,.btn.btn-sm{padding:5px 11px;font-size:13px}.btn:disabled{opacity:.5}
.muted{color:var(--text2)}.small{font-size:12.5px}`;

function meetingsPage({ admin, holyosUrl, error }) {
  const nm = String((admin && admin.name) || '').replace(/[<>&"]/g, '');
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Schůzky · Laundromats</title><style>${LAYOUT_CSS}</style></head><body>
  <div class="top"><b>Laundromats<span>.eu</span></b><span class="muted">Administrace schůzek</span><span class="sp"></span><span class="who">${nm}</span>${holyosUrl ? `<a href="${holyosUrl}" class="small">← HolyOS</a>` : ''}<a href="/admin/logout" class="small">Odhlásit</a></div>
  <div class="wrap"><style>${CSS}</style>
  <div id="mt">
    <div class="mt-tabs"><button data-tab="meet" class="on">📅 Schůzky</button><button data-tab="hot">⭐ Jmenný seznam</button><button data-tab="usr">👤 Uživatelé</button></div>
    <div class="mt-meet">
    <div class="mt-bar"><h2>📅 Kalendář schůzek</h2>
      <button class="btn sec sm mt-prev">←</button><span class="mt-range"></span><button class="btn sec sm mt-next">→</button>
      <button class="btn sec sm mt-today">Dnes</button><span style="flex:1"></span><button class="btn sec sm mt-auto" title="Automatické vypisování termínů dopředu">⚙ Automatika</button><button class="btn sm mt-new">+ Přidat termíny</button></div>
    <p class="muted small" style="margin:-6px 0 14px">Termíny, které tady vypíšete, si zájemci rezervují na <a href="/cesta" target="_blank">laundromats.eu/cesta</a>. Data jsou společná s HolyOS → Prodejní objednávky → Termíny.</p>
    ${error ? `<div class="card" style="border-color:var(--err);color:#ff8f8f">${error}</div>` : ''}
    <div class="mt-sum"></div>
    <div class="mt-weekwrap"></div>
    <div class="mt-up card"></div>
    </div>
    <div class="mt-hot" style="display:none">
      <div class="mt-bar"><h2>⭐ Jmenný seznam</h2></div>
      <p class="muted small" style="margin:-6px 0 14px">Kontakty, které jsou v HolyOS označené jako <b>zajímavý kontakt</b> (hvězdička v kartě kontaktu). Seznam se bere živě z HolyOS.</p>
      <div class="mt-hotwrap card"></div>
    </div>
    <div class="mt-usr" style="display:none">
      <div class="mt-bar"><h2>👤 Uživatelé</h2><span style="flex:1"></span><span class="muted small mt-usrsum"></span><button class="btn sec sm mt-usrreload">↻ Obnovit</button></div>
      <p class="muted small" style="margin:-6px 0 14px">Účty registrované na <a href="/cesta/registrace" target="_blank">laundromats.eu/cesta/registrace</a> – mají přístup ke Compounderu, Prádlomatům, Ekonomice, Najít místo a Zhodnotit místo. Každá registrace se zároveň spáruje s kontaktem v HolyOS.</p>
      <div class="mt-usrwrap card"></div>
    </div>
  </div></div>
  <script src="/admin/column-filters.js"></script>
  <script>window.LM_HOLYOS=${JSON.stringify(holyosUrl || '')};</script><script>${JS}</script></body></html>`;
}

module.exports = { meetingsPage };
