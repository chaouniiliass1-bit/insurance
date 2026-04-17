import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

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

function avatarAssetForPath(path: string | null | undefined): any | null {
  if (typeof path !== 'string') return null;
  const idx = AVATAR_PATHS.indexOf(path);
  return idx >= 0 ? AVATAR_ASSETS[idx] : null;
}

type Props = {
  onBack: () => void;
  onProfile: () => void;
  profileAvatarUrl?: string | null;
};

export default function AppHeader({ onBack, onProfile, profileAvatarUrl }: Props) {
  const avatar = useMemo(() => avatarAssetForPath(profileAvatarUrl), [profileAvatarUrl]);

  return (
    <View style={styles.row}>
      <Pressable style={styles.iconBtn} onPress={onBack} hitSlop={12}>
        <MaterialIcons name="chevron-left" size={26} color="#fff" />
      </Pressable>
      <Pressable style={styles.iconBtn} onPress={onProfile} hitSlop={12}>
        {avatar ? (
          <Image source={avatar} style={styles.avatar} resizeMode="contain" />
        ) : (
          <MaterialIcons name="person-outline" size={22} color="#fff" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  avatar: {
    width: 22,
    height: 22,
  },
});

