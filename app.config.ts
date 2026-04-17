import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';

export default ({ config }: { config: ExpoConfig }) => ({
  ...config,
  ios: {
    ...(config.ios || {}),
    infoPlist: {
      ...((config as any).ios?.infoPlist || {}),
      UIBackgroundModes: ['audio'],
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
    },
  },
  extra: {
    ...config.extra,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "",
    isDev: process.env.EXPO_PUBLIC_IS_DEV === "true",
    socketTransport: process.env.EXPO_PUBLIC_SOCKET_TRANSPORT ?? "",
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_MUREKA_API_KEY: process.env.EXPO_PUBLIC_MUREKA_API_KEY,
    EXPO_PUBLIC_SUNO_BASE: process.env.EXPO_PUBLIC_SUNO_BASE,
    EXPO_PUBLIC_SUNO_CALLBACK_URL: process.env.EXPO_PUBLIC_SUNO_CALLBACK_URL,
    EXPO_PUBLIC_SOCKET_URL: process.env.EXPO_PUBLIC_SOCKET_URL,
    EXPO_PUBLIC_SUNO_PROXY: process.env.EXPO_PUBLIC_SUNO_PROXY,
    EXPO_PUBLIC_IS_DEV: process.env.EXPO_PUBLIC_IS_DEV,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_SOCKET_TRANSPORT: process.env.EXPO_PUBLIC_SOCKET_TRANSPORT,
  },
});
