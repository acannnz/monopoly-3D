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
const MAX_DOC = 256 * 1024;                 // batas ukuran satu state
const ROOM_TTL = 30 * 24 * 3600 * 1000;     // room tak tersentuh 30 hari dihapus
const CODE_RE = /^[A-Z0-9]{4}$/;

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
function prune() {
  const now = Date.now();
  let changed = false;
  for (const code in rooms) if (now - rooms[code].at > ROOM_TTL) { delete rooms[code]; changed = true; }
  if (changed) save();
}
setInterval(prune, 6 * 3600 * 1000);

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
  res.end(`monopoli-server ok · ${Object.keys(rooms).length} room\n`);
});
const wss = new WebSocketServer({ server, path:'/ws', maxPayload:MAX_DOC + 4096 });

wss.on('connection', ws => {
  ws.rooms = new Set();
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    const code = typeof m.code === 'string' ? m.code.toUpperCase() : '';
    const reply = body => send(ws, Object.assign({ t:'res', id:m.id }, body));
    if (!CODE_RE.test(code)) return reply({ ok:false, error:'invalid_argument' });
    switch (m.t) {
      case 'get': {
        const room = rooms[code];
        return reply({ ok:true, exists:!!room, data:room ? room.data : null });
      }
      case 'set': {
        if (!m.data || typeof m.data !== 'object' || Array.isArray(m.data)) return reply({ ok:false, error:'invalid_argument' });
        if (JSON.stringify(m.data).length > MAX_DOC) return reply({ ok:false, error:'too_large' });
        rooms[code] = { data:m.data, at:Date.now() };
        save();
        reply({ ok:true });
        return broadcast(code);
      }
      case 'sub': {
        subscribe(ws, code);
        const room = rooms[code];
        return send(ws, { t:'snap', code, data:room ? room.data : null });
      }
      case 'unsub': return unsubscribe(ws, code);
    }
  });
  ws.on('close', () => { for (const code of [...ws.rooms]) unsubscribe(ws, code); });
});

// putuskan koneksi yang mati (HP terkunci lama, sinyal hilang)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, HOST, () => console.log(`monopoli-server di http://${HOST}:${PORT} (ws: /ws)`));
