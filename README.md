# Lockbox: private file storage with secure login

Lockbox is a personal file locker. The first visit shows **Create Your Account**, and every visit after that shows **Login**. Once signed in, you can upload, search, sort, view, download and delete your own files. Nobody else can see them.

## Technology

- **Frontend:** plain HTML/CSS/JS in `public/`, with no build step. It has a light/dark theme and a responsive layout.
- **API:** one Netlify Function (`netlify/functions/api.mjs`) serving `/api/*`.
- **Database:** Netlify Database (managed Postgres) holds users, sessions, file records and login-attempt counters. The schema is in `netlify/database/migrations/`, and Netlify applies it automatically on deploy.
- **File storage:** Netlify Blobs (store `lockbox-files`). Files are saved under random keys, and the original name is kept only in the database.

## Folder structure

```
public/                      index.html, style.css, app.js (frontend)
netlify/functions/api.mjs    Auth, sessions, file API, security checks
netlify/database/migrations/ SQL schema
test/smoke.js                End-to-end test of the whole flow
netlify.toml                 Publish dir + security headers
```

## Run locally

```bash
npm install
npx netlify dev --port 8889
# open http://localhost:8889
```

## Test the full flow

With `netlify dev` running against a fresh database:

```bash
node test/smoke.js http://localhost:8889
```

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `MAX_FILE_MB` | 4 | Largest single file (4 MB maximum, set by the Netlify Functions request size limit) |
| `USER_QUOTA_MB` | 500 | Storage per user |
| `ALLOW_SIGNUP` | true | `false` = only the first account can ever be created |

## Security summary

- Passwords are hashed with bcrypt (cost 12).
- Each session uses a random 256-bit token in an HttpOnly, Secure, SameSite=Strict cookie. Only the token's SHA-256 hash is stored. Sessions last 7 days, and changing your password signs out your other devices.
- A wrong username and a wrong password return the same message, with the same response time. After 10 failed attempts, an IP address is locked out of login for 15 minutes. The counter is kept in the database, so it holds across function instances.
- CSRF protection uses the SameSite cookie plus a required custom header on every state-changing request.
- Every file query is scoped to the logged-in user, so another user's files return 404.
- Uploads are checked against an extension allow-list, a size limit and a per-user quota. The real contents are also checked (file signature), and file names are cleaned up.
- Downloads are always sent as attachments. Browser viewing is limited to PDF, image and TXT files, and non-PDF views are sandboxed.

## What's left

- Large files: uploads are capped at 4 MB per file. Supporting bigger files would need chunked or direct-to-storage uploads.
- There is no email-based password reset yet.
