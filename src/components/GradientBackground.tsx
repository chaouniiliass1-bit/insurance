import React, { useEffect, useMemo, useRef } from 'react';
import { StyleProp, ViewStyle, ColorValue, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { MoodGradients } from '../theme';

type Props = {
  mood?: keyof typeof MoodGradients | string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

// Align with expo-linear-gradient props: at least two colors, readonly tuple
type GradientColors = readonly [ColorValue, ColorValue, ...ColorValue[]];
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export default function GradientBackground({ mood = 'Default', style, children }: Props) {
  const currentColors: GradientColors = useMemo(() => {
    const safeMood = (typeof mood === 'string' && mood in MoodGradients ? mood : 'Default') as keyof typeof MoodGradients;
    return MoodGradients[safeMood] as GradientColors;
  }, [mood]);
  const prevColorsRef = useRef<GradientColors>(currentColors);
  const progress = useSharedValue(1);

  useEffect(() => {
    // Update previous colors and animate to new ones
    const prev = prevColorsRef.current;
    if (prev !== currentColors) {
      progress.value = 0;
      prevColorsRef.current = currentColors;
      progress.value = withTiming(1, { duration: 2000 });
    }
  }, [currentColors]);

  const topStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const bottomStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  // Cross-fade between previous and current gradients for a smooth transition
  return (
    <Animated.View style={[{ flex: 1 }, style]}>
      <AnimatedLinearGradient
        colors={prevColorsRef.current}
        style={[StyleSheet.absoluteFillObject, bottomStyle]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <AnimatedLinearGradient colors={currentColors} style={[{ flex: 1 }, topStyle]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        {children}
      </AnimatedLinearGradient>
    </Animated.View>
  );
}