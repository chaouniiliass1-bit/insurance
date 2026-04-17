import 'dotenv/config';
import io from 'socket.io-client';

const url = process.argv[2] || process.env.EXPO_PUBLIC_SOCKET_URL || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8788';
const transportArg = (process.argv[3] || '').toLowerCase();
const waitSeconds = Math.max(5, parseInt(process.argv[4] || '30', 10) || 30);
const base = String(url).trim().replace(/\/$/, '');
console.log('[TestSocket] Connecting to', base);

const transports = transportArg === 'polling' ? ['polling'] : ['websocket'];
const sock = io(base, {
  path: '/socket',
  transports,
  forceNew: true,
});

sock.on('connect', () => {
  console.log('[TestSocket] Connected', { id: sock.id, waitSeconds });
  // Keep connection briefly to allow event receipt, then disconnect.
  setTimeout(() => { try { sock.disconnect(); } catch {} }, waitSeconds * 1000);
});

sock.on('connect_error', (err) => {
  console.log('[TestSocket] connect_error', { message: err?.message, code: err?.code, context: err?.context });
});

sock.on('reconnect_attempt', (n) => {
  console.log('[TestSocket] reconnect_attempt', n);
});

sock.on('error', (e) => {
  console.log('[TestSocket] error', e);
});

// Listen for server broadcasted Suno events
sock.on('suno:error', (payload) => {
  try {
    console.log('[TestSocket] suno:error', typeof payload === 'string' ? payload : JSON.stringify(payload));
  } catch {
    console.log('[TestSocket] suno:error', payload);
  }
});

sock.on('suno:track', (payload) => {
  try {
    console.log('[TestSocket] suno:track', typeof payload === 'string' ? payload : JSON.stringify(payload));
  } catch {
    console.log('[TestSocket] suno:track', payload);
  }
});

process.on('uncaughtException', (e) => {
  console.log('[TestSocket] uncaughtException', e?.message || e);
});
