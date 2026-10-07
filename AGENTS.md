# AGENTS.md

Lockbox is a private file locker deployed on Netlify. It was ported from an Express + SQLite + local-disk app.

## Architecture
- `public/`: a static frontend with no build step. `app.js` calls `/api/*`, and every non-GET request sends the `X-Requested-With: lockbox` header (the CSRF check).
- `netlify/functions/api.mjs`: one function with `config.path = '/api/*'` and a small hand-written router. It uses the Web `Request`/`Response` API and `req.formData()` for uploads.
- Data: Netlify Database through the native driver (`getDatabase().sql`). The schema is hand-written SQL in `netlify/database/migrations/`. Never edit an applied migration; add a new file instead. Don't apply migrations yourself.
- File contents: Netlify Blobs store `lockbox-files`, keyed `<userId>/<random hex>`.

## Conventions and decisions
- Times are stored as BIGINT epoch milliseconds, and pg returns BIGINT as a string, so wrap values in `Number()`.
- Usernames are unique case-insensitively (a unique index on `LOWER(username)`).
- File list sorting happens in JS after the query, because the sort column is user-chosen and per-user lists are small.
- `MAX_FILE_MB` is capped at 4 because buffered function requests are limited to 6 MB.
- The login rate limiter lives in the `login_attempts` table, not in memory.
- The user-facing error strings are checked by `test/smoke.js`. Keep them unchanged.
