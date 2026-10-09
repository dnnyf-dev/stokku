// server.js — API + file statis StokKu, murni modul bawaan Node (tanpa dependensi)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, tx } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const SESSION_DAYS = 14;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ---------- util ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

function send(res, status, body, headers) {
  const isObj = typeof body === 'object' && body !== null && !Buffer.isBuffer(body);
  res.writeHead(status, Object.assign({ 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(isObj ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 100 * 1024) { reject(new HttpError(413, 'Data terlalu besar')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('JSON tidak valid')); } });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

function cookieHeader(req, token, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`;
}

// ---------- password & sesi ----------
function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function checkPassword(pw, salt, hash) {
  const a = Buffer.from(hashPassword(pw, salt), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + SESSION_DAYS * 86400000);
  return token;
}
function userFromReq(req) {
  const token = parseCookies(req).sid; if (!token) return null;
  const row = db.prepare('SELECT u.id, u.email, u.name, u.is_demo, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); return null; }
  return { id: row.id, email: row.email, name: row.name, is_demo: row.is_demo, token };
}

// pembatas percobaan login sederhana (per IP), di memori
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(), a = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60000);
  attempts.set(ip, a); return a.length >= 10;
}
function noteAttempt(ip) { const a = attempts.get(ip) || []; a.push(Date.now()); attempts.set(ip, a); }

// ---------- validasi ----------
const int = (v, name, { min = 0, max = 1e9 } = {}) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} harus bilangan bulat ${min}–${max}`);
  return n;
};
const str = (v, name, max) => {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw bad(`${name} wajib diisi`);
  if (s.length > max) throw bad(`${name} maksimal ${max} karakter`);
  return s;
};

// ---------- data demo ----------
const DEMO = [
  ['Beras Premium 5kg', 'BRS-5', 'Sembako', 72000, 40, 10], ['Minyak Goreng 2L', 'MNY-2', 'Sembako', 36000, 6, 10],
  ['Gula Pasir 1kg', 'GLA-1', 'Sembako', 17500, 25, 10], ['Telur Ayam 1kg', 'TLR-1', 'Sembako', 29000, 3, 8],
  ['Kopi Bubuk 200g', 'KPI-200', 'Minuman', 24000, 18, 6], ['Teh Celup 25s', 'TEH-25', 'Minuman', 9500, 4, 6],
  ['Sabun Mandi', 'SBN-1', 'Kebersihan', 4500, 60, 15], ['Deterjen 800g', 'DTR-8', 'Kebersihan', 21000, 12, 5],
  ['Mie Instan', 'MIE-1', 'Makanan', 3500, 120, 40], ['Biskuit Kelapa', 'BSK-1', 'Makanan', 11000, 2, 8]
];
function createDemoUser() {
  db.prepare("DELETE FROM users WHERE is_demo = 1 AND created_at < datetime('now','-1 day')").run();
  return tx(() => {
    const salt = crypto.randomBytes(16).toString('hex');
    const id = Number(db.prepare('INSERT INTO users (email, name, salt, pass_hash, is_demo) VALUES (?,?,?,?,1)')
      .run(`demo-${crypto.randomBytes(5).toString('hex')}@demo.local`, 'Pengunjung Demo', salt, hashPassword(crypto.randomBytes(12).toString('hex'), salt)).lastInsertRowid);
    const ins = db.prepare('INSERT INTO products (user_id,name,sku,category,price,stock,min_stock) VALUES (?,?,?,?,?,?,?)');
    const mv = db.prepare("INSERT INTO movements (user_id,product_id,type,qty,stock_after,note,created_at) VALUES (?,?,'in',?,?,'Stok awal',datetime('now', ?))");
    DEMO.forEach((d, i) => { const pid = Number(ins.run(id, ...d).lastInsertRowid); mv.run(id, pid, d[4], d[4], `-${i} hours`); });
    return id;
  });
}

// ---------- rute ----------
const routes = [];
const route = (method, pattern, fn, auth = true) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:id/g, '(\\d+)') + '$'), fn, auth });

