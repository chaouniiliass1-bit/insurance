import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import type { AVPlaybackStatus } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../context/AppState';
import { supabaseApi } from '../api/supabase';
import { navigate, resetTo } from '../navigation';
import { MaterialIcons } from '@expo/vector-icons';
import { audioService } from '../services/audio';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function ProfileModal({ visible, onClose }: Props) {
  const { profile, credits, refreshProfile, trackTitle, trackUrl, trackB, isSecondActive, setSecondActive } = useAppState() as any;
  const insets = useSafeAreaInsets();
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);
  const [keep, setKeep] = useState<boolean | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<AVPlaybackStatus | null>(null);
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const cloudOpacity = useSharedValue(1);
  const cloudStyle = useAnimatedStyle(() => ({ opacity: cloudOpacity.value }));
  const [mounted, setMounted] = useState<boolean>(visible);
  const sheetT = useSharedValue(0);
  const overlayT = useSharedValue(0);
  const hasActiveTrack = typeof trackUrl === 'string' && trackUrl.length > 0;

  const screenH = Dimensions.get('window').height || 800;
  const sheetH = Math.min(Math.floor(screenH * 0.82), Math.max(360, Math.floor(screenH * 0.64)));

  const recheck = async () => {
    try {
      if (profile?.nickname) {
        const resp = await supabaseApi.fetchProfileByNickname(profile.nickname);
        const ok = (resp as any)?.ok !== false && Array.isArray((resp as any)?.data);
        setCloudOk(!!ok);
        if (ok) await refreshProfile();
      } else {
        setCloudOk(false);
      }
    } catch {
      setCloudOk(false);
    } finally {
      cloudOpacity.value = 0;
      cloudOpacity.value = withTiming(1, { duration: 250 });
    }
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      sheetT.value = withSpring(1, { damping: 18, stiffness: 180, mass: 0.9 });
      overlayT.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
      return;
    }
    if (!mounted) return;
    sheetT.value = withTiming(0, { duration: 200, easing: Easing.inOut(Easing.quad) });
    overlayT.value = withTiming(0, { duration: 160, easing: Easing.inOut(Easing.quad) });
    const id = setTimeout(() => {
      setMounted(false);
    }, 220);
    return () => clearTimeout(id);
  }, [visible, mounted, overlayT, sheetT]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const syncPlaybackStatus = async () => {
      try {
        const status = await audioService.getStatus();
        if (active) setPlaybackStatus(status ?? null);
      } catch {
        if (active) setPlaybackStatus(null);
      }
    };
    syncPlaybackStatus();
    const id = setInterval(syncPlaybackStatus, 350);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [visible, hasActiveTrack, trackB, isSecondActive]);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    (async () => {
      try {
        // derive keep_logged_in state from profile or storage
        try {
          const localKeepStr = await AsyncStorage.getItem('mf_keep_login');
          const localKeep = localKeepStr === 'true';
          const effective = typeof profile?.keep_logged_in === 'boolean' ? profile.keep_logged_in : localKeep;
          if (mounted) setKeep(effective);
        } catch {}
        if (profile?.nickname) {
          const resp = await supabaseApi.fetchProfileByNickname(profile.nickname);
          const ok = (resp as any)?.ok !== false && Array.isArray((resp as any)?.data);
          if (mounted) setCloudOk(!!ok);
          try {
            const d = (resp as any)?.data?.[0];
            if (mounted && typeof d?.keep_logged_in === 'boolean') setKeep(!!d.keep_logged_in);
          } catch {}
        } else {
          if (mounted) setCloudOk(false);
        }
      } catch {
        if (mounted) setCloudOk(false);
      }
    })();
    return () => { mounted = false; };
  }, [visible]);

  if (!mounted) return null;
  const isAssetAvatar = typeof profile?.avatar_url === 'string' && profile.avatar_url.startsWith('assets/');
  const AVATAR_PATHS = [
    'assets/avatar1.png',
    'assets/avatar2.png',
    'assets/avatar3.png',
    'assets/avatar4.png',
    'assets/avatar5.png',
  ];
  const AVATAR_ASSETS = [
    require('../../assets/avatar1.png'),
    require('../../assets/avatar2.png'),
    require('../../assets/avatar3.png'),
    require('../../assets/avatar4.png'),
    require('../../assets/avatar5.png'),
  ];
  const assetForPath = (p?: string) => {
    if (!p) return null;
    const idx = AVATAR_PATHS.indexOf(p);
    return idx >= 0 ? AVATAR_ASSETS[idx] : null;
  };
  const statusColor = cloudOk === null ? '#cc9a06' : cloudOk ? '#0f9d58' : '#d93025';
  const avatarSrc = isAssetAvatar ? assetForPath(profile?.avatar_url) : null;
  const nickname = profile?.nickname || 'Guest';
  const activeTitle = (typeof trackTitle === 'string' && trackTitle.trim().length ? trackTitle.trim() : null) || 'Active Track';
  const loadedPlayback = !!(playbackStatus && 'isLoaded' in playbackStatus && playbackStatus.isLoaded);
  const playing = !!(playbackStatus && 'isLoaded' in playbackStatus && playbackStatus.isLoaded && playbackStatus.isPlaying);
  const canPlayOrPause = hasActiveTrack && loadedPlayback && !playbackBusy;
  const canStop = hasActiveTrack && loadedPlayback && !playbackBusy;

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayT.value }));
  const sheetStyle = useAnimatedStyle(() => {
    const y = sheetH * (1 - sheetT.value) + 18;
    return { transform: [{ translateY: y }] };
  });

  const glassStyle = useMemo(() => {
    if (Platform.OS === 'web') {
      return { backgroundColor: 'rgba(18,24,38,0.70)', backdropFilter: 'blur(22px)' } as any;
    }
    return { backgroundColor: 'rgba(18,24,38,0.88)' };
  }, []);

  const onReturnToPlayer = () => {
    onClose();
  };

  const onToggleKeep = async (next: boolean) => {
    setKeep(next);
    try { await AsyncStorage.setItem('mf_keep_login', next ? 'true' : 'false'); } catch {}
    try {
      if (profile?.nickname) await supabaseApi.setKeepLoggedIn(profile.nickname, next);
    } catch {}
  };

  const onPlayPause = async () => {
    if (playbackBusy) return;
    setPlaybackBusy(true);
    try {
      const s: any = await audioService.getStatus();
      setPlaybackStatus(s ?? null);
      if (!(s && s.isLoaded)) return;
      if (s.isPlaying) {
        await audioService.pause();
      } else {
        await audioService.play();
      }
      const next = await audioService.getStatus();
      setPlaybackStatus(next ?? s);
    } catch {
      // no-op
    } finally {
      setPlaybackBusy(false);
    }
  };

  const onStop = async () => {
    if (playbackBusy) return;
    setPlaybackBusy(true);
    try {
      const s: any = await audioService.getStatus();
      setPlaybackStatus(s ?? null);
      if (!(s && s.isLoaded)) return;
      await audioService.stop();
      const next = await audioService.getStatus();
      setPlaybackStatus(next ?? s);
    } catch {
      // no-op
    } finally {
      setPlaybackBusy(false);
    }
  };

  const onToggleVibe = async () => {
    if (!trackB || playbackBusy) return;
    setPlaybackBusy(true);
    try {
      if (isSecondActive) {
        await audioService.crossfadeToPrev(800);
        setSecondActive(false);
      } else {
        await audioService.crossfadeToNext(800);
        setSecondActive(true);
      }
      const next = await audioService.getStatus();
      setPlaybackStatus(next ?? null);
    } catch {
      // no-op
    } finally {
      setPlaybackBusy(false);
    }
  };

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, overlayStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheetWrap, sheetStyle]} pointerEvents="box-none">
        <View style={[styles.sheet, glassStyle, { height: sheetH }]} pointerEvents="auto">
          <Pressable style={styles.handleBtn} onPress={onReturnToPlayer} hitSlop={10}>
            <View style={styles.handleInner}>
              <MaterialIcons name="chevron-left" size={20} color="rgba(255,255,255,0.90)" />
              <Text style={styles.handleText} numberOfLines={1}>{`Back to Player • ${activeTitle}`}</Text>
            </View>
          </Pressable>
          <View style={styles.glowEdge} />
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={[styles.sheetScrollContent, { paddingBottom: (insets.bottom || 0) + 18 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topRow}>
              <View style={styles.avatarCircle}>
                {avatarSrc ? (
                  <Image source={avatarSrc as any} style={styles.avatarImage} resizeMode="contain" />
                ) : (
                  <Text style={styles.avatarEmoji}>{profile?.avatar_url || '🌟'}</Text>
                )}
              </View>
              <View style={styles.metaCol}>
                <View style={styles.nameRow}>
                  <Text style={styles.nickname}>{nickname}</Text>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                </View>
                <View style={styles.coinRow}>
                  <Text style={styles.coinIcon}>🪙</Text>
                  <Text style={styles.coinText}>{Math.max(0, credits || 0)}</Text>
                </View>
                <Animated.Text style={[styles.cloudStatus, cloudStyle, { color: cloudOk === null ? 'rgba(255,215,100,0.95)' : cloudOk ? 'rgba(80, 220, 150, 0.95)' : 'rgba(255,120,120,0.92)' }]}>
                  {cloudOk === null ? 'Checking…' : cloudOk ? 'Cloud Sync: OK' : 'Offline'}
                </Animated.Text>
              </View>
            </View>

            <View style={styles.controlsRow}>
              <Pressable style={[styles.pillBtn, !canPlayOrPause && styles.pillDisabled]} onPress={onPlayPause} disabled={!canPlayOrPause}>
                <View style={styles.pillInner}>
                  <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={18} color="rgba(255,255,255,0.92)" />
                  <Text style={styles.pillText}>{playing ? 'Pause' : 'Play'}</Text>
                </View>
              </Pressable>
              <Pressable style={[styles.pillBtn, !canStop && styles.pillDisabled]} onPress={onStop} disabled={!canStop}>
                <View style={styles.pillInner}>
                  <MaterialIcons name="stop" size={18} color="rgba(255,255,255,0.92)" />
                  <Text style={styles.pillText}>Stop</Text>
                </View>
              </Pressable>
              <Pressable style={[styles.pillBtn, !(hasActiveTrack && trackB) && styles.pillDisabled]} onPress={onToggleVibe} disabled={!(hasActiveTrack && trackB)}>
                <View style={styles.pillInner}>
                  <MaterialIcons name={isSecondActive ? 'skip-previous' : 'skip-next'} size={18} color="rgba(255,255,255,0.92)" />
                  <Text style={styles.pillText}>{isSecondActive ? 'Vibe A' : 'Vibe B'}</Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.keepRow}>
              <Text style={styles.keepLabel}>Keep Logged In</Text>
              <Switch
                value={!!keep}
                onValueChange={onToggleKeep}
                trackColor={{ false: 'rgba(255,255,255,0.18)', true: 'rgba(120,170,255,0.45)' }}
                thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
                ios_backgroundColor={'rgba(255,255,255,0.18)'}
              />
            </View>

            <Pressable style={styles.pillBtn} onPress={() => { onClose(); navigate('Favorites'); }}>
              <Text style={styles.pillTextSolo}>My Favorites</Text>
            </Pressable>
            <Pressable style={styles.pillBtn} onPress={() => { onClose(); navigate('Library'); }}>
              <Text style={styles.pillTextSolo}>My Library</Text>
            </Pressable>
            {cloudOk === false && (
              <Pressable style={styles.pillBtn} onPress={recheck}>
                <Text style={styles.pillTextSolo}>Retry Sync</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.pillBtn, styles.signOutBtn]}
              onPress={async () => {
                try {
                  const nick = await AsyncStorage.getItem('mf_session_nickname');
                  await AsyncStorage.removeItem('mf_profile');
                  await AsyncStorage.removeItem('mf_credits');
                  await AsyncStorage.removeItem('mf_password_hash');
                  await AsyncStorage.removeItem('mf_session_nickname');
                  await AsyncStorage.removeItem('mf_keep_login');
                  try { if (nick) await supabaseApi.setKeepLoggedIn(nick, false); } catch {}
                } catch {}
                onClose();
                resetTo('Gate');
              }}
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(200,220,255,0.12)',
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
  },
  sheetScroll: { flex: 1 },
  sheetScrollContent: { paddingBottom: 18 },
  glowEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: 'rgba(200,220,255,0.22)',
  },
  handleBtn: {
    alignSelf: 'center',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    width: '100%',
  },
  handleInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  handleText: { color: 'rgba(255,255,255,0.90)', fontSize: 12, fontWeight: '700', letterSpacing: 0.2, flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14 },
  avatarCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  avatarImage: { width: 46, height: 46 },
  avatarEmoji: { fontSize: 26 },
  metaCol: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nickname: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 2 },
  coinRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  coinIcon: { fontSize: 16 },
  coinText: { color: 'rgba(255,255,255,0.92)', fontSize: 16, fontWeight: '700' },
  cloudStatus: { marginTop: 6, fontSize: 12, fontWeight: '700' },
  controlsRow: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 10 },
  pillBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillDisabled: { opacity: 0.5 },
  pillInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillText: { color: 'rgba(255,255,255,0.90)', fontWeight: '800', fontSize: 13, letterSpacing: 0.2 },
  pillTextSolo: { color: 'rgba(255,255,255,0.90)', fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
  keepRow: { marginTop: 10, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  keepLabel: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  signOutBtn: { backgroundColor: 'rgba(255,120,120,0.14)', borderColor: 'rgba(255,120,120,0.20)', marginTop: 10 },
  signOutText: { color: 'rgba(255,170,170,0.95)', fontSize: 14, fontWeight: '900', letterSpacing: 0.2 },
});
