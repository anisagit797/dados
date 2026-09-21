# DadOS v12 Fixed

Targeted fixes only:

1. Fresh Finds bootstraps itself on first load if KV is empty.
2. Go Somewhere tries multiple Overpass endpoints.
3. If real-place data sources are temporarily unavailable, Go Somewhere returns useful clickable Google Maps searches instead of a dead error.
4. Core Pick spans the page so there is no giant empty half-column.
5. Plan logic is unchanged from the working clean-reset version.

Upload these directly to the repo root:
- worker.js
- wrangler.toml
- README.md
- public/
