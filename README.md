# StokKu — Aplikasi Stok Barang untuk UMKM

Aplikasi web untuk mencatat stok barang toko: daftar produk, barang masuk/keluar, riwayat pergerakan stok, dan peringatan otomatis saat stok menipis. Setiap pengguna punya akun sendiri dan hanya bisa melihat datanya sendiri.

## Fitur
- Daftar / masuk dengan email dan password (password di-hash dengan `scrypt`, sesi lewat cookie `HttpOnly`)
- Tambah, ubah, hapus, cari, dan filter produk berdasarkan kategori
- Catat barang masuk dan keluar. Stok tidak bisa minus, dan setiap perubahan tercatat di riwayat
- Ringkasan: jumlah produk, total unit, nilai stok, dan daftar produk yang perlu dibeli ulang
- Unduh data produk sebagai CSV
- Tombol **akun demo**: pengunjung bisa mencoba tanpa mendaftar (tiap sesi mendapat data contoh sendiri)

## Database
SQLite lewat modul bawaan Node (`node:sqlite`), jadi **tanpa `npm install` dan tanpa dependensi apa pun**.

| Tabel | Isi |
|---|---|
| `users` | akun (email unik, salt, hash password) |
| `sessions` | token sesi dan waktu kedaluwarsa |
| `products` | produk milik pengguna (SKU unik per pengguna, stok tidak boleh minus) |
| `movements` | riwayat barang masuk/keluar beserta stok akhir |

Perubahan stok memakai transaksi database, jadi stok dan riwayat selalu konsisten.

## Cara menjalankan
Butuh **Node.js 22.5 atau lebih baru**.

```bash
npm start
```

Lalu buka http://localhost:3000. File database dibuat otomatis di folder `data/`.

## Tes
```bash
npm test
```
Menguji login, hak akses antar pengguna, validasi stok, riwayat, dan ekspor CSV memakai database sementara.

## Catatan deploy (Render)
- Start command: `npm start`. Tidak ada build command.
- Hosting gratis Render memakai disk sementara, jadi file database ikut hilang saat server restart. Untuk demo portofolio ini aman, karena pengunjung memakai akun demo. Untuk data permanen, pasang Render Disk (berbayar) dan set `DATA_DIR` ke folder disk itu, atau ganti ke PostgreSQL.

## Struktur
```
stokku/
├── server.js     ← API dan file statis (tanpa framework)
├── db.js         ← skema SQLite dan transaksi
├── test.js       ← tes API
└── public/       ← tampilan (HTML, CSS, JavaScript)
```

## Tech stack
Node.js, SQLite (`node:sqlite`), HTML, CSS, JavaScript murni.
