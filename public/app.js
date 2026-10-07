(() => {
'use strict';
const $ = s => document.querySelector(s);
const state = { cfg: null, signup: false, hasUsers: false, sort: 'date', dir: 'desc', q: '' };

// ---------- helpers ----------
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k.startsWith('data-') || k === 'class' || k === 'title' || k === 'href' || k === 'target' || k === 'rel' || k === 'aria-label' ? e.setAttribute(k, v) : (e[k] = v);
  kids.flat().forEach(c => e.append(c));
  return e;
};
async function api(path, o = {}) {
  const init = { credentials: 'same-origin', method: o.method || 'GET', headers: { 'X-Requested-With': 'lockbox' } };
  if (o.json) { init.method = o.method || 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.json); }
  let r;
  try { r = await fetch(path, init); } catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  if (o.raw && r.ok) return r;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && state.user && !o.quiet) { toast('Your session ended. Please log in again.', 'err'); boot(); }
    throw Object.assign(new Error(d.error || 'Server error. Please try again.'), { status: r.status });
  }
  return d;
}
function toast(msg, type = 'ok') {
  const t = h('div', { class: 'toast ' + type, role: type === 'err' ? 'alert' : 'status' }, msg);
  $('#toasts').append(t); setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
}
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const fmtDate = ms => {
  const d = new Date(ms), n = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const kind = e => ({ pdf: 'pdf', doc: 'doc', docx: 'doc', xls: 'xls', xlsx: 'xls', ppt: 'ppt', pptx: 'ppt', jpg: 'img', jpeg: 'img', png: 'img', zip: 'zip' }[e] || 'txt');
const show = (el, msg, cls = 'err') => { el.className = 'msg ' + cls; el.textContent = msg; el.hidden = false; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle('loading', on); };

// theme
try { const t = localStorage.getItem('lockbox.theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
$('#theme').onclick = () => {
  const dark = matchMedia('(prefers-color-scheme:dark)').matches;
  const cur = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('lockbox.theme', next); } catch {}
};

// ---------- boot / routing ----------
async function boot() {
  try {
    const s = await api('/api/status', { quiet: true });
    state.cfg = s; state.signup = s.signup; state.hasUsers = s.hasUsers; state.user = s.user;
    s.user ? await enterApp() : enterAuth(s.hasUsers ? 'login' : 'setup');
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', '<p style="padding:24px">' + e.message + '</p>');
  } finally { $('#boot').hidden = true; }
}
function enterAuth(mode) {
  state.user = null;
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#setup').hidden = mode !== 'setup'; $('#login').hidden = mode !== 'login';
  $('#toLoginWrap').hidden = !state.hasUsers; $('#toSetupWrap').hidden = !state.signup;
  document.querySelectorAll('.msg').forEach(m => m.hidden = true);
  (mode === 'login' ? $('#lu') : $('#su')).focus();
}
$('#toSetup').onclick = () => enterAuth('setup');
$('#toLogin').onclick = () => enterAuth('login');
document.querySelectorAll('.eye').forEach(b => b.onclick = () => {
  const i = $('#' + b.dataset.for), s = i.type === 'password';
  i.type = s ? 'text' : 'password'; b.textContent = s ? 'Hide' : 'Show';
});

// ---------- create account ----------
$('#setup').onsubmit = async e => {
  e.preventDefault();
  const m = $('#setupMsg'), u = $('#su').value.trim(), p = $('#sp').value, c = $('#sc').value;
  m.hidden = true;
  if (!u) return show(m, 'Please enter a username.');
  if (!p) return show(m, 'Please enter a password.');
  if (!c) return show(m, 'Please confirm your password.');
  if (p !== c) return show(m, 'Passwords do not match. Please re-enter them.');
  if (p.length < 8) return show(m, 'Password must be at least 8 characters.');
  const btn = e.submitter; busy(btn, true);
  try {
    await api('/api/register', { json: { username: u, password: p, confirm: c } });
    show(m, 'Account Created Successfully', 'ok');
    e.target.reset();
    setTimeout(async () => { const s = await api('/api/status'); state.user = s.user; state.hasUsers = true; await enterApp(); }, 900);
  } catch (err) { show(m, err.message); busy(btn, false); }
};

// ---------- login / logout ----------
$('#login').onsubmit = async e => {
  e.preventDefault();
  const m = $('#loginMsg'); m.hidden = true;
  const btn = e.submitter; busy(btn, true);
  try {
    await api('/api/login', { json: { username: $('#lu').value, password: $('#lp').value } });
    e.target.reset();
    const s = await api('/api/status'); state.user = s.user; await enterApp();
  } catch (err) {
    $('#lp').value = ''; show(m, err.message); $('#lp').focus();
  } finally { busy(btn, false); }
};
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  state.user = null; $('#list').replaceChildren(); enterAuth('login');
}
['#logoutTop', '#tOut', '#nOut'].forEach(s => $(s).onclick = logout);

// ---------- app ----------
async function enterApp() {
  $('#auth').hidden = true; $('#app').hidden = false;
  const types = state.cfg.types.map(t => t.toUpperCase()).join(', ');
  $('#allowed').textContent = `Accepted: ${types}. Up to ${state.cfg.maxFileMb} MB each.`;
  $('#picker').accept = state.cfg.types.map(t => '.' + t).join(',');
  await refresh();
  window.scrollTo(0, 0);
}
async function refresh() {
  try {
    const [me, f] = await Promise.all([api('/api/me'), api(`/api/files?q=${encodeURIComponent(state.q)}&sort=${state.sort}&dir=${state.dir}`)]);
    $('#hello').textContent = 'Welcome, ' + me.username;
    $('#tName').textContent = me.username;
    $('#tCount').textContent = me.count + (me.count === 1 ? ' file' : ' files');
    $('#tUsed').textContent = `${fmtSize(me.used)} of ${me.quotaMb} MB`;
    $('#tBar').style.width = Math.min(100, me.used / (me.quotaMb * 1048576) * 100) + '%';
    state.me = me; renderFiles(f.files, me.count);
  } catch (e) { if (e.status !== 401) toast(e.message, 'err'); }
}
function renderFiles(files, total) {
  const list = $('#list');
  if (!files.length) {
    list.replaceChildren(h('div', { class: 'empty' }, total && state.q ? `No files match "${state.q}".` : 'No files yet. Drop a file above or tap Upload File.'));
    return;
  }
  const head = h('div', { class: 'row head', 'aria-hidden': 'true' }, h('span', {}, 'File'), h('span', {}, 'Type'), h('span', {}, 'Size'), h('span', {}, 'Date'), h('span', {}, 'Actions'));
  list.replaceChildren(head, ...files.map(f => {
    const view = state.cfg.viewable.includes(f.ext)
      ? h('a', { href: `/api/files/${f.id}/view`, target: '_blank', rel: 'noopener' }, 'View')
      : h('button', { onclick: () => download(f) }, 'Open');
    return h('div', { class: 'row' },
      h('div', { class: 'fname' }, h('span', { class: 'ico', 'data-k': kind(f.ext) }, f.ext.toUpperCase()), h('span', { class: 'nm', title: f.name }, f.name)),
      h('span', { class: 'c', 'data-l': 'Type' }, f.ext.toUpperCase()),
      h('span', { class: 'c', 'data-l': 'Size' }, fmtSize(f.size)),
      h('span', { class: 'c', 'data-l': 'Date' }, fmtDate(f.created_at)),
      h('div', { class: 'acts' }, view, h('button', { onclick: () => download(f) }, '⬇ Download'), h('button', { class: 'del', onclick: () => ask(f) }, 'Delete')));
  }));
}

// search + sort
let timer;
$('#q').oninput = e => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim(); refresh(); }, 250); };
$('#sort').onchange = e => { state.sort = e.target.value; state.dir = e.target.value === 'name' || e.target.value === 'type' ? 'asc' : 'desc'; $('#dir').textContent = state.dir === 'asc' ? '↑' : '↓'; refresh(); };
$('#dir').onclick = () => { state.dir = state.dir === 'asc' ? 'desc' : 'asc'; $('#dir').textContent = state.dir === 'asc' ? '↑' : '↓'; refresh(); };

