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
  const catalog=[
    {
      name:"iFLY Loudoun",
      kind:"Indoor skydiving",
      energy:4,
      budget:"$$$",
      moods:["Adventurous","Interesting"],
      website:"https://www.iflyworld.com/loudoun",
      mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("iFLY Loudoun Ashburn Virginia"),
      note:"Indoor skydiving in Ashburn."
    },
    {
      name:"Great Falls Park",
      kind:"Scenic / outdoors",
      energy:3,
      budget:"$",
      moods:["Outdoors","Relaxing","Interesting"],
      website:"https://www.nps.gov/grfa/",
      mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("Great Falls Park Virginia"),
      note:"Potomac overlooks and hiking trails."
    },
    {
      name:"Go Ape Springfield",
      kind:"Zipline / ropes course",
      energy:5,
      budget:"$$",
      moods:["Adventurous","Outdoors","Competitive"],
      website:"https://www.goape.com/location/virginia-springfield/",
      mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("Go Ape Springfield Virginia"),
      note:"Treetop ropes course, ziplines, and an outdoor escape-style experience."
    },
    {
      name:"Harpers Ferry Adventure Center",
      kind:"Rafting / zipline / kayaking",
      energy:5,
      budget:"$$$",
      moods:["Adventurous","Outdoors"],
      website:"https://harpersferryadventurecenter.com/",
      mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("Harpers Ferry Adventure Center"),
      note:"Tubing, rafting, kayaking, zipline, ropes course, and camping."
    },
    {
      name:"Summit Point Motorsports Park",
      kind:"Motorsports",
      energy:4,
      budget:"$$$",
      moods:["Competitive","Adventurous","Interesting"],
      website:"https://summitpointmp.com/",
      mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("Summit Point Motorsports Park"),
      note:"Road-course events and driving programs."
    },
    {
      name:"Wisp Resort Mountain Park",
      kind:"Mountain adventure",
      energy:4,
      budget:"$$$",
      moods:["Adventurous","Outdoors","Interesting"],
      website:"https://www.wispresort.com/activity/mountain-adventures/",
      mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("Wisp Resort Mountain Park Maryland"),
      note:"Mountain-park activities; check current operating status before driving out."
    }
  ];

  const energy=Number(prefs.energy)||3;
  const mood=String(prefs.mood||"Interesting");
  const budget=String(prefs.budget||"$$");

  let ranked;
  try{
    ranked=await gemini(`Rank these REAL nearby activity options for DadOS.
Preferences: ${JSON.stringify({energy,budget,mood,hungry:prefs.hungry,distance:prefs.distance})}
You may ONLY return exact names from the catalog.
Prefer memorable, unusual, scenic, adventurous, technical, experiential, or genuinely relaxing options.
Return JSON exactly:
{"heading":"short heading","items":[{"name":"EXACT NAME","why":"one concise sentence"}]}
Catalog: ${JSON.stringify(catalog.map(x=>({name:x.name,kind:x.kind,note:x.note})))}`,env);
  }catch(e){
    ranked={heading:"Nearby ideas",items:catalog
      .map(x=>({
        ...x,
        score:(x.moods.includes(mood)?3:0) - Math.abs(x.energy-energy)
      }))
      .sort((a,b)=>b.score-a.score)
      .slice(0,5)
      .map(x=>({name:x.name,why:x.note}))};
  }

  const map=new Map(catalog.map(x=>[x.name,x]));
  const items=(ranked.items||[]).map(r=>{
    const real=map.get(r.name);
    if(!real)return null;
    return {
      name:real.name,
      kind:real.kind,
      why:r.why||real.note,
      website:real.website,
      mapsUrl:real.mapsUrl
    };
  }).filter(Boolean);

  return {heading:ranked.heading||"Nearby ideas",items};
}
function norm(u){if(!u)return"";return /^https?:\/\//i.test(u)?u:"https://"+u}

async function refreshFeed(env){
  const feeds=[
    ["The Verge","https://www.theverge.com/rss/index.xml"],
    ["Engadget","https://www.engadget.com/rss.xml"],
    ["TechCrunch","https://techcrunch.com/feed/"],
    ["Ars Technica","https://feeds.arstechnica.com/arstechnica/gadgets"],
    ["Google News Tech","https://news.google.com/rss/search?q=consumer+technology+gadgets+camera+drone+travel+tech&hl=en-US&gl=US&ceid=US:en"]
  ];

  const found=[];
  for(const [source,url] of feeds){
    try{
      const r=await fetch(url,{
        headers:{
          "user-agent":"Mozilla/5.0 DadOS/1.0",
          "accept":"application/rss+xml,application/xml,text/xml,*/*"
        },
        redirect:"follow"
      });
      if(!r.ok)continue;
      const xml=await r.text();
      const chunks=xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi)||[];
      for(const block of chunks.slice(0,10)){
        const title=tag(block,"title");
        const link=tag(block,"link")||href(block);
        const desc=strip(tag(block,"description")||tag(block,"summary"));
        if(title&&link)found.push({source,title,link,desc:desc.slice(0,500)});
      }
    }catch(e){}
  }

  if(!found.length){
    const fallback={
      items:[],
      updatedAt:new Date().toISOString(),
      note:"No source feeds responded"
    };
    if(env.DADOS_KV)await env.DADOS_KV.put("feed",JSON.stringify(fallback));
    return fallback;
  }

  const positive=["camera","drone","gadget","glasses","wearable","travel","charger","battery","router","earbud","headphone","projector","robot","portable","accessory","review","launch","announced","hands-on","360","garmin","anker","sony","meta","insta360","gopro","dji","apple","samsung","bose"];
  const negative=["funding","valuation","earnings","layoff","lawsuit","crypto","bitcoin","enterprise","data center","datacenter","rumor","leak"];

  const candidates=found.filter(x=>{
    const t=(x.title+" "+x.desc).toLowerCase();
    if(negative.some(k=>t.includes(k)))return false;
    return positive.some(k=>t.includes(k));
  }).slice(0,30);

  let items=[];
  try{
    if(candidates.length){
      const curated=await gemini(`Curate at most 8 specific consumer-tech products from these recent tech-news items for DadOS.
Taste: cameras, drones, smart glasses, travel tech, useful hardware, quality-of-life upgrades. Prefer reputable/well-built products. Reject generic junk and weakly supported claims.
Never invent a product, price, or fact not supported by the source items.
Return JSON exactly:
{"items":[{"id":"slug","brand":"brand if clear otherwise Tech","title":"product or article subject","price":"Price not listed","summary":"1 sentence","why":"why it fits DadOS","official":"","sourceUrl":"exact source URL"}]}
Items: ${JSON.stringify(candidates)}`,env);
      items=curated.items||[];
    }
  }catch(e){}

  // If AI curation fails, still show real recent coverage instead of an empty feed.
  if(!items.length){
    items=(candidates.length?candidates:found.slice(0,8)).slice(0,8).map((x,i)=>({
      id:"news-"+i+"-"+x.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,45),
      brand:x.source,
      title:x.title,
      price:"Recent coverage",
      summary:x.desc||"Recent consumer-tech coverage.",
      why:"Recent tech coverage that passed DadOS's basic hardware-interest filter.",
      official:"",
      sourceUrl:x.link
    }));
  }

  const payload={items,updatedAt:new Date().toISOString()};
  if(env.DADOS_KV)await env.DADOS_KV.put("feed",JSON.stringify(payload));
  return payload;
}
function tag(block,name){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,"i"));return m?decode(m[1].replace(/^<!\[CDATA\[|\]\]>$/g,"").trim()):""}
function href(block){const m=block.match(/<link\b[^>]*href=["']([^"']+)["']/i);return m?decode(m[1]):""}
function strip(s){return String(s||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}
function decode(s){return String(s||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")}
