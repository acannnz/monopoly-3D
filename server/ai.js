// Otak komputer (mode mudah) untuk mode "Lawan Komputer", lewat API server agent Hermes di VPS.
// Klien hanya mengirim angka dan kode pilihan. Prompt disusun di sini dari tabel petak milik server,
// jadi teks yang diketik pemain (misalnya nama) tidak pernah sampai ke Hermes.
'use strict';

const HERMES_URL = process.env.HERMES_URL || 'http://127.0.0.1:8643/v1/chat/completions';
const HERMES_KEY = process.env.HERMES_KEY || '';
const HERMES_MODEL = process.env.HERMES_MODEL || 'monopoli';

// ---- Batas pengaman ----
const TIMEOUT = 13000;          // lebih lama dari ini, klien memakai otak bawaan (klien sendiri menunggu 15 detik)
const MAX_BODY = 4096;
const MAX_ACTIVE = 2;           // permintaan ke Hermes yang boleh berjalan bersamaan
const PER_IP_PER_MIN = 20;

// sama dengan tabel T di index.html: "nama|kelompok warna" (kelompok kosong = bukan kota)
const TILES = ['START|', 'Jayapura|coklat', 'Dana Umum|', 'Merauke|coklat', 'Pajak Penghasilan|', 'Kartu Skill|',
  'Ambon|biru muda', 'Kesempatan|', 'Ternate|biru muda', 'Kupang|biru muda', 'Penjara|',
  'Manado|pink', 'Perusahaan Listrik|perusahaan', 'Palu|pink', 'Makassar|pink', 'Kartu Skill|',
  'Pontianak|oranye', 'Dana Umum|', 'Banjarmasin|oranye', 'Balikpapan|oranye', 'Bebas Parkir|',
  'Padang|merah', 'Kesempatan|', 'Palembang|merah', 'Medan|merah', 'Kartu Skill|',
  'Semarang|kuning', 'Yogyakarta|kuning', 'Perusahaan Air Minum|perusahaan', 'Surabaya|kuning', 'Pojok Kejutan|',
  'Lombok|hijau', 'Labuan Bajo|hijau', 'Dana Umum|', 'Bandung|hijau', 'Kartu Skill|',
  'Kesempatan|', 'Bali|biru', 'Pajak Barang Mewah|', 'Jakarta|biru'].map(s => { const [n, g] = s.split('|'); return { n, g }; });
const LEVELS = ['tanah', 'rumah', 'vila', 'hotel', 'landmark'];
// jenis tujuan pada pilihan "pergi bebas"
const TAGS = {
  kosong:'tanah kosong, bisa dibeli', milikku:'tanahmu sendiri, bisa dibangun', lawan:'tanah lawan, harus bayar sewa',
  kartu:'ambil kartu acak', skill:'dapat 1 Kartu Skill untuk disimpan', pajak:'bayar pajak', start:'START, naik 1 tingkat gratis', penjara:'penjara, cuma mampir', lain:'petak biasa',
};
const rp = v => v + 'rb';

const SYSTEM = 'Kamu "Hermes", komputer lawan di game papan Monopoli Nusantara. Levelmu MUDAH: main santai seperti pemain biasa, ' +
  'tidak selalu memilih yang paling optimal, tapi jangan sampai uangmu habis. Uang dalam ribu rupiah. ' +
  'Jawab HANYA dengan satu objek JSON, tanpa teks lain. Kolom "say" berisi komentar pendek santai untuk lawanmu ' +
  'dalam bahasa Indonesia (paling banyak 60 huruf), boleh menggoda tapi tetap sopan.';

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const nameOf = i => TILES[i].n + (TILES[i].g ? ` (${TILES[i].g})` : '');

// ---- Validasi permintaan dari klien ----
function parseReq(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  if (!['buy', 'build', 'startUp', 'travel'].includes(b.kind)) return null;
  if (!int(b.money, -99999, 999999) || !int(b.oppMoney, -99999, 999999)) return null;
  if (!int(b.myProps, 0, 28) || !int(b.oppProps, 0, 28)) return null;
  if (b.kind !== 'travel' && !int(b.tile, 0, 39)) return null;
  if (!Array.isArray(b.opts) || !b.opts.length || b.opts.length > 12) return null;
  const opts = [];
  for (const o of b.opts) {
    if (!o || typeof o !== 'object') return null;
    const x = { tile:o.tile != null ? o.tile : b.tile, lv:o.lv || 0, cost:o.cost || 0, rent:o.rent || 0, next:o.next || 0, tag:o.tag || 'lain', salary:o.salary === true };
    if (!int(x.tile, 0, 39) || !int(x.lv, 0, 4) || !int(x.cost, 0, 99999) || !int(x.rent, 0, 99999) || !int(x.next, 0, 99999)) return null;
    if (!Object.prototype.hasOwnProperty.call(TAGS, x.tag)) return null;
    opts.push(x);
  }
  return { kind:b.kind, money:b.money, oppMoney:b.oppMoney, myProps:b.myProps, oppProps:b.oppProps, tile:b.tile, opts };
}