// ---------- download / delete ----------
async function download(f) {
  try {
    const r = await api(`/api/files/${f.id}/download`, { raw: true });
    const url = URL.createObjectURL(await r.blob());
    const a = h('a', { href: url }); a.download = f.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Downloaded ' + f.name);
  } catch (e) { toast('Download failed. ' + e.message, 'err'); }
}
let target = null;
function ask(f) { target = f; $('#confirmName').textContent = f.name; $('#confirm').showModal(); }
$('#confirm').onclose = async () => {
  if ($('#confirm').returnValue !== 'delete' || !target) return;
  const f = target; target = null;
  try { await api('/api/files/' + f.id, { method: 'DELETE' }); toast('Deleted ' + f.name); refresh(); }
  catch (e) { toast('Delete failed. ' + e.message, 'err'); }
};

// ---------- upload ----------
const picker = $('#picker'), drop = $('#drop');
const openPicker = () => picker.click();
$('#pick').onclick = e => { e.stopPropagation(); openPicker(); };
drop.onclick = openPicker;
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } };
['#tUpload', '#nUpload'].forEach(s => $(s).onclick = () => { $('#files').scrollIntoView(); openPicker(); });
['#tFiles', '#nFiles'].forEach(s => $(s).onclick = () => $('#files').scrollIntoView());
picker.onchange = () => { handle([...picker.files]); picker.value = ''; };
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => handle([...e.dataTransfer.files]));
// stop the browser from navigating away if a file is dropped outside the zone
['dragover', 'drop'].forEach(t => window.addEventListener(t, e => e.preventDefault()));

