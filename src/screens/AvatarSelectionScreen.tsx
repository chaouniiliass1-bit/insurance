import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { goBack } from '../navigation';
import ProfileModal from '../components/ProfileModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import GradientBackground from '../components/GradientBackground';
import { supabaseApi } from '../api/supabase';

const AVATAR_ASSETS = [
  require('../../assets/avatar1.png'),
  require('../../assets/avatar2.png'),
  require('../../assets/avatar3.png'),
  require('../../assets/avatar4.png'),
  require('../../assets/avatar5.png'),
];

const AVATAR_PATHS = [
  'assets/avatar1.png',
  'assets/avatar2.png',
  'assets/avatar3.png',
  'assets/avatar4.png',
  'assets/avatar5.png',
];

export default function AvatarSelectionScreen() {
  const nav = useNavigation() as any;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const selected = selectedIndex !== null ? selectedIndex : -1;

  const onContinue = async () => {
    if (selectedIndex === null || busy) return;
    setBusy(true);
    try {
      const nick = await AsyncStorage.getItem('mf_session_nickname');
      const avatarPath = AVATAR_PATHS[selectedIndex];
      if (nick) {
        try { await supabaseApi.updateAvatarByNickname(nick, avatarPath); } catch {}
        const profStr = await AsyncStorage.getItem('mf_profile');
        const prof = profStr ? JSON.parse(profStr) : {};
        const next = { ...prof, avatar_url: avatarPath, nickname: prof?.nickname || nick };
        await AsyncStorage.setItem('mf_profile', JSON.stringify(next));
      }
      // @ts-ignore
      nav.navigate('MoodSelection');
    } catch {}
    setBusy(false);
  };

  return (
    <GradientBackground mood={"Relaxed"}>
      <View style={styles.container}>
        <Pressable style={styles.backIcon} onPress={() => goBack()}>
          <MaterialIcons name="arrow-back" size={22} color="#1b1b1b" />
        </Pressable>
        <Pressable style={styles.profileIcon} onPress={() => setShowProfile(true)}>
          <MaterialIcons name="person-outline" size={22} color="#1b1b1b" />
        </Pressable>
        <Text style={styles.title}>Choose your avatar</Text>
        <View style={styles.grid}>
          {AVATAR_ASSETS.map((src, idx) => {
            const active = selected === idx;
            return (
              <Pressable key={idx} onPress={() => setSelectedIndex(idx)} style={[styles.item, active && styles.itemActive]}>
                <Image source={src} style={styles.image} resizeMode="contain" />
              </Pressable>
            );
          })}
        </View>
        <Pressable style={[styles.cta, selectedIndex !== null ? styles.ctaEnabled : styles.ctaDisabled]} disabled={busy || selectedIndex === null} onPress={onContinue}>
          <Text style={styles.ctaText}>{busy ? 'Saving…' : 'Continue'}</Text>
        </Pressable>
        {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 60, alignItems: 'center' },
  backIcon: {
    position: 'absolute',
    left: 16,
    top: 32,
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
    top: 32,
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
  title: { color: '#f8f5f0', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  grid: { width: '92%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  item: { width: '30%', height: 96, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  itemActive: { backgroundColor: 'rgba(255,255,255,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  image: { width: '80%', height: '80%' },
  cta: { width: '92%', marginTop: 24, borderRadius: 28, paddingVertical: 14 },
  ctaEnabled: { backgroundColor: 'rgba(255,255,255,0.42)' },
  ctaDisabled: { backgroundColor: 'rgba(255,255,255,0.22)' },
  ctaText: { color: '#1b1b1b', fontSize: 16, fontWeight: '600', textAlign: 'center' },
});