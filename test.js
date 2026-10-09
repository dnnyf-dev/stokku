// test.js — uji API StokKu memakai database sementara. Jalankan: npm test
process.env.DB_FILE = ':memory:';
const assert = require('assert');
const { server } = require('./server');

let cookie = '';
async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: Object.assign({ cookie }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
}
let base;
server.listen(0, async () => {
  base = 'http://127.0.0.1:' + server.address().port;
  const ok = (name) => console.log('  ✓ ' + name);
  try {
    assert.strictEqual((await call('GET', '/api/products')).status, 401); ok('endpoint dilindungi login');
    assert.strictEqual((await call('POST', '/api/register', { name: 'Budi', email: 'budi@x.id', password: 'pendek' })).status, 400); ok('password pendek ditolak');
    assert.strictEqual((await call('POST', '/api/register', { name: 'Budi', email: 'budi@x.id', password: 'rahasia123' })).status, 200); ok('daftar berhasil');
    assert.strictEqual((await call('POST', '/api/register', { name: 'B2', email: 'budi@x.id', password: 'rahasia123' })).status, 409); ok('email ganda ditolak');
    let r = await call('POST', '/api/products', { name: 'Kopi', sku: 'kpi', category: 'Minuman', price: 20000, stock: 10, min_stock: 3 });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.product.sku, 'KPI'); const id = r.data.product.id; ok('tambah produk');
    assert.strictEqual((await call('POST', '/api/products', { name: 'Kopi2', sku: 'KPI', price: 1, min_stock: 1 })).status, 409); ok('SKU ganda ditolak');
    assert.strictEqual((await call('POST', `/api/products/${id}/move`, { type: 'out', qty: 4 })).data.product.stock, 6); ok('barang keluar mengurangi stok');
    r = await call('POST', `/api/products/${id}/move`, { type: 'out', qty: 99 });
    assert.strictEqual(r.status, 400); ok('stok tidak boleh minus');
    assert.strictEqual((await call('POST', `/api/products/${id}/move`, { type: 'in', qty: 1.5 })).status, 400); ok('jumlah desimal ditolak');
    assert.strictEqual((await call('GET', '/api/summary')).data.totals.units, 6); ok('ringkasan benar');
    assert.strictEqual((await call('GET', '/api/movements')).data.movements.length, 2); ok('riwayat tercatat (awal + keluar; yang gagal tidak masuk)');
    assert.ok((await call('GET', '/api/export.csv')).data.startsWith('SKU,Nama')); ok('ekspor CSV');
    // data antar pengguna terpisah
    const mine = cookie; cookie = '';
    await call('POST', '/api/register', { name: 'Sari', email: 'sari@x.id', password: 'rahasia123' });
    assert.strictEqual((await call('GET', '/api/products')).data.products.length, 0);
    assert.strictEqual((await call('PUT', `/api/products/${id}`, { name: 'x', sku: 'x', price: 1, min_stock: 1 })).status, 404);
    assert.strictEqual((await call('DELETE', `/api/products/${id}`)).status, 404); ok('pengguna lain tidak bisa melihat/ubah data orang');
    cookie = mine;
    assert.strictEqual((await call('POST', '/api/logout')).status, 200);
    assert.strictEqual((await call('GET', '/api/me')).data.user, null); ok('logout mematikan sesi');
    cookie = '';
    assert.strictEqual((await call('POST', '/api/login', { email: 'budi@x.id', password: 'salah-salah' })).status, 401);
    assert.strictEqual((await call('POST', '/api/login', { email: 'budi@x.id', password: 'rahasia123' })).status, 200); ok('login');
    r = await call('POST', '/api/demo'); assert.strictEqual(r.status, 200);
    assert.strictEqual((await call('GET', '/api/products')).data.products.length, 10); ok('akun demo terisi 10 produk');
    assert.notStrictEqual((await fetch(base + '/%2e%2e/server.js')).headers.get('content-type'), 'text/javascript; charset=utf-8'); ok('path traversal diblokir');
    console.log('\nSemua tes lulus.');
    process.exit(0);
  } catch (e) { console.error('\nGAGAL:', e.message); process.exit(1); }
});
