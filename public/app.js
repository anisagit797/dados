let tech = [
  {
    id:"follow-drone",
    brand:"DJI",
    title:"Neo",
    oneLine:"A tiny follow-me drone built around getting the shot without needing to obsess over flying.",
    summary:"The appeal is the frictionless part: launch it, let it track you, and get footage you simply cannot get from smart glasses or a handheld camera.",
    why:"You already like hands-free capture and 360° cameras. This adds an entirely different angle without turning the trip into a production.",
    price:"Around $200–$300",
    sources:["The Verge","DPReview"],
    note:"Worth comparing tracking quality and battery life before buying.",
    tags:["Camera","Travel","Best match","Experience tech"],
    featured:true
  },
  {
    id:"travel-router",
    brand:"GL.iNet",
    title:"Beryl AX",
    oneLine:"A compact travel router that makes hotel Wi-Fi less annoying.",
    summary:"Connect once, then keep your phone, tablet, glasses, camera, and other devices on your own travel network instead of setting up every device again.",
    why:"It solves a real travel problem, takes almost no space, and feels like a quality-of-life upgrade rather than another gadget.",
    price:"Around $80",
    sources:["Tom's Guide","PCMag"],
    note:"",
    tags:["Travel","Useful","Low clutter"]
  },
  {
    id:"gaN-charger",
    brand:"Anker",
    title:"Prime GaN Charger",
    oneLine:"One compact charger that can replace a pile of travel bricks.",
    summary:"High-output GaN chargers can power several devices from one small unit, which is especially useful if you're carrying a phone, camera gear, smart glasses, and accessories.",
    why:"This is exactly the kind of boringly trustworthy upgrade that removes clutter instead of adding to it.",
    price:"Around $70–$100",
    sources:["Wirecutter","Tom's Guide"],
    note:"",
    tags:["Travel","Power","Practical"]
  },
  {
    id:"translation-earbuds",
    brand:"Timekettle",
    title:"WT2 Edge",
    oneLine:"Translation earbuds designed for face-to-face conversation while traveling.",
    summary:"They are more interesting than a generic translation app because they make conversation feel less like passing a phone back and forth.",
    why:"For international travel, this is the kind of tech that can make the trip noticeably easier without demanding much attention.",
    price:"Around $300",
    sources:["TechRadar","Travel + Leisure"],
    note:"The concept is great, but this is one I’d want to see strong real-world reviews on before buying.",
    tags:["Travel","Translation","Interesting"]
  },
  {
    id:"ssd",
    brand:"Samsung",
    title:"T7 Shield",
    oneLine:"A small rugged SSD for backing up photos and video while traveling.",
    summary:"Fast portable storage is not flashy, but if you're shooting a lot of 360° or drone footage, it becomes useful very quickly.",
    why:"It protects the part of the trip you can’t recreate: the footage.",
    price:"Around $90–$160",
    sources:["PCMag","CNET"],
    note:"",
    tags:["Camera","Travel","Practical"]
  }
];

const watch = [
  {type:"CAMERAS",title:"Wearable capture keeps getting better",text:"The interesting shift is cameras that remove the need to stop and intentionally film."},
  {type:"TRAVEL",title:"Offline AI is getting more useful",text:"Translation, navigation, and assistance that still works without a connection is worth watching."},
  {type:"HARDWARE",title:"Smaller, better-built travel tech",text:"The sweet spot is gear that replaces three mediocre things with one dependable one."}
];

const rawMemory = JSON.parse(localStorage.getItem("dadosMemory") || '{"saved":[],"owned":[],"dismissed":[]}');
const memory = {
  // saved now stores full product snapshots so items survive future feed refreshes
  saved: Array.isArray(rawMemory.saved) ? rawMemory.saved : [],
  owned: Array.isArray(rawMemory.owned) ? rawMemory.owned : [],
  dismissed: Array.isArray(rawMemory.dismissed) ? rawMemory.dismissed : []
};
const state={budget:"$$",distance:"90 min",hungry:"Maybe",mood:"Interesting"};

