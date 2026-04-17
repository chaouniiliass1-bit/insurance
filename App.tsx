import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { PermissionsAndroid, Platform, StyleSheet, useColorScheme } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { navigationRef } from './src/navigation';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PlayerScreen from './src/screens/PlayerScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import MoodSelectionScreen from './src/screens/MoodSelectionScreen';
import GenreSelectionScreen from './src/screens/GenreSelectionScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AvatarSelectionScreen from './src/screens/AvatarSelectionScreen';
import GateScreen from './src/screens/GateScreen';
import AdminScreen from './src/screens/AdminScreen';
// DebugAuth removed
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStateProvider } from './src/context/AppState';
import { audioService } from './src/services/audio';
import { supabaseApi } from './src/api/supabase';
import { supabaseEnvPreview } from './src/lib/supabase';
import { pingBackendHealth } from './src/api/health';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './src/lib/supabase';
// Device ID logic removed

const Stack = createNativeStackNavigator();

export default function App() {
  const colorScheme = useColorScheme();
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [startRoute, setStartRoute] = useState<'Gate' | 'Onboarding' | 'AvatarSelection' | 'MoodSelection'>('Gate');

  // Ensure audio mode is initialized for iOS playback (silent mode, background)
  useEffect(() => {
    audioService.configure().catch(() => {});
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        const perm = (PermissionsAndroid as any)?.PERMISSIONS?.POST_NOTIFICATIONS;
        if (!perm) return;
        await PermissionsAndroid.request(perm);
      } catch {}
    })();
  }, []);

  // Dev-only: log env preview and perform a lightweight Supabase health check
  useEffect(() => {
    const isDev = String(process.env.EXPO_PUBLIC_IS_DEV).toLowerCase() === 'true';
    if (isDev) {
      // Log environment preview (length and masked preview)
      try { console.log('[Supabase][ENV Preview at App Init]', supabaseEnvPreview); } catch {}
      // Health check: validate REST and permissions early
      supabaseApi.healthCheck().catch(() => {});
      // Backend health: ensure ngrok base is reachable for sockets/callbacks
      pingBackendHealth().catch(() => {});
    }
  }, []);

  // Removed device gating; navigation mounts immediately
  useEffect(() => {
    let sub: any = null;
    let cancelled = false;
    const computeStartRoute = async (sessionExists: boolean) => {
      try {
        const raw = await AsyncStorage.getItem('mf_profile');
        const parsed = raw ? JSON.parse(raw) : null;
        const avatar = parsed?.avatar_url;
        const hasProfile = !!parsed?.nickname;
        if (sessionExists || hasProfile) {
          const needsAvatarPick = !(typeof avatar === 'string' && avatar.startsWith('assets/'));
          const route: 'AvatarSelection' | 'MoodSelection' = needsAvatarPick ? 'AvatarSelection' : 'MoodSelection';
          return route;
        }
        return 'Gate';
      } catch {
        return 'Gate';
      }
    };

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const sessionExists = !!data?.session;
        const nextRoute = await computeStartRoute(sessionExists);
        if (cancelled) return;
        setIsAuthenticated(sessionExists || nextRoute !== 'Gate');
        setStartRoute(nextRoute);
        setAuthReady(true);
      } catch {
        if (cancelled) return;
        setAuthReady(true);
      }
    })();

    try {
      const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
        const sessionExists = !!session;
        const nextRoute = await computeStartRoute(sessionExists);
        setIsAuthenticated(sessionExists || nextRoute !== 'Gate');
        if (nextRoute !== startRoute) setStartRoute(nextRoute);
      });
      sub = data?.subscription;
    } catch {}

    return () => {
      cancelled = true;
      try { sub?.unsubscribe?.(); } catch {}
    };
  }, []);

  const initialRouteName = useMemo(() => {
    if (!authReady) return 'Gate';
    return startRoute;
  }, [authReady, startRoute]);

  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <NavigationContainer ref={navigationRef} theme={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          <Stack.Navigator key={initialRouteName} screenOptions={{ headerShown: false, animation: 'fade' }} initialRouteName={initialRouteName}>
            <Stack.Screen name="Gate" component={GateScreen} />
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="AvatarSelection" component={AvatarSelectionScreen} />
            <Stack.Screen name="MoodSelection" component={MoodSelectionScreen} />
            <Stack.Screen name="GenreSelection" component={GenreSelectionScreen} />
            <Stack.Screen name="Player" component={PlayerScreen} />
            <Stack.Screen name="Favorites" component={FavoritesScreen} />
            <Stack.Screen name="Library" component={LibraryScreen} />
            <Stack.Screen name="Admin" component={AdminScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({});
