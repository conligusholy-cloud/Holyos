(function(){
var root=document.getElementById('mt'),P=root&&root.querySelector('.mt-mp');if(!P)return;
var D=null,U=[],showHid=false;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function dt(v){if(!v)return '–';var d=new Date(v);return isNaN(d)?'–':d.toLocaleDateString('cs-CZ')+' '+d.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'});}
function api(url,body){var o=body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{};
  return fetch(url,o).then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok||j.ok===false)throw new Error(j.error||('Chyba '+r.status));return j;});});}
function kpi(l,v){return '<div class="card" style="flex:1;min-width:130px;padding:12px"><div class="muted small">'+l+'</div><div style="font-size:24px;font-weight:700">'+v+'</div></div>';}
// Tabulka lokalit: standardní lišta filtrů a řazení (ColFilters z HolyOS); bez komponenty prostá tabulka
var LT=null;
function ano(b){return b?'ano':'ne';}
function ltRow(l){
  var rent=l.rent_monthly!=null?(Number(l.rent_monthly).toLocaleString('cs-CZ')+' '+esc(l.rent_currency)+' '+(l.rent_vat==='s'?'s DPH':'bez DPH')):'–';
  var warn=[];if(!l.title)warn.push('chybí název');if(!l.has_cover)warn.push('bez titulní fotky');if(!l.address)warn.push('bez adresy');
  return '<tr style="border-top:1px solid var(--line,#333)'+(l.sold?';opacity:.75':'')+'"><td style="padding:6px 8px"><b>'+esc(l.title||l.name)+'</b><div class="muted small">'+esc(l.name)+(l.city?' · '+esc(l.city):'')+' · '+esc(l.code)+'</div>'+(warn.length?'<div class="small" style="color:#e6a23c">⚠ '+esc(warn.join(', '))+'</div>':'')+'</td>'
    +'<td style="padding:6px 8px;white-space:nowrap">'+rent+'</td><td style="padding:6px 8px">'+(l.gallery!=null?l.gallery:l.photos)+'</td>'
    +'<td style="padding:6px 8px"><label><input type="checkbox" data-mpp="'+l.id+'"'+(l.published?' checked':'')+'> ano</label></td>'
    +'<td style="padding:6px 8px"><label><input type="checkbox" data-mpr="'+l.id+'"'+(l.reserved?' checked':'')+(l.sold?' disabled':'')+'> ano</label></td>'
    +'<td style="padding:6px 8px"><label style="'+(l.sold?'color:#f87171;font-weight:700':'')+'"><input type="checkbox" data-mps="'+l.id+'"'+(l.sold?' checked':'')+'> '+(l.sold?'prodáno':'ano')+'</label></td>'
    +'<td style="padding:6px 8px"><label><input type="checkbox" data-mpt="'+l.id+'"'+(l.public_teaser?' checked':'')+'> ano</label></td>'
    +'<td style="padding:6px 8px">'+l.interests+'</td><td style="padding:6px 8px">'+dt(l.last_interest)+'</td><td style="padding:6px 8px;text-align:right"><button class="btn sec sm" data-mpd="'+l.id+'">Detail</button></td></tr>';
}
function ltable(){
  if(LT)return LT;
  if(!window.ColFilters){LT={setRows:function(rows){var tb=P.querySelector('.mp-lt tbody');if(tb)tb.innerHTML=rows.map(ltRow).join('');}};return LT;}
  LT=window.ColFilters.table({table:function(){return P.querySelector('.mp-lt');},progressive:true,noun:'lokalit',emptyText:'Žádné lokality.',renderRow:ltRow,columns:[
    {key:'lok',label:'Lokalita',type:'text',ph:'Název / město / kód…',get:function(l){return [l.title,l.name,l.city,l.code].filter(Boolean).join(' ');}},
    {key:'najem',label:'Nájem',type:'num',get:function(l){return l.rent_monthly;}},
    {key:'fotky',label:'Fotky',type:'num',get:function(l){return l.gallery!=null?l.gallery:l.photos;}},
    {key:'nab',label:'Nabízí se',type:'enum',get:function(l){return ano(l.published);}},
    {key:'rez',label:'Rezervováno',type:'enum',get:function(l){return ano(l.reserved);}},
    {key:'prod',label:'Prodáno',type:'enum',get:function(l){return ano(l.sold);}},
    {key:'ver',label:'Veřejně',type:'enum',get:function(l){return ano(l.public_teaser);}},
    {key:'zaj',label:'Zájem',type:'num',get:function(l){return l.interests;}},
    {key:'last',label:'Poslední zájem',type:'date',get:function(l){return l.last_interest;}},
    null]});
  return LT;
}
function render(){
  var k=D.kpi,h='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">'+kpi('Nabízí se',k.published)+kpi('Rezervováno',k.reserved)+kpi('Prodáno',k.sold||0)+kpi('Skryto',k.hidden)+kpi('Uživatelů s přístupem',k.users_with_access)+kpi('Zobrazení (30 d)',k.views_30d)+kpi('Návštěvníků (30 d)',k.viewers_30d)+kpi('Zájem (30 d)',k.interests_30d)+'</div>';
  var ST={new:'Nový',contacted:'Kontaktován',negotiating:'Jednáme',won:'Prodáno (zmizí z nabídky)',lost:'Zrušeno (vrátí se do nabídky)'};
  h+='<div class="card" style="margin-bottom:14px;overflow:auto"><h3 style="margin:0 0 8px">Rezervace a závazné zájmy ('+(D.requests||[]).length+')</h3>';
  if(!(D.requests||[]).length)h+='<p class="muted small">Zatím žádný závazný zájem. Objeví se tu poté, co zákazník dvakrát potvrdí „Mám zájem“.</p>';
  else h+='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left" class="muted"><th>Vznik</th><th>Lokalita</th><th>Zájemce</th><th>Stav</th><th>Poznámka</th></tr></thead><tbody>'+D.requests.map(function(r){
    var opts=Object.keys(ST).map(function(k){return '<option value="'+k+'"'+(r.status===k?' selected':'')+'>'+ST[k]+'</option>';}).join('');
    return '<tr style="border-top:1px solid var(--line,#333);vertical-align:top"><td style="padding:6px 8px;white-space:nowrap">'+dt(r.created_at)+'</td><td style="padding:6px 8px"><b>'+esc(r.place)+'</b><div class="muted small">'+esc(r.code)+'</div></td>'
      +'<td style="padding:6px 8px"><b>'+esc(r.name||r.email)+'</b><div class="muted small">'+esc([r.phone,r.email,r.company].filter(Boolean).join(' · '))+'</div></td>'
      +'<td style="padding:6px 8px"><select data-rst="'+esc(r.id)+'">'+opts+'</select></td>'
      +'<td style="padding:6px 8px"><textarea data-rnote="'+esc(r.id)+'" rows="2" style="width:100%;min-width:180px" placeholder="Poznámka…">'+esc(r.note||'')+'</textarea></td></tr>';}).join('')+'</tbody></table>';
  h+='</div>';
  h+='<div class="card" style="margin-bottom:14px;overflow:auto"><h3 style="margin:0 0 8px">Lokality v nabídce</h3><label class="small muted" style="display:block;margin:-4px 0 8px"><input type="checkbox" data-mphid="1"'+(showHid?' checked':'')+'> Zobrazit i skryté ('+k.hidden+')</label>';
  var LS=D.listings.filter(function(l){return showHid||l.published;});
  if(!LS.length)h+='<p class="muted small">Žádná lokalita se zatím nenabízí. Zapněte „Nabízí se“ v HolyOS → Site Development → Marketplace.</p>';
  else h+='<table class="mp-lt" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left" class="muted"><th>Lokalita</th><th>Nájem</th><th>Fotky</th><th>Nabízí se</th><th>Rezervováno</th><th title="Prodáno — v Marketplace zůstane přeškrtnuté s nálepkou PRODÁNO">Prodáno</th><th title="Zobrazit v rozmazané veřejné ukázce bez přihlášení">Veřejně</th><th>Zájem</th><th>Poslední zájem</th><th></th></tr></thead><tbody></tbody></table>';
  h+='<p class="muted small" style="margin:8px 0 0">Obsah (popis, fotky, ceny) se upravuje v HolyOS → Site Development → záložka Marketplace.'+(window.LM_HOLYOS?' <a href="'+esc(window.LM_HOLYOS)+'/modules/site-development/index.html" target="_blank">Otevřít</a>':'')+'</p></div>';
  h+='<div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 8px">Uživatelé s přístupem</h3>';
  if(!D.access.length)h+='<p class="muted small">Nikdo zatím přístup nemá.</p>';
  else h+=D.access.map(function(a){return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--line,#333)"><span style="flex:1"><b>'+esc(a.name||a.email)+'</b> <span class="muted small">'+esc(a.email||'')+(a.company?' · '+esc(a.company):'')+(a.disabled?' · zablokován':'')+'</span></span><button class="btn sec sm" data-mpa="'+a.id+'">Odebrat</button></div>';}).join('');
  h+='<div style="display:flex;gap:8px;margin-top:10px"><select class="mp-add" style="flex:1"><option value="">+ Přidat uživatele…</option>';
  U.forEach(function(u){if(!D.access.some(function(a){return a.id===u.id;}))h+='<option value="'+u.id+'">'+esc((u.name||u.email||('#'+u.id))+(u.email&&u.name?' – '+u.email:''))+'</option>';});
  h+='</select><button class="btn sm" data-mpadd="1">Povolit</button></div></div>';
  h+='<div class="card"><h3 style="margin:0 0 8px">Poslední „Mám zájem“</h3>';
  if(!D.interests.length)h+='<p class="muted small">Zatím žádný zájem.</p>';
  else{var by={};D.listings.forEach(function(l){by[l.code]=l;});
    h+='<table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>'+D.interests.map(function(i){var l=by[i.code],w=i.who;
      return '<tr style="border-top:1px solid var(--line,#333)"><td style="padding:5px 8px;white-space:nowrap">'+dt(i.at)+'</td><td style="padding:5px 8px">'+esc(l?(l.title||l.name):i.code)+'</td><td style="padding:5px 8px">'+(w?'<b>'+esc(w.name||w.email)+'</b> <span class="muted small">'+esc([w.email,w.phone,w.company].filter(Boolean).join(' · '))+'</span>':'<span class="muted">neznámý návštěvník</span>')+'</td></tr>';}).join('')+'</tbody></table>';}
  h+='</div>';
  P.querySelector('.mp-body').innerHTML=h;
  if(LS.length)ltable().setRows(LS);
}
function load(){var b=P.querySelector('.mp-body');if(!D)b.innerHTML='<p class="muted">Načítám…</p>';
  Promise.all([api('/admin/api/marketplace'),api('/admin/api/users').catch(function(){return {users:[]};})]).then(function(r){D=r[0];U=r[1].users||[];render();}).catch(function(e){b.innerHTML='<div class="card" style="color:#ff8f8f">'+esc(e.message)+'</div>';});}
function row(l,v){return '<div style="display:flex;gap:12px;padding:7px 0;border-bottom:1px solid var(--line,#2a3350)"><span class="muted" style="width:150px;flex:none">'+l+'</span><span style="flex:1">'+(v==null||v===''?'<span class="muted">neuvedeno</span>':v)+'</span></div>';}
function closeDet(){var o=document.getElementById('mp-det');if(o)o.remove();document.removeEventListener('keydown',escDet);}
function escDet(e){if(e.key==='Escape')closeDet();}
function openDet(id){
  var l=(D.listings||[]).filter(function(x){return x.id===id;})[0];if(!l)return;var d=l.detail||{};
  var maps=d.address?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(d.address):'';
  var rent=l.rent_monthly!=null?(Number(l.rent_monthly).toLocaleString('cs-CZ')+' '+esc(l.rent_currency)+' '+(l.rent_vat==='s'?'s DPH':'bez DPH')):null;
  var cp=d.connections_price,cpTxt=cp?(/^[\d\s.,]+$/.test(String(cp))?Number(String(cp).replace(/\s/g,'').replace(',','.')).toLocaleString('cs-CZ')+' Kč bez DPH':esc(cp)):null;
  var ph=(d.photos||[]).map(function(pid,i){var u='/admin/api/marketplace/photo/'+l.id+'?p='+pid;return '<a href="'+u+'" target="_blank" rel="noopener" style="position:relative;display:block;width:150px;height:100px;border-radius:8px;overflow:hidden;border:1px solid '+(i===0?'#14b8a6':'var(--line,#2a3350)')+'"><img src="'+u+'" alt="" style="width:100%;height:100%;object-fit:cover">'+(i===0?'<span style="position:absolute;left:4px;top:4px;background:#14b8a6;color:#04130a;font-size:10px;font-weight:800;padding:1px 6px;border-radius:999px">NÁHLED</span>':'')+'</a>';}).join('');
  var ints=(D.interests||[]).filter(function(i){return i.code===l.code;});
  var reqs=(D.requests||[]).filter(function(r){return r.code===l.code;});
  var ST={new:'Nový',contacted:'Kontaktován',negotiating:'Jednáme',won:'Prodáno',lost:'Zrušeno'};
  var h='<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><h2 style="margin:0;font-size:19px;flex:1">'+esc(l.title||l.name)+'</h2>'
    +'<span style="padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:'+(l.reserved?'#f59e0b33;color:#f59e0b':(l.published?'#22c55e33;color:#22c55e':'#64748b33;color:#94a3b8'))+'">'+(l.reserved?'Rezervováno':(l.published?'Nabízí se':'Skryto'))+'</span>'
    +'<button class="btn sec sm" data-mpdx>✕</button></div>'
    +'<div class="muted small" style="margin-bottom:10px">'+esc(l.name)+(l.city?' · '+esc(l.city):'')+' · '+esc(l.code)+(l.updated_at?' · uloženo '+dt(l.updated_at):'')+'</div>'
    +(ph?'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+ph+'</div>':'')
    +row('Lákadlo',esc(d.highlight))+row('Popis','<span style="white-space:pre-line">'+esc(d.description)+'</span>')
    +row('Adresa',d.address?esc(d.address)+' · <a href="'+maps+'" target="_blank" rel="noopener">Google Mapy ↗</a>':null)
    +row('Plocha',d.area_m2!=null?esc(d.area_m2)+' m²':null)+row('Nájem / měsíc',rent)+row('Energie',esc(d.energy))+row('Cena přípojek',cpTxt)
    +row('Obsadit do',d.occupy_until?new Date(d.occupy_until+'T12:00:00').toLocaleDateString('cs-CZ'):null)
    +row('Parkování',esc(d.parking))+row('Dostupnost',esc(d.availability))+row('Cena / podmínky',esc(d.price_note))
    +'<h3 style="margin:14px 0 6px;font-size:14px">Zájem ('+ints.length+')</h3>'
    +(ints.length?ints.slice(0,15).map(function(i){return '<div class="small" style="padding:3px 0">'+dt(i.at)+' · '+(i.who?'<b>'+esc(i.who.name||i.who.email)+'</b> <span class="muted">'+esc([i.who.email,i.who.phone,i.who.company].filter(Boolean).join(' · '))+'</span>':'<span class="muted">neznámý návštěvník</span>')+'</div>';}).join(''):'<div class="muted small">Zatím nikdo.</div>')
    +'<h3 style="margin:14px 0 6px;font-size:14px">Rezervace / závazné zájmy ('+reqs.length+')</h3>'
    +(reqs.length?reqs.map(function(r){return '<div class="small" style="padding:3px 0">'+dt(r.created_at)+' · <b>'+esc(r.name||r.email)+'</b> <span class="muted">'+esc([r.phone,r.email,r.company].filter(Boolean).join(' · '))+'</span> · '+esc(ST[r.status]||r.status)+(r.note?' · '+esc(r.note):'')+'</div>';}).join(''):'<div class="muted small">Žádná.</div>')
    +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">'+(window.LM_HOLYOS?'<a class="btn sec sm" href="'+esc(window.LM_HOLYOS)+'/modules/site-development/index.html" target="_blank" rel="noopener">Upravit v HolyOS ↗</a>':'')+'<button class="btn sm" data-mpdx>Zavřít</button></div>';
  closeDet();
  var ov=document.createElement('div');ov.id='mp-det';ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 12px';
  ov.innerHTML='<div class="card" style="width:760px;max-width:100%;margin:0">'+h+'</div>';
  ov.addEventListener('click',function(e){if(e.target===ov||e.target.closest('[data-mpdx]'))closeDet();});
  document.body.appendChild(ov);document.addEventListener('keydown',escDet);
}
P.addEventListener('change',function(e){var t=e.target;
  if(t.hasAttribute('data-mphid')){showHid=t.checked;render();return;}
  if(t.hasAttribute('data-rst')){api('/admin/api/marketplace/request/'+encodeURIComponent(t.getAttribute('data-rst')),{status:t.value}).then(load).catch(function(er){alert(er.message);load();});return;}
  if(t.hasAttribute('data-rnote')){api('/admin/api/marketplace/request/'+encodeURIComponent(t.getAttribute('data-rnote')),{note:t.value}).then(function(){t.style.outline='1px solid #3c9';setTimeout(function(){t.style.outline='';},900);}).catch(function(er){alert(er.message);});return;}
  var id=t.getAttribute('data-mpp')||t.getAttribute('data-mpr')||t.getAttribute('data-mpt')||t.getAttribute('data-mps');if(!id)return;
  var body={};if(t.hasAttribute('data-mpp'))body.published=t.checked;else if(t.hasAttribute('data-mpt'))body.public_teaser=t.checked;else if(t.hasAttribute('data-mps'))body.sold=t.checked;else body.reserved=t.checked;
  api('/admin/api/marketplace/'+id,body).then(load).catch(function(er){alert(er.message);load();});});
P.addEventListener('click',function(e){var dd=e.target.closest('[data-mpd]');if(dd){openDet(+dd.getAttribute('data-mpd'));return;}
  var a=e.target.closest('[data-mpa]');
  if(a){api('/admin/api/users/'+a.getAttribute('data-mpa')+'/marketplace',{on:false}).then(load).catch(function(er){alert(er.message);});return;}
  if(e.target.closest('[data-mpadd]')){var v=P.querySelector('.mp-add').value;if(!v)return;api('/admin/api/users/'+v+'/marketplace',{on:true}).then(load).catch(function(er){alert(er.message);});return;}
  if(e.target.closest('.mp-reload'))load();});
window.__lmMpLoad=function(){load();};
})();
