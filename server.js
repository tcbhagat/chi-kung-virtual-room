'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const MAX_OCCUPANTS = 10;
const MAX_MESSAGE_BYTES = 64 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '*').split(',').map(value => value.trim()).filter(Boolean);
const rooms = new Map();
const mimeTypes = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8'
});

function serve(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (requestUrl.pathname.startsWith('/socket.io/')) return;
  const requestOrigin = request.headers.origin;
  const originAllowed = ALLOWED_ORIGINS.includes('*') || !requestOrigin || ALLOWED_ORIGINS.includes(requestOrigin);
  if (request.method === 'OPTIONS') {
    response.writeHead(originAllowed ? 204 : 403, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes('*') ? '*' : requestOrigin || '',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }).end();
    return;
  }
  if (requestUrl.pathname === '/health') {
    if (!originAllowed) {
      response.writeHead(403).end('Origin not allowed');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes('*') ? '*' : requestOrigin || '' });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  // The primary Galaxy Tab experience is the visible 2D camera coach.
  // The optional shared 3D room remains available explicitly at /room.html.
  const requested = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const resolved = path.resolve(ROOT, `.${decodeURIComponent(requested)}`);
  if (!resolved.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(resolved, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(resolved)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': path.extname(resolved) === '.html' ? 'no-store' : 'public, max-age=300'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(resolved).pipe(response);
  });
}

function validPacket(packet) {
  if (!packet || typeof packet !== 'object' || typeof packet.type !== 'string') return false;
  try { return Buffer.byteLength(JSON.stringify(packet)) <= MAX_MESSAGE_BYTES; }
  catch { return false; }
}

function findAvailableRoom(requestedRoom) {
  const primary = rooms.get(requestedRoom);
  if (!primary || primary.size < MAX_OCCUPANTS) return requestedRoom;
  for (let instance = 2; instance < 100; instance += 1) {
    const candidate = `${requestedRoom}--${instance}`;
    if (!rooms.has(candidate) || rooms.get(candidate).size < MAX_OCCUPANTS) return candidate;
  }
  return null;
}

const webServer = http.createServer(serve);
const io = new Server(webServer, {
  maxHttpBufferSize: MAX_MESSAGE_BYTES,
  transports: ['websocket', 'polling'],
  cors: {
    origin(origin, callback) {
      callback(null, ALLOWED_ORIGINS.includes('*') || !origin || ALLOWED_ORIGINS.includes(origin));
    },
    methods: ['GET', 'POST']
  }
});

io.on('connection', socket => {
  let currentRoom = null;

  socket.on('joinRoom', data => {
    if (currentRoom) return;
    const requested = typeof data?.room === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(data.room)
      ? data.room : 'shared-practice';
    currentRoom = findAvailableRoom(requested);
    if (!currentRoom) {
      socket.disconnect(true);
      return;
    }
    if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Map());
    const joinedTime = Date.now();
    rooms.get(currentRoom).set(socket.id, joinedTime);
    socket.join(currentRoom);
    socket.emit('connectSuccess', { joinedTime });
    io.to(currentRoom).emit('occupantsChanged', { occupants: Object.fromEntries(rooms.get(currentRoom)) });
    console.log(`${socket.id} joined ${currentRoom} (${rooms.get(currentRoom).size}/${MAX_OCCUPANTS})`);
  });

  socket.on('send', packet => {
    if (!currentRoom || !validPacket(packet) || typeof packet.to !== 'string') return;
    if (!rooms.get(currentRoom)?.has(packet.to)) return;
    io.to(packet.to).emit('send', { from: socket.id, to: packet.to, type: packet.type, data: packet.data });
  });

  socket.on('broadcast', packet => {
    if (!currentRoom || !validPacket(packet)) return;
    socket.to(currentRoom).emit('broadcast', { from: socket.id, type: packet.type, data: packet.data });
  });

  socket.on('telemetry:ping', (data, acknowledge) => {
    if (typeof acknowledge === 'function') acknowledge({ t: data?.t || null, serverTime: Date.now() });
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const occupants = rooms.get(currentRoom);
    occupants.delete(socket.id);
    if (occupants.size === 0) rooms.delete(currentRoom);
    else socket.to(currentRoom).emit('occupantsChanged', { occupants: Object.fromEntries(occupants) });
  });
});

webServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Qi Gong browser coach: http://localhost:${PORT}`);
});

function shutdown() {
  io.close(() => webServer.close(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
