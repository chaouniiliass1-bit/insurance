import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { goBack } from '../navigation';
import ProfileModal from '../components/ProfileModal';
import GradientBackground from '../components/GradientBackground';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppState } from '../context/AppState';
import AppHeader from '../components/AppHeader';
import { SafeAreaView } from 'react-native-safe-area-context';

const moods = [
  { label: 'Relaxed', emoji: '🧘' },
  { label: 'Focused', emoji: '🎯' },
  { label: 'Happy', emoji: '😊' },
  { label: 'Chill', emoji: '🧊' },
  { label: 'Melancholic', emoji: '😔' },
  { label: 'Energetic', emoji: '⚡️' },
];

export default function MoodSelectionScreen() {
  const [showProfile, setShowProfile] = useState(false);
  const [selected, setSelected] = useState<string>('Relaxed');
  const nav = useNavigation();
  const { setMood, connectSocket, disconnectSocket, profile } = useAppState() as any;

  // Navigation Guard: Connect socket onFocus, disconnect onBlur
  useFocusEffect(
    useCallback(() => {
      connectSocket?.();
      return () => {
        disconnectSocket?.();
      };
    }, [connectSocket, disconnectSocket])
  );

  const handleSelect = async (mood: string) => {
    setSelected(mood);
    await setMood(mood);
    // navigate to GenreSelection
    // @ts-ignore
    nav.navigate('GenreSelection');
  };

  return (
    <GradientBackground mood={selected}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <AppHeader onBack={() => goBack()} onProfile={() => setShowProfile(true)} profileAvatarUrl={profile?.avatar_url ?? null} />
        <Text style={styles.title}>How are you feeling?</Text>
        <View style={styles.moodGrid}>
          {moods.map((m) => (
            <Pressable
              key={m.label}
              android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
              style={({ pressed }) => [
                styles.moodButton,
                pressed && styles.moodPressed,
                selected === m.label && styles.moodSelected,
                selected === m.label && m.label === 'Energetic' && styles.moodEnergeticPulse,
              ]}
              onPress={() => handleSelect(m.label)}
            >
              <Text style={styles.moodEmoji}>{m.emoji}</Text>
              <Text style={styles.moodText}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
    marginTop: 18,
    textAlign: 'center',
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
  },
  moodButton: {
    width: '45%',
    minHeight: 92,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 2,
  },
  moodSelected: {
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
  moodEnergeticPulse: {
    shadowColor: '#D24A2C',
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  moodPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  moodEmoji: {
    fontSize: 26,
    marginBottom: 6,
    color: '#fff',
  },
  moodText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
});
