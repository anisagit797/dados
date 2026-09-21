# DadOS v13 Stable

Targeted reliability fixes:

- Go Somewhere no longer depends on Overpass at all.
- It uses a built-in catalog of real nearby destinations, then Gemini ranks them.
- If Gemini fails, local ranking still works.
- Fresh Finds now uses multiple RSS sources plus a Google News RSS fallback.
- If Gemini curation fails, real recent article cards still render.
- KV is optional for reading/writing the feed; it is no longer a single point of failure.
- Planner remains unchanged.

Upload to repo root:
- worker.js
- README.md
- public/
Keep your existing wrangler.toml.
