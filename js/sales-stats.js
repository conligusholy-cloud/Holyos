// =============================================================================
// HolyOS — Sdílené bloky statistik obchodníka (koláče: rychlost dne, struktura kontaktů, nevolané)
// =============================================================================
// Používá Přehled obchodu (vedoucí) i obrazovka obchodníka (záložka Statistiky).
// Vstup: objekt `p` z /api/compounder/sales/team-day (per[]) nebo /sales/my-stats (person).
(function () {
  'use strict';
  function vDonut(done, open, skipped){
    done=Number(done)||0; open=Number(open)||0; skipped=Number(skipped)||0;
    var tot=done+open+skipped; var C=2*Math.PI*26;
    if(!tot) return '<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--line)" stroke-width="10"/><text x="32" y="37" text-anchor="middle" font-size="12" fill="var(--muted2)">—</text></svg>';
    function seg(val,color,cumBefore){ if(!val) return ''; var len=C*(val/tot); return '<circle cx="32" cy="32" r="26" fill="none" stroke="'+color+'" stroke-width="10" stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" stroke-dashoffset="'+(-C*(cumBefore/tot)).toFixed(2)+'" transform="rotate(-90 32 32)"/>'; }
    var pct=Math.round(done/tot*100);
    return '<svg width="64" height="64" viewBox="0 0 64 64">'+
      seg(done,'#22c55e',0)+seg(open,'#eab308',done)+seg(skipped,'#6b7280',done+open)+
      '<text x="32" y="37" text-anchor="middle" font-size="15" font-weight="800" fill="var(--text)">'+pct+'%</text></svg>';
  }
  // Plná mapa stavů (barva + popisek) pro koláč struktury kontaktů.
  var STATUS_FULL = { new:{l:'Nový',c:'#3b82f6'}, nedovolano:{l:'Nedovoláno',c:'#f59e0b'}, volat_pristi:{l:'Volat příště',c:'#eab308'}, contacted:{l:'Kontaktován',c:'#22d3ee'}, access_sent:{l:'Odeslán přístup',c:'#60a5fa'}, schuzka:{l:'Schůzka',c:'#22c55e'}, schuzka_online:{l:'Schůzka online',c:'#10b981'}, qualified:{l:'Kvalifikován',c:'#a78bfa'}, dosledovani:{l:'Dosledování',c:'#06b6d4'}, slibeny_krok:{l:'Slíbený krok',c:'#eab308'}, smlouva_odeslat:{l:'Odeslat dokumentaci',c:'#f97316'}, smlouva_odeslana:{l:'Dokumentace odeslána',c:'#8b5cf6'}, poptavka_financovani:{l:'Poptávka financování',c:'#10b981'}, prodano:{l:'Prodáno',c:'#0d9488'}, converted:{l:'Převeden',c:'#16a34a'}, nezajem:{l:'Nemá zájem',c:'#ef4444'}, nelze_pouzit:{l:'Nelze použít',c:'#6b7280'}, rejected:{l:'Zamítnut',c:'#9f1239'} };
  // Vícesegmentový donut ze seznamu {value,color}.
  function vDonutMulti(segs, centerLabel){
    var tot=segs.reduce(function(s,x){return s+(x.value||0);},0); var C=2*Math.PI*26;
    if(!tot) return '<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--line)" stroke-width="10"/><text x="32" y="37" text-anchor="middle" font-size="12" fill="var(--muted2)">0</text></svg>';
    var cum=0; var arcs='';
    segs.forEach(function(x){ var v=x.value||0; if(!v) return; var len=C*(v/tot); arcs+='<circle cx="32" cy="32" r="26" fill="none" stroke="'+x.color+'" stroke-width="10" stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" stroke-dashoffset="'+(-C*(cum/tot)).toFixed(2)+'" transform="rotate(-90 32 32)"/>'; cum+=v; });
    return '<svg width="64" height="64" viewBox="0 0 64 64">'+arcs+'<text x="32" y="37" text-anchor="middle" font-size="15" font-weight="800" fill="var(--text)">'+(centerLabel!=null?centerLabel:tot)+'</text></svg>';
  }
  function vStatusBlock(p){
    var sc=p.status_counts||{}; var keys=Object.keys(sc).filter(function(k){return sc[k]>0;});
    if(!keys.length) return '';
    // seřaď dle definovaného pořadí, neznámé na konec
    var order=Object.keys(STATUS_FULL);
    keys.sort(function(a,b){ var ia=order.indexOf(a), ib=order.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib); });
    var segs=keys.map(function(k){ return { value:sc[k], color:(STATUS_FULL[k]||{}).c||'#94a3b8' }; });
    var tot=keys.reduce(function(s,k){return s+sc[k];},0);
    var legend=keys.map(function(k){ var st=STATUS_FULL[k]||{l:k,c:'#94a3b8'}; return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;margin:2px 8px 2px 0"><span style="width:9px;height:9px;border-radius:2px;background:'+st.c+';display:inline-block"></span>'+esc(st.l)+' <b style="color:var(--text)">'+sc[k]+'</b></span>'; }).join('');
    return '<div style="display:flex;align-items:center;gap:14px;margin-top:8px;padding:10px;background:var(--surface2);border-radius:10px">'
      + vDonutMulti(segs, tot)
      + '<div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Struktura kontaktů ('+tot+')</div><div style="display:flex;flex-wrap:wrap">'+legend+'</div></div>'
      + '</div>';
  }
  // Stejný koláč, ale v PROCENTECH (podíl jednotlivých stavů).
  function vStatusBlockPct(p){
    var sc=p.status_counts||{}; var keys=Object.keys(sc).filter(function(k){return sc[k]>0;});
    if(!keys.length) return '';
    var order=Object.keys(STATUS_FULL);
    keys.sort(function(a,b){ var ia=order.indexOf(a), ib=order.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib); });
    var segs=keys.map(function(k){ return { value:sc[k], color:(STATUS_FULL[k]||{}).c||'#94a3b8' }; });
    var tot=keys.reduce(function(s,k){return s+sc[k];},0);
    var pct=function(v){ return tot? Math.round(v/tot*100):0; };
    var legend=keys.map(function(k){ var st=STATUS_FULL[k]||{l:k,c:'#94a3b8'}; return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;margin:2px 8px 2px 0"><span style="width:9px;height:9px;border-radius:2px;background:'+st.c+';display:inline-block"></span>'+esc(st.l)+' <b style="color:var(--text)">'+pct(sc[k])+' %</b></span>'; }).join('');
    return '<div style="display:flex;align-items:center;gap:14px;margin-top:8px;padding:10px;background:var(--surface2);border-radius:10px">'
      + vDonutMulti(segs, '100 %')
      + '<div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Struktura kontaktů (%)</div><div style="display:flex;flex-wrap:wrap">'+legend+'</div></div>'
      + '</div>';
  }
  function vSpeedBlock(p){
    var done=p.tasks_done||0, open=p.tasks_open||0, skipped=p.tasks_skipped||0;
    return '<div style="display:flex;align-items:center;gap:14px;margin-top:8px;padding:10px;background:var(--surface2);border-radius:10px">'
      + vDonut(done,open,skipped)
      + '<div style="flex:1;min-width:0">'
        + '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px">'
          + '<span style="color:#22c55e;font-weight:700">✓ '+done+' splněno</span>'
          + '<span style="color:#eab308;font-weight:700">● '+open+' otevřeno</span>'
          + (skipped?('<span style="color:#9aa0ad;font-weight:700">— '+skipped+' přeskočeno</span>'):'')
        + '</div>'
        + '<div style="margin-top:6px;font-size:13px"><b style="font-size:22px;color:var(--primary)">'+(p.contacts_worked_today||0)+'</b> <span style="color:var(--muted2)">kontaktů dnes</span>'
          + (p.calls_today?(' · <b>'+p.calls_today+'</b> hovorů'):'')
          + (p.new_contacts_today?(' · <b>'+p.new_contacts_today+'</b> nových'):'') + '</div>'
        + (p.uncalled_contacts!=null ? '<div style="margin-top:8px;padding:8px 10px;border-radius:9px;background:'+(p.uncalled_contacts?'rgba(239,68,68,0.12)':'rgba(34,197,94,0.10)')+';border:1px solid '+(p.uncalled_contacts?'rgba(239,68,68,0.55)':'rgba(34,197,94,0.45)')+';font-size:13px">'
            + (p.uncalled_contacts
                ? '📵 <b style="font-size:18px;color:#fca5a5">'+p.uncalled_contacts+'</b> <span style="color:#fca5a5;font-weight:700">kontaktům ještě nevolal</span>'+(p.uncalled_new_contacts?(' <span style="color:var(--muted2)">· z toho <b style="color:#fbbf24">'+p.uncalled_new_contacts+'</b> nových (0–2 dny)</span>'):'')
                  + (p.uncalled_oldest_at ? (function(){ var d=new Date(p.uncalled_oldest_at); var days=Math.floor((Date.now()-d.getTime())/86400000); return '<div style="margin-top:4px;font-size:12px;color:'+(days>=14?'#fca5a5':days>=5?'#fbbf24':'var(--muted2)')+'">⏳ Nejstarší nevolaný od <b>'+d.toLocaleDateString('cs-CZ')+'</b> — čeká <b>'+days+' '+(days===1?'den':days<5?'dny':'dní')+'</b>'+(p.uncalled_oldest_name?(' <span style="color:var(--muted2)">('+String(p.uncalled_oldest_name).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];})+')</span>'):'')+'</div>'; })() : '')
                : '✅ <span style="color:#86efac;font-weight:700">Všem svým kontaktům už volal</span>')
            + '</div>' : '')
      + '</div></div>';
  }

  window.SalesStats = {
    STATUS_FULL: STATUS_FULL,
    speed: vSpeedBlock, status: vStatusBlock, statusPct: vStatusBlockPct,
    donut: vDonut, donutMulti: vDonutMulti,
    // Celý blok pro jednoho obchodníka (stejné pořadí jako u vedoucího).
    person: function (p) { return vSpeedBlock(p) + vStatusBlock(p) + vStatusBlockPct(p); }
  };
})();
