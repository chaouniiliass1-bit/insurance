import { supabase, supabaseEnvPreview } from '../lib/supabase';
import { requireApiBase, getApiBase, TUNNEL_BYPASS_HEADER, withTunnelBypassHeaders } from './base';
import { Platform } from 'react-native';

type Profile = {
  nickname: string;
  avatar_url?: string | null;
  coins: number;
  password_hash?: string;
  keep_logged_in?: boolean | null;
  device_id?: string;
  device_fingerprint?: string;
  is_vip?: boolean;
  whatsapp_number?: string;
  whatsapp_verified?: boolean;
  verification_code?: string | null;
  verification_expires?: string | null;
  last_login?: string | null;
  created_at?: string;
  updated_at?: string;
};

const LAST_LOGS: Array<{ ts: number; phase: 'request' | 'response' | 'error'; method: string; status?: number; ok?: boolean; error?: string; note?: string }> = [];
function logRequest(phase: 'request' | 'response' | 'error', info: Record<string, any>) {
  const tag = phase === 'request' ? '[Supabase SDK] →' : phase === 'response' ? '[Supabase SDK] ←' : '[Supabase SDK] ⚠';
  try { console.log(tag, JSON.stringify(info)); } catch { console.log(tag, info); }
  try {
    LAST_LOGS.push({ ts: Date.now(), phase, method: String(info.method || ''), status: typeof info.status === 'number' ? info.status : undefined, ok: typeof info.ok === 'boolean' ? info.ok : undefined, error: typeof info.error === 'string' ? info.error : undefined, note: typeof info.note === 'string' ? info.note : undefined });
    if (LAST_LOGS.length > 200) LAST_LOGS.splice(0, LAST_LOGS.length - 200);
  } catch {}
}

async function parseJsonResponse(resp: Response, label: string): Promise<any> {
  const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
  const text = await resp.text().catch(() => '');
  if (contentType.includes('text/html')) {
    try { console.warn('[Supabase API] HTML response', { label, status: resp.status, text }); } catch {}
    throw new Error('Server returned HTML instead of JSON');
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    try { console.warn('[Supabase API] Invalid JSON response', { label, status: resp.status, text }); } catch {}
    throw new Error('Invalid server response');
  }
}

