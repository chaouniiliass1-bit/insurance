import Constants from 'expo-constants';
import { TUNNEL_BYPASS_HEADER } from './base';

export async function pingBackendHealth(): Promise<{ ok: boolean; status: number; data: any | null }> {
  const base = String(Constants?.expoConfig?.extra?.apiUrl || '').trim().replace(/\/$/, '');
  if (!base) {
    console.warn('[Health] apiUrl missing — cannot ping backend');
    return { ok: false, status: 0, data: null };
  }
  const url = `${base}/health`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: TUNNEL_BYPASS_HEADER,
    });
    const status = res.status;
    const data = await res.json().catch(() => null);
    const ok = status >= 200 && status < 300 && !!data?.ok;
    try { console.log('[Health] Backend', { url, ok, status }); } catch {}
    return { ok, status, data };
  } catch (e: any) {
    try { console.warn('[Health] Backend ping failed', { url, error: e?.message || String(e) }); } catch {}
    return { ok: false, status: 0, data: null };
  }
}
