import React, { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, View, Text, StyleSheet, Pressable, Image, FlatList, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../navigation';
import GradientBackground from '../components/GradientBackground';
import { useAppState } from '../context/AppState';
import { supabaseApi } from '../api/supabase';
import { MoodImages } from '../theme';
import ProfileModal from '../components/ProfileModal';
import AppHeader from '../components/AppHeader';
import * as Haptics from 'expo-haptics';

type FavItem = { id?: string | null; audio_url: string; mp3_url?: string | null; stream_url?: string | null; image_url?: string | null; title?: string | null; mood?: string | null; genres?: string[] | null; liked?: boolean; duration?: number | null };

export default function FavoritesScreen() {
  const { playUrl, profileId, profile } = useAppState() as any;
  const [items, setItems] = useState<FavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [bufferingKey, setBufferingKey] = useState<string | null>(null);
  const lastProfileIdRef = React.useRef<string | null>(null);
  // Removed MiniPlayer: play directly on main Player

  useEffect(() => {
    (async () => {
      try {
        if (profileId) lastProfileIdRef.current = String(profileId);
        const effectiveProfileId = profileId || lastProfileIdRef.current;
        if (effectiveProfileId) {
          const resp = (supabaseApi as any).listFavoriteTracksByProfileId
            ? await (supabaseApi as any).listFavoriteTracksByProfileId(effectiveProfileId)
            : await supabaseApi.listTracksByProfileId(effectiveProfileId);
          if ((resp as any)?.ok && Array.isArray((resp as any)?.data)) {
            const rows = (resp as any).data as any[];
            const favs: FavItem[] = rows
              .filter((r) => typeof r?.liked === 'boolean' && r.liked)
              .map((r) => {
                const audio = typeof r?.audio_url === 'string' ? r.audio_url : null;
                const mp3 = typeof r?.mp3_url === 'string' ? r.mp3_url : null;
                const stream = typeof r?.stream_url === 'string' ? r.stream_url : null;
                const primary = mp3 || audio || stream;
                return {
                  id: r?.id != null ? String(r.id) : null,
                  audio_url: primary || '',
                  mp3_url: mp3 ?? null,
                  stream_url: stream ?? null,
                  image_url: r?.image_url ?? null,
                  title: r?.title ?? null,
                  mood: r?.mood ?? null,
                  genres: Array.isArray(r?.genres) ? r.genres : [],
                  liked: true,
                  duration: typeof r?.duration === 'number' && Number.isFinite(r.duration) && r.duration > 0 ? r.duration : null,
                };
              })
              .filter((it) => typeof it.audio_url === 'string' && it.audio_url.length);
            setItems(favs);
            setLoading(false);
            return;
          }
        }
        // Fallback to local favorites from AsyncStorage
        const likesStr = await AsyncStorage.getItem('mf_likes');
        const savedStr = await AsyncStorage.getItem('mf_saved_tracks');
        const likes = likesStr ? JSON.parse(likesStr) as Record<string, boolean> : {};
        const saved = savedStr ? JSON.parse(savedStr) as any[] : [];
        const localItems: FavItem[] = [];
        for (const rec of Array.isArray(saved) ? saved : []) {
          const mood = rec?.mood || null;
          const genres = Array.isArray(rec?.genres) ? rec.genres : [];
          const first = rec?.first || {};
          const second = rec?.second || {};
          if (first?.audio_url && likes[first.audio_url]) {
            localItems.push({ audio_url: first.audio_url, title: first?.title || null, mood, genres, liked: true });
          }
          if (second?.audio_url && likes[second.audio_url]) {
            localItems.push({ audio_url: second.audio_url, title: second?.title || null, mood, genres, liked: true });
          }
        }
        setItems(localItems);
      } catch {}
      setLoading(false);
    })();
  }, [profileId]);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const effectiveProfileId = profileId || lastProfileIdRef.current;
      if (effectiveProfileId) {
        const resp = (supabaseApi as any).listFavoriteTracksByProfileId
          ? await (supabaseApi as any).listFavoriteTracksByProfileId(effectiveProfileId)
          : await supabaseApi.listTracksByProfileId(effectiveProfileId);
        if ((resp as any)?.ok && Array.isArray((resp as any)?.data)) {
          const rows = (resp as any).data as any[];
          const favs: FavItem[] = rows
            .filter((r) => typeof r?.liked === 'boolean' && r.liked)
            .map((r) => {
              const audio = typeof r?.audio_url === 'string' ? r.audio_url : null;
              const mp3 = typeof r?.mp3_url === 'string' ? r.mp3_url : null;
              const stream = typeof r?.stream_url === 'string' ? r.stream_url : null;
              const primary = mp3 || audio || stream;
              return {
                id: r?.id != null ? String(r.id) : null,
                audio_url: primary || '',
                mp3_url: mp3 ?? null,
                stream_url: stream ?? null,
                image_url: r?.image_url ?? null,
                title: r?.title ?? null,
                mood: r?.mood ?? null,
                genres: Array.isArray(r?.genres) ? r.genres : [],
                liked: true,
                duration: typeof r?.duration === 'number' && Number.isFinite(r.duration) && r.duration > 0 ? r.duration : null,
              };
            })
            .filter((it) => typeof it.audio_url === 'string' && it.audio_url.length);
          setItems(favs);
        }
      }
    } catch {}
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: FavItem }) => {
    const cover = typeof item.image_url === 'string' && item.image_url.startsWith('http') ? item.image_url : (item.mood ? MoodImages[item.mood] : MoodImages.Default);
    const mp3 = typeof item.mp3_url === 'string' && item.mp3_url.startsWith('http') ? item.mp3_url : null;
    // Strict MP3 Playback: Only play from the master mp3 in Favorites.
    const playback = mp3;
    const key = String(item.id || item.mp3_url || item.audio_url);
    return (
      <Pressable
        style={styles.card}
        onPress={() => {
          void (async () => {
            try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
            if (!playback) {
              Alert.alert('High Quality Crafting', 'The track is still being crafted in high quality. Please wait a moment.');
              return;
            }
            setBufferingKey(key);
            try {
              await playUrl(playback, item.title ?? null, cover, item.id ?? null, true, null, item.duration ?? null);
            } catch {}
            setBufferingKey(null);
          })();
        }}
      >
        <Image source={{ uri: cover }} style={styles.cover} />
        <View style={styles.meta}>
          <Text style={styles.title}>{item.title || 'Untitled'}</Text>
          <Text style={styles.subtitle}>{[item.mood, ...(item.genres || [])].filter(Boolean).join(' • ')}</Text>
        </View>
        <View style={styles.playBtn}>
          {bufferingKey === key ? (
            <ActivityIndicator size="small" color="#1b1b1b" />
          ) : (
            <Text style={styles.playText}>▶︎</Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <GradientBackground mood={"Relaxed"}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <AppHeader onBack={() => goBack()} onProfile={() => setShowProfile(true)} profileAvatarUrl={profile?.avatar_url ?? null} />
        <Text style={styles.header}>Favorites</Text>
        <Text style={styles.headerSub}>Your liked tracks</Text>
        {loading ? (
          <Text style={styles.loading}>Loading…</Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(it) => String(it.id || it.audio_url)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 40, paddingTop: 24 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
          />
        )}
        {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
  header: { color: '#f8f5f0', fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 18 },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', marginTop: 6 },
  loading: { color: '#fff', textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 10,
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  cover: { width: 56, height: 56, borderRadius: 12, marginRight: 10 },
  meta: { flex: 1 },
  title: { color: '#f8f5f0', fontSize: 16, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4 },
  playBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.28)' },
  playText: { color: '#1b1b1b', fontWeight: '700' },
});