function savedIds(){
  return memory.saved.map(x => typeof x === "string" ? x : x.id).filter(Boolean);
}
function normalizeSaved(){
  // Backward compatibility: old builds stored only IDs.
  memory.saved = memory.saved.map(x => {
    if(typeof x !== "string") return x;
    const current = tech.find(t => t.id === x);
    return current ? {...current, savedAt:new Date().toISOString()} : {id:x,title:x,brand:"Saved item",oneLine:"Saved from an earlier DadOS feed.",savedAt:new Date().toISOString()};
  });
}
normalizeSaved();

function persist(){localStorage.setItem("dadosMemory",JSON.stringify(memory));updateProfile();}
function isDismissed(id){return memory.dismissed.includes(id)}
function getItem(id){return tech.find(x=>x.id===id)}

function score(item){
  let s=0;
  if(item.tags.includes("Best match")) s+=5;
  if(item.tags.includes("Camera")) s+=3;
  if(item.tags.includes("Travel")) s+=2;
  if(savedIds().some(id=>getItem(id)?.tags.some(t=>item.tags.includes(t)))) s+=2;
  if(memory.owned.some(id=>getItem(id)?.tags.some(t=>item.tags.includes(t)))) s+=1;
  if(isDismissed(item.id)) s-=99;
  return s;
}

function card(item){
  return `<article class="tech-card ${item.featured ? "featured":""}">
    <div class="product-kicker">
      <span class="brand-name">${item.brand}</span>
      <span class="price">${item.price}</span>
    </div>
    <h3>${item.title}</h3>
    <div class="one-line">${item.oneLine}</div>
    <p class="summary">${item.summary}</p>
    <div class="why"><strong>Why DadOS thinks you’d like it:</strong> ${item.why}</div>
    ${item.note ? `<div class="note"><strong>One thing to know:</strong> ${item.note}</div>` : ""}
    <div class="source-row">
      <div class="sources">Featured by: ${item.sources.join(" · ")}</div>
      <div class="source-links"><a href="#" onclick="return false">Official site ↗</a><a href="#" onclick="return false">Read coverage ↗</a></div>
    </div>
    <div class="card-actions">
      <button class="action-btn" onclick="feedback('${item.id}','saved')">☆ Save</button>
      <button class="action-btn owned" onclick="feedback('${item.id}','owned')">✓ Already own it</button>
      <button class="action-btn dismiss" onclick="feedback('${item.id}','dismissed')">× Not interested</button>
    </div>
  </article>`;
}

function renderTech(){
  const visible=tech.filter(x=>!isDismissed(x.id)).sort((a,b)=>score(b)-score(a));
  const best=visible.slice(0,1);
  const rest=visible.slice(1);
  document.getElementById("bestMatchGrid").innerHTML=best.length?best.map(card).join(""):`<div class="saved-item">DadOS is learning. Mark a few things you own or dislike.</div>`;
  document.getElementById("techGrid").innerHTML=rest.map(card).join("");
}
function renderWatch(){document.getElementById("watchGrid").innerHTML=watch.map(x=>`<div class="watch-card"><span>${x.type}</span><h3>${x.title}</h3><p>${x.text}</p></div>`).join("")}

window.feedback=function(id,type){
  // Remove this item from all three feedback states first.
  memory.saved = memory.saved.filter(x => (typeof x === "string" ? x : x.id) !== id);
  memory.owned = memory.owned.filter(x => x !== id);
  memory.dismissed = memory.dismissed.filter(x => x !== id);

  if(type === "saved"){
    const item = getItem(id);
    if(item) memory.saved.push({...item, savedAt:new Date().toISOString()});
  } else {
    memory[type].push(id);
  }

  persist();
  renderTech();
  const labels={saved:"Saved permanently",owned:"Got it — already owned",dismissed:"Got it — showing less like this"};
  showToast(labels[type]);
};

