# Monopoli Nusantara 3D

Monopoli klasik versi web 3D dengan kota-kota Indonesia, dibuat untuk nostalgia main berdua.

## Fitur

- Papan 3D (Three.js) dengan 22 kota Nusantara, stasiun/pelabuhan/bandara, kartu Kesempatan & Dana Umum
- Dadu ala Let's Get Rich: pilih Ganjil/Genap (pasti dituruti), tahan tombol, lepas saat jarum di posisi yang diinginkan (besar-kecil angka tetap untung-untungan)
- Angka langkah 1–12 di pinggir papan di depan pion
- Bangunan Rumah → Vila → Hotel (boleh sekaligus), lalu Landmark khas daerah (Monas, Gedung Sate, Rumah Gadang, Jembatan Ampera, dll.)
- Kamera mengikuti pion yang berjalan, aura kuning pada pion yang sedang giliran
- Aturan klasik: penjara, dadu kembar, gaji START, kas Bebas Parkir, bangkrut

## Menjalankan

Semua ada di satu file `index.html`, tanpa proses build. Buka langsung di browser, atau jalankan server statis:

```bash
python -m http.server 8080
```

lalu buka http://localhost:8080.

## Mode bermain

- **Satu HP (hot-seat):** berjalan di mana saja, progres tersimpan di browser.
- **Online (HP masing-masing):** di domain sendiri memakai server WebSocket di `server/` (alamat `/ws` pada domain yang sama). Saat dibuka sebagai artifact di claude.ai, game memakai penyimpanan bersama artifact.

## Server online (`server/`)

Node.js + [`ws`](https://github.com/websockets/ws). Satu room = satu dokumen state (kode 4 huruf), disimpan ke `rooms.json` dan disiarkan ke semua perangkat di room itu.

```bash
cd server
npm install
STATIC_FILE=../index.html PORT=3077 node server.js   # dev lokal: buka http://localhost:3077
```

## Deploy (VPS dengan HestiaCP)

| Bagian | Lokasi di VPS |
|---|---|
| Halaman | `/home/arcandapp/web/monopoli.arcand.my.id/public_html/index.html` |
| Server Node | `/home/arcandapp/monopoli-server/` (layanan systemd `monopoli`, port 127.0.0.1:3077) |
| Proxy `/ws` | `deploy/nginx.conf_ws` → `/home/arcandapp/conf/web/monopoli.arcand.my.id/nginx.conf_ws` dan `nginx.ssl.conf_ws` |
| Layanan | `deploy/monopoli.service` → `/etc/systemd/system/monopoli.service` |
| Header keamanan | `deploy/nginx.ssl.conf_security` → `/home/arcandapp/conf/web/monopoli.arcand.my.id/nginx.ssl.conf_security` |

Template Hestia domain ini `no-php` (web & backend), HSTS lewat `v-add-web-domain-ssl-hsts`.

Perintah berguna: `systemctl status monopoli`, `journalctl -u monopoli -f`.

## Batas pengaman server

| Batas | Nilai |
|---|---|
| Jumlah room | 300 (saat penuh, room tak tersentuh 7 hari diganti; room tak tersentuh 30 hari dihapus) |
| Room baru per IP | 15 per jam |
| Koneksi per IP | 6 |
| Kecepatan pesan | ±8 per detik per koneksi (lonjakan sampai 20) |
| Ukuran state | 64KB |

## Struktur kode (di dalam `index.html`)

| Bagian | Isi |
|---|---|
| Data papan | `T` (petak), `CH`/`CC` (kartu), `GROUPS` (warna & biaya bangun) |
| Mesin aturan | `actRoll`, `actBuy`, `actBuild`, `pay`, `resolve` — state lama → state baru + daftar efek |
| 3D | papan dari kanvas, pion, dadu, bangunan & `LANDMARKS` |
| Animasi | `playFx` memutar daftar efek (dadu, jalan, koin, kartu, bangun) |
| Online | satu dokumen state per room, semua perangkat mendengarkan perubahan |
