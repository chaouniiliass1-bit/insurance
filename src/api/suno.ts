import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { requireApiBase, TUNNEL_BYPASS_HEADER, withTunnelBypassHeaders } from './base';

type Params = { mood: string; genre1: string; genre2: string; vocalMode?: 'lyrics' | 'instrumental'; profileId?: string | null };

export type SunoAck = {
  taskId: string;
};

export type SunoResult = {
  url: string;
  cover?: string;
  image?: string;
  title?: string;
};

function fetchTimeout(url: string, opts: RequestInit = {}, ms = 30000) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  const nextHeaders = withTunnelBypassHeaders((opts as any)?.headers as any);
  return fetch(url, { ...opts, headers: nextHeaders, signal: c.signal }).finally(() => clearTimeout(id));
}

// Long polling removed: we now rely on Suno's official callback to our server

// Build callback URL strictly from runtime API base; no public-origin overrides
function resolveCallbackUrl(): string {
  if (Constants?.expoConfig?.extra?.EXPO_PUBLIC_SUNO_CALLBACK_URL) {
    return Constants.expoConfig.extra.EXPO_PUBLIC_SUNO_CALLBACK_URL;
  }
  const API_BASE = requireApiBase();
  return `${API_BASE}/suno-callback`;
}

function resolveApiBaseCandidates(): string[] {
  const base = requireApiBase();
  const candidates: string[] = [];
  if (base) candidates.push(base);
  return Array.from(new Set(candidates)).filter((u) => /^https?:\/\//.test(u));
}

export async function generateSunoTrack(
  { mood, genre1, genre2, vocalMode, profileId }: Params,
  onProgress?: (progress: number) => void
): Promise<SunoAck> {
  const cbUrl = resolveCallbackUrl();
  console.log('[Suno] Resolved callback URL:', cbUrl);
  const vocalHint =
    vocalMode === 'instrumental'
      ? 'Instrumental only. No vocals and no lyrics.'
      : 'Include vocals with clear lyrics.';
  const prompt = `Create a ${mood} fusion of ${genre1} and ${genre2}, smooth and relaxing. ${vocalHint}`;
  if (prompt.length > 500) {
    throw { code: 400, message: 'Prompt too long (max 500 characters). Please shorten your description.' } as any;
  }
  const tags = [mood, genre1, genre2, vocalMode === 'instrumental' ? 'instrumental' : 'lyrics'];
  const payload = {
    prompt,
    tags,
    mood,
    genre1,
    genre2,
    genres: [genre1, genre2],
    instrumental: vocalMode === 'instrumental',
    vocalMode: vocalMode || 'lyrics',
    callback_url: cbUrl,
    callbackUrl: cbUrl,
    callBackUrl: cbUrl,
    profile_id: typeof profileId === 'string' && profileId.trim().length ? profileId.trim() : undefined,
  };

  try {
    console.log('[Suno] Using callback URL →', cbUrl);
    const bases = resolveApiBaseCandidates();
    if (!bases.length) throw new Error('EXPO_PUBLIC_API_URL must be set to your backend base URL');

    let response: Response | null = null;
    let lastErr: any = null;
    for (const base of bases) {
      const genUrl = `${base}/proxy/suno/generate`;
      try {
        console.log('[Suno] Fetching from proxy:', genUrl);
        response = await fetchTimeout(
          genUrl,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...TUNNEL_BYPASS_HEADER,
            },
            body: JSON.stringify(payload),
          },
          60000
        );
        break;
      } catch (e) {
        lastErr = e;
        response = null;
      }
    }
    if (!response) throw { code: 0, message: 'Unable to reach backend. Check EXPO_PUBLIC_API_URL / server.', detail: String(lastErr?.message || lastErr) } as any;

    console.log('[Suno] Proxy response status:', response.status);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const text = await response.text();
    console.log('[Suno] Proxy raw response:', text);

    if (contentType.includes('text/html')) {
      throw { error: true, code: response.status, message: 'Server returned HTML instead of JSON', detail: text } as any;
    }
    if (!response.ok) {
      try {
        console.warn('[Suno] Proxy non-OK response', { status: response.status, text });
      } catch {}
      throw { error: true, code: response.status, message: 'Server error', detail: text } as any;
    }
    
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      try { console.warn('[Suno] Invalid JSON from proxy', { status: response.status, text }); } catch {}
      throw { error: true, code: response.status, message: 'Invalid server response' } as any;
    }
    
    const dump = JSON.stringify(data || {}).toLowerCase();
    let override: string | null = null;
    if (dump.includes('insufficient credit')) {
      override = 'Insufficient Credits';
    } else if (dump.includes('unauthorized')) {
      override = 'Unauthorized';
    }

    if ([429, 500].includes(response.status)) {
      const baseMsg = data?.msg || data?.error || 'Suno request failed — please try again later.';
      const msg = override || baseMsg;
      throw { code: response.status, message: msg } as any;
    }

    if (data?.taskId && typeof data.taskId === 'string') {
      console.log('[Suno] Task accepted →', data.taskId);
      if (onProgress) onProgress(0.1);
      return { taskId: data.taskId };
    }

    const errMsgBase = data?.msg || data?.error || 'Invalid response';
    const errMsg = override || errMsgBase;
    throw { code: response.status || 400, message: errMsg } as any;
  } catch (error) {
    throw error;
  }
}
