import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, View, Text, StyleSheet, Pressable, FlatList, Alert, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { goBack } from '../navigation';
import GradientBackground from '../components/GradientBackground';
import { useAppState } from '../context/AppState';
import { supabaseApi } from '../api/supabase';
import ProfileModal from '../components/ProfileModal';
import AppHeader from '../components/AppHeader';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

// Lazy load expo-file-system to avoid type/module resolution errors when unavailable
function getFileSystem(): any {
  try {
    return require('expo-file-system');
  } catch {
    return null as any;
  }
}

function getMediaLibrary(): any {
  try {
    return require('expo-media-library');
  } catch {
    return null as any;
  }
}

type HistItem = {
  mood?: string | null;
  genres?: string[] | null;
  id?: string | null;
  liked?: boolean | null;
  audio_url?: string | null;
  image_url?: string | null;
  mp3_url?: string | null;
  stream_url?: string | null;
  title?: string | null;
  duration?: number | null;
  created_at?: string;
};

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { playUrl, profile, profileId, trackUrl, hasStartedPlayback } = useAppState() as any;
  const [items, setItems] = useState<HistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [downloadState, setDownloadState] = useState<Record<string, 'idle' | 'downloading' | 'done'>>({});
  const [bufferingKey, setBufferingKey] = useState<string | null>(null);
  const doneTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const lastProfileIdRef = useRef<string | null>(null);
  // Removed MiniPlayer: play directly on main Player

  const normalizeGenres = (g: any): string[] => (Array.isArray(g) ? g.map((s) => String(s)).filter(Boolean) : []);
  const pickAudioUrl = (row: any): string | null => {
    const c = row?.audio_url;
    return typeof c === 'string' && c.trim().length && c.startsWith('http') ? c.trim() : null;
  };
  const pickMp3Url = (row: any): string | null => {
    const c = row?.mp3_url;
    return typeof c === 'string' && c.trim().length && c.startsWith('http') ? c.trim() : null;
  };
  const normalizeTapUrl = (u: string | null): string | null => {
    if (!u) return null;
    const trimmed = u.trim();
    if (!trimmed) return null;
    return trimmed.startsWith('http://') ? `https://${trimmed.slice('http://'.length)}` : trimmed;
  };
  const formatDuration = (sec: number | null | undefined): string | null => {
    if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return null;
    const total = Math.max(0, Math.floor(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const mapRowsToItems = (rows: any[]): HistItem[] => {
    const sorted = Array.isArray(rows) ? rows.slice() : [];
    sorted.sort((a, b) => {
      const ta = Date.parse(String(a?.created_at || '')) || 0;
      const tb = Date.parse(String(b?.created_at || '')) || 0;
      return tb - ta;
    });
    const seen = new Set<string>();
    const out: HistItem[] = [];
    for (const r of sorted) {
      const audio = pickAudioUrl(r);
      const mp3 = pickMp3Url(r);
      const primary = audio || mp3;
      if (!primary) continue;
      const id = r?.id != null ? String(r.id) : null;
      const key = id || primary;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id,
        audio_url: audio || mp3,
        mp3_url: mp3,
        stream_url: typeof r?.stream_url === 'string' && r.stream_url.startsWith('http') ? r.stream_url : null,
        image_url: typeof r?.image_url === 'string' ? r.image_url : null,
        title: typeof r?.title === 'string' && r.title.length ? r.title : null,
        mood: typeof r?.mood === 'string' ? r.mood : null,
        genres: normalizeGenres(r?.genres),
        liked: typeof r?.is_favorite === 'boolean' ? r.is_favorite : (typeof r?.liked === 'boolean' ? r.liked : null),
        duration: typeof r?.duration === 'number' && Number.isFinite(r.duration) && r.duration > 0 ? r.duration : null,
        created_at: typeof r?.created_at === 'string' ? r.created_at : undefined,
      });
    }
    return out;
  };

  const mergeOptimistic = (base: HistItem[], optimistic: HistItem[]) => {
    const out = Array.isArray(base) ? base.slice() : [];
    const seen = new Set<string>();
    for (const it of out) {
      const k = it?.id || it?.stream_url || it?.audio_url || '';
      if (k) seen.add(k);
    }
    for (const it of Array.isArray(optimistic) ? optimistic : []) {
      const k = it?.id || it?.stream_url || it?.audio_url || '';
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.unshift(it);
    }
    return out;
  };

  const loadLocalSavedTracks = async (): Promise<HistItem[]> => {
    try {
      const savedStr = await AsyncStorage.getItem('mf_saved_tracks');
      const saved = savedStr ? (JSON.parse(savedStr) as any[]) : [];
      const local: HistItem[] = [];
      for (const rec of Array.isArray(saved) ? saved : []) {
        const createdAt = rec?.timestamp ? new Date(rec.timestamp).toISOString() : undefined;
        const firstAudio = typeof rec?.first?.audio_url === 'string' ? rec.first.audio_url : null;
        if (firstAudio) {
          local.push({
            id: rec?.first?.id != null ? String(rec.first.id) : null,
            audio_url: firstAudio,
            mp3_url: typeof rec?.first?.mp3_url === 'string' ? rec.first.mp3_url : null,
            stream_url: firstAudio,
            image_url: typeof rec?.first?.image_url === 'string' ? rec.first.image_url : null,
            title: typeof rec?.first?.title === 'string' ? rec.first.title : null,
            mood: typeof rec?.mood === 'string' ? rec.mood : null,
            genres: Array.isArray(rec?.genres) ? rec.genres : [],
            liked: typeof rec?.first?.liked === 'boolean' ? rec.first.liked : null,
            created_at: createdAt,
          });
        }
        const secondAudio = typeof rec?.second?.audio_url === 'string' ? rec.second.audio_url : null;
        if (secondAudio) {
          local.push({
            id: rec?.second?.id != null ? String(rec.second.id) : null,
            audio_url: secondAudio,
            mp3_url: typeof rec?.second?.mp3_url === 'string' ? rec.second.mp3_url : null,
            stream_url: secondAudio,
            image_url: typeof rec?.second?.image_url === 'string' ? rec.second.image_url : null,
            title: typeof rec?.second?.title === 'string' ? rec.second.title : null,
            mood: typeof rec?.mood === 'string' ? rec.mood : null,
            genres: Array.isArray(rec?.genres) ? rec.genres : [],
            liked: typeof rec?.second?.liked === 'boolean' ? rec.second.liked : null,
            created_at: createdAt,
          });
        }
      }
      return local;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    (async () => {
      try {
        if (profileId) lastProfileIdRef.current = String(profileId);
        const effectiveProfileId = profileId || lastProfileIdRef.current;
        if (effectiveProfileId) {
          const resp = await supabaseApi.listTracksByProfileId(effectiveProfileId);
          if ((resp as any)?.ok && Array.isArray((resp as any)?.data)) {
            const rows = (resp as any).data as any[];
            const base = mapRowsToItems(rows);
            const local = await loadLocalSavedTracks();
            setItems(mergeOptimistic(base, local));
            setLoading(false);
            try {
              const key = `mf_mp3_backfill_${effectiveProfileId}`;
              const already = await AsyncStorage.getItem(key);
              if (!already) {
                const backfill = await supabaseApi.backfillTracksMp3Urls(effectiveProfileId);
                await AsyncStorage.setItem(key, '1');
                const updated = (backfill as any)?.data?.updated;
                if (typeof updated === 'number' && updated > 0) {
                  const resp2 = await supabaseApi.listTracksByProfileId(effectiveProfileId);
                  if ((resp2 as any)?.ok && Array.isArray((resp2 as any)?.data)) {
                    const base2 = mapRowsToItems((resp2 as any).data as any[]);
                    const local2 = await loadLocalSavedTracks();
                    setItems(mergeOptimistic(base2, local2));
                  }
                }
              }
            } catch {}
            return;
          }
        }
        const localOnly = await loadLocalSavedTracks();
        if (localOnly.length) setItems(localOnly);
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
        const resp = await supabaseApi.listTracksByProfileId(effectiveProfileId);
        if ((resp as any)?.ok && Array.isArray((resp as any)?.data)) {
          const base = mapRowsToItems((resp as any).data as any[]);
          const local = await loadLocalSavedTracks();
          setItems(mergeOptimistic(base, local));
        }
      }
    } catch {}
    setRefreshing(false);
  };

  const scheduleDoneReset = (key: string) => {
    const existing = doneTimersRef.current[key];
    if (existing) clearTimeout(existing);
    doneTimersRef.current[key] = setTimeout(() => {
      setDownloadState((s) => ({ ...s, [key]: 'idle' }));
      doneTimersRef.current[key] = null;
    }, 1600);
  };

  const doDownload = async (audioUrls: string[], title?: string | null, key?: string) => {
    try {
      const FileSystem = getFileSystem();
      const MediaLibrary = getMediaLibrary();
      if (Platform.OS === 'web') {
        if (audioUrls[0]) {
          try { await Linking.openURL(audioUrls[0]); } catch {}
        }
        return;
      }
      if (!FileSystem || typeof FileSystem.downloadAsync !== 'function' || !FileSystem.cacheDirectory) {
        Alert.alert('Download unavailable', 'expo-file-system is not available on this build.');
        return;
      }
      if (!MediaLibrary || typeof MediaLibrary.requestPermissionsAsync !== 'function') {
        Alert.alert('Save unavailable', 'expo-media-library is not available on this build.');
        return;
      }

      const targetKey = key || (audioUrls[0] ?? 'download');
      setDownloadState((s) => ({ ...s, [targetKey]: 'downloading' }));

      const perm = await MediaLibrary.requestPermissionsAsync();
      if (perm?.status !== 'granted') {
        setDownloadState((s) => ({ ...s, [targetKey]: 'idle' }));
        Alert.alert('Permission required', 'Allow photo/media access to save tracks to your gallery.');
        return;
      }

      const base = (title && title.length ? title : 'FusionMood').replace(/[^a-z0-9_\-]+/gi, '_');
      const albumName = 'FusionMood';

      const urls = Array.isArray(audioUrls) ? audioUrls.filter(Boolean) : [];
      for (let i = 0; i < urls.length; i++) {
        const u = urls[i];
        if (typeof u !== 'string' || !u.startsWith('http')) continue;
        const safeUrl = u.startsWith('http://') ? `https://${u.slice('http://'.length)}` : u;
        const name = `${base}_${i + 1}_${Date.now()}.mp3`;
        const dest = FileSystem.cacheDirectory + name;
        const res = await FileSystem.downloadAsync(safeUrl, dest);
        if (res?.status !== 200) throw new Error('download_failed');
        const asset = await MediaLibrary.createAssetAsync(res.uri);
        try {
          await MediaLibrary.createAlbumAsync(albumName, asset, false);
        } catch {}
      }

      setDownloadState((s) => ({ ...s, [targetKey]: 'done' }));
      scheduleDoneReset(targetKey);
    } catch (e) {
      if (key) setDownloadState((s) => ({ ...s, [key]: 'idle' }));
      Alert.alert('Download error', 'Unable to save this track. Please try again.');
    }
  };

  const renderItem = ({ item }: { item: HistItem }) => {
    const mood = typeof item?.mood === 'string' ? item.mood : null;
    const genres = Array.isArray(item?.genres) ? item.genres : [];
    const title = item?.title || (mood && genres.length ? `${mood} ${genres.slice(0, 2).join('-')}` : 'Saved Vibe');
    const id = item?.id != null ? String(item.id) : null;
    const liked = typeof item?.liked === 'boolean' ? item.liked : null;
    const audioUrl = normalizeTapUrl(item?.audio_url || null);
    const coverUrl = normalizeTapUrl(item?.image_url || null);
    const mp3Url = normalizeTapUrl(item?.mp3_url || null);
    const streamUrl = normalizeTapUrl(item?.stream_url || null);
    const playbackUrl = streamUrl || audioUrl || mp3Url;
    const isActive = !!trackUrl && trackUrl === playbackUrl;
    const isSecuring = !mp3Url || !mp3Url.includes('/storage/v1/object/public/');
    const stableKey = (id || item?.stream_url || audioUrl || title) as string;
    const saveState = downloadState[stableKey] || 'idle';
    const durText = formatDuration(item?.duration);
    return (
      <Pressable
        style={[styles.listCard, isActive && { borderColor: 'rgba(255, 170, 115, 0.85)', backgroundColor: 'rgba(255,255,255,0.14)' }]}
        onPress={() => {
          if (!playbackUrl) {
            Alert.alert('Track unavailable', 'This saved vibe is missing a playable audio link.');
            return;
          }
          void (async () => {
            try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
            setBufferingKey(stableKey);
            try {
              const primary = playbackUrl;
              const fallback = playbackUrl !== mp3Url ? (mp3Url || null) : null;
              await playUrl(primary, title, coverUrl, id, liked, fallback);
            } catch {}
            setBufferingKey(null);
          })();
        }}
      >
        <View style={styles.listRow}>
          <View style={styles.listMeta}>
            <Text style={styles.listTitle} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.tagsRow}>
              {isSecuring && <View style={styles.tag}><Text style={styles.tagText}>Securing…</Text></View>}
              {!!durText && <View style={styles.tag}><Text style={styles.tagText}>{durText}</Text></View>}
              {!!mood && <View style={styles.tag}><Text style={styles.tagText}>{mood}</Text></View>}
              {genres.slice(0, 2).map((g) => (
                <View key={g} style={styles.tag}><Text style={styles.tagText}>{g}</Text></View>
              ))}
            </View>
          </View>
          <View style={styles.rightControls}>
            <Pressable
              style={styles.saveBtn}
              onPress={(e: any) => {
                try { e?.stopPropagation?.(); } catch {}
                if (!profileId && !lastProfileIdRef.current) {
                  Alert.alert('Profile required', 'Please create/select a profile to favorite tracks.');
                  return;
                }
                const next = !(liked ?? false);
                setItems((prev) => prev.map((x) => {
                  const k = (x?.id || x?.stream_url || x?.audio_url || '') as string;
                  if (k !== stableKey) return x;
                  return { ...x, liked: next };
                }));
                void (async () => {
                  try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                  try {
                    const effectiveProfileId = profileId || lastProfileIdRef.current;
                    let trackId = id;
                    if (!trackId && effectiveProfileId && audioUrl) {
                      const found: any = await supabaseApi.findTrackIdByUrl(effectiveProfileId, audioUrl);
                      trackId = found?.data ? String(found.data) : null;
                    }
                    if (trackId) {
                      await supabaseApi.updateTrackLiked(trackId, next);
                    }
                  } catch {}
                })();
              }}
              hitSlop={10}
            >
              <MaterialIcons
                name={(liked ?? false) ? 'favorite' : 'favorite-border'}
                size={20}
                color={'rgba(255,255,255,0.92)'}
              />
            </Pressable>
            <Pressable
              style={styles.saveBtn}
              onPress={(e: any) => {
                try { e?.stopPropagation?.(); } catch {}
                const list = [mp3Url].filter(Boolean) as string[];
                if (!list.length) {
                  Alert.alert('Download unavailable', 'This track is still syncing. Try again in a moment.');
                  return;
                }
                void doDownload(list, title, stableKey);
              }}
              disabled={saveState === 'downloading'}
              hitSlop={10}
            >
              <MaterialIcons
                name={saveState === 'done' ? 'check' : saveState === 'downloading' ? 'hourglass-top' : 'download'}
                size={20}
                color={'rgba(255,255,255,0.92)'}
              />
            </Pressable>
            <View style={styles.playIndicator}>
              {bufferingKey === stableKey ? (
                <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" />
              ) : (
                <MaterialIcons
                  name={isActive && hasStartedPlayback ? 'graphic-eq' : 'play-arrow'}
                  size={20}
                  color={isActive && hasStartedPlayback ? 'rgba(46, 204, 113, 0.95)' : 'rgba(255,255,255,0.85)'}
                />
              )}
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <GradientBackground mood={"Relaxed"}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <AppHeader onBack={() => goBack()} onProfile={() => setShowProfile(true)} profileAvatarUrl={profile?.avatar_url ?? null} />
        <Text style={styles.header}>My Library</Text>
        {loading ? (
          <Text style={styles.loading}>Loading…</Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(it) => String(it?.id || it?.stream_url || it?.audio_url || 'item')}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: (insets.bottom || 0) + 28, paddingTop: 24 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
          />
        )}
        {showProfile && <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />}
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 10, paddingHorizontal: 16 },
  header: { color: '#f8f5f0', fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 18 },
  loading: { color: '#fff', textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 10,
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  listCard: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  listMeta: { flex: 1 },
  listTitle: { color: '#f8f5f0', fontSize: 15, fontWeight: '700' },
  tagsRow: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  tagText: { color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: '600' },
  rightControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  playIndicator: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)' },
  cover: { width: 56, height: 56, borderRadius: 12, marginRight: 10 },
  meta: { flex: 1 },
  title: { color: '#f8f5f0', fontSize: 16, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4 },
  playBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.28)' },
  playText: { color: '#1b1b1b', fontWeight: '700' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.28)' },
});
