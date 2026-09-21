const CORE=[{
  id:"dji-neo",
  brand:"DJI",
  title:"Neo",
  price:"Around $200–$300",
  summary:"A compact follow-me drone focused on easy autonomous capture instead of complicated piloting.",
  why:"Strong fit for someone who already likes smart glasses and 360° cameras: it captures an angle those devices simply cannot.",
  official:"https://www.dji.com/neo"
}];

let live=[];
const mem=JSON.parse(localStorage.getItem("dados_clean_memory")||'{"saved":[],"owned":[],"dismissed":[]}');

const $=id=>document.getElementById(id);
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1500)}
function saveMem(){localStorage.setItem("dados_clean_memory",JSON.stringify(mem))}
function savedId(id){return mem.saved.some(x=>x.id===id)}

function nav(page){
  document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id===page));
  document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  if(page==="saved") renderSaved();
}
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>nav(b.dataset.page)));

function productCard(x){
  return `<article class="product">
    <div class="meta"><b>${esc(x.brand||"")}</b><span>${esc(x.price||"")}</span></div>
    <h3>${esc(x.title)}</h3>
    <p>${esc(x.summary||"")}</p>
    <div class="why"><b>Why it made the cut:</b> ${esc(x.why||"")}</div>
    <div class="links">
      ${x.official?`<a href="${esc(x.official)}" target="_blank" rel="noopener">Official site ↗</a>`:""}
      ${x.sourceUrl?`<a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener">Read coverage ↗</a>`:""}
    </div>
    <div class="actions">
      <button data-action="save" data-id="${esc(x.id)}">☆ Save</button>
      <button data-action="own" data-id="${esc(x.id)}">✓ Already own it</button>
      <button data-action="dismiss" data-id="${esc(x.id)}">× Not interested</button>
    </div>
  </article>`;
}

function allProducts(){return [...CORE,...live]}
function renderProducts(){
  $("coreGrid").innerHTML=CORE.filter(x=>!mem.dismissed.includes(x.id)).map(productCard).join("");
  const visible=live.filter(x=>!mem.dismissed.includes(x.id));
  $("liveGrid").innerHTML=visible.length?visible.map(productCard).join(""):`<div class="panel"><p>No live finds stored yet. The scheduled refresh will populate this section.</p></div>`;
  bindProductActions();
}
function bindProductActions(){
  document.querySelectorAll("[data-action]").forEach(btn=>{
    btn.onclick=()=>{
      const id=btn.dataset.id, action=btn.dataset.action, x=allProducts().find(p=>p.id===id);
      mem.saved=mem.saved.filter(s=>s.id!==id);mem.owned=mem.owned.filter(v=>v!==id);mem.dismissed=mem.dismissed.filter(v=>v!==id);
      if(action==="save"&&x){mem.saved.push({...x,savedAt:new Date().toISOString()});toast("Saved");}
      if(action==="own"){mem.owned.push(id);toast("Marked as owned");}
      if(action==="dismiss"){mem.dismissed.push(id);toast("Hidden");}
      saveMem();renderProducts();
    }
  })
}
function renderSaved(){
  $("savedGrid").innerHTML=mem.saved.length?mem.saved.map(productCard).join(""):`<p>Nothing saved yet.</p>`;
  bindProductActions();
}

async function loadFeed(){
  $("feedStatus").textContent="Checking recent tech…";
  try{
    const r=await fetch("/api/feed");
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||"Feed unavailable");
    live=Array.isArray(d.items)?d.items:[];
    if(d.updatedAt){
      $("feedStatus").textContent="Updated "+new Date(d.updatedAt).toLocaleString();
    }else if(live.length){
      $("feedStatus").textContent="Fresh finds loaded";
    }else{
      $("feedStatus").textContent="No strong finds yet";
    }
  }catch(e){
    $("feedStatus").textContent="No fresh finds available right now";
  }
  renderProducts();
}

$("planBtn").addEventListener("click",async()=>{
  const q=$("planInput").value.trim();
  if(!q){toast("Type what you're doing first");return}
  const b=$("planBtn");b.disabled=true;b.textContent="Building…";
  $("planResults").innerHTML=`<div class="result-title"><div class="eyebrow">BUILDING</div><h2>${esc(q)}</h2></div>`;
  try{
    const r=await fetch("/api/plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:q})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"Planner failed");
    $("planResults").innerHTML=`<div class="result-title"><div class="eyebrow">YOUR BRIEF</div><h2>${esc(q)}</h2><p>${esc(d.summary||"")}</p></div>
    <div class="result-grid">${(d.sections||[]).map(s=>`<article class="result-card"><h3>${esc(s.title)}</h3>${(s.items||[]).map(i=>`<div class="result-item"><b>${esc(i.name)}</b><p>${esc(i.why)}</p>${i.searchUrl?`<div class="links"><a target="_blank" rel="noopener" href="${esc(i.searchUrl)}">Research ↗</a></div>`:""}</div>`).join("")}</article>`).join("")}</div>`;
  }catch(e){$("planResults").innerHTML=`<div class="panel"><b>Planner error</b><p>${esc(e.message)}</p></div>`}
  b.disabled=false;b.textContent="Build my brief";
});

$("energy").addEventListener("input",e=>$("energyOut").textContent=e.target.value+"/5");
$("goBtn").addEventListener("click",async()=>{
  const b=$("goBtn");b.disabled=true;b.textContent="Searching…";
  $("goResults").innerHTML=`<div class="result-title"><div class="eyebrow">SEARCHING</div><h2>Finding real nearby places…</h2></div>`;
  try{
    const payload={energy:+$("energy").value,budget:$("budget").value,distance:+$("distance").value,mood:$("mood").value,hungry:$("hungry").value};
    const r=await fetch("/api/activities",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"Search failed");
    $("goResults").innerHTML=`<div class="result-title"><div class="eyebrow">REAL PLACES</div><h2>${esc(d.heading||"Nearby ideas")}</h2></div>
    <div class="place-grid">${(d.items||[]).map(x=>`<article class="place"><div class="kind">${esc(x.kind||"Nearby")}</div><h3>${esc(x.name)}</h3><p>${esc(x.why||"")}</p><div class="links">${x.website?`<a href="${esc(x.website)}" target="_blank" rel="noopener">Website ↗</a>`:""}<a href="${esc(x.mapsUrl)}" target="_blank" rel="noopener">Maps ↗</a></div></article>`).join("")}</div>`;
  }catch(e){$("goResults").innerHTML=`<div class="panel"><b>Nearby search error</b><p>${esc(e.message)}</p></div>`}
  b.disabled=false;b.textContent="Find real places";
});

renderProducts();loadFeed();
