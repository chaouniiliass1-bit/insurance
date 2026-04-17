import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { goBack } from '../navigation';
import GradientBackground from '../components/GradientBackground';
import { useNavigation } from '@react-navigation/native';
import { useAppState } from '../context/AppState';
import { MotiView, AnimatePresence } from 'moti';
import ProfileModal from '../components/ProfileModal';
import { LinearGradient } from 'expo-linear-gradient';
import AppHeader from '../components/AppHeader';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const CATEGORIES: { label: string; items: string[] }[] = [
  { label: 'Popular', items: ['Reggae', 'Jazz', 'Lo-Fi', 'Soul', 'Chillhop', 'Ambient', 'Blues', 'Funk'] },
  { label: 'Electronic', items: ['House', 'Techno', 'Synthwave', 'Trance', 'DnB'] },
  { label: 'Acoustic & Folk', items: ['Folk', 'Indie', 'Country', 'Bluegrass', 'Classical'] },
  { label: 'World & Fusion', items: ['Hip-Hop', 'Upbeat', 'Gnawa', 'Afro', 'Sufi', 'Latin', 'Bossa Nova'] },
];

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export default function GenreSelectionScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { userMood, setGenres, vocalMode, setVocalMode, generateTrack, isGenerating, isRequesting, isPreloading, hasStartedPlayback, statusLabel, profile } = useAppState() as any;
  const [selected, setSelected] = useState<string[]>([]);
  // Only navigate to Player when a fresh generation completes
  const [shouldNavigateOnComplete, setShouldNavigateOnComplete] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  

  const pickPillSize = (label: string) => {
    const n = label.length;
    if (n >= 10) return 'xl';
    if (n >= 7) return 'l';
    if (n <= 4) return 's';
    return 'm';
  };

  const toggleGenre = useCallback((g: string) => {
    setSelected((prev) => {
      if (prev.includes(g)) return prev.filter((x) => x !== g);
      if (prev.length >= 2) return prev;
      return [...prev, g];
    });
  }, []);

  const onGenerate = useCallback(async (g1?: string, g2?: string) => {
    // If explicit genres passed, use them; otherwise use state
    const first = g1 || selected[0];
    const second = g2 || selected[1];

    if (!first || !second) return;
    
    // Enforce single request per click
    if (isGenerating || isRequesting) return;
    
    // Update state if explicit args provided (for UI consistency)
    if (g1 && g2) setSelected([g1, g2]);

    try {
      await setGenres(first, second);
    } catch {}
    console.log('[GenreSelection] Calling generateTrack with:', { mood: userMood ?? 'Chill', first, second });
    // Begin generation; show loading and navigate when playback actually starts
    setShouldNavigateOnComplete(true);
    try {
      await generateTrack(userMood ?? 'Chill', first, second);
      console.log('[GenreSelection] generateTrack call completed');
    } catch (e) {
      console.error('[GenreSelection] generateTrack failed:', e);
      setShouldNavigateOnComplete(false);
    }
  }, [generateTrack, isGenerating, isRequesting, selected, setGenres, userMood]);

  // Removed Test Mode: live-only

  const mood = useMemo(() => userMood ?? 'Default', [userMood]);
  const generating = isGenerating || isPreloading || isRequesting;
  const canGenerateNow = selected.length === 2 && !generating;
  const bottomPad = (insets.bottom || 0) + 160;

  // Navigate to Player immediately when playback starts
  useEffect(() => {
    if (shouldNavigateOnComplete && hasStartedPlayback) {
      // @ts-ignore
      nav.navigate('Player');
      setShouldNavigateOnComplete(false);
    }
  }, [shouldNavigateOnComplete, hasStartedPlayback]);

  // No saved-match button on this screen — it lives on Player

  // No fallback timer — remain on Genre screen until first track arrives

  const randomize = useCallback(() => {
    if (isGenerating || isRequesting) return;
    const allItems = CATEGORIES.flatMap((c) => c.items);
    if (allItems.length < 2) return;
    const first = allItems[Math.floor(Math.random() * allItems.length)];
    let second = allItems[Math.floor(Math.random() * allItems.length)];
    while (second === first) {
      second = allItems[Math.floor(Math.random() * allItems.length)];
    }
    // Update UI
    setSelected([first, second]);
    // Trigger generation immediately with these values
    onGenerate(first, second);
  }, [isGenerating, isRequesting, onGenerate]);

  const Segmented = () => {
    const t = useSharedValue(vocalMode === 'instrumental' ? 1 : 0);
    const [w, setW] = useState(280);
    useEffect(() => {
      t.value = withTiming(vocalMode === 'instrumental' ? 1 : 0, { duration: 320, easing: Easing.out(Easing.cubic) });
    }, [vocalMode, t]);
    const thumbStyle = useAnimatedStyle(() => {
      const x = (w / 2) * t.value;
      return { transform: [{ translateX: x }] };
    });
    return (
      <View
        style={[styles.segWrap, Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px)' } as any) : null]}
        onLayout={(e) => {
          const width = e?.nativeEvent?.layout?.width;
          if (typeof width === 'number' && width > 220) setW(width);
        }}
      >
        <Animated.View style={[styles.segThumb, thumbStyle]} />
        <Pressable style={styles.segHalf} onPress={() => setVocalMode('lyrics')}>
          <Text style={[styles.segText, vocalMode !== 'instrumental' && styles.segTextOn]}>Lyrics</Text>
        </Pressable>
        <Pressable style={styles.segHalf} onPress={() => setVocalMode('instrumental')}>
          <Text style={[styles.segText, vocalMode === 'instrumental' && styles.segTextOn]}>Instrumental</Text>
        </Pressable>
      </View>
    );
  };

  const ctaT = useSharedValue(0);
  useEffect(() => {
    if (!generating) {
      ctaT.value = 0;
      return;
    }
    ctaT.value = 0;
    ctaT.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.cubic) }), -1, false);
  }, [generating, ctaT]);
  const ctaSweepStyle = useAnimatedStyle(() => {
    const x = -220 + ctaT.value * 520;
    const o = 0.55 + 0.35 * Math.sin(ctaT.value * Math.PI);
    return { transform: [{ translateX: x }, { skewX: '-14deg' }], opacity: o };
  });
  const ctaPulseStyle = useAnimatedStyle(() => {
    const s = generating ? 1 + 0.02 * Math.sin(ctaT.value * Math.PI * 2) : 1;
    return { transform: [{ scale: s }] };
  });

  const GlowPill = useCallback(({ label }: { label: string }) => {
    const isOn = selected.includes(label);
    const size = pickPillSize(label);
    const disabled = !isOn && selected.length >= 2;
    return (
      <Pressable
        onPress={() => toggleGenre(label)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.pill,
          size === 's' && styles.pillS,
          size === 'm' && styles.pillM,
          size === 'l' && styles.pillL,
          size === 'xl' && styles.pillXL,
          isOn ? styles.pillOn : styles.pillOff,
          disabled && styles.pillCap,
          pressed && { transform: [{ scale: 0.97 }] },
        ]}
      >
        {isOn ? (
          <>
            <LinearGradient colors={['rgba(58, 96, 255, 0.92)', 'rgba(120, 175, 255, 0.86)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
            <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} start={{ x: 0.1, y: 0.1 }} end={{ x: 0.85, y: 0.8 }} style={StyleSheet.absoluteFillObject} />
          </>
        ) : null}
        <Text style={[styles.pillText, isOn ? styles.pillTextOn : styles.pillTextOff]}>{label}</Text>
      </Pressable>
    );
  }, [selected, toggleGenre]);

  const content = (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <AppHeader onBack={() => goBack()} onProfile={() => setShowProfile(true)} profileAvatarUrl={profile?.avatar_url ?? null} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.title}>Choose your fusion.</Text>
          <Text style={styles.subtitle}>Pick two genres and we’ll craft an exclusive vibe.</Text>
          <View style={styles.heroControls}>
            <Segmented />
            <Pressable onPress={randomize} style={[styles.surpriseBtn, Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px)' } as any) : null]} hitSlop={10}>
              <MaterialIcons name="auto-awesome" size={18} color="rgba(255,255,255,0.95)" />
              <Text style={styles.surpriseText}>Surprise Me</Text>
            </Pressable>
          </View>
          <View style={styles.picksRow}>
            <View style={[styles.pickPill, selected[0] ? styles.pickOn : styles.pickOff]}>
              <Text style={styles.pickText}>{selected[0] || 'First pick'}</Text>
            </View>
            <MaterialIcons name="add" size={16} color="rgba(255,255,255,0.65)" />
            <View style={[styles.pickPill, selected[1] ? styles.pickOn : styles.pickOff]}>
              <Text style={styles.pickText}>{selected[1] || 'Second pick'}</Text>
            </View>
          </View>
        </View>

        {CATEGORIES.map((cat) => (
          <View key={cat.label} style={[styles.section, Platform.OS === 'web' ? ({ backdropFilter: 'blur(22px)' } as any) : null]}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{cat.label}</Text>
              <Text style={styles.sectionHint}>Tap to select</Text>
            </View>
            <View style={styles.pillsCloud}>
              {cat.items.map((g) => (
                <GlowPill key={g} label={g} />
              ))}
            </View>
          </View>
        ))}
        <View style={{ height: 92 }} />
      </ScrollView>

      <Animated.View style={[styles.bottomBar, { bottom: (insets.bottom || 0) + 12 }, ctaPulseStyle]}>
        <Pressable
          style={[styles.ctaBtn, canGenerateNow ? styles.ctaOn : styles.ctaOff]}
          onPress={() => {
            if (generating) return;
            if (selected.length !== 2) {
              setHint('Select two genres first');
              setTimeout(() => setHint(null), 1200);
              return;
            }
            onGenerate();
          }}
          disabled={!canGenerateNow}
        >
          <LinearGradient colors={['rgba(18,24,38,0.92)', 'rgba(11,16,32,0.96)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ctaBase} />
          <LinearGradient colors={['rgba(120, 175, 255, 0.14)', 'rgba(255,255,255,0.06)', 'rgba(120, 175, 255, 0.10)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
          {generating && (
            <AnimatedLinearGradient
              colors={['rgba(255,255,255,0)', 'rgba(160, 190, 255, 0.22)', 'rgba(255,255,255,0.70)', 'rgba(160, 190, 255, 0.22)', 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.ctaSweep, ctaSweepStyle]}
            />
          )}
          <View style={styles.ctaRow}>
            <View style={styles.ctaIcon}>
              <MaterialIcons name="bolt" size={18} color="rgba(255,255,255,0.95)" />
            </View>
            <Text style={styles.ctaText}>{generating ? 'Generating…' : 'Generate My Exclusive Vibe'}</Text>
          </View>
        </Pressable>
        {!!hint && <Text style={styles.hintText}>{hint}</Text>}
        <AnimatePresence>
          {generating && (
            <MotiView
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              exit={{ opacity: 0, translateY: 6 }}
              transition={{ type: 'timing', duration: 260 }}
              style={styles.statusWrap}
              pointerEvents={'none'}
            >
              <Text style={styles.statusText}>{statusLabel || 'Synthesizing your vibe…'}</Text>
            </MotiView>
          )}
        </AnimatePresence>
      </Animated.View>
      {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}
    </SafeAreaView>
  );

  return generating ? (
    <LinearGradient colors={['#0B1020', '#1E273A']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.generatingRoot}>
      {content}
    </LinearGradient>
  ) : (
    <GradientBackground mood={mood}>{content}</GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 10,
  },
  meshWrap: { ...StyleSheet.absoluteFillObject },
  meshOpacity: { ...StyleSheet.absoluteFillObject, opacity: 0.28 },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 140,
    alignItems: 'center',
  },
  generatingRoot: {
    flex: 1,
    backgroundColor: '#0B1020',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  subtitle: { marginTop: 10, color: 'rgba(255,255,255,0.70)', fontSize: 13, fontWeight: '700', textAlign: 'center', letterSpacing: 0.2 },
  hero: { width: '100%', alignItems: 'center', marginBottom: 16 },
  heroControls: { width: '100%', marginTop: 14, alignItems: 'center', gap: 12 },
  surpriseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  surpriseText: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  picksRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickPill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  pickOn: { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(140, 185, 255, 0.22)' },
  pickOff: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.10)' },
  pickText: { color: 'rgba(255,255,255,0.86)', fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  segWrap: {
    width: 280,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  segThumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    width: '50%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(140, 185, 255, 0.24)',
  },
  segHalf: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segText: { color: 'rgba(255,255,255,0.74)', fontSize: 13, fontWeight: '900', letterSpacing: 0.2 },
  segTextOn: { color: '#fff' },
  section: {
    width: '100%',
    borderRadius: 22,
    padding: 14,
    marginTop: 12,
    backgroundColor: 'rgba(18,24,38,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 10 },
  sectionTitle: { color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  sectionHint: { color: 'rgba(255,255,255,0.48)', fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  pillsCloud: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', paddingBottom: 2 },
  pill: {
    borderRadius: 999,
    minHeight: 42,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillS: { paddingHorizontal: 14 },
  pillM: { paddingHorizontal: 16 },
  pillL: { paddingHorizontal: 20 },
  pillXL: { paddingHorizontal: 22 },
  pillOff: { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.14)' },
  pillOn: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(185, 210, 255, 0.44)',
    shadowColor: 'rgba(120, 170, 255, 1)',
    shadowOpacity: 0.42,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
    elevation: 10,
  },
  pillCap: { opacity: 0.45 },
  pillText: { fontSize: 13, fontWeight: '900', letterSpacing: 0.2 },
  pillTextOn: { color: '#fff' },
  pillTextOff: { color: 'rgba(255,255,255,0.86)' },
  bottomBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 16,
    alignItems: 'center',
  },
  ctaBtn: {
    width: '100%',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  ctaOn: { opacity: 1 },
  ctaOff: { opacity: 0.55 },
  ctaBase: { ...StyleSheet.absoluteFillObject },
  ctaSweep: { position: 'absolute', top: 0, bottom: 0, width: 190, left: -190 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, paddingHorizontal: 18 },
  ctaIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 16, textAlign: 'center', letterSpacing: 0.2 },
  hintText: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  statusWrap: { marginTop: 14, paddingHorizontal: 18, maxWidth: 340 },
  statusText: { color: 'rgba(255,255,255,0.86)', fontSize: 13, textAlign: 'center', fontWeight: '600', letterSpacing: 0.2 },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  lottieLarge: {
    width: 260,
    height: 260,
  },
  progressTextContainer: { marginTop: 16 },
  progressText: { color: '#fff', fontSize: 15, opacity: 0.9, textAlign: 'center' },
});
