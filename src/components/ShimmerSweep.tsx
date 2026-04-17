import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

type Props = {
  active: boolean;
  borderRadius?: number;
};

export default function ShimmerSweep({ active, borderRadius = 999 }: Props) {
  const t = useSharedValue(0);
  const fade = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    fade.value = withTiming(active ? 1 : 0, { duration: active ? 220 : 180 });
  }, [active, fade]);

  useEffect(() => {
    if (!active) return;
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false);
  }, [active, t]);

  const sweepStyle = useAnimatedStyle(() => {
    const x = -60 + t.value * 220;
    return {
      opacity: fade.value,
      transform: [{ translateX: x }, { skewX: '-12deg' }],
    };
  });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}>
      <AnimatedLinearGradient
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.sweep, sweepStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 140,
  },
});

