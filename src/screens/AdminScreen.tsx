import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { goBack } from '../navigation';
import ProfileModal from '../components/ProfileModal';
import { useNavigation } from '@react-navigation/native';
import GradientBackground from '../components/GradientBackground';
import { supabaseApi } from '../api/supabase';
import { useAppState } from '../context/AppState';

type Item = { nickname: string; avatar_url: string; coins: number; keep_logged_in?: boolean | null };

export default function AdminScreen() {
  const nav = useNavigation() as any;
  const { profile } = useAppState() as any;
  const [profiles, setProfiles] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await supabaseApi.listAllProfiles();
      if ((resp as any)?.ok === false) {
        setError('Failed to fetch profiles — check RLS policies for admin access.');
        setProfiles([]);
      } else {
        const rows = ((resp as any)?.data || []) as any[];
        setProfiles(rows.map((r) => ({ nickname: r?.nickname || '', avatar_url: r?.avatar_url || '🌟', coins: r?.coins ?? 0, keep_logged_in: r?.keep_logged_in ?? null })));
      }
    } catch (e) {
      setError('Unexpected error while fetching profiles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateCoins = async (nickname: string, coins: number) => {
    try {
      const resp = await supabaseApi.adminUpdateCoins(nickname, coins);
      if ((resp as any)?.ok === false) {
        setError('Failed to update coins — check RLS policies.');
      }
      await load();
    } catch { setError('Unexpected error while updating coins.'); }
  };

  // Unlink removed in new auth model

  const renderItem = ({ item }: { item: Item }) => (
    <View style={styles.card}>
      <Text style={styles.nickname}>{item.nickname}</Text>
      <Text style={styles.sub}>Avatar: {item.avatar_url}</Text>
      <Text style={styles.sub}>Keep Logged In: {item.keep_logged_in ? 'Yes' : 'No'}</Text>
      <View style={styles.row}>
        <Text style={styles.sub}>Coins: {item.coins}</Text>
        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={() => updateCoins(item.nickname, Math.max(0, item.coins - 1))}><Text style={styles.btnText}>-1</Text></Pressable>
          <Pressable style={styles.btn} onPress={() => updateCoins(item.nickname, item.coins + 1)}><Text style={styles.btnText}>+1</Text></Pressable>
        </View>
      </View>
    </View>
  );

  if ((profile?.nickname || '').toLowerCase() !== 'admin') {
    return (
      <GradientBackground mood={'Relaxed'}>
        <View style={styles.container}>
          <Pressable style={styles.backIcon} onPress={() => goBack()}>
            <MaterialIcons name="arrow-back" size={22} color="#1b1b1b" />
          </Pressable>
          <Pressable style={styles.profileIcon} onPress={() => setShowProfile(true)}>
            <MaterialIcons name="person-outline" size={22} color="#1b1b1b" />
          </Pressable>
          <Text style={styles.title}>Admin Console</Text>
          <Text style={styles.error}>Access denied. Admin only.</Text>
          <Pressable style={styles.back} onPress={() => { /* @ts-ignore */ nav.navigate('MoodSelection'); }}><Text style={styles.backText}>Back</Text></Pressable>
          {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}
        </View>
      </GradientBackground>
    );
  }

  return (
    <GradientBackground mood={'Relaxed'}>
      <View style={styles.container}>
        <Pressable style={styles.backIcon} onPress={() => goBack()}>
          <MaterialIcons name="arrow-back" size={22} color="#1b1b1b" />
        </Pressable>
        <Pressable style={styles.profileIcon} onPress={() => setShowProfile(true)}>
          <MaterialIcons name="person-outline" size={22} color="#1b1b1b" />
        </Pressable>
        <Text style={styles.title}>Admin Console</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        {loading ? (
          <Text style={styles.loading}>Loading…</Text>
        ) : (
          <FlatList data={profiles} keyExtractor={(i) => `${i.nickname}`} renderItem={renderItem} contentContainerStyle={styles.list} />
        )}
        <Pressable style={styles.refresh} onPress={load}><Text style={styles.refreshText}>Refresh</Text></Pressable>
        <Pressable style={styles.back} onPress={() => { /* @ts-ignore */ nav.navigate('MoodSelection'); }}><Text style={styles.backText}>Back</Text></Pressable>
        {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  backIcon: {
    position: 'absolute',
    left: 16,
    top: 16,
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
    top: 16,
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
  title: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  error: { color: '#ffdddd', textAlign: 'center', marginBottom: 8 },
  loading: { color: '#fff', textAlign: 'center', marginTop: 8 },
  list: { paddingBottom: 20 },
  card: { borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', padding: 12, marginBottom: 10 },
  nickname: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sub: { color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(0,0,0,0.25)' },
  btnText: { color: '#fff', fontWeight: '600' },
  unlink: { backgroundColor: 'rgba(217,48,37,0.25)' },
  refresh: { position: 'absolute', right: 16, bottom: 16, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.25)' },
  refreshText: { color: '#1b1b1b', fontWeight: '700' },
  back: { position: 'absolute', left: 16, bottom: 16, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.25)' },
  backText: { color: '#1b1b1b', fontWeight: '700' },
});