// TrackPlayer background service: handles remote controls from notifications
// This file is loaded by TrackPlayer.registerPlaybackService in index.ts
import TrackPlayer, { Event } from 'react-native-track-player';

export default async function trackPlayerService() {
  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    try { await TrackPlayer.play(); } catch {}
  });
  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    try { await TrackPlayer.pause(); } catch {}
  });
  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    try { await TrackPlayer.stop(); } catch {}
  });
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try { await TrackPlayer.skipToNext(); } catch {}
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try { await TrackPlayer.skipToPrevious(); } catch {}
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, async (e) => {
    try { await TrackPlayer.seekTo(e.position); } catch {}
  });
}