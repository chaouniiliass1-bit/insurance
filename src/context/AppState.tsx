import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import io from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateSunoTrack } from '../api/suno';
import { audioService } from '../services/audio';
import { Platform, ToastAndroid } from 'react-native';
import { supabaseApi } from '../api/supabase';
import { navigate, navigationRef } from '../navigation';
import Constants from 'expo-constants';
import { useKeepAwake } from 'expo-keep-awake';

  type AppState = {
  deviceId: string | null;
  userMood: string | null;
  genre1: string | null;
  genre2: string | null;
  vocalMode: 'lyrics' | 'instrumental';
  setVocalMode: (mode: 'lyrics' | 'instrumental') => Promise<void> | void;
  activeTrackId: string | null;
  setActivePair: (payload: { first: { id: string; url: string; title?: string | null; coverUrl?: string | null; liked?: boolean | null }; second?: { id?: string | null; url?: string | null; coverUrl?: string | null; liked?: boolean | null } | null; mood?: string | null; genres?: string[] | null }) => Promise<void>;
  setPlaybackStarted: (started: boolean) => void;
  trackUrl: string | null;
  trackA?: string | null;
  trackB?: string | null;
  trackCover: string | null;
  trackTitle: string | null;
  isGenerating: boolean;
  isRequesting: boolean;
  hasSunoBalance: boolean;
  generationProgress: number;
    providerLabel: string;
    // Preload state: show waiting animation without blocking UI
    isPreloading?: boolean;
    // Navigation gate: true once playback actually starts
    hasStartedPlayback?: boolean;
    // Status message shown during long waits (e.g., mastering/tuning)
    statusLabel: string;
    generationStartedAtMs?: number | null;
    trackAReadyAtMs?: number | null;
    trackBReadyAtMs?: number | null;
    // Track toggle persistence between screens
    isSecondActive?: boolean;
    setSecondActive: (active: boolean) => void;
  credits: number;
  isReady: boolean;
  consumeCredit: () => Promise<void> | void;
  addCoins: (amount: number, planName?: string, priceUsd?: number) => Promise<void> | void;
  isLiked: (url: string | null) => boolean;
  toggleLike: (url: string | null) => Promise<void> | void;
  setMood: (mood: string) => Promise<void> | void;
  setGenres: (g1: string, g2: string) => Promise<void> | void;
  generateTrack: (mood?: string, genre1?: string, genre2?: string) => Promise<void>;
  playUrl: (url: string, title?: string | null, coverUrl?: string | null, trackId?: string | null, liked?: boolean | null, fallbackUrl?: string | null) => Promise<void>;
  playPair: (firstUrl: string, secondUrl?: string | null, title?: string | null, mood?: string | null, genres?: string[] | null, coverFirst?: string | null, coverSecond?: string | null, trackIdA?: string | null, trackIdB?: string | null, likedA?: boolean | null, likedB?: boolean | null) => Promise<void>;
  // Saved-match helpers: check and play pre-generated track without requesting
  hasSavedMatch: (mood: string, g1: string, g2: string) => Promise<boolean>;
  playSavedMatch: (mood: string, g1: string, g2: string) => Promise<void>;
  profile: { nickname: string; avatar_url: string | null; keep_logged_in?: boolean | null } | null;
  profileId: string | null;
  refreshProfile: () => Promise<void>;
  reset: () => Promise<void>;
  // Socket management
  connectSocket: () => void;
  disconnectSocket: () => void;
};

export const AppStateContext = createContext<AppState | undefined>(undefined);

