import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { audioService } from '../services/audio';
import { useAppState } from '../context/AppState';
import { navigate } from '../navigation';

export default function MiniPlayerBar() {
  const { trackUrl, hasStartedPlayback, isGenerating } = useAppState() as any;
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [visible, setVisible] = useState<boolean>(false);
  const [position, setPosition] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [timelineWidth, setTimelineWidth] = useState<number>(0);
  const lastActiveRef = useRef<number>(0);

  const opacity = useSharedValue(0);
  const slide = useSharedValue(20);
  const wrapStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: slide.value }],
  }));

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (hasStartedPlayback && trackUrl) {
      setVisible(true);
      opacity.value = withTiming(1, { duration: 250 });
      slide.value = withTiming(0, { duration: 250 });
      lastActiveRef.current = Date.now();
      timer = setInterval(async () => {
        try {
          const status: any = await audioService.getStatus();
          const playing = !!(status && status.isLoaded && status.isPlaying);
          setIsPlaying(playing);
          const pos = Math.max(0, status?.positionMillis || 0);
          const dur = Math.max(0, status?.durationMillis || 0);
          setPosition(pos);
          setDuration(dur);
          if (playing) {
            lastActiveRef.current = Date.now();
          } else if (Date.now() - lastActiveRef.current > 3000) {
            opacity.value = withTiming(0, { duration: 200 });
            slide.value = withTiming(20, { duration: 200 });
            setVisible(false);
          }
        } catch {}
      }, 500);
    } else {
      opacity.value = withTiming(0, { duration: 200 });
      slide.value = withTiming(20, { duration: 200 });
      setVisible(false);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [hasStartedPlayback, trackUrl]);

  if (!visible || !trackUrl) return null;

  const onToggle = async () => {
    try {
      if (isPlaying) {
        await audioService.pause();
        setIsPlaying(false);
      } else {
        await audioService.play();
        setIsPlaying(true);
      }
    } catch {}
  };

  const onSeekPress = async (evt: any) => {
    if (!duration || !timelineWidth) return;
    const x = evt?.nativeEvent?.locationX ?? 0;
    const ratio = Math.max(0, Math.min(1, x / timelineWidth));
    const target = Math.floor(duration * ratio);
    try { await audioService.seek(target); } catch {}
  };

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  const dotLeft = Math.max(0, Math.min(1, progress)) * (timelineWidth || 0);

  return (
    <Animated.View style={[styles.wrap, wrapStyle]}>
      {/* Top slider */}
      {!isGenerating && duration > 0 && (
        <Pressable
          style={styles.timeline}
          onPress={onSeekPress}
          onLayout={(e) => setTimelineWidth(e.nativeEvent.layout.width)}
        >
          <View style={[styles.timelineFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.timelineDot, { left: Math.max(0, dotLeft - 6) }]} />
        </Pressable>
      )}
      {/* Control row */}
      <View style={styles.controls}>
        <Pressable style={styles.iconBtn} onPress={() => navigate('Library')} accessibilityLabel="Library">
          <Text style={styles.iconGlyph}>≡</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => audioService.crossfadeToPrev(400)} accessibilityLabel="Previous">
          <Text style={styles.iconGlyph}>⏮</Text>
        </Pressable>
        <Pressable style={styles.bigPlay} onPress={onToggle} accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
          <Text style={styles.bigGlyph}>{isPlaying ? '❚❚' : '▶︎'}</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => audioService.next()} accessibilityLabel="Next">
          <Text style={styles.iconGlyph}>⏭</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => navigate('Favorites')} accessibilityLabel="Favorites">
          <Text style={styles.iconGlyph}>♡</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    height: 86,
    borderRadius: 22,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  timeline: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.12)',
    overflow: 'hidden',
  },
  timelineFill: { height: 3, backgroundColor: '#1b1b1b' },
  timelineDot: {
    position: 'absolute',
    top: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#1b1b1b',
  },
  controls: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  iconGlyph: { color: '#1b1b1b', fontSize: 16, fontWeight: '700' },
  bigPlay: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  bigGlyph: { color: '#1b1b1b', fontSize: 18, fontWeight: '700' },
});