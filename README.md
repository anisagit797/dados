# DadOS v5 — Cloudflare-ready

This version is structured as a single Cloudflare Worker with Static Assets.

## What is already expected in your Cloudflare dashboard
- Secret: `GEMINI_API_KEY`
- KV binding: `DADOS_KV` -> namespace `dados-feed`

## Add this next
- Secret: `ADMIN_TOKEN`

Generate a random value locally. On macOS Terminal:
`openssl rand -hex 32`

Do not paste the token into chat. Store it directly in Cloudflare as a Secret.

## Project structure
- `worker.js` — API + scheduled refresh
- `sources.js` — tech-news source list/filtering
- `public/` — DadOS website
- `wrangler.toml` — Worker/static assets/cron config

## Deployment
This package is ready for a Wrangler or Git-connected deployment.


## v6 change — permanent saved items

Saved recommendations now store a full snapshot of the product card in browser storage.
That means a saved product remains on the Saved page even after the live news feed refreshes
and the product disappears from the active feed.