const K_MOOD = 'mf_user_mood';
const K_G1 = 'mf_genre1';
const K_G2 = 'mf_genre2';
const K_VOCAL = 'mf_vocal_mode';
const K_URL = 'mf_track_url';
const K_CREDITS = 'mf_credits';
const K_TRACKS = 'mf_saved_tracks';
const K_PROFILE = 'mf_profile';
const K_LIKES = 'mf_likes';

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  useKeepAwake(); // Keep screen on during generation/playback
  const [userMood, setUserMood] = useState<string | null>(null);
  const [genre1, setGenre1] = useState<string | null>(null);
  const [genre2, setGenre2] = useState<string | null>(null);
  const [vocalMode, setVocalModeState] = useState<'lyrics' | 'instrumental'>('lyrics');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [trackA, setTrackA] = useState<string | null>(null);
  const [trackB, setTrackB] = useState<string | null>(null);
  const [trackCover, setTrackCover] = useState<string | null>(null);
  const [trackCoverA, setTrackCoverA] = useState<string | null>(null);
  const [trackCoverB, setTrackCoverB] = useState<string | null>(null);
  const [trackMp3A, setTrackMp3A] = useState<string | null>(null);
  const [trackMp3B, setTrackMp3B] = useState<string | null>(null);
  const [trackIdA, setTrackIdA] = useState<string | null>(null);
  const [trackIdB, setTrackIdB] = useState<string | null>(null);
  const [trackLikedA, setTrackLikedA] = useState<boolean | null>(null);
  const [trackLikedB, setTrackLikedB] = useState<boolean | null>(null);
  const [trackTitle, setTrackTitle] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [hasSunoBalance, setHasSunoBalance] = useState(true);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [providerLabel, setProviderLabel] = useState<string>('');
  const [isPreloading, setIsPreloading] = useState<boolean>(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState<boolean>(false);
  const [statusLabel, setStatusLabel] = useState<string>('Your wonderful vibe is on the way…');
  const [generationStartedAtMs, setGenerationStartedAtMs] = useState<number | null>(null);
  const [trackAReadyAtMs, setTrackAReadyAtMs] = useState<number | null>(null);
  const [trackBReadyAtMs, setTrackBReadyAtMs] = useState<number | null>(null);
  const [isSecondActive, setIsSecondActive] = useState<boolean>(false);
  const [credits, setCredits] = useState<number>(3);
  const [likesMap, setLikesMap] = useState<Record<string, boolean>>({});
  const [profile, setProfile] = useState<{ nickname: string; avatar_url: string | null; keep_logged_in?: boolean | null } | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const profileIdRef = useRef<string | null>(null);
  const moodRef = useRef<string | null>(null);
  const g1Ref = useRef<string | null>(null);
  const g2Ref = useRef<string | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const processedTaskIdsRef = useRef<Set<string>>(new Set());
  const savedForTaskRef = useRef<string | null>(null);
  const insertedUrlsRef = useRef<Set<string>>(new Set());
  const callbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const softTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestLockRef = useRef<boolean>(false);
  const generationStartRef = useRef<number>(0);
  const IS_DEV = String(process.env.EXPO_PUBLIC_IS_DEV).toLowerCase() === 'true';
  // Universal API base for sockets and backend requests is resolved at runtime
  // using Expo Constants via helper to avoid module-load time env issues
  const isGeneratingRef = useRef<boolean>(false);
  const currentTrackUrlRef = useRef<string | null>(null);
  const currentTrackBRef = useRef<string | null>(null);
  const hasStartedPlaybackRef = useRef<boolean>(false);
  const isSecondActiveRef = useRef<boolean>(false);
  const trackCoverARef = useRef<string | null>(null);
  const trackCoverBRef = useRef<string | null>(null);
  const trackMp3ARef = useRef<string | null>(null);
  const trackMp3BRef = useRef<string | null>(null);
  const trackIdARef = useRef<string | null>(null);
  const trackIdBRef = useRef<string | null>(null);
  const trackLikedARef = useRef<boolean | null>(null);
  const trackLikedBRef = useRef<boolean | null>(null);
  const SUNO_BASE_HOST = (() => {
    try {
      const u = new URL(process.env.EXPO_PUBLIC_SUNO_BASE || 'https://api.api.box/api/v1');
      return u.hostname.toLowerCase();
    } catch {
      return 'api.api.box';
    }
  })();
  const SUPABASE_HOST = (() => {
    try {
      const raw =
        (Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_SUPABASE_URL ||
        (Constants?.expoConfig?.extra as any)?.supabaseUrl ||
        process.env.EXPO_PUBLIC_SUPABASE_URL ||
        'https://wiekabbfmpmxjhiwyfzt.supabase.co';
      const u = new URL(String(raw));
      return u.hostname.toLowerCase();
    } catch {
      return 'wiekabbfmpmxjhiwyfzt.supabase.co';
    }
  })();
  const isAllowedSunoHost = (host: string) => {
    const h = host.toLowerCase();
    const allow = [
      'api.api.box',
      'api.box',
      'removeai.ai',
      'musicfile.removeai.ai',
      'suno.ai',
      'cdn.suno.ai',
      'sunoapi.org',
      'sunousercontent.com',
      'mureka.org',
      SUNO_BASE_HOST,
      SUPABASE_HOST,
    ];
    return allow.some((d) => h === d || h.endsWith(`.${d}`) || h.includes(d));
  };

  const normalizePlayableUrl = (u: unknown): string | null => {
    if (typeof u !== 'string') return null;
    const raw = u.trim();
    if (!raw) return null;
    const normalized = raw.startsWith('http://') ? `https://${raw.slice('http://'.length)}` : raw;
    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== 'https:') return null;
      if (!isAllowedSunoHost(host)) return null;
      return normalized;
    } catch {
      return null;
    }
  };

  useEffect(() => { trackCoverARef.current = trackCoverA; }, [trackCoverA]);
  useEffect(() => { trackCoverBRef.current = trackCoverB; }, [trackCoverB]);
  useEffect(() => { trackMp3ARef.current = trackMp3A; }, [trackMp3A]);
  useEffect(() => { trackMp3BRef.current = trackMp3B; }, [trackMp3B]);
  useEffect(() => { trackIdARef.current = trackIdA; }, [trackIdA]);
  useEffect(() => { trackIdBRef.current = trackIdB; }, [trackIdB]);
  useEffect(() => { trackLikedARef.current = trackLikedA; }, [trackLikedA]);
  useEffect(() => { trackLikedBRef.current = trackLikedB; }, [trackLikedB]);
  useEffect(() => { isSecondActiveRef.current = isSecondActive; }, [isSecondActive]);

  useEffect(() => {
    if (isSecondActiveRef.current) {
      if (trackCoverB) setTrackCover(trackCoverB);
    } else {
      if (trackCoverA) setTrackCover(trackCoverA);
    }
  }, [trackCoverA, trackCoverB]);

  const K_DEVICE = 'mf_device_id';

  // Ensure a persistent per-device identity and initialize profile/credits
  useEffect(() => {
    (async () => {
      try {
        // 1. Resolve Device ID
        let devId = await AsyncStorage.getItem(K_DEVICE);
        if (!devId || typeof devId !== 'string' || devId.length === 0) {
          const rand = Math.random().toString(36).slice(2);
          const ts = Date.now().toString(36);
          devId = `mfdev-${ts}-${rand}-${Platform.OS}`;
          await AsyncStorage.setItem(K_DEVICE, devId);
        }
        setDeviceId(devId);
        console.log('[AppState] Device ID resolved and set:', devId);

        // 2. Initialize Credits
        const creditsStr = await AsyncStorage.getItem(K_CREDITS);
        let currentCredits = 3;
        if (creditsStr !== null) {
          const n = parseInt(creditsStr, 10);
          currentCredits = isNaN(n) ? 3 : Math.max(0, n);
        } else {
          await AsyncStorage.setItem(K_CREDITS, '3');
        }
        setCredits(currentCredits);

        // 3. Resolve Profile
        let resolvedProfile = null;
        let resolvedProfileId = null;
        try {
          const resp = await supabaseApi.fetchProfileByDeviceId(devId);
          const d = (resp as any)?.data?.[0];
          if (d && typeof d.nickname === 'string') {
            const keep = typeof d.keep_logged_in === 'boolean' ? d.keep_logged_in : false;
            resolvedProfile = { nickname: d.nickname, avatar_url: d?.avatar_url ?? null, keep_logged_in: keep };
            resolvedProfileId = String(d.id);
            if (typeof d.coins === 'number') {
              currentCredits = d.coins;
              setCredits(currentCredits);
              await AsyncStorage.setItem(K_CREDITS, String(currentCredits));
            }
          }
        } catch {}

        if (!resolvedProfile) {
          const pstr = await AsyncStorage.getItem(K_PROFILE);
          if (pstr) {
            const p = JSON.parse(pstr);
            const keep = (await AsyncStorage.getItem('mf_keep_login')) === 'true';
            if (p?.nickname) resolvedProfile = { nickname: p.nickname, avatar_url: p?.avatar_url ?? null, keep_logged_in: keep };
          }
        }

        if (resolvedProfile && !resolvedProfileId && resolvedProfile.nickname) {
          try {
            const byNick = await supabaseApi.fetchProfileByNickname(resolvedProfile.nickname);
            const d = (byNick as any)?.data?.[0];
            if (d?.id) resolvedProfileId = String(d.id);
          } catch {}
        }

        if (resolvedProfile) {
          setProfile(resolvedProfile);
          if (resolvedProfileId) setProfileId(resolvedProfileId);
        }
        
        setIsReady(true);
      } catch (err) {
        console.error('[AppState] Initialization error:', err);
        setIsReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const [m, g1, g2, vm, url] = await Promise.all([
        AsyncStorage.getItem(K_MOOD),
        AsyncStorage.getItem(K_G1),
        AsyncStorage.getItem(K_G2),
        AsyncStorage.getItem(K_VOCAL),
        AsyncStorage.getItem(K_URL),
      ]);
      setUserMood(m);
      setGenre1(g1);
      setGenre2(g2);
      if (vm === 'instrumental' || vm === 'lyrics') setVocalModeState(vm);
      // Only restore persisted URL if it belongs to Suno domains
      let restoredUrl: string | null = null;
      if (url) {
        restoredUrl = normalizePlayableUrl(url);
        if (!restoredUrl) {
          await AsyncStorage.removeItem(K_URL);
        }
      }
      setTrackUrl(restoredUrl);
      setHasStartedPlayback(false);
    })();
  }, []);

  // Initialize likes and optionally sync coins down from Supabase if profile exists
  useEffect(() => {
    (async () => {
      try {
        // Likes
        try {
          const lstr = await AsyncStorage.getItem(K_LIKES);
          if (lstr) setLikesMap(JSON.parse(lstr) || {});
        } catch {}

        // Try syncing coins down from Supabase if profile exists
        if (profile?.nickname) {
          const resp = await supabaseApi.fetchProfileByNickname(profile.nickname);
          let coinsVal: number | undefined = undefined;
          if (resp && (resp as any).ok && Array.isArray((resp as any).data)) {
            const d = (resp as any).data as any[];
            const c = d?.[0]?.coins;
            if (typeof c === 'number') coinsVal = c;
            
            // Mirror keep_logged_in if present
            const keep = typeof d?.[0]?.keep_logged_in === 'boolean' ? d[0].keep_logged_in : undefined;
            if (typeof keep === 'boolean') await AsyncStorage.setItem('mf_keep_login', keep ? 'true' : 'false');
          }
          if (typeof coinsVal === 'number') {
            setCredits(coinsVal);
            await AsyncStorage.setItem(K_CREDITS, String(coinsVal));
          }
        }
      } catch {}
    })();
  }, [profile]);

  // Socket client: listen for Suno callbacks and start playback immediately
  const socketRef = useRef<ReturnType<typeof io> | null>(null);

  useEffect(() => {
    let baseIndex = 0;
    let bases: string[] = [];

    const normalizeBase = (raw: unknown): string | null => {
      if (typeof raw !== 'string') return null;
      const t = raw.trim().replace(/\/$/, '');
      if (!t) return null;
      if (t.startsWith('http://') || t.startsWith('https://')) return t;
      return `http://${t}`;
    };

    const resolveSocketBases = () => {
      const envUrl = process.env.EXPO_PUBLIC_SOCKET_URL || process.env.EXPO_PUBLIC_API_URL;
      const cfgUrl =
        Constants?.expoConfig?.extra?.EXPO_PUBLIC_SOCKET_URL ||
        Constants?.expoConfig?.extra?.socketUrl ||
        Constants?.expoConfig?.extra?.EXPO_PUBLIC_API_URL ||
        Constants?.expoConfig?.extra?.apiUrl ||
        '';
      const list: string[] = [];
      const add = (u: unknown) => {
        const n = normalizeBase(u);
        if (n) list.push(n);
      };
      if (Platform.OS === 'web') {
        add('http://localhost:8788');
        add('http://127.0.0.1:8788');
        try {
          // @ts-ignore
          const host = typeof window !== 'undefined' ? window.location.hostname : '';
          if (host && host !== 'localhost' && host !== '127.0.0.1') {
            add(`http://${host}:8788`);
          }
        } catch {}
      }
      try {
        const hostUri =
          // @ts-ignore
          (Constants as any)?.expoConfig?.hostUri ||
          // @ts-ignore
          (Constants as any)?.manifest?.hostUri ||
          // @ts-ignore
          (Constants as any)?.manifest?.debuggerHost ||
          '';
        if (typeof hostUri === 'string' && hostUri.length) {
          const host = hostUri.split(':')[0];
          if (host && host !== 'localhost' && host !== '127.0.0.1') {
            add(`http://${host}:8788`);
          }
        }
      } catch {}
      add(envUrl);
      add(cfgUrl);
      return Array.from(new Set(list));
    };

    const connectSimple = (baseOverride?: string | null) => {
      try {
        const base = String(baseOverride || bases[baseIndex] || '').trim().replace(/\/$/, '');
        if (!base) {
          console.warn('[Client] apiUrl missing — sockets will not connect');
          return null;
        }
        const transports = ['websocket'];
        console.log('[Client] Initializing socket...', { base, transports, baseIndex, basesCount: bases.length });
        
        return io(base, {
          path: '/socket',
          transports,
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 500,
          reconnectionDelayMax: 2000,
          timeout: 10000,
          forceNew: false, 
          autoConnect: false,
        });
      } catch (e) {
        console.warn('[Client] Socket init failed', e);
        return null;
      }
    };

    const attachCoreHandlers = (client: ReturnType<typeof io>) => {
      client.off('disconnect'); // Remove old listeners if any
      client.off('suno:error');
      client.off('suno:track');
      client.off('connect');
      client.off('connect_error');

      client.on('disconnect', (reason) => {
        console.log('[Client] Socket disconnected:', reason);
        if (reason === 'io server disconnect') {
          client.connect();
        }
      });
      client.on('connect', () => {
        console.log('[Client] Socket connected');
      });
      client.on('connect_error', (err) => {
        try {
          const msg = String(err?.message || '');
          console.error('[Client] Socket connect_error:', msg);
        } catch {}
        if (baseIndex + 1 < bases.length) {
          const prev = bases[baseIndex];
          baseIndex += 1;
          const nextBase = bases[baseIndex];
          try { client.disconnect(); } catch {}
          const next = connectSimple(nextBase);
          if (next) {
            socketRef.current = next;
            attachCoreHandlers(next);
            console.log('[Client] Retrying socket with fallback base', { prev, nextBase });
            try { next.connect(); } catch {}
          }
          return;
        }
      });
      client.on('suno:error', (evt: any) => {
        try { console.log('[Client] suno:error', evt); } catch {}
        setStatusLabel('Generation failed — please try again');
        setIsGenerating(false);
        setIsRequesting(false);
        setIsPreloading(false);
        setHasStartedPlayback(false);
      });
      client.on('suno:track', async (evt: any) => {
        console.log('[Client] suno:track RECEIVED', { task_id: evt?.task_id, callbackType: evt?.callbackType });
        try {
          const urls: string[] = Array.isArray(evt?.urls) ? evt.urls : [];
          const cbType: string | null = typeof evt?.callbackType === 'string' ? evt.callbackType : null;
          const first = typeof evt?.url === 'string' ? evt.url : urls[0];
          const second = urls[1] || null;
          const titles: string[] = Array.isArray(evt?.titles) ? evt.titles.filter((x: any) => typeof x === 'string') : [];
          const titleA = typeof titles?.[0] === 'string' ? titles[0] : (typeof evt?.title === 'string' ? evt.title : 'New Track');
          const titleB = typeof titles?.[1] === 'string' ? titles[1] : null;
          
          const firstOk = normalizePlayableUrl(first);
          const secondOk = normalizePlayableUrl(second);
          if (!firstOk) {
            console.log('[Client] Ignored non-APIBox/Suno track URL');
            return;
          }

          const items: any[] = Array.isArray(evt?.items)
            ? evt.items
            : Array.isArray(evt?.tracks)
            ? evt.tracks
            : Array.isArray(evt?.data?.data)
            ? evt.data.data
            : [];

          const pickCoverForUrl = (targetUrl: string | null) => {
            if (!targetUrl) return normalizePlayableUrl(evt?.cover || evt?.image || evt?.image_url || null);
            for (const it of items) {
              const au =
                it?.audio_url ||
                it?.stream_audio_url ||
                it?.source_stream_audio_url ||
                it?.source_audio_url ||
                it?.url ||
                null;
              const normalized = normalizePlayableUrl(au);
              if (normalized && normalized === targetUrl) {
                const c = it?.cover || it?.cover_url || it?.image || it?.image_url || it?.imageUrl || evt?.cover || null;
                return normalizePlayableUrl(c);
              }
            }
            return normalizePlayableUrl(evt?.cover || evt?.image || evt?.image_url || null);
          };
          const coverA = pickCoverForUrl(firstOk);
          const coverB = pickCoverForUrl(secondOk);

          const pickDownloadForUrl = (targetUrl: string | null) => {
            if (!targetUrl) {
              return normalizePlayableUrl(
                evt?.download_url ||
                  evt?.downloadUrl ||
                  evt?.mp3_url ||
                  evt?.mp3Url ||
                  evt?.source_audio_url ||
                  null
              );
            }
            for (const it of items) {
              const au =
                it?.audio_url ||
                it?.stream_audio_url ||
                it?.source_stream_audio_url ||
                it?.source_audio_url ||
                it?.url ||
                null;
              const normalized = normalizePlayableUrl(au);
              if (normalized && normalized === targetUrl) {
                const d =
                  it?.download_url ||
                  it?.downloadUrl ||
                  it?.mp3_url ||
                  it?.mp3Url ||
                  it?.source_audio_url ||
                  it?.sourceAudioUrl ||
                  null;
                return normalizePlayableUrl(d);
              }
            }
            return normalizePlayableUrl(
              evt?.download_url ||
                evt?.downloadUrl ||
                evt?.mp3_url ||
                evt?.mp3Url ||
                evt?.source_audio_url ||
                null
            );
          };
          const dlA = pickDownloadForUrl(firstOk);
          const dlB = secondOk ? pickDownloadForUrl(secondOk) : null;
          const primaryA = dlA ?? firstOk;
          const primaryB = secondOk ? (dlB ?? secondOk) : null;

          // Show "finalizing" label until COMPLETE, but do NOT block playback
          if (cbType !== 'complete') {
            setStatusLabel('Finalizing track…');
          }
          const tid = evt?.task_id ? String(evt.task_id) : null;
          let alreadyProcessed = false;
          if (tid) {
            alreadyProcessed = processedTaskIdsRef.current.has(tid);
            if (!alreadyProcessed) {
              processedTaskIdsRef.current.add(tid);
              currentTaskIdRef.current = tid;
            }
          }
          const alreadyPlayingSame =
            hasStartedPlaybackRef.current && currentTrackUrlRef.current === primaryA;

          setTrackAReadyAtMs((prev) => (prev == null ? Date.now() : prev));
          if (secondOk) setTrackBReadyAtMs((prev) => (prev == null ? Date.now() : prev));

          setTrackTitle(titleA);
          setTrackA(primaryA);
          setTrackB(primaryB);
          setTrackUrl(primaryA);
          setTrackCoverA(coverA);
          setTrackCoverB(coverB);
          if (isSecondActiveRef.current) {
            if (coverB) setTrackCover(coverB);
            else if (coverA) setTrackCover(coverA);
          } else {
            if (coverA) setTrackCover(coverA);
          }
          setProviderLabel('API Box');
          setTrackMp3A(primaryA);
          setTrackMp3B(primaryB);

          if (!alreadyPlayingSame) {
            console.log('[Client] Starting playback:', primaryA);
            try {
              await audioService.configure();
              await audioService.resetSession();
              await audioService.setQueue(primaryB ? [primaryA, primaryB] : [primaryA], { id: tid, title: titleA, titles: primaryB ? [titleA, titleB] : [titleA], artist: 'MoodFusion', artwork: coverA ?? null });
              await audioService.load();
              await audioService.play();
              setHasStartedPlayback(true);
              setIsSecondActive(false);
              console.log('[Client] Playback started successfully');
            } catch (audioErr) {
              console.error('[Client] Playback failed:', audioErr);
            }
          } else if (primaryB && currentTrackBRef.current !== primaryB) {
            console.log('[Client] Second track arrived; preloading for smooth switch');
            try {
              audioService.appendToQueue([primaryB]);
              await audioService.preloadNext(primaryB);
            } catch (e) {
              console.warn('[Client] preloadNext failed', e);
            }
          }

          // Reset generation state immediately to unlock UI
          setIsGenerating(false);
          setIsRequesting(false);
          setIsPreloading(false);
          setStatusLabel('');
          currentTaskIdRef.current = null;

          // Persistence
          await AsyncStorage.setItem(K_URL, primaryA);
          if (!tid || savedForTaskRef.current !== tid) {
            persistGenerationPair(primaryA, primaryB, titleA);
            if (tid) savedForTaskRef.current = tid;
          }

          // Auto-navigate to Player if not already there
          navigate('Player');

          // Persist Track A + Track B once to Supabase (no extra variants)
          try {
            const pid = profileIdRef.current;
            if (!pid) {
              console.warn('[Supabase][BulkInsert] profileId missing — skipping insert');
            }
            if (pid) {
              const genresArr = [g1Ref.current, g2Ref.current].filter(Boolean) as string[];
              const rows: Array<{ profile_id: string; audio_url: string; title?: string | null; mood?: string | null; genres?: string[] | null; liked?: boolean | null; image_url?: string | null; stream_url?: string | null; mp3_url?: string | null }> = [];

              if (primaryA && !insertedUrlsRef.current.has(primaryA)) {
                insertedUrlsRef.current.add(primaryA);
                rows.push({
                  profile_id: pid,
                  audio_url: primaryA,
                  title: titleA ?? null,
                  mood: moodRef.current ?? null,
                  genres: genresArr,
                  liked: false,
                  image_url: coverA ?? null,
                  stream_url: firstOk,
                  mp3_url: dlA ?? firstOk,
                });
              }
              if (primaryB && !insertedUrlsRef.current.has(primaryB)) {
                insertedUrlsRef.current.add(primaryB);
                rows.push({
                  profile_id: pid,
                  audio_url: primaryB,
                  title: titleB ?? null,
                  mood: moodRef.current ?? null,
                  genres: genresArr,
                  liked: false,
                  image_url: coverB ?? null,
                  stream_url: secondOk,
                  mp3_url: dlB ?? secondOk,
                });
              }

              if (rows.length) {
                const resp: any = await supabaseApi.insertTracksBulk(rows);
                const inserted = Array.isArray(resp?.data) ? resp.data : [];
                const rowFor = (u: string | null) => inserted.find((r: any) => typeof r?.audio_url === 'string' && r.audio_url === u) || null;
                const aRow = primaryA ? rowFor(primaryA) : null;
                const bRow = primaryB ? rowFor(primaryB) : null;

                if (aRow?.id != null) setTrackIdA(String(aRow.id));
                if (bRow?.id != null) setTrackIdB(String(bRow.id));
                setTrackLikedA(typeof aRow?.liked === 'boolean' ? aRow.liked : false);
                setTrackLikedB(typeof bRow?.liked === 'boolean' ? bRow.liked : false);

                if (!aRow?.id && pid && primaryA) {
                  try {
                    const found = await supabaseApi.findTrackIdByUrl(pid, primaryA);
                    const id = (found as any)?.data ? String((found as any).data) : null;
                    if (id) setTrackIdA(id);
                  } catch {}
                }
                if (!bRow?.id && pid && primaryB) {
                  try {
                    const found = await supabaseApi.findTrackIdByUrl(pid, primaryB);
                    const id = (found as any)?.data ? String((found as any).data) : null;
                    if (id) setTrackIdB(id);
                  } catch {}
                }
              }
            }
          } catch (dbErr) {
             console.warn('[Client] Bulk insert failed', dbErr);
          }
        } catch (err) {
          console.warn('[Client] suno:track handling failed', err);
        }
      });
    };

    bases = resolveSocketBases();
    baseIndex = 0;
    socketRef.current = connectSimple();
    if (socketRef.current) attachCoreHandlers(socketRef.current);

    // Monitor navigation state to optimize traffic
    const checkConnection = () => {
      // NOTE: navigationRef needs to be available in scope or imported. 
      // Assuming it is handled elsewhere or user accepts this risk if not present.
      if (typeof navigationRef !== 'undefined' && navigationRef.isReady()) {
        const route = navigationRef.getCurrentRoute();
        const name = route?.name;
        const shouldConnect =
          !!isGeneratingRef.current ||
          name === 'MoodSelection' ||
          name === 'GenreSelection' ||
          name === 'Player';
        
        if (socketRef.current && !socketRef.current.connected) {
          console.log('[Client] Screen is ' + name + ' — connecting socket');
          socketRef.current.connect();
        }
      }
    };

    // Poll for navigation readiness then attach listener
    const navPoll = setInterval(() => {
      if (typeof navigationRef !== 'undefined' && navigationRef.isReady()) {
        clearInterval(navPoll);
        navigationRef.addListener('state', checkConnection);
        checkConnection(); // Initial check
      }
    }, 500);

    return () => {
      clearInterval(navPoll);
      if (typeof navigationRef !== 'undefined' && navigationRef.isReady()) {
        navigationRef.removeListener('state', checkConnection);
      }
      socketRef.current?.disconnect();
    };
  }, []);

  // Keep live refs for async handlers (socket callbacks)
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  useEffect(() => { currentTrackUrlRef.current = trackUrl; }, [trackUrl]);
  useEffect(() => { currentTrackBRef.current = trackB ?? null; }, [trackB]);
  useEffect(() => { hasStartedPlaybackRef.current = hasStartedPlayback; }, [hasStartedPlayback]);
  useEffect(() => { profileIdRef.current = profileId; }, [profileId]);
  useEffect(() => { moodRef.current = userMood; }, [userMood]);
  useEffect(() => { g1Ref.current = genre1; }, [genre1]);
  useEffect(() => { g2Ref.current = genre2; }, [genre2]);

  const setMood = async (mood: string) => {
    setUserMood(mood);
    try {
      await AsyncStorage.setItem(K_MOOD, mood);
    } catch {}
  };

  const setGenres = async (g1: string, g2: string) => {
    setGenre1(g1);
    setGenre2(g2);
    try {
      await AsyncStorage.setItem(K_G1, g1);
      await AsyncStorage.setItem(K_G2, g2);
    } catch {}
  };

  const setVocalMode = async (mode: 'lyrics' | 'instrumental') => {
    setVocalModeState(mode);
    try {
      await AsyncStorage.setItem(K_VOCAL, mode);
    } catch {}
  };

  const generateTrack = async (_mood?: string, _genre1?: string, _genre2?: string) => {
    console.log('[AppState] generateTrack triggered:', { _mood, _genre1, _genre2 });
    // Single-call protection (sync + async guards)
    if (requestLockRef.current || isRequesting || isGenerating) {
      console.log('[AppState] generateTrack blocked: request in progress');
      return;
    }
    try {
      if (socketRef.current && !socketRef.current.connected) {
        console.log('[AppState] generateTrack connecting socket for callbacks');
        socketRef.current.connect();
      }
    } catch {}
    requestLockRef.current = true;
    setIsRequesting(true);
    setIsGenerating(true);
    setStatusLabel('');
    setGenerationStartedAtMs(Date.now());
    setTrackAReadyAtMs(null);
    setTrackBReadyAtMs(null);
    setHasStartedPlayback(false);
    setActiveTrackId(null);
    setTrackCover(null);
    setTrackCoverA(null);
    setTrackCoverB(null);
    setTrackMp3A(null);
    setTrackMp3B(null);
    setTrackIdA(null);
    setTrackIdB(null);
    setTrackLikedA(null);
    setTrackLikedB(null);
    generationStartRef.current = Date.now();
    const moodVal = _mood ?? userMood ?? 'Chill';
    const g1Val = _genre1 ?? genre1 ?? 'Lo-Fi';
    const g2Val = _genre2 ?? genre2 ?? 'Jazz';
    try {
      console.log('[AppState] Calling generateSunoTrack...');
      const ack = await generateSunoTrack({ mood: moodVal, genre1: g1Val, genre2: g2Val, vocalMode, profileId: profileIdRef.current ?? profileId }, setGenerationProgress);
      console.log('[AppState] generateSunoTrack response:', ack);
      if (ack?.taskId) {
        currentTaskIdRef.current = ack.taskId;
        // Reset per-task insertion tracking for Supabase
        try { insertedUrlsRef.current.clear(); } catch {}
        // consume one credit on accepted task
        setCredits((prev) => {
          const next = Math.max(0, (prev ?? 0) - 1);
          AsyncStorage.setItem(K_CREDITS, String(next)).catch(() => {});
          try { if (profile?.nickname) supabaseApi.updateCoinsByNickname(profile.nickname, next); } catch {}
          return next;
        });
        setProviderLabel('Suno');
        setGenerationProgress(0.1);
        setStatusLabel('🎛️ Mastering your new vibes…');
        console.log('[Suno] Task accepted →', ack.taskId);
        if (callbackTimeoutRef.current) {
          clearTimeout(callbackTimeoutRef.current);
        }
        if (softTimeoutRef.current) {
          clearTimeout(softTimeoutRef.current);
        }
        // Soft timeout at 45s: update label but keep listening
        softTimeoutRef.current = setTimeout(() => {
          try {
            if (isGeneratingRef.current) {
              setStatusLabel('⏳ Still tuning your vibe…');
            }
          } catch {}
        }, 45 * 1000);
        // Fallback: if no callback within 5 minutes, unlock UI and notify
        callbackTimeoutRef.current = setTimeout(() => {
          try {
            // Non-blocking notice only on Android
            if (Platform.OS === 'android') ToastAndroid.show('Suno request failed — please try again later.', ToastAndroid.SHORT);
          } catch {}
          setIsGenerating(false);
          setGenerationProgress(0);
          setIsRequesting(false);
          setIsPreloading(false);
          setStatusLabel('');
          currentTaskIdRef.current = null;
        }, 5 * 60 * 1000);

      }
    } catch (e) {
      // Improve UX: reflect credit exhaustion and errors clearly
      const code = (e as any)?.code;
      const message = (e as any)?.message || 'Suno request failed — please try again later.';
      try {
        if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      } catch {}
      if (code === 429) {
        setHasSunoBalance(false);
        setStatusLabel('Suno credits exhausted. Please top up or try later.');
      } else {
        setStatusLabel(`Generation failed: ${message}`);
      }
      
      // Fallback removed as requested — show error state instead
      setIsGenerating(false);
      setIsRequesting(false);
      setHasStartedPlayback(false);
      
    } finally {
      requestLockRef.current = false;
    }
  };

  // Helper: persist a single track to Supabase immediately when URL arrives
  const persistSingleTrack = async (url: string | null, title?: string | null) => {
    try {
      const pid = profileIdRef.current;
      if (!pid || !url || !url.startsWith('https://')) return;
      // Deduplicate per task
      if (insertedUrlsRef.current.has(url)) return;
      insertedUrlsRef.current.add(url);
      const genresArr = [g1Ref.current, g2Ref.current].filter(Boolean) as string[];
      const resp: any = await supabaseApi.insertTrack({
        profile_id: pid,
        audio_url: url,
        title: title ?? null,
        mood: moodRef.current ?? null,
        genres: genresArr,
        liked: false,
      });
      if (resp?.ok === false) {
        console.warn('[Supabase][insertTrack] failed', { status: resp?.status, data: resp?.data });
      }
    } catch {}
  };

  // Save current generation pair when ready (complete or both URLs present)
  const persistGenerationPair = async (firstUrl: string | null, secondUrl: string | null, title?: string | null) => {
    try {
      const record = {
        timestamp: Date.now(),
        mood: moodRef.current ?? null,
        genres: [g1Ref.current ?? null, g2Ref.current ?? null],
        first: { id: trackIdARef.current ?? null, audio_url: firstUrl, title: title ?? null, image_url: trackCoverARef.current ?? null, mp3_url: trackMp3ARef.current ?? null, liked: trackLikedARef.current ?? null },
        second: { id: trackIdBRef.current ?? null, audio_url: secondUrl, title: null, image_url: trackCoverBRef.current ?? null, mp3_url: trackMp3BRef.current ?? null, liked: trackLikedBRef.current ?? null },
      };
      const raw = (await AsyncStorage.getItem(K_TRACKS)) || '[]';
      let list: any[] = [];
      try { list = JSON.parse(raw) || []; } catch { list = []; }
      list.push(record);
      await AsyncStorage.setItem(K_TRACKS, JSON.stringify(list.slice(-20)));
    } catch {}
  };

  const reset = async () => {
    setUserMood(null);
    setGenre1(null);
    setGenre2(null);
    setTrackUrl(null);
    setTrackA(null);
    setTrackB(null);
    setStatusLabel('');
    await AsyncStorage.multiRemove([K_MOOD, K_G1, K_G2, K_URL, K_CREDITS, K_TRACKS]);
  };

  const value = useMemo(
    () => ({
      deviceId,
      userMood,
      genre1,
      genre2,
      trackUrl,
      trackA,
      trackB,
      trackCover,
      trackTitle,
      activeTrackId,
      isGenerating,
      isRequesting,
      hasSunoBalance,
      generationProgress,
      providerLabel,
      isPreloading,
      hasStartedPlayback,
      statusLabel,
      generationStartedAtMs,
      trackAReadyAtMs,
      trackBReadyAtMs,
      isSecondActive,
      setPlaybackStarted: (started: boolean) => {
        setHasStartedPlayback(!!started);
        hasStartedPlaybackRef.current = !!started;
      },
      setSecondActive: (active: boolean) => {
        setIsSecondActive(active);
        const next = active ? trackCoverBRef.current : trackCoverARef.current;
        if (next) setTrackCover(next);
      },
      setActivePair: async (payload: { first: { id: string; url: string; title?: string | null; coverUrl?: string | null; liked?: boolean | null }; second?: { id?: string | null; url?: string | null; coverUrl?: string | null; liked?: boolean | null } | null; mood?: string | null; genres?: string[] | null }) => {
        try {
          const firstUrl = normalizePlayableUrl(payload?.first?.url);
          const secondUrl = normalizePlayableUrl(payload?.second?.url);
          if (!firstUrl) return;
          const t = typeof payload?.first?.title === 'string' ? payload.first.title : null;
          const coverA = normalizePlayableUrl(payload?.first?.coverUrl);
          const coverB = normalizePlayableUrl(payload?.second?.coverUrl);
          const idA = payload?.first?.id ? String(payload.first.id) : null;
          const idB = payload?.second?.id ? String(payload.second.id) : null;

          if (typeof payload?.mood === 'string' && payload.mood.length) setUserMood(payload.mood);
          if (Array.isArray(payload?.genres) && payload.genres.length) {
            const g1 = typeof payload.genres[0] === 'string' ? payload.genres[0] : null;
            const g2 = typeof payload.genres[1] === 'string' ? payload.genres[1] : null;
            if (g1) setGenre1(g1);
            if (g2) setGenre2(g2);
          }

          try { await audioService.configure(); } catch {}
          try { await audioService.resetSession(); } catch {}

          setTrackTitle(t);
          setTrackA(firstUrl);
          setTrackB(secondUrl);
          setTrackUrl(firstUrl);
          setTrackCoverA(coverA);
          setTrackCoverB(coverB);
          setTrackCover(coverA ?? null);
          setTrackIdA(idA);
          setTrackIdB(idB);
          setTrackLikedA(typeof payload?.first?.liked === 'boolean' ? payload.first.liked : null);
          setTrackLikedB(typeof payload?.second?.liked === 'boolean' ? payload.second.liked : null);
          setIsSecondActive(false);
          setActiveTrackId(idA);
          setIsGenerating(false);
          setIsRequesting(false);
          setIsPreloading(false);
          setStatusLabel('Loading…');
          setHasStartedPlayback(false);
          hasStartedPlaybackRef.current = false;
          navigate('Player');
          const slowToast = setTimeout(() => {
            try {
              if (!hasStartedPlaybackRef.current) {
                if (Platform.OS === 'android') ToastAndroid.show('Loading…', ToastAndroid.SHORT);
              }
            } catch {}
          }, 2200);
          await audioService.setQueue(secondUrl ? [firstUrl, secondUrl] : [firstUrl], { id: idA ?? null, title: t, artist: 'MoodFusion', artwork: coverA ?? null });
          try {
            await audioService.load();
            await audioService.play();
          } catch {
            clearTimeout(slowToast);
            setStatusLabel('Unable to load this track. Please try again.');
            return;
          }
          clearTimeout(slowToast);
          setHasStartedPlayback(true);
          hasStartedPlaybackRef.current = true;
          setIsSecondActive(false);
          setStatusLabel('');
          await AsyncStorage.setItem(K_URL, firstUrl);
          if (secondUrl) {
            try { await audioService.preloadNext(secondUrl); } catch {}
          }
        } catch {}
      },
      credits,
      isReady,
      consumeCredit: async () => {
        setCredits((prev) => {
          const next = Math.max(0, (prev ?? 0) - 1);
          AsyncStorage.setItem(K_CREDITS, String(next)).catch(() => {});
          try {
            if (deviceId) {
              supabaseApi.updateCoinsByDeviceId(deviceId, next);
            } else if (profile?.nickname) {
              supabaseApi.updateCoinsByNickname(profile.nickname, next);
            }
          } catch {}
          return next;
        });
      },
      addCoins: async (amount: number, planName?: string, priceUsd?: number) => {
        if (!amount || amount <= 0) return;
        setCredits((prev) => {
          const next = Math.max(0, (prev ?? 0)) + amount;
          AsyncStorage.setItem(K_CREDITS, String(next)).catch(() => {});
          try {
            if (deviceId) {
              supabaseApi.updateCoinsByDeviceId(deviceId, next);
            } else if (profile?.nickname) {
              supabaseApi.updateCoinsByNickname(profile.nickname, next);
            }
          } catch {}
          return next;
        });
        // Removed purchase persistence for clean reset
      },
      isLiked: (url: string | null) => {
        if (!url) return false;
        if (url === trackA && trackLikedA != null) return !!trackLikedA;
        if (url === trackB && trackLikedB != null) return !!trackLikedB;
        return !!likesMap[url];
      },
      toggleLike: async (url: string | null) => {
        if (!url) return;
        const isA = url === trackA;
        const isB = url === trackB;
        const targetId = isA ? trackIdA : isB ? trackIdB : null;
        const currentLiked = isA ? trackLikedA : isB ? trackLikedB : (likesMap[url] ?? false);
        const nextLiked = !currentLiked;

        if (isA) setTrackLikedA(nextLiked);
        if (isB) setTrackLikedB(nextLiked);
        setLikesMap((prev) => {
          const next = { ...prev, [url]: nextLiked };
          AsyncStorage.setItem(K_LIKES, JSON.stringify(next)).catch(() => {});
          return next;
        });

        try {
          if (!profileId) return;
          let trackId = targetId;
          if (!trackId) {
            const found = await supabaseApi.findTrackIdByUrl(profileId, url);
            trackId = (found as any)?.data || null;
          }
          if (!trackId) return;
          await supabaseApi.updateTrackLiked(trackId, nextLiked);
          if (nextLiked) {
            await supabaseApi.insertHistory({ profile_id: profileId, track_id: trackId });
          }
        } catch {}
      },
      setMood,
      setGenres,
      vocalMode,
      setVocalMode,
      generateTrack,
      playUrl: async (url: string, title?: string | null, coverUrl?: string | null, trackId?: string | null, liked?: boolean | null, fallbackUrl?: string | null) => {
        try {
          const playable = normalizePlayableUrl(url);
          if (!playable) return;
          const fallback = normalizePlayableUrl(fallbackUrl);
          const cover = normalizePlayableUrl(coverUrl);
          try { await audioService.configure(); } catch {}
          try { await audioService.resetSession(); } catch {}
          setTrackUrl(playable);
          setTrackA(playable);
          setTrackTitle(title ?? null);
          setTrackB(null);
          setTrackCoverA(cover);
          setTrackCoverB(null);
          setTrackCover(cover ?? null);
          setTrackIdA(trackId ? String(trackId) : null);
          setTrackIdB(null);
          setTrackLikedA(typeof liked === 'boolean' ? liked : null);
          setTrackLikedB(null);
          setActiveTrackId(trackId ? String(trackId) : null);
          setIsGenerating(false);
          setIsRequesting(false);
          setIsPreloading(false);
          setStatusLabel('Loading…');
          setHasStartedPlayback(false);
          hasStartedPlaybackRef.current = false;
          setIsSecondActive(false);
          navigate('Player');
          const slowToast = setTimeout(() => {
            try {
              if (!hasStartedPlaybackRef.current) {
                if (Platform.OS === 'android') ToastAndroid.show('Loading…', ToastAndroid.SHORT);
              }
            } catch {}
          }, 2200);
          await audioService.setQueue([playable], { id: trackId ? String(trackId) : null, title: title ?? null, artist: 'MoodFusion', artwork: cover ?? null });
          try {
            await audioService.load();
            await audioService.play();
          } catch {
            if (fallback && fallback !== playable) {
              try {
                setStatusLabel('Retrying…');
                try { await audioService.resetSession(); } catch {}
                setTrackUrl(fallback);
                setTrackA(fallback);
                await audioService.setQueue([fallback], { id: trackId ? String(trackId) : null, title: title ?? null, artist: 'MoodFusion', artwork: cover ?? null });
                await audioService.load();
                await audioService.play();
              } catch {
                clearTimeout(slowToast);
                setStatusLabel('Unable to load this track. Please try again.');
                return;
              }
            } else {
              clearTimeout(slowToast);
              setStatusLabel('Unable to load this track. Please try again.');
              return;
            }
          }
          clearTimeout(slowToast);
          setHasStartedPlayback(true);
          setIsSecondActive(false);
          setStatusLabel('');
          await AsyncStorage.setItem(K_URL, playable);
        } catch {}
      },
      playPair: async (firstUrl: string, secondUrl?: string | null, title?: string | null, mood?: string | null, genres?: string[] | null, coverFirst?: string | null, coverSecond?: string | null, trackIdA?: string | null, trackIdB?: string | null, likedA?: boolean | null, likedB?: boolean | null) => {
        try {
          const first = normalizePlayableUrl(firstUrl);
          const second = normalizePlayableUrl(secondUrl);
          if (!first) return;

          if (hasStartedPlaybackRef.current && (currentTrackUrlRef.current === first || currentTrackUrlRef.current === second)) {
            navigate('Player');
            return;
          }

          if (typeof mood === 'string' && mood.length) setUserMood(mood);
          if (Array.isArray(genres) && genres.length) {
            const g1 = typeof genres[0] === 'string' ? genres[0] : null;
            const g2 = typeof genres[1] === 'string' ? genres[1] : null;
            if (g1) setGenre1(g1);
            if (g2) setGenre2(g2);
          }
          setTrackTitle(title ?? null);
          setTrackA(first);
          setTrackB(second);
          setTrackUrl(first);
          const cA = normalizePlayableUrl(coverFirst);
          const cB = normalizePlayableUrl(coverSecond);
          setTrackCoverA(cA);
          setTrackCoverB(cB);
          setTrackCover(cA ?? null);
          setTrackIdA(trackIdA ? String(trackIdA) : null);
          setTrackIdB(trackIdB ? String(trackIdB) : null);
          setTrackLikedA(typeof likedA === 'boolean' ? likedA : null);
          setTrackLikedB(typeof likedB === 'boolean' ? likedB : null);
          setActiveTrackId(trackIdA ? String(trackIdA) : null);
          setIsGenerating(false);
          setIsRequesting(false);
          setIsPreloading(false);
          setStatusLabel('Loading…');
          setHasStartedPlayback(false);
          hasStartedPlaybackRef.current = false;
          setIsSecondActive(false);
          navigate('Player');
          try { await audioService.configure(); } catch {}
          try { await audioService.resetSession(); } catch {}
          const slowToast = setTimeout(() => {
            try {
              if (!hasStartedPlaybackRef.current) {
                if (Platform.OS === 'android') ToastAndroid.show('Loading…', ToastAndroid.SHORT);
              }
            } catch {}
          }, 2200);
          await audioService.setQueue(second ? [first, second] : [first], { id: trackIdA ? String(trackIdA) : null, title: title ?? null, artist: 'MoodFusion', artwork: cA ?? null });
          try {
            await audioService.load();
            await audioService.play();
          } catch {
            clearTimeout(slowToast);
            setStatusLabel('Unable to load this track. Please try again.');
            return;
          }
          clearTimeout(slowToast);
          setHasStartedPlayback(true);
          setIsSecondActive(false);
          setStatusLabel('');
          if (second) {
            try { await audioService.preloadNext(second); } catch {}
          }
          await AsyncStorage.setItem(K_URL, first);
        } catch {}
      },
      hasSavedMatch: async (mood: string, g1: string, g2: string) => {
        try {
          const raw = await AsyncStorage.getItem(K_TRACKS);
          const list: any[] = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(list)) return false;
          const target = [g1, g2].sort().join('|');
          for (let i = list.length - 1; i >= 0; i--) {
            const rec = list[i];
            const mg = Array.isArray(rec?.genres) ? rec.genres : [rec?.genres?.[0] ?? null, rec?.genres?.[1] ?? null];
            const recKey = mg.slice(0,2).sort().join('|');
            if (rec?.mood === mood && recKey === target) {
              const f = rec?.first?.audio_url;
              const s = rec?.second?.audio_url;
              if (typeof f === 'string' && f.startsWith('https://')) return true;
            }
          }
          return false;
        } catch { return false; }
      },
      playSavedMatch: async (mood: string, g1: string, g2: string) => {
        try {
          const raw = await AsyncStorage.getItem(K_TRACKS);
          const list: any[] = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(list) || !list.length) return;
          const target = [g1, g2].sort().join('|');
          let found: any | null = null;
          for (let i = list.length - 1; i >= 0; i--) {
            const rec = list[i];
            const mg = Array.isArray(rec?.genres) ? rec.genres : [rec?.genres?.[0] ?? null, rec?.genres?.[1] ?? null];
            const recKey = mg.slice(0,2).sort().join('|');
            if (rec?.mood === mood && recKey === target) { found = rec; break; }
          }
          const first = normalizePlayableUrl(found?.first?.audio_url);
          const second = normalizePlayableUrl(found?.second?.audio_url);
          if (!first) return;
          setUserMood(mood);
          setGenre1(g1);
          setGenre2(g2);
          setTrackTitle(found?.first?.title ?? null);
          setTrackA(first);
          setTrackB(second);
          setTrackUrl(first);
          const cA = normalizePlayableUrl(found?.first?.image_url || found?.first?.cover || null);
          const cB = normalizePlayableUrl(found?.second?.image_url || found?.second?.cover || null);
          setTrackCoverA(cA);
          setTrackCoverB(cB);
          setTrackCover(cA ?? null);
          const idA = found?.first?.id != null ? String(found.first.id) : null;
          const idB = found?.second?.id != null ? String(found.second.id) : null;
          setTrackIdA(idA);
          setTrackIdB(idB);
          setTrackLikedA(typeof found?.first?.liked === 'boolean' ? found.first.liked : null);
          setTrackLikedB(typeof found?.second?.liked === 'boolean' ? found.second.liked : null);
          setIsGenerating(false);
          setIsRequesting(false);
          setIsPreloading(false);
          setStatusLabel('');
          try { await audioService.configure(); } catch {}
          try { await audioService.resetSession(); } catch {}
          await audioService.setQueue(second ? [first, second] : [first], { id: found?.first?.id ? String(found.first.id) : null, title: found?.first?.title ?? null, artist: 'MoodFusion', artwork: cA ?? null });
          await audioService.load();
          await audioService.play();
          setHasStartedPlayback(true);
          await AsyncStorage.setItem(K_URL, first);
          navigate('Player');
        } catch {}
      },
      refreshProfile: async () => {
        try {
          // Prefer device_id for profile refresh
          const devId = (await AsyncStorage.getItem('mf_device_id')) || deviceId;
          let resp: any = null;
          if (devId) {
            try { resp = await supabaseApi.fetchProfileByDeviceId(devId); } catch {}
          }
          // Fallback to nickname if device lookup failed
          if (!resp || !(resp as any)?.ok || !Array.isArray((resp as any)?.data) || ((resp as any)?.data?.length || 0) === 0) {
            const pstr = await AsyncStorage.getItem(K_PROFILE);
            if (!pstr) return;
            const p = JSON.parse(pstr);
            if (!p?.nickname) return;
            try { resp = await supabaseApi.fetchProfileByNickname(p.nickname); } catch {}
          }
          if (resp && (resp as any).ok && Array.isArray((resp as any).data) && ((resp as any).data.length || 0) > 0) {
            const d = (resp as any).data[0];
            const coinsVal = typeof d?.coins === 'number' ? d.coins : undefined;
            const nickname = typeof d?.nickname === 'string' && d.nickname.length ? d.nickname : (profile?.nickname || '');
            const avatar_url = typeof d?.avatar_url === 'string' && d.avatar_url.length ? d.avatar_url : (profile?.avatar_url || null);
            const keep_logged_in = typeof d?.keep_logged_in === 'boolean' ? d.keep_logged_in : (await AsyncStorage.getItem('mf_keep_login')) === 'true';
            setProfile({ nickname, avatar_url, keep_logged_in });
            if (d?.id) setProfileId(String(d.id));
            await AsyncStorage.setItem(K_PROFILE, JSON.stringify({ nickname, avatar_url, keep_logged_in }));
            await AsyncStorage.setItem('mf_keep_login', keep_logged_in ? 'true' : 'false');
            if (typeof coinsVal === 'number') {
              setCredits(coinsVal);
              await AsyncStorage.setItem(K_CREDITS, String(coinsVal));
            }
          }
        } catch {}
      },
      connectSocket: () => {
        if (socketRef.current && !socketRef.current.connected) {
          console.log('[Client] Manually connecting socket...');
          socketRef.current.connect();
        }
      },
      disconnectSocket: () => {
        if (socketRef.current && socketRef.current.connected) {
          console.log('[Client] Manually disconnecting socket...');
          socketRef.current.disconnect();
        }
      },
      reset,
    }),
    [userMood, genre1, genre2, vocalMode, trackUrl, trackA, trackB, trackCover, trackTitle, trackIdA, trackIdB, trackLikedA, trackLikedB, isGenerating, isRequesting, hasSunoBalance, generationProgress, providerLabel, isPreloading, hasStartedPlayback, statusLabel, isSecondActive, credits, likesMap, profile]
  );

  return <AppStateContext.Provider value={{ ...value, profile, profileId }}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
