import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { supabaseApi } from '../api/supabase';
// Dev QA auth test disabled to prevent unintended profile rows

export default function GateScreen() {
  const nav = useNavigation();
  useEffect(() => {
    (async () => {
      try {
        // Keep me logged in flow
        const keep = await AsyncStorage.getItem('mf_keep_login');
        const nick = await AsyncStorage.getItem('mf_session_nickname');
        if (keep === 'true' && nick) {
          const resp = await supabaseApi.fetchProfileByNickname(nick);
          const d = (resp as any)?.data?.[0] || null;
          if (d) {
            // Update last_login when auto-login succeeds
            try { await supabaseApi.updateLastLogin(String(d.nickname || nick), new Date().toISOString()); } catch {}
            const profile = { nickname: d.nickname, avatar_url: d?.avatar_url || null, coins: d?.coins ?? 3 };
            await AsyncStorage.setItem('mf_profile', JSON.stringify(profile));
            await AsyncStorage.setItem('mf_credits', String(profile.coins));
            const needsAvatarPick = !(typeof profile.avatar_url === 'string' && profile.avatar_url.startsWith('assets/'));
            // @ts-ignore
            nav.reset({ index: 0, routes: [{ name: needsAvatarPick ? 'AvatarSelection' : 'MoodSelection' }] });
            return;
          }
        }
        // Fallback: use cached local profile if present
        const raw = await AsyncStorage.getItem('mf_profile');
        const hasProfile = !!raw;
        const parsed = raw ? JSON.parse(raw) : null;
        const needsAvatarPick = !!parsed && !(typeof parsed?.avatar_url === 'string' && parsed.avatar_url.startsWith('assets/'));
        // @ts-ignore
        nav.reset({ index: 0, routes: [{ name: hasProfile ? (needsAvatarPick ? 'AvatarSelection' : 'MoodSelection') : 'Onboarding' }] });
      } catch {
        // @ts-ignore
        nav.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
      }
    })();
  }, []);

  // Removed: QA auth test to avoid creating test nicknames in production tables
  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
});