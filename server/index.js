const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });
const normalizeSecret = (raw) => {
  let v = String(raw || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (v.toLowerCase().startsWith('bearer ')) {
    v = v.slice('bearer '.length).trim();
  }
  v = v.replace(/\r?\n/g, '').trim();
  return v;
};
const SERVICE_KEY = normalizeSecret(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
if (!SERVICE_KEY) {
  console.error('CRITICAL ERROR: SUPABASE_SERVICE_ROLE_KEY IS UNDEFINED IN ENVIRONMENT');
}
console.log('Supabase Auth Attempt with key starting with:', SERVICE_KEY?.substring(0, 5));
const URL = String(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
try {
  console.log('DB Config Check:', {
    hasUrl: !!(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL),
    hasServiceKey: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
    hasAnonKey: !!(process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  });
} catch {}
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const BIN_DIR = path.join(process.cwd(), 'bin');
const NODE_BIN_DIR = path.join(process.cwd(), 'node_modules', '.bin');
process.env.PATH = `${BIN_DIR}:${NODE_BIN_DIR}:${process.env.PATH || ''}`;

const PORT = process.env.PORT || 8788;
const IS_DEV = String(process.env.EXPO_PUBLIC_IS_DEV).toLowerCase() === 'true';
const DISABLE_SOCKET_URL_UPSERT = String(process.env.DISABLE_SOCKET_URL_UPSERT).toLowerCase() === 'true';
// Track current tunnel and monitor health in dev
let CURRENT_PUBLIC_URL = null;
let ENSURING_TUNNEL = false;
let RESTARTING = false;

function normalizeOrigin(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  if (raw === '*') return '*';
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    try {
      const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }
}

function resolveAllowedOrigins() {
  const fromEnv = String(process.env.CORS_ORIGIN || '').trim();
  const candidates = [];
  if (fromEnv) {
    for (const part of fromEnv.split(',').map((s) => s.trim()).filter(Boolean)) {
      const o = normalizeOrigin(part);
      if (o) candidates.push(o);
    }
  }
  const api = normalizeOrigin(process.env.EXPO_PUBLIC_API_URL);
  const socket = normalizeOrigin(process.env.EXPO_PUBLIC_SOCKET_URL);
  if (api) candidates.push(api);
  if (socket) candidates.push(socket);
  if (IS_DEV && !candidates.length) candidates.push('*');
  return Array.from(new Set(candidates));
}

const ALLOWED_ORIGINS = resolveAllowedOrigins();
const corsOrigin = (origin, cb) => {
  if (!origin) return cb(null, true);
  if (ALLOWED_ORIGINS.includes('*')) return cb(null, true);
  const o = normalizeOrigin(origin) || origin;
  return cb(null, ALLOWED_ORIGINS.includes(o));
};

const app = express();
app.use((req, _res, next) => {
  try {
    if (typeof req.url === 'string' && req.url.startsWith('/api/')) {
      req.url = req.url.slice('/api'.length) || '/';
    }
  } catch {}
  next();
});
app.use(express.json({ limit: '2mb' }));
// Some providers post callbacks as application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
// Broaden CORS to include OPTIONS and common headers for XHR polling
app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST', 'OPTIONS'], credentials: false }));
app.options('*', cors({ origin: corsOrigin, methods: ['GET', 'POST', 'OPTIONS'], credentials: false }));
const callbackCors = cors({ origin: true, methods: ['POST', 'OPTIONS'], credentials: false });
app.options('/suno-callback', callbackCors);
app.options('/proxy/suno/callback', callbackCors);
app.use(['/suno-callback', '/proxy/suno/callback'], callbackCors);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST', 'OPTIONS'], credentials: false },
  path: '/socket',
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true,
});

// Debug: log upgrade attempts reaching the HTTP server
server.on('upgrade', (req, socket, head) => {
  try {
    const u = req.url || '';
    const origin = req.headers?.origin || req.headers?.host || 'unknown';
    const conn = req.headers?.connection;
    const upg = req.headers?.upgrade;
    console.log('[Server] HTTP upgrade', { url: u, origin, connection: conn, upgrade: upg });
  } catch {}
});

// Debug: log engine-level connection errors (pre-socket handshake)
io.engine.on('connection_error', (err) => {
  try {
    console.warn('[Server] Engine connection_error', { code: err?.code, msg: err?.message, context: err?.context });
  } catch {
    console.warn('[Server] Engine connection_error');
  }
});

// Idempotency: track processed task_ids
const processed = new Set();
const lastSigByTask = new Map();
const taskStartedAtMsById = new Map();
const recentCallbacks = [];
const RECENT_CALLBACKS_MAX = 200;
const pollingByTaskId = new Map();
// No device mapping; broadcast-only callbacks

async function upsertTracksForProfile(profile_id, urls, title, cover, task_id, source) {
  const pid = String(profile_id || '').trim();
  if (!pid) return;
  if (!Array.isArray(urls) || !urls.length) return;
  try {
    const baseTitle = typeof title === 'string' && title.trim().length ? title.trim() : 'New Track';
    const titles = urls.length >= 2 ? [baseTitle, `${baseTitle} 2`] : [baseTitle];
    for (let i = 0; i < Math.min(2, urls.length); i++) {
      const u = urls[i];
      if (typeof u !== 'string' || !u.startsWith('http')) continue;
      const row = {
        profile_id: pid,
        audio_url: u,
        mp3_url: u,
        stream_url: u,
        title: titles[i] || baseTitle,
        image_url: typeof cover === 'string' ? cover : null,
      };
      const existing = await supabaseAdmin.from('tracks').select('id').eq('profile_id', pid).eq('audio_url', u).limit(1);
      const id = Array.isArray(existing?.data) && existing.data[0]?.id ? existing.data[0].id : null;
      if (id) await supabaseAdmin.from('tracks').update(row).eq('id', id);
      else await supabaseAdmin.from('tracks').insert(row);
    }
    console.log('[Server] tracks upsert from poll', { profile_id: pid, task_id: task_id || null, source: source || 'poll', urls_len: urls.length });
  } catch (e) {
    console.warn('[Server] tracks upsert from poll failed', e?.message || e);
  }
}

async function pollSunoTaskFromEnv(taskId, profile_id) {
  const tid = String(taskId || '').trim();
  if (!tid) return;
  if (processed.has(tid)) return;
  const existing = pollingByTaskId.get(tid);
  if (existing?.workerStarted) return;
  if (existing) existing.workerStarted = true;
  else pollingByTaskId.set(tid, { startedAt: Date.now(), attempts: 0, profile_id: profile_id || null, workerStarted: true });

  setTimeout(async () => {
    try {
      const API_KEY = String(process.env.SUNO_API_KEY || process.env.EXPO_PUBLIC_SUNO_API_KEY || '').trim();
      const API_BASE = String(process.env.SUNO_API_URL || process.env.EXPO_PUBLIC_SUNO_BASE || 'https://api.api.box/api/v1').trim().replace(/\/+$/, '');
      const authHeader = API_KEY.toLowerCase().startsWith('bearer ') ? API_KEY : `Bearer ${API_KEY}`;
      const maxAttempts = 36;
      const intervalMs = 5000;
      for (;;) {
        const state = pollingByTaskId.get(tid);
        if (!state) return;
        if (processed.has(tid)) {
          pollingByTaskId.delete(tid);
          return;
        }
        const room = state?.profile_id ? String(state.profile_id) : null;
        state.attempts += 1;
        const attempt = state.attempts;
        if (attempt > maxAttempts) {
          console.warn('[Server] Poll timeout', { taskId: tid, attempts: attempt });
          pollingByTaskId.delete(tid);
          return;
        }
        const recordUrl = `${API_BASE}/generate/record-info?taskId=${encodeURIComponent(tid)}`;
        let recordResp = null;
        try {
          recordResp = await axios.get(recordUrl, {
            headers: { Authorization: authHeader, Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0' },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
            timeout: 20_000,
          });
        } catch (e) {
          const st = e?.response?.status || 0;
          const dat = e?.response?.data || null;
          console.warn('[Server] Poll error', { taskId: tid, attempt, status: st, data: dat && typeof dat === 'object' ? { code: dat.code, msg: dat.msg } : dat });
          await new Promise((r) => setTimeout(r, intervalMs));
          continue;
        }
        const payload = recordResp?.data || {};
        const d = payload?.data || {};
        const status = d?.status || d?.state || d?.task_status || null;
        const statusStr = String(status || '').toUpperCase();
        if (room && statusStr && statusStr !== 'SUCCESS') {
          try {
            io.to(room).emit('suno:status', { task_id: tid, status: statusStr, message: statusStr === 'TEXT_SUCCESS' ? 'Still Cooking…' : 'Finalizing track…' });
          } catch {}
        }
        if (statusStr !== 'SUCCESS') {
          const elapsedMs = Date.now() - (taskStartedAtMsById.get(tid) || Date.now());
          console.log('[Server] Poll record-info (not ready)', { taskId: tid, attempt, status: statusStr || status, elapsedMs });
          await new Promise((r) => setTimeout(r, intervalMs));
          continue;
        }
        const response = d?.response || {};
        const candidates = [];
        const metaCandidates = [];
        const add = (v) => {
          if (typeof v !== 'string') return;
          let s = v.trim();
          if (!s) return;
          if (s.includes('removeai.ai') && !s.startsWith('http://') && !s.startsWith('https://')) {
            s = `https://${s.replace(/^\/+/, '')}`;
          }
          candidates.push(s);
        };
        const listA = Array.isArray(response?.data) ? response.data : [];
        const listB = Array.isArray(response?.sunoData) ? response.sunoData : [];
        for (const it of [...listA, ...listB]) {
          metaCandidates.push(it);
          add(it?.audio_url);
          add(it?.audioUrl);
          add(it?.stream_audio_url);
          add(it?.streamAudioUrl);
          add(it?.source_stream_audio_url);
          add(it?.sourceStreamAudioUrl);
          add(it?.source_audio_url);
          add(it?.sourceAudioUrl);
          add(it?.cdn_url);
          add(it?.cdnUrl);
          add(it?.music_url);
          add(it?.musicUrl);
          add(it?.proxy_url);
          add(it?.proxyUrl);
          add(it?.url);
        }
        const urls = [];
        let pickedTitle = null;
        let pickedCover = null;
        for (const cand of candidates) {
          try {
            const u = new URL(cand);
            const host = u.hostname.toLowerCase();
            const isHttps = u.protocol === 'https:';
            const isHttp = u.protocol === 'http:';
            const isLocal = host.includes('localhost') || host === '127.0.0.1';
            if (((IS_DEV && (isHttps || isHttp)) || (!IS_DEV && isHttps)) && !isLocal && isAllowedSunoHost(host)) {
              if (!urls.includes(cand)) urls.push(cand);
            }
          } catch {}
          if (urls.length >= 2) break;
        }
        const elapsedMs = Date.now() - (taskStartedAtMsById.get(tid) || Date.now());
        console.log('[Server] Poll record-info', { taskId: tid, attempt, status, urls_len: urls.length, elapsedMs });
        if (urls.length) {
          try {
            for (const it of metaCandidates) {
              const u0 =
                it?.audio_url ||
                it?.audioUrl ||
                it?.stream_audio_url ||
                it?.streamAudioUrl ||
                it?.source_stream_audio_url ||
                it?.sourceStreamAudioUrl ||
                it?.source_audio_url ||
                it?.sourceAudioUrl ||
                it?.url ||
                null;
              if (typeof u0 === 'string' && (u0 === urls[0] || u0 === urls[1])) {
                pickedTitle = it?.title || it?.song_title || it?.name || pickedTitle;
                pickedCover = it?.cover || it?.cover_url || it?.image || it?.image_url || it?.imageUrl || pickedCover;
                break;
              }
            }
          } catch {}
          const sig = urls.join('|');
          const prevSig = lastSigByTask.get(tid) || null;
          lastSigByTask.set(tid, sig);
          if (!prevSig || prevSig !== sig) {
            console.log('[Server] Emitting suno:track (poll)', { taskId: tid, url: urls[0] });
            const out = { url: urls[0], audio_url: urls[0], urls, cover: pickedCover, title: pickedTitle || 'New Track', task_id: tid, callbackType: 'poll', items: metaCandidates.slice(0, 2) };
            if (room) {
              await upsertTracksForProfile(room, urls, pickedTitle, pickedCover, tid, 'poll');
            }
            if (room) io.to(room).emit('suno:track', out);
            else io.emit('suno:track', out);
          }
          pollingByTaskId.delete(tid);
          return;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    } catch (e) {
      console.warn('[Server] Poll worker crashed', e?.message || e);
      pollingByTaskId.delete(tid);
    }
  }, 1000);
}

async function pollSunoTaskSafetyNet(taskId, profile_id) {
  const tid = String(taskId || '').trim();
  if (!tid) return;
  if (processed.has(tid)) return;
  const existing = pollingByTaskId.get(tid);
  if (existing?.safetyNetStarted) return;
  if (existing) existing.safetyNetStarted = true;
  else pollingByTaskId.set(tid, { startedAt: Date.now(), attempts: 0, profile_id: profile_id || null, safetyNetStarted: true });

  setTimeout(async () => {
    try {
      const API_KEY = String(process.env.SUNO_API_KEY || process.env.EXPO_PUBLIC_SUNO_API_KEY || '').trim();
      const API_BASE = String(process.env.SUNO_API_URL || process.env.EXPO_PUBLIC_SUNO_BASE || 'https://api.api.box/api/v1').trim().replace(/\/+$/, '');
      const authHeader = API_KEY.toLowerCase().startsWith('bearer ') ? API_KEY : `Bearer ${API_KEY}`;
      const maxAttempts = 20;
      const intervalMs = 3000;

      const normalizeCandidate = (v) => {
        if (typeof v !== 'string') return null;
        let s = v.trim();
        if (!s) return null;
        if (s.startsWith('//')) s = `https:${s}`;
        if (s.includes('removeai.ai') && !s.startsWith('http://') && !s.startsWith('https://')) {
          s = `https://${s.replace(/^\/+/, '')}`;
        }
        return s;
      };

      for (;;) {
        const state = pollingByTaskId.get(tid);
        if (!state) return;
        if (processed.has(tid)) return;
        const room = state?.profile_id ? String(state.profile_id) : null;
        state.attempts = (state.attempts || 0) + 1;
        const attempt = state.attempts;
        if (attempt > maxAttempts) {
          console.warn('[Server] SafetyNet poll timeout', { taskId: tid, attempts: attempt });
          return;
        }

        const recordUrl = `${API_BASE}/generate/record-info?taskId=${encodeURIComponent(tid)}`;
        let recordResp = null;
        try {
          recordResp = await axios.get(recordUrl, {
            headers: { Authorization: authHeader, Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0' },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
            timeout: 20_000,
          });
        } catch (e) {
          const st = e?.response?.status || 0;
          const dat = e?.response?.data || null;
          console.warn('[Server] SafetyNet poll error', { taskId: tid, attempt, status: st, data: dat && typeof dat === 'object' ? { code: dat.code, msg: dat.msg } : dat });
          await new Promise((r) => setTimeout(r, intervalMs));
          continue;
        }

        const payload = recordResp?.data || {};
        const d = payload?.data || {};
        const status = d?.status || d?.state || d?.task_status || null;
        const response = d?.response || {};

        const candidates = [];
        const metaCandidates = [];
        const add = (v) => {
          const s = normalizeCandidate(v);
          if (!s) return;
          if (s.includes('removeai.ai')) candidates.unshift(s);
          else candidates.push(s);
        };

        const listA = Array.isArray(response?.data) ? response.data : [];
        const listB = Array.isArray(response?.sunoData) ? response.sunoData : [];
        for (const it of [...listA, ...listB]) {
          metaCandidates.push(it);
          add(it?.audio_url);
          add(it?.stream_audio_url);
          add(it?.source_stream_audio_url);
          add(it?.url);
          add(it?.audioUrl);
          add(it?.streamAudioUrl);
          add(it?.sourceStreamAudioUrl);
          add(it?.sourceAudioUrl);
          add(it?.cdn_url);
          add(it?.cdnUrl);
          add(it?.music_url);
          add(it?.musicUrl);
          add(it?.proxy_url);
          add(it?.proxyUrl);
        }

        const urls = [];
        for (const cand of candidates) {
          try {
            const u = new URL(cand);
            const host = u.hostname.toLowerCase();
            const isHttps = u.protocol === 'https:';
            const isHttp = u.protocol === 'http:';
            const isLocal = host.includes('localhost') || host === '127.0.0.1';
            if (((IS_DEV && (isHttps || isHttp)) || (!IS_DEV && isHttps)) && !isLocal && isAllowedSunoHost(host)) {
              if (!urls.includes(cand)) urls.push(cand);
            }
          } catch {}
          if (urls.length >= 2) break;
        }

        const elapsedMs = Date.now() - (taskStartedAtMsById.get(tid) || Date.now());
        console.log('[Server] SafetyNet poll record-info', { taskId: tid, attempt, status, urls_len: urls.length, elapsedMs });
        if (urls.length) {
          try {
            await upsertTracksForProfile(room || profile_id || null, urls, null, null, tid, 'safetynet');
          } catch {}
          const out = { url: urls[0], audio_url: urls[0], urls, cover: null, title: 'New Track', task_id: tid, callbackType: 'safetynet', items: metaCandidates.slice(0, 2) };
          if (room) io.to(room).emit('suno:track', out);
          else io.emit('suno:track', out);
          return;
        }

        if (room) {
          try { io.to(room).emit('suno:status', { task_id: tid, status: String(status || ''), message: 'Still Cooking…' }); } catch {}
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    } catch (e) {
      console.warn('[Server] SafetyNet poll crashed', e?.message || e);
    }
  }, 500);
}

io.on('connection', (socket) => {
  try {
    const authPid = socket?.handshake?.auth?.profile_id ?? socket?.handshake?.auth?.profileId;
    const queryPid = socket?.handshake?.query?.profile_id ?? socket?.handshake?.query?.profileId;
    const pid = String(authPid || queryPid || '').trim();
    if (pid) {
      socket.join(pid);
      console.log('[Server] Socket joined room', { socketId: socket.id, profile_id: pid });
    }
  } catch {}
  socket.on('join', (payload) => {
    try {
      const pid = String(payload?.profile_id || payload?.profileId || '').trim();
      if (pid) {
        socket.join(pid);
        console.log('[Server] Socket joined room (event)', { socketId: socket.id, profile_id: pid });
      }
    } catch {}
  });
  try {
    const addr = socket?.handshake?.address || 'unknown';
    const t = socket?.conn?.transport?.name || 'unknown';
    console.log('[Server] Socket connected', socket.id, { addr, transport: t });
  } catch {
    console.log('[Server] Socket connected', socket.id);
  }
  socket.on('disconnect', () => {
    try {
      const addr = socket?.handshake?.address || 'unknown';
      console.log('[Server] Socket disconnected', socket.id, { addr });
    } catch {
      console.log('[Server] Socket disconnected', socket.id);
    }
  });
});

app.get('/health', (req, res) => {
  try {
    const xf = req.headers['x-forwarded-for'];
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    console.log('[Server] /health', { ip, xf });
  } catch {}
  return res.json({ ok: true });
});

app.get('/debug/callbacks', (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10) || 50));
  const slice = recentCallbacks.slice(Math.max(0, recentCallbacks.length - limit));
  return res.json({ count: slice.length, callbacks: slice });
});

app.get('/debug/tasks', (req, res) => {
  try {
    const tasks = [];
    for (const [taskId, ts] of taskStartedAtMsById.entries()) {
      tasks.push({ taskId, startedAtMs: ts, ageMs: Date.now() - ts });
    }
    tasks.sort((a, b) => b.startedAtMs - a.startedAtMs);
    return res.json({ count: tasks.length, tasks: tasks.slice(0, 50) });
  } catch {
    return res.json({ count: 0, tasks: [] });
  }
});

app.get('/debug/suno', (req, res) => {
  try {
    const API_KEY = (process.env.SUNO_API_KEY || process.env.EXPO_PUBLIC_SUNO_API_KEY || '').trim();
    const API_BASE = (process.env.SUNO_API_URL || process.env.EXPO_PUBLIC_SUNO_BASE || 'https://api.api.box/api/v1').trim().replace(/\/+$/, '');
    const cb = String(process.env.EXPO_PUBLIC_SUNO_CALLBACK_URL || '').trim();
    const dryRun = String(process.env.SUNO_DRY_RUN || '').trim() === '1';
    return res.json({
      ok: true,
      hasKey: !!API_KEY && !API_KEY.includes('your-suno-api-key'),
      apiBase: API_BASE,
      callbackUrl: cb,
      dryRun,
    });
  } catch {
    return res.json({ ok: false });
  }
});

// Self-Test Endpoint: emit a direct playable track through the socket
app.get('/test-connection', (req, res) => {
  try {
    console.log('[Server] /test-connection hit, emitting suno:error (no test track configured)');
    io.emit('suno:error', { code: 400, msg: 'No test track configured', task_id: 'test-connection' });
    return res.send('<h1>Connection Socket Test</h1><p>Signal sent! Check your phone.</p>');
  } catch (e) {
    return res.status(500).send('Error emitting event');
  }
});

// Web Generation UI: simple trigger for Suno generation
app.get('/web-generate', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>MoodFusion Web Generator</title>
      <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #121212; color: white; }
        .card { background: #1e1e1e; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 320px; text-align: center; }
        button { background: #ff7e5f; color: white; border: none; padding: 12px 24px; border-radius: 24px; font-weight: bold; cursor: pointer; margin-top: 1rem; width: 100%; }
        button:disabled { background: #444; cursor: not-allowed; }
        #status { margin-top: 1rem; font-size: 0.9rem; color: #aaa; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>MoodFusion AI</h2>
        <p>Trigger generation for testing</p>
        <button id="genBtn">Generate My Vibe</button>
        <div id="status">Ready</div>
      </div>
      <script>
        const btn = document.getElementById('genBtn');
        const status = document.getElementById('status');
        btn.onclick = async () => {
          btn.disabled = true;
          status.innerText = 'Requesting...';
          try {
            const resp = await fetch('/proxy/suno/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: 'Smooth jazz with lo-fi beats', tags: ['chill', 'lofi'] })
            });
            const data = await resp.json();
            if (data.taskId) {
              status.innerText = 'Success! Task ID: ' + data.taskId;
            } else {
              status.innerText = 'Error: ' + (data.error || 'Unknown error');
              btn.disabled = false;
            }
          } catch (e) {
            status.innerText = 'Network error';
            btn.disabled = false;
          }
        };
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// Disable dev simulation route in ALL environments
app.post('/set-latest-track', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});
console.log('[Server] ALL MODES: /set-latest-track disabled');

// --- Supabase Secure Proxy (Service Role) ---
// Use service role key ONLY on the server. Never expose to client.
const SUPABASE_URL = (URL || 'https://wiekabbfmpmxjhiwyfzt.supabase.co').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(SERVICE_KEY || '').trim();
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[Server] Missing SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}
try {
  const host = (() => {
    try { return new URL(SUPABASE_URL).host; } catch { return null; }
  })();
  console.log('[Server] Supabase config snapshot', {
    host,
    hasServiceKey: true,
    serviceKeyLen: SUPABASE_SERVICE_ROLE_KEY.length,
    serviceKeyLooksJwt: SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ'),
  });
} catch {}
try {
  const hasSuno = !!String(process.env.SUNO_API_KEY || process.env.EXPO_PUBLIC_SUNO_API_KEY || '').trim();
  console.log('[Server] SUNO_API_KEY', hasSuno ? 'Key exists' : 'Key MISSING');
} catch {}
const VIBES_BUCKET = 'tracks';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function isHtmlDoctype(payload) {
  if (typeof payload !== 'string') return false;
  const t = payload.trimStart().toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html');
}

function logCriticalIfSupabaseHtml(payload, context) {
  if (!isHtmlDoctype(payload)) return false;
  try {
    console.error('CRITICAL: SUPABASE_URL is pointing to a website, not an API!', { SUPABASE_URL, context });
  } catch {
    console.error('CRITICAL: SUPABASE_URL is pointing to a website, not an API!');
  }
  return true;
}

function supabaseHeaders() {
  const k = SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: k,
    Authorization: `Bearer ${k}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=representation',
  };
  return headers;
}
try {
  const h = supabaseHeaders();
  console.log('[Server] Supabase header check', { hasApikey: !!h.apikey, hasAuthorization: String(h.Authorization || '').startsWith('Bearer ') });
} catch {}

const siphonInFlight = new Set();
let bucketEnsured = false;
async function siphonToSupabaseStorage({ taskId, streamUrl, downloadUrl, trackKey, desiredTitle }) {
  const key = `${downloadUrl}::${trackKey || ''}`;
  if (siphonInFlight.has(key)) return null;
  siphonInFlight.add(key);
  try {
    if (!downloadUrl || typeof downloadUrl !== 'string') return null;
    if (!bucketEnsured) {
      try {
        const got = await supabaseAdmin.storage.getBucket(VIBES_BUCKET);
        if (!got?.data) await supabaseAdmin.storage.createBucket(VIBES_BUCKET, { public: true });
        try { await supabaseAdmin.storage.updateBucket(VIBES_BUCKET, { public: true }); } catch {}
        bucketEnsured = true;
      } catch {}
    }
    const fileNameBase = String(trackKey || taskId || 'track').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    const filePath = `${fileNameBase}.mp3`;

    const resp = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
      headers: { Accept: 'audio/mpeg,audio/*,*/*' },
    });
    const buf = Buffer.from(resp.data);
    if (!buf.length) throw new Error('empty_audio_buffer');

    const up = await supabaseAdmin.storage.from(VIBES_BUCKET).upload(filePath, buf, {
      contentType: 'audio/mpeg',
      upsert: true,
    });
    if (up?.error) throw up.error;

    const { data } = supabaseAdmin.storage.from(VIBES_BUCKET).getPublicUrl(filePath);
    const publicUrl = data?.publicUrl || `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${VIBES_BUCKET}/${filePath}`;

    const updateRow = async () => {
      // Prefer matching by mp3_url (download_url) because client always writes mp3_url.
      let row = null;
      try {
        const q1 = await supabaseAdmin.from('tracks').select('id').eq('mp3_url', downloadUrl).limit(1);
        row = Array.isArray(q1?.data) && q1.data[0] ? q1.data[0] : null;
      } catch {}
      if (!row) {
        try {
          const q2 = await supabaseAdmin.from('tracks').select('id').eq('audio_url', downloadUrl).limit(1);
          row = Array.isArray(q2?.data) && q2.data[0] ? q2.data[0] : null;
        } catch {}
      }
      if (!row && streamUrl) {
        try {
          const q3 = await supabaseAdmin.from('tracks').select('id').eq('stream_url', streamUrl).limit(1);
          row = Array.isArray(q3?.data) && q3.data[0] ? q3.data[0] : null;
        } catch {}
      }
      if (!row?.id) return false;
      const patch = { audio_url: publicUrl, mp3_url: publicUrl };
      if (typeof desiredTitle === 'string' && desiredTitle.trim().length) {
        patch.title = desiredTitle.trim();
      }
      const up2 = await supabaseAdmin.from('tracks').update(patch).eq('id', row.id);
      return !up2?.error;
    };

    // Row may not exist yet (client inserts after socket event). Retry a few times.
    const delays = [2000, 6000, 14000];
    let ok = await updateRow();
    for (const d of delays) {
      if (ok) break;
      await new Promise((r) => setTimeout(r, d));
      ok = await updateRow();
    }
    if (!ok) {
      console.warn('[Siphon] uploaded but DB row not found yet', { taskId, trackKey, downloadUrl: downloadUrl.slice(0, 80) });
    } else {
      console.log('[Siphon] success', { taskId, trackKey, filePath });
    }
    return publicUrl;
  } catch (e) {
    console.warn('[Siphon] failed', { taskId, trackKey, err: String(e?.message || e) });
    return null;
  } finally {
    siphonInFlight.delete(key);
  }
}

app.post('/supabase/profiles/upsert', async (req, res) => {
  try {
    const body = req.body || {};
    const url = `${SUPABASE_URL}/rest/v1/profiles?on_conflict=nickname`;
    const resp = await axios.post(url, body, { headers: supabaseHeaders(), timeout: 10000 });
    if (logCriticalIfSupabaseHtml(resp.data, 'POST /supabase/profiles/upsert')) {
      return res.status(500).json({ error: 'Supabase base URL misconfigured' });
    }
    return res.status(resp.status).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase upsert error' };
    logCriticalIfSupabaseHtml(data, 'POST /supabase/profiles/upsert (error)');
    console.error('[Server] Supabase upsert error', { status, data });
    return res.status(status).json(data);
  }
});

app.get(['/supabase/profiles/by-nickname', '/supabase/profiles/by-nickname/'], async (req, res) => {
  try {
    console.log('Fetching profile for:', req.query);
    const nickname = String(req.query.nickname || '').trim();
    if (!nickname) return res.status(400).json({ error: 'nickname required' });
    const filter = `nickname=eq.${encodeURIComponent(nickname)}`;
    const select = encodeURIComponent('id,coins,nickname,avatar_url,password_hash,keep_logged_in,device_id');
    const url = `${SUPABASE_URL}/rest/v1/profiles?${filter}&select=${select}`;
    const resp = await axios.get(url, { headers: supabaseHeaders(), timeout: 8000 });
    if (logCriticalIfSupabaseHtml(resp.data, 'GET /supabase/profiles/by-nickname')) {
      return res.status(500).json({ error: 'Supabase base URL misconfigured' });
    }
    return res.status(resp.status).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase fetch error' };
    logCriticalIfSupabaseHtml(data, 'GET /supabase/profiles/by-nickname (error)');
    console.error('[Server] Supabase fetch error', { status, data });
    return res.status(status).json(data);
  }
});

app.get(['/supabase/profiles/by-device', '/supabase/profiles/by-device/'], async (req, res) => {
  try {
    console.log('Fetching profile for:', req.query);
    const device_id = String(req.query.device_id || '').trim();
    if (!device_id) return res.status(400).json({ error: 'device_id required' });
    const filter = `device_id=eq.${encodeURIComponent(device_id)}`;
    const select = encodeURIComponent('id,coins,nickname,avatar_url,password_hash,keep_logged_in,device_id');
    const url = `${SUPABASE_URL}/rest/v1/profiles?${filter}&select=${select}&limit=1`;
    const resp = await axios.get(url, { headers: supabaseHeaders(), timeout: 8000 });
    if (logCriticalIfSupabaseHtml(resp.data, 'GET /supabase/profiles/by-device')) {
      return res.status(500).json({ error: 'Supabase base URL misconfigured' });
    }
    return res.status(resp.status).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase fetch error' };
    logCriticalIfSupabaseHtml(data, 'GET /supabase/profiles/by-device (error)');
    console.error('[Server] Supabase device fetch error', { status, data });
    return res.status(status).json(data);
  }
});

app.get('/supabase/profiles', async (req, res) => {
  const nickname = String(req.query.nickname || '').trim();
  const device_id = String(req.query.device_id || '').trim();
  if (nickname) return res.redirect(307, `/supabase/profiles/by-nickname?nickname=${encodeURIComponent(nickname)}`);
  if (device_id) return res.redirect(307, `/supabase/profiles/by-device?device_id=${encodeURIComponent(device_id)}`);
  return res.status(400).json({ error: 'Provide nickname or device_id' });
});

app.patch('/supabase/profiles/coins', async (req, res) => {
  try {
    const { nickname, coins } = req.body || {};
    if (!nickname || typeof coins !== 'number') return res.status(400).json({ error: 'nickname and coins required' });
    const url = `${SUPABASE_URL}/rest/v1/profiles?nickname=eq.${encodeURIComponent(nickname)}`;
    const resp = await axios.patch(url, { coins }, { headers: supabaseHeaders(), timeout: 8000 });
    return res.status(resp.status).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase update coins error' };
    console.error('[Server] Supabase coins error', { status, data });
    return res.status(status).json(data);
  }
});

app.patch('/supabase/profiles/keep-login', async (req, res) => {
  try {
    const { nickname, keep } = req.body || {};
    if (!nickname || typeof keep !== 'boolean') return res.status(400).json({ error: 'nickname and keep required' });
    const url = `${SUPABASE_URL}/rest/v1/profiles?nickname=eq.${encodeURIComponent(nickname)}`;
    const resp = await axios.patch(url, { keep_logged_in: keep }, { headers: supabaseHeaders(), timeout: 8000 });
    return res.status(resp.status).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase keep_logged_in error' };
    console.error('[Server] Supabase keep login error', { status, data });
    return res.status(status).json(data);
  }
});

app.patch('/supabase/profiles/avatar', async (req, res) => {
  try {
    const { nickname, avatar_url } = req.body || {};
    if (!nickname || !avatar_url) return res.status(400).json({ error: 'nickname and avatar_url required' });
    const url = `${SUPABASE_URL}/rest/v1/profiles?nickname=eq.${encodeURIComponent(nickname)}`;
    const resp = await axios.patch(url, { avatar_url }, { headers: supabaseHeaders(), timeout: 8000 });
    return res.status(resp.status).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase avatar update error' };
    console.error('[Server] Supabase avatar error', { status, data });
    return res.status(status).json(data);
  }
});

// Tracks bulk insert via service role (bypasses client RLS)
app.post('/supabase/tracks/bulk-insert', async (req, res) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : [];
    if (!rows.length) return res.status(200).json([]);
    const normalized = rows.map((row) => ({
      profile_id: row.profile_id,
      audio_url: row.audio_url,
      title: row.title ?? null,
      mood: row.mood ?? null,
      genres: Array.isArray(row.genres) ? row.genres.filter(Boolean).join(',') : (row.genres || null),
      liked: typeof row.liked === 'boolean' ? row.liked : false,
      stream_url: row.stream_url ?? null,
      mp3_url: row.mp3_url ?? null,
      image_url: row.image_url ?? null,
    }));

    const seen = new Set();
    const unique = normalized.filter((r) => {
      const pid = String(r.profile_id || '').trim();
      const au = String(r.audio_url || '').trim();
      if (!pid || !au) return false;
      const key = `${pid}::${au}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const exists = async (profile_id, audio_url) => {
      const sel = encodeURIComponent('id');
      const url = `${SUPABASE_URL}/rest/v1/tracks?profile_id=eq.${encodeURIComponent(profile_id)}&audio_url=eq.${encodeURIComponent(audio_url)}&select=${sel}&limit=1`;
      const resp = await axios.get(url, { headers: supabaseHeaders(), timeout: 8000 });
      return Array.isArray(resp.data) && resp.data.length > 0;
    };

    const payload = [];
    for (const r of unique) {
      const pid = String(r.profile_id || '').trim();
      const au = String(r.audio_url || '').trim();
      if (!pid || !au) continue;
      let already = false;
      try {
        already = await exists(pid, au);
      } catch {
        already = false;
      }
      if (!already) payload.push(r);
    }

    if (!payload.length) return res.status(200).json([]);
    const url = `${SUPABASE_URL}/rest/v1/tracks`;
    const resp = await axios.post(url, payload, { headers: supabaseHeaders(), timeout: 12000 });
    if (logCriticalIfSupabaseHtml(resp.data, 'POST /supabase/tracks/bulk-insert')) {
      return res.status(500).json({ error: 'Supabase base URL misconfigured' });
    }
    try {
      const stamp = new Date().toISOString();
      const summary = {
        at: stamp,
        status: resp.status || 0,
        rows: payload.length,
        profile_ids: [...new Set(payload.map((r) => r.profile_id))],
        audio_urls: payload.map((r) => r.audio_url).slice(0, 3),
      };
      const line = `[tracks-bulk-insert] ${JSON.stringify(summary)}\n`;
      fs.appendFileSync(path.join(__dirname, 'tracks.log'), line);
    } catch (logErr) {
      console.warn('[Server] tracks bulk insert log write failed', logErr?.message || logErr);
    }
    return res.status(resp.status || 201).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase tracks bulk insert error' };
    logCriticalIfSupabaseHtml(data, 'POST /supabase/tracks/bulk-insert (error)');
    console.error('[Server] Supabase tracks bulk insert error', { status, data });
    return res.status(status).json(data);
  }
});

app.get('/supabase/tracks/by-profile', async (req, res) => {
  try {
    const profile_id = String(req.query.profile_id || '').trim();
    if (!profile_id) return res.status(400).json({ error: 'Missing profile_id' });
    const select = encodeURIComponent('id,audio_url,title,mood,genres,liked,created_at,image_url,stream_url,mp3_url');
    const url = `${SUPABASE_URL}/rest/v1/tracks?profile_id=eq.${encodeURIComponent(profile_id)}&select=${select}&order=created_at.desc`;
    const resp = await axios.get(url, { headers: supabaseHeaders(), timeout: 12000 });
    if (logCriticalIfSupabaseHtml(resp.data, 'GET /supabase/tracks/by-profile')) {
      return res.status(500).json({ error: 'Supabase base URL misconfigured' });
    }
    return res.status(resp.status || 200).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase tracks list error' };
    logCriticalIfSupabaseHtml(data, 'GET /supabase/tracks/by-profile (error)');
    console.error('[Server] Supabase tracks list error', { status, data });
    return res.status(status).json(data);
  }
});

app.get('/supabase/tracks', async (req, res) => {
  const profile_id = String(req.query.profile_id || '').trim();
  if (profile_id) return res.redirect(307, `/supabase/tracks/by-profile?profile_id=${encodeURIComponent(profile_id)}`);
  return res.status(400).json({ error: 'Provide profile_id' });
});

app.post('/supabase/tracks/backfill-mp3', async (req, res) => {
  try {
    const profile_id = String(req.body?.profile_id || '').trim();
    if (!profile_id) return res.status(400).json({ error: 'profile_id required' });

    const select = encodeURIComponent('id,audio_url,stream_url,mp3_url');
    const listUrl = `${SUPABASE_URL}/rest/v1/tracks?profile_id=eq.${encodeURIComponent(profile_id)}&select=${select}&limit=200`;
    const listResp = await axios.get(listUrl, { headers: supabaseHeaders(), timeout: 12000 });
    const rows = Array.isArray(listResp.data) ? listResp.data : [];
    let updated = 0;

    for (const r of rows) {
      const id = r?.id != null ? String(r.id) : '';
      const mp3 = typeof r?.mp3_url === 'string' ? r.mp3_url.trim() : '';
      if (!id || mp3) continue;
      const next =
        (typeof r?.audio_url === 'string' && r.audio_url.trim().length ? r.audio_url.trim() : '') ||
        (typeof r?.stream_url === 'string' && r.stream_url.trim().length ? r.stream_url.trim() : '');
      if (!next) continue;
      const patchUrl = `${SUPABASE_URL}/rest/v1/tracks?id=eq.${encodeURIComponent(id)}`;
      try {
        await axios.patch(patchUrl, { mp3_url: next }, { headers: supabaseHeaders(), timeout: 12000 });
        updated += 1;
      } catch (e) {
        const status = e?.response?.status || 500;
        const data = e?.response?.data || { error: 'Supabase patch error' };
        console.warn('[Server] backfill mp3 patch failed', { status, data });
      }
    }

    return res.status(200).json({ ok: true, updated });
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase backfill error' };
    console.error('[Server] Supabase backfill mp3 error', { status, data });
    return res.status(status).json(data);
  }
});

app.post('/supabase/tracks/update-liked', async (req, res) => {
  try {
    const track_id = String(req.body?.track_id || '').trim();
    const liked = req.body?.liked;
    if (!track_id) return res.status(400).json({ error: 'track_id required' });
    if (typeof liked !== 'boolean') return res.status(400).json({ error: 'liked boolean required' });
    const url = `${SUPABASE_URL}/rest/v1/tracks?id=eq.${encodeURIComponent(track_id)}&select=id,liked`;
    const resp = await axios.patch(url, { liked }, { headers: supabaseHeaders(), timeout: 10000 });
    return res.status(resp.status || 200).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase tracks update liked error' };
    console.error('[Server] Supabase tracks update liked error', { status, data });
    return res.status(status).json(data);
  }
});

// Tracks lookup by audio_url via service role (verification helper)
app.get('/supabase/tracks/by-audio-url', async (req, res) => {
  try {
    const audio_url = String(req.query.audio_url || '').trim();
    if (!audio_url) return res.status(400).json({ error: 'Missing audio_url' });
    const url = `${SUPABASE_URL}/rest/v1/tracks?audio_url=eq.${encodeURIComponent(audio_url)}&select=*`;
    const resp = await axios.get(url, { headers: supabaseHeaders(), timeout: 8000 });
    if (logCriticalIfSupabaseHtml(resp.data, 'GET /supabase/tracks/by-audio-url')) {
      return res.status(500).json({ error: 'Supabase base URL misconfigured' });
    }
    return res.status(resp.status || 200).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase tracks lookup error' };
    logCriticalIfSupabaseHtml(data, 'GET /supabase/tracks/by-audio-url (error)');
    console.error('[Server] Supabase tracks lookup error', { status, data });
    return res.status(status).json(data);
  }
});

app.all('/supabase/*', async (req, res) => {
  try {
    const suffix = String(req.params?.[0] || '').replace(/^\/+/, '');
    if (!suffix) return res.status(404).json({ error: 'Missing Supabase path' });
    if (suffix.startsWith('auth/') || suffix.startsWith('functions/') || suffix.startsWith('realtime/')) {
      return res.status(403).json({ error: 'Forbidden path' });
    }
    const method = String(req.method || 'GET').toUpperCase();
    const qs = (() => {
      try {
        const i = String(req.originalUrl || '').indexOf('?');
        return i >= 0 ? String(req.originalUrl || '').slice(i) : '';
      } catch {
        return '';
      }
    })();
    const target = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${suffix}${qs}`;
    const headers = { ...supabaseHeaders() };
    delete headers['Content-Type'];
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    }
    const resp = await axios.request({
      method,
      url: target,
      headers,
      data: method === 'GET' || method === 'HEAD' ? undefined : req.body,
      timeout: 12000,
      validateStatus: () => true,
    });
    if (logCriticalIfSupabaseHtml(resp.data, `ALL /supabase/* → ${suffix}`)) {
      return res.status(500).json({ error: 'Supabase base URL misconfigured' });
    }
    return res.status(resp.status || 500).send(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase proxy error' };
    logCriticalIfSupabaseHtml(data, 'ALL /supabase/* (error)');
    console.error('[Server] Supabase catch-all proxy error', { status, data });
    return res.status(status).json(data);
  }
});

// Proxy for Suno API (used by web builds to avoid CORS issues)
// Forwards Authorization header and JSON body to the remote Suno generate endpoint.
const API_BASE = process.env.EXPO_PUBLIC_SUNO_BASE || 'https://api.mureka.org/v1';
// Allow only API Box / Suno audio CDNs. Do NOT allow arbitrary hosts even in dev.
const ALLOWED_AUDIO_HOSTS = [
  'api.api.box',
  'api.box',
  'removeai.ai',
  'musicfile.removeai.ai',
  'suno.ai',
  'cdn.suno.ai',
  'sunoapi.org',
  'sunousercontent.com',
  'mureka.org',
];
const isAllowedSunoHost = (host) => {
  const h = String(host || '').toLowerCase();
  return ALLOWED_AUDIO_HOSTS.some((d) => h === d || h.endsWith(`.${d}`) || h.includes(d));
};

async function ensureTunnelAndEnv() {
  if (ENSURING_TUNNEL) return;
  ENSURING_TUNNEL = true;
  try {
    let publicUrl = null;
    const cbUrl = String(process.env.EXPO_PUBLIC_SUNO_CALLBACK_URL || '').trim();
    const apiBaseEnv = String(process.env.EXPO_PUBLIC_API_URL || '').trim();
    if (cbUrl) {
      try {
        const u = new URL(cbUrl);
        publicUrl = `${u.protocol}//${u.host}`;
      } catch {}
    }
    if (!publicUrl && apiBaseEnv) {
      try {
        const u = new URL(apiBaseEnv);
        publicUrl = `${u.protocol}//${u.host}`;
      } catch {
        publicUrl = apiBaseEnv.replace(/\/$/, '');
      }
    }
    if (!publicUrl) {
      ENSURING_TUNNEL = false;
      return;
    }
    CURRENT_PUBLIC_URL = publicUrl.replace(/\/$/, '');
    const callbackUrl = `${CURRENT_PUBLIC_URL}/suno-callback`;
    const envPath = path.join(process.cwd(), '.env');
    let envText = '';
    try {
      envText = fs.readFileSync(envPath, 'utf8');
    } catch {
      envText = '';
    }
    const lines = envText.split(/\n/);
    const kv = (k) => lines.findIndex((l) => l.trim().startsWith(`${k}=`));
    const upsert = (k, v) => {
      const i = kv(k);
      if (i >= 0) lines[i] = `${k}=${v}`;
      else lines.push(`${k}=${v}`);
    };
    upsert('EXPO_PUBLIC_SUNO_CALLBACK_URL', callbackUrl);
    // Update process.env immediately since we are not restarting
    process.env.EXPO_PUBLIC_SUNO_CALLBACK_URL = callbackUrl;

    // Only update API URL if it's not already set to localhost (preserve local dev optimization)
    const currentApiUrl = (process.env.EXPO_PUBLIC_API_URL || '').trim();
    if (!currentApiUrl.includes('localhost') && !currentApiUrl.includes('127.0.0.1') && !currentApiUrl.includes('192.168.') && !currentApiUrl.includes('172.')) {
       upsert('EXPO_PUBLIC_API_URL', publicUrl.replace(/\/$/, ''));
    }
    
    // Optionally set socket base if not disabled
    if (!DISABLE_SOCKET_URL_UPSERT) {
      upsert('EXPO_PUBLIC_SOCKET_URL', publicUrl.replace(/\/$/, ''));
    } else {
      console.log('[Tunnel] Skipping EXPO_PUBLIC_SOCKET_URL upsert (disabled by env)');
    }
    upsert('EXPO_PUBLIC_IS_DEV', 'true');
    const newText = lines.filter((l) => l.trim().length > 0).join('\n') + '\n';
    
    // Check if anything actually changed before writing/restarting
    let changed = false;
    try {
      const currentContent = fs.readFileSync(envPath, 'utf8');
      if (currentContent !== newText) {
        fs.writeFileSync(envPath, newText, 'utf8');
        changed = true;
        console.log('[Tunnel] .env updated');
      } else {
        console.log('[Tunnel] .env unchanged');
      }
    } catch {
      fs.writeFileSync(envPath, newText, 'utf8');
      changed = true;
    }

    console.log('[Tunnel] Active public URL:', callbackUrl);

    // Skip ngrok public /health checks to keep ngrok dashboard limited to /suno-callback only

    // Auto-restart backend to reload .env and provide clean state
    // ONLY restart if .env changed, otherwise we enter an infinite loop
    if (false && changed && !RESTARTING && String(process.env.NO_RESTART) !== '1') {
      RESTARTING = true;
      console.log('[Server] Restarting backend to reload env...');
      try {
        server.close(() => {
          try {
            const child = spawn(process.execPath, [path.join(process.cwd(), 'server', 'index.js')], {
              cwd: process.cwd(),
              stdio: 'ignore',
              detached: true,
            });
            child.unref();
          } catch (e) {
            console.warn('[Server] Failed to spawn restart', e?.message || e);
          }
          process.exit(0);
        });
      } catch (e) {
        console.warn('[Server] Restart error', e?.message || e);
      }
    }
  } catch (e) {
    console.warn('[Tunnel] Setup error', e?.message || e);
  }
  ENSURING_TUNNEL = false;
}
app.post('/proxy/suno/generate', async (req, res) => {
  try {
    const xf = req.headers['x-forwarded-for'];
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    console.log('[Server] /proxy/suno/generate', { ip, xf });

    const API_KEY = (process.env.SUNO_API_KEY || process.env.EXPO_PUBLIC_SUNO_API_KEY || '').trim();
    const API_BASE = (process.env.SUNO_API_URL || process.env.EXPO_PUBLIC_SUNO_BASE || 'https://api.api.box/api/v1').trim().replace(/\/+$/, '');
    const DRY_RUN = String(process.env.SUNO_DRY_RUN || '').trim() === '1';
    const FALLBACK_ON_ERROR = String(process.env.SUNO_FALLBACK_ON_ERROR || '').trim() === '1';
    const missingKey = API_KEY.includes('your-suno-api-key') || !API_KEY;
    const sanitizeBase = (url) => {
      const raw = String(url || '')
        .trim()
        .replace(/\)+$/, '')
        .replace(/\/+$/, '');
      if (!raw) return '';
      if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
      return `https://${raw}`;
    };
    const railwayBase = sanitizeBase(process.env.RAILWAY_STATIC_URL || process.env.APP_URL || '');
    const computedEnvCallback =
      String(process.env.EXPO_PUBLIC_SUNO_CALLBACK_URL || '').trim() ||
      (railwayBase ? `${railwayBase}/suno-callback` : '');
    try {
      console.log('[Server] Suno env snapshot', {
        hasSunoKey: !missingKey,
        apiBase: API_BASE,
        isDev: IS_DEV,
        dryRun: DRY_RUN,
        fallbackOnError: FALLBACK_ON_ERROR,
        envCallback: computedEnvCallback,
      });
    } catch {}
    const sanitizeCb = (url) =>
      String(url || '')
        .trim()
        .replace(/\)+$/, '')
        .replace(/\/+$/, '');
    const bodyCb = sanitizeCb(req.body?.callback_url || req.body?.callbackUrl || req.body?.callBackUrl || '');
    const envCb = sanitizeCb(computedEnvCallback);
    // Use CURRENT_PUBLIC_URL if available (most reliable), then env, then client
    const activeTunnelCb = CURRENT_PUBLIC_URL ? `${CURRENT_PUBLIC_URL}/suno-callback` : '';
    
    const isValidCb = (url) => {
      try {
        const u = new URL(url);
        const host = (u.hostname || '').toLowerCase();
        const isHttps = u.protocol === 'https:';
        const isHttp = u.protocol === 'http:';
        const isLocal = host.includes('localhost') || host === '127.0.0.1';
        // In development, allow localhost and both http/https for callbacks.
        // In production, require https and disallow localhost.
        if (IS_DEV) return isHttps || isHttp;
        return isHttps && !isLocal;
      } catch (e) {
        return false;
      }
    };
    // Prefer active tunnel callback when valid; otherwise env or client
    let CALLBACK_URL = isValidCb(activeTunnelCb) ? activeTunnelCb : (isValidCb(envCb) ? envCb : (isValidCb(bodyCb) ? bodyCb : ''));
    let callbackSource = isValidCb(activeTunnelCb) ? 'tunnel' : (isValidCb(envCb) ? 'env' : (isValidCb(bodyCb) ? 'client' : 'none'));

    if (!CALLBACK_URL && railwayBase) {
      CALLBACK_URL = `${railwayBase}/suno-callback`;
      callbackSource = 'railway';
    }
    if (CALLBACK_URL && !CALLBACK_URL.startsWith('http://') && !CALLBACK_URL.startsWith('https://')) {
      CALLBACK_URL = `https://${CALLBACK_URL.replace(/^\/+/, '')}`;
      callbackSource += '_fixed_proto';
    }
    if (!IS_DEV && CALLBACK_URL && CALLBACK_URL.startsWith('http://')) {
      CALLBACK_URL = `https://${CALLBACK_URL.slice('http://'.length)}`;
      callbackSource += '_fixed_https';
    }
    CALLBACK_URL = CALLBACK_URL.replace(/\)+$/, '');

    // FIX: Box AI / API Box specific callback requirement
    // If the URL contains 'serveousercontent.com', ensure it is HTTPS
    if (CALLBACK_URL.includes('serveousercontent.com') && CALLBACK_URL.startsWith('http:')) {
      CALLBACK_URL = CALLBACK_URL.replace('http:', 'https:');
      callbackSource += '_fixed_https';
    }

    if (missingKey) {
      console.warn('[Server] Suno API Key missing/placeholder', { DRY_RUN, FALLBACK_ON_ERROR });
      return res.status(500).json({
        error: 'Server misconfigured: SUNO_API_KEY missing',
        callbackSource,
        apiBase: API_BASE,
        hasKey: false,
      });
    }

    const requestedProfileId = String(req.body?.profile_id || req.body?.profileId || '').trim();
    if (requestedProfileId && CALLBACK_URL) {
      try {
        const u = new URL(CALLBACK_URL);
        u.searchParams.set('profile_id', requestedProfileId);
        CALLBACK_URL = u.toString().replace(/\/+$/, '');
        callbackSource += '_profile';
      } catch {}
    }

    const prompt = String(req.body?.prompt || '').trim();
    if (prompt.length > 500) {
      return res.status(400).json({ error: 'Prompt too long (max 500 characters).' });
    }
    const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
    // Send JSON payload — some providers strictly require JSON body
    const payload = {
      prompt,
      tags,
      customMode: false,
      instrumental: false,
      model: 'V3_5',
      image_style: 'minimal',
      callback_url: CALLBACK_URL,
      callbackUrl: CALLBACK_URL,
      callBackUrl: CALLBACK_URL,
      envCallback: CALLBACK_URL,
    };

    if (DRY_RUN) {
      return res.status(400).json({ error: 'SUNO_DRY_RUN is enabled. Disable it to generate real API Box tracks.' });
    }

    const url = `${API_BASE}/generate`;
    console.log('[Server] Forwarding Suno generate', { url, prompt, tags, customMode: payload.customMode, instrumental: payload.instrumental, callback: CALLBACK_URL, callbackSource });
    console.log('[Server] Callback URL compare', {
      isRailway: !!process.env.RAILWAY_STATIC_URL,
      railwayStaticRaw: String(process.env.RAILWAY_STATIC_URL || ''),
      appUrlRaw: String(process.env.APP_URL || ''),
      envCallbackRaw: String(process.env.EXPO_PUBLIC_SUNO_CALLBACK_URL || ''),
      callbackFinal: CALLBACK_URL,
      callbackSource,
    });
    console.log('[Server] Suno env mirror', {
      hasKey: !!String(process.env.SUNO_API_KEY || '').trim(),
      keyLen: String(process.env.SUNO_API_KEY || '').trim().length,
      apiBaseRaw: String(process.env.SUNO_API_URL || process.env.EXPO_PUBLIC_SUNO_BASE || ''),
      apiBaseFinal: API_BASE,
      apiBaseHadTrailingSlash: /\/\s*$/.test(String(process.env.SUNO_API_URL || process.env.EXPO_PUBLIC_SUNO_BASE || '')),
    });
    try { console.log('Sending Payload to Suno:', JSON.stringify(payload)); } catch {}
    
    const authCandidates = (() => {
      const k = String(API_KEY || '').trim();
      if (!k) return [];
      if (k.toLowerCase().startsWith('bearer ')) return [k, k.slice('bearer '.length)];
      return [`Bearer ${k}`, k];
    })();
    let authHeaderUsed = authCandidates[0] || '';
    let resp = null;
    let lastAuthErr = null;
    for (const authHeader of authCandidates) {
      try {
        authHeaderUsed = authHeader;
        console.log('[Server] Using Auth mode:', authHeader.toLowerCase().startsWith('bearer ') ? 'bearer' : 'raw');
        resp = await axios.post(url, payload, {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0',
          },
          httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
          timeout: 60_000,
        });
        break;
      } catch (e) {
        lastAuthErr = e;
        const st = e?.response?.status || 0;
        if (st === 401) continue;
        throw e;
      }
    }
    if (!resp) {
      const st = lastAuthErr?.response?.status || 401;
      const dat = lastAuthErr?.response?.data || null;
      console.warn('[Server] Suno auth failed', { status: st, data: dat && typeof dat === 'object' ? { code: dat.code, msg: dat.msg } : dat });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[Server] Suno API Response:', { status: resp.status, data: resp.data });
    try {
      console.log('Full Suno Response:', JSON.stringify(resp.data));
    } catch {}

    const taskId =
      resp?.data?.data?.taskId ||
      resp?.data?.data?.taskID ||
      resp?.data?.data?.task_id ||
      resp?.data?.data?.id ||
      resp?.data?.data?.task?.id ||
      resp?.data?.taskId ||
      resp?.data?.taskID ||
      resp?.data?.task_id ||
      resp?.data?.id ||
      null;
    if (taskId) {
      try {
        taskStartedAtMsById.set(String(taskId), Date.now());
      } catch {}
      try {
        const tid = String(taskId);
        if (!pollingByTaskId.has(tid)) {
          pollingByTaskId.set(tid, { startedAt: Date.now(), attempts: 0, profile_id: requestedProfileId || null, workerStarted: true });
          void pollSunoTaskFromEnv(tid, requestedProfileId || null);
        }
      } catch {}
      return res.status(200).json({ taskId, callback_url: CALLBACK_URL, callbackSource });
    }
    const dump = JSON.stringify(resp?.data || {}).toLowerCase();
    let msg = resp?.data?.msg || resp?.data?.error || 'Invalid response from Suno';
    console.warn('[Server] Suno API failed to return taskId', { msg, dump });
    if (dump.includes('insufficient credit')) {
      msg = 'Insufficient Credits';
    } else if (dump.includes('unauthorized')) {
      msg = 'Unauthorized';
    }
    let statusCode = 400;
    if (msg === 'Insufficient Credits') {
      statusCode = 429;
    } else if (msg === 'Unauthorized') {
      statusCode = 401;
    }
    return res.status(statusCode).json({ error: msg });
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Proxy error' };
    console.error('[Server] Suno Proxy Error Detail:', { 
      status, 
      data, 
      message: e.message,
      stack: e.stack?.split('\n').slice(0, 2).join('\n')
    });
    // No fallback tracks: only API Box/Suno audio is allowed
    let statusCode = status;
    let payload = data;
    try {
      const dump = JSON.stringify(data || {}).toLowerCase();
      let msg = null;
      if (dump.includes('insufficient credit')) {
        msg = 'Insufficient Credits';
        statusCode = 429;
      } else if (dump.includes('unauthorized')) {
        msg = 'Unauthorized';
        statusCode = 401;
      }
      if (msg) {
        payload = { error: msg };
      }
    } catch {}
    return res.status(statusCode).json(payload);
  }
});

// Suno official callback entry point
async function handleSunoCallback(req, res) {
  try {
    const xf = req.headers['x-forwarded-for'];
    const ua = req.headers['user-agent'];
    const ct = req.headers['content-type'];
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    console.log('[Server] RECEIVED CALLBACK FROM SUNO', { ip, xf, ct, ua });
    const profile_id = String(req.query?.profile_id || '').trim();
    const body = req.body || {};
    const code = body.code;
    const msg = body.msg;
    const data = body.data || {};
    // Accept multiple shapes: official Suno callback and simplified dev payload
    let callbackType = data.callbackType || data.callback_type || body.callbackType || body.callback_type || req.query.type;
    if (callbackType != null) {
      callbackType = String(callbackType).toLowerCase();
    }
    const task_id = data.task_id || data.taskId || body.task_id || body.taskId;
    const items = Array.isArray(data.data)
      ? data.data
      : Array.isArray(body.tracks)
      ? body.tracks
      : [];

    // Collect up to two valid HTTPS track URLs from payload (Suno-only hosts)
    const urls = [];
    const siphonJobs = [];
    let cover = null;
    let title = null;
    const normalizeCandidate = (v) => {
      if (typeof v !== 'string') return null;
      let s = v.trim();
      if (!s) return null;
      if (s.startsWith('//')) s = `https:${s}`;
      if (s.includes('removeai.ai') && !s.startsWith('http://') && !s.startsWith('https://')) {
        s = `https://${s.replace(/^\/+/, '')}`;
      }
      return s;
    };
    for (const it of items) {
      const rawCand =
        it?.audio_url ||
        it?.stream_audio_url ||
        it?.source_stream_audio_url ||
        it?.source_audio_url ||
        it?.streamAudioUrl ||
        it?.sourceStreamAudioUrl ||
        it?.sourceAudioUrl ||
        it?.cdn_url ||
        it?.cdnUrl ||
        it?.music_url ||
        it?.musicUrl ||
        it?.proxy_url ||
        it?.proxyUrl ||
        it?.audioUrl ||
        it?.streamUrl ||
        it?.stream_url ||
        it?.url ||
        it?.audio ||
        null;
      const cand = normalizeCandidate(rawCand);
      if (cand) {
        try {
          const u = new URL(cand);
          const host = u.hostname.toLowerCase();
          const isHttps = u.protocol === 'https:';
          const isHttp = u.protocol === 'http:';
          const isLocal = host.includes('localhost') || host === '127.0.0.1';
          if (((IS_DEV && (isHttps || isHttp)) || (!IS_DEV && isHttps)) && !isLocal && isAllowedSunoHost(host)) {
            if (cand.includes('removeai.ai')) urls.unshift(cand);
            else urls.push(cand);
          } else {
            console.log('[Server] Ignored non-Suno audio host', host);
          }
        } catch {}
      }
      const dl =
        it?.download_url ||
        it?.downloadUrl ||
        it?.mp3_url ||
        it?.mp3Url ||
        null;
      if (typeof dl === 'string' && dl.trim().length) {
        try {
          const u2 = new URL(dl);
          const host2 = u2.hostname.toLowerCase();
          const isHttps2 = u2.protocol === 'https:';
          const isHttp2 = u2.protocol === 'http:';
          const isLocal2 = host2.includes('localhost') || host2 === '127.0.0.1';
          if (((IS_DEV && (isHttps2 || isHttp2)) || (!IS_DEV && isHttps2)) && !isLocal2 && isAllowedSunoHost(host2)) {
            const trackKey = String(it?.id || it?.track_id || it?.trackId || it?.song_id || '').trim() || null;
            siphonJobs.push({ downloadUrl: dl.trim(), streamUrl: typeof cand === 'string' ? cand : null, trackKey });
          }
        } catch {}
      }
      if (!cover) cover = it?.cover || it?.cover_url || it?.image || it?.image_url || null;
      if (!title) title = it?.title || it?.song_title || it?.name || null;
      if (urls.length >= 2) break;
    }
    // Support simplified dev payloads with direct url/urls
    if (urls.length === 0) {
      const devUrls = Array.isArray(body.urls) ? body.urls : [];
      for (const cand of devUrls) {
        if (typeof cand !== 'string') continue;
        try {
          const u = new URL(cand);
          const host = u.hostname.toLowerCase();
          const isHttps = u.protocol === 'https:';
          const isHttp = u.protocol === 'http:';
          const isLocal = host.includes('localhost') || host === '127.0.0.1';
          if (((IS_DEV && (isHttps || isHttp)) || (!IS_DEV && isHttps)) && !isLocal && isAllowedSunoHost(host)) {
            urls.push(cand);
          }
        } catch {}
        if (urls.length >= 2) break;
      }
      if (urls.length === 0 && typeof body.url === 'string') {
        try {
          const u = new URL(body.url);
          const host = u.hostname.toLowerCase();
          const isHttps = u.protocol === 'https:';
          const isHttp = u.protocol === 'http:';
          const isLocal = host.includes('localhost') || host === '127.0.0.1';
          if (((IS_DEV && (isHttps || isHttp)) || (!IS_DEV && isHttps)) && !isLocal && isAllowedSunoHost(host)) {
            urls.push(body.url);
          }
        } catch {}
      }
    }
    const url = urls[0] || null;
    const audio_url = url || null;
    const startedAt = task_id ? taskStartedAtMsById.get(String(task_id)) : null;
    const elapsedMs = startedAt ? Date.now() - startedAt : null;

    try {
      const snapshot = {
        ts: new Date().toISOString(),
        ip,
        xf,
        ct,
        ua,
        code,
        msg,
        callbackType,
        task_id: task_id ? String(task_id) : null,
        items_len: Array.isArray(items) ? items.length : 0,
        urls,
        cover,
        title,
        elapsedMs,
      };
      recentCallbacks.push(snapshot);
      if (recentCallbacks.length > RECENT_CALLBACKS_MAX) recentCallbacks.splice(0, recentCallbacks.length - RECENT_CALLBACKS_MAX);
    } catch {}

    // Persist a lightweight callback trace for debugging
    try {
      const logLine = JSON.stringify({
        ts: new Date().toISOString(),
        callbackType,
        code,
        task_id,
        url,
        urls_len: urls.length,
        elapsedMs,
      }) + "\n";
      fs.appendFileSync(path.join(process.cwd(), 'server', 'callback.log'), logLine, 'utf8');
    } catch {}

    // Required log format for clarity
    console.log(`[Server] Callback received { callbackType: '${callbackType}' }`, { code, task_id, url, urls_len: urls.length, elapsedMs });
    if (Array.isArray(items) && items.length && urls.length === 0) {
      try {
        const k = Object.keys(items[0] || {}).slice(0, 25);
        console.log('[Server] Callback has items but no audio_url yet', { firstItemKeys: k });
      } catch {}
    }

    // Validate we have at least one good audio URL
    const isValidAudio = Array.isArray(urls) && urls.length > 0;
    const statusSignal =
      data?.status ||
      data?.state ||
      data?.task_status ||
      body?.status ||
      body?.state ||
      null;
    const statusUpper = String(statusSignal || '').toUpperCase();
    const isCompleteSignal =
      callbackType === 'complete' ||
      statusUpper === 'SUCCESS' ||
      statusUpper.endsWith('_SUCCESS') ||
      statusUpper.includes('COMPLETE');

    if (Number(code) === 200 && isCompleteSignal && !isValidAudio && Array.isArray(items) && items.length) {
      try { console.log('COMPLETE DATA DUMP:', JSON.stringify(items[0])); } catch {}
      try {
        const it = items[0] || {};
        const direct =
          normalizeCandidate(it?.audio_url) ||
          normalizeCandidate(it?.stream_audio_url) ||
          normalizeCandidate(it?.source_stream_audio_url) ||
          normalizeCandidate(it?.url) ||
          null;
        if (direct && direct.startsWith('http')) {
          urls.push(direct);
        }
      } catch {}
    }

    // Error handling
    if (code && [400, 401, 429, 500].includes(Number(code))) {
      if (profile_id) io.to(profile_id).emit('suno:error', { code, msg, task_id });
      else io.emit('suno:error', { code, msg, task_id });
      return res.status(200).json({ status: 'ok' });
    }

    if (Number(code) === 200 && isValidAudio) {
      const finalUrl = urls[0];
      if (!finalUrl || !finalUrl.startsWith('http')) {
        console.warn('[Server] Aborting emit: invalid final URL', finalUrl);
        return res.status(200).json({ status: 'error', msg: 'Invalid URL' });
      }

      const sig = urls.join('|');
      const prevSig = task_id ? lastSigByTask.get(String(task_id)) : null;
      const shouldEmit =
        !task_id ||
        callbackType === 'complete' ||
        !prevSig ||
        prevSig !== sig;

      if (task_id) lastSigByTask.set(String(task_id), sig);

      if (callbackType === 'complete' && task_id) {
        if (processed.has(task_id) && prevSig === sig) {
          console.log('[Server] Duplicate complete callback ignored', task_id);
          return res.status(200).json({ status: 'received', duplicate: true });
        }
        processed.add(task_id);
      }

      if (!shouldEmit) {
        console.log('[Server] Callback received (no change), skipping emit', { task_id, callbackType });
        return res.status(200).json({ status: 'received', duplicate: true });
      }

      console.log('[Server] Emitting suno:track (broadcast)', { task_id, callbackType, url: finalUrl });
      const baseTitle = typeof title === 'string' && title.trim().length ? title.trim() : 'New Track';
      const titles = urls.length >= 2 ? [baseTitle, `${baseTitle} 2`] : [baseTitle];
      if (profile_id) {
        try {
          for (let i = 0; i < Math.min(2, urls.length); i++) {
            const u = urls[i];
            if (typeof u !== 'string' || !u.startsWith('http')) continue;
            const row = {
              profile_id,
              audio_url: u,
              mp3_url: u,
              stream_url: u,
              title: titles[i] || baseTitle,
              image_url: typeof cover === 'string' ? cover : null,
            };
            const existing = await supabaseAdmin.from('tracks').select('id').eq('profile_id', profile_id).eq('audio_url', u).limit(1);
            const id = Array.isArray(existing?.data) && existing.data[0]?.id ? existing.data[0].id : null;
            if (id) {
              await supabaseAdmin.from('tracks').update(row).eq('id', id);
            } else {
              await supabaseAdmin.from('tracks').insert(row);
            }
          }
        } catch (e) {
          console.warn('[Server] tracks upsert from callback failed', e?.message || e);
        }
      }
      const payload = { url: audio_url, audio_url, urls, cover, title: baseTitle, titles, task_id, callbackType, items };
      if (profile_id) io.to(profile_id).emit('suno:track', payload);
      else io.emit('suno:track', payload);
      for (let i = 0; i < Math.min(2, siphonJobs.length); i++) {
        const job = siphonJobs[i];
        const suffix = i === 1 ? '_2' : '';
        const baseKey = job.trackKey || String(task_id || 'task');
        void siphonToSupabaseStorage({
          taskId: task_id ? String(task_id) : 'unknown',
          streamUrl: job.streamUrl,
          downloadUrl: job.downloadUrl,
          trackKey: `${baseKey}${suffix}`,
          desiredTitle: titles[i] || baseTitle,
        });
      }
      return res.status(200).json({ status: 'ok' });
    }

    if (Number(code) === 200 && !isValidAudio) {
      console.log('[Server] Callback received (no audio yet), waiting', { task_id, callbackType });
      if (task_id) {
        try {
          const tid = String(task_id);
          if (!taskStartedAtMsById.has(tid)) taskStartedAtMsById.set(tid, Date.now());
        } catch {}
        try { await pollSunoTaskFromEnv(String(task_id), profile_id || null); } catch {}
        if (isCompleteSignal) {
          try { await pollSunoTaskSafetyNet(String(task_id), profile_id || null); } catch {}
        }
      }
      if (profile_id) {
        try {
          io.to(profile_id).emit('suno:status', { task_id: task_id ? String(task_id) : null, status: 'still_cooking', message: 'Still Cooking…', callbackType });
        } catch {}
      }
      return res.status(200).json({ status: 'ok' });
    }

    if (profile_id) io.to(profile_id).emit('suno:error', { code: code || 400, msg: msg || 'Invalid callback payload or audio URL', task_id });
    else io.emit('suno:error', { code: code || 400, msg: msg || 'Invalid callback payload or audio URL', task_id });
    return res.status(200).json({ status: 'ok' });
  } catch (e) {
    console.error('[Server] Callback error', e);
    return res.status(200).json({ status: 'ok' });
  }
}

app.post('/suno-callback', handleSunoCallback);
app.post('/proxy/suno/callback', handleSunoCallback);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
  // Do not auto-generate env or start tunnels; respect provided ENV
  if (String(process.env.AUTO_TUNNEL) === '1') {
    console.log('[Tunnel] AUTO_TUNNEL=1 — ensuring public https tunnel...');
    ensureTunnelAndEnv().catch((e) => console.warn('[Tunnel] ensure error', e?.message || e));
  }
});