route('POST', '/api/register', async (ctx) => {
  if (tooMany(ctx.ip)) throw new HttpError(429, 'Terlalu banyak percobaan, coba lagi nanti');
  noteAttempt(ctx.ip);
  const name = str(ctx.body.name, 'Nama', 60);
  const email = str(ctx.body.email, 'Email', 120).toLowerCase();
  const pw = String(ctx.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Format email tidak valid');
  if (pw.length < 8) throw bad('Password minimal 8 karakter');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Email sudah terdaftar');
  const salt = crypto.randomBytes(16).toString('hex');
  const id = Number(db.prepare('INSERT INTO users (email,name,salt,pass_hash) VALUES (?,?,?,?)').run(email, name, salt, hashPassword(pw, salt)).lastInsertRowid);
  return { user: { id, name, email }, _cookie: createSession(id) };
}, false);

route('POST', '/api/login', async (ctx) => {
  if (tooMany(ctx.ip)) throw new HttpError(429, 'Terlalu banyak percobaan, coba lagi nanti');
  const email = String(ctx.body.email || '').trim().toLowerCase(), pw = String(ctx.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND is_demo = 0').get(email);
  if (!u || !checkPassword(pw, u.salt, u.pass_hash)) { noteAttempt(ctx.ip); throw new HttpError(401, 'Email atau password salah'); }
  return { user: { id: u.id, name: u.name, email: u.email }, _cookie: createSession(u.id) };
}, false);

route('POST', '/api/demo', async (ctx) => {
  if (tooMany(ctx.ip)) throw new HttpError(429, 'Terlalu banyak percobaan, coba lagi nanti');
  noteAttempt(ctx.ip);
  const id = createDemoUser();
  return { user: { id, name: 'Pengunjung Demo', email: '', is_demo: 1 }, _cookie: createSession(id) };
}, false);

route('POST', '/api/logout', async (ctx) => { db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.user.token); return { ok: true, _cookie: '' }; });
route('GET', '/api/me', async (ctx) => { const u = userFromReq(ctx.req); return { user: u && { id: u.id, name: u.name, email: u.email, is_demo: u.is_demo } }; }, false);

route('GET', '/api/summary', async (ctx) => {
  const uid = ctx.user.id;
  const t = db.prepare('SELECT COUNT(*) AS products, COALESCE(SUM(stock),0) AS units, COALESCE(SUM(stock*price),0) AS value, COALESCE(SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END),0) AS low FROM products WHERE user_id = ?').get(uid);
  const low = db.prepare('SELECT id,name,sku,stock,min_stock FROM products WHERE user_id = ? AND stock <= min_stock ORDER BY (stock*1.0/NULLIF(min_stock,0)) ASC, stock ASC LIMIT 8').all(uid);
  const byCat = db.prepare('SELECT category, COUNT(*) AS n, SUM(stock*price) AS value FROM products WHERE user_id = ? GROUP BY category ORDER BY value DESC').all(uid);
  return { totals: t, low, byCategory: byCat };
});

route('GET', '/api/products', async (ctx) => {
  const q = String(ctx.query.get('q') || '').trim().toLowerCase(), cat = String(ctx.query.get('category') || '');
  let sql = 'SELECT * FROM products WHERE user_id = ?'; const args = [ctx.user.id];
  if (q) { sql += ' AND (LOWER(name) LIKE ? OR LOWER(sku) LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  if (cat) { sql += ' AND category = ?'; args.push(cat); }
  sql += ' ORDER BY name COLLATE NOCASE';
  const cats = db.prepare('SELECT DISTINCT category FROM products WHERE user_id = ? ORDER BY category').all(ctx.user.id).map((r) => r.category);
  return { products: db.prepare(sql).all(...args), categories: cats };
});

function productInput(b) {
  return { name: str(b.name, 'Nama produk', 80), sku: str(b.sku, 'SKU', 30).toUpperCase(), category: str(b.category || 'Umum', 'Kategori', 30), price: int(b.price, 'Harga', { max: 1e9 }), min_stock: int(b.min_stock, 'Stok minimum', { max: 1e6 }) };
}

route('POST', '/api/products', async (ctx) => {
  const p = productInput(ctx.body), stock = int(ctx.body.stock || 0, 'Stok awal', { max: 1e7 });
  if (db.prepare('SELECT COUNT(*) AS n FROM products WHERE user_id = ?').get(ctx.user.id).n >= 500) throw bad('Batas 500 produk tercapai');
  try {
    return tx(() => {
      const id = Number(db.prepare('INSERT INTO products (user_id,name,sku,category,price,stock,min_stock) VALUES (?,?,?,?,?,?,?)').run(ctx.user.id, p.name, p.sku, p.category, p.price, stock, p.min_stock).lastInsertRowid);
      if (stock > 0) db.prepare("INSERT INTO movements (user_id,product_id,type,qty,stock_after,note) VALUES (?,?,'in',?,?,'Stok awal')").run(ctx.user.id, id, stock, stock);
      return { product: db.prepare('SELECT * FROM products WHERE id = ?').get(id), _status: 201 };
    });
  } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'SKU sudah dipakai produk lain'); throw e; }
});

