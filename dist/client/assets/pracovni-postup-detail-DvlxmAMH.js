import"./modulepreload-polyfill-B5Qt9EMX.js";import{F as j,e as d}from"./app-3fGY-gDw.js";const i={goodsId:null,product:null,workflow:null,operations:[],bomTree:[],totalCount:0,goodsCache:{},currentTab:"sestava",loading:!1,manualAssignments:{},stagesLoaded:!1,stagesList:[]},v={productName:null,productCode:null,statusDot:null,statusText:null,tabContent:null};document.addEventListener("DOMContentLoaded",()=>{v.productName=document.getElementById("product-name"),v.productCode=document.getElementById("product-code"),v.statusDot=document.getElementById("status-dot"),v.statusText=document.getElementById("status-text"),v.tabContent=document.getElementById("tab-content");const t=new URLSearchParams(window.location.search);if(i.goodsId=t.get("id"),!i.goodsId){v.productName&&(v.productName.textContent="Chybí ID výrobku"),v.tabContent&&(v.tabContent.innerHTML='<div class="error-state"><div class="error-msg">V URL chybí parametr ?id=</div><a href="modules/pracovni-postup/index.html" class="btn">Zpět na seznam</a></div>');return}mt(i.goodsId),$t()});function E(t){if(!t)return"";if(typeof t=="object"&&t!==null){const e=t;return String(e[2]||e[1]||Object.values(e)[0]||"")}return String(t)}async function at(t){const e=String(t);if(i.goodsCache[e])return i.goodsCache[e];const a=[{path:"/api/goods/"+t,method:"GET",body:null},{path:"/api/query/Goods/"+t,method:"GET",body:null},{path:"/api/query/Goods",method:"POST",body:{filter:{id:t}}},{path:"/api/grid/Goods",method:"POST",body:{filter:{id:t}}}];for(const o of a)try{const n=await j.fetchAPI(o.path,{method:o.method,body:o.body});if(n&&typeof n=="object"&&"workflow"in n)return i.goodsCache[e]=n,console.log(`[PP] Goods ${t} načten přes ${o.method} ${o.path}`),n;const r=j.extractArray(n);if(r.length>0){const l=r.find(m=>m.id==t)||r[0];return i.goodsCache[e]=l,console.log(`[PP] Goods ${t} načten přes ${o.method} ${o.path} (z ${r.length} řádků)`),l}}catch(n){console.log(`[PP] ${o.method} ${o.path} → ${n.message}`)}return console.warn(`[PP] Nelze načíst goods ${t} — žádný endpoint nefungoval`),null}function ut(t,e){const a=[];if(!t||typeof t!="object")return a;const o=t;return!o.workflow||!o.workflow.operations||o.workflow.operations.sort((r,l)=>(r.position||r.operationPosition||0)-(l.position||l.operationPosition||0)).forEach((r,l)=>{const m=r.billOfMaterialsItems||[],u=E(r.name)||E(r.operationName)||"";m.forEach(y=>{const g=y.goods||{},M=g.type?g.type.name||g.type.referenceName||E(g.type):"",x=g.unit||g.measureUnit||y.unit||{},p=typeof x=="string"?x:x.name||x.referenceName||E(x)||"";a.push({id:g.id||null,code:g.code||"",name:E(g.name),type:M,unit:p,quantity:y.quantity||0,perQuantity:y.perQuantity||1,operation:u,operationPos:l+1,parentCode:e||"",hasSubWorkflow:M.toLowerCase().includes("polotovar")||M.toLowerCase().includes("výrobek"),children:[],expanded:!1})})}),a}async function rt(t,e,a,o){if(a>10)return[];const n=String(t);if(o.has(n))return[];o.add(n);const r=await at(t);if(!r)return[];const l=ut(r,e);if(a===0){i.product=r;const u=r;u.workflow&&u.workflow.operations&&(i.workflow=u.workflow,i.operations=u.workflow.operations.sort((y,g)=>(y.position||0)-(g.position||0)))}i.totalCount+=l.length,X("loading",`Načítám sestavu... ${i.totalCount} položek`),ht();const m=l.filter(u=>u.hasSubWorkflow&&u.id&&!o.has(String(u.id)));for(let u=0;u<m.length;u+=5){const y=m.slice(u,u+5);await Promise.all(y.map(async g=>{g.children=await rt(g.id,g.code,a+1,o)}))}return l}function _(t){let e=0;for(const a of t)e+=1,a.children&&a.children.length>0&&(e+=_(a.children));return e}async function mt(t){X("loading","Načítám detail..."),i.bomTree=[],i.totalCount=0,i.goodsCache={},i.loading=!0;try{j.configLoaded||await j.loadEnv();const e=await at(t);if(!e)throw new Error("Výrobek nenalezen");i.product=e;const a=e,o=E(a.name),n=a.code||"";v.productName&&(v.productName.textContent=o||"Bez názvu"),v.productCode&&(v.productCode.textContent=n),document.title=`${n} ${o} | Pracovní postup`,a.workflow&&a.workflow.operations&&(i.workflow=a.workflow,i.operations=a.workflow.operations.sort((l,m)=>(l.position||0)-(m.position||0))),st();const r=new Set;r.add(String(t)),i.totalCount=0,i.bomTree=await rt(t,n,0,r),i.loading=!1,i.totalCount=_(i.bomTree),X("connected",`${i.operations.length} operací · ${i.totalCount} položek`),st()}catch(e){i.loading=!1,X("disconnected","Chyba"),v.tabContent&&(v.tabContent.innerHTML=`
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <div class="error-msg">${d(e.message)}</div>
          <button class="btn" onclick="loadProductDetail('${i.goodsId}')">Zkusit znovu</button>
        </div>`)}}function st(){switch(i.currentTab){case"sestava":gt();break;case"postup":vt();break;case"normovane":ft();break;case"vizualizace":bt();break}}function ht(){const t=document.querySelector(".count-badge");t&&(t.textContent=i.totalCount+" položek"+(i.loading?"...":""))}function gt(){const t=i.bomTree;if(!v.tabContent)return;if(t.length===0&&!i.loading){v.tabContent.innerHTML='<div class="empty-state"><p>Žádné položky v sestavě</p></div>';return}const e=new Set;function a(r){r.forEach(l=>{l.type&&e.add(l.type),l.children&&a(l.children)})}a(t);const o=[...e].sort();let n=`
    <div class="table-toolbar">
      <span class="count-badge" id="visible-count">${i.totalCount} položek${i.loading?"...":""}</span>
      ${i.loading?'<span class="loading-inline"><span class="loading-spinner-sm"></span> Načítám pod-sestavy...</span>':""}
    </div>
    <div class="table-wrapper">
      <table class="data-table tree-table" id="bom-table">
        <thead>
          <tr>
            <th class="col-expand"></th>
            <th class="col-id">ID zboží</th>
            <th class="col-code">Kód</th>
            <th class="col-name">Zboží</th>
            <th class="col-qty">Množství</th>
            <th class="col-unit">Jednotka</th>
            <th class="col-type">Typ</th>
            <th class="col-op">Operace</th>
          </tr>
          <tr class="filter-row">
            <td class="filter-tree-actions">
              <span class="filter-icon-btn" onclick="expandAll()" title="Rozbalit vše">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <span class="filter-icon-btn" onclick="collapseAll()" title="Zabalit vše">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </td>
            <td><input type="text" class="col-filter" data-col="id" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
            <td><input type="text" class="col-filter" data-col="code" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
            <td><input type="text" class="col-filter" data-col="name" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
            <td><input type="text" class="col-filter col-filter-narrow" data-col="qty" placeholder="=" oninput="applyFilters()"></td>
            <td><input type="text" class="col-filter col-filter-narrow" data-col="unit" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
            <td>
              <select class="col-filter-select" data-col="type" onchange="applyFilters()">
                <option value="">&#x25BD;</option>
                ${o.map(r=>`<option value="${d(r)}">${d(r)}</option>`).join("")}
              </select>
            </td>
            <td><input type="text" class="col-filter" data-col="op" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
          </tr>
        </thead>
        <tbody>`;n+=lt(t,0,[]),n+="</tbody></table></div>",v.tabContent.innerHTML=n}function it(t,e,a){const n=t.length,r=(n+1)*20;let l=`<svg class="tree-lines" width="${r}" height="32" viewBox="0 0 ${r} 32">`;for(let m=0;m<t.length;m++)if(t[m]){const u=m*20+10;l+=`<line x1="${u}" y1="0" x2="${u}" y2="32" class="tl"/>`}if(n>0){const m=(n-1)*20+10,u=n*20;l+=`<line x1="${m}" y1="0" x2="${m}" y2="${e?16:32}" class="tl"/>`,l+=`<line x1="${m}" y1="16" x2="${u}" y2="16" class="tl"/>`}return l+="</svg>",l}function lt(t,e,a){let o="";return t.forEach((n,r)=>{const l=tt(n.type),m=n.quantity+(n.perQuantity>1?" / "+n.perQuantity:""),u=n.children&&n.children.length>0,y=`row-${e}-${n.id||r}-${Math.random().toString(36).substr(2,5)}`,g=u?_(n.children):0,M=r===t.length-1,x=it(a,M),p=u?`<span class="tree-toggle" data-row-id="${y}" onclick="toggleTreeNode(this, '${y}')">
           <span class="tree-icon">&#9654;</span>
           <span class="tree-child-count">${g}</span>
         </span>`:"";if(o+=`
      <tr class="tree-row depth-${e}" data-depth="${e}" data-row-id="${y}"
          data-id="${n.id||""}" data-code="${d(n.code).toLowerCase()}"
          data-name="${d(n.name).toLowerCase()}" data-qty="${m}"
          data-unit="${d(n.unit||"").toLowerCase()}" data-type="${d(n.type).toLowerCase()}"
          data-op="${d(n.operation).toLowerCase()}">
        <td class="col-expand"><div class="tree-cell">${x}${p}</div></td>
        <td class="col-id">${n.id||"—"}</td>
        <td class="col-code"><strong>${d(n.code)}</strong></td>
        <td class="col-name">${d(n.name)||"—"}</td>
        <td class="col-qty">${m}</td>
        <td class="col-unit">${d(n.unit||"")}</td>
        <td class="col-type"><span class="type-badge ${l}">${d(n.type)||"—"}</span></td>
        <td class="col-op"><span class="op-badge">${n.operationPos}</span> ${d(n.operation)}</td>
      </tr>`,u){const S=[...a,!M];o+=`<tr class="tree-children-container" data-parent-row="${y}" style="display:none"><td colspan="8" style="padding:0">
        <table class="tree-subtable"><tbody>`,o+=lt(n.children,e+1,S),o+="</tbody></table></td></tr>"}}),o}function tt(t){const e=(t||"").toLowerCase();return e.includes("výrobek")?"type-vyrobek":e.includes("polotovar")?"type-polotovar":e.includes("materiál")||e.includes("material")?"type-material":e.includes("zboží")||e.includes("zbozi")?"type-zbozi":""}function et(t,e){const a=String(t);if(!t||e.has(a))return[];e.add(a);const o=i.goodsCache[a];if(!o||typeof o!="object")return[];const n=o;return!n.workflow||!n.workflow.operations?[]:n.workflow.operations.slice().sort((l,m)=>(l.position||0)-(m.position||0)).map((l,m)=>{const u=E(l.name)||E(l.operationName)||"",y=l.stage&&(E(l.stage.name)||l.stage.referenceName)||"",g=l.stage&&l.stage.type||"",M=(l.billOfMaterialsItems||[]).map(S=>{const N=S.goods||{},B=N.type?N.type.name||N.type.referenceName||E(N.type):"",A=B.toLowerCase(),H=A.includes("polotovar")||A.includes("výrobek")||A.includes("vyrobek");if(!H)return null;const P=N.unit||N.measureUnit||S.unit||{},K=typeof P=="string"?P:P.name||P.referenceName||E(P)||"";return{nodeType:"goods",id:N.id,code:N.code||"",name:E(N.name),type:B,unit:K,quantity:S.quantity||0,isExpandable:H,children:et(N.id,e)}}).filter(S=>S!==null),x=l.perProcessingDuration||0,p=l.perProcessingUnit||"";return{nodeType:"operation",position:m+1,name:u,stage:y,stageType:g,normDuration:x,normUnit:p,bomCount:M.length,children:M}})}function nt(t){let e=0;for(const a of t)e++,a.children&&(e+=nt(a.children));return e}function ft(){if(!v.tabContent)return;if(!i.product&&!i.loading){v.tabContent.innerHTML='<div class="empty-state"><p>Žádná data</p></div>';return}const t=new Set,e=et(i.goodsId,t);if(e.length===0&&!i.loading){v.tabContent.innerHTML='<div class="empty-state"><p>Žádné operace</p></div>';return}const a=i.product,o=E(a.name),n=a.code||"",r=a.type&&(a.type.name||a.type.referenceName)||"",l={nodeType:"goods",id:i.goodsId,code:n,name:o,type:r,unit:"",quantity:0,isExpandable:!0,children:e},m=nt([l]),u=dt([l],"");let y=yt(u);y+=`
    <div class="norm-tree-frame">
      <div class="norm-tree-frame-header">
        <span class="norm-tree-frame-title">Struktura operací</span>
        <span class="count-badge">${m} uzlů</span>
        ${i.loading?'<span class="loading-inline"><span class="loading-spinner-sm"></span> Načítám...</span>':""}
        <div class="toolbar-spacer"></div>
        <button class="toolbar-btn" onclick="normExpandAll()" title="Rozbalit vše">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Rozbalit vše
        </button>
        <button class="toolbar-btn" onclick="normCollapseAll()" title="Zabalit vše">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 9l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Zabalit vše
        </button>
      </div>
      <div class="table-wrapper">
        <table class="data-table tree-table" id="norm-table">
        <thead>
          <tr>
            <th class="col-expand"></th>
            <th class="col-name-wide">Název</th>
            <th class="col-qty">Množství</th>
            <th class="col-unit">Jednotka</th>
            <th class="col-type">Typ</th>
            <th class="col-stage">Pracoviště</th>
            <th class="col-norm">Norma</th>
            <th class="col-workflow">Má prac. postup</th>
          </tr>
        </thead>
        <tbody>`,y+=ct([l],0,[]),y+="</tbody></table></div></div>",v.tabContent.innerHTML=y}function ct(t,e,a){let o="";return t.forEach((n,r)=>{const l=r===t.length-1,m=n.children&&n.children.length>0,u=`norm-${e}-${r}-${Math.random().toString(36).substr(2,5)}`,y=m?nt(n.children):0,g=it(a,l),M=m?`<span class="tree-toggle" data-row-id="${u}" onclick="toggleTreeNode(this, '${u}')">
           <span class="tree-icon">&#9654;</span>
           <span class="tree-child-count">${y}</span>
         </span>`:"";if(n.nodeType==="operation"){const x=n.normDuration?`${n.normDuration} ${ot(n.normUnit||"")}`:"";o+=`
        <tr class="tree-row norm-op-row depth-${e}" data-depth="${e}" data-row-id="${u}">
          <td class="col-expand"><div class="tree-cell">${g}${M}</div></td>
          <td class="col-name-wide norm-op-name">
            <span class="op-badge">${n.position}</span>
            <strong>${d(n.name)}</strong>
          </td>
          <td class="col-qty"></td>
          <td class="col-unit"></td>
          <td class="col-type"><span class="type-badge type-operace">Operace</span></td>
          <td class="col-stage">${d(n.stage||"")}</td>
          <td class="col-norm">${x}</td>
          <td class="col-workflow"></td>
        </tr>`}else{const x=tt(n.type||""),p=n.isExpandable?'<span class="wf-yes" title="Ano">&#10003;</span>':'<span class="wf-no" title="Ne">&#10005;</span>',S=i.manualAssignments[n.code||""];let N="",B="",A=p;S&&(N=`<span class="assigned-stage">${d(S.stageName||S.stageId||"")}</span>`,B=`<span class="assigned-norm">${S.norm} min</span>`,A='<span class="wf-yes" title="Ručně přiřazeno">&#10003;</span>'),o+=`
        <tr class="tree-row norm-goods-row depth-${e}${S?" norm-row-assigned":""}" data-depth="${e}" data-row-id="${u}">
          <td class="col-expand"><div class="tree-cell">${g}${M}</div></td>
          <td class="col-name-wide">
            <span class="norm-goods-code">${d(n.code||"")}</span>
            ${d(n.name)||"—"}
          </td>
          <td class="col-qty">${n.quantity!==void 0?n.quantity:""}</td>
          <td class="col-unit">${d(n.unit||"")}</td>
          <td class="col-type"><span class="type-badge ${x}">${d(n.type||"")||"—"}</span></td>
          <td class="col-stage">${N}</td>
          <td class="col-norm">${B}</td>
          <td class="col-workflow">${A}</td>
        </tr>`}if(m){const x=[...a,!l];o+=`<tr class="tree-children-container" data-parent-row="${u}" style="display:none"><td colspan="8" style="padding:0">
        <table class="tree-subtable"><tbody>`,o+=ct(n.children,e+1,x),o+="</tbody></table></td></tr>"}}),o}function vt(){if(!v.tabContent)return;if(!i.operations||i.operations.length===0){v.tabContent.innerHTML='<div class="empty-state"><p>Žádné operace</p></div>';return}let t='<div class="operations-list">';i.operations.forEach((e,a)=>{const o=E(e.name)||E(e.operationName)||"",n=e.stage&&(e.stage.referenceName||e.stage.name)||"",r=(e.billOfMaterialsItems||[]).length;t+=`
      <div class="operation-card">
        <div class="operation-num">${a+1}</div>
        <div class="operation-info">
          <div class="operation-name">${d(o)}</div>
          <div class="operation-meta">
            <span>🏭 ${d(n)}</span>
            ${r>0?`<span>📦 ${r} položek</span>`:""}
          </div>
        </div>
        <div class="operation-arrow" onclick="toggleOperationBom(this, ${a})">▼</div>
      </div>
      <div class="operation-bom" id="op-bom-${a}" style="display:none;"></div>`}),t+="</div>",v.tabContent.innerHTML=t}function bt(){if(!v.tabContent)return;if(!i.product&&!i.loading){v.tabContent.innerHTML='<div class="empty-state"><p>Žádná data</p></div>';return}const t=new Set,e=et(i.goodsId,t);if(e.length===0&&!i.loading){v.tabContent.innerHTML='<div class="empty-state"><p>Žádné operace k vizualizaci</p></div>';return}const a=i.product,o=E(a.name),n=a.code||"",r=[];let l=0,m=null;function u(s){const b=(s.children||[]).filter($=>$.nodeType==="operation");if(b.length===0){const $=i.manualAssignments[s.code||""];if($&&$.norm>0){const c=l++;return r.push({id:c,name:s.name,stage:$.stageName||$.stageId||"?",seconds:($.norm||0)*60,dependsOn:[],label:s.code,goodsCode:s.code,isMainOp:!1,feedsIntoMainPos:m}),[c]}return[]}let f=null;return b.forEach($=>{const c=Y($.normDuration||0,$.normUnit||""),w=f!==null?[f]:[];($.children||[]).filter(k=>k.nodeType==="goods").forEach(k=>{if(k.children&&k.children.length>0)w.push(...u(k));else{const O=i.manualAssignments[k.code||""];if(O&&O.norm>0){const h=l++;r.push({id:h,name:k.name,stage:O.stageName||O.stageId||"?",seconds:(O.norm||0)*60,dependsOn:[],label:k.code,goodsCode:k.code,isMainOp:!1,feedsIntoMainPos:m}),w.push(h)}}});const C=l++;r.push({id:C,name:$.name,stage:$.stage||"?",seconds:c,dependsOn:w,label:s.code,goodsCode:s.code,isMainOp:!1,feedsIntoMainPos:m,position:$.position,normDuration:$.normDuration,normUnit:$.normUnit}),f=C}),f!==null?[f]:[]}let y=null;e.forEach(s=>{const b=Y(s.normDuration||0,s.normUnit||""),f=y!==null?[y]:[],$=(s.stageType||"").toUpperCase()==="COOPERATION";m=s.position||null,(s.children||[]).filter(w=>w.nodeType==="goods").forEach(w=>{if(w.children&&w.children.length>0)f.push(...u(w));else{const C=i.manualAssignments[w.code||""];if(C&&C.norm>0){const k=l++;r.push({id:k,name:w.name,stage:C.stageName||C.stageId||"?",seconds:(C.norm||0)*60,dependsOn:[],label:w.code,goodsCode:w.code,isMainOp:!1,feedsIntoMainPos:m}),f.push(k)}}});const c=l++;r.push({id:c,name:s.name,stage:s.stage||"?",seconds:b,dependsOn:f,label:"Op "+s.position,isMainOp:!0,isKoop:$,position:s.position,normDuration:s.normDuration,normUnit:s.normUnit}),y=c});const g=new Map(r.map(s=>[s.id,s]));{const s=new Set,b={},f=new Set(r.map(c=>c.id));let $=0;for(;f.size>0&&$++<5e4;){let c=!1;for(const w of f){const C=g.get(w);if(!C.dependsOn.every(h=>s.has(h)))continue;const k=C.dependsOn.length>0?Math.max(...C.dependsOn.map(h=>g.get(h).endSec||0)):0,O=b[C.stage]||0;C.startSec=Math.max(k,O),C.endSec=C.startSec+C.seconds,b[C.stage]=C.endSec,s.add(w),f.delete(w),c=!0}if(!c)break}}const M=Math.max(...r.map(s=>s.endSec||0),0),x=new Map(r.map(s=>[s.id,[]]));r.forEach(s=>s.dependsOn.forEach(b=>{const f=x.get(b);f&&f.push(s.id)}));const p={};r.forEach(s=>{p[s.stage]||(p[s.stage]=[]),p[s.stage].push(s.id)}),Object.values(p).forEach(s=>s.sort((b,f)=>g.get(b).startSec-g.get(f).startSec));const S=new Map;Object.values(p).forEach(s=>{s.forEach((b,f)=>{f<s.length-1&&S.set(b,s[f+1])})});{const s=new Set,b=new Set(r.map($=>$.id));let f=0;for(;b.size>0&&f++<5e4;){let $=!1;for(const c of b){const w=g.get(c),C=x.get(c);if(!C.every(O=>s.has(O)))continue;let k=C.length>0?Math.min(...C.map(O=>g.get(O).startSec||0)):M;S.has(c)&&(k=Math.min(k,g.get(S.get(c)).startSec||0)),w.endSec=k,w.startSec=w.endSec-w.seconds,s.add(c),b.delete(c),$=!0}if(!$)break}}const N=r.filter(s=>s.isMainOp&&s.endSec!=null).sort((s,b)=>s.startSec-b.startSec),B=r.filter(s=>!s.isMainOp&&s.endSec!=null),A=["#5b8def","#27ae60","#e67e22","#9b59b6","#e74c3c","#1abc9c","#f39c12","#3498db","#e91e63","#00bcd4"],H={};N.forEach((s,b)=>{H[s.position]=s.isKoop?"#e67e22":A[b%A.length]});const P={};B.forEach(s=>{P[s.stage]||(P[s.stage]=[]),P[s.stage].push(s)});const K=Object.keys(P).sort((s,b)=>s.localeCompare(b)),U=Math.max(...r.filter(s=>s.endSec!=null).map(s=>s.endSec),0),G=36,Z=[{label:"HLAVNÍ LINKA",isMain:!0,tasks:N}];K.forEach(s=>Z.push({label:s,isMain:!1,tasks:P[s].sort((b,f)=>b.startSec-f.startSec)}));function J(s){const b=Math.max(U*.15*s,800),f=h=>U>0?h*(b/U):0,$=U>36e3?3600:U>7200?1800:600;let c=`<div class="gantt" data-zoom="${s}">`;c+=`<div class="gantt-header">
      <div class="gantt-header-left"><span class="gantt-title">${d(n)} ${d(o)}</span></div>
      <div class="gantt-header-right">
        <span class="gantt-stat">${r.length} úkolů · ${Q(U)}</span>
        <span class="gantt-zoom-info">${Math.round(s*100)}%</span>
        <button class="gantt-zoom-btn" data-dir="-" title="Oddálit">−</button>
        <button class="gantt-zoom-btn" data-dir="+" title="Přiblížit">+</button>
      </div>
    </div>`,c+='<div class="gantt-body">',c+='<div class="gantt-labels" id="gantt-labels">',c+='<div class="gantt-label gantt-label-axis">Pracoviště</div>',Z.forEach(h=>{const z=h.isMain?"gantt-label gantt-label-main":"gantt-label";c+=`<div class="${z}" title="${d(h.label)}">${d(h.label)}</div>`}),c+="</div>",c+='<div class="gantt-timeline" id="gantt-timeline">',c+=`<div class="gantt-timeline-inner" style="width:${b+80}px;">`,c+='<div class="gantt-row gantt-row-axis">';for(let h=0;h<=U;h+=$)c+=`<div class="gantt-tick" style="left:${f(h)}px;">${Q(h)||"0"}</div>`,c+=`<div class="gantt-vline gantt-vline-axis" style="left:${f(h)}px;"></div>`;c+="</div>",Z.forEach((h,z)=>{const L=h.isMain,D=L?"gantt-row gantt-row-main":"gantt-row"+(z%2===0?" gantt-row-even":"");c+=`<div class="${D}">`;for(let T=0;T<=U;T+=$)c+=`<div class="gantt-vline" style="left:${f(T)}px;"></div>`;h.tasks.forEach(T=>{const F=f(T.startSec),I=Math.max(f(T.seconds),4),q=L?H[T.position]:H[T.feedsIntoMainPos]||"#666",V=T.normDuration?`${T.normDuration} ${ot(T.normUnit||"")}`:"",R=L?`Op ${T.position}`:T.label||T.goodsCode||"",W=T.name;L?T.stage:`${T.feedsIntoMainPos}`;const pt=[R,W,T.stage,V].filter(Boolean).join(`
`);c+=`<div class="${L?"gantt-bar gantt-bar-main":"gantt-bar gantt-bar-sub"}" style="left:${F}px;width:${I}px;background:${q};" title="${d(pt)}">`,c+=`<span class="gantt-bar-l1">${d(R)}</span>`,I>30&&(c+=`<span class="gantt-bar-l2">${d(W)}</span>`),c+="</div>"}),c+="</div>"});const w=32,C=w+Z.length*G+10;c+=`<svg class="gantt-arrows" width="${b+80}" height="${C}">`,N.forEach(h=>{const z=B.filter(I=>I.feedsIntoMainPos===h.position);if(!z.length)return;const L=H[h.position],D=f(h.startSec),T=w+G;[...new Set(z.map(I=>I.stage))].forEach(I=>{const q=K.indexOf(I)+1;if(q<=0)return;const V=w+q*G+G/2,R=f(Math.max(...z.filter(W=>W.stage===I).map(W=>W.endSec||0)));R<D-2&&(c+=`<path d="M${R},${V} L${D},${V} L${D},${T}" fill="none" stroke="${L}" stroke-width="1.5" opacity="0.35" stroke-dasharray="4,3"/>`,c+=`<polygon points="${D-4},${T+1} ${D+4},${T+1} ${D},${T-4}" fill="${L}" opacity="0.45"/>`)})}),c+="</svg>",c+="</div></div>",c+="</div>",c+="</div>",v.tabContent.innerHTML=c;const k=document.getElementById("gantt-timeline"),O=document.getElementById("gantt-labels");k&&O&&k.addEventListener("scroll",()=>{O.scrollTop=k.scrollTop}),document.querySelectorAll(".gantt-zoom-btn").forEach(h=>{h.addEventListener("click",()=>{const L=h.dataset.dir==="+"?Math.min(s*1.4,20):Math.max(s/1.4,.2);J(L)})}),k&&k.addEventListener("wheel",h=>{if(h.ctrlKey||h.metaKey){h.preventDefault();const z=k.scrollLeft,D=(h.clientX-k.getBoundingClientRect().left+z)/(b+80),T=h.deltaY<0?1.15:.87,F=Math.min(Math.max(s*T,.2),20);J(F);const I=document.getElementById("gantt-timeline");if(I){const q=Math.max(U*.15*F,800)+80;I.scrollLeft=D*q-(h.clientX-I.getBoundingClientRect().left)}}},{passive:!1})}J(1)}function dt(t,e){const a={totalSeconds:0,operations:[],errors:[],warnings:[]};for(const o of t){if(o.nodeType==="operation"){const n=Y(o.normDuration||0,o.normUnit||"");a.totalSeconds+=n,a.operations.push({position:o.position||0,name:o.name,stage:o.stage||"",stageType:o.stageType||"",duration:o.normDuration||0,unit:o.normUnit||"",seconds:n,parentGoods:e||""});const r=(o.stageType||"").toUpperCase()==="COOPERATION";n<30&&!r&&a.errors.push({position:o.position,name:o.name,stage:o.stage,stageType:o.stageType||"",duration:o.normDuration,unit:o.normUnit,seconds:n,parentGoods:e||""})}if(o.nodeType==="goods"&&o.isExpandable&&!(o.children&&o.children.length>0)&&e&&a.warnings.push({code:o.code,name:o.name,type:o.type,parentGoods:e||""}),o.children&&o.children.length>0){const n=o.nodeType==="goods"?o.code+" "+o.name:e,r=dt(o.children,n);a.totalSeconds+=r.totalSeconds,a.operations.push(...r.operations),a.errors.push(...r.errors),a.warnings.push(...r.warnings)}}return a}function Y(t,e){if(!t)return 0;const a=(e||"").toUpperCase();return a==="HOUR"||a==="HOURS"?t*3600:a==="MINUTE"||a==="MINUTES"?t*60:a==="SECOND"||a==="SECONDS"?t:t*60}function Q(t){if(t<=0)return"0 min";const e=Math.floor(t/3600),a=Math.floor(t%3600/60),o=t%60,n=[];return e>0&&n.push(e+" hod"),a>0&&n.push(a+" min"),o>0&&e===0&&n.push(o+" s"),n.join(" ")}function yt(t){const e=t.errors.length;t.warnings.length;const a=t.operations.length;let o="";e>0&&(o=`
      <div class="norm-errors-list">
        <div class="norm-issues-header norm-issues-header-error">Operace bez časové dotace (mimo Kooperaci)</div>
        <table class="norm-errors-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Operace</th>
              <th>Pracoviště</th>
              <th>Norma</th>
              <th>Zboží</th>
            </tr>
          </thead>
          <tbody>
            ${t.errors.map(p=>{const S=p.duration?`${p.duration} ${ot(p.unit)}`:"<em>chybí</em>";return`<tr>
                <td>${p.position}</td>
                <td>${d(p.name)}</td>
                <td>${d(p.stage)}</td>
                <td class="norm-err-value">${S}</td>
                <td class="norm-err-goods">${d(p.parentGoods)}</td>
              </tr>`}).join("")}
          </tbody>
        </table>
      </div>`);const n=t.warnings.filter(p=>i.manualAssignments[p.code]),r=t.warnings.filter(p=>!i.manualAssignments[p.code]),l=r.length;let m="";n.length>0&&(m+=`
      <div class="norm-assigned-list">
        <div class="norm-issues-header norm-issues-header-ok">Ručně přiřazené pracoviště a norma</div>
        <table class="norm-warnings-table norm-assigned-table">
          <thead>
            <tr>
              <th>Kód</th>
              <th>Název</th>
              <th>Pracoviště</th>
              <th>Norma</th>
              <th>Nadřazené zboží</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${n.map(p=>{const S=i.manualAssignments[p.code];return`<tr class="norm-assigned-row">
                <td><strong>${d(p.code)}</strong></td>
                <td>${d(p.name)}</td>
                <td><span class="assigned-stage">${d(S.stageName)}</span></td>
                <td><span class="assigned-norm">${S.norm} min</span></td>
                <td class="norm-err-goods">${d(p.parentGoods)}</td>
                <td><button class="btn-remove-assign" onclick="removeAssignment('${d(p.code)}')" title="Odebrat přiřazení">✕</button></td>
              </tr>`}).join("")}
          </tbody>
        </table>
      </div>`),r.length>0&&(m+=`
      <div class="norm-warnings-list">
        <div class="norm-issues-header norm-issues-header-warn">
          Polotovary / výrobky bez pracovního postupu
          <button class="btn-bulk-assign" onclick="openBulkAssignModal()" title="Hromadně přiřadit vybraným">&#9881; Hromadně přiřadit vybrané</button>
        </div>
        <table class="norm-warnings-table" id="warn-table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" id="warn-check-all" onchange="toggleAllWarnings(this.checked)" title="Vybrat vše"></th>
              <th>Kód</th>
              <th>Název</th>
              <th>Typ</th>
              <th>Nadřazené zboží</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${r.map((p,S)=>{const N=tt(p.type);return`<tr>
                <td class="col-check"><input type="checkbox" class="warn-check" data-code="${d(p.code)}" data-name="${d(p.name)}" onchange="updateBulkCount()"></td>
                <td><strong>${d(p.code)}</strong></td>
                <td>${d(p.name)}</td>
                <td><span class="type-badge ${N}">${d(p.type)}</span></td>
                <td class="norm-err-goods">${d(p.parentGoods)}</td>
                <td><button class="btn-assign" onclick="openAssignModal('${d(p.code)}', '${d(p.name)}')" title="Přiřadit pracoviště a normu">&#9881; Přiřadit</button></td>
              </tr>`}).join("")}
          </tbody>
        </table>
      </div>`);let u=0;for(const p of Object.keys(i.manualAssignments))u+=(i.manualAssignments[p].norm||0)*60;const y=t.totalSeconds+u,g=Object.keys(i.manualAssignments).length;let M;e>0&&l>0?M=`
      <div class="norm-card norm-card-error">
        <div class="norm-card-label">Chyby</div>
        <div class="norm-card-value">${e}</div>
      </div>
      <div class="norm-card norm-card-warn">
        <div class="norm-card-label">Varování</div>
        <div class="norm-card-value">${l}</div>
      </div>`:e>0?M=`
      <div class="norm-card norm-card-error">
        <div class="norm-card-label">Chyby (norma &lt; 30 s)</div>
        <div class="norm-card-value">${e} operací</div>
      </div>`:l>0?M=`
      <div class="norm-card norm-card-warn">
        <div class="norm-card-label">Varování</div>
        <div class="norm-card-value">${l}</div>
      </div>`:M=`
      <div class="norm-card norm-card-ok">
        <div class="norm-card-label">Stav</div>
        <div class="norm-card-value">✓ OK</div>
      </div>`;const x=g>0?`
    <div class="norm-card norm-card-manual">
      <div class="norm-card-label">Ručně přiřazeno</div>
      <div class="norm-card-value">${g} dílů · ${Q(u)}</div>
    </div>`:"";return`
    <div class="norm-summary-panel">
      <div class="norm-summary-cards">
        <div class="norm-card">
          <div class="norm-card-label">Celková norma</div>
          <div class="norm-card-value">${Q(y)}</div>
        </div>
        <div class="norm-card">
          <div class="norm-card-label">Počet operací</div>
          <div class="norm-card-value">${a+g}</div>
        </div>
        ${M}
        ${x}
      </div>
      ${o}
      ${m}
    </div>`}function ot(t){const e=(t||"").toUpperCase();return e==="MINUTE"||e==="MINUTES"?"min":e==="SECOND"||e==="SECONDS"?"s":e==="HOUR"||e==="HOURS"?"hod":t||""}function X(t,e){v.statusDot&&(v.statusDot.className="status-dot "+t),v.statusText&&(v.statusText.textContent=e)}async function $t(){if(!i.stagesLoaded)try{j.configLoaded||await j.loadEnv();const t=await j.loadStages();i.stagesList=t.sort((e,a)=>(e.name||"").localeCompare(a.name||"","cs")),i.stagesLoaded=!0,kt()}catch(t){console.warn("[PP] Nepodařilo se načíst pracoviště:",t.message)}}function wt(){return"manualAssignments_"+i.goodsId}function kt(){try{const t=localStorage.getItem(wt());t&&(i.manualAssignments=JSON.parse(t))}catch{}}