function switchPage(target){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===target));
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.target===target));
  if(target==="saved") renderSaved();
  if(target==="profile") updateProfile();
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll(".nav-btn").forEach(b=>b.addEventListener("click",()=>switchPage(b.dataset.target)));

function renderSaved(){
  const el=document.getElementById("savedList");
  if(!memory.saved.length){el.innerHTML="";return}
  el.innerHTML=memory.saved.map(x=>{
    if(typeof x === "string"){
      const current=getItem(x);
      x=current || {brand:"Saved item",title:x,oneLine:"Saved from an earlier DadOS feed."};
    }
    return `<div class="saved-item">
      <b>${x.brand || ""} ${x.title || ""}</b>
      <div style="color:#97a0ac;font-size:13px;margin-top:4px">${x.oneLine || x.summary || ""}</div>
    </div>`;
  }).join("");
}
function updateProfile(){
  document.getElementById("savedCount").textContent=memory.saved.length;
  document.getElementById("ownedCount").textContent=memory.owned.length;
  document.getElementById("dismissedCount").textContent=memory.dismissed.length;
  const own=document.getElementById("ownedList");
  own.innerHTML=memory.owned.length?memory.owned.map(id=>{const x=getItem(id);return x?`<div class="saved-item"><b>${x.brand} ${x.title}</b><div style="color:#97a0ac;font-size:13px;margin-top:4px">DadOS will avoid duplicates and can surface complementary gear instead.</div></div>`:""}).join(""):`<div class="saved-item">Nothing marked yet.</div>`;
}
function showToast(text){const t=document.getElementById("toast");t.textContent=text;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1700)}

document.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{const input=document.getElementById("tripInput");if(!input.value)input.value=c.textContent;else if(!input.value.toLowerCase().includes(c.textContent.toLowerCase()))input.value+=`, ${c.textContent.toLowerCase()}`}));

document.getElementById("generatePlanBtn").addEventListener("click",()=>{
  const q=document.getElementById("tripInput").value.trim()||"an upcoming trip";const lower=q.toLowerCase();const taiwan=lower.includes("taiwan");
  const results=[
    {title:"✈️ Make the trip easier",items:[["AirFly-style Bluetooth adapter","Use your own wireless headphones with seatback entertainment."],["Compact GaN charger","One charger for phone, glasses, camera, and accessories."],["Premium neck pillow","Prioritize packable support over inflatable junk."]]},
    {title:"📸 Capture it without thinking",items:[["Autonomous follow-me drone","Hands-free footage for walks, viewpoints, and outdoor parts of the trip."],["Tiny camera grip / tripod","Useful for 360 cameras without much bulk."],["Fast backup storage","A small SSD or phone backup workflow makes travel footage less fragile."]]},
    {title:"🏨 Hotel setup",items:[["Travel router","Creates your own network instead of reconnecting every device to hotel Wi-Fi."],["Compact charging station","One clean place for every device."],["Packable surface kit","A small pouch with wipes and a dedicated clean zone for personal items."]]},
    {title:"✨ Something unexpected",items:[[taiwan?"Offline translation setup":"Offline travel assistant","Pre-download maps, language packs, and key info."],["Slim day bag with hidden organization","Keeps tech separated without turning the trip into a bag of pouches."],["A genuinely good mini umbrella","Boring until the exact moment it becomes excellent."]]}
  ];
  const el=document.getElementById("planResults");el.classList.remove("hidden");el.innerHTML=`<div class="result-title"><span class="eyebrow">YOUR BRIEF</span><h2>${escapeHtml(q)}</h2></div><div class="result-sections">${results.map(s=>`<div class="result-section"><h3>${s.title}</h3>${s.items.map(i=>`<div class="result-item"><b>${i[0]}</b><p>${i[1]}</p></div>`).join("")}</div>`).join("")}</div>`;
});