route('PUT', '/api/products/:id', async (ctx) => {
  const id = Number(ctx.params[0]), p = productInput(ctx.body);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND user_id = ?').get(id, ctx.user.id)) throw new HttpError(404, 'Produk tidak ditemukan');
  try { db.prepare('UPDATE products SET name=?, sku=?, category=?, price=?, min_stock=? WHERE id=? AND user_id=?').run(p.name, p.sku, p.category, p.price, p.min_stock, id, ctx.user.id); }
  catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'SKU sudah dipakai produk lain'); throw e; }
  return { product: db.prepare('SELECT * FROM products WHERE id = ?').get(id) };
});

route('DELETE', '/api/products/:id', async (ctx) => {
  const r = db.prepare('DELETE FROM products WHERE id = ? AND user_id = ?').run(Number(ctx.params[0]), ctx.user.id);
  if (!r.changes) throw new HttpError(404, 'Produk tidak ditemukan');
  return { ok: true };
});

route('POST', '/api/products/:id/move', async (ctx) => {
  const id = Number(ctx.params[0]), type = ctx.body.type;
  if (!['in', 'out', 'set'].includes(type)) throw bad('Jenis harus in, out, atau set');
  const qty = int(ctx.body.qty, 'Jumlah', { min: type === 'set' ? 0 : 1, max: 1e7 });
  const note = String(ctx.body.note || '').trim().slice(0, 120);
  return tx(() => {
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND user_id = ?').get(id, ctx.user.id);
    if (!p) throw new HttpError(404, 'Produk tidak ditemukan');
    const after = type === 'in' ? p.stock + qty : type === 'out' ? p.stock - qty : qty;
    if (after < 0) throw bad(`Stok tidak cukup (tersisa ${p.stock})`);
    db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(after, id);
    db.prepare('INSERT INTO movements (user_id,product_id,type,qty,stock_after,note) VALUES (?,?,?,?,?,?)').run(ctx.user.id, id, type, qty, after, note);
    return { product: db.prepare('SELECT * FROM products WHERE id = ?').get(id) };
  });
});

route('GET', '/api/movements', async (ctx) => {
  const limit = Math.min(Math.max(parseInt(ctx.query.get('limit'), 10) || 30, 1), 200);
  return { movements: db.prepare('SELECT m.id, m.type, m.qty, m.stock_after, m.note, m.created_at, p.name AS product, p.sku FROM movements m JOIN products p ON p.id = m.product_id WHERE m.user_id = ? ORDER BY m.id DESC LIMIT ?').all(ctx.user.id, limit) };
});

route('GET', '/api/export.csv', async (ctx) => {
  const esc = (v) => { let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = db.prepare('SELECT sku,name,category,price,stock,min_stock FROM products WHERE user_id = ? ORDER BY name').all(ctx.user.id);
  const csv = ['SKU,Nama,Kategori,Harga,Stok,Stok Minimum'].concat(rows.map((r) => [r.sku, r.name, r.category, r.price, r.stock, r.min_stock].map(esc).join(','))).join('\n');
  return { _raw: csv, _type: 'text/csv; charset=utf-8', _headers: { 'Content-Disposition': 'attachment; filename="stok-barang.csv"' } };
});

// ---------- server ----------
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Dilarang');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Tidak ditemukan');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, decodeURIComponent(url.pathname));
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Endpoint tidak ada');
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json') && Number(req.headers['content-length'] || 0) > 0) throw new HttpError(415, 'Gunakan JSON');
    const ctx = { req, ip: req.socket.remoteAddress || '', query: url.searchParams, params: url.pathname.match(r.re).slice(1), user: null, body: {} };
    if (r.auth) { ctx.user = userFromReq(req); if (!ctx.user) throw new HttpError(401, 'Silakan login'); }
    if (req.method !== 'GET') ctx.body = await readJson(req);
    const out = await r.fn(ctx);
    if (out._raw !== undefined) return send(res, 200, out._raw, Object.assign({ 'Content-Type': out._type }, out._headers));
    const headers = {};
    if (out._cookie !== undefined) headers['Set-Cookie'] = out._cookie ? cookieHeader(req, out._cookie, SESSION_DAYS * 86400) : cookieHeader(req, '', 0);
    const status = out._status || 200; delete out._cookie; delete out._status;
    send(res, status, out, headers);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error('[error]', e); send(res, 500, { error: 'Terjadi kesalahan di server' });
  }
});

// bersihkan sesi kedaluwarsa tiap jam
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600000).unref();

if (require.main === module) server.listen(PORT, () => console.log(`StokKu jalan di http://localhost:${PORT}`));
module.exports = { server };
