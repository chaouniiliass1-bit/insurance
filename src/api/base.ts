import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const TUNNEL_BYPASS_HEADER = { 'Bypass-Tunnel-Reminder': 'true' } as const;
export const PRODUCTION_BACKEND_BASE = 'https://insurance-production-6074.up.railway.app';

function readApiUrlFromExpo(): string {
  try {
    const extra: any = Constants?.expoConfig?.extra || {};
    const url =
      String(extra?.apiUrl || '').trim() ||
      String(extra?.EXPO_PUBLIC_API_URL || '').trim() ||
      String((process as any)?.env?.EXPO_PUBLIC_API_URL || '').trim() ||
      String((process as any)?.env?.EXPO_PUBLIC_SOCKET_URL || '').trim();
    return url.replace(/\/$/, '');
  } catch {
    try {
      const url =
        String((process as any)?.env?.EXPO_PUBLIC_API_URL || '').trim() ||
        String((process as any)?.env?.EXPO_PUBLIC_SOCKET_URL || '').trim();
      return url.replace(/\/$/, '');
    } catch {}
    return '';
  }
}

export function withTunnelBypassHeaders(headers?: Record<string, string>): Record<string, string> {
  return { ...(headers || {}), ...TUNNEL_BYPASS_HEADER };
}

function extractHost(input: string): string {
  const s = String(input || '').trim();
  if (!s) return '';
  try {
    if (s.includes('://')) return new URL(s).hostname;
  } catch {}
  const noProto = s.replace(/^exp:\/\//, '').replace(/^https?:\/\//, '');
  const beforeSlash = noProto.split('/')[0] || '';
  const host = beforeSlash.split(':')[0] || '';
  return host.trim();
}

function inferDevHost(): string {
  const candidates: Array<any> = [
    (Constants as any)?.expoConfig?.hostUri,
    (Constants as any)?.manifest?.debuggerHost,
    (Constants as any)?.manifest2?.extra?.expoClient?.hostUri,
    (Constants as any)?.expoGoConfig?.debuggerHost,
  ];
  for (const c of candidates) {
    const host = typeof c === 'string' ? extractHost(c) : '';
    if (host) return host;
  }
  return '';
}

export function getApiBase(): string {
  if (Platform.OS !== 'web') return PRODUCTION_BACKEND_BASE;
  const v = readApiUrlFromExpo();
  if (v) {
    if (Platform.OS !== 'web' && isLocalHost(v)) {
      const host = inferDevHost();
      if (host) return `http://${host}:8788`;
    }
    return v;
  }
  if (Platform.OS === 'web') {
    try {
      const w = (globalThis as any)?.window;
      const host = typeof w?.location?.hostname === 'string' ? w.location.hostname : '';
      const proto = typeof w?.location?.protocol === 'string' ? w.location.protocol : '';
      if (host) {
        const scheme = proto === 'https:' ? 'https' : 'http';
        return `${scheme}://${host}:8788`;
      }
    } catch {}
    return '';
  }
  const host = inferDevHost();
  return host ? `http://${host}:8788` : '';
}

export function requireApiBase(): string {
  const base = getApiBase();
  if (!base) {
    throw new Error('Set EXPO_PUBLIC_API_URL to your public backend base URL in .env and rebuild');
  }
  return base;
}

export function isHttps(url: string): boolean {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

export function isLocalHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes('localhost') || host === '127.0.0.1';
  } catch { return false; }
}