document.getElementById("energy").addEventListener("input",e=>document.getElementById("energyValue").textContent=`${e.target.value}/5`);
document.querySelectorAll(".segmented").forEach(group=>{group.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{group.querySelectorAll("button").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");state[group.dataset.control]=btn.dataset.value}))});
document.querySelectorAll(".mood").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".mood").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");state.mood=btn.textContent}));

document.getElementById("findActivityBtn").addEventListener("click",()=>{
  const energy=Number(document.getElementById("energy").value);
  const ideas=[
    {meta:"ADVENTURE • DAY TRIP",title:"Mountain coaster + scenic drive",text:"Something memorable enough to justify the drive, with a good food stop built in."},
    {meta:"TECH + HISTORY • HALF DAY",title:"Aviation rabbit hole",text:"Pair an aviation or technology museum with one intentionally good meal nearby."},
    {meta:"WEIRD • 2–4 HOURS",title:"Book one thing you’d never normally book",text:`With energy ${energy}/5 and a ${state.budget} budget, prioritize one memorable activity over filling the day with errands.`}
  ];
  if(state.mood==="Relaxing")ideas[0]={meta:"LOW EFFORT • HALF DAY",title:"Scenic destination + one great reservation",text:"Drive somewhere pretty, keep the walking optional, and make the meal the anchor."};
  const el=document.getElementById("activityResults");el.classList.remove("hidden");el.innerHTML=`<div class="result-title"><span class="eyebrow">TODAY'S SHORTLIST</span><h2>Three ideas. No endless scrolling.</h2></div><div class="activity-list">${ideas.map(i=>`<article class="activity-card"><div class="meta">${i.meta}</div><h3>${i.title}</h3><p>${i.text}</p></article>`).join("")}</div>`;
});

document.getElementById("surpriseBtn").addEventListener("click",()=>{const pool=tech.filter(x=>!isDismissed(x.id));const pick=pool[Math.floor(Math.random()*pool.length)];alert(`${pick.brand} ${pick.title}\n\n${pick.why}`)});
function escapeHtml(str){return str.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

async function loadLiveFeed(){
  try{
    const res = await fetch("/api/feed", { headers: { "Accept":"application/json" }});
    if(!res.ok) throw new Error("feed unavailable");
    const payload = await res.json();

    if(Array.isArray(payload.items) && payload.items.length){
      tech = payload.items.map((x,i)=>({
        id: x.id || `live-${i}`,
        brand: x.brand || "New tech",
        title: x.title || x.product || "Interesting find",
        oneLine: x.oneLine || x.one_line || "",
        summary: x.summary || "",
        why: x.why || x.whyDadWouldLikeIt || x.why_dad_would_like_it || "",
        price: x.price || "Price varies",
        sources: Array.isArray(x.sources) ? x.sources.map(s=>typeof s==="string"?s:(s.name||"Source")) : [],
        sourceLinks: Array.isArray(x.sources) ? x.sources.map(s=>typeof s==="object"?s.url:null).filter(Boolean) : [],
        officialUrl: x.officialUrl || x.official_url || "",
        note: x.note || x.oneThingToKnow || x.one_thing_to_know || "",
        tags: Array.isArray(x.tags) ? x.tags : [],
        featured: i===0
      }));
      renderTech();
      if(payload.updatedAt){
        document.getElementById("updatedText").textContent =
          new Date(payload.updatedAt).toLocaleDateString(undefined,{weekday:"short",hour:"numeric",minute:"2-digit"});
      }
    }
  }catch(err){
    // Static demo feed remains visible when previewing locally or before backend deployment.
  }
}

persist();
renderTech();
renderWatch();
updateProfile();
document.getElementById("updatedText").textContent =
  new Date().toLocaleDateString(undefined,{weekday:"short",hour:"numeric",minute:"2-digit"});
loadLiveFeed();

