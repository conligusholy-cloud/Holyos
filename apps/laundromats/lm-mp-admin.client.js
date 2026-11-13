(function(){
var root=document.getElementById('mt'),P=root&&root.querySelector('.mt-mp');if(!P)return;
var D=null,U=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function dt(v){if(!v)return '–';var d=new Date(v);return isNaN(d)?'–':d.toLocaleDateString('cs-CZ')+' '+d.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'});}
function api(url,body){var o=body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{};
  return fetch(url,o).then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok||j.ok===false)throw new Error(j.error||('Chyba '+r.status));return j;});});}
function kpi(l,v){return '<div class="card" style="flex:1;min-width:130px;padding:12px"><div class="muted small">'+l+'</div><div style="font-size:24px;font-weight:700">'+v+'</div></div>';}
function render(){
  var k=D.kpi,h='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">'+kpi('Nabízí se',k.published)+kpi('Rezervováno',k.reserved)+kpi('Skryto',k.hidden)+kpi('Uživatelů s přístupem',k.users_with_access)+kpi('Zobrazení (30 d)',k.views_30d)+kpi('Návštěvníků (30 d)',k.viewers_30d)+kpi('Zájem (30 d)',k.interests_30d)+'</div>';
  h+='<div class="card" style="margin-bottom:14px;overflow:auto"><h3 style="margin:0 0 8px">Lokality</h3>';
  if(!D.listings.length)h+='<p class="muted small">Zatím žádná lokalita nemá vyplněná data pro Marketplace. Vyplňte je v HolyOS → Site Development → Marketplace.</p>';
  else{h+='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left" class="muted"><th>Lokalita</th><th>Nájem</th><th>Fotky</th><th>Nabízí se</th><th>Rezervováno</th><th>Zájem</th><th>Poslední zájem</th></tr></thead><tbody>';
    D.listings.forEach(function(l){
      var rent=l.rent_monthly!=null?(Number(l.rent_monthly).toLocaleString('cs-CZ')+' '+esc(l.rent_currency)+' '+(l.rent_vat==='s'?'s DPH':'bez DPH')):'–';
      var warn=[];if(!l.title)warn.push('chybí název');if(!l.has_cover)warn.push('bez titulní fotky');if(!l.address)warn.push('bez adresy');
      h+='<tr style="border-top:1px solid var(--line,#333)"><td style="padding:6px 8px"><b>'+esc(l.title||l.name)+'</b><div class="muted small">'+esc(l.name)+(l.city?' · '+esc(l.city):'')+' · '+esc(l.code)+'</div>'+(warn.length?'<div class="small" style="color:#e6a23c">⚠ '+esc(warn.join(', '))+'</div>':'')+'</td>'
        +'<td style="padding:6px 8px">'+rent+'</td><td style="padding:6px 8px">'+(l.gallery!=null?l.gallery:l.photos)+'</td>'
        +'<td style="padding:6px 8px"><label><input type="checkbox" data-mpp="'+l.id+'"'+(l.published?' checked':'')+'> ano</label></td>'
        +'<td style="padding:6px 8px"><label><input type="checkbox" data-mpr="'+l.id+'"'+(l.reserved?' checked':'')+'> ano</label></td>'
        +'<td style="padding:6px 8px">'+l.interests+'</td><td style="padding:6px 8px">'+dt(l.last_interest)+'</td></tr>';});
    h+='</tbody></table>';}
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
}
function load(){var b=P.querySelector('.mp-body');if(!D)b.innerHTML='<p class="muted">Načítám…</p>';
  Promise.all([api('/admin/api/marketplace'),api('/admin/api/users').catch(function(){return {users:[]};})]).then(function(r){D=r[0];U=r[1].users||[];render();}).catch(function(e){b.innerHTML='<div class="card" style="color:#ff8f8f">'+esc(e.message)+'</div>';});}
P.addEventListener('change',function(e){var t=e.target,id=t.getAttribute('data-mpp')||t.getAttribute('data-mpr');if(!id)return;
  var body={};if(t.hasAttribute('data-mpp'))body.published=t.checked;else body.reserved=t.checked;
  api('/admin/api/marketplace/'+id,body).then(load).catch(function(er){alert(er.message);load();});});
P.addEventListener('click',function(e){var a=e.target.closest('[data-mpa]');
  if(a){api('/admin/api/users/'+a.getAttribute('data-mpa')+'/marketplace',{on:false}).then(load).catch(function(er){alert(er.message);});return;}
  if(e.target.closest('[data-mpadd]')){var v=P.querySelector('.mp-add').value;if(!v)return;api('/admin/api/users/'+v+'/marketplace',{on:true}).then(load).catch(function(er){alert(er.message);});return;}
  if(e.target.closest('.mp-reload'))load();});
window.__lmMpLoad=function(){load();};
})();
