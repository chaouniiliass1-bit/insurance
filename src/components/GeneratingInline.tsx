import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

type Props = {
  active: boolean;
};

export default function GeneratingInline({ active }: Props) {
  const rotate = useSharedValue(0);
  const breathe = useSharedValue(0);
  const [dots, setDots] = useState(0);

  useEffect(() => {
    if (!active) return;
    rotate.value = 0;
    rotate.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.linear }), -1, false);
  }, [active, rotate]);

  useEffect(() => {
    if (!active) return;
    breathe.value = 0;
    breathe.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [active, breathe]);

  useEffect(() => {
    if (!active) return;
    setDots(0);
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 180);
    return () => clearInterval(id);
  }, [active]);

  const dotText = useMemo(() => '.'.repeat(dots), [dots]);

  const spinnerStyle = useAnimatedStyle(() => {
    return { transform: [{ rotate: `${rotate.value * 360}deg` }] };
  });

  const auraStyle = useAnimatedStyle(() => {
    const sc = 1 + breathe.value * 0.06;
    const op = 0.55 + breathe.value * 0.22;
    return { opacity: op, transform: [{ scale: sc }] };
  });

  return (
    <View style={styles.wrap}>
      <AnimatedLinearGradient
        colors={['rgba(98,70,160,0.18)', 'rgba(50,170,170,0.14)', 'rgba(255,255,255,0.06)']}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.9, y: 0.9 }}
        style={[styles.aura, auraStyle]}
      />
      <View style={styles.row}>
        <Animated.View style={[styles.spinnerWrap, spinnerStyle]}>
          <MaterialIcons name="bolt" size={18} color="#fff" />
        </Animated.View>
        <Text style={styles.text}>
          Generating{dotText}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aura: {
    position: 'absolute',
    width: '110%',
    height: 62,
    borderRadius: 999,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  spinnerWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

