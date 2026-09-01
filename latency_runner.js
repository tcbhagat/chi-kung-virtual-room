'use strict';

// Dependency-free RFC 6455 WebSocket echo server/client for local benchmarking.
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { performance } = require('node:perf_hooks');
const { createFrame, FRAME_MS } = require('./mock_telemetry');

const PORT = Number(process.env.PORT || 8080);
const DURATION_S = Number(process.env.DURATION_S || 10);
const CLIENTS = Number(process.env.CLIENTS || 1);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

if (![PORT, DURATION_S, CLIENTS].every(Number.isFinite) || PORT < 1 || DURATION_S <= 0 || CLIENTS < 1) {
  throw new Error('PORT, DURATION_S, and CLIENTS must be positive numbers');
}

function encodeFrame(data, masked) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const length = payload.length;
  const extendedBytes = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const frame = Buffer.alloc(2 + extendedBytes + (masked ? 4 : 0) + length);
  frame[0] = 0x81; // FIN + text frame.
  frame[1] = (masked ? 0x80 : 0) | (extendedBytes === 0 ? length : extendedBytes === 2 ? 126 : 127);
  let offset = 2;
  if (extendedBytes === 2) {
    frame.writeUInt16BE(length, offset);
    offset += 2;
  } else if (extendedBytes === 8) {
    frame.writeBigUInt64BE(BigInt(length), offset);
    offset += 8;
  }
  let mask;
  if (masked) {
    mask = crypto.randomBytes(4);
    mask.copy(frame, offset);
    offset += 4;
  }
  for (let index = 0; index < length; index += 1) {
    frame[offset + index] = masked ? payload[index] ^ mask[index % 4] : payload[index];
  }
  return frame;
}

class FrameDecoder {
  constructor(onMessage) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      const masked = Boolean(this.buffer[1] & 0x80);
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const bigLength = this.buffer.readBigUInt64BE(2);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket frame is too large');
        length = Number(bigLength);
        offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x1 || opcode === 0x2) this.onMessage(payload);
    }
  }
}

const server = http.createServer((request, response) => {
  response.writeHead(426, { 'Content-Type': 'text/plain' });
  response.end('WebSocket upgrade required');
});

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key'];
  if (!key || request.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`, '', ''
  ].join('\r\n'));
  const decoder = new FrameDecoder(payload => socket.write(encodeFrame(payload, false)));
  socket.on('data', chunk => decoder.push(chunk));
  socket.on('error', () => socket.destroy());
});

const state = {
  sentBytes: 0, receivedBytes: 0, sentFrames: 0, receivedFrames: 0,
  rtts: [], jitterSum: 0, jitterSamples: 0
};
const sockets = [];
const intervals = [];
let sequence = 0;
const testStartedAt = performance.now();
let windowStartedAt = testStartedAt;
let lastSentBytes = 0;
let lastReceivedBytes = 0;

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)];
}

function logMetrics(final = false) {
  const now = performance.now();
  const elapsedS = Math.max((now - (final ? testStartedAt : windowStartedAt)) / 1000, 0.001);
  const sent = final ? state.sentBytes : state.sentBytes - lastSentBytes;
  const received = final ? state.receivedBytes : state.receivedBytes - lastReceivedBytes;
  const averageRtt = state.rtts.length
    ? state.rtts.reduce((sum, value) => sum + value, 0) / state.rtts.length : 0;
  console.log(JSON.stringify({
    phase: final ? 'final' : 'live', clients: CLIENTS,
    frames: `${state.receivedFrames}/${state.sentFrames}`,
    rttAvgMs: Number(averageRtt.toFixed(2)),
    rttP95Ms: Number(percentile(state.rtts, 0.95).toFixed(2)),
    jitterMs: Number((state.jitterSamples ? state.jitterSum / state.jitterSamples : 0).toFixed(2)),
    txKBps: Number((sent / 1024 / elapsedS).toFixed(2)),
    rxKBps: Number((received / 1024 / elapsedS).toFixed(2)),
    totalKBps: Number(((sent + received) / 1024 / elapsedS).toFixed(2))
  }));
  lastSentBytes = state.sentBytes;
  lastReceivedBytes = state.receivedBytes;
  windowStartedAt = now;
}

function connectClient() {
  const socket = net.createConnection({ host: '127.0.0.1', port: PORT });
  const key = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  const pending = new Map();
  let lastRtt;
  const decoder = new FrameDecoder(payload => {
    state.receivedFrames += 1;
    const frame = JSON.parse(payload.toString());
    const startedAt = pending.get(frame.s);
    if (startedAt === undefined) return;
    pending.delete(frame.s);
    const rtt = performance.now() - startedAt;
    state.rtts.push(rtt);
    if (lastRtt !== undefined) {
      state.jitterSum += Math.abs(rtt - lastRtt);
      state.jitterSamples += 1;
    }
    lastRtt = rtt;
  });
  let handshake = Buffer.alloc(0);
  let connected = false;
  sockets.push(socket);

  socket.on('connect', () => socket.write([
    'GET / HTTP/1.1', `Host: 127.0.0.1:${PORT}`, 'Upgrade: websocket',
    'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''
  ].join('\r\n')));

  socket.on('data', chunk => {
    if (connected) {
      state.receivedBytes += chunk.length;
      decoder.push(chunk);
      return;
    }
    handshake = Buffer.concat([handshake, chunk]);
    const headerEnd = handshake.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const headers = handshake.subarray(0, headerEnd).toString();
    if (!headers.startsWith('HTTP/1.1 101') || !headers.includes(`Sec-WebSocket-Accept: ${expectedAccept}`)) {
      socket.destroy(new Error('WebSocket handshake failed'));
      return;
    }
    connected = true;
    const remainder = handshake.subarray(headerEnd + 4);
    if (remainder.length) {
      state.receivedBytes += remainder.length;
      decoder.push(remainder);
    }
    const interval = setInterval(() => {
      const frame = createFrame(sequence++, Date.now());
      const payload = Buffer.from(JSON.stringify(frame));
      const wireFrame = encodeFrame(payload, true);
      pending.set(frame.s, performance.now());
      state.sentBytes += wireFrame.length;
      state.sentFrames += 1;
      socket.write(wireFrame);
    }, FRAME_MS);
    intervals.push(interval);
  });
  socket.on('error', error => console.error(`Client error: ${error.message}`));
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dependency-free local telemetry test: ws://127.0.0.1:${PORT}, ${CLIENTS} client(s), ${DURATION_S}s`);
  for (let index = 0; index < CLIENTS; index += 1) connectClient();
});

const logTimer = setInterval(() => logMetrics(false), 1000);
setTimeout(() => {
  intervals.forEach(clearInterval);
  clearInterval(logTimer);
  setTimeout(() => {
    logMetrics(true);
    sockets.forEach(socket => socket.destroy());
    server.close(() => process.exit(process.exitCode || 0));
  }, 100);
}, DURATION_S * 1000);