export const supabaseApi = {
  getLastLogs: () => [...LAST_LOGS],
  clearLogs: () => { LAST_LOGS.splice(0, LAST_LOGS.length); },
  // Health check using SDK
  healthCheck: async () => {
    try {
      console.log('[Supabase][ENV]', supabaseEnvPreview);
      const { data, error } = await supabase.from('profiles').select('nickname', { count: 'estimated' }).limit(1);
      if (error) {
        logRequest('error', { method: 'GET', error: String(error?.message || error) });
        return { ok: false, count: 0 };
      }
      logRequest('response', { method: 'GET', status: 200, ok: true });
      const count = Array.isArray(data) ? data.length : 0;
      console.log('[Supabase][Health] ok=true rows=', count);
      return { ok: true, count };
    } catch (e: any) {
      logRequest('error', { method: 'GET', error: String(e?.message || e) });
      return { ok: false, count: 0 };
    }
  },
  // Profiles (Proxy + SDK Fallback)
  upsertProfile: async (profile: Profile) => {
    const body: any = {
      nickname: profile.nickname,
      password_hash: profile.password_hash,
      coins: profile.coins,
      keep_logged_in: !!profile.keep_logged_in,
      avatar_url: profile.avatar_url ?? null,
    };
    if (profile.device_id) body.device_id = profile.device_id;
    if (profile.device_fingerprint) body.device_fingerprint = profile.device_fingerprint;
    if (typeof profile.is_vip === 'boolean') body.is_vip = profile.is_vip;
    if (typeof profile.whatsapp_number === 'string') body.whatsapp_number = profile.whatsapp_number;
    if (typeof profile.whatsapp_verified === 'boolean') body.whatsapp_verified = profile.whatsapp_verified;
    if (typeof profile.verification_code !== 'undefined') body.verification_code = profile.verification_code;
    if (typeof profile.verification_expires !== 'undefined') body.verification_expires = profile.verification_expires;
    if (typeof profile.last_login !== 'undefined') body.last_login = profile.last_login;

    // Try backend proxy first for reliability
    try {
      const base = getApiBase();
      if (base) {
        console.log('[Supabase API] Trying proxy upsert:', `${base}/supabase/profiles/upsert`);
        const resp = await fetch(`${base}/supabase/profiles/upsert`, {
          method: 'POST',
          headers: withTunnelBypassHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        const data = await parseJsonResponse(resp, 'profiles/upsert');
        if (resp.ok) {
          logRequest('response', { method: 'UPSERT_PROXY', status: resp.status, ok: true });
          return { ok: true, status: resp.status, data };
        }
        console.warn('[Supabase API] Proxy upsert failed:', resp.status, data);
      }
    } catch (e) {
      console.warn('[Supabase API] Proxy upsert exception:', e);
    }

    // Fallback to direct SDK
    try {
      console.log('[Supabase API] Falling back to direct SDK upsert');
      const { data, error } = await supabase.from('profiles').upsert(body, { onConflict: 'nickname' }).select('*');
      if (error) { logRequest('error', { method: 'UPSERT', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'UPSERT', status: 201, ok: true });
      return { ok: true, status: 201, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPSERT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  fetchProfileByDeviceId: async (device_id: string) => {
    // Try backend proxy first
    try {
      const base = getApiBase();
      if (base) {
        console.log('[Supabase API] Trying proxy fetchByDeviceId:', device_id);
        const resp = await fetch(`${base}/supabase/profiles/by-device?device_id=${encodeURIComponent(device_id)}`, { headers: TUNNEL_BYPASS_HEADER });
        const data = await parseJsonResponse(resp, 'profiles/by-device');
        if (resp.ok) {
          logRequest('response', { method: 'SELECT_DEVICE_PROXY', status: resp.status, ok: true });
          return { ok: true, data };
        }
        console.warn('[Supabase API] Proxy device fetch failed:', resp.status, data);
      }
    } catch (e) {
      console.warn('[Supabase API] Proxy device fetch exception:', e);
    }

    // Fallback to direct SDK
    try {
      console.log('[Supabase API] Falling back to direct SDK device fetch');
      const { data, error } = await supabase
        .from('profiles')
        .select('id,coins,nickname,avatar_url,password_hash,keep_logged_in')
        .eq('device_id', device_id)
        .limit(1);
      if (error) {
        logRequest('error', { method: 'SELECT', error: String(error?.message || error) });
        return { ok: false, status: 400, data: error.message };
      }
      logRequest('response', { method: 'SELECT', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'SELECT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  fetchProfileByNickname: async (nickname: string) => {
    // Try backend proxy first
    try {
      const base = getApiBase();
      if (base) {
        console.log('[Supabase API] Trying proxy fetchByNickname:', nickname);
        const resp = await fetch(`${base}/supabase/profiles/by-nickname?nickname=${encodeURIComponent(nickname)}`, { headers: TUNNEL_BYPASS_HEADER });
        const data = await parseJsonResponse(resp, 'profiles/by-nickname');
        if (resp.ok) {
          logRequest('response', { method: 'SELECT_PROXY', status: resp.status, ok: true });
          return { ok: true, data };
        }
        console.warn('[Supabase API] Proxy fetch failed:', resp.status, data);
      }
    } catch (e) {
      console.warn('[Supabase API] Proxy fetch exception:', e);
    }

    // Fallback to direct SDK
    try {
      console.log('[Supabase API] Falling back to direct SDK fetch');
      const { data, error } = await supabase.from('profiles').select('id,coins,nickname,avatar_url,password_hash,keep_logged_in').eq('nickname', nickname).limit(1);
      if (error) { logRequest('error', { method: 'SELECT', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'SELECT', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'SELECT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  updateCoinsByNickname: async (nickname: string, coins: number) => {
    try {
      const { data, error } = await supabase.from('profiles').update({ coins }).eq('nickname', nickname).select('*');
      if (error) { logRequest('error', { method: 'UPDATE', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'UPDATE', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPDATE', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  updateCoinsByDeviceId: async (device_id: string, coins: number) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ coins })
        .eq('device_id', device_id)
        .select('*');
      if (error) {
        logRequest('error', { method: 'UPDATE', error: String(error?.message || error) });
        return { ok: false, status: 400, data: error.message };
      }
      logRequest('response', { method: 'UPDATE', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPDATE', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  setKeepLoggedIn: async (nickname: string, keep: boolean) => {
    try {
      const { data, error } = await supabase.from('profiles').update({ keep_logged_in: keep }).eq('nickname', nickname).select('*');
      if (error) { logRequest('error', { method: 'UPDATE', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'UPDATE', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPDATE', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  updateAvatarByNickname: async (nickname: string, avatar_url: string) => {
    try {
      const { data, error } = await supabase.from('profiles').update({ avatar_url }).eq('nickname', nickname).select('*');
      if (error) { logRequest('error', { method: 'UPDATE', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'UPDATE', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPDATE', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  updatePasswordByNickname: async (nickname: string, password_hash: string) => {
    try {
      const { data, error } = await supabase.from('profiles').update({ password_hash }).eq('nickname', nickname).select('*');
      if (error) { logRequest('error', { method: 'UPDATE', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'UPDATE', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPDATE', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  updateLastLogin: async (nickname: string, isoTs: string) => {
    try {
      const { data, error } = await supabase.from('profiles').update({ last_login: isoTs }).eq('nickname', nickname).select('*');
      if (error) { logRequest('error', { method: 'UPDATE', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'UPDATE', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPDATE', error: String(e?.message || e) });
      return { ok: false };
    }
  },

  listAllProfiles: async () => {
    try {
      const { data, error } = await supabase.from('profiles').select('coins,nickname,avatar_url,keep_logged_in');
      if (error) { logRequest('error', { method: 'SELECT', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'SELECT', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'SELECT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  adminUpdateCoins: async (nickname: string, coins: number) => {
    try {
      const { data, error } = await supabase.from('profiles').update({ coins }).eq('nickname', nickname).select('*');
      if (error) { logRequest('error', { method: 'UPDATE', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      logRequest('response', { method: 'UPDATE', status: 200, ok: true });
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPDATE', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  // Tracks: insert generated tracks and list by profile_id
  insertTrack: async (row: { profile_id: string; audio_url: string; title?: string | null; mood?: string | null; genres?: string[] | null; liked?: boolean | null; stream_url?: string | null; mp3_url?: string | null; image_url?: string | null }) => {
    try {
      // Try backend proxy first for reliability (bypasses RLS + avoids device internet issues)
      try {
        const base = getApiBase();
        if (base) {
          const resp = await fetch(`${base}/supabase/tracks/bulk-insert`, {
            method: 'POST',
            headers: withTunnelBypassHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify([row]),
          });
          const data = await parseJsonResponse(resp, 'tracks/bulk-insert(single)');
          if (resp.ok) {
            logRequest('response', { method: 'INSERT_PROXY', status: resp.status, ok: true });
            return { ok: true, status: resp.status, data };
          }
          console.warn('[Supabase API] Proxy insert failed:', resp.status, data);
        }
      } catch (e) {
        console.warn('[Supabase API] Proxy insert exception:', e);
      }

      const payload: any = {
        profile_id: row.profile_id,
        audio_url: row.audio_url,
        title: row.title ?? null,
        mood: row.mood ?? null,
        // Schema expects text; store comma-separated genres
        genres: Array.isArray(row.genres) ? row.genres.filter(Boolean).join(',') : (row.genres as any) ?? null,
        liked: typeof row.liked === 'boolean' ? row.liked : false,
        stream_url: row.stream_url ?? null,
        mp3_url: row.mp3_url ?? null,
        image_url: row.image_url ?? null,
      };
      const { data, error, status } = await supabase.from('tracks').insert(payload).select('*');
      if (error) {
        logRequest('error', { method: 'INSERT', error: String(error?.message || error) });
        // Fallback: server proxy using service role
        try {
          const base = requireApiBase();
          const resp = await fetch(`${base}/supabase/tracks/bulk-insert`, {
            method: 'POST',
            headers: withTunnelBypassHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify([row]),
          });
          const j = await parseJsonResponse(resp, 'tracks/bulk-insert(single-fallback)');
          const ok = resp.status >= 200 && resp.status < 300;
          if (ok) {
            logRequest('response', { method: 'INSERT_PROXY', status: resp.status, ok: true });
            return { ok: true, status: resp.status, data: j };
          }
          logRequest('error', { method: 'INSERT_PROXY', error: String((j && j.error) || 'Proxy insert failed'), status: resp.status });
          return { ok: false, status: resp.status, data: (j && j.error) || 'Proxy insert failed' };
        } catch (e2: any) {
          logRequest('error', { method: 'INSERT_PROXY', error: String(e2?.message || e2) });
          return { ok: false, status: status || 400, data: error.message };
        }
      }
      logRequest('response', { method: 'INSERT', status: status || 201, ok: true });
      return { ok: true, status: status || 201, data };
    } catch (e: any) {
      logRequest('error', { method: 'INSERT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  insertTracksBulk: async (rows: Array<{ profile_id: string; audio_url: string; title?: string | null; mood?: string | null; genres?: string[] | null; liked?: boolean | null; stream_url?: string | null; mp3_url?: string | null; image_url?: string | null }>) => {
    try {
      // Try backend proxy first for reliability (bypasses RLS + avoids device internet issues)
      try {
        const base = getApiBase();
        if (base) {
          const resp = await fetch(`${base}/supabase/tracks/bulk-insert`, {
            method: 'POST',
            headers: withTunnelBypassHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(rows),
          });
          const data = await parseJsonResponse(resp, 'tracks/bulk-insert');
          if (resp.ok) {
            logRequest('response', { method: 'INSERT_PROXY', status: resp.status, ok: true });
            return { ok: true, status: resp.status, data };
          }
          console.warn('[Supabase API] Proxy bulk insert failed:', resp.status, data);
        }
      } catch (e) {
        console.warn('[Supabase API] Proxy bulk insert exception:', e);
      }

      const payload = (Array.isArray(rows) ? rows : []).map((row) => ({
        profile_id: row.profile_id,
        audio_url: row.audio_url,
        title: row.title ?? null,
        mood: row.mood ?? null,
        genres: Array.isArray(row.genres) ? row.genres.filter(Boolean).join(',') : (row.genres as any) ?? null,
        liked: typeof row.liked === 'boolean' ? row.liked : false,
        stream_url: row.stream_url ?? null,
        mp3_url: row.mp3_url ?? null,
        image_url: row.image_url ?? null,
      }));
      if (!payload.length) return { ok: true, status: 200, data: [] };
      const { data, error, status } = await supabase.from('tracks').insert(payload).select('*');
      if (error) {
        logRequest('error', { method: 'INSERT', error: String(error?.message || error) });
        try { console.log('[Supabase][BulkInsert][error]', { ok: false, status: status || 400, error: String(error?.message || error) }); } catch {}
        // Fallback: use server service-role proxy to bypass RLS
        try {
          const base = requireApiBase();
          const resp = await fetch(`${base}/supabase/tracks/bulk-insert`, {
            method: 'POST',
            headers: withTunnelBypassHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(rows),
          });
          const j = await parseJsonResponse(resp, 'tracks/bulk-insert(fallback)');
          const ok = resp.status >= 200 && resp.status < 300;
          if (ok) {
            logRequest('response', { method: 'INSERT_PROXY', status: resp.status, ok: true });
            try { console.log('[Supabase][BulkInsert][proxy]', { ok: true, status: resp.status, count: Array.isArray(j) ? j.length : 0 }); } catch {}
            return { ok: true, status: resp.status, data: j };
          }
          logRequest('error', { method: 'INSERT_PROXY', error: String((j && j.error) || 'Proxy insert failed'), status: resp.status });
          return { ok: false, status: resp.status, data: (j && j.error) || 'Proxy insert failed' };
        } catch (e2: any) {
          logRequest('error', { method: 'INSERT_PROXY', error: String(e2?.message || e2) });
          return { ok: false, status: status || 400, data: error.message };
        }
      }
      logRequest('response', { method: 'INSERT', status: status || 201, ok: true });
      try { console.log('[Supabase][BulkInsert][result]', { ok: true, status: status || 201, count: Array.isArray(data) ? data.length : 0 }); } catch {}
      return { ok: true, status: status || 201, data };
    } catch (e: any) {
      logRequest('error', { method: 'INSERT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  listTracksByProfileId: async (profile_id: string) => {
    try {
      // Try backend proxy first for reliability (bypasses RLS)
      try {
        const base = getApiBase();
        if (base) {
          const resp = await fetch(`${base}/supabase/tracks/by-profile?profile_id=${encodeURIComponent(profile_id)}`, { headers: TUNNEL_BYPASS_HEADER });
          const data = await parseJsonResponse(resp, 'tracks/by-profile');
          if (resp.ok) {
            const normalized = Array.isArray(data) ? data.map((r: any) => ({
              ...r,
              genres: typeof r?.genres === 'string' && r.genres.length ? r.genres.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
            })) : [];
            logRequest('response', { method: 'SELECT_PROXY', status: resp.status, ok: true });
            return { ok: true, data: normalized };
          }
          console.warn('[Supabase API] Proxy tracks list failed:', resp.status, data);
        }
      } catch (e) {
        console.warn('[Supabase API] Proxy tracks list exception:', e);
      }

      const { data, error } = await supabase
        .from('tracks')
        .select('id,audio_url,title,mood,genres,liked,is_favorite,created_at,image_url,stream_url,mp3_url,duration')
        .eq('profile_id', profile_id)
        .order('created_at', { ascending: false });
      if (error) { logRequest('error', { method: 'SELECT', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      const normalized = Array.isArray(data) ? data.map((r: any) => ({
        ...r,
        genres: typeof r?.genres === 'string' && r.genres.length ? r.genres.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      })) : [];
      logRequest('response', { method: 'SELECT', status: 200, ok: true });
      return { ok: true, data: normalized };
    } catch (e: any) {
      logRequest('error', { method: 'SELECT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  listFavoriteTracksByProfileId: async (profile_id: string) => {
    try {
      const base = getApiBase();
      if (!base) return { ok: false, status: 0, data: 'api_base_missing' };
      const resp = await fetch(`${base}/supabase/tracks/favorites/by-profile?profile_id=${encodeURIComponent(profile_id)}`, { headers: TUNNEL_BYPASS_HEADER });
      const data = await parseJsonResponse(resp, 'tracks/favorites/by-profile');
      if (!resp.ok) return { ok: false, status: resp.status, data };
      const normalized = Array.isArray(data) ? data.map((r: any) => ({
        ...r,
        genres: typeof r?.genres === 'string' && r.genres.length ? r.genres.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      })) : [];
      return { ok: true, data: normalized };
    } catch (e: any) {
      logRequest('error', { method: 'SELECT_FAVORITES_PROXY', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  backfillTracksMp3Urls: async (profile_id: string) => {
    try {
      const base = getApiBase();
      if (!base) return { ok: false, status: 0, data: 'api_base_missing' };
      const resp = await fetch(`${base}/supabase/tracks/backfill-mp3`, {
        method: 'POST',
        headers: withTunnelBypassHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ profile_id }),
      });
      const data = await parseJsonResponse(resp, 'tracks/backfill-mp3').catch(() => ({}));
      if (!resp.ok) return { ok: false, status: resp.status, data };
      return { ok: true, status: resp.status, data };
    } catch (e: any) {
      logRequest('error', { method: 'BACKFILL_MP3', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  findTrackIdByUrl: async (profile_id: string, audio_url: string) => {
    try {
      const { data, error } = await supabase.from('tracks').select('id').eq('profile_id', profile_id).eq('audio_url', audio_url).limit(1);
      if (error) { logRequest('error', { method: 'SELECT', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      const id = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
      return { ok: true, data: id };
    } catch (e: any) {
      logRequest('error', { method: 'SELECT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  updateTrackLiked: async (track_id: string, liked: boolean) => {
    try {
      // Try backend proxy first for reliability (bypasses RLS)
      try {
        const base = getApiBase();
        if (base) {
          const resp = await fetch(`${base}/supabase/tracks/update-liked`, {
            method: 'POST',
            headers: withTunnelBypassHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ track_id, liked }),
          });
          const data = await parseJsonResponse(resp, 'tracks/update-liked');
          if (resp.ok) return { ok: true, data };
        }
      } catch {}
      const { data, error } = await supabase.from('tracks').update({ liked }).eq('id', track_id).select('id,liked');
      if (error) { logRequest('error', { method: 'UPDATE', error: String(error?.message || error) }); return { ok: false, status: 400, data: error.message }; }
      return { ok: true, data };
    } catch (e: any) {
      logRequest('error', { method: 'UPDATE', error: String(e?.message || e) });
      return { ok: false };
    }
  },
  insertHistory: async (row: { profile_id: string; track_id: string }) => {
    try {
      const { data, error, status } = await supabase.from('history').insert({ profile_id: row.profile_id, track_id: row.track_id }).select('*');
      if (error) { logRequest('error', { method: 'INSERT', error: String(error?.message || error) }); return { ok: false, status: status || 400, data: error.message }; }
      return { ok: true, status: status || 201, data };
    } catch (e: any) {
      logRequest('error', { method: 'INSERT', error: String(e?.message || e) });
      return { ok: false };
    }
  },
};

export type { Profile };
