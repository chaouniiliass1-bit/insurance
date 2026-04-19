import Constants from 'expo-constants';

export const TUNNEL_BYPASS_HEADER = { 'Bypass-Tunnel-Reminder': 'true' } as const;

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

export function getApiBase(): string {
  return readApiUrlFromExpo();
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
