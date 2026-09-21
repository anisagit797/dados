import { SOURCES, POSITIVE_TERMS, NEGATIVE_TERMS } from "./sources.js";

const MAX_ARTICLES_PER_SOURCE = 12;
const MAX_CANDIDATES_FOR_AI = 35;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "DadOS",
        hasGemini: Boolean(env.GEMINI_API_KEY),
        hasKV: Boolean(env.DADOS_KV)
      });
    }

    if (url.pathname === "/api/feed") {
      const cached = await env.DADOS_KV?.get("feed", { type: "json" });
      return Response.json(cached || { items: [], updatedAt: null });
    }

    if (url.pathname === "/api/activities" && request.method === "POST") {
      try {
        const input = await request.json();
        const result = await findActivities(input, env);
        return Response.json(result);
      } catch (error) {
        return Response.json({ ok:false, error:String(error?.message || error) }, { status:500 });
      }
    }

    // Manual refresh endpoint. Protect it with ADMIN_TOKEN.
    if (url.pathname === "/api/refresh" && request.method === "POST") {
      if (!env.ADMIN_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      const result = await refreshFeed(env);
      return Response.json(result);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("DadOS", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    // Cloudflare Cron is UTC. We invoke around both possible DST UTC hours,
    // then only refresh if New York local time is 7 AM or 7 PM.
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hourCycle: "h23"
      }).format(new Date())
    );

    if (hour !== 7 && hour !== 19) return;
    ctx.waitUntil(refreshFeed(env));
  }
};

async function refreshFeed(env) {
  if (!env.DADOS_KV) throw new Error("DADOS_KV binding is missing.");
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY secret is missing.");

  const batches = await Promise.allSettled(SOURCES.map(fetchSource));
  const candidates = [];

  for (const result of batches) {
    if (result.status === "fulfilled") candidates.push(...result.value);
  }

  const fresh = dedupe(candidates)
    .filter(isLikelyRelevant)
    .sort((a, b) => b.sourceWeight - a.sourceWeight || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, MAX_CANDIDATES_FOR_AI);

  if (!fresh.length) {
    return { ok: false, reason: "No relevant source items found." };
  }

  const curated = await curateWithGemini(fresh, env);
  const payload = {
    items: curated.items || [],
    updatedAt: new Date().toISOString(),
    sourceCount: new Set(fresh.map(x => x.source)).size,
    modelUsed: curated.modelUsed || env.GEMINI_MODEL || "unknown"
  };

  await env.DADOS_KV.put("feed", JSON.stringify(payload));
  return { ok: true, ...payload };
}

async function fetchSource(source) {
  const res = await fetch(source.feed, {
    headers: {
      "User-Agent": "DadOS/1.0 (+personal recommendation dashboard)",
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1"
    },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`${source.name}: ${res.status}`);

  const xml = await res.text();
  const items = parseFeed(xml).slice(0, MAX_ARTICLES_PER_SOURCE);

  return items.map(item => ({
    ...item,
    source: source.name,
    sourceRole: source.role,
    sourceWeight: source.weight
  }));
}

function parseFeed(xml) {
  const chunks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return chunks.map(block => ({
    title: clean(first(block, ["title"])),
    url: clean(first(block, ["link"])) || linkHref(block),
    summary: stripHtml(clean(first(block, ["description", "summary", "content:encoded", "content"]))),
    publishedAt: clean(first(block, ["pubDate", "published", "updated"]))
  })).filter(x => x.title && x.url);
}

function first(block, tags) {
  for (const tag of tags) {
    const escaped = tag.replace(":", "\\:");
    const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
    const m = block.match(re);
    if (m) return decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, ""));
  }
  return "";
}

