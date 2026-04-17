import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { supabaseApi } from '../api/supabase';
import { View, Text, StyleSheet, Pressable, Platform, Image, Dimensions, PanResponder, Modal, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { audioService } from '../services/audio';
import { useAppState } from '../context/AppState';
import { MaterialIcons } from '@expo/vector-icons';
// Haptics removed to avoid any interruption sounds/vibrations
import Animated, { Easing, useSharedValue, useAnimatedStyle, withTiming, withRepeat } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MoodImages } from '../theme';
import { navigate, goBack } from '../navigation';
import AppHeader from '../components/AppHeader';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import ProfileModal from '../components/ProfileModal';
import AsyncStorage from '@react-native-async-storage/async-storage';

function useTrackPlayerProgress(intervalMs: number) {
  const [state, setState] = useState<{ position: number; duration: number }>({ position: 0, duration: 0 });
  useEffect(() => {
    let mounted = true;
    let timer: any = null;
    let TrackPlayer: any = null;
    let NativeModules: any = null;
    try {
      NativeModules = require('react-native')?.NativeModules;
      TrackPlayer = require('react-native-track-player');
    } catch {
      TrackPlayer = null;
    }
    if (!TrackPlayer || !NativeModules?.TrackPlayer) return () => {};
    timer = setInterval(async () => {
      try {
        const pos = await TrackPlayer.getPosition();
        const dur = await TrackPlayer.getDuration();
        if (mounted) setState({ position: Number(pos || 0), duration: Number(dur || 0) });
      } catch {}
    }, Math.max(250, intervalMs || 500));
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [intervalMs]);
  return state;
}
// Callback-based flow: generation handled via AppState and server callback
// Moti removed from Player: minimalist style without music animation

let Slider: any = null;
try {
  Slider = require('@react-native-community/slider').default;
} catch {}

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export default function PlayerScreen() {
  const route = useRoute<any>();
  const { userMood, genre1, genre2, trackUrl, trackA, trackB, trackCover, trackTitle, trackIdA, trackIdB, hasStartedPlayback, isSecondActive, setSecondActive, credits, isGenerating, statusLabel, generationStartedAtMs, trackAReadyAtMs, trackBReadyAtMs, generateTrack, hasSavedMatch, playSavedMatch, isLiked, toggleLike, addCoins, profile, refreshProfile, connectSocket, disconnectSocket } = useAppState() as any;
  const insets = useSafeAreaInsets();
  const [isPlaying, setIsPlaying] = useState(false);
  const activePlaybackUrl: string | null = (isSecondActive && trackB) ? trackB : trackUrl;
  const activeTrackId: string | null = (isSecondActive ? trackIdB : trackIdA) ? String(isSecondActive ? trackIdB : trackIdA) : null;
  const resumeKey = useMemo(() => (activeTrackId ? `mf_progress_v1_${activeTrackId}` : null), [activeTrackId]);
  const [resumePositionMillis, setResumePositionMillis] = useState<number>(0);
  const resumeAppliedForRef = useRef<string | null>(null);
  const lastPersistAtRef = useRef<number>(0);

  const tp = useTrackPlayerProgress(500);
  const tpPosMs = Math.floor((tp?.position || 0) * 1000);
  const tpDurMs = Math.floor((tp?.duration || 0) * 1000);

  // Navigation Guard: Connect socket onFocus, disconnect onBlur
  useFocusEffect(
    useCallback(() => {
      connectSocket?.();
      return () => {
        disconnectSocket?.();
      };
    }, [connectSocket, disconnectSocket])
  );
  const [canUnlockNext, setCanUnlockNext] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPosition, setSeekPosition] = useState(0);
  const visualPositionMillis = isSeeking ? seekPosition : (duration <= 0 && resumePositionMillis > 0 ? resumePositionMillis : position);
  const [savedAvailable, setSavedAvailable] = useState<boolean>(false);
  const [timelineWidth, setTimelineWidth] = useState<number>(0);
  const [showProfile, setShowProfile] = useState(false);
  const [showBuy, setShowBuy] = useState(false);
  const [showCongrats, setShowCongrats] = useState(false);
  const [showGenMenu, setShowGenMenu] = useState(false);
  const lastLogRef = useRef<number>(0);
  const trackFade = useSharedValue(1);
  // Next-track generation now uses global callback flow
  // Mood image crossfade state
  const prevImageRef = useRef<string | null>(null);
  const imageProgress = useSharedValue(1);
  const moodLabel = userMood ?? 'Default';
  const moodImageUrl = MoodImages[moodLabel] ?? MoodImages.Default;
  const coverUrl = typeof trackCover === 'string' && trackCover.startsWith('http') ? trackCover : null;
  const stableCoverRef = useRef<string | null>(null);
  useEffect(() => {
    if (coverUrl) stableCoverRef.current = coverUrl;
  }, [coverUrl]);
  const currentImageUrl = coverUrl ?? stableCoverRef.current ?? moodImageUrl;
  const imageTopStyle = useAnimatedStyle(() => ({ opacity: imageProgress.value }));
  const imageBottomStyle = useAnimatedStyle(() => ({ opacity: 1 - imageProgress.value }));
  const screenW = Dimensions.get('window').width;
  const coverSize = Math.min(Math.floor(screenW * 0.82), 420);

  // Title fade-in
  const titleOpacity = useSharedValue(0.95);
  const titleAnimatedStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value }));
  useEffect(() => {
    titleOpacity.value = withTiming(1, { duration: 600 });
  }, [activePlaybackUrl, isPlaying]);

  // No fallback pool: single-provider app (Suno-only)

  useEffect(() => {
    // reflect play/pause into other animated elements if needed
  }, [isPlaying]);

  useEffect(() => {
    setPosition(0);
    setDuration(0);
    setIsPlaying(false);
    isSeekingRef.current = false;
    setIsSeeking(false);
    seekPositionRef.current = 0;
    setSeekPosition(0);
  }, [activePlaybackUrl]);

  const positionRef = useRef(0);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // Playback is owned by AppState (strict cleanup + load/play on selection/generation)

  // Overlay fade handled by Moti; no explicit reanimated hook needed here

  // Log new track metadata when URL changes
  useTrackLogger(activePlaybackUrl, userMood, genre1, genre2);
  useEffect(() => {
    if (activePlaybackUrl) {
      console.log(`Playing from source: ${activePlaybackUrl}`);
    }
  }, [activePlaybackUrl]);

  // Crossfade mood image when mood changes
  useEffect(() => {
    if (!prevImageRef.current) {
      prevImageRef.current = currentImageUrl;
      imageProgress.value = 1;
      return;
    }
    if (prevImageRef.current !== currentImageUrl) {
      imageProgress.value = 0;
      prevImageRef.current = currentImageUrl;
      imageProgress.value = withTiming(1, { duration: 2000 });
    }
  }, [currentImageUrl]);

  useEffect(() => {
    audioService.configure();
    audioService.setStatusListener((status) => {
      if ('isLoaded' in status && status.isLoaded) {
        const nextDur = typeof status.durationMillis === 'number' && Number.isFinite(status.durationMillis) ? status.durationMillis : 0;
        const nextPos = typeof status.positionMillis === 'number' && Number.isFinite(status.positionMillis) ? status.positionMillis : 0;
        setDuration(nextDur > 0 ? nextDur : 0);
        // @ts-ignore
        setIsPlaying(!!status.isPlaying);
        if (!isSeekingRef.current) {
          setPosition(nextPos > 0 ? nextPos : 0);
        }

        // Quiet production: avoid noisy seek and finish logs
      }
    });
  }, []);

  useEffect(() => {
    if (tpDurMs > 0) {
      setDuration(tpDurMs);
      if (!isSeekingRef.current) {
        setPosition(tpPosMs > 0 ? tpPosMs : 0);
      }
    }
  }, [tpDurMs, tpPosMs]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!resumeKey) {
          if (alive) setResumePositionMillis(0);
          return;
        }
        const raw = await AsyncStorage.getItem(resumeKey);
        const n = raw ? Number(raw) : 0;
        if (alive) setResumePositionMillis(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
      } catch {
        if (alive) setResumePositionMillis(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [resumeKey]);

  useEffect(() => {
    if (!activeTrackId || !activePlaybackUrl) return;
    if (!resumePositionMillis || resumePositionMillis <= 0) return;
    if (resumeAppliedForRef.current === activeTrackId) return;
    resumeAppliedForRef.current = activeTrackId;
    try {
      if (!isSeekingRef.current) setPosition(resumePositionMillis);
    } catch {}
    void audioService.seek(resumePositionMillis);
  }, [activeTrackId, activePlaybackUrl, resumePositionMillis]);

  useEffect(() => {
    if (!resumeKey || !activeTrackId) return;
    const id = setInterval(() => {
      const now = Date.now();
      if (now - lastPersistAtRef.current < 3500) return;
      lastPersistAtRef.current = now;
      const pos = isSeekingRef.current ? seekPositionRef.current : positionRef.current;
      if (!pos || pos <= 0) return;
      void AsyncStorage.setItem(resumeKey, String(Math.floor(pos)));
    }, 4000);
    return () => clearInterval(id);
  }, [resumeKey, activeTrackId]);

  useEffect(() => {
    if (!activePlaybackUrl) return;
    void audioService.getStatus().then((status: any) => {
      if (!status || !status.isLoaded) return;
      const nextDur = typeof status.durationMillis === 'number' && Number.isFinite(status.durationMillis) ? status.durationMillis : 0;
      const nextPos = typeof status.positionMillis === 'number' && Number.isFinite(status.positionMillis) ? status.positionMillis : 0;
      setDuration(nextDur > 0 ? nextDur : 0);
      setIsPlaying(!!status.isPlaying);
      if (!isSeekingRef.current) {
        setPosition(nextPos > 0 ? nextPos : 0);
      }
    }).catch(() => {});
  }, [activePlaybackUrl]);

  // Animated pulse for Unlock button while waiting
  const toggleScale = useSharedValue(1);
  const toggleAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: toggleScale.value }] }));
  const toggleIcon = isSecondActive ? 'skip-previous' : 'skip-next';
  const liked = isLiked(activePlaybackUrl);

  const shimmer = useSharedValue(0);
  const shimmerStyle = useAnimatedStyle(() => {
    const barW = Math.max(1, timelineWidth || 0);
    const sweepW = Math.max(140, Math.floor(barW * 0.45));
    const x = (-sweepW) + (barW + sweepW * 2) * shimmer.value;
    return {
      transform: [{ translateX: x }, { skewX: '-12deg' }],
      opacity: 0.88,
    };
  });

  const lastARef = useRef<string | null>(null);
  const lastBRef = useRef<string | null>(null);

  // Enable unlock once second track is preloaded; pulse while waiting
  useEffect(() => {
    let mounted = true;
    if (!hasStartedPlayback || !trackB) {
      setCanUnlockNext(false);
      toggleScale.value = 1;
      return () => { mounted = false; };
    }
    toggleScale.value = withRepeat(withTiming(1.03, { duration: 1200 }), -1, true);
    (async () => {
      try {
        if (!audioService.hasNextPreloaded()) {
          await audioService.preloadNext(trackB);
        }
        if (mounted) setCanUnlockNext(!!trackB && audioService.hasNextPreloaded());
      } catch {
        if (mounted) setCanUnlockNext(false);
      }
    })();
    return () => {
      mounted = false;
      toggleScale.value = 1;
    };
  }, [hasStartedPlayback, trackB]);

  useEffect(() => {
    if (isGenerating) {
      lastARef.current = null;
      lastBRef.current = null;
    }
  }, [isGenerating]);

  useEffect(() => {
    if (trackA && trackA !== lastARef.current) lastARef.current = trackA;
  }, [trackA]);

  useEffect(() => {
    if (trackB && trackB !== lastBRef.current) lastBRef.current = trackB;
  }, [trackB]);

  useEffect(() => {
    const pending = !!activePlaybackUrl && duration <= 0;
    if (pending) {
      shimmer.value = 0;
      shimmer.value = withRepeat(withTiming(1, { duration: 1350, easing: Easing.linear }), -1, false);
    } else {
      shimmer.value = 0;
    }
  }, [activePlaybackUrl, duration]);

  // Track active selection when current trackUrl changes
  // Removed: no active index or second track handling in minimalist player

  // No local refs needed for balance/generation here

  // Do not auto-generate here. Generation must happen only from the
  // "Generate My Vibe" button to avoid multiple Suno API prompts per click.
  // This prevents duplicate requests on navigation or re-render.

  const onPlayPause = async () => {
    const status: any = await audioService.getStatus().catch(() => null);
    if (!(status && status.isLoaded)) return;
    if (status.isPlaying) {
      await audioService.pause();
      setIsPlaying(false);
    } else {
      await audioService.play();
      setIsPlaying(true);
      console.log('[Player] Playback started');
    }
  };

  const onToggleLike = async () => {
    try { await toggleLike(activePlaybackUrl); } catch {}
  };

  const onStop = async () => {
    await audioService.stop();
    setIsPlaying(false);
    // Silent in production
  };

  const onToggleVibe = async () => {
    if (!canUnlockNext) return;
    try {
      if (isSecondActive) {
        await audioService.crossfadeToPrev(800);
        setSecondActive(false);
      } else {
        if (trackB && !audioService.hasNextPreloaded()) {
          try { await audioService.preloadNext(trackB); } catch {}
        }
        await audioService.crossfadeToNext(800);
        setSecondActive(true);
      }
      setIsPlaying(true);
    } catch {}
  };

  // Removed seeking; UI focuses on play/pause/stop and optional unlock

  // Title suffix: always Suno
  const title = userMood && genre1 && genre2 ? `Your ${userMood} ${genre1}-${genre2} Very Exclusive Vibe` : 'MoodFusion Player';
  const twoMoreDisabled = (credits || 0) <= 0 || !!isGenerating;
  const twoMoreLabel = isGenerating
    ? 'Mastering your new vibes…'
    : (credits || 0) > 0
      ? 'Generate Two More Vibes'
      : 'Unlock Unlimited Vibes — Subscribe';

  const genMenuProgress = useSharedValue(0);
  useEffect(() => {
    genMenuProgress.value = withTiming(showGenMenu ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [showGenMenu]);
  const genMenuSheetStyle = useAnimatedStyle(() => {
    const y = 34 * (1 - genMenuProgress.value);
    return { transform: [{ translateY: y }], opacity: genMenuProgress.value };
  });

  // Gentle pulse on the generate-more button while generation is in progress
  const genScale = useSharedValue(1);
  const genAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: genScale.value }] }));
  // Coin shine animation for the last credit
  const coinScale = useSharedValue(1);
  const coinOpacity = useSharedValue(1);
  const coinAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: coinScale.value }],
    opacity: coinOpacity.value,
  }));
  // Gentle pulse for disabled Buy Coins CTA
  const buyPulse = useSharedValue(1);
  const buyPulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: buyPulse.value }] }));
  useEffect(() => {
    if (isGenerating) {
      genScale.value = withRepeat(withTiming(1.05, { duration: 900 }), -1, true);
    } else {
      genScale.value = 1;
    }
  }, [isGenerating]);

  const lastCreditsRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = lastCreditsRef.current;
    lastCreditsRef.current = credits ?? null;
    // Trigger shine when a coin is spent and we reach exactly 1
    if (typeof prev === 'number' && typeof credits === 'number' && prev > credits && credits === 1) {
      coinOpacity.value = 0.8;
      coinScale.value = 1.0;
      coinOpacity.value = withTiming(1, { duration: 400 });
      coinScale.value = withRepeat(withTiming(1.08, { duration: 600 }), 2, true);
    }
  }, [credits]);

  useEffect(() => {
    if ((credits || 0) === 0) {
      buyPulse.value = withRepeat(withTiming(1.03, { duration: 1400 }), -1, true);
    } else {
      buyPulse.value = 1;
    }
  }, [credits]);

  const onGenerateMore = async () => {
    if (twoMoreDisabled) return;
    try { await generateTrack(); } catch {}
  };

  const PACKS = [
    { name: 'Starter Pack', price: 2.99, coins: 20 },
    { name: 'Vibe Pack', price: 4.99, coins: 50 },
    { name: 'Creator Pack', price: 9.99, coins: 120 },
    { name: 'Power Pack', price: 19.99, coins: 300 },
  ];

  // Saved-match availability when credits are out
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if ((credits || 0) > 0) { setSavedAvailable(false); return; }
      if (!userMood || !genre1 || !genre2) { setSavedAvailable(false); return; }
      const ok = await hasSavedMatch(userMood, genre1, genre2);
      if (!cancelled) setSavedAvailable(ok);
    })();
    return () => { cancelled = true; };
  }, [credits, userMood, genre1, genre2]);

  const onPlaySaved = async () => {
    if (!savedAvailable || !userMood || !genre1 || !genre2) return;
    await playSavedMatch(userMood, genre1, genre2);
  };

  const msToTime = (ms: number) => {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '00:00';
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const onSliderValueChange = useCallback((sec: number) => {
    if (!duration || duration <= 0) return;
    const target = Math.max(0, Math.floor(sec)) * 1000;
    isSeekingRef.current = true;
    seekPositionRef.current = target;
    setIsSeeking(true);
    setSeekPosition(target);
  }, [duration]);

  const onSliderComplete = useCallback(async (sec: number) => {
    if (!duration || duration <= 0) return;
    const target = Math.max(0, Math.floor(sec)) * 1000;
    seekPositionRef.current = target;
    try {
      await audioService.seek(target);
      setPosition(target);
    } catch {}
    isSeekingRef.current = false;
    setIsSeeking(false);
  }, [duration]);

  const timelineTouchRef = useRef<View | null>(null);
  const timelineXRef = useRef(0);
  const timelineWRef = useRef(0);
  const isSeekingRef = useRef(false);
  const seekPositionRef = useRef(0);

  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  const refreshTimelineMetrics = useCallback(() => {
    timelineTouchRef.current?.measureInWindow((x, _y, width) => {
      timelineXRef.current = x;
      timelineWRef.current = width || 0;
      if (typeof width === 'number' && width > 0) setTimelineWidth(width);
    });
  }, []);

  const updateSeekPreviewFromLocalX = useCallback((localX: number) => {
    const width = timelineWRef.current || timelineWidth || 0;
    if (!duration || !width) return;
    const ratio = clamp01(localX / width);
    const target = Math.floor(duration * ratio);
    seekPositionRef.current = target;
    setSeekPosition(target);
  }, [duration, timelineWidth]);

  const beginSeeking = useCallback((localX: number) => {
    if (!duration) return;
    isSeekingRef.current = true;
    setIsSeeking(true);
    updateSeekPreviewFromLocalX(localX);
  }, [duration, updateSeekPreviewFromLocalX]);

  const endSeeking = useCallback(async () => {
    if (!duration) return;
    const target = seekPositionRef.current;
    try {
      await audioService.seek(target);
      setPosition(target);
    } catch {}
    isSeekingRef.current = false;
    setIsSeeking(false);
  }, [duration]);

  const timelinePanResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !!activePlaybackUrl && duration > 0,
      onMoveShouldSetPanResponder: () => !!activePlaybackUrl && duration > 0,
      onPanResponderGrant: (evt) => {
        refreshTimelineMetrics();
        const localX = evt?.nativeEvent?.locationX ?? 0;
        beginSeeking(localX);
      },
      onPanResponderMove: (evt) => {
        const pageX = evt?.nativeEvent?.pageX;
        if (typeof pageX === 'number' && (timelineWRef.current || timelineWidth)) {
          const localX = pageX - timelineXRef.current;
          updateSeekPreviewFromLocalX(localX);
        } else {
          const localX = evt?.nativeEvent?.locationX ?? 0;
          updateSeekPreviewFromLocalX(localX);
        }
      },
      onPanResponderRelease: () => {
        void endSeeking();
      },
      onPanResponderTerminate: () => {
        void endSeeking();
      },
      onPanResponderTerminationRequest: () => true,
      onShouldBlockNativeResponder: () => false,
    });
  }, [activePlaybackUrl, beginSeeking, duration, endSeeking, refreshTimelineMetrics, timelineWidth, updateSeekPreviewFromLocalX]);


  // Refresh profile from cloud on mount
  useEffect(() => {
    refreshProfile?.().catch(() => {});
  }, []);

  // Auto-open profile modal when route param is set
  useEffect(() => {
    try {
      // @ts-ignore
      if (route?.params?.showProfile) setShowProfile(true);
    } catch {}
  }, [route]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <AppHeader onBack={() => goBack()} onProfile={() => setShowProfile(true)} profileAvatarUrl={profile?.avatar_url ?? null} />
        <ScrollView
          style={{ flex: 1, alignSelf: 'stretch' }}
          contentContainerStyle={{ paddingBottom: (insets.bottom || 0) + 160 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.imageWrap, { width: coverSize, aspectRatio: 1 }]}>
            <Animated.View style={[StyleSheet.absoluteFillObject, imageBottomStyle]}>
              <Image source={{ uri: prevImageRef.current || currentImageUrl }} style={styles.image} resizeMode="cover" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFillObject, imageTopStyle]}>
              <Image source={{ uri: currentImageUrl }} style={styles.image} resizeMode="cover" />
            </Animated.View>
          </View>

          <View style={styles.deck}>
            {!!(trackTitle || title) && (
              <Animated.View style={[titleAnimatedStyle]}>
                <Text style={styles.trackTitle} numberOfLines={1}>
                  {trackTitle || title}
                </Text>
              </Animated.View>
            )}

            {!!activePlaybackUrl && (
              <View style={styles.timelineWrap}>
                {duration > 0 ? (
                  <>
                    {Platform.OS !== 'web' ? (
                      <View style={styles.sliderWrap}>
                        {Slider ? (
                          <Slider
                            minimumValue={0}
                            maximumValue={Math.max(0, Math.floor(duration / 1000))}
                            step={1}
                            value={Math.max(0, Math.floor(((visualPositionMillis || 0) / 1000)))}
                            onValueChange={onSliderValueChange}
                            onSlidingComplete={onSliderComplete}
                            minimumTrackTintColor={'rgba(255, 170, 115, 0.95)'}
                            maximumTrackTintColor={'rgba(255,255,255,0.22)'}
                            thumbTintColor={'#ffffff'}
                          />
                        ) : (
                          <View
                            style={styles.timelineBarPending}
                            onLayout={(e) => {
                              const width = e?.nativeEvent?.layout?.width;
                              if (typeof width === 'number' && width > 0) {
                                timelineWRef.current = width;
                                setTimelineWidth(width);
                              }
                            }}
                          >
                            <LinearGradient
                              colors={['rgba(92, 115, 255, 0.16)', 'rgba(255,255,255,0.06)', 'rgba(92, 115, 255, 0.12)']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 0 }}
                              style={StyleSheet.absoluteFillObject}
                            />
                            <AnimatedLinearGradient
                              colors={['rgba(255,255,255,0)', 'rgba(165, 198, 255, 0.18)', 'rgba(255,255,255,0.95)', 'rgba(165, 198, 255, 0.18)', 'rgba(255,255,255,0)']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 0 }}
                              style={[styles.timelineShimmerSoft, { width: Math.max(140, Math.floor((timelineWidth || 0) * 0.45)) }, shimmerStyle]}
                            />
                          </View>
                        )}
                      </View>
                    ) : (
                      <View
                        ref={timelineTouchRef}
                        style={styles.timelineTouch}
                        onLayout={(e) => {
                          const width = e?.nativeEvent?.layout?.width;
                          if (typeof width === 'number' && width > 0) {
                            timelineWRef.current = width;
                            setTimelineWidth(width);
                          }
                          refreshTimelineMetrics();
                        }}
                        {...timelinePanResponder.panHandlers}
                      >
                        {(() => {
                          const shownPos = visualPositionMillis;
                          const progress = duration > 0 ? clamp01(shownPos / duration) : 0;
                          const dotLeft = progress * (timelineWidth || 0);
                          return (
                            <View style={styles.timelineBar}>
                              <View style={[styles.timelineFill, { width: `${progress * 100}%` }]} />
                              <View style={[styles.timelineDot, { left: Math.max(0, dotLeft - 5) }]} />
                            </View>
                          );
                        })()}
                      </View>
                    )}
                    <View style={styles.timeRow}>
                      <Text style={styles.timeText}>{msToTime(visualPositionMillis)}</Text>
                      <Text style={styles.timeText}>{msToTime(duration)}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View
                      style={styles.timelineBarPending}
                      onLayout={(e) => {
                        const width = e?.nativeEvent?.layout?.width;
                        if (typeof width === 'number' && width > 0) {
                          timelineWRef.current = width;
                          setTimelineWidth(width);
                        }
                      }}
                    >
                      <LinearGradient
                        colors={['rgba(92, 115, 255, 0.16)', 'rgba(255,255,255,0.06)', 'rgba(92, 115, 255, 0.12)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                      <AnimatedLinearGradient
                        colors={['rgba(255,255,255,0)', 'rgba(165, 198, 255, 0.18)', 'rgba(255,255,255,0.95)', 'rgba(165, 198, 255, 0.18)', 'rgba(255,255,255,0)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.timelineShimmerSoft, { width: Math.max(140, Math.floor((timelineWidth || 0) * 0.45)) }, shimmerStyle]}
                      />
                    </View>
                    <View style={styles.timeRow}>
                      <Text style={styles.timeText}>--:--</Text>
                      <Text style={styles.timeText}>--:--</Text>
                    </View>
                  </>
                )}

                {isGenerating && (
                  <View style={styles.pendingRow}>
                    {(() => {
                      const base = typeof generationStartedAtMs === 'number' ? generationStartedAtMs : Date.now();
                      const aAt = typeof trackAReadyAtMs === 'number' ? trackAReadyAtMs : null;
                      const bAt = typeof trackBReadyAtMs === 'number' ? trackBReadyAtMs : null;
                      const aDeltaMs = aAt ? Math.max(0, aAt - base) : null;
                      const bDeltaMs = bAt ? Math.max(0, bAt - base) : null;
                      const aText = aAt ? `A ${msToTime(aDeltaMs || 0)}` : 'A --:--';
                      const bText = bAt ? `B ${msToTime(bDeltaMs || 0)}` : 'B --:--';
                      return (
                        <>
                          <View style={[styles.readyPill, aAt ? styles.readyPillOn : styles.readyPillOff]}>
                            <View style={[styles.readyDot, aAt ? styles.readyDotOn : styles.readyDotOff]} />
                            <Text style={styles.readyText}>{aText}</Text>
                          </View>
                          <View style={[styles.readyPill, bAt ? styles.readyPillOn : styles.readyPillOff]}>
                            <View style={[styles.readyDot, bAt ? styles.readyDotOn : styles.readyDotOff]} />
                            <Text style={styles.readyText}>{bText}</Text>
                          </View>
                        </>
                      );
                    })()}
                  </View>
                )}
              </View>
            )}

            <View style={styles.coreRow}>
              <View style={styles.coreSide} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                style={[styles.playFab, !activePlaybackUrl && styles.playFabDisabled]}
                onPress={onPlayPause}
                disabled={!activePlaybackUrl}
              >
                <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={34} color="#0f1626" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={liked ? 'Unlike track' : 'Like track'}
                style={styles.likeFab}
                onPress={onToggleLike}
                disabled={!activePlaybackUrl}
                hitSlop={10}
              >
                <MaterialIcons name={liked ? 'favorite' : 'favorite-border'} size={22} color="#ffffff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.secondaryRow}>
            <Animated.View style={[toggleAnimatedStyle]}>
              <Pressable style={[styles.secondaryBtn, !canUnlockNext && styles.secondaryDisabled]} onPress={onToggleVibe} disabled={!canUnlockNext}>
                <Text style={styles.secondaryText}>{isSecondActive ? 'Back to Previous Vibe' : 'Play Your Second Vibe'}</Text>
              </Pressable>
            </Animated.View>
            <Pressable style={styles.secondaryBtn} onPress={() => navigate('Library')}>
              <View style={styles.secondaryInner}>
                <MaterialIcons name="library-music" size={18} color="rgba(255,255,255,0.92)" />
                <Text style={styles.secondaryText}>Library</Text>
              </View>
            </Pressable>
          </View>

          {!!statusLabel && <Text style={styles.statusText}>{statusLabel}</Text>}
        </ScrollView>

        {/* Bottom fixed CTA: when coins available show Generate; when out, show Play Saved and Buy Coins pulse. */}
        <Animated.View style={[styles.generateMoreWrap, { bottom: (insets.bottom || 0) + 12 }, genAnimatedStyle]}>
          {(credits || 0) > 0 ? (
            <Pressable style={[styles.generateMoreBtn, twoMoreDisabled ? styles.generateDisabled : styles.generateEnabled]}
              onPress={() => setShowGenMenu(true)} disabled={twoMoreDisabled}
            >
              <Text style={styles.generateText}>{twoMoreLabel}</Text>
              <Animated.View style={[styles.coinWrap, coinAnimatedStyle]}>
                <Text style={styles.coinIcon}>🪙</Text>
                <Text style={styles.coinText}>{Math.max(0, credits || 0)}</Text>
              </Animated.View>
            </Pressable>
          ) : (
            <View style={{ width: '100%' }}>
              <Animated.View style={buyPulseStyle}>
                <Pressable style={styles.buyBanner} onPress={() => setShowBuy(true)}>
                  <View style={styles.buyBannerInner}>
                    <Text style={styles.buyBannerIcon}>💎</Text>
                    <Text style={styles.buyBannerText}>Buy More Coins to Continue</Text>
                  </View>
                </Pressable>
              </Animated.View>
            </View>
          )}
        </Animated.View>

        {/* Minimalist: remove dark/light mode explanatory text */}

        {/* Profile Modal */}
        {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}

        {/* Buy Coins Modal */}
        {showBuy && (
          <View style={styles.modalOverlay}>
            <View style={styles.buyModal}>
              <Pressable style={styles.modalClose} onPress={() => setShowBuy(false)}><Text style={styles.modalCloseText}>✕</Text></Pressable>
              <Text style={styles.buyTitle}>Refill Your Vibes</Text>
              <Text style={styles.buyDesc}>Choose a pack to continue creating smooth vibes.</Text>
              {PACKS.map((p) => (
                <Pressable key={p.name} style={styles.packCard} onPress={async () => {
                  try {
                    await addCoins(p.coins, p.name, p.price);
                    setShowBuy(false);
                    setShowCongrats(true);
                    setTimeout(() => setShowCongrats(false), 1600);
                  } catch {}
                }}>
                  <Text style={styles.packTitle}>{p.name}</Text>
                  <Text style={styles.packMeta}>{`+$${p.price.toFixed(2)} • +${p.coins} coins`}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {showCongrats && (
          <View style={styles.toastWrap}><Text style={styles.toastText}>✨ Coins Added Successfully!</Text></View>
        )}
        <Modal visible={showGenMenu} transparent animationType="fade" onRequestClose={() => setShowGenMenu(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setShowGenMenu(false)}>
            <Pressable style={styles.menuSheetTouch} onPress={() => {}}>
              <Animated.View style={[styles.menuSheet, genMenuSheetStyle]}>
                <Pressable
                  style={styles.menuOption}
                  onPress={async () => {
                    setShowGenMenu(false);
                    await onGenerateMore();
                  }}
                  disabled={twoMoreDisabled}
                >
                  <Text style={styles.menuTitle}>Re-roll with Same Genres</Text>
                  <Text style={styles.menuSub}>Generate again using your current mix</Text>
                </Pressable>
                <View style={styles.menuDivider} />
                <Pressable
                  style={styles.menuOption}
                  onPress={() => {
                    setShowGenMenu(false);
                    navigate('GenreSelection');
                  }}
                >
                  <Text style={styles.menuTitle}>Change My Mix</Text>
                  <Text style={styles.menuSub}>Pick a new fusion pair</Text>
                </Pressable>
              </Animated.View>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

// Hook to log new track metadata whenever trackUrl changes
// We place it after the component to keep logging logic isolated
export function useTrackLogger(trackUrl: string | null, userMood: string | null, genre1: string | null, genre2: string | null) {
  const lastUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (trackUrl && trackUrl !== lastUrlRef.current) {
      lastUrlRef.current = trackUrl;
    }
  }, [trackUrl, userMood, genre1, genre2]);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1E273A',
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    color: '#f8f5f0',
    textAlign: 'center',
    marginBottom: 6,
  },
  trackTitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
    marginBottom: 10,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
  },
  controls: {
    flexDirection: 'row',
    marginTop: 18,
    gap: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIcon: {
    position: 'absolute',
    right: 18,
    top: 54,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.36)',
    shadowColor: 'transparent',
  },
  backIcon: {
    position: 'absolute',
    left: 18,
    top: 54,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.36)',
    shadowColor: 'transparent',
  },
  deck: {
    width: '100%',
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  coreRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coreSide: {
    width: 44,
    height: 44,
  },
  playFab: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playFabDisabled: {
    opacity: 0.45,
  },
  likeFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  heartBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  textButton: {
    minWidth: 240,
    height: 56,
    borderRadius: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  textButtonSmall: {
    minWidth: 220,
    height: 50,
    borderRadius: 26,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  iconLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textButtonLabel: {
    color: '#1b1b1b',
    fontSize: 16,
    fontWeight: '600',
  },
  primary: {
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  disabled: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressText: { color: '#fff', fontSize: 15, opacity: 0.9, textAlign: 'center' },
  animationContainer: {
    alignSelf: 'center',
    marginTop: 12,
  },
  timeRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  timeText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
  },
  timelineWrap: {
    width: '100%',
    alignSelf: 'center',
    marginTop: 0,
  },
  sliderWrap: {
    width: '100%',
    justifyContent: 'center',
  },
  timelineTouch: {
    height: 34,
    justifyContent: 'center',
  },
  timelineBar: {
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  timelineBarPending: {
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  timelineShimmerSoft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  timelineFill: {
    height: 2,
    backgroundColor: 'rgba(255, 170, 115, 0.85)',
  },
  timelineDot: {
    position: 'absolute',
    top: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 115, 0.85)',
  },
  imageWrap: {
    borderRadius: 26,
    overflow: 'hidden',
    marginTop: 16,
    marginBottom: 0,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  secondaryRow: {
    width: '100%',
    marginTop: 14,
    gap: 10,
  },
  secondaryBtn: {
    width: '100%',
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  secondaryDisabled: {
    opacity: 0.45,
  },
  secondaryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '700',
  },
  pendingRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  readyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  readyPillOn: {
    backgroundColor: 'rgba(46, 204, 113, 0.10)',
    borderColor: 'rgba(46, 204, 113, 0.22)',
  },
  readyPillOff: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  readyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  readyDotOn: {
    backgroundColor: 'rgba(46, 204, 113, 0.95)',
  },
  readyDotOff: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  readyText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  switchButton: {
    minWidth: 210,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  switchButtonLabel: {
    color: '#1b1b1b',
    fontSize: 14,
    fontWeight: '700',
  },
  
  creditRow: {
    marginTop: 10,
  },
  creditText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
  },
  generateMoreWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 24,
    alignItems: 'center',
  },
  generateMoreBtn: {
    alignSelf: 'stretch',
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginTop: 0,
  },
  generateEnabled: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  generateDisabled: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  buyPulseWrap: {
    transform: [{ scale: 1.02 }],
  },
  generateText: {
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 16,
  },
  coinWrap: {
    position: 'absolute',
    right: 18,
    top: '50%',
    transform: [{ translateY: -12 }],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coinIcon: {
    fontSize: 16,
  },
  coinText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '600',
  },
  buyBanner: {
    alignSelf: 'stretch',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  buyBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buyBannerIcon: {
    color: 'rgba(140, 185, 255, 0.95)',
    fontSize: 14,
  },
  buyBannerText: {
    color: 'rgba(140, 185, 255, 0.95)',
    fontSize: 14,
    fontWeight: '700',
  },
  statusText: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Modals
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileModal: {
    width: '88%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    padding: 16,
  },
  buyModal: {
    width: '88%',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    padding: 16,
  },
  modalClose: { position: 'absolute', right: 12, top: 10, padding: 6 },
  modalCloseText: { color: '#1b1b1b', fontSize: 16 },
  profileHeader: { alignItems: 'center', marginBottom: 10 },
  avatarCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.06)' },
  avatarEmoji: { fontSize: 30 },
  nickname: { marginTop: 8, color: '#1b1b1b', fontSize: 18, fontWeight: '600' },
  coinRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  coinTextDark: { color: '#1b1b1b', fontSize: 16, fontWeight: '600' },
  cloudStatus: { marginTop: 6, color: '#555', fontSize: 12 },
  modalBtn: { marginTop: 10, borderRadius: 14, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.06)' },
  modalBtnText: { color: '#1b1b1b', fontSize: 15, fontWeight: '600' },
  retryBtn: { marginTop: 10, borderRadius: 14, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(217,48,37,0.12)' },
  retryText: { color: '#d93025', fontSize: 15, fontWeight: '600' },
  buyTitle: { color: '#1b1b1b', fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  buyDesc: { color: '#1b1b1b', fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 10 },
  packCard: { borderRadius: 14, padding: 12, backgroundColor: 'rgba(0,0,0,0.06)', marginVertical: 6 },
  packTitle: { color: '#1b1b1b', fontSize: 16, fontWeight: '600' },
  packMeta: { color: '#1b1b1b', fontSize: 13, marginTop: 4 },
  toastWrap: { position: 'absolute', bottom: 90, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  toastText: { color: '#1b1b1b', fontWeight: '600' },
  menuOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  menuSheetTouch: { width: '100%' },
  menuSheet: { width: '100%', paddingTop: 10, paddingBottom: 18, paddingHorizontal: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: 'rgba(18,24,38,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  menuOption: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 14 },
  menuTitle: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  menuSub: { color: 'rgba(255,255,255,0.72)', fontSize: 12, marginTop: 4, fontWeight: '600' },
  menuDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.10)', marginVertical: 8, marginHorizontal: 10 },
});

// Removed time formatting as we no longer show a time bar

// Music animation removed for minimalist modern style on Android and iOS
