# DadOS — Clean Reset

Upload THESE FILES directly to the ROOT of the GitHub `dados` repo:

- `worker.js`
- `wrangler.toml`
- `README.md`
- `public/`

Do not upload the enclosing `DadOS-clean-reset` folder.

Keep the existing Cloudflare setup:
- `GEMINI_API_KEY` secret
- `ADMIN_TOKEN` secret
- `DADOS_KV` binding to `dados-feed`
- GitHub build connection
- cron triggers

This build contains no legacy hard-coded travel template.

The public page visibly says `DadOS Clean Reset` in the lower-right corner.
