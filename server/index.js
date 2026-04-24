const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
});

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
const SUPABASE_URL_ENV = String(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
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

function normalizeExternalUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^[`"'“”]+/, '').replace(/[`"'“”]+$/, '').trim();
  s = s.replace(/[`"'“”]/g, '').trim();
  s = s.replace(/[.)]+$/, '').trim();
  if (s.startsWith('//')) s = `https:${s}`;
  if (s.includes('removeai.ai') && !s.startsWith('http://') && !s.startsWith('https://')) {
    s = `https://${s.replace(/^\/+/, '')}`;
  }
  return s;
}

function isImageUrl(u) {
  if (typeof u !== 'string') return false;
  const low = u.toLowerCase();
  return low.endsWith('.jpg') || low.endsWith('.jpeg') || low.endsWith('.png') || low.endsWith('.gif') || low.endsWith('.webp');
}

function isPreferredMp3Url(u) {
  if (typeof u !== 'string') return false;
  const s = normalizeExternalUrl(u);
  if (!s) return false;
  const low = s.toLowerCase();
  if (!low.endsWith('.mp3')) return false;
  if (low.includes('removeai.ai')) return false;
  try {
    const host = new URL(s).hostname.toLowerCase();
    return host.includes('tempfile.aiquickdraw.com');
  } catch {
    return false;
  }
}

const verifiedMp3UrlCache = new Map();
async function verifyMp3Url(u) {
  const s = normalizeExternalUrl(u);
  if (!s) return false;
  if (verifiedMp3UrlCache.has(s)) return verifiedMp3UrlCache.get(s);
  if (!isPreferredMp3Url(s)) {
    verifiedMp3UrlCache.set(s, false);
    return false;
  }
  try {
    const resp = await axios.head(s, {
      maxRedirects: 0,
      timeout: 2500,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      validateStatus: (st) => st >= 200 && st < 400,
      headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0' },
    });
    const ct = String(resp?.headers?.['content-type'] || '').toLowerCase();
    const cl = Number(resp?.headers?.['content-length'] || 0) || 0;
    const ok = (ct.includes('audio') || ct.includes('mpeg')) && cl > 1000;
    verifiedMp3UrlCache.set(s, ok);
    return ok;
  } catch {
    verifiedMp3UrlCache.set(s, false);
    return false;
  }
}

function extractUrlsAllKeys(root) {
  const results = [];
  const visited = new Set();
  const stack = [{ value: root, path: '$', depth: 0 }];
  const maxDepth = 8;
  const maxNodes = 3000;
  const maxResults = 80;
  let nodes = 0;

  const addOne = (candidate, path) => {
    const s = normalizeExternalUrl(candidate);
    if (!s) return;
    if (!s.startsWith('http://') && !s.startsWith('https://')) return;
    const low = s.toLowerCase();
    if (!low.includes('http')) return;
    if (results.some((r) => r.url === s)) return;
    const idxMatch = String(path || '').match(/\[(\d+)\]/);
    const index = idxMatch ? Number(idxMatch[1]) : null;
    const isMp3 = low.endsWith('.mp3');
    const isStreamKey = String(path || '').toLowerCase().includes('stream');
    const isPrimaryStream = low.includes('musicfile.removeai.ai');
    const isImage = isImageUrl(low);
    results.push({ url: s, path: String(path || ''), index, isMp3, isStreamKey, isPrimaryStream });
  };
  const add = (raw, path) => {
    if (typeof raw !== 'string') return;
    const t = raw.trim();
    if (!t) return;
    if (t.includes('http://') || t.includes('https://')) {
      const matches = t.match(/https?:\/\/[^\s"'`<>]+/g) || [];
      if (matches.length) {
        for (const m of matches) addOne(m, path);
        return;
      }
    }
    addOne(t, path);
  };

  while (stack.length && nodes < maxNodes && results.length < maxResults) {
    const cur = stack.pop();
    if (!cur) break;
    const { value, path, depth } = cur;
    if (value == null) continue;
    if (depth > maxDepth) continue;
    if (typeof value === 'string') {
      add(value, path);
      continue;
    }
    if (typeof value !== 'object') continue;
    if (visited.has(value)) continue;
    visited.add(value);
    nodes += 1;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        stack.push({ value: value[i], path: `${path}[${i}]`, depth: depth + 1 });
      }
      continue;
    }
    const obj = value;
    const keys = Object.keys(obj);
    for (const k of keys) {
      const v = obj[k];
      const nextPath = `${path}.${k}`;
      if (typeof v === 'string') add(v, nextPath);
      else stack.push({ value: v, path: nextPath, depth: depth + 1 });
    }
  }
  return results;
}

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
  cors: { origin: true, methods: ['GET', 'POST', 'OPTIONS'], credentials: false },
  path: '/socket',
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true,
  allowRequest: (_req, cb) => cb(null, true),
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
const taskIdToProfileId = new Map();
// No device mapping; broadcast-only callbacks

async function upsertTracksForProfile(profile_id, urls, download_url, title, cover, task_id, source, durations, audio_urls) {
  const pidRaw = profile_id;
  // Simple extraction: if it looks like an ID, use it.
  const pid = (() => {
    if (!pidRaw) return null;
    if (typeof pidRaw === 'string') {
      const s = pidRaw.trim();
      if (!s || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return null;
      return s;
    }
    if (typeof pidRaw === 'object') {
      return pidRaw.id || pidRaw.profile_id || pidRaw.profileId || null;
    }
    return String(pidRaw);
  })();
  
  console.log('[Server] upsertTracksForProfile entry', { 
    pidRaw, 
    pid,
    task_id, 
    source, 
    urls_len: Array.isArray(urls) ? urls.length : 0,
    audio_urls_len: Array.isArray(audio_urls) ? audio_urls.length : 0
  });
  
  if (!pid) {
    console.warn('[Server] upsertTracksForProfile: No profile_id found, skipping DB save');
    return;
  }
  if (!Array.isArray(urls) || !urls.length) return;
  try {
    const baseTitle = typeof title === 'string' && title.trim().length ? title.trim() : 'New Track';
    const titles = urls.length >= 2 ? [baseTitle, `${baseTitle} 2`] : [baseTitle];
    const tid = task_id ? String(task_id).trim() : null;

    for (let i = 0; i < Math.min(2, urls.length); i++) {
      const u = urls[i];
      if (typeof u !== 'string' || !u.startsWith('http')) continue;

      // Build a clean payload with validated profile_id
      const cleanPid = (() => {
        let v = pid;
        if (!v) return null;
        if (typeof v === 'object') {
          // If it's an object, try to extract id or profile_id
          v = v.id || v.profile_id || v.profileId || null;
        }
        if (!v || String(v).toLowerCase() === 'undefined' || String(v).toLowerCase() === 'null' || String(v) === '[object Object]') return null;
        return String(v).trim();
      })();

      if (!cleanPid) {
        console.warn('[Server] Row skipped: invalid profile_id', { 
          original_pid: pid, 
          type: typeof pid,
          task_id: tid 
        });
        continue;
      }

      const row = {
        profile_id: cleanPid,
        title: titles[i] || baseTitle,
        image_url: typeof cover === 'string' ? cover : null,
        task_id: tid,
      };

      const dl = Array.isArray(download_url) ? download_url[i] : download_url;
      const dur = Array.isArray(durations) ? durations[i] : durations;
      const audio = Array.isArray(audio_urls) ? audio_urls[i] : null;

      const hasMp3 = typeof dl === 'string' && dl.toLowerCase().endsWith('.mp3') && !dl.toLowerCase().includes('removeai.ai') && isPreferredMp3Url(dl);
      const hasDur = typeof dur === 'number' && Number.isFinite(dur) && dur > 0;
      const isComplete = source === 'callback' || hasMp3 || hasDur;

      // IDENTIFY EXISTING ROW: prefer task_id + title, fallback to stream_url or audio_url
      let id = null;
      try {
        const base = supabaseAdmin.from('tracks').select('id, audio_url, stream_url, mp3_url, title, created_at').eq('profile_id', cleanPid);
        if (tid) {
          const byStream = await base.eq('task_id', tid).eq('stream_url', u).order('created_at', { ascending: false }).limit(1);
          if (Array.isArray(byStream?.data) && byStream.data[0]?.id) id = byStream.data[0].id;
          if (!id) {
            const byAudio = await base.eq('task_id', tid).eq('audio_url', u).order('created_at', { ascending: false }).limit(1);
            if (Array.isArray(byAudio?.data) && byAudio.data[0]?.id) id = byAudio.data[0].id;
          }
          if (!id) {
            const byTitle = await base.eq('task_id', tid).eq('title', titles[i]).order('created_at', { ascending: false }).limit(1);
            if (Array.isArray(byTitle?.data) && byTitle.data[0]?.id) id = byTitle.data[0].id;
          }
          if (!id) {
            const byTask = await base.eq('task_id', tid).order('created_at', { ascending: false }).limit(2);
            if (Array.isArray(byTask?.data) && byTask.data.length) {
              const pick = byTask.data[i] || byTask.data[0];
              if (pick?.id) id = pick.id;
            }
          }
        } else {
          const byStream = await base.eq('stream_url', u).order('created_at', { ascending: false }).limit(1);
          if (Array.isArray(byStream?.data) && byStream.data[0]?.id) id = byStream.data[0].id;
          if (!id) {
            const byAudio = await base.eq('audio_url', u).order('created_at', { ascending: false }).limit(1);
            if (Array.isArray(byAudio?.data) && byAudio.data[0]?.id) id = byAudio.data[0].id;
          }
        }
      } catch (err) {}

      if (isComplete) {
        // mp3_url: Save the finalized audio_url (the tempfile.aiquickdraw.com link).
        if (hasMp3) {
          if (await verifyMp3Url(dl)) row.mp3_url = normalizeExternalUrl(dl);
        }
        // audio_url: Save the source_audio_url (the cdn1.suno.ai link).
        if (audio && audio.startsWith('http')) {
          row.audio_url = audio;
        } else if (!id && !row.audio_url) {
          row.audio_url = row.mp3_url || u;
        }
        // Metadata Sync: Save the duration
        if (hasDur) row.duration = dur;
      } else {
        // stream_url: Save the stream_audio_url (the removeai.ai link).
        row.stream_url = u;
        // Keep audio_url in sync if not already set, using u as fallback
        if (!row.audio_url) row.audio_url = u;
      }

      console.log('[Server] Row payload prepared', { cleanPid, hasMp3, hasDur, isComplete, id: id || 'NEW', url: u, dl: dl || null });

      const tryUpsert = async (payload) => {
        // We use audio_url as the unique key in onConflict
        const { data, error, status } = await supabaseAdmin.from('tracks').upsert(payload, { onConflict: 'profile_id,audio_url' }).select('id');
        if (error) {
          console.error('[Server] Supabase UPSERT error:', { 
            code: error.code, 
            message: error.message, 
            details: error.details, 
            hint: error.hint,
            status,
            payload_keys: Object.keys(payload)
          });
          if (error.message?.includes('column')) {
            const colMatch = error.message.match(/column "([^"]+)"/);
            if (colMatch?.[1]) {
              const missingCol = colMatch[1];
              console.warn(`[Server] Column "${missingCol}" missing in upsert, retrying...`);
              const nextPayload = { ...payload };
              delete nextPayload[missingCol];
              return tryUpsert(nextPayload);
            }
          }
        }
        return error;
      };

      const tryInsert = async (payload) => {
        const { data, error, status } = await supabaseAdmin.from('tracks').insert(payload).select('id');
        if (error) {
          console.error('[Server] Supabase INSERT error:', { 
            code: error.code, 
            message: error.message, 
            details: error.details, 
            hint: error.hint,
            status,
            payload_keys: Object.keys(payload)
          });
          if (error.message?.includes('column')) {
            const colMatch = error.message.match(/column "([^"]+)"/);
            if (colMatch?.[1]) {
              const missingCol = colMatch[1];
              console.warn(`[Server] Column "${missingCol}" missing in insert, retrying...`);
              const nextPayload = { ...payload };
              delete nextPayload[missingCol];
              return tryInsert(nextPayload);
            }
          }
        }
        return error;
      };

      const tryUpdate = async (payload, rowId) => {
        const { data, error, status } = await supabaseAdmin.from('tracks').update(payload).eq('id', rowId).select('id');
        if (error) {
          console.error('[Server] Supabase UPDATE error:', { 
            code: error.code, 
            message: error.message, 
            details: error.details, 
            hint: error.hint,
            status,
            rowId,
            payload_keys: Object.keys(payload)
          });
          if (error.message?.includes('column')) {
            const colMatch = error.message.match(/column "([^"]+)"/);
            if (colMatch?.[1]) {
              const missingCol = colMatch[1];
              console.warn(`[Server] Column "${missingCol}" missing in update, retrying...`);
              const nextPayload = { ...payload };
              delete nextPayload[missingCol];
              return tryUpdate(nextPayload, rowId);
            }
          }
        }
        return error;
      };

      if (id) {
        const err = await tryUpdate(row, id);
        if (err) console.error('[Server] update failed final', err.message);
        else console.log('[Server] Track updated successfully', { id, task_id: tid });
      } else {
        if (!row.audio_url) {
          row.audio_url = u;
          row.stream_url = u;
        }
        const err = await tryUpsert(row);
        if (err) {
          const err2 = await tryInsert(row);
          if (err2) console.error('[Server] insert failed final', err2.message);
          else console.log('[Server] Track inserted successfully (fallback)', { task_id: tid });
        } else {
          console.log('[Server] Track upserted successfully', { task_id: tid });
        }
      }

      try {
        const dup = await supabaseAdmin.from('tracks').select('id').eq('profile_id', pid).eq('audio_url', u).order('created_at', { ascending: false }).limit(5);
        const ids = Array.isArray(dup?.data) ? dup.data.map((r) => r?.id).filter(Boolean) : [];
        if (ids.length > 1) {
          await supabaseAdmin.from('tracks').delete().in('id', ids.slice(1));
        }
      } catch {}
    }
  } catch (err) {
    console.error('[Server] upsertTracksForProfile error', err.message);
  }
}

