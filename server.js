import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createGame, tick, useSkill } from './src/game.js';

const rooms = new Map(), sessions = new Map();
const port = Number(process.env.PORT || 3000);
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const fail = message => { throw new Error(message); };
const publicPlayer = p => ({ id: p.id, name: p.name, role: p.role, color: p.color });
const snapshot = room => ({ code: room.code, host: room.host, phase: room.phase, duration: room.duration, players: [...room.players.values()].map(publicPlayer), game: room.game });
function broadcast(room) {
  const event = `data: ${JSON.stringify(snapshot(room))}\n\n`;
  for (const p of room.players.values()) if (p.stream && !p.stream.destroyed) {
    if (p.stream.writableLength > 256 * 1024) p.stream.destroy();
    else p.stream.write(event);
  }
}
function leave(player) {
  const room = rooms.get(player.code);
  player.stream?.end(); sessions.delete(player.token);
  if (!room) return;
  room.players.delete(player.id); room.inputs.delete(player.id);
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.host === player.id) room.host = room.players.keys().next().value;
  if (room.game) {
    if (room.game.bar.id === player.id) room.game.bar.id = null;
    const b = room.game.blocks.find(b => b.id === player.id);
    if (b) { b.cpu = true; b.color = '#ffffff'; b.name = 'CPU'; }
  }
  broadcast(room);
}
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 4096) fail('リクエストが大きすぎます。'); }
  try { return JSON.parse(data || '{}'); } catch { fail('リクエストの形式が正しくありません。'); }
}
function profile(data) {
  return { name: String(data.name || 'ゲスト').trim().slice(0, 16) || 'ゲスト', role: data.role === 'bar' ? 'bar' : 'block', color: /^#[0-9a-f]{6}$/i.test(data.color) && data.color.toLowerCase() !== '#ffffff' ? data.color : '#a78bfa' };
}
function assertSlot(room, role, except) {
  const count = [...room.players.values()].filter(p => p.role === role && p.id !== except).length;
  if (count >= (role === 'bar' ? 1 : 99)) fail(role === 'bar' ? 'バーチームは満員です。ブロックチームを選んでください。' : 'ブロックチームは満員です。');
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/events') {
      const p = sessions.get(url.searchParams.get('token'));
      if (!p) return json(res, 401, { error: '接続が切れました。もう一度ルームに参加してください。' });
      p.stream?.end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      p.stream = res; p.disconnectedAt = null;
      res.write('retry: 1500\n\n'); broadcast(rooms.get(p.code));
      req.on('close', () => { if (p.stream === res) { p.stream = null; p.disconnectedAt = Date.now(); rooms.get(p.code)?.inputs.delete(p.id); } });
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: '接続元が一致しません。' });
      const data = await body(req);
      const action = url.pathname.slice(5);
      if (action === 'create' || action === 'join') {
        let room;
        const info = profile(data);
        if (action === 'create') {
          if (rooms.size >= 100) fail('サーバーが混雑しています。しばらくしてからお試しください。');
          let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          room = { code, host: null, phase: 'lobby', duration: [30, 60].includes(data.duration) ? data.duration : 60, players: new Map(), inputs: new Map(), game: null };
        } else {
          room = rooms.get(String(data.code || '').toUpperCase());
          if (!room) fail('ルームが見つかりません。コードを確認してください。');
          if (room.phase !== 'lobby') fail('このルームは対戦中です。ロビーに戻ってから参加してください。');
        }
        assertSlot(room, info.role);
        const p = { ...info, id: randomUUID(), token: randomBytes(24).toString('hex'), code: room.code, stream: null, disconnectedAt: Date.now() };
        room.players.set(p.id, p); sessions.set(p.token, p); if (!room.host) room.host = p.id;
        rooms.set(room.code, room); broadcast(room);
        return json(res, 200, { token: p.token, id: p.id, room: snapshot(room) });
      }
      const p = sessions.get(req.headers.authorization?.replace(/^Bearer /, ''));
      if (!p) return json(res, 401, { error: 'もう一度ルームに参加してください。' });
      const room = rooms.get(p.code);
      if (action === 'leave') { leave(p); return json(res, 200, { ok: true }); }
      if (action === 'profile') {
        if (room.phase !== 'lobby') fail('対戦中は変更できません。');
        const info = profile(data); assertSlot(room, info.role, p.id); Object.assign(p, info); broadcast(room);
      } else if (action === 'start') {
        if (room.host !== p.id) fail('ホストだけが開始できます。');
        if (room.phase !== 'lobby') fail('すでに対戦中です。');
        room.game = createGame([...room.players.values()], room.duration); room.phase = 'playing'; room.inputs.clear(); broadcast(room);
      } else if (action === 'lobby') {
        if (room.host !== p.id) fail('ホストだけがロビーに戻せます。');
        if (room.phase !== 'finished') fail('対戦が終了するまでお待ちください。');
        room.phase = 'lobby'; room.game = null; room.inputs.clear(); broadcast(room);
      } else if (action === 'input') {
        const x = Number(data.x), y = Number(data.y);
        room.inputs.set(p.id, { x: Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0, y: Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0, targetX: typeof data.targetX === 'number' && Number.isFinite(data.targetX) ? Math.max(0, Math.min(1000, data.targetX)) : undefined, at: Date.now() });
      } else if (action === 'skill') {
        if (room.phase !== 'playing') fail('対戦中に使用できます。');
        if (!useSkill(room.game, p.id, data.slot)) fail('スキルはまだ使用できません。');
      } else return json(res, 404, { error: '見つかりません。' });
      return json(res, 200, { ok: true });
    }
    const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
    if (req.method === 'GET' && url.pathname === '/health') {
      const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const forwarded = req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'] || req.headers['x-forwarded-for'];
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
      const local = loopback && !forwarded && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
      const address = Object.values(networkInterfaces()).flat().find(n => n.family === 'IPv4' && !n.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address));
      return json(res, 200, { ok: true, rooms: rooms.size, inviteBase: local && address ? `http://${address.address}:${port}` : null });
    }
    if (req.method !== 'GET' || !files[url.pathname]) return json(res, 404, { error: 'Not found' });
    const [name, mime] = files[url.pathname];
    const content = await readFile(fileURLToPath(new URL(`./public/${name}`, import.meta.url)));
    res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" }); res.end(content);
  } catch (e) { if (!res.headersSent) json(res, 400, { error: e.message }); else res.end(); }
});
let frame = 0, previous = performance.now();
setInterval(() => {
  const now = performance.now(), dt = Math.min((now - previous) / 1000, .1); previous = now;
  for (const room of rooms.values()) {
    for (const [id, input] of room.inputs) if (Date.now() - input.at > 700) room.inputs.delete(id);
    if (room.phase === 'playing') {
      // Substeps keep collisions reliable even if the server briefly stalls.
      const steps = Math.ceil(dt / (1 / 120));
      for (let i = 0; i < steps; i++) tick(room.game, room.inputs, dt / steps);
      if (room.game.winner) { room.phase = 'finished'; broadcast(room); }
    }
    if (frame % 2 === 0 && room.phase === 'playing') broadcast(room);
  }
  frame++;
}, 1000 / 60).unref();
setInterval(() => {
  for (const p of sessions.values()) {
    if (p.disconnectedAt && Date.now() - p.disconnectedAt > 15000) leave(p);
    else if (p.stream) p.stream.write(': heartbeat\n\n');
  }
}, 5000).unref();
server.listen(port, '0.0.0.0', () => console.log(`ブロック崩しオンライン99 → http://localhost:${port}`));
