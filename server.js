// Pin Hunt AR — zero-dependency static server + pins API (+ optional ngrok tunnel)
//   npm start          → http://localhost:8080        (AR view)
//                        http://localhost:8080/admin  (manage pins & QR spots)
//   npm run tunnel     → also starts `ngrok http 8080` and prints the HTTPS phone URL
//
// Data lives in data/pins.json. Writes need the admin key:
//   ADMIN_KEY=your-secret npm start   — or leave it unset and one is generated once into .admin-key
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data', 'pins.json');
const KEY_FILE = path.join(ROOT, '.admin-key');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

/* ---------------- admin key ---------------- */
let ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) {
  try { ADMIN_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) {}
  if (!ADMIN_KEY) { ADMIN_KEY = crypto.randomBytes(9).toString('base64url'); fs.writeFileSync(KEY_FILE, ADMIN_KEY + '\n', { mode: 0o600 }); }
}
function authed(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- data ---------------- */
function load() { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
function persist(db) {
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
  fs.renameSync(tmp, DATA);
}
const FLOORS = ['G', 'F1', 'F2'];
const GROUPS = ['food', 'fashion', 'life'];
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const str = v => (typeof v === 'string' ? v.trim() : '');
const num = v => (v === '' || v == null ? NaN : Number(v));
const round1 = n => Math.round(n * 10) / 10;

function cleanStore(b, errors) {
  const o = {};
  o.name = str(b.name); if (!o.name) errors.name = 'Enter the store name'; else if (o.name.length > 40) errors.name = 'Keep it under 40 characters';
  o.ini = str(b.ini) || o.name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  if ([...o.ini].length > 3) errors.ini = 'Up to 3 characters';
  o.kind = str(b.kind).slice(0, 30);
  o.group = GROUPS.includes(b.group) ? b.group : (errors.group = 'Pick a group', 'food');
  o.floor = FLOORS.includes(b.floor) ? b.floor : (errors.floor = 'Pick a floor', 'G');
  for (const k of ['x', 'y']) { const n = num(b[k]); if (!Number.isFinite(n) || Math.abs(n) > 500) errors[k] = 'Metres, between −500 and 500'; else o[k] = round1(n); }
  o.c = /^#[0-9a-f]{6}$/i.test(str(b.c)) ? str(b.c).toLowerCase() : (errors.c = 'Pick a colour', '#d4a574');
  o.offer = str(b.offer); if (!o.offer) errors.offer = 'Describe the campaign offer'; else if (o.offer.length > 120) errors.offer = 'Keep it under 120 characters';
  const a = num(b.a), d = num(b.d), hasA = b.a !== '' && b.a != null, hasD = b.d !== '' && b.d != null;
  if (hasA || hasD) {
    if (!hasA || !Number.isFinite(a) || a < -180 || a > 180) errors.a = 'Degrees, −180 to 180';
    if (!hasD || !Number.isFinite(d) || d < 1 || d > 200) errors.d = 'Metres, 1 to 200';
    o.a = round1(a); o.d = round1(d);
  } else { o.a = null; o.d = null; }
  o.active = b.active !== false;
  return o;
}
function cleanSpot(b, errors) {
  const o = {};
  o.name = str(b.name); if (!o.name) errors.name = 'Enter the spot name'; else if (o.name.length > 40) errors.name = 'Keep it under 40 characters';
  o.floor = FLOORS.includes(b.floor) ? b.floor : (errors.floor = 'Pick a floor', 'G');
  for (const k of ['x', 'y']) { const n = num(b[k]); if (!Number.isFinite(n) || Math.abs(n) > 500) errors[k] = 'Metres, between −500 and 500'; else o[k] = round1(n); }
  const f = num(b.facing); if (!Number.isFinite(f) || f < 0 || f >= 360) errors.facing = 'Degrees, 0 to 359'; else o.facing = Math.round(f);
  return o;
}

/* ---------------- http helpers ---------------- */
function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 64 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

async function api(req, res, p) {
  if (p === '/api/data' && req.method === 'GET') return send(res, 200, load());
  if (p === '/api/session' && req.method === 'GET') return authed(req) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'Wrong admin key' });

  const m = /^\/api\/(stores|spots)(?:\/([a-z0-9-]+))?$/.exec(p);
  if (!m) return send(res, 404, { error: 'Not found' });
  if (!authed(req)) return send(res, 401, { error: 'Wrong admin key' });
  const [, kind, id] = m;
  const db = load(); const list = db[kind];
  const idx = id ? list.findIndex(x => x.id === id) : -1;
  if (id && idx < 0) return send(res, 404, { error: 'Already deleted or never existed' });

  if (req.method === 'DELETE' && id) {
    if (kind === 'spots' && list.length <= 1) return send(res, 409, { error: 'Keep at least one QR spot' });
    const [gone] = list.splice(idx, 1); persist(db); return send(res, 200, { deleted: gone, data: db });
  }
  if ((req.method === 'POST' && !id) || (req.method === 'PUT' && id)) {
    let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'Could not read the request' }); }
    const errors = {};
    const item = kind === 'stores' ? cleanStore(body, errors) : cleanSpot(body, errors);
    if (req.method === 'POST') {
      // spots: id is the ?at= value printed on the QR poster, so it may be chosen; stores: derived from the name
      let base = kind === 'spots' && str(body.id) ? slug(body.id) : slug(body.id || item.name || 'pin');
      if (kind === 'spots' && str(body.id) && !/^[a-z0-9-]{2,24}$/.test(base)) errors.id = 'Use 2–24 lowercase letters, numbers or dashes';
      if (kind === 'spots' && str(body.id) && list.some(x => x.id === base)) errors.id = 'Another spot already uses this code';
      base = base || 'pin'; let nid = base, i = 2; while (list.some(x => x.id === nid)) nid = `${base}-${i++}`;
      if (Object.keys(errors).length) return send(res, 400, { error: 'Check the highlighted fields', errors });
      const rec = { id: nid, ...item }; list.push(rec); persist(db); return send(res, 201, { item: rec, data: db });
    }
    if (Object.keys(errors).length) return send(res, 400, { error: 'Check the highlighted fields', errors });
    list[idx] = { id, ...item }; persist(db); return send(res, 200, { item: list[idx], data: db });
  }
  send(res, 405, { error: 'Method not allowed' });
}

