const MODELS=["gemini-3.8-flash","gemini-3.7-flash","gemini-3.6-flash"];

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/health")return json({ok:true,gemini:!!env.GEMINI_API_KEY,kv:!!env.DADOS_KV});
      if(url.pathname==="/api/feed"){
        const cached=await env.DADOS_KV?.get("feed",{type:"json"});
        if(cached)return json(cached);
        try{
          const fresh=await refreshFeed(env);
          return json(fresh);
        }catch(e){
          return json({items:[],updatedAt:null,error:String(e.message||e)});
        }
      }
      if(url.pathname==="/api/plan"&&request.method==="POST"){
        const body=await request.json();
        return json(await makePlan(String(body.prompt||""),env));
      }
      if(url.pathname==="/api/activities"&&request.method==="POST"){
        const body=await request.json();
        return json(await activities(body,env));
      }
      if(url.pathname==="/api/refresh"&&request.method==="POST"){
        if(!env.ADMIN_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.ADMIN_TOKEN}`)return json({error:"Unauthorized"},401);
        return json(await refreshFeed(env));
      }
      return env.ASSETS.fetch(request);
    }catch(e){return json({error:String(e.message||e)},500)}
  },
  async scheduled(event,env,ctx){
    const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
    if(hour===7||hour===19)ctx.waitUntil(refreshFeed(env));
  }
};

function json(x,status=200){return new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json;charset=utf-8"}})}

async function gemini(prompt,env){
  if(!env.GEMINI_API_KEY)throw new Error("Gemini secret missing");
  let last;
  for(const model of MODELS){
    for(let attempt=0;attempt<2;attempt++){
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          contents:[{role:"user",parts:[{text:prompt}]}],
          generationConfig:{responseMimeType:"application/json"}
        })
      });
      if(r.ok){
        const d=await r.json();
        const text=d?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
        if(!text)throw new Error("Gemini returned no text");
        return JSON.parse(text);
      }
      const txt=await r.text();last=new Error(`${model} ${r.status}: ${txt}`);
      if(!(r.status===429||r.status>=500))throw last;
      await new Promise(res=>setTimeout(res,600*(attempt+1)));
    }
  }
  throw last||new Error("Gemini failed");
}

async function makePlan(raw,env){
  const q=raw.trim().slice(0,600);if(!q)throw new Error("Missing prompt");
  const prompt=`You power DadOS, a structured recommendation planner. The user request is:

"${q}"

Create a brief that changes substantially based on this exact request. Do not reuse a fixed travel template.
DadOS preferences: reputable/well-built products, cameras, drones, travel tech, useful upgrades, minimal clutter, good physical product quality. Normal app accounts are fine. Avoid generic junk and suspiciously cheap hardware.
If a specific product is uncertain, recommend a product type instead of inventing a model.

Return JSON exactly:
{
 "summary":"1-2 sentences",
 "sections":[
   {"title":"request-specific category","items":[
      {"name":"product or product type","why":"why it fits THIS request","searchUrl":"https://www.google.com/search?q=URL_ENCODED_QUERY"}
   ]}
 ]
}
Use 4-6 sections, 2-4 items each. A road trip must look like a road-trip brief; Taiwan must look like Taiwan; skiing must look like skiing, etc.`;
  return await gemini(prompt,env);
}

async function activities(prefs,env){
  const base={lat:38.9586,lon:-77.3570}; // Reston city center
  const drive=Number(prefs.distance)||45;
  const radiusByMinutes={15:18000,45:50000,90:90000,180:150000};
  const radius=radiusByMinutes[drive]||50000;

  const q=`[out:json][timeout:18];(
nwr(around:${radius},${base.lat},${base.lon})["name"]["tourism"~"attraction|museum|viewpoint|theme_park|zoo|gallery"];
nwr(around:${radius},${base.lat},${base.lon})["name"]["leisure"~"water_park|escape_game|amusement_arcade|marina"];
nwr(around:${radius},${base.lat},${base.lon})["name"]["sport"~"climbing|karting|skiing|archery|canoe|kayak"];
);out center tags 70;`;

  const endpoints=[
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
  ];

  let d=null,lastError=null;
  for(const endpoint of endpoints){
    try{
      const r=await fetch(endpoint,{
        method:"POST",
        headers:{
          "content-type":"application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent":"DadOS/1.0"
        },
        body:"data="+encodeURIComponent(q)
      });
      if(!r.ok){lastError=new Error(`Place source ${r.status}`);continue}
      d=await r.json();
      if(Array.isArray(d.elements))break;
    }catch(e){lastError=e}
  }

  let items=[];
  if(d?.elements){
    items=d.elements.map(e=>{
      const t=e.tags||{},lat=e.lat??e.center?.lat,lon=e.lon??e.center?.lon;
      if(!t.name||!Number.isFinite(lat)||!Number.isFinite(lon))return null;
      return {
        name:t.name,
        kind:t.tourism||t.leisure||t.sport||"attraction",
        website:norm(t.website||t["contact:website"]||""),
        lat,lon
      };
    }).filter(Boolean);

    const seen=new Set();
    items=items.filter(x=>{
      const k=x.name.toLowerCase().replace(/[^a-z0-9]+/g,"");
      if(!k||seen.has(k))return false;
      seen.add(k);return true;
    }).slice(0,45);
  }

  if(items.length){
    let ranked;
    try{
      ranked=await gemini(`Choose up to 6 REAL places only from this list for DadOS.
Preferences: ${JSON.stringify({energy:prefs.energy,budget:prefs.budget,mood:prefs.mood,hungry:prefs.hungry,distance:prefs.distance})}
Prefer memorable, unusual, scenic, adventurous, technical, experiential, or genuinely relaxing options over generic everyday places.
Do not invent any place or alter its name.
Return JSON: {"heading":"short heading","items":[{"name":"EXACT name","why":"one sentence"}]}
Candidates: ${JSON.stringify(items.map(x=>({name:x.name,kind:x.kind})))}`,env);
    }catch(e){
      ranked={heading:"Nearby ideas",items:items.slice(0,6).map(x=>({name:x.name,why:"A real nearby option that fits the search area."}))};
    }
    const map=new Map(items.map(x=>[x.name,x]));
    const out=(ranked.items||[]).map(x=>{
      const real=map.get(x.name);if(!real)return null;
      return {
        name:real.name,
        kind:real.kind,
        why:x.why||"",
        website:real.website,
        mapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(real.name+" near Reston Virginia")}`
      };
    }).filter(Boolean);
    if(out.length)return {heading:ranked.heading||"Nearby ideas",items:out};
  }

  // Graceful fallback: still return useful, clickable nearby searches instead of a dead error.
  const mood=String(prefs.mood||"Interesting");
  const energy=Number(prefs.energy)||3;
  const searches=[
    {name:"Mountain coaster / alpine slide",kind:"Adventure",q:"mountain coaster near Reston Virginia"},
    {name:"Indoor skydiving",kind:"Adventure",q:"indoor skydiving near Reston Virginia"},
    {name:"Scenic winery or countryside stop",kind:"Relaxing",q:"scenic winery near Reston Virginia"},
    {name:"Kayaking or paddle outing",kind:"Outdoors",q:"kayaking near Reston Virginia"},
    {name:"Escape room or immersive game",kind:"Competitive",q:"best escape room near Reston Virginia"},
    {name:"Unusual museum or exhibit",kind:"Interesting",q:"unusual museum near Reston Virginia"}
  ];
  const ordered=searches.sort((a,b)=>{
    const as=(a.kind.toLowerCase()===mood.toLowerCase()?2:0)+(energy>=4&&a.kind==="Adventure"?1:0);
    const bs=(b.kind.toLowerCase()===mood.toLowerCase()?2:0)+(energy>=4&&b.kind==="Adventure"?1:0);
    return bs-as;
  }).slice(0,6);

  return {
    heading:"Nearby searches worth exploring",
    items:ordered.map(x=>({
      name:x.name,
      kind:x.kind,
      why:"Open the map search to see current nearby options, hours, and reviews.",
      website:"",
      mapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.q)}`
    })),
    fallback:true,
    note:lastError?String(lastError.message||lastError):"Primary place source unavailable"
  };
}
function norm(u){if(!u)return"";return /^https?:\/\//i.test(u)?u:"https://"+u}

async function refreshFeed(env){
  if(!env.DADOS_KV)throw new Error("DADOS_KV missing");
  const feeds=[
    ["The Verge","https://www.theverge.com/rss/index.xml"],
    ["Engadget","https://www.engadget.com/rss.xml"],
    ["TechCrunch","https://techcrunch.com/feed/"],
    ["Ars Technica","https://feeds.arstechnica.com/arstechnica/gadgets"]
  ];
  const found=[];
  for(const [source,url] of feeds){
    try{
      const r=await fetch(url,{headers:{"user-agent":"DadOS/1.0"}});
      if(!r.ok)continue;
      const xml=await r.text();
      const chunks=xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi)||[];
      for(const block of chunks.slice(0,8)){
        const title=tag(block,"title"), link=tag(block,"link")||href(block), desc=strip(tag(block,"description")||tag(block,"summary"));
        if(title&&link)found.push({source,title,link,desc:desc.slice(0,500)});
      }
    }catch(e){}
  }
  if(!found.length)throw new Error("No feed items found");
  const curated=await gemini(`Curate at most 8 specific consumer-tech products from these recent tech-news items for DadOS.
Taste: cameras, drones, smart glasses, travel tech, useful hardware, quality-of-life upgrades. Prefer reputable/well-built products. Reject funding news, enterprise software, rumors, generic junk, and suspiciously cheap hardware.
Never invent facts or products not supported by the source items.
Return JSON:
{"items":[{"id":"slug","brand":"brand","title":"product","price":"price if present otherwise Price not listed","summary":"what it is","why":"why it fits DadOS","official":"","sourceUrl":"exact article URL"}]}
Items: ${JSON.stringify(found)}`,env);
  const payload={items:curated.items||[],updatedAt:new Date().toISOString()};
  await env.DADOS_KV.put("feed",JSON.stringify(payload));
  return {ok:true,...payload};
}
function tag(block,name){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,"i"));return m?decode(m[1].replace(/^<!\[CDATA\[|\]\]>$/g,"").trim()):""}
function href(block){const m=block.match(/<link\b[^>]*href=["']([^"']+)["']/i);return m?decode(m[1]):""}
function strip(s){return String(s||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}
function decode(s){return String(s||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")}
