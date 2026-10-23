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
- **Online (HP masing-masing):** saat ini memakai penyimpanan bersama milik Claude Artifacts, jadi hanya berfungsi bila dibuka sebagai artifact di claude.ai. Untuk hosting sendiri perlu backend realtime (rencana: Cloudflare Worker + Durable Object).

## Struktur kode (di dalam `index.html`)

| Bagian | Isi |
|---|---|
| Data papan | `T` (petak), `CH`/`CC` (kartu), `GROUPS` (warna & biaya bangun) |
| Mesin aturan | `actRoll`, `actBuy`, `actBuild`, `pay`, `resolve` — state lama → state baru + daftar efek |
| 3D | papan dari kanvas, pion, dadu, bangunan & `LANDMARKS` |
| Animasi | `playFx` memutar daftar efek (dadu, jalan, koin, kartu, bangun) |
| Online | satu dokumen state per room, semua perangkat mendengarkan perubahan |
