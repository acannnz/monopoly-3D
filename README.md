# Monopoli Nusantara 3D

Monopoli klasik versi web 3D dengan kota-kota Indonesia, dibuat untuk nostalgia main berdua.

## Fitur

- Papan 3D (Three.js) dengan 22 kota Nusantara, kartu Kesempatan & Dana Umum, Pojok Kejutan
- **Kartu Skill**: 4 petak di tengah tiap sisi memberi kartu skill (22 macam) yang disimpan (maks 3) dan dipakai kapan saja waktunya cocok, satu skill per giliran
- **Lawan Komputer (mode mudah)**: komputer "Hermes" bertanya ke agent Hermes di VPS untuk keputusan penting; kalau tidak terhubung memakai otak bawaan
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
- **Lawan komputer:** satu pemain melawan Hermes. Di domain sendiri keputusan beli/bangun/pergi ditanyakan ke `/api/ai`; di tempat lain otak bawaan.
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
| Proxy `/api/ai` | `deploy/nginx.conf_api` → `nginx.conf_api` dan `nginx.ssl.conf_api` di folder conf yang sama |
| Header keamanan | `deploy/nginx.ssl.conf_security` → `/home/arcandapp/conf/web/monopoli.arcand.my.id/nginx.ssl.conf_security` |

Template Hestia domain ini `no-php` (web & backend), HSTS lewat `v-add-web-domain-ssl-hsts`.

Perintah berguna: `systemctl status monopoli`, `journalctl -u monopoli -f`.

## Otak komputer (`server/ai.js`)

`POST /api/ai` menerima angka dan kode pilihan saja (uang, nomor petak, harga, sewa), menyusun prompt sendiri dari tabel petak, lalu bertanya ke API server Hermes dan mengembalikan keputusan yang sudah divalidasi (`buy`, `lv`, atau `tile`) plus komentar pendek `say`. Nama pemain tidak pernah dikirim.

| Bagian | Lokasi di VPS |
|---|---|
| Hermes | profil `monopoli` (`/home/ubuntu/.hermes/profiles/monopoli`), layanan systemd `hermes-monopoli`, API server hanya di `127.0.0.1:8643` |
| Isi profil | tanpa tool apa pun (`platform_toolsets.api_server: []`), tanpa dispatcher kanban, tanpa judul sesi otomatis |
| Kunci | `/home/arcandapp/monopoli-server/hermes.env` (`HERMES_KEY=...`, mode 600), dibaca `monopoli.service` |

Batas: 20 permintaan per menit per IP, 2 permintaan ke Hermes bersamaan, Hermes ditunggu 13 detik. Lewat dari itu klien memakai otak bawaan.

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