async function pollSunoTaskFromEnv(taskId, profile_id) {
  const tid = String(taskId || '').trim();
  if (!tid) return;
  if (processed.has(tid)) return;
  const existing = pollingByTaskId.get(tid);
  if (existing?.workerStarted) return;
  const effectiveProfileId = profile_id || (taskIdToProfileId.has(tid) ? taskIdToProfileId.get(tid) : null);
  if (existing) {
    existing.workerStarted = true;
    if (!existing.profile_id && effectiveProfileId) existing.profile_id = effectiveProfileId;
  } else {
    pollingByTaskId.set(tid, { startedAt: Date.now(), attempts: 0, profile_id: effectiveProfileId || null, workerStarted: true });
  }

  setTimeout(async () => {
    try {
      const API_KEY = String(process.env.SUNO_API_KEY || process.env.EXPO_PUBLIC_SUNO_API_KEY || '').trim();
      const API_BASE = String(process.env.SUNO_API_URL || process.env.EXPO_PUBLIC_SUNO_BASE || 'https://api.api.box/api/v1').trim().replace(/\/+$/, '');
      const authHeader = API_KEY.toLowerCase().startsWith('bearer ') ? API_KEY : `Bearer ${API_KEY}`;
      const maxAttempts = 240;
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
        const startedAtMs = taskStartedAtMsById.get(tid) || state.startedAt || Date.now();
        const elapsedMs = Date.now() - startedAtMs;
        const intervalMs = elapsedMs < 10_000 ? 500 : elapsedMs < 30_000 ? 800 : 1500;
        try { console.log('POLLING STATUS FOR:', tid, { attempt, elapsedMs, intervalMs }); } catch {}
        const recordUrl = `${API_BASE}/generate/record-info?taskId=${encodeURIComponent(tid)}&_ts=${Date.now()}`;
        let recordResp = null;
        try {
          recordResp = await axios.get(recordUrl, {
            headers: {
              Authorization: authHeader,
              Accept: 'application/json, text/plain, */*',
              'User-Agent': 'Mozilla/5.0',
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
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
        if (statusStr && statusStr !== 'SUCCESS') {
          try {
            const dbgArr =
              (Array.isArray(d?.data) ? d.data : null) ||
              (Array.isArray(d?.response?.data) ? d.response.data : null) ||
              (Array.isArray(d?.response) ? d.response : null) ||
              (Array.isArray(payload?.data) ? payload.data : null) ||
              null;
            if (dbgArr && dbgArr[0]) {
              console.log('DEBUG FULL DATA:', JSON.stringify(dbgArr[0]));
            }
          } catch {}
        }
        if (room && statusStr && statusStr !== 'SUCCESS') {
          try {
            io.to(room).emit('suno:status', { task_id: tid, status: statusStr, message: statusStr === 'TEXT_SUCCESS' ? 'Still Cooking…' : 'Finalizing track…' });
          } catch {}
        }
        const response = d?.response || {};
        const candidates = [];
        const downloadCandidates = [];
        const metaCandidates = [];
        const add = (v) => {
          const s = normalizeExternalUrl(v);
          if (!s) return;
          if (s.includes('musicfile.removeai.ai')) candidates.unshift(s);
          else candidates.push(s);
        };
        const addDownload = (v) => {
          const s = normalizeExternalUrl(v);
          if (!s || (!s.startsWith('http://') && !s.startsWith('https://'))) return;
          const low = s.toLowerCase();
          if (low.includes('aiquickdraw.com') || low.endsWith('.mp3') || low.includes('cdn1.suno.ai')) downloadCandidates.push(s);
        };
        const listA = Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : [];
        const listB = Array.isArray(response?.sunoData) ? response.sunoData : [];
        const listC = Array.isArray(d?.data) ? d.data : [];
        const listD = Array.isArray(payload?.data) ? payload.data : [];
        const allItems = [...listA, ...listB, ...listC, ...listD].filter(Boolean);
        add(d?.stream_audio_url);
        add(d?.source_stream_audio_url);
        add(d?.audio_url);
        add(d?.url);
        add(payload?.stream_audio_url);
        add(payload?.audio_url);
        for (const it of allItems) {
          metaCandidates.push(it);
          add(it?.stream_audio_url);
          add(it?.streamAudioUrl);
          add(it?.source_stream_audio_url);
          add(it?.sourceStreamAudioUrl);
          add(it?.audio_url);
          add(it?.audioUrl);
          add(it?.source_audio_url);
          add(it?.sourceAudioUrl);
          add(it?.cdn_url);
          add(it?.cdnUrl);
          add(it?.music_url);
          add(it?.musicUrl);
          add(it?.proxy_url);
          add(it?.proxyUrl);
          add(it?.url);
          addDownload(it?.audio_url);
          addDownload(it?.audioUrl);
          addDownload(it?.source_audio_url);
          addDownload(it?.sourceAudioUrl);
          addDownload(it?.download_url);
          addDownload(it?.downloadUrl);
          addDownload(it?.mp3_url);
          addDownload(it?.mp3Url);
        }
        const pickedTitle = (() => {
          try {
            const t = metaCandidates?.[0]?.title || metaCandidates?.[0]?.song_title || metaCandidates?.[0]?.name || null;
            if (typeof t === 'string' && t.trim().length) return t.trim();
          } catch {}
          return null;
        })();
        const pickedCover = (() => {
          try {
            const c = metaCandidates?.[0]?.cover || metaCandidates?.[0]?.cover_url || metaCandidates?.[0]?.image || metaCandidates?.[0]?.image_url || metaCandidates?.[0]?.imageUrl || null;
            const cc = normalizeExternalUrl(c);
            if (cc && cc.startsWith('http')) return cc;
          } catch {}
          return null;
        })();
        const baseTitle = pickedTitle || 'New Track';
        const streamByIndex = [];
        const mp3ByIndex = [];
        try {
          const respArr = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : null;
          if (respArr && respArr[0]) {
            const sA = normalizeExternalUrl(respArr?.[0]?.stream_audio_url || respArr?.[0]?.streamAudioUrl || null);
            const sB = normalizeExternalUrl(respArr?.[1]?.stream_audio_url || respArr?.[1]?.streamAudioUrl || null);
            if (sA && sA.startsWith('http') && !sA.toLowerCase().endsWith('.mp3')) streamByIndex[0] = sA;
            if (sB && sB.startsWith('http') && !sB.toLowerCase().endsWith('.mp3')) streamByIndex[1] = sB;
          }
        } catch {}
        const allKeyUrls = extractUrlsAllKeys(payload);
        for (const entry of allKeyUrls) {
          try {
            const u = new URL(entry.url);
            const host = u.hostname.toLowerCase();
            const isHttps = u.protocol === 'https:';
            const isHttp = u.protocol === 'http:';
            const isLocal = host.includes('localhost') || host === '127.0.0.1';
            if (!(((IS_DEV && (isHttps || isHttp)) || (!IS_DEV && isHttps)) && !isLocal && isAllowedSunoHost(host))) continue;
          } catch {
            continue;
          }
          const idx = typeof entry.index === 'number' && entry.index >= 0 && entry.index <= 1 ? entry.index : null;
          if (entry.isMp3) {
            if (idx != null) {
              if (!mp3ByIndex[idx] && isPreferredMp3Url(entry.url)) mp3ByIndex[idx] = entry.url;
            } else {
              if (!mp3ByIndex[0] && isPreferredMp3Url(entry.url)) mp3ByIndex[0] = entry.url;
              else if (!mp3ByIndex[1] && isPreferredMp3Url(entry.url)) mp3ByIndex[1] = entry.url;
            }
            continue;
          }
          const low = String(entry.url || '').toLowerCase();
          if (isImageUrl(low)) continue;
          if (entry.isPrimaryStream || entry.isStreamKey || (low.includes('removeai.ai') && !low.endsWith('.mp3'))) {
            if (idx != null) {
              if (!streamByIndex[idx] || entry.isPrimaryStream) streamByIndex[idx] = entry.url;
            } else {
              if (!streamByIndex[0]) streamByIndex[0] = entry.url;
              else if (!streamByIndex[1]) streamByIndex[1] = entry.url;
            }
          }
        }
        const s0 = typeof streamByIndex[0] === 'string' ? streamByIndex[0] : null;
        const s1 = typeof streamByIndex[1] === 'string' ? streamByIndex[1] : null;
        const urls = [s0, s1].filter((x) => typeof x === 'string');
        const forcedUrlsLen = urls.length;
        const onlySecond = !s0 && !!s1;
        console.log('[Server] Poll record-info', { taskId: tid, attempt, status: statusStr || status, urls_len: forcedUrlsLen, elapsedMs });

        if (statusStr === 'SUCCESS') {
          const mp3s = [mp3ByIndex[0] || null, mp3ByIndex[1] || null];
          const audios = []; // source_audio_url backup
          const streamUrls = [streamByIndex[0] || null, streamByIndex[1] || null];
          const durs = [];
          try {
            const respArr = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : null;
            if (respArr) {
              if (respArr[0]?.duration) durs[0] = Number(respArr[0].duration);
              if (respArr[1]?.duration) durs[1] = Number(respArr[1].duration);
              // Extract source_audio_url (cdn1.suno.ai)
              audios[0] = normalizeExternalUrl(respArr[0]?.source_audio_url || respArr[0]?.sourceAudioUrl);
              audios[1] = normalizeExternalUrl(respArr[1]?.source_audio_url || respArr[1]?.sourceAudioUrl);
            }
          } catch {}

          try {
            const sig = urls.join('|');
            const prevSig = lastSigByTask.get(tid) || null;
            if (!prevSig || prevSig !== sig) {
              lastSigByTask.set(tid, sig);
              const titles = onlySecond ? [`${baseTitle} 2`] : (urls.length >= 2 ? [baseTitle, `${baseTitle} 2`] : [baseTitle]);
              const out = { url: urls[0], audio_url: audios[0] || urls[0], stream_url: urls[0], download_url: mp3s[0], urls, cover: pickedCover, title: titles[0], titles, task_id: tid, callbackType: 'poll', items: metaCandidates.slice(0, 2) };
              if (room) {
                try { io.to(room).emit('suno:status', { task_id: tid, status: 'success', message: 'Ready' }); } catch {}
                try { io.to(room).emit('suno:track', out); } catch {}
              } else {
                io.emit('suno:track', out);
              }
            }
          } catch {}
          try { await upsertTracksForProfile(room, streamUrls.filter(Boolean), mp3s, onlySecond ? `${baseTitle} 2` : baseTitle, pickedCover, tid, 'poll', durs, audios); } catch {}
          pollingByTaskId.delete(tid);
          return;
        }

        if (urls.length) {
          const sig = urls.join('|');
          const prevSig = lastSigByTask.get(tid) || null;
          if (!prevSig || prevSig !== sig) {
            lastSigByTask.set(tid, sig);
            const titles = onlySecond ? [`${baseTitle} 2`] : (urls.length >= 2 ? [baseTitle, `${baseTitle} 2`] : [baseTitle]);
            console.log('EARLY CATCH: Found stream URL before completion:', { urls, elapsedMs });
            const out = { url: urls[0], audio_url: urls[0], stream_url: urls[0], download_url: null, urls, cover: pickedCover, title: titles[0], titles, task_id: tid, callbackType: 'poll_early', items: metaCandidates.slice(0, 2) };
            if (room) {
              try { io.to(room).emit('suno:status', { task_id: tid, status: 'success', message: 'Ready' }); } catch {}
              try { io.to(room).emit('suno:track', out); } catch {}
              try { await upsertTracksForProfile(room, urls, null, onlySecond ? `${baseTitle} 2` : baseTitle, pickedCover, tid, 'poll_early', null, null); } catch {}
            } else {
              io.emit('suno:track', out);
            }
          }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
    } catch (e) {
      console.warn('[Server] Poll worker crashed', e?.message || e);
      pollingByTaskId.delete(tid);
    }
  }, 0);
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
      const maxAttempts = 150;
      const intervalMs = 2000;

      const normalizeCandidate = (v) => normalizeExternalUrl(v);

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
        const downloadCandidates = [];
        const metaCandidates = [];
        const add = (v) => {
          const s = normalizeCandidate(v);
          if (!s) return;
          if (s.includes('musicfile.removeai.ai')) candidates.unshift(s);
          else if (s.includes('removeai.ai')) candidates.unshift(s);
          else candidates.push(s);
        };
        const addDownload = (v) => {
          const s = normalizeCandidate(v);
          if (!s || (!s.startsWith('http://') && !s.startsWith('https://'))) return;
          const low = s.toLowerCase();
          if (low.includes('aiquickdraw.com') || low.endsWith('.mp3')) downloadCandidates.push(s);
        };

        const listA = Array.isArray(response?.data) ? response.data : [];
        const listB = Array.isArray(response?.sunoData) ? response.sunoData : [];
        for (const it of [...listA, ...listB]) {
          metaCandidates.push(it);
          add(it?.stream_audio_url);
          add(it?.source_stream_audio_url);
          add(it?.audio_url);
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
          addDownload(it?.download_url);
          addDownload(it?.downloadUrl);
          addDownload(it?.mp3_url);
          addDownload(it?.mp3Url);
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
            await upsertTracksForProfile(room || profile_id || null, urls, null, null, null, tid, 'safetynet', null);
          } catch {}
          if (room) {
            try { io.to(room).emit('suno:status', { task_id: tid, status: 'success', message: 'Ready' }); } catch {}
          }
          const out = { url: urls[0], audio_url: urls[0], stream_url: urls[0], download_url: null, urls, cover: null, title: 'New Track', titles: urls.length >= 2 ? ['New Track', 'New Track 2'] : ['New Track'], task_id: tid, callbackType: 'safetynet', items: metaCandidates.slice(0, 2) };
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
  }, 2000);
}

io.on('connection', (socket) => {
  try {
    try {
      const origin = socket?.handshake?.headers?.origin || null;
      const ua = socket?.handshake?.headers?.['user-agent'] || null;
      console.log('[Server] Socket handshake', { id: socket.id, origin, ua });
    } catch {}
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
      const pid = typeof payload === 'string' ? payload.trim() : String(payload?.profile_id || payload?.profileId || '').trim();
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
const SUPABASE_URL = (SUPABASE_URL_ENV || 'https://wiekabbfmpmxjhiwyfzt.supabase.co').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(SERVICE_KEY || '').trim();

// Diagnostic endpoint to verify Supabase connectivity
app.get('/debug/supabase-test', async (req, res) => {
  try {
    const testId = `test_${Date.now()}`;
    console.log('[Debug] Testing Supabase write...', { url: SUPABASE_URL, keyLen: SUPABASE_SERVICE_ROLE_KEY.length });
    
    const row = {
      profile_id: 'debug_test_user',
      audio_url: `https://test.com/${testId}.mp3`,
      title: 'Debug Test Track',
      mood: 'Debug',
    };

    const { data, error, status } = await supabaseAdmin.from('tracks').insert(row).select('id');
    
    if (error) {
      console.error('[Debug] Supabase test failed:', error);
      return res.status(500).json({ 
        ok: false, 
        error: error.message, 
        details: error,
        status,
        config: { host: new URL(SUPABASE_URL).host, keyLen: SUPABASE_SERVICE_ROLE_KEY.length }
      });
    }

    console.log('[Debug] Supabase test success:', data);
    return res.json({ 
      ok: true, 
      message: 'Successfully inserted test row into "tracks" table',
      data,
      status 
    });
  } catch (err) {
    console.error('[Debug] Supabase test exception:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
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

// DB Cleanup: One-time cleanup for messy mp3_url data
(async () => {
  try {
    const url = `${SUPABASE_URL}/rest/v1/tracks?mp3_url=like.*removeai.ai*`;
    const resp = await axios.patch(url, { mp3_url: null }, { headers: supabaseHeaders(), timeout: 15000 });
    console.log('[Server] DB Cleanup success: removeai.ai links removed from mp3_url', resp.status);
  } catch (e) {
    const status = e?.response?.status || 0;
    // Silently ignore 404/400 if column doesn't exist or table empty
    if (status !== 404 && status !== 400) {
      console.warn('[Server] DB Cleanup skipped or failed', status || e.message);
    }
  }
})();
try {
  const h = supabaseHeaders();
  console.log('[Server] Supabase header check', { hasApikey: !!h.apikey, hasAuthorization: String(h.Authorization || '').startsWith('Bearer ') });
} catch {}

const siphonInFlight = new Set();
let bucketEnsured = false;
async function siphonToSupabaseStorage({ taskId, streamUrl, downloadUrl, trackKey, desiredTitle }) {
  if (String(process.env.ENABLE_SIPHON || '').trim() !== '1') return null;
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
      const patch = { mp3_url: publicUrl };
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

    const isValidPid = (v) => {
      if (!v || v === 'undefined' || v === 'null' || String(v).toLowerCase() === 'undefined') return false;
      return typeof v === 'string' && v.trim().length > 0;
    };

    const normalized = rows
      .map((row) => ({
        profile_id: row.profile_id,
        audio_url: row.audio_url,
        title: row.title ?? null,
        mood: row.mood ?? null,
        genres: Array.isArray(row.genres) ? row.genres.filter(Boolean).join(',') : (row.genres || null),
        liked: typeof row.liked === 'boolean' ? row.liked : false,
        stream_url: row.stream_url ?? null,
        mp3_url: row.mp3_url ?? null,
        image_url: row.image_url ?? null,
      }))
      .filter((r) => isValidPid(r.profile_id) && r.audio_url && r.audio_url.startsWith('http'));

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

    console.log('[Server] bulk-insert: normalized unique rows', { count: unique.length, pids: [...new Set(unique.map(u => u.profile_id))] });

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
        if (already) {
          console.log('[Server] bulk-insert: skipping existing track', { pid, au });
        }
      } catch (err) {
        console.warn('[Server] bulk-insert: exists check failed', err.message);
        already = false;
      }
      if (!already) payload.push(r);
    }

    if (!payload.length) {
      console.warn('[Server] bulk-insert: no valid rows after dedupe', { original_count: rows.length, normalized_count: normalized.length });
      return res.status(200).json([]);
    }
    console.log('[Server] bulk-insert: inserting rows', { count: payload.length, audio_urls: payload.map((r) => r.audio_url).slice(0, 3) });
    const url = `${SUPABASE_URL}/rest/v1/tracks`;
    const resp = await axios.post(url, payload, { headers: supabaseHeaders(), timeout: 12000 });
    console.log('[Server] bulk-insert: Supabase response', { 
      status: resp.status, 
      count: Array.isArray(resp.data) ? resp.data.length : 'N/A' 
    });
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
    
    const select = encodeURIComponent('id,audio_url,title,mood,genres,liked,created_at,image_url,stream_url,mp3_url,duration');
    const url = `${SUPABASE_URL}/rest/v1/tracks?profile_id=eq.${encodeURIComponent(profile_id)}&select=${select}&order=created_at.desc`;
    const resp = await axios.get(url, { headers: supabaseHeaders(), timeout: 12000 });

    if (logCriticalIfSupabaseHtml(resp.data, 'GET /supabase/tracks/by-profile')) {
      return res.status(500).json({ error: 'Supabase base URL misconfigured' });
    }
    const rows = Array.isArray(resp.data) ? resp.data : [];
    const seen = new Set();
    const unique = [];
    for (const r of rows) {
      const au = typeof r?.audio_url === 'string' ? r.audio_url.trim() : '';
      const su = typeof r?.stream_url === 'string' ? r.stream_url.trim() : '';
      const key = au || su;
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
    }
    return res.status(resp.status || 200).json(unique);
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
    
    // Universal Identifier: must use database UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(track_id);
    if (!isUuid) {
      console.warn('[Server] update-liked received non-UUID:', track_id);
      return res.status(400).json({ error: 'Valid database UUID required' });
    }

    const url = `${SUPABASE_URL}/rest/v1/tracks?id=eq.${encodeURIComponent(track_id)}`;
    const resp = await axios.patch(url, { liked }, { headers: supabaseHeaders(), timeout: 10000 });
    return res.status(resp.status || 200).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase tracks update liked error' };
    console.error('[Server] Supabase tracks update liked error', { status, data });
    return res.status(status).json(data);
  }
});

app.get('/supabase/tracks/favorites/by-profile', async (req, res) => {
  try {
    const profile_id = String(req.query.profile_id || '').trim();
    if (!profile_id) return res.status(400).json({ error: 'Missing profile_id' });
    
    const select = encodeURIComponent('id,audio_url,title,mood,genres,liked,created_at,image_url,stream_url,mp3_url,duration');
    const url = `${SUPABASE_URL}/rest/v1/tracks?profile_id=eq.${encodeURIComponent(profile_id)}&select=${select}&liked=eq.true&order=created_at.desc`;
    const resp = await axios.get(url, { headers: supabaseHeaders(), timeout: 12000 });
    return res.status(resp.status || 200).json(resp.data);
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data || { error: 'Supabase favorites list error' };
    console.error('[Server] Supabase favorites list error', { status, data });
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
        .replace(/^[`"'“”]+/, '')
        .replace(/[`"'“”]+$/, '')
        .trim()
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
        .replace(/^[`"'“”]+/, '')
        .replace(/[`"'“”]+$/, '')
        .trim()
        .replace(/\/+$/, '');
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
    const forcedRailwayCallback = normalizeExternalUrl('https://insurance-production-6074.up.railway.app/suno-callback');

    // Hard override: never trust client callback_url in production (Serveo/ngrok/etc)
    let CALLBACK_URL = '';
    let callbackSource = 'forced';
    if (!IS_DEV) {
      CALLBACK_URL = forcedRailwayCallback || (railwayBase ? `${railwayBase}/suno-callback` : envCb);
      callbackSource = forcedRailwayCallback ? 'forced_railway' : (railwayBase ? 'railway' : 'env');
    } else {
      // In dev keep flexibility
      CALLBACK_URL = isValidCb(activeTunnelCb) ? activeTunnelCb : (isValidCb(envCb) ? envCb : '');
      callbackSource = isValidCb(activeTunnelCb) ? 'tunnel' : (isValidCb(envCb) ? 'env' : 'none');
    }

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

    const requestedProfileId = (() => {
      const val = req.body?.profile_id || req.body?.profileId || req.query?.profile_id || '';
      if (!val || String(val).toLowerCase() === 'undefined' || String(val).toLowerCase() === 'null') return null;
      return String(val).trim();
    })();

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
    const instrumental = (() => {
      const v = req.body?.instrumental ?? req.body?.isInstrumental;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === 'no') return false;
      }
      const mode = String(req.body?.vocalMode || req.body?.mode || '').trim().toLowerCase();
      if (mode === 'instrumental') return true;
      if (mode === 'lyrics') return false;
      const p = prompt.toLowerCase();
      if (p.includes('instrumental') || p.includes('no vocals') || p.includes('no vocal')) return true;
      if (p.includes('lyrics') || p.includes('with vocals')) return false;
      return false;
    })();
    // Send JSON payload — some providers strictly require JSON body
    const payloadBase = {
      prompt,
      tags,
      customMode: false,
      instrumental,
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
    console.log('[Server] Forwarding Suno generate', { url, prompt, tags, customMode: payloadBase.customMode, instrumental: payloadBase.instrumental, callback: CALLBACK_URL, callbackSource });
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
    const modelCandidates = ['V3_5', 'v3.5', 'V3_0'];
    const isModelError = (data) => {
      try {
        const d = JSON.stringify(data || {}).toLowerCase();
        return d.includes('model') && (d.includes('error') || d.includes('invalid') || d.includes('not support'));
      } catch {
        return false;
      }
    };
    
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
        for (const model of modelCandidates) {
          const payload = { ...payloadBase, model };
          try { console.log('Sending Payload to Suno:', JSON.stringify(payload)); } catch {}
          try {
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
            const dat = e?.response?.data || null;
            if (st === 400) {
              try { console.log('[Server] Suno 400 payload dump:', JSON.stringify(payload)); } catch {}
              try { console.warn('[Server] Suno 400 response:', dat); } catch {}
              if (isModelError(dat) && model !== 'V3_0') {
                console.warn('[Server] Model error, retrying with next model', { modelTried: model });
                continue;
              }
            }
            if (st === 401) break;
            throw e;
          }
        }
        if (resp) break;
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

    console.log('[Server] Suno API Response:', { status: resp.status, data: resp.data, apiBase: API_BASE, keyLen: API_KEY.length });
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
        const tid = String(taskId);
        taskStartedAtMsById.set(tid, Date.now());
        if (requestedProfileId) {
          taskIdToProfileId.set(tid, requestedProfileId);
          console.log('[Server] task_id mapping stored:', { tid, requestedProfileId });
        }
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
    const isHutool = String(ua || '').toLowerCase().includes('hutool');
    console.log('[Server] RECEIVED CALLBACK FROM SUNO', { ip, xf, ct, ua });
    try {
      const raw = JSON.stringify(req.body || {});
      console.log('[Server] CALLBACK RAW BODY:', raw.length > 20000 ? raw.slice(0, 20000) : raw);
    } catch {}
    if (isHutool) {
      try { console.log('[Server] Hutool callback UA detected; forcing non-blocking 200 flow'); } catch {}
    }
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
    
    const profile_id = (() => {
      const val = req.query?.profile_id || req.body?.profile_id || req.body?.profileId || '';
      if (val && val !== 'undefined' && val !== 'null' && String(val).toLowerCase() !== 'undefined') return String(val).trim();
      // Fallback: check our memory map
      if (task_id && taskIdToProfileId.has(String(task_id))) {
        const mapped = taskIdToProfileId.get(String(task_id));
        console.log('[Server] profile_id recovered from mapping:', { task_id, profile_id: mapped });
        return mapped;
      }
      return null;
    })();

    const finalProfileId = (() => {
      let v = profile_id;
      if (!v) return null;
      if (typeof v === 'object') {
        v = v.id || v.profile_id || v.profileId || null;
      }
      const s = String(v).trim();
      if (!s || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null' || s === '[object Object]') return null;
      return s;
    })();

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
    const normalizeCandidate = (v) => normalizeExternalUrl(v);
    for (const it of items) {
      const rawCand =
        it?.stream_audio_url ||
        it?.source_stream_audio_url ||
        it?.audio_url ||
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
    if (Number(code) === 200 && (callbackType === 'text' || callbackType === 'first') && urls.length === 0 && Array.isArray(items) && items.length) {
      try {
        const pickStream = (it) =>
          normalizeCandidate(it?.stream_audio_url) ||
          normalizeCandidate(it?.streamAudioUrl) ||
          normalizeCandidate(it?.source_stream_audio_url) ||
          normalizeCandidate(it?.sourceStreamAudioUrl) ||
          null;
        const s0 = pickStream(items[0] || null);
        const s1 = pickStream(items[1] || null);
        const found = [];
        for (const s of [s0, s1]) {
          if (typeof s !== 'string' || !s.startsWith('http')) continue;
          const low = s.toLowerCase();
          if (low.endsWith('.mp3')) continue;
          if (isImageUrl(low)) continue;
          if (low.includes('musicfile.removeai.ai')) found.unshift(s);
          else found.push(s);
        }
        if (found.length) {
          const baseTitle =
            (typeof items?.[0]?.title === 'string' && items[0].title.trim().length ? items[0].title.trim() : null) ||
            (typeof title === 'string' && title.trim().length ? title.trim() : null) ||
            'New Track';
          const titles = found.length >= 2 ? [baseTitle, `${baseTitle} 2`] : [baseTitle];
          console.log('[Server] Found stream in TEXT callback - Emitting now!', { task_id, urls_len: found.length, elapsedMs });
          const payload = { url: found[0], audio_url: found[0], stream_url: found[0], download_url: null, urls: found.slice(0, 2), cover, title: titles[0], titles, task_id, callbackType: `${callbackType}_early`, items };
          if (finalProfileId) {
            try { io.to(finalProfileId).emit('suno:status', { task_id: task_id ? String(task_id) : null, status: 'success', message: 'Ready' }); } catch {}
            try { io.to(finalProfileId).emit('suno:track', payload); } catch {}
            try { await upsertTracksForProfile(finalProfileId, found.slice(0, 2), null, baseTitle, cover, task_id ? String(task_id) : null, 'callback_text', null, null); } catch {}
          } else {
            io.emit('suno:track', payload);
          }
          return res.status(200).json({ status: 'ok' });
        }
      } catch {}
    }
    if (Array.isArray(items) && items.length && urls.length === 0) {
      try {
        const k = Object.keys(items[0] || {}).slice(0, 25);
        console.log('[Server] Callback has items but no audio_url yet', { firstItemKeys: k });
      } catch {}
    }
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
    if (isCompleteSignal && urls.length === 0) {
      try { console.log('COMPLETE DATA DUMP:', JSON.stringify(req.body?.data?.[0] || req.body?.data?.data?.[0] || items?.[0] || null)); } catch {}
      try {
        const direct0 =
          req.body?.data?.[0]?.stream_audio_url ||
          req.body?.data?.data?.[0]?.stream_audio_url ||
          req.body?.data?.[0]?.source_stream_audio_url ||
          req.body?.data?.data?.[0]?.source_stream_audio_url ||
          req.body?.data?.[0]?.audio_url ||
          req.body?.data?.data?.[0]?.audio_url ||
          items?.[0]?.stream_audio_url ||
          items?.[0]?.source_stream_audio_url ||
          items?.[0]?.audio_url ||
          null;
        const normalized0 = normalizeCandidate(direct0);
        if (normalized0 && normalized0.startsWith('http')) {
          if (normalized0.includes('musicfile.removeai.ai')) urls.unshift(normalized0);
          else urls.push(normalized0);
          console.log('[Server] Override urls_len=0 with direct audio_url', { task_id, url: normalized0 });
        }
      } catch {}
    }

    // Validate we have at least one good audio URL
    const isValidAudio = Array.isArray(urls) && urls.length > 0;

    if (Number(code) === 200 && isCompleteSignal && !isValidAudio && Array.isArray(items) && items.length) {
      try { console.log('COMPLETE DATA DUMP:', JSON.stringify(items[0])); } catch {}
      try {
        const it = items[0] || {};
        const direct =
          normalizeCandidate(it?.stream_audio_url) ||
          normalizeCandidate(it?.source_stream_audio_url) ||
          normalizeCandidate(it?.audio_url) ||
          normalizeCandidate(it?.url) ||
          null;
        if (direct && direct.startsWith('http')) {
          urls.push(direct);
        }
      } catch {}
    }

    // Error handling
      if (code && [400, 401, 429, 500].includes(Number(code))) {
        if (finalProfileId) io.to(finalProfileId).emit('suno:error', { code, msg, task_id });
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

      const baseTitle =
        (typeof items?.[0]?.title === 'string' && items[0].title.trim().length ? items[0].title.trim() : null) ||
        (typeof title === 'string' && title.trim().length ? title.trim() : null) ||
        'New Track';
      const streamByIndex = [];
      const audioByIndex = [];
      const mp3ByIndex = [];
      const durations = [];
      for (let i = 0; i < Math.min(2, items.length); i++) {
        const it = items[i] || {};
        // 1. stream_url: Save the stream_audio_url (the removeai.ai link).
        const stream =
          normalizeExternalUrl(it?.stream_audio_url) ||
          normalizeExternalUrl(it?.streamAudioUrl) ||
          normalizeExternalUrl(it?.source_stream_audio_url) ||
          normalizeExternalUrl(it?.sourceStreamAudioUrl) ||
          null;
        if (stream && stream.startsWith('http')) streamByIndex[i] = stream;

        // 2. audio_url: Save the source_audio_url (the cdn1.suno.ai link).
        const audio =
          normalizeExternalUrl(it?.source_audio_url) ||
          normalizeExternalUrl(it?.sourceAudioUrl) ||
          null;
        if (audio && audio.startsWith('http')) audioByIndex[i] = audio;

        // 3. mp3_url: Save the finalized audio_url (the tempfile.aiquickdraw.com link).
        const mp3 =
          normalizeExternalUrl(it?.audio_url) ||
          normalizeExternalUrl(it?.audioUrl) ||
          null;
        if (mp3 && mp3.startsWith('http') && isPreferredMp3Url(mp3)) mp3ByIndex[i] = mp3;
        else mp3ByIndex[i] = null;

        // Metadata Sync: Save the duration
        const dur = Number(it?.duration);
        if (Number.isFinite(dur) && dur > 0) durations[i] = dur;
        else durations[i] = null;
      }
      const s0 = typeof streamByIndex[0] === 'string' ? streamByIndex[0] : null;
      const s1 = typeof streamByIndex[1] === 'string' ? streamByIndex[1] : null;
      const finalStreams = [s0, s1].filter((x) => typeof x === 'string');
      if (!finalStreams.length) {
        // Fallback if no specific stream_audio_url found
        for (const u of urls) finalStreams.push(u);
      }
      const onlySecond = !s0 && !!s1 && finalStreams.length === 1;
      const titles = onlySecond ? [`${baseTitle} 2`] : (finalStreams.length >= 2 ? [baseTitle, `${baseTitle} 2`] : [baseTitle]);
      console.log('[Server] Emitting suno:track (broadcast)', { task_id, callbackType, urls_len: finalStreams.length, url: finalStreams[0] || null });
      if (finalProfileId) {
        try {
          const audios = [audioByIndex[0] || null, audioByIndex[1] || null];
          const mp3s = isCompleteSignal ? [mp3ByIndex[0] || null, mp3ByIndex[1] || null] : null;
          // Metadata Sync: duration sync during complete callback
          await upsertTracksForProfile(finalProfileId, finalStreams, mp3s, onlySecond ? `${baseTitle} 2` : baseTitle, typeof cover === 'string' ? cover : null, task_id ? String(task_id) : null, 'callback', isCompleteSignal ? durations : null, audios);
        } catch (e) {
          console.warn('[Server] tracks upsert from callback failed', e?.message || e);
        }
      }
      if (finalProfileId) {
        try { io.to(finalProfileId).emit('suno:status', { task_id: task_id ? String(task_id) : null, status: 'success', message: 'Ready' }); } catch {}
      }
      const audios = [audioByIndex[0] || null, audioByIndex[1] || null];
      const mp3s = isCompleteSignal ? [mp3ByIndex[0] || null, mp3ByIndex[1] || null] : null;
      console.log('[Server] Extracted URLs', { task_id: task_id ? String(task_id) : null, callbackType, streams: finalStreams, audios, mp3s });
      const payload = { url: finalStreams[0], audio_url: audios[0] || finalStreams[0], stream_url: finalStreams[0], download_url: isCompleteSignal ? (mp3s?.[0] || null) : null, urls: finalStreams, cover, title: titles[0], titles, task_id, callbackType, items };
      if (finalProfileId) io.to(finalProfileId).emit('suno:track', payload);
      else io.emit('suno:track', payload);
      return res.status(200).json({ status: 'ok' });
    }

    if (Number(code) === 200 && !isValidAudio) {
      console.log('[Server] Callback received (no audio yet), waiting', { task_id, callbackType });
      if (task_id) {
        try {
          const tid = String(task_id);
          if (!taskStartedAtMsById.has(tid)) taskStartedAtMsById.set(tid, Date.now());
        } catch {}
        try { await pollSunoTaskFromEnv(String(task_id), finalProfileId || null); } catch {}
        if (isCompleteSignal) {
          try { await pollSunoTaskSafetyNet(String(task_id), finalProfileId || null); } catch {}
        }
      }
      if (finalProfileId) {
        try {
          io.to(finalProfileId).emit('suno:status', { task_id: task_id ? String(task_id) : null, status: 'still_cooking', message: 'Still Cooking…', callbackType });
        } catch {}
      }
      return res.status(200).json({ status: 'ok' });
    }

    if (finalProfileId) io.to(finalProfileId).emit('suno:error', { code: code || 400, msg: msg || 'Invalid callback payload or audio URL', task_id });
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