function queueItem(name) {
  const bar = h('i'), status = h('b', {}, '0%');
  const el = h('div', { class: 'q' }, h('div', {}, h('span', {}, name), status), h('div', { class: 'bar' }, bar));
  $('#queue').append(el);
  return {
    set: p => { bar.style.width = p * 100 + '%'; status.textContent = Math.round(p * 100) + '%'; },
    done: () => { el.classList.add('done'); bar.style.width = '100%'; status.textContent = 'Uploaded'; setTimeout(() => el.remove(), 2500); },
    fail: msg => { el.classList.add('bad'); el.replaceChildren(h('div', {}, h('span', { title: msg }, name + ': ' + msg))); setTimeout(() => el.remove(), 8000); }
  };
}
function uploadOne(file) {
  return new Promise(resolve => {
    const item = queueItem(file.name), fd = new FormData(); fd.append('files', file);
    const x = new XMLHttpRequest();
    x.open('POST', '/api/files'); x.setRequestHeader('X-Requested-With', 'lockbox');
    x.upload.onprogress = e => e.lengthComputable && item.set(e.loaded / e.total);
    x.onload = () => {
      let d = {}; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status === 401) { boot(); return resolve(false); }
      if (x.status < 300) { item.done(); resolve(true); }
      else { item.fail(d.error || 'Upload failed. Please try again.'); toast(d.error || 'Upload failed. Please try again.', 'err'); resolve(false); }
    };
    x.onerror = () => { item.fail('Upload failed. Check your connection.'); toast('Upload failed. Check your connection and try again.', 'err'); resolve(false); };
    x.send(fd);
  });
}
async function handle(files) {
  if (!files.length) return;
  const { types, maxFileMb } = state.cfg, ok = [];
  for (const f of files) {
    const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
    if (!types.includes(ext)) toast(`"${f.name}" is not a supported file type. Use ${types.map(t => t.toUpperCase()).join(', ')}.`, 'err');
    else if (f.size > maxFileMb * 1048576) toast(`"${f.name}" is too large. Maximum size is ${maxFileMb} MB.`, 'err');
    else if (!f.size) toast(`"${f.name}" is empty.`, 'err');
    else ok.push(f);
  }
  let n = 0;
  for (const f of ok) if (await uploadOne(f)) n++;
  if (n) { toast(n === 1 ? 'File uploaded successfully' : n + ' files uploaded successfully'); refresh(); }
}

// ---------- account ----------
function openAccount() {
  $('#acctInfo').textContent = `Signed in as ${state.me?.username}. Member since ${new Date(state.me?.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.`;
  $('#pwMsg').hidden = true; $('#pwForm').reset(); $('#account').showModal();
}
['#acctTop', '#tAcct', '#nAcct'].forEach(s => $(s).onclick = openAccount);
$('#acctClose').onclick = () => $('#account').close();
$('#pwForm').onsubmit = async e => {
  e.preventDefault();
  const m = $('#pwMsg'), c = $('#cp').value, p = $('#np').value, n = $('#nc').value;
  if (!c || !p || !n) return show(m, 'Please fill in all three fields.');
  if (p !== n) return show(m, 'New passwords do not match.');
  const btn = e.submitter; busy(btn, true);
  try { await api('/api/account/password', { json: { current: c, password: p, confirm: n } }); $('#account').close(); toast('Password changed'); }
  catch (err) { show(m, err.message); } finally { busy(btn, false); }
};

boot();
})();
