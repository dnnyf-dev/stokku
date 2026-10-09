(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var state = { user: null, page: 'dash', q: '', cat: '' };
  var rupiah = function (n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(s) { var d = new Date(String(s).replace(' ', 'T') + 'Z'); return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }

  function api(method, url, body) {
    return fetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Gagal'); e.status = r.status; throw e; } return j; }); });
  }
  var toastT;
  function toast(msg, bad) { var t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 2600); }

  /* ---------- auth ---------- */
  var mode = 'login';
  function setMode(m) {
    mode = m; $('#tabLogin').classList.toggle('on', m === 'login'); $('#tabReg').classList.toggle('on', m === 'reg');
    $('#nameRow').hidden = m !== 'reg'; $('#authBtn').textContent = m === 'reg' ? 'Buat akun' : 'Masuk'; $('#authErr').textContent = '';
    $('#aPass').autocomplete = m === 'reg' ? 'new-password' : 'current-password';
  }
  $('#tabLogin').onclick = function () { setMode('login'); };
  $('#tabReg').onclick = function () { setMode('reg'); };
  $('#authForm').addEventListener('submit', function (e) {
    e.preventDefault(); var btn = $('#authBtn'); btn.disabled = true; $('#authErr').textContent = '';
    var body = { email: $('#aEmail').value, password: $('#aPass').value };
    if (mode === 'reg') body.name = $('#aName').value;
    api('POST', mode === 'reg' ? '/api/register' : '/api/login', body).then(function (r) { enter(r.user); })
      .catch(function (err) { $('#authErr').textContent = err.message; }).then(function () { btn.disabled = false; });
  });
  $('#demoBtn').onclick = function () { api('POST', '/api/demo').then(function (r) { enter(r.user); }).catch(function (e) { $('#authErr').textContent = e.message; }); };
  $('#logoutBtn').onclick = function () { api('POST', '/api/logout').then(function () { state.user = null; show(); }); };

  function enter(u) { state.user = u; state.page = 'dash'; show(); }
  function show() {
    var loggedIn = !!state.user;
    $('#authView').hidden = loggedIn; $('#appView').hidden = !loggedIn;
    if (loggedIn) { $('#whoName').textContent = state.user.name; $('#demoBar').hidden = !state.user.is_demo; go(state.page); }
    else { $('#aPass').value = ''; }
  }
  $('#nav').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(b.dataset.page); });
  function go(p) {
    state.page = p;
    [].forEach.call($('#nav').children, function (b) { b.classList.toggle('on', b.dataset.page === p); });
    ({ dash: renderDash, products: renderProducts, history: renderHistory })[p]();
  }
  function onErr(e) { if (e.status === 401) { state.user = null; show(); } else toast(e.message, true); }

  /* ---------- ringkasan ---------- */
  function renderDash() {
    api('GET', '/api/summary').then(function (s) {
      var t = s.totals, maxv = Math.max.apply(null, s.byCategory.map(function (c) { return c.value; }).concat([1]));
      $('#page').innerHTML =
        '<div class="head"><h1>Ringkasan stok</h1><button class="btn primary" id="goAdd">+ Tambah produk</button></div>' +
        '<div class="cards">' +
        card('Jumlah produk', t.products) + card('Total unit', t.units.toLocaleString('id-ID')) + card('Nilai stok', rupiah(t.value)) +
        '<div class="card warn ' + (t.low ? '' : 'zero') + '"><div class="lbl">Perlu belanja ulang</div><div class="val">' + t.low + '</div></div></div>' +
        '<div class="cols"><div class="card"><h2>Stok menipis</h2><div class="list">' +
        (s.low.length ? s.low.map(function (p) { return '<div class="row"><div>' + esc(p.name) + '<small>' + esc(p.sku) + ' · minimum ' + p.min_stock + '</small></div>' + statusPill(p) + '</div>'; }).join('') : '<div class="empty">Semua stok aman 🎉</div>') +
        '</div></div><div class="card"><h2>Nilai per kategori</h2><div class="list">' +
        (s.byCategory.length ? s.byCategory.map(function (c) { return '<div class="row" style="display:block"><div style="display:flex;justify-content:space-between"><span>' + esc(c.category) + ' <small style="display:inline">(' + c.n + ' produk)</small></span><b>' + rupiah(c.value) + '</b></div><div class="bar"><i style="width:' + Math.round(c.value / maxv * 100) + '%"></i></div></div>'; }).join('') : '<div class="empty">Belum ada data</div>') +
        '</div></div></div>';
      $('#goAdd').onclick = function () { go('products'); productForm(); };
    }).catch(onErr);
  }
  function card(l, v) { return '<div class="card"><div class="lbl">' + l + '</div><div class="val">' + v + '</div></div>'; }
  function statusPill(p) { return p.stock === 0 ? '<span class="pill out">Habis</span>' : p.stock <= p.min_stock ? '<span class="pill low">Sisa ' + p.stock + '</span>' : '<span class="pill ok">Aman</span>'; }

  /* ---------- produk ---------- */
  var searchT;
  function renderProducts() {
    $('#page').innerHTML = '<div class="head"><h1>Produk</h1><div class="tools"><a class="btn ghost" href="/api/export.csv">Unduh CSV</a><button class="btn primary" id="addP">+ Tambah produk</button></div></div>' +
      '<div class="tools"><input id="q" type="search" placeholder="Cari nama atau SKU…" value="' + esc(state.q) + '"><select id="cat"><option value="">Semua kategori</option></select></div>' +
      '<div class="tablewrap" id="tbl"></div>';
    $('#addP').onclick = function () { productForm(); };
    $('#q').oninput = function (e) { state.q = e.target.value; clearTimeout(searchT); searchT = setTimeout(loadProducts, 200); };
    $('#cat').onchange = function (e) { state.cat = e.target.value; loadProducts(); };
    loadProducts();
  }
  function loadProducts() {
    api('GET', '/api/products?q=' + encodeURIComponent(state.q) + '&category=' + encodeURIComponent(state.cat)).then(function (r) {
      var sel = $('#cat'); if (!sel) return;
      sel.innerHTML = '<option value="">Semua kategori</option>' + r.categories.map(function (c) { return '<option' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
      var tbl = $('#tbl');
      if (!r.products.length) { tbl.innerHTML = '<div class="empty">' + (state.q || state.cat ? 'Tidak ada produk yang cocok.' : 'Belum ada produk. Klik “Tambah produk” untuk mulai.') + '</div>'; return; }
      tbl.innerHTML = '<table><thead><tr><th>Produk</th><th>Kategori</th><th class="num">Harga</th><th class="num">Stok</th><th>Status</th><th></th></tr></thead><tbody>' +
        r.products.map(function (p) {
          return '<tr><td>' + esc(p.name) + '<small>' + esc(p.sku) + '</small></td><td>' + esc(p.category) + '</td><td class="num">' + rupiah(p.price) + '</td><td class="num"><b>' + p.stock + '</b></td><td>' + statusPill(p) + '</td>' +
            '<td><div class="acts"><button class="btn ghost sm" data-a="in" data-id="' + p.id + '">+ Masuk</button><button class="btn ghost sm" data-a="out" data-id="' + p.id + '">− Keluar</button><button class="btn ghost sm" data-a="edit" data-id="' + p.id + '">Ubah</button></div></td></tr>';
        }).join('') + '</tbody></table>';
      tbl.onclick = function (e) {
        var b = e.target.closest('button[data-a]'); if (!b) return;
        var p = r.products.filter(function (x) { return x.id === +b.dataset.id; })[0];
        if (b.dataset.a === 'edit') productForm(p); else moveForm(p, b.dataset.a);
      };
    }).catch(onErr);
  }

  /* ---------- modal ---------- */
  function openModal(html) { $('#sheet').innerHTML = html; $('#modal').hidden = false; var f = $('#sheet input,#sheet select'); if (f) f.focus(); }
  function closeModal() { $('#modal').hidden = true; }
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function productForm(p) {
    var isEdit = !!p; p = p || { name: '', sku: '', category: 'Umum', price: '', stock: '', min_stock: 5 };
    openModal('<h3>' + (isEdit ? 'Ubah produk' : 'Produk baru') + '</h3><form id="pf" novalidate>' +
      '<label>Nama produk<input name="name" maxlength="80" value="' + esc(p.name) + '" required></label>' +
      '<div class="g2"><label>SKU / kode<input name="sku" maxlength="30" value="' + esc(p.sku) + '" required></label><label>Kategori<input name="category" maxlength="30" value="' + esc(p.category) + '"></label></div>' +
      '<div class="g2"><label>Harga (Rp)<input name="price" type="number" min="0" value="' + esc(p.price) + '" required></label><label>Stok minimum<input name="min_stock" type="number" min="0" value="' + esc(p.min_stock) + '"></label></div>' +
      (isEdit ? '' : '<label>Stok awal<input name="stock" type="number" min="0" value="0"></label>') +
      '<p class="err" id="pfErr"></p><div class="foot">' + (isEdit ? '<button type="button" class="btn danger" id="delP">Hapus</button>' : '') + '<button type="button" class="btn ghost" id="cx">Batal</button><button class="btn primary" type="submit">Simpan</button></div></form>');
    $('#cx').onclick = closeModal;
    if (isEdit) $('#delP').onclick = function () {
      if (!confirm('Hapus "' + p.name + '" beserta riwayat stoknya?')) return;
      api('DELETE', '/api/products/' + p.id).then(function () { closeModal(); toast('Produk dihapus'); go('products'); }).catch(onErr);
    };
    $('#pf').addEventListener('submit', function (e) {
      e.preventDefault(); var body = {}; [].forEach.call(e.target.elements, function (el) { if (el.name) body[el.name] = el.value; });
      api(isEdit ? 'PUT' : 'POST', '/api/products' + (isEdit ? '/' + p.id : ''), body)
        .then(function () { closeModal(); toast('Tersimpan'); go('products'); }).catch(function (err) { $('#pfErr').textContent = err.message; });
    });
  }
  function moveForm(p, type) {
    var label = type === 'in' ? 'Barang masuk' : 'Barang keluar';
    openModal('<h3>' + label + '</h3><p class="muted">' + esc(p.name) + ' · stok sekarang <b>' + p.stock + '</b></p><form id="mf" novalidate>' +
      '<label>Jumlah<input name="qty" type="number" min="1" value="1" required></label><label>Catatan (opsional)<input name="note" maxlength="120" placeholder="mis. restock dari supplier"></label>' +
      '<p class="err" id="mfErr"></p><div class="foot"><button type="button" class="btn ghost" id="cx">Batal</button><button class="btn primary" type="submit">Simpan</button></div></form>');
    $('#cx').onclick = closeModal;
    $('#mf').addEventListener('submit', function (e) {
      e.preventDefault();
      api('POST', '/api/products/' + p.id + '/move', { type: type, qty: e.target.qty.value, note: e.target.note.value })
        .then(function (r) { closeModal(); toast('Stok ' + r.product.name + ' sekarang ' + r.product.stock); loadProducts(); }).catch(function (err) { $('#mfErr').textContent = err.message; });
    });
  }

  /* ---------- riwayat ---------- */
  function renderHistory() {
    api('GET', '/api/movements?limit=100').then(function (r) {
      var label = { in: ['Masuk', 'in'], out: ['Keluar', 'mout'], set: ['Atur', 'set'] };
      $('#page').innerHTML = '<div class="head"><h1>Riwayat stok</h1></div><div class="tablewrap">' + (r.movements.length ?
        '<table><thead><tr><th>Waktu</th><th>Produk</th><th>Jenis</th><th class="num">Jumlah</th><th class="num">Stok akhir</th><th>Catatan</th></tr></thead><tbody>' +
        r.movements.map(function (m) { var l = label[m.type]; return '<tr><td>' + fmtDate(m.created_at) + '</td><td>' + esc(m.product) + '<small>' + esc(m.sku) + '</small></td><td><span class="pill ' + l[1] + '">' + l[0] + '</span></td><td class="num">' + m.qty + '</td><td class="num">' + m.stock_after + '</td><td>' + esc(m.note) + '</td></tr>'; }).join('') + '</tbody></table>'
        : '<div class="empty">Belum ada pergerakan stok.</div>') + '</div>';
    }).catch(onErr);
  }

  /* ---------- mulai ---------- */
  api('GET', '/api/me').then(function (r) { state.user = r.user; }).catch(function () {}).then(show);
})();
