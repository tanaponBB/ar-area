// Pin Hunt — shared pins API used by both the local server (server.js) and Vercel functions (api/).
//
// Storage, picked automatically:
//   • Redis (Upstash REST)  when KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + _TOKEN) are set
//   • data/pins.json file   when running locally
//   • read-only seed        on Vercel without Redis (the site works, saving is disabled)
// Writes need ADMIN_KEY (env), sent as "Authorization: Bearer <key>".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SEED = require('../data/pins.json');

const DATA_FILE = path.join(__dirname, '..', 'data', 'pins.json');
const REDIS_KEY = 'pinhunt:data';
const FLOORS = ['G', 'F1', 'F2'];
const GROUPS = ['food', 'fashion', 'life'];
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------------- storage ---------------- */
function redisStore(url, token) {
  const cmd = async (...args) => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error('Redis: ' + (j.error || r.status));
    return j.result;
  };
  return {
    kind: 'redis',
    async load() { const v = await cmd('GET', REDIS_KEY); return v ? JSON.parse(v) : clone(SEED); },
    async save(db) { await cmd('SET', REDIS_KEY, JSON.stringify(db)); },
  };
}
function fileStore(file) {
  return {
    kind: 'file',
    async load() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return clone(SEED); } },
    async save(db) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n'); fs.renameSync(tmp, file); },
  };
}
function readOnlyStore() {
  return {
    kind: 'readonly',
    async load() { return clone(SEED); },
    async save() { const e = new Error('Saving is off on this deployment — connect an Upstash Redis store to the Vercel project (see README).'); e.status = 503; throw e; },
  };
}
let store;
function getStore() {
  if (store) return store;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  store = url && token ? redisStore(url.replace(/\/+$/, ''), token) : process.env.VERCEL ? readOnlyStore() : fileStore(DATA_FILE);
  return store;
}

/* ---------------- auth ---------------- */
function authed(req, adminKey) {
  if (!adminKey) return false;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(adminKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- validation ---------------- */
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
  o.products = cleanProducts(b.products, errors);
  return o;
}
function cleanProducts(arr, errors) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) { errors.products = 'Products must be a list'; return []; }
  if (arr.length > 60) errors.products = 'Up to 60 products per store';
  const ids = new Set();
  return arr.slice(0, 60).map((p, i) => {
    p = p && typeof p === 'object' ? p : {};
    const o = {}, e = f => `products.${i}.${f}`;
    let id = slug(p.id || ''); if (!id || ids.has(id)) id = 'p' + crypto.randomBytes(3).toString('hex'); ids.add(id); o.id = id;
    o.name = str(p.name); if (!o.name) errors[e('name')] = 'Enter the product name'; else if (o.name.length > 60) errors[e('name')] = 'Keep it under 60 characters';
    const hasPrice = p.price !== '' && p.price != null, pr = num(p.price);
    if (hasPrice && (!Number.isFinite(pr) || pr < 0 || pr > 1e6)) errors[e('price')] = 'Price in baht, 0 or more';
    o.price = hasPrice && Number.isFinite(pr) ? Math.round(pr * 100) / 100 : null;
    o.desc = str(p.desc); if (o.desc.length > 140) errors[e('desc')] = 'Keep it under 140 characters';
    o.tag = str(p.tag); if (o.tag.length > 24) errors[e('tag')] = 'Keep it under 24 characters';
    o.img = str(p.img); if (o.img && !/^https:\/\/[^\s"'<>]{4,400}$/.test(o.img)) errors[e('img')] = 'Use an https:// image link';
    o.available = p.available !== false;
    return o;
  });
}
function cleanSpot(b, errors) {
  const o = {};
  o.name = str(b.name); if (!o.name) errors.name = 'Enter the spot name'; else if (o.name.length > 40) errors.name = 'Keep it under 40 characters';
  o.floor = FLOORS.includes(b.floor) ? b.floor : (errors.floor = 'Pick a floor', 'G');
  for (const k of ['x', 'y']) { const n = num(b[k]); if (!Number.isFinite(n) || Math.abs(n) > 500) errors[k] = 'Metres, between −500 and 500'; else o[k] = round1(n); }
  const f = num(b.facing); if (!Number.isFinite(f) || f < 0 || f >= 360) errors.facing = 'Degrees, 0 to 359'; else o.facing = Math.round(f);
  return o;
}

/* ---------------- http ---------------- */
function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  // Vercel pre-parses JSON into req.body; plain Node needs the stream read.
  if ('body' in req && req.body !== undefined) return typeof req.body === 'string' ? (req.body ? JSON.parse(req.body) : {}) : (req.body || {});
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 64 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/**
 * route: 'data' | 'session' | 'stores' | 'spots'; id: optional record id.
 * adminKey: the key writes must present (defaults to process.env.ADMIN_KEY).
 */
async function handle(req, res, route, id, adminKey = process.env.ADMIN_KEY) {
  try {
    const st = getStore();
    if (route === 'data') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      return send(res, 200, await st.load());
    }
    if (route === 'session') {
      if (!adminKey) return send(res, 503, { error: 'ADMIN_KEY is not set on the server.' });
      return authed(req, adminKey) ? send(res, 200, { ok: true, storage: st.kind }) : send(res, 401, { error: 'Wrong admin key' });
    }
    if (route !== 'stores' && route !== 'spots') return send(res, 404, { error: 'Not found' });
    if (id != null && !/^[a-z0-9-]+$/.test(id)) return send(res, 404, { error: 'Not found' });
    if (!authed(req, adminKey)) return send(res, 401, { error: 'Wrong admin key' });

    const kind = route;
    const db = await st.load(); const list = db[kind];
    const idx = id ? list.findIndex(x => x.id === id) : -1;
    if (id && idx < 0) return send(res, 404, { error: 'Already deleted or never existed' });

    if (req.method === 'DELETE' && id) {
      if (kind === 'spots' && list.length <= 1) return send(res, 409, { error: 'Keep at least one QR spot' });
      const [gone] = list.splice(idx, 1); await st.save(db); return send(res, 200, { deleted: gone, data: db });
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
        const rec = { id: nid, ...item }; list.push(rec); await st.save(db); return send(res, 201, { item: rec, data: db });
      }
      if (Object.keys(errors).length) return send(res, 400, { error: 'Check the highlighted fields', errors });
      if (kind === 'stores' && body.products === undefined) item.products = list[idx].products || []; // older clients: keep products
      list[idx] = { id, ...item }; await st.save(db); return send(res, 200, { item: list[idx], data: db });
    }
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Server error — nothing was saved' });
  }
}

/** Parse "/api/stores/kopi" → ['stores', 'kopi'] (used by the local server). */
function routeOf(p) {
  const m = /^\/api\/([a-z]+)(?:\/([^/]+))?\/?$/.exec(p);
  return m ? [m[1], m[2] != null ? decodeURIComponent(m[2]) : null] : [null, null];
}

module.exports = { handle, routeOf, getStore };
