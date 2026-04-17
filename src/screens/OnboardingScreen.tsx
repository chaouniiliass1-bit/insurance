import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Keyboard, ScrollView, Animated, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { goBack } from '../navigation';
import ProfileModal from '../components/ProfileModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import GradientBackground from '../components/GradientBackground';
import { supabaseApi } from '../api/supabase';
import bcrypt from '../utils/bcrypt';
import { useAppState } from '../context/AppState';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Clean reset: pure nickname + password signup/login

// Keys
const K_SESSION_NICK = 'mf_session_nickname';
const K_KEEP_LOGIN = 'mf_keep_login';
const K_PROFILE = 'mf_profile';
const K_CREDITS = 'mf_credits';

export default function OnboardingScreen() {
  const nav = useNavigation() as any;
  const { deviceId, isReady, refreshProfile } = useAppState() as any;
  const insets = useSafeAreaInsets();
  console.log('[Onboarding] Device ID from State:', deviceId, 'isReady:', isReady);

  useEffect(() => {
    if (isReady && deviceId) {
      console.log('[Onboarding] Device ID is ready:', deviceId);
    }
  }, [isReady, deviceId]);
  const [showProfile, setShowProfile] = useState(false);
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [signInMode, setSignInMode] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);
  const logoOpacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // GateScreen will handle auto-login. Just animate the logo here.
    Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  const onContinue = async () => {
    const nick = nickname.trim();
    const pwd = password.trim();
    const conf = confirmPassword.trim();
    const pwdOk = pwd.length >= 8 && /[A-Za-z]/.test(pwd) && /\d/.test(pwd);
    const matchOk = pwd === conf || signInMode;
    if (!nick || !pwd || busy) return;
    if (!signInMode && (!pwdOk || !matchOk)) return;
    setBusy(true);
    setCloudError(null);
    try {
      if (!signInMode) {
        // Signup: hash password, create minimal profile, then go choose avatar
        // First, enforce one account per device: block if device_id already exists
        try {
          if (deviceId) {
            console.log('[Onboarding] Checking device_id:', deviceId);
            const existing = await supabaseApi.fetchProfileByDeviceId(deviceId);
            const exists = Array.isArray((existing as any)?.data) && ((existing as any)?.data?.length || 0) > 0;
            if (exists) {
              setCloudError('This device already has an account. Please sign in.');
              setBusy(false);
              return;
            }
          }
        } catch (e) {
          console.warn('[Onboarding] fetchProfileByDeviceId error:', e);
        }
        // Also block if nickname is already taken
        try {
          console.log('[Onboarding] Checking nickname:', nick);
          const byNick = await supabaseApi.fetchProfileByNickname(nick);
          const exists = Array.isArray((byNick as any)?.data) && ((byNick as any)?.data?.length || 0) > 0;
          if (exists) {
            setCloudError('Nickname already picked. Try another one.');
            setBusy(false);
            return;
          }
        } catch (e) {
          console.warn('[Onboarding] fetchProfileByNickname error:', e);
        }
        const salt = await bcrypt.genSalt(10);
        const pwdHash = await bcrypt.hash(pwd, salt);
        const profile: any = { nickname: nick, coins: 3, password_hash: pwdHash, keep_logged_in: true, avatar_url: null, device_id: deviceId || null };
        try {
          console.log('[Onboarding] Upserting profile for:', nick);
          const resp = await supabaseApi.upsertProfile(profile);
          console.log('[Onboarding] Upsert response:', resp);
          if ((resp as any)?.status && ![200,201].includes((resp as any).status)) {
            setCloudError(`Server error (${(resp as any).status}). Please check connection.`);
          } else if (!(resp as any).ok) {
            setCloudError("Couldn't reach server — check your internet or Supabase URL.");
          } else {
            // Record last_login on successful signup
            try { await supabaseApi.updateLastLogin(nick, new Date().toISOString()); } catch {}
            await AsyncStorage.setItem(K_PROFILE, JSON.stringify({ nickname: nick, avatar_url: null, coins: 3 }));
            await AsyncStorage.setItem(K_CREDITS, '3');
            await AsyncStorage.setItem(K_SESSION_NICK, nick);
            await AsyncStorage.setItem(K_KEEP_LOGIN, 'true');
            try { await supabaseApi.setKeepLoggedIn(nick, true); } catch {}
            try { await refreshProfile?.(); } catch {}
            // @ts-ignore
            nav.navigate('AvatarSelection');
            setCloudError(null);
          }
        } catch (e: any) {
          console.error('[Onboarding] upsertProfile exception:', e);
          setCloudError(`Connection failed: ${e.message || 'Unknown error'}`);
        }
      } else {
        // Sign in by nickname
        let byNick: any = null;
        try { 
          console.log('[Onboarding] Sign-in fetch for:', nick);
          byNick = await supabaseApi.fetchProfileByNickname(nick); 
          console.log('[Onboarding] Sign-in fetch response:', byNick);
        } catch (e: any) {
          setCloudError(`Server unreachable: ${e.message || 'Check connection'}`);
          console.warn('[Onboarding] Supabase fetch error', e);
        }
        const d = (byNick as any)?.data?.[0] || null;
        if (!d) {
          setCloudError('No account found for this nickname.');
        } else {
          const remoteNick = String(d.nickname || nick);
          const remoteHash = String(d.password_hash || '');
          if (!remoteHash) {
            setCloudError('Account missing password.');
          } else {
            const ok = await bcrypt.compare(pwd, remoteHash);
            if (!ok) {
              setCloudError('Incorrect password. Try again.');
            } else {
              const coinsVal = typeof d?.coins === 'number' ? d.coins : 3;
              const avatarUrl = typeof d?.avatar_url === 'string' && d?.avatar_url?.length ? d.avatar_url : null;
              await AsyncStorage.setItem(K_PROFILE, JSON.stringify({ nickname: remoteNick, avatar_url: avatarUrl, coins: coinsVal }));
              await AsyncStorage.setItem(K_CREDITS, String(coinsVal));
              await AsyncStorage.setItem(K_SESSION_NICK, remoteNick);
              await AsyncStorage.setItem(K_KEEP_LOGIN, keepLoggedIn ? 'true' : 'false');
              try { await supabaseApi.setKeepLoggedIn(remoteNick, !!keepLoggedIn); } catch {}
              // Update last_login on successful sign-in
              try { await supabaseApi.updateLastLogin(remoteNick, new Date().toISOString()); } catch {}
              try { await refreshProfile?.(); } catch {}
              setCloudError(null);
              // @ts-ignore
              nav.navigate('MoodSelection');
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[Onboarding] Outer catch:', e);
      setCloudError(`Unexpected error: ${e.message || 'Check connection'}`);
    }
    setBusy(false);
  };

  // Derived UI state
  const passwordValid = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
  const passwordsMatch = signInMode || password === confirmPassword;
  const ctaEnabled = nickname.trim().length > 0 && password.trim().length > 0 && (signInMode || (passwordValid && passwordsMatch));

  return (
    <GradientBackground mood={"Relaxed"}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={insets.top}>
        <ScrollView contentContainerStyle={[styles.container, { paddingTop: (insets.top || 0) + 44, paddingBottom: (insets.bottom || 0) + 28 }]} keyboardShouldPersistTaps="handled">
          <Pressable style={[styles.backIcon, { top: (insets.top || 0) + 8 }]} onPress={() => goBack()}>
            <MaterialIcons name="arrow-back" size={22} color="#1b1b1b" />
          </Pressable>
          <Pressable style={[styles.profileIcon, { top: (insets.top || 0) + 8 }]} onPress={() => setShowProfile(true)}>
            <MaterialIcons name="person-outline" size={22} color="#1b1b1b" />
          </Pressable>
          <Pressable onPress={() => Keyboard.dismiss()}>
            <Animated.Image source={require('../../assets/logo.png')} style={[styles.logo, { opacity: logoOpacity }]} resizeMode="contain" />
          </Pressable>
          <Text style={styles.title}>Welcome to Mood Fusion Player</Text>
          <TextInput
            value={nickname}
            onChangeText={setNickname}
            placeholder="Nickname"
            placeholderTextColor="rgba(255,255,255,0.7)"
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="rgba(255,255,255,0.7)"
            style={styles.input}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {!signInMode && (
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm Password"
              placeholderTextColor="rgba(255,255,255,0.7)"
              style={styles.input}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
            />
          )}
          {!!cloudError && (
            <View style={{ width: '92%', alignItems: 'center' }}>
              <Text style={styles.errorText}>{cloudError}</Text>
            </View>
          )}
          {!signInMode && password.length > 0 && !(password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)) && (
            <Text style={styles.errorText}>Password must be 8+ chars with letters and numbers.</Text>
          )}
          {!signInMode && confirmPassword.length > 0 && password !== confirmPassword && (
            <Text style={styles.errorText}>Passwords do not match.</Text>
          )}
          <View style={{ width: '92%', marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: 'rgba(255,255,255,0.85)' }}>Keep me logged in</Text>
            <Pressable onPress={() => setKeepLoggedIn((s) => !s)} style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: keepLoggedIn ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)' }} />
          </View>
          <Pressable
            style={[styles.cta, ctaEnabled ? styles.ctaEnabled : styles.ctaDisabled]}
            onPress={onContinue}
            disabled={busy || !ctaEnabled}
          >
            <Text style={styles.ctaText}>{busy ? (signInMode ? 'Signing in…' : 'Setting up…') : cloudError ? 'Retry' : (signInMode ? 'Sign In' : 'Create My Vibe Account')}</Text>
          </Pressable>
          <Pressable style={styles.altLink} onPress={() => setSignInMode((s) => !s)}>
            <Text style={styles.altLinkText}>{signInMode ? 'New here? Create account.' : 'Already have an account? Sign in.'}</Text>
          </Pressable>
          {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  backIcon: {
    position: 'absolute',
    left: 16,
    top: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
  profileIcon: {
    position: 'absolute',
    right: 16,
    top: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
  logo: {
    width: 140,
    height: 100,
    marginBottom: 16,
  },
  title: {
    color: '#f8f5f0',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    width: '92%',
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: 10,
  },
  // Avatar selection moved to AvatarSelection screen
  cta: {
    width: '92%',
    marginTop: 24,
    borderRadius: 28,
    paddingVertical: 14,
  },
  ctaEnabled: {
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  ctaDisabled: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  ctaText: {
    color: '#1b1b1b',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  pickBtn: {
    width: '92%',
    marginTop: 18,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  pickText: {
    color: '#1b1b1b',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  altLink: { marginTop: 14 },
  altLinkText: { color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  popup: { width: '88%', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.92)', padding: 16 },
  popupTitle: { color: '#1b1b1b', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  close: { position: 'absolute', right: 10, top: 8, padding: 6 },
  closeText: { color: '#1b1b1b' },
  errorText: { color: '#ffdddd', textAlign: 'center', marginTop: 10 },
  // Debug and recover UI removed per clean reset
  inlineInfo: { color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginTop: 8 },
});
