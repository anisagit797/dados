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
    sourceCount: new Set(fresh.map(x => x.source)).size
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

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.GEMINI_MODEL || "gemini-3.8-flash",
      input: prompt,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = findOutputText(data);
  if (!text) throw new Error("Gemini returned no structured text output.");

  return JSON.parse(text);
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
