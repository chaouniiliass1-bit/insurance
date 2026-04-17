import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Prefer Expo Constants extra field for production/built app reliability
const extra = Constants?.expoConfig?.extra || {};

const SUPABASE_URL = (
  extra.EXPO_PUBLIC_SUPABASE_URL || 
  process?.env?.EXPO_PUBLIC_SUPABASE_URL || 
  'https://wiekabbfmpmxjhiwyfzt.supabase.co'
).trim().replace(/\/$/, '');

const SUPABASE_ANON_KEY = String(
  (extra.EXPO_PUBLIC_SUPABASE_ANON_KEY || process?.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim()
);

// Masked preview for diagnostics
const preview = SUPABASE_ANON_KEY.length >= 12
  ? `${SUPABASE_ANON_KEY.slice(0, 6)}...${SUPABASE_ANON_KEY.slice(-6)}`
  : SUPABASE_ANON_KEY.length ? 'short' : 'empty';

// Log environment diagnostics at init (no secrets)
try {
  const looksJwt = SUPABASE_ANON_KEY.split('.').length === 3;
  console.log('[Supabase][Init] url=', SUPABASE_URL, 'anon_len=', SUPABASE_ANON_KEY.length, 'anon_preview=', preview, 'jwt_like=', looksJwt);
} catch {}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const supabaseEnvPreview = {
  url: SUPABASE_URL,
  anon_len: SUPABASE_ANON_KEY.length,
  anon_preview: preview,
};
