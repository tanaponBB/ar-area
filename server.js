// Pin Hunt AR — local dev server (zero dependencies). On Vercel, public/ is served statically and api/ runs as functions.
//   npm start          → http://localhost:8080        (AR view)
//                        http://localhost:8080/admin  (manage pins & QR spots)
//   npm run tunnel     → also starts `ngrok http 8080` and prints the HTTPS phone URL
//
// Data: data/pins.json (or Upstash Redis when KV_REST_API_URL/KV_REST_API_TOKEN are set — same as on Vercel).
// Admin key: ADMIN_KEY env, or one generated once into .admin-key.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { handle, routeOf, getStore } = require('./lib/pins');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = path.join(__dirname, 'public');
const KEY_FILE = path.join(__dirname, '.admin-key');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

let ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) {
  try { ADMIN_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) {}
  if (!ADMIN_KEY) { ADMIN_KEY = crypto.randomBytes(9).toString('base64url'); fs.writeFileSync(KEY_FILE, ADMIN_KEY + '\n', { mode: 0o600 }); }
}

http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (p.startsWith('/api/')) { const [route, id] = routeOf(p); return handle(req, res, route, id, ADMIN_KEY); }
  // clean URLs like Vercel: /admin → admin.html
  if (p.endsWith('/')) p += 'index.html';
  else if (!path.extname(p)) p += '.html';
  if (/(^|\/)\./.test(p)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
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
  console.log(`  Data:   ${getStore().kind === 'redis' ? 'Upstash Redis' : 'data/pins.json'}`);
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