// ---- Prompt (hanya dari angka & tabel di atas) ----
function promptFor(q) {
  const head = `Uangmu ${rp(q.money)}, uang lawan ${rp(q.oppMoney)}. Kamu punya ${q.myProps} properti, lawan ${q.oppProps}.`;
  switch (q.kind) {
    case 'buy': {
      const o = q.opts[0];
      return `Kamu mendarat di ${nameOf(q.tile)}, tanahnya masih kosong. Harga ${rp(o.cost)}, sewa awal ${rp(o.rent)}. ${head}\n` +
        'Mau dibeli? Jawab JSON: {"buy": true atau false, "say": "..."}';
    }
    case 'build': {
      const lines = q.opts.map(o => `- ${o.lv}: bangun sampai ${LEVELS[o.lv]}, biaya ${rp(o.cost)}, sewa jadi ${rp(o.rent)}`);
      return `Kamu kembali ke tanahmu ${nameOf(q.tile)}. ${head}\nPilihan:\n${lines.join('\n')}\n- 0: tidak membangun dulu\n` +
        'Jawab JSON: {"lv": angka pilihan, "say": "..."}';
    }
    case 'startUp': {
      const lines = q.opts.map(o => `- ${o.tile}: ${nameOf(o.tile)}, ${LEVELS[o.lv]} jadi ${LEVELS[Math.min(4, o.lv + 1)]}, sewa ${rp(o.rent)} jadi ${rp(o.next)}`);
      return `Kamu berhenti tepat di START dan boleh menaikkan satu tanahmu 1 tingkat GRATIS. ${head}\nPilihan:\n${lines.join('\n')}\n` +
        'Jawab JSON: {"tile": nomor petak pilihanmu, "say": "..."}';
    }
    case 'travel': {
      const lines = q.opts.map(o => {
        const money = o.tag === 'kosong' ? `, harga ${rp(o.cost)}` : o.tag === 'milikku' ? `, naik 1 tingkat ${rp(o.cost)}` : o.tag === 'lawan' ? `, sewa ${rp(o.rent)}` : o.tag === 'pajak' ? ` ${rp(o.cost)}` : '';
        return `- ${o.tile}: ${nameOf(o.tile)}: ${TAGS[o.tag]}${money}${o.salary ? ', lewat START dapat gaji 500rb' : ''}`;
      });
      return `Kamu di Bebas Parkir dan boleh pergi ke petak mana saja (berjalan maju). ${head}\nPilihan:\n${lines.join('\n')}\n- null: tetap di sini\n` +
        'Jawab JSON: {"tile": nomor petak pilihanmu atau null, "say": "..."}';
    }
  }
  return '';
}

// ---- Jawaban Hermes -> keputusan yang pasti sah ----
function cleanSay(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function decide(q, text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch (e) { return null; }
  if (!j || typeof j !== 'object') return null;
  const say = cleanSay(j.say);
  switch (q.kind) {
    case 'buy': return typeof j.buy === 'boolean' ? { buy:j.buy, say } : null;
    case 'build': {
      const lv = Number(j.lv);
      return lv === 0 || q.opts.some(o => o.lv === lv) ? { lv, say } : null;
    }
    case 'startUp': {
      const t = Number(j.tile);
      return q.opts.some(o => o.tile === t) ? { tile:t, say } : null;
    }
    case 'travel': {
      if (j.tile == null || j.tile === 'null') return { tile:null, say };
      const t = Number(j.tile);
      return q.opts.some(o => o.tile === t) ? { tile:t, say } : null;
    }
  }
  return null;
}

async function askHermes(prompt) {
  const r = await fetch(HERMES_URL, {
    method:'POST',
    headers:{ authorization:'Bearer ' + HERMES_KEY, 'content-type':'application/json' },
    // peran ditaruh di pesan pengguna: pesan "system" membuat Hermes menyusun prompt jauh lebih panjang dan lambat
    body:JSON.stringify({ model:HERMES_MODEL, messages:[{ role:'user', content:SYSTEM + '\n\n' + prompt }] }),
    signal:AbortSignal.timeout(TIMEOUT),
  });
  const j = await r.json();
  if (!r.ok || (j.hermes && j.hermes.failed)) throw new Error('hermes ' + r.status);
  return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
}

// ---- Handler HTTP: GET /api/ai (siap?) dan POST /api/ai (minta keputusan) ----
const hitsByIp = new Map();
setInterval(() => { const now = Date.now(); for (const [ip, l] of hitsByIp) if (!l.some(t => now - t < 60000)) hitsByIp.delete(ip); }, 120000);
function allow(ip) {
  const now = Date.now(), list = (hitsByIp.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= PER_IP_PER_MIN) { hitsByIp.set(ip, list); return false; }
  list.push(now); hitsByIp.set(ip, list); return true;
}
let active = 0;
function json(res, code, body) {
  res.writeHead(code, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
  res.end(JSON.stringify(body));
}

function handleAi(req, res, ip) {
  if (req.method === 'GET') return json(res, 200, { ok:true, ready:!!HERMES_KEY });
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'method' });
  // wajib JSON: dari situs lain ini memicu preflight CORS yang tidak dijawab, jadi hanya halaman game yang bisa memakai
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return json(res, 415, { ok:false, error:'type' });
  if (!HERMES_KEY) return json(res, 503, { ok:false, error:'off' });
  if (!allow(ip)) return json(res, 429, { ok:false, error:'rate_limited' });
  let size = 0; const chunks = [];
  req.on('data', c => {
    if (res.writableEnded) return;
    size += c.length;
    if (size > MAX_BODY) { json(res, 413, { ok:false, error:'too_large' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    let q; try { q = parseReq(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { q = null; }
    if (!q) return json(res, 400, { ok:false, error:'invalid_argument' });
    if (active >= MAX_ACTIVE) return json(res, 503, { ok:false, error:'busy' });
    active++;
    const t0 = Date.now();
    try {
      const d = decide(q, await askHermes(promptFor(q)));
      if (!d) return json(res, 502, { ok:false, error:'bad_answer' });
      json(res, 200, Object.assign({ ok:true, ms:Date.now() - t0 }, d));
    } catch (e) {
      json(res, 504, { ok:false, error:'unavailable' });
    } finally { active--; }
  });
}

module.exports = { handleAi, parseReq, promptFor, decide };
