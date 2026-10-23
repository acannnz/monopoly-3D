// Server room untuk mode online Monopoli Nusantara.
// Setiap room (kode 4 huruf) menyimpan satu dokumen state permainan. Klien mengirim state baru
// lewat WebSocket, server menyimpannya lalu menyiarkannya ke semua perangkat di room yang sama.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3077;
const HOST = process.env.HOST || '127.0.0.1';
const DATA = process.env.DATA_FILE || path.join(__dirname, 'rooms.json');
const CODE_RE = /^[A-Z0-9]{4}$/;

// ---- Batas pengaman ----
const MAX_DOC = 64 * 1024;                      // ukuran satu state (biasanya ~3KB)
const MAX_ROOMS = +process.env.MAX_ROOMS || 300;
const ROOM_TTL = 30 * 24 * 3600 * 1000;         // room tak tersentuh 30 hari dihapus
const STALE_ROOM = 7 * 24 * 3600 * 1000;        // saat penuh, room tak tersentuh 7 hari boleh diganti
const MAX_CONN_PER_IP = 6;
const NEW_ROOMS_PER_HOUR = 15;                  // per alamat IP
const MAX_SUBS_PER_CONN = 4;
const RATE_PER_SEC = 8, RATE_BURST = 20;        // ember token per koneksi
const MAX_DROPPED = 60;                          // pesan ditolak beruntun sebelum koneksi diputus

let rooms = {};
try { rooms = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { rooms = {}; }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA + '.tmp';
    fs.writeFile(tmp, JSON.stringify(rooms), err => { if (!err) fs.rename(tmp, DATA, () => {}); });
  }, 400);
}
function prune(olderThan) {
  const now = Date.now();
  let removed = 0;
  for (const code in rooms) if (now - rooms[code].at > olderThan && !subs.has(code)) { delete rooms[code]; removed++; }
  if (removed) save();
  return removed;
}
setInterval(() => prune(ROOM_TTL), 6 * 3600 * 1000);

// IP asli dikirim nginx lewat X-Real-IP (server ini hanya mendengar 127.0.0.1, jadi header itu bisa dipercaya)
const ipOf = req => String(req.headers['x-real-ip'] || req.socket.remoteAddress || '?');
const connsByIp = new Map();      // ip -> jumlah koneksi
const createdByIp = new Map();    // ip -> waktu pembuatan room dalam 1 jam terakhir
function canCreateRoom(ip) {
  const now = Date.now(), list = (createdByIp.get(ip) || []).filter(t => now - t < 3600 * 1000);
  createdByIp.set(ip, list);
  return list.length < NEW_ROOMS_PER_HOUR;
}
setInterval(() => { const now = Date.now(); for (const [ip, l] of createdByIp) if (!l.some(t => now - t < 3600 * 1000)) createdByIp.delete(ip); }, 600 * 1000);

const subs = new Map(); // kode room -> Set<WebSocket>
function subscribe(ws, code) {
  if (!subs.has(code)) subs.set(code, new Set());
  subs.get(code).add(ws); ws.rooms.add(code);
}
function unsubscribe(ws, code) {
  const set = subs.get(code);
  if (set) { set.delete(ws); if (!set.size) subs.delete(code); }
  ws.rooms.delete(code);
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(code) {
  const set = subs.get(code); if (!set) return;
  const room = rooms[code];
  const msg = JSON.stringify({ t:'snap', code, data:room ? room.data : null });
  for (const ws of set) if (ws.readyState === 1) ws.send(msg);
}
// ember token: true kalau pesan boleh diproses
function takeToken(ws) {
  const now = Date.now();
  ws.tokens = Math.min(RATE_BURST, ws.tokens + (now - ws.lastRefill) / 1000 * RATE_PER_SEC);
  ws.lastRefill = now;
  if (ws.tokens < 1) return false;
  ws.tokens -= 1; return true;
}

// STATIC_FILE (opsional, untuk dev lokal): sajikan index.html di "/". Di VPS halaman disajikan nginx.
const STATIC_FILE = process.env.STATIC_FILE;
const server = http.createServer((req, res) => {
  if (STATIC_FILE && (req.url === '/' || req.url.startsWith('/?'))) {
    return fs.readFile(STATIC_FILE, (err, buf) => {
      res.writeHead(err ? 404 : 200, { 'content-type':'text/html; charset=utf-8' });
      res.end(err ? 'index.html tidak ditemukan' : buf);
    });
  }
  res.writeHead(200, { 'content-type':'text/plain; charset=utf-8' });
  res.end('ok\n');
});
const wss = new WebSocketServer({ server, path:'/ws', maxPayload:MAX_DOC + 1024 });

wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  const n = (connsByIp.get(ip) || 0) + 1;
  if (n > MAX_CONN_PER_IP) { ws.close(1013, 'terlalu banyak koneksi'); return; }
  connsByIp.set(ip, n);
  ws.ip = ip; ws.rooms = new Set(); ws.alive = true;
  ws.tokens = RATE_BURST; ws.lastRefill = Date.now(); ws.dropped = 0;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    const reply = body => send(ws, Object.assign({ t:'res', id:m.id }, body));
    if (!takeToken(ws)) {
      if (++ws.dropped > MAX_DROPPED) return ws.terminate();
      return reply({ ok:false, error:'rate_limited' });
    }
    ws.dropped = 0;
    const code = typeof m.code === 'string' ? m.code.toUpperCase() : '';
    if (!CODE_RE.test(code)) return reply({ ok:false, error:'invalid_argument' });
    switch (m.t) {
      case 'get': {
        const room = rooms[code];
        return reply({ ok:true, exists:!!room, data:room ? room.data : null });
      }
      case 'set': {
        if (!m.data || typeof m.data !== 'object' || Array.isArray(m.data)) return reply({ ok:false, error:'invalid_argument' });
        if (JSON.stringify(m.data).length > MAX_DOC) return reply({ ok:false, error:'too_large' });
        if (!rooms[code]) {
          // room baru: batasi per IP dan jumlah total
          if (!canCreateRoom(ws.ip)) return reply({ ok:false, error:'rate_limited' });
          if (Object.keys(rooms).length >= MAX_ROOMS && !prune(STALE_ROOM)) return reply({ ok:false, error:'server_full' });
          createdByIp.get(ws.ip).push(Date.now());
        }
        rooms[code] = { data:m.data, at:Date.now() };
        save();
        reply({ ok:true });
        return broadcast(code);
      }
      case 'sub': {
        if (!ws.rooms.has(code) && ws.rooms.size >= MAX_SUBS_PER_CONN) return reply({ ok:false, error:'rate_limited' });
        subscribe(ws, code);
        const room = rooms[code];
        return send(ws, { t:'snap', code, data:room ? room.data : null });
      }
      case 'unsub': return unsubscribe(ws, code);
    }
  });
  ws.on('close', () => {
    for (const code of [...ws.rooms]) unsubscribe(ws, code);
    const left = (connsByIp.get(ws.ip) || 1) - 1;
    if (left > 0) connsByIp.set(ws.ip, left); else connsByIp.delete(ws.ip);
  });
});

// putuskan koneksi yang mati (HP terkunci lama, sinyal hilang)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, HOST, () => console.log(`monopoli-server di http://${HOST}:${PORT} (ws: /ws)`));