function linkHref(block) {
  const m = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return m ? decodeEntities(m[1]) : "";
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function stripHtml(s) {
  return clean(String(s || "").replace(/<[^>]*>/g, " "));
}
function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function isLikelyRelevant(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  if (NEGATIVE_TERMS.some(term => text.includes(term))) return false;
  return POSITIVE_TERMS.some(term => text.includes(term));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function curateWithGemini(candidates, env) {
  const compact = candidates.map((x, i) => ({
    i,
    source: x.source,
    sourceRole: x.sourceRole,
    title: x.title,
    summary: x.summary.slice(0, 650),
    url: x.url,
    publishedAt: x.publishedAt
  }));

  const prompt = `You are the curation engine for DadOS, a private recommendation dashboard.

USER TASTE:
- Likes genuinely useful, well-built consumer technology.
- Strong interests: cameras, 360 cameras, smart glasses, travel technology, drones, clever hardware, quality-of-life upgrades.
- Prefers reputable brands and products that feel solid and trustworthy.
- Avoid generic rebranded junk, suspiciously cheap hardware, gimmicks, clutter, low-quality accessories, and products that only exist because of hype.
- Accounts/apps are fine. Do not penalize normal app ecosystems.
- Only mention a caveat if there is a concrete reason.
- A product appearing in one article is a lead, not proof it is good.
- Give extra confidence to independent review/testing coverage.
- Do not invent prices, product names, sources, URLs, or facts not present in the candidates.
- If an article does not contain enough information to identify a specific consumer product, reject it.

Choose at most 8 genuinely interesting products from these source items.
Prefer variety rather than eight versions of the same product.

SOURCE ITEMS:
${JSON.stringify(compact)}

Return concise structured data for the DadOS cards.`;

  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            brand: { type: "string" },
            title: { type: "string" },
            oneLine: { type: "string" },
            summary: { type: "string" },
            why: { type: "string" },
            price: { type: "string" },
            note: { type: "string" },
            tags: { type: "array", items: { type: "string" }, maxItems: 4 },
            sources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  url: { type: "string" }
                },
                required: ["name", "url"]
              }
            },
            officialUrl: { type: "string" }
          },
          required: ["id","brand","title","oneLine","summary","why","price","note","tags","sources","officialUrl"]
        }
      }
    },
    required: ["items"]
  };

  const preferred = env.GEMINI_MODEL || "gemini-3.8-flash";
  const modelOrder = [
    preferred,
    "gemini-3.7-flash",
    "gemini-3.6-flash"
  ].filter((model, index, arr) => arr.indexOf(model) === index);

  let lastError = null;

  for (const model of modelOrder) {
    // Retry transient errors twice on each model before falling back.
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "x-goog-api-key": env.GEMINI_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: prompt,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = findOutputText(data);
        if (!text) {
          lastError = new Error(`${model} returned no structured text output.`);
          break;
        }

        const parsed = JSON.parse(text);
        parsed.modelUsed = model;
        return parsed;
      }

      const body = await response.text();
      lastError = new Error(`Gemini error ${response.status} on ${model}: ${body}`);

      // Only retry/fallback for transient capacity/rate/server errors.
      const transient = response.status === 429 || response.status >= 500;
      if (!transient) throw lastError;

      if (attempt < 2) {
        const delayMs = 800 * (2 ** attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error("All Gemini fallback models failed.");
}


async function findActivities(input, env) {
  const location = String(input.location || "Reston, Virginia").slice(0,120);
  const mood = String(input.mood || "Interesting").slice(0,40);
  const distance = String(input.distance || "90 min");
  const hungry = String(input.hungry || "Maybe");
  const energy = Math.max(1, Math.min(5, Number(input.energy) || 3));
  const budget = String(input.budget || "$$");

  const geoRes = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(location)}`,
    { headers:{ "User-Agent":"DadOS/1.0 personal activity discovery" } }
  );
  if (!geoRes.ok) throw new Error("Could not locate the search area.");
  const geo = await geoRes.json();
  if (!geo.length) throw new Error("Could not locate the search area.");

  const lat = Number(geo[0].lat);
  const lon = Number(geo[0].lon);

  const radiusMap = {
    "15 min": 18000,
    "45 min": 50000,
    "90 min": 95000,
    "Road trip": 140000
  };
  const radius = radiusMap[distance] || 95000;

  // Real named places only. We intentionally avoid restaurant-heavy results here;
  // food can be part of the AI rationale but the activity remains the anchor.
  const query = `[out:json][timeout:25];
(
  nwr(around:${radius},${lat},${lon})["name"]["tourism"~"attraction|museum|viewpoint|theme_park|zoo|gallery"];
  nwr(around:${radius},${lat},${lon})["name"]["leisure"~"water_park|sports_centre|escape_game|amusement_arcade|marina|golf_course"];
  nwr(around:${radius},${lat},${lon})["name"]["sport"~"climbing|karting|skiing|shooting|archery|canoe|kayak"];
);
out center tags 90;`;

  const overpass = await fetch("https://overpass-api.de/api/interpreter", {
    method:"POST",
    headers:{
      "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent":"DadOS/1.0 personal activity discovery"
    },
    body:"data="+encodeURIComponent(query)
  });
  if (!overpass.ok) throw new Error("Nearby place search is temporarily unavailable.");
  const osm = await overpass.json();

  let candidates = (osm.elements || []).map(el => {
    const t = el.tags || {};
    const plat = el.lat ?? el.center?.lat;
    const plon = el.lon ?? el.center?.lon;
    const website = t.website || t["contact:website"] || "";
    const category = t.tourism || t.leisure || t.sport || "attraction";
    return {
      name:t.name,
      category,
      website: normalizeUrl(website),
      lat:plat,
      lon:plon,
      distanceKm: haversine(lat, lon, plat, plon)
    };
  }).filter(x => x.name && Number.isFinite(x.lat) && Number.isFinite(x.lon));

  // Deduplicate and keep a manageable pool.
  const seen = new Set();
  candidates = candidates.filter(x => {
    const key=x.name.toLowerCase().replace(/[^a-z0-9]+/g,"");
    if(!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,45);

  if (!candidates.length) return { ok:true, items:[] };

  // Gemini ranks only REAL candidates returned by OSM; it is forbidden to invent places.
  const ranked = await rankActivitiesWithGemini(candidates, {mood,distance,hungry,energy,budget}, env);

  const byName = new Map(candidates.map(x=>[x.name,x]));
  const items = (ranked.items || []).map(r => {
    const real = byName.get(r.name);
    if(!real) return null;
    const mapsQuery = `${real.name} near ${location}`;
    return {
      name: real.name,
      meta: r.meta || `${real.category} • ${Math.round(real.distanceKm)} km`,
      why: r.why || "",
      website: real.website,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
    };
  }).filter(Boolean).slice(0,6);

  return { ok:true, items, location };
}

async function rankActivitiesWithGemini(candidates, prefs, env) {
  if (!env.GEMINI_API_KEY) {
    return { items:candidates.slice(0,6).map(x=>({name:x.name,meta:`${x.category} • ${Math.round(x.distanceKm)} km`,why:"A real nearby option that fits the requested search area."})) };
  }

  const prompt = `You rank REAL nearby activity options for DadOS.

Preferences:
${JSON.stringify(prefs)}

Rules:
- You may ONLY choose names exactly from the candidate list.
- Never invent a place.
- Prefer unusual, memorable, adventurous, techy, scenic, experiential, or genuinely interesting options over generic everyday places.
- Match the requested energy, budget, drive range, hunger level, and mood.
- Choose at most 6 and keep variety.
- "why" should be one concise sentence.
- "meta" should be a short category/vibe label, not marketing fluff.

Candidates:
${JSON.stringify(candidates.map(x=>({name:x.name,category:x.category,distanceKm:Math.round(x.distanceKm)})))}

Return JSON only:
{"items":[{"name":"exact candidate name","meta":"short label","why":"one sentence"}]}`;

  const models = [
    env.GEMINI_MODEL || "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash"
  ].filter((m,i,a)=>a.indexOf(m)===i);

  for(const model of models){
    try{
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
        method:"POST",
        headers:{"x-goog-api-key":env.GEMINI_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({
          model,
          input:prompt,
          response_format:{type:"text",mime_type:"application/json"}
        })
      });
      if(!res.ok) continue;
      const data=await res.json();
      const text=findOutputText(data);
      if(!text) continue;
      const parsed=JSON.parse(text);
      if(Array.isArray(parsed.items)) return parsed;
    }catch(e){}
  }

  return { items:candidates.slice(0,6).map(x=>({
    name:x.name,
    meta:`${x.category} • ${Math.round(x.distanceKm)} km`,
    why:"A real nearby option that fits the requested search area."
  })) };
}

function normalizeUrl(url) {
  if(!url) return "";
  if(/^https?:\/\//i.test(url)) return url;
  return "https://" + url.replace(/^\/+/,"");
}

function haversine(lat1, lon1, lat2, lon2) {
  const R=6371;
  const toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function findOutputText(node) {
  if (!node) return "";
  if (typeof node === "object") {
    if (node.type === "text" && typeof node.text === "string") return node.text;
    if (typeof node.output_text === "string") return node.output_text;
    for (const value of Object.values(node)) {
      const found = findOutputText(value);
      if (found) return found;
    }
  }
  if (Array.isArray(node)) {
    for (const value of node) {
      const found = findOutputText(value);
      if (found) return found;
    }
  }
  return "";
}
