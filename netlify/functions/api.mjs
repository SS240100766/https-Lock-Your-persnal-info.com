// Lockbox API: auth, sessions and file storage.
// Records live in Netlify Database (Postgres); file contents live in Netlify Blobs.
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

// ---------- Configuration (environment variables) ----------
// Netlify Functions accept request bodies up to 6 MB, so single files are capped at 4 MB.
const MAX_MB = Math.min(+process.env.MAX_FILE_MB || 4, 4);
const QUOTA_MB = +process.env.USER_QUOTA_MB || 500;
const SIGNUP = process.env.ALLOW_SIGNUP !== 'false'; // extra accounts after the first one
const SESSION_MS = 7 * 24 * 3600 * 1000;

const db = getDatabase();
const files = () => getStore('lockbox-files');

// ---------- Allowed file types: ext -> [mime, safe to view in browser] ----------
const TYPES = {
  pdf: ['application/pdf', 1], txt: ['text/plain; charset=utf-8', 1],
  jpg: ['image/jpeg', 1], jpeg: ['image/jpeg', 1], png: ['image/png', 1],
  doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  zip: ['application/zip']
};

// ---------- Helpers ----------
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Cache-Control': 'no-store'
};
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { ...SEC, ...headers } });
const fail = (status, error) => json({ error }, status);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const sidOf = req => /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.get('cookie') || '')?.[1];
const cleanName = n => {
  n = String(n || '').replace(/\\/g, '/').split('/').pop();
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  if (n.length > 120) { const i = n.lastIndexOf('.'), e = i > 0 ? n.slice(i) : ''; n = n.slice(0, 120 - e.length) + e; }
  return n || 'file';
};
const extOf = n => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
const publicFile = f => ({ id: f.id, name: f.name, ext: f.ext, size: Number(f.size), created_at: Number(f.created_at) });
const usage = async uid => {
  const [r] = await db.sql`SELECT COALESCE(SUM(size),0) AS s, COUNT(*) AS c FROM files WHERE user_id=${uid}`;
  return { s: Number(r.s), c: Number(r.c) };
};
const userCount = async () => Number((await db.sql`SELECT COUNT(*) AS c FROM users`)[0].c);
const limits = () => ({ maxFileMb: MAX_MB, quotaMb: QUOTA_MB, types: Object.keys(TYPES), viewable: Object.keys(TYPES).filter(k => TYPES[k][1]) });

// Check real file contents match the claimed extension (not just the name)
function magicOk(ext, buf) {
  const s = buf.subarray(0, 1024);
  if (!s.length) return false;
  const is = (...x) => x.every((v, i) => s[i] === v);
  switch (ext) {
    case 'pdf': return s.includes('%PDF-');
    case 'png': return is(0x89, 0x50, 0x4e, 0x47);
    case 'jpg': case 'jpeg': return is(0xff, 0xd8, 0xff);
    case 'zip': case 'docx': case 'xlsx': case 'pptx': return is(0x50, 0x4b, 3, 4) || is(0x50, 0x4b, 5, 6);
    case 'doc': case 'xls': case 'ppt': return is(0xd0, 0xcf, 0x11, 0xe0);
    case 'txt': return !s.includes(0);
  }
  return false;
}

async function startSession(uid) {
  const t = crypto.randomBytes(32).toString('hex');
  await db.sql`DELETE FROM sessions WHERE expires_at<${Date.now()}`;
  await db.sql`INSERT INTO sessions VALUES(${sha(t)},${uid},${Date.now() + SESSION_MS})`;
  return `sid=${t}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; Secure; SameSite=Strict`;
}
const CLEAR = 'sid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';

let dummy; // bcrypt hash used to equalise timing for unknown usernames
const DUMMY = async () => (dummy ??= await bcrypt.hash('timing-equaliser', 12));

const body = async req => { try { return await req.json(); } catch { return {}; } };

// ---------- Routes ----------
async function status(req, user) {
  return json({ hasUsers: (await userCount()) > 0, signup: SIGNUP, user: user ? { username: user.display } : null, ...limits() });
}

