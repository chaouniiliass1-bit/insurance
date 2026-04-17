import { Audio, AVPlaybackStatus } from 'expo-av';
import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';

let TrackPlayer: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  TrackPlayer = require('react-native-track-player');
} catch {}

class AudioService {
  private sound: Audio.Sound | null = null;
  private nextSound: Audio.Sound | null = null;
  private prevSound: Audio.Sound | null = null;
  private queue: string[] = [];
  private currentIndex = -1;
  private statusListener?: (status: AVPlaybackStatus) => void;
  private prevPausedPositionMillis: number | null = null;
  private nextPausedPositionMillis: number | null = null;
  private tpPollTimer: any = null;
  private tpReady: boolean = false;
  // Disable TrackPlayer in Expo Go (storeClient) as native module is missing
  private useTP: boolean = Platform.OS !== 'web' && 
    !!NativeModules?.TrackPlayer &&
    !!TrackPlayer;

  private forwardStatus = (status: AVPlaybackStatus) => {
    if (this.statusListener) {
      this.statusListener(status);
    }
  };

  async configure() {
    if (this.useTP) {
      try {
        if (!this.tpReady) {
          await TrackPlayer.setupPlayer({});
          this.tpReady = true;
        }
        const C = TrackPlayer?.Capability;
        const capabilities = C
          ? [C.Play, C.Pause, C.SeekTo, C.Stop, C.SkipToNext, C.SkipToPrevious]
          : ['play', 'pause', 'seekTo', 'stop', 'skipToNext', 'skipToPrevious'];
        const compactCapabilities = C ? [C.Play, C.Pause] : ['play', 'pause'];
        const options: any = {
          stopWithApp: false,
          capabilities,
          compactCapabilities,
        };
        if (TrackPlayer?.AppKilledPlaybackBehavior && TrackPlayer?.android) {
          options.android = {
            appKilledPlaybackBehavior: TrackPlayer.AppKilledPlaybackBehavior.ContinuePlayback,
          };
        }
        await TrackPlayer.updateOptions(options);
      } catch {}
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
      });
    } catch (e) {
      // On web, some options may not be supported; ignore configuration errors.
    }
  }

  async resetSession() {
    if (this.useTP) {
      try { await TrackPlayer.stop(); } catch {}
      try { await TrackPlayer.reset(); } catch {}
      return;
    }
    try {
      if (this.sound) {
        try { await this.sound.stopAsync(); } catch {}
        try { await this.sound.unloadAsync(); } catch {}
      }
    } catch {}
    try { if (this.nextSound) { try { await this.nextSound.stopAsync(); } catch {}; try { await this.nextSound.unloadAsync(); } catch {} } } catch {}
    try { if (this.prevSound) { try { await this.prevSound.stopAsync(); } catch {}; try { await this.prevSound.unloadAsync(); } catch {} } } catch {}

    this.sound = null;
    this.nextSound = null;
    this.prevSound = null;
    this.prevPausedPositionMillis = null;
    this.nextPausedPositionMillis = null;
    this.queue = [];
    this.currentIndex = -1;
  }

  async setQueue(
    urls: string[],
    meta?: { id?: string | null; title?: string | null; titles?: Array<string | null> | null; artist?: string | null; artwork?: string | null }
  ) {
    if (!this.useTP) {
      try {
        if (this.nextSound) {
          try { await this.nextSound.stopAsync(); } catch {}
          try { await this.nextSound.unloadAsync(); } catch {}
        }
      } catch {}
      try {
        if (this.prevSound) {
          try { await this.prevSound.stopAsync(); } catch {}
          try { await this.prevSound.unloadAsync(); } catch {}
        }
      } catch {}
      this.nextSound = null;
      this.prevSound = null;
      this.prevPausedPositionMillis = null;
      this.nextPausedPositionMillis = null;
    }
    this.queue = urls;
    this.currentIndex = urls.length ? 0 : -1;
    if (this.useTP) {
      try {
        await TrackPlayer.reset();
        const baseId = typeof meta?.id === 'string' && meta.id.trim().length ? meta.id.trim() : String(Date.now());
        const title = typeof meta?.title === 'string' && meta.title.trim().length ? meta.title.trim() : 'MoodFusion';
        const artist = typeof meta?.artist === 'string' && meta.artist.trim().length ? meta.artist.trim() : 'MoodFusion';
        const artwork = typeof meta?.artwork === 'string' && meta.artwork.trim().length ? meta.artwork.trim() : undefined;
        try {
          const firstUrl = urls[0];
          if (typeof firstUrl === 'string' && firstUrl.length) {
            console.log('[TrackPlayer] add', { url: firstUrl, isSupabase: firstUrl.includes('.supabase.co') });
          }
        } catch {}
        const tracks = urls.map((u: string, i: number) => {
          const tiRaw = Array.isArray(meta?.titles) ? meta?.titles?.[i] : null;
          const ti = typeof tiRaw === 'string' && tiRaw.trim().length ? tiRaw.trim() : title;
          const t: any = { id: urls.length === 1 ? baseId : `${baseId}_${i}`, url: u, title: ti, artist };
          if (artwork) t.artwork = artwork;
          t.headers = { 'Bypass-Tunnel-Reminder': 'true' };
          return t;
        });
        if (tracks.length === 1) await TrackPlayer.add(tracks[0]);
        else if (tracks.length) await TrackPlayer.add(tracks);
      } catch {}
      return;
    }
    if (this.sound) {
      try { await this.sound.stopAsync(); } catch {}
      await this.sound.unloadAsync();
      this.sound = null;
    }
  }

  // Append URLs to the queue without interrupting current playback.
  // Preserves currentIndex and active sound.
  appendToQueue(urls: string[]) {
    if (!urls || !urls.length) return;
    // Do not exceed two tracks per generation; keep existing current track
    const combined = [...this.queue, ...urls];
    this.queue = combined.slice(0, 2);
  }

  async load(url?: string) {
    const sourceUrl = url ?? this.queue[this.currentIndex];
    if (!sourceUrl) return;
    if (this.useTP) {
      // TrackPlayer prepares on add; nothing to load explicitly.
      return;
    }
    if (this.sound) {
      try {
        await this.sound.stopAsync();
      } catch {}
      // Retain previous sound for instant back-toggle without reload
      this.prevSound = this.sound;
      this.sound = null;
    }
    const playUrl = this.shouldNoCache(sourceUrl) ? this.withNoCache(sourceUrl) : sourceUrl;
    let sound: Audio.Sound | null = null;
    try {
      const created = await Audio.Sound.createAsync(
        { uri: playUrl, headers: { 'Bypass-Tunnel-Reminder': 'true' } },
        { shouldPlay: false, progressUpdateIntervalMillis: 250 }
      );
      sound = created.sound;
    } catch (e: any) {
      try { console.warn('[Audio] load failed', { url: playUrl, err: String(e?.message || e) }); } catch {}
      throw e;
    }
    this.sound = sound;
    this.sound.setOnPlaybackStatusUpdate(this.forwardStatus);
    try {
      const status = (await this.sound.getStatusAsync()) as AVPlaybackStatus;
      this.forwardStatus(status);
    } catch {}
  }

  async play() {
    if (this.useTP) {
      try { await TrackPlayer.play(); } catch {}
      return;
    }
    if (!this.sound) return;
    await this.sound.playAsync();
  }

  async pause() {
    if (this.useTP) {
      try { await TrackPlayer.pause(); } catch {}
      return;
    }
    if (!this.sound) return;
    await this.sound.pauseAsync();
  }

  async stop() {
    if (this.useTP) {
      try { await TrackPlayer.stop(); } catch {}
      return;
    }
    if (!this.sound) return;
    const status = (await this.sound.getStatusAsync()) as AVPlaybackStatus;
    if ('isLoaded' in status && status.isLoaded) {
      await this.sound.stopAsync();
    }
  }

  async next() {
    if (this.useTP) {
      try { await TrackPlayer.skipToNext(); await TrackPlayer.play(); } catch {}
      return;
    }
    if (!this.queue.length) return;
    this.currentIndex = (this.currentIndex + 1) % this.queue.length;
    await this.load(this.queue[this.currentIndex]);
    await this.play();
  }

  hasNext(): boolean {
    if (!this.queue.length) return false;
    return this.currentIndex >= 0 && this.currentIndex < this.queue.length - 1;
  }

  // Whether a preloaded next track is ready to switch to
  hasNextPreloaded(): boolean {
    return !!this.nextSound;
  }

  setStatusListener(listener?: (status: AVPlaybackStatus) => void) {
    this.statusListener = listener;
    if (this.useTP) {
      if (this.tpPollTimer) { clearInterval(this.tpPollTimer); this.tpPollTimer = null; }
      if (listener) {
        this.tpPollTimer = setInterval(async () => {
          try {
            const pos = await TrackPlayer.getPosition();
            const dur = await TrackPlayer.getDuration();
            const state = await TrackPlayer.getState();
            const isPlaying = state && state.toString && String(state).includes('Playing');
            // Map to expo-av-like status object
            const status: any = {
              isLoaded: true,
              isPlaying,
              positionMillis: Math.floor((pos || 0) * 1000),
              durationMillis: Math.floor((dur || 0) * 1000),
            };
            this.forwardStatus(status as AVPlaybackStatus);
          } catch {}
        }, 400);
      }
      return;
    }
    if (this.sound) {
      // Keep forwarding; when listener is undefined, forwardStatus is a no-op.
      this.sound.setOnPlaybackStatusUpdate(this.forwardStatus);
    }
  }

  async seek(positionMillis: number) {
    if (this.useTP) {
      try { await TrackPlayer.seekTo((positionMillis || 0) / 1000); } catch {}
      return;
    }
    if (this.sound) {
      await this.sound.setPositionAsync(positionMillis);
    }
  }

  async getStatus(): Promise<AVPlaybackStatus | null> {
    if (this.useTP) {
      try {
        const pos = await TrackPlayer.getPosition();
        const dur = await TrackPlayer.getDuration();
        const state = await TrackPlayer.getState();
        const isPlaying = state && state.toString && String(state).includes('Playing');
        return {
          // @ts-ignore
          isLoaded: true,
          // @ts-ignore
          isPlaying,
          // @ts-ignore
          positionMillis: Math.floor((pos || 0) * 1000),
          // @ts-ignore
          durationMillis: Math.floor((dur || 0) * 1000),
        } as AVPlaybackStatus;
      } catch {
        return null;
      }
    }
    if (!this.sound) return null;
    return (await this.sound.getStatusAsync()) as AVPlaybackStatus;
  }

  // Preload a next track without interrupting current playback
  async preloadNext(url: string) {
    if (this.useTP) {
      // Add next track to the queue; playback will skip when requested
      try { await TrackPlayer.add({ id: `next-${Date.now()}`, url, title: 'MoodFusion', artist: 'Suno', headers: { 'Bypass-Tunnel-Reminder': 'true' } }); } catch {}
      return;
    }
    if (this.nextSound) {
      try {
        await this.nextSound.unloadAsync();
      } catch {}
      this.nextSound = null;
    }
    const playUrl = this.shouldNoCache(url) ? this.withNoCache(url) : url;
    const { sound: next } = await Audio.Sound.createAsync({ uri: playUrl, headers: { 'Bypass-Tunnel-Reminder': 'true' } }, { shouldPlay: false, volume: 0 });
    this.nextSound = next;
  }

  // Crossfade into the preloaded next track over durationMs (default 1200ms)
  async crossfadeToNext(durationMs = 800) {
    if (this.useTP) { try { await this.next(); } catch {}; return; }
    if (!this.nextSound) return;
    const current = this.sound;
    const next = this.nextSound;
    // 1) Fade out current fully; only current plays during this phase
    const outSteps = 20;
    const outStepDelay = Math.max(16, Math.floor(durationMs / outSteps));
    for (let i = 1; i <= outSteps; i++) {
      const t = i / outSteps; // 0..1
      try {
        if (current) {
          await current.setVolumeAsync(1 - t);
        }
      } catch {}
      await new Promise((res) => setTimeout(res, outStepDelay));
    }
    // Pause and capture exact position for perfect resume later
    try {
      if (current) {
        const status = (await current.getStatusAsync()) as AVPlaybackStatus;
        if ('isLoaded' in status && status.isLoaded) {
          this.prevPausedPositionMillis = status.positionMillis ?? 0;
        }
        await current.pauseAsync();
        await current.setVolumeAsync(0);
      }
    } catch {}

    // 2) Start next from 0 volume after current is fully paused (no overlap)
    await next.setPositionAsync(0);
    await next.setVolumeAsync(0);
    await next.playAsync();
    // Fade in next smoothly to full volume
    const inSteps = 20;
    const inStepDelay = Math.max(16, Math.floor(durationMs / inSteps));
    for (let i = 1; i <= inSteps; i++) {
      const t = i / inSteps; // 0..1
      try {
        await next.setVolumeAsync(t);
      } catch {}
      await new Promise((res) => setTimeout(res, inStepDelay));
    }

    // Make next active and wire status
    this.prevSound = current || null;
    this.sound = next;
    this.nextSound = null;
    await this.sound.setVolumeAsync(1);
    this.sound.setOnPlaybackStatusUpdate(this.forwardStatus);
  }

  // Crossfade back to the previous track (if available) over durationMs
  async crossfadeToPrev(durationMs = 800) {
    if (this.useTP) {
      try { await TrackPlayer.skipToPrevious(); await TrackPlayer.play(); } catch {}
      return;
    }
    if (!this.prevSound) return;
    const current = this.sound;
    const prev = this.prevSound;
    // 1) Fade out current fully first; only current plays during this phase
    const outSteps = 20;
    const outStepDelay = Math.max(16, Math.floor(durationMs / outSteps));
    for (let i = 1; i <= outSteps; i++) {
      const t = i / outSteps;
      try {
        if (current) {
          await current.setVolumeAsync(1 - t);
        }
      } catch {}
      await new Promise((res) => setTimeout(res, outStepDelay));
    }
    // Pause current and record its exact position
    try {
      if (current) {
        const status = (await current.getStatusAsync()) as AVPlaybackStatus;
        if ('isLoaded' in status && status.isLoaded) {
          this.nextPausedPositionMillis = status.positionMillis ?? 0;
        }
        await current.pauseAsync();
        await current.setVolumeAsync(0);
      }
    } catch {}

    // 2) Resume previous from its last paused position after current is paused
    const resumePos = this.prevPausedPositionMillis ?? 0;
    await prev.setPositionAsync(resumePos);
    await prev.setVolumeAsync(0);
    await prev.playAsync();

    const inSteps = 20;
    const inStepDelay = Math.max(16, Math.floor(durationMs / inSteps));
    for (let i = 1; i <= inSteps; i++) {
      const t = i / inSteps;
      try {
        await prev.setVolumeAsync(t);
      } catch {}
      await new Promise((res) => setTimeout(res, inStepDelay));
    }

    // Wire status and make previous active
    this.nextSound = current || null;
    this.sound = prev;
    this.prevSound = null;
    await this.sound.setVolumeAsync(1);
    this.sound.setOnPlaybackStatusUpdate(this.forwardStatus);
  }

  private withNoCache(url: string) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}nocache=${Date.now()}`;
  }

  private shouldNoCache(url: string) {
    // Single-provider app: avoid altering Mureka URLs
    return false;
  }
}

export const audioService = new AudioService();