/* ---------------- server ---------------- */
http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (p.startsWith('/api/')) { try { return await api(req, res, p); } catch (e) { console.error(e); return send(res, 500, { error: 'Server error — nothing was saved' }); } }
  if (p === '/admin' || p === '/admin/') p = '/admin.html';
  if (p.endsWith('/')) p += 'index.html';
  // never serve dotfiles (.admin-key, .oil-ui), server source or raw data
  if (/(^|\/)\./.test(p) || p.startsWith('/data/') || p === '/server.js') { res.writeHead(404); return res.end('Not found'); }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Permissions-Policy': 'camera=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)',
    });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`\n  Pin Hunt AR running at http://localhost:${PORT}`);
  console.log(`  Admin:  http://localhost:${PORT}/admin   key: ${process.env.ADMIN_KEY ? '(from ADMIN_KEY)' : ADMIN_KEY + '  (saved in .admin-key)'}`);
  if (process.argv.includes('--tunnel')) startTunnel();
  else console.log('  Camera needs HTTPS on a phone — run `npm run tunnel` (or `ngrok http ' + PORT + '` in another tab).\n');
});

function startTunnel() {
  const ng = spawn('ngrok', ['http', String(PORT), '--log=stdout'], { stdio: ['ignore', 'ignore', 'inherit'] });
  ng.on('error', () => console.log('\n  ngrok not found. Install: brew install ngrok  then: ngrok config add-authtoken <your-token>\n'));
  process.on('exit', () => ng.kill());
  process.on('SIGINT', () => process.exit());
  let tries = 0;
  const poll = setInterval(async () => {
    if (++tries > 30) { clearInterval(poll); return console.log('  Could not read the ngrok URL — check http://127.0.0.1:4040'); }
    try {
      const r = await fetch('http://127.0.0.1:4040/api/tunnels');
      const t = (await r.json()).tunnels.find(x => x.public_url.startsWith('https'));
      if (!t) return;
      clearInterval(poll);
      const u = t.public_url;
      console.log(`\n  Public HTTPS: ${u}`);
      console.log(`  Phone (Gate A poster):   ${u}/?at=gate-a`);
      console.log(`  Phone (Atrium poster):   ${u}/?at=atrium`);
      console.log(`  Real mall coordinates:   ${u}/?at=gate-a&layout=mall`);
      console.log(`  Admin:                   ${u}/admin`);
      console.log(`\n  Open ${u} on this Mac (wide window) to get a QR code for your phone.\n`);
    } catch (e) { /* ngrok still starting */ }
  }, 1000);
}
