// End-to-end check against a FRESH database. Start `netlify dev --port 8889` first, then:
//   node test/smoke.js http://localhost:8889
const base = process.argv[2] || 'http://localhost:8889';
let pass = 0, failN = 0;
const ok = (c, name) => { c ? pass++ : failN++; console.log((c ? 'PASS ' : 'FAIL ') + name); };
const client = () => {
  let cookie = '';
  return async (path, o = {}) => {
    const r = await fetch(base + path, { ...o, headers: { 'X-Requested-With': 'lockbox', cookie, ...(o.json ? { 'Content-Type': 'application/json' } : {}) }, body: o.json ? JSON.stringify(o.json) : o.body, method: o.method || (o.json || o.body ? 'POST' : 'GET') });
    const sc = r.headers.getSetCookie?.().find(c => c.startsWith('sid=')); if (sc) cookie = /^sid=;/.test(sc) ? '' : sc.split(';')[0];
    return r;
  };
};
const form = (name, bytes) => { const f = new FormData(); f.append('files', new Blob([bytes]), name); return f; };
(async () => {
  const A = client(), B = client(), anon = client();
  let r = await anon('/api/status'); ok((await r.json()).hasUsers === false, '1. first visit has no users (setup screen)');
  r = await A('/api/register', { json: { username: 'alice', password: 'password-A1', confirm: 'nope' } }); ok(r.status === 400, 'setup rejects mismatched passwords');
  r = await A('/api/register', { json: { username: 'alice', password: 'password-A1', confirm: 'password-A1' } }); ok(r.status === 201, '1. account created');
  r = await A('/api/me'); ok(r.status === 200, 'session works after setup');
  await A('/api/logout', { method: 'POST' }); r = await A('/api/me'); ok(r.status === 401, '5. logout ends session');
  r = await A('/api/login', { json: { username: 'alice', password: 'wrong-pass' } }); let d = await r.json();
  ok(r.status === 401 && d.error === 'Try Again! Wrong Username or Password.', '3. wrong password -> exact message');
  r = await A('/api/login', { json: { username: 'nobody', password: 'password-A1' } }); d = await r.json();
  ok(r.status === 401 && d.error === 'Try Again! Wrong Username or Password.', '3. wrong username -> same message');
  r = await A('/api/files'); ok(r.status === 401, 'files API blocked when logged out');
  r = await A('/api/login', { json: { username: 'Alice', password: 'password-A1' } }); ok(r.status === 200, '4. correct login');
  r = await A('/api/files', { body: form('Report.pdf', '%PDF-1.4\nhello lockbox\n%%EOF') }); d = await r.json(); ok(r.status === 201, '6. upload pdf');
  const id = d.files?.[0]?.id;
  r = await A('/api/files', { body: form('evil.exe', 'MZ....') }); ok(r.status === 415, 'unsupported type rejected');
  r = await A('/api/files', { body: form('fake.pdf', 'this is not a pdf') }); ok(r.status === 415, 'fake pdf (bad contents) rejected');
  r = await A('/api/files', { body: form('../../etc/pass.txt', 'hi there') }); d = await r.json(); ok(r.status === 201 && !d.files[0].name.includes('/'), 'filename sanitised');
  r = await A('/api/files?q=report'); d = await r.json(); ok(d.files.length === 1 && d.files[0].name === 'Report.pdf', 'search by name');
  r = await A(`/api/files/${id}/view`); ok(r.status === 200 && (r.headers.get('content-type') || '').includes('pdf'), '7. view file');
  r = await A(`/api/files/${id}/download`); ok(r.status === 200 && (await r.text()).includes('hello lockbox') && /attachment/.test(r.headers.get('content-disposition')), '8. download file');
  r = await B('/api/register', { json: { username: 'bob', password: 'password-B1', confirm: 'password-B1' } }); ok(r.status === 201, 'second user created');
  r = await B('/api/files'); d = await r.json(); ok(d.files.length === 0, '12. bob sees none of alice\'s files');
  r = await B(`/api/files/${id}/download`); ok(r.status === 404, '12. bob cannot download alice\'s file');
  r = await B(`/api/files/${id}/view`); ok(r.status === 404, '12. bob cannot view alice\'s file');
  r = await B(`/api/files/${id}`, { method: 'DELETE' }); ok(r.status === 404, '12. bob cannot delete alice\'s file');
  r = await A(`/api/files/${id}`, { method: 'DELETE' }); ok(r.status === 200, '9. delete file');
  r = await A(`/api/files/${id}/download`); ok(r.status === 404, 'deleted file is gone');
  await A('/api/logout', { method: 'POST' });
  r = await A('/api/login', { json: { username: 'alice', password: 'password-A1' } }); ok(r.status === 200, '10. login again');
  r = await A('/api/files'); d = await r.json(); ok(d.files.length === 1 && d.files[0].name.endsWith('pass.txt'), '11. remaining file still there');
  r = await fetch(base + '/api/logout', { method: 'POST' }); ok(r.status === 403, 'CSRF header required');
  console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN ? 1 : 0);
})();
