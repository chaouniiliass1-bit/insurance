import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, type SharedValue, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const { width: W, height: H } = Dimensions.get('window');

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

type Props = {
  active: boolean;
};

type BlobConfig = { size: number; x: number; y: number; o: number; d: number };
type ParticleConfig = { x: number; y: number; s: number; a: number; d: number; dirX: number; dirY: number };

function Blob({ cfg, idx, phase }: { cfg: BlobConfig; idx: number; phase: SharedValue<number> }) {
  const blobStyle = useAnimatedStyle(() => {
    const t = phase.value;
    const dx = Math.sin((t + idx * 0.17) * Math.PI * 2) * W * 0.12 * cfg.d;
    const dy = Math.cos((t + idx * 0.23) * Math.PI * 2) * H * 0.1 * cfg.d;
    const sc = 0.92 + (Math.sin((t + idx * 0.31) * Math.PI * 2) + 1) * 0.06;
    return {
      opacity: cfg.o,
      transform: [{ translateX: cfg.x + dx }, { translateY: cfg.y + dy }, { scale: sc }],
    };
  });
  return (
    <AnimatedLinearGradient
      colors={['rgba(30,39,58,0.0)', 'rgba(98,70,160,0.72)', 'rgba(50,170,170,0.58)']}
      start={{ x: 0.2, y: 0.2 }}
      end={{ x: 0.85, y: 0.9 }}
      style={[
        styles.blob,
        {
          width: cfg.size,
          height: cfg.size,
          borderRadius: cfg.size / 2,
        },
        blobStyle,
      ]}
    />
  );
}

function Particle({ cfg, idx, phase }: { cfg: ParticleConfig; idx: number; phase: SharedValue<number> }) {
  const particleStyle = useAnimatedStyle(() => {
    const t = phase.value;
    const dx = Math.sin((t + idx * 0.11) * Math.PI * 2) * 24 * cfg.d * cfg.dirX;
    const dy = Math.cos((t + idx * 0.09) * Math.PI * 2) * 18 * cfg.d * cfg.dirY;
    const sc = 0.95 + (Math.sin((t + idx * 0.2) * Math.PI * 2) + 1) * 0.05;
    return {
      opacity: cfg.a,
      transform: [{ translateX: cfg.x + dx }, { translateY: cfg.y + dy }, { scale: sc }],
    };
  });
  return (
    <Animated.View
      style={[
        styles.particle,
        {
          width: cfg.s,
          height: cfg.s,
          borderRadius: cfg.s / 2,
        },
        particleStyle,
      ]}
    />
  );
}

export default function AnimatedMeshBackground({ active }: Props) {
  const phase = useSharedValue(0);
  const fade = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    fade.value = withTiming(active ? 1 : 0, { duration: active ? 500 : 420 });
  }, [active, fade]);

  useEffect(() => {
    if (!active) return;
    phase.value = 0;
    phase.value = withRepeat(withTiming(1, { duration: 28000, easing: Easing.linear }), -1, false);
  }, [active, phase]);

  const blobs = useMemo(
    () => [
      { size: Math.max(W, H) * 1.15, x: -W * 0.25, y: -H * 0.15, o: 0.42, d: 1.0 },
      { size: Math.max(W, H) * 0.95, x: W * 0.15, y: -H * 0.1, o: 0.36, d: 1.25 },
      { size: Math.max(W, H) * 1.1, x: -W * 0.15, y: H * 0.2, o: 0.34, d: 1.55 },
      { size: Math.max(W, H) * 0.9, x: W * 0.05, y: H * 0.28, o: 0.28, d: 1.85 },
    ],
    []
  );

  const particles = useMemo(() => {
    const n = 8;
    const out: Array<{ x: number; y: number; s: number; a: number; d: number; dirX: number; dirY: number }> = [];
    for (let i = 0; i < n; i++) {
      out.push({
        x: Math.random() * W,
        y: Math.random() * H,
        s: 10 + Math.random() * 22,
        a: 0.12 + Math.random() * 0.18,
        d: 0.8 + Math.random() * 1.8,
        dirX: Math.random() > 0.5 ? 1 : -1,
        dirY: Math.random() > 0.5 ? 1 : -1,
      });
    }
    return out;
  }, []);

  const wrapStyle = useAnimatedStyle(() => {
    return { opacity: fade.value };
  });

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap, wrapStyle]}>
      <View style={styles.base} />
      {blobs.map((cfg, idx) => (
        <Blob key={`b_${idx}`} cfg={cfg} idx={idx} phase={phase} />
      ))}
      {particles.map((cfg, idx) => (
        <Particle key={`p_${idx}`} cfg={cfg} idx={idx} phase={phase} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#0B1020',
  },
  base: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0B1020',
  },
  blob: {
    position: 'absolute',
  },
  particle: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
});