async function register(req) {
  const first = (await userCount()) === 0;
  if (!first && !SIGNUP) return fail(403, 'New accounts are disabled on this server.');
  const { username, password, confirm } = await body(req);
  const u = typeof username === 'string' ? username.trim() : '';
  if (!u) return fail(400, 'Please enter a username.');
  if (u.length > 40) return fail(400, 'Username must be 40 characters or fewer.');
  if (typeof password !== 'string' || !password) return fail(400, 'Please enter a password.');
  if (password.length < 8) return fail(400, 'Password must be at least 8 characters.');
  if (password.length > 72) return fail(400, 'Password must be 72 characters or fewer.');
  if (password !== confirm) return fail(400, 'Passwords do not match. Please re-enter them.');
  if ((await db.sql`SELECT 1 FROM users WHERE LOWER(username)=LOWER(${u})`).length) return fail(409, 'That username is already taken.');
  const hash = await bcrypt.hash(password, 12);
  let row;
  try {
    [row] = await db.sql`INSERT INTO users(username,display,pass_hash,created_at) VALUES(${u},${u},${hash},${Date.now()}) RETURNING id`;
  } catch (e) {
    if (e.code === '23505') return fail(409, 'That username is already taken.');
    throw e;
  }
  return json({ ok: true }, 201, { 'Set-Cookie': await startSession(row.id) });
}

async function login(req, ip) {
  const now = Date.now();
  const [a] = await db.sql`SELECT n, reset_at FROM login_attempts WHERE ip=${ip}`;
  if (a && Number(a.reset_at) > now && a.n >= 10) return fail(429, 'Too many attempts. Please wait 15 minutes and try again.');
  const { username, password } = await body(req);
  if (typeof username !== 'string' || !username.trim()) return fail(400, 'Please enter your username.');
  if (typeof password !== 'string' || !password) return fail(400, 'Please enter your password.');
  const [row] = await db.sql`SELECT * FROM users WHERE LOWER(username)=LOWER(${username.trim()})`;
  const ok = await bcrypt.compare(password, row ? row.pass_hash : await DUMMY()); // always hash, so timing doesn't reveal valid usernames
  if (!row || !ok) {
    await db.sql`INSERT INTO login_attempts(ip,n,reset_at) VALUES(${ip},1,${now + 15 * 60000})
      ON CONFLICT (ip) DO UPDATE SET
        n = CASE WHEN login_attempts.reset_at > ${now} THEN login_attempts.n + 1 ELSE 1 END,
        reset_at = CASE WHEN login_attempts.reset_at > ${now} THEN login_attempts.reset_at ELSE ${now + 15 * 60000} END`;
    return fail(401, 'Try Again! Wrong Username or Password.');
  }
  await db.sql`DELETE FROM login_attempts WHERE ip=${ip}`;
  return json({ ok: true }, 200, { 'Set-Cookie': await startSession(row.id) });
}

async function logout(req) {
  const sid = sidOf(req);
  if (sid) await db.sql`DELETE FROM sessions WHERE token_hash=${sha(sid)}`;
  return json({ ok: true }, 200, { 'Set-Cookie': CLEAR });
}

async function me(req, user) {
  const u = await usage(user.id);
  return json({ username: user.display, created_at: Number(user.created_at), used: u.s, count: u.c, ...limits() });
}

async function changePassword(req, user) {
  const { current, password, confirm } = await body(req);
  const [row] = await db.sql`SELECT pass_hash FROM users WHERE id=${user.id}`;
  if (typeof current !== 'string' || !(await bcrypt.compare(current, row.pass_hash))) return fail(400, 'Your current password is incorrect.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) return fail(400, 'New password must be 8 to 72 characters.');
  if (password !== confirm) return fail(400, 'New passwords do not match.');
  await db.sql`UPDATE users SET pass_hash=${await bcrypt.hash(password, 12)} WHERE id=${user.id}`;
  await db.sql`DELETE FROM sessions WHERE user_id=${user.id} AND token_hash<>${sha(sidOf(req))}`; // sign out other devices
  return json({ ok: true });
}

// ---------- File routes (every query is scoped to the logged-in user) ----------
const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  date: (a, b) => a.created_at - b.created_at,
  type: (a, b) => a.ext.localeCompare(b.ext),
  size: (a, b) => a.size - b.size
};
async function list(req, user) {
  const p = new URL(req.url).searchParams;
  const q = String(p.get('q') || '').slice(0, 100).replace(/[\\%_]/g, c => '\\' + c);
  const cmp = SORTS[p.get('sort')] || SORTS.date, dir = p.get('dir') === 'asc' ? 1 : -1;
  const rows = (await db.sql`SELECT * FROM files WHERE user_id=${user.id} AND name ILIKE ${'%' + q + '%'} ESCAPE '\\'`).map(publicFile);
  rows.sort((a, b) => dir * cmp(a, b) || SORTS.name(a, b));
  return json({ files: rows });
}

async function upload(req, user) {
  if (+req.headers.get('content-length') > 6 * 1048576) return fail(413, `File too large. Maximum size is ${MAX_MB} MB.`);
  let form;
  try { form = await req.formData(); } catch { return fail(400, 'Invalid request.'); }
  const items = form.getAll('files').filter(f => typeof f === 'object');
  if (items.length > 20) return fail(400, 'Too many files at once. Upload up to 20 at a time.');
  const saved = [], rejected = [];
  let used = (await usage(user.id)).s;
  for (const f of items) {
    const name = cleanName(f.name), ext = extOf(name);
    if (!TYPES[ext]) return fail(415, 'Unsupported file type. Allowed: ' + Object.keys(TYPES).join(', ').toUpperCase() + '.');
    if (f.size > MAX_MB * 1048576) return fail(413, `File too large. Maximum size is ${MAX_MB} MB.`);
    const buf = Buffer.from(await f.arrayBuffer());
    let err = null;
    if (!magicOk(ext, buf)) err = `"${name}" doesn't look like a real ${ext.toUpperCase()} file.`;
    else if (used + buf.length > QUOTA_MB * 1048576) err = 'Storage is full. Delete some files to free up space.';
    if (err) { rejected.push({ name, error: err }); continue; }
    const stored = `${user.id}/${crypto.randomBytes(16).toString('hex')}`; // never use the user's name as the key
    await files().set(stored, buf);
    const row = { id: crypto.randomUUID(), user_id: user.id, name, ext, size: buf.length, stored, created_at: Date.now() };
    await db.sql`INSERT INTO files VALUES(${row.id},${row.user_id},${row.name},${row.ext},${row.size},${row.stored},${row.created_at})`;
    used += buf.length; saved.push(publicFile(row));
  }
  if (!saved.length) return fail(rejected[0]?.error.startsWith('Storage') ? 413 : 415, rejected[0]?.error || 'No file received.');
  return json({ files: saved, rejected }, 201);
}

const own = async (id, user) => (await db.sql`SELECT * FROM files WHERE id=${id} AND user_id=${user.id}`)[0];

async function send(id, user, inline) {
  const f = await own(id, user);
  if (!f) return fail(404, 'File not found.');
  const data = await files().get(f.stored, { type: 'stream' });
  if (!data) return fail(404, 'File not found.');
  const [mime, viewable] = TYPES[f.ext];
  inline = inline && viewable;
  return new Response(data, {
    headers: {
      ...SEC,
      'Content-Type': inline ? mime : 'application/octet-stream', 'Content-Length': String(f.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, no-store',
      ...(inline && f.ext !== 'pdf' ? { 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } : {})
    }
  });
}

async function remove(id, user) {
  const f = await own(id, user);
  if (!f) return fail(404, 'File not found.');
  await files().delete(f.stored);
  await db.sql`DELETE FROM files WHERE id=${f.id} AND user_id=${user.id}`;
  return json({ ok: true });
}

// ---------- Router ----------
export default async (req, context) => {
  try {
    const { pathname } = new URL(req.url);
    const path = pathname.replace(/\/+$/, ''), m = req.method;

    // CSRF defence: SameSite=Strict cookie + a custom header on every state-changing request
    if (!['GET', 'HEAD'].includes(m) && req.headers.get('x-requested-with') !== 'lockbox') return fail(403, 'Request blocked.');

    // Session lookup (cookie holds a random token; only its SHA-256 is stored)
    let user = null;
    const sid = sidOf(req);
    if (sid) {
      [user] = await db.sql`SELECT u.id, u.display, u.created_at FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=${sha(sid)} AND s.expires_at>${Date.now()}`;
    }

    if (path === '/api/status' && m === 'GET') return status(req, user);
    if (path === '/api/register' && m === 'POST') return register(req);
    if (path === '/api/login' && m === 'POST') return login(req, context.ip || 'unknown');
    if (path === '/api/logout' && m === 'POST') return logout(req);

    const isApi = /^\/api\/(me|account\/password|files(\/.*)?)$/.test(path);
    if (isApi && !user) return fail(401, 'Please log in to continue.');

    if (path === '/api/me' && m === 'GET') return me(req, user);
    if (path === '/api/account/password' && m === 'POST') return changePassword(req, user);
    if (path === '/api/files' && m === 'GET') return list(req, user);
    if (path === '/api/files' && m === 'POST') return upload(req, user);
    let r;
    if ((r = /^\/api\/files\/([0-9a-f-]{36})\/(view|download)$/.exec(path)) && m === 'GET') return send(r[1], user, r[2] === 'view');
    if ((r = /^\/api\/files\/([0-9a-f-]{36})$/.exec(path)) && m === 'DELETE') return remove(r[1], user);

    return fail(404, 'Not found.');
  } catch (err) {
    console.error(err);
    return fail(500, 'Server error. Please try again.');
  }
};

export const config = { path: '/api/*' };
